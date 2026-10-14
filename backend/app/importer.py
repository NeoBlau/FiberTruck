"""Импорт истории из xlsx заказчика в базу. Повторный запуск заменяет импортированное и не трогает
правки, сделанные в программе: справочник машин, ручной ввод, статусы месяцев."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import (FleetDaysHistory, FuelDay, Operation, Period, ReferenceValue, ReviewItem, ScheduleMonth, Vehicle)
from .parsing import parse_sources

SHARED_ARTICLES = {'tractor': 'shared_tractor', 'gen': 'shared_gen', 'service': 'shared_service', 'amort': 'shared_amort'}
PROFIT_YEAR = 2026
VEHICLE_FIELDS = ('plate', 'make', 'model', 'year', 'tacho', 'trailer', 'trailer_model', 'trailer_year')


def kop(rub) -> int:
    return int(round(Decimal(str(rub)) * 100))


def import_history(db: Session, profit_path: str, park_path: str) -> dict:
    src = parse_sources(profit_path, park_path)

    # --- машины: обновляем из файла только то, что не правили в программе
    existing = {v.key: v for v in db.scalars(select(Vehicle))}
    plates_taken = {v.plate for v in existing.values() if v.plate}
    for key, info in src['vehicles'].items():
        v = existing.get(key)
        if v is None:
            v = Vehicle(key=key, name=info['name'], is_active=not info.get('history_only'), history_only=bool(info.get('history_only')))
            db.add(v)
            existing[key] = v
        if v.edited:
            continue
        for f in VEHICLE_FIELDS:
            val = info.get(f)
            if f == 'plate' and val and val in plates_taken and v.plate != val:
                val = None  # тот же госномер уже у другой машины — не перезаписываем, пусть разберут вручную
            setattr(v, f, val)
        if v.plate:
            plates_taken.add(v.plate)
        v.odo_km = info.get('odo')
        if info.get('amort') is not None:
            v.amort_kop = kop(info['amort'])
    db.flush()
    vid = {k: v.id for k, v in existing.items()}

    # --- импортированные факты заменяем целиком
    db.execute(delete(ScheduleMonth))
    db.execute(delete(Operation).where(Operation.source == 'import'))
    db.execute(delete(FuelDay))
    db.execute(delete(FleetDaysHistory))
    db.execute(delete(ReferenceValue))
    db.execute(delete(ReviewItem).where(ReviewItem.resolved_at.is_(None)))

    for m in src['schedule']:
        for r in m['rows']:
            db.add(ScheduleMonth(ym=m['ym'], vehicle_id=vid[r['k']], codes=r['c'], texts=r['tx'], totals=r['tot'], calc=r['calc'], source_row=r['row']))

    months = [f'{PROFIT_YEAR}-{i:02d}' for i in range(1, 13)]
    profit_months = set()
    for key, vals in src['profit'].items():
        for ym, val in zip(months, vals):
            if val is not None:
                db.add(Operation(ym=ym, vehicle_id=vid[key], article='profit_total', amount_gross_kop=kop(val), amount_net_kop=kop(val),
                                 vat_kop=0, vat_rate=None, vat_mode='unknown', source='import'))
    for name, article in SHARED_ARTICLES.items():
        for ym, val in zip(months, src['shared'].get(name) or []):
            if val is not None:
                db.add(Operation(ym=ym, vehicle_id=None, article=article, amount_gross_kop=kop(val), amount_net_kop=kop(val),
                                 vat_kop=0, vat_rate=None, vat_mode='unknown', source='import'))
                if name == 'gen':
                    profit_months.add(ym)
    for ym, val in zip(months, src['shared'].get('total') or []):
        if val is not None and ym in profit_months:
            db.add(ReferenceValue(ym=ym, metric='fleet_total', value=Decimal(val), note='строка «Общий» таблицы прибыли'))
    for month, b in src['bench'].items():
        ym = f'{PROFIT_YEAR}-{int(month):02d}'
        if 'cost' in b:
            db.add(ReferenceValue(ym=ym, metric='cost_per_km', value=Decimal(str(b['cost'])), note='налоговая' if b.get('tax') else None))
        if 'rate' in b:
            db.add(ReferenceValue(ym=ym, metric='rate_per_km', value=Decimal(str(b['rate']))))

    fuel_rows = 0
    for key, days in src['fuel_daily'].items():
        for d, (rn, e1, gl) in days.items():
            db.add(FuelDay(vehicle_id=vid[key], date=dt.date.fromisoformat(d), rn_l=Decimal(str(rn)), e100_l=Decimal(str(e1)), glonass_l=Decimal(str(gl))))
            fuel_rows += 1

    for ym, (w, nd, idle, pl, unpl) in src['idle_hist'].items():
        db.add(FleetDaysHistory(ym=ym, worked=w, no_driver=nd, idle=idle, planned=pl, unplanned=unpl))

    for r in src['review']:
        db.add(ReviewItem(kind=r['kind'], value=r['value'], where_text=r['where'], action=r['action']))

    # --- месяцы с внесённой прибылью закрываем, если владелец ещё не менял их статус
    known = {p.ym for p in db.scalars(select(Period))}
    for ym in sorted(profit_months):
        if ym not in known:
            db.add(Period(ym=ym, status='closed'))
    for m in src['schedule']:
        if m['ym'] >= f'{PROFIT_YEAR}-01' and m['ym'] not in profit_months and m['ym'] not in known:
            db.add(Period(ym=m['ym'], status='open'))
    db.commit()
    return {'машин': len(src['vehicles']), 'месяцев графика': len(src['schedule']), 'месяцев прибыли': len(profit_months),
            'дней заправок': fuel_rows, 'на проверку': len(src['review'])}
