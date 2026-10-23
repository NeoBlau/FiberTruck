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
    """Ввод по машинам (вручную и из шаблона) — суммы в том виде, в каком их вводили (с НДС или без)."""
    out: dict = defaultdict(dict)
    for m in db.scalars(select(Mileage).where(Mileage.ym.in_(yms))):
        e = out[m.ym].setdefault(keys[m.vehicle_id], {'amounts': {}})
        e['km'], e['days'] = m.km, m.worked_days
    for o in db.scalars(select(Operation).where(Operation.ym.in_(yms), Operation.source.in_(('manual', 'template')), Operation.vehicle_id.is_not(None))):
        e = out[o.ym].setdefault(keys[o.vehicle_id], {'amounts': {}})
        e['amounts'][o.article] = (o.amount_gross_kop if o.vat_mode == 'gross' else o.amount_net_kop) / 100
        e['vat'], e['gross'], e['source'] = o.vat_rate, o.vat_mode == 'gross', o.source
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
        'profit': {}, 'shared': {}, 'bench': {}, 'fuel_month': {}, 'idle_hist': {}, 'textdic': [], 'fin': {}, 'km': {}, 'profit_months': [],
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
    # месяцы отчётов: все 12 месяцев каждого года, по которому есть деньги или пробег (и текущего)
    hist_ops = list(db.scalars(select(Operation).where(Operation.source.in_(('import', 'upload')))))
    fin_ops = list(db.scalars(select(Operation).where(Operation.source.in_(('manual', 'template')))))
    refs = list(db.scalars(select(ReferenceValue)))
    km_rows = list(db.scalars(select(Mileage).where(Mileage.km.is_not(None))))
    years = {int(x.ym[:4]) for x in [*hist_ops, *fin_ops, *refs, *km_rows]} | {today().year}
    months = [f'{y}-{i:02d}' for y in sorted(years) for i in range(1, 13)]
    idx = {ym: i for i, ym in enumerate(months)}
    n = len(months)
    profit: dict = defaultdict(lambda: [None] * n)
    shared: dict = {k: [None] * n for k in ('tractor', 'gen', 'service', 'amort', 'total')}
    for o in hist_ops:
        if o.article == 'profit_total':
            profit[keys[o.vehicle_id]][idx[o.ym]] = o.amount_gross_kop / 100
        elif o.article in SHARED:
            shared[SHARED[o.article]][idx[o.ym]] = o.amount_gross_kop / 100
    bench: dict = defaultdict(dict)
    for rv in refs:
        if rv.metric == 'fleet_total':
            shared['total'][idx[rv.ym]] = float(rv.value)
        elif rv.metric == 'cost_per_km':
            bench[rv.ym].update(cost=float(rv.value), tax=rv.note == 'налоговая')
        elif rv.metric == 'rate_per_km':
            bench[rv.ym]['rate'] = float(rv.value)
    out['profit_months'] = months
    out['profit'], out['shared'], out['bench'] = dict(profit), shared, dict(bench)
    # введённые доходы и расходы по статьям (шаблон и ручной ввод): с НДС (g) и без (n), в рублях
    fin: dict = {}
    for o in fin_ops:
        f = fin.setdefault(o.ym, {'cars': {}, 'shared': {'g': {}, 'n': {}}})
        tgt = f['shared'] if o.vehicle_id is None else f['cars'].setdefault(keys[o.vehicle_id], {'g': {}, 'n': {}})
        tgt['g'][o.article] = tgt['g'].get(o.article, 0) + o.amount_gross_kop / 100
        tgt['n'][o.article] = tgt['n'].get(o.article, 0) + o.amount_net_kop / 100
    out['fin'] = fin
    km: dict = defaultdict(dict)
    for m in km_rows:
        km[m.ym][keys[m.vehicle_id]] = m.km
    out['km'] = dict(km)

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
