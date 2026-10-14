"""Данные для экранов. Состав зависит от роли: бухгалтеру агрегаты не отдаются вообще —
ни прибыль, ни общие расходы, ни итоги, ни топливо, ни статусы по дням."""
from __future__ import annotations

import calendar
import datetime as dt
from collections import defaultdict
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings as cfg
from .models import (AuditLog, FleetDaysHistory, FuelDay, Mileage, Operation, Period, ReferenceValue, ReviewItem,
                     ScheduleMonth, Setting, User, Vehicle)

DEFAULT_UI_SETTINGS = {'alloc': 'days', 'groups': [2013, 2017, 2021], 'fuelPct': 10, 'glonassMax': 1500,
                       'kmMin': 0, 'kmMax': 20000, 'lMin': 20, 'lMax': 45}
ANALYTICS_ROLES = ('admin', 'viewer')
INPUT_ARTICLES = {'rev': 'revenue', 'fuel': 'fuel', 'repair': 'repair', 'salary': 'salary', 'other': 'other'}
SHARED = {'shared_tractor': 'tractor', 'shared_gen': 'gen', 'shared_service': 'service', 'shared_amort': 'amort'}


def today() -> dt.date:
    return dt.datetime.now(ZoneInfo(cfg.timezone)).date()


def current_ym() -> str:
    t = today()
    return f'{t.year}-{t.month:02d}'


def days_in(ym: str) -> int:
    y, m = map(int, ym.split('-'))
    return calendar.monthrange(y, m)[1]


def ui_settings(db: Session) -> dict:
    s = db.get(Setting, 'ui')
    return {**DEFAULT_UI_SETTINGS, **(s.value if s else {})}


def ensure_current_period(db: Session) -> None:
    """Текущий месяц открывается сам."""
    ym = current_ym()
    if not db.scalar(select(Period).where(Period.ym == ym)):
        db.add(Period(ym=ym, status='open'))
        db.commit()


def vehicle_dict(v: Vehicle) -> dict:
    return {'key': v.key, 'name': v.name, 'plate': v.plate, 'make': v.make, 'model': v.model, 'year': v.year, 'tacho': v.tacho,
            'odo': v.odo_km, 'trailer': v.trailer, 'trailer_model': v.trailer_model, 'trailer_year': v.trailer_year,
            'amort': v.amort_kop / 100 if v.amort_kop is not None else None,
            'from': v.in_service_from.isoformat() if v.in_service_from else None, 'to': v.in_service_to.isoformat() if v.in_service_to else None,
            'active': v.is_active, 'history_only': v.history_only, 'manual': v.manual, 'edited': v.edited}


def input_entries(db: Session, keys: dict[int, str], yms: list[str]) -> dict:
    """Ручной ввод по машинам — в том виде, в каком его вводили (с НДС или без)."""
    out: dict = defaultdict(dict)
    for m in db.scalars(select(Mileage).where(Mileage.ym.in_(yms))):
        e = out[m.ym].setdefault(keys[m.vehicle_id], {})
        e['km'], e['days'] = m.km, m.worked_days
    rev = {v: k for k, v in INPUT_ARTICLES.items()}
    for o in db.scalars(select(Operation).where(Operation.ym.in_(yms), Operation.source == 'manual', Operation.vehicle_id.is_not(None))):
        e = out[o.ym].setdefault(keys[o.vehicle_id], {})
        if o.article in rev:
            e[rev[o.article]] = (o.amount_gross_kop if o.vat_mode == 'gross' else o.amount_net_kop) / 100
            e['vat'], e['gross'] = o.vat_rate, o.vat_mode == 'gross'
    return out


def build_payload(db: Session, user: User) -> dict:
    ensure_current_period(db)
    s = ui_settings(db)
    vehicles = list(db.scalars(select(Vehicle)))
    keys = {v.id: v.key for v in vehicles}
    periods = {p.ym: p.status for p in db.scalars(select(Period))}
    open_yms = [ym for ym, st in periods.items() if st == 'open']
    analytics = user.role in ANALYTICS_ROLES

    out = {
        'generated': today().isoformat(),
        'me': {'login': user.login, 'name': user.full_name, 'role': user.role},
        'settings': s,
        'periods': periods,
        'vehicles': {v.key: vehicle_dict(v) for v in vehicles},
        'review': [{'id': r.id, 'kind': r.kind, 'value': r.value, 'where': r.where_text, 'action': r.action}
                   for r in db.scalars(select(ReviewItem).where(ReviewItem.resolved_at.is_(None)).order_by(ReviewItem.id))],
        'audit': [{'at': a.at.astimezone(ZoneInfo(cfg.timezone)).strftime('%d.%m.%Y, %H:%M'), 'who': a.user_name, 'entity': a.entity, 'car': a.entity_key,
                   'field': a.field, 'before': a.before, 'after': a.after}
                  for a in db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(300))][::-1],
        'input': input_entries(db, keys, list(periods) if analytics else open_yms),
        # аналитика — только владельцу и руководителю
        'profit': {}, 'shared': {}, 'bench': {}, 'fuel_month': {}, 'idle_hist': {}, 'textdic': [],
    }

    sched = defaultdict(list)
    rows = db.execute(select(ScheduleMonth).order_by(ScheduleMonth.ym, ScheduleMonth.id)).scalars()
    dic, idx = [], {}
    for r in rows:
        if not analytics:
            sched[r.ym].append({'k': keys[r.vehicle_id]})   # бухгалтеру — только состав машин месяца
            continue
        tx = None
        if r.ym.startswith(str(today().year)):
            tx = []
            for t in r.texts:
                if t is None:
                    tx.append(None)
                else:
                    if t not in idx:
                        idx[t] = len(dic)
                        dic.append(t)
                    tx.append(idx[t])
        sched[r.ym].append({'k': keys[r.vehicle_id], 'c': r.codes, 'tot': r.totals, 'calc': r.calc, 'tx': tx})
    out['schedule'] = [{'ym': ym, 'rows': rs, 'manual': any(x.get('tot') for x in rs)} for ym, rs in sched.items()]
    if not analytics:
        return out

    out['textdic'] = dic
    year = today().year
    months = [f'{year}-{i:02d}' for i in range(1, 13)]
    profit: dict = defaultdict(lambda: [None] * 12)
    shared: dict = {k: [None] * 12 for k in ('tractor', 'gen', 'service', 'amort', 'total')}
    for o in db.scalars(select(Operation).where(Operation.source == 'import', Operation.ym.in_(months))):
        i = months.index(o.ym)
        if o.article == 'profit_total':
            profit[keys[o.vehicle_id]][i] = o.amount_gross_kop / 100
        elif o.article in SHARED:
            shared[SHARED[o.article]][i] = o.amount_gross_kop / 100
    bench: dict = defaultdict(dict)
    for rv in db.scalars(select(ReferenceValue)):
        y, m = map(int, rv.ym.split('-'))
        if rv.metric == 'fleet_total' and y == year:
            shared['total'][m - 1] = float(rv.value)
        elif rv.metric == 'cost_per_km':
            bench[m].update(cost=float(rv.value), tax=rv.note == 'налоговая')
        elif rv.metric == 'rate_per_km':
            bench[m]['rate'] = float(rv.value)
    out['profit'], out['shared'], out['bench'] = dict(profit), shared, dict(bench)

    fm: dict = defaultdict(lambda: defaultdict(lambda: {'rn': 0.0, 'e100': 0.0, 'gl': 0.0, 'gl_days': 0, 'card_days': 0, 'anomaly': 0}))
    for f in db.scalars(select(FuelDay)):
        e = fm[f.date.strftime('%Y-%m')][keys[f.vehicle_id]]
        rn, e1, gl = float(f.rn_l), float(f.e100_l), float(f.glonass_l)
        e['rn'] += rn
        e['e100'] += e1
        e['card_days'] += 1 if rn or e1 else 0
        if gl > s['glonassMax']:      # больше порога за сутки — похоже, внесены километры
            e['anomaly'] += 1
        elif gl > 0:
            e['gl'] += gl
            e['gl_days'] += 1
    out['fuel_month'] = {ym: dict(v) for ym, v in fm.items()}
    out['idle_hist'] = {h.ym: [h.worked, h.no_driver, h.idle, h.planned, h.unplanned] for h in db.scalars(select(FleetDaysHistory))}
    return out
