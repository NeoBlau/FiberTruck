"""One fleet membership rule for input screens and both downloadable templates."""
import calendar
import datetime as dt
import re
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import FuelDay, Mileage, Operation, ScheduleMonth, Vehicle


def month_bounds(ym: str) -> tuple[dt.date, dt.date]:
    year, month = map(int, ym.split('-'))
    return dt.date(year, month, 1), dt.date(year, month, calendar.monthrange(year, month)[1])


def month_vehicle_map(db: Session, months: list[str]) -> dict[str, list[str]]:
    """Dates bound membership; unknown retirement dates fall back to recorded facts.

    'in_service_to' is the first day out of service. A vehicle retiring on the
    first of a month is excluded from that month. No dates are inferred/written.
    """
    if not months:
        return {}
    months = sorted(set(months))
    vehicles = sorted(db.scalars(select(Vehicle)), key=lambda v: (int(re.match(r'\d+', v.key).group()), v.key))
    facts = defaultdict(set)
    for model in (ScheduleMonth, Mileage, Operation):
        for ym, vid in db.execute(select(model.ym, model.vehicle_id).where(model.ym.in_(months), model.vehicle_id.is_not(None))):
            facts[ym].add(vid)
    first, _ = month_bounds(months[0])
    _, last = month_bounds(months[-1])
    for date, vid in db.execute(select(FuelDay.date, FuelDay.vehicle_id).where(FuelDay.date >= first, FuelDay.date <= last)):
        facts[date.strftime('%Y-%m')].add(vid)
    out = {}
    for ym in months:
        start, end = month_bounds(ym)
        out[ym] = []
        for v in vehicles:
            if v.in_service_from and v.in_service_to and v.in_service_from >= v.in_service_to:
                continue
            if v.in_service_from and v.in_service_from > end:
                continue
            if v.in_service_to and v.in_service_to <= start:
                continue
            if v.is_active or v.in_service_to is not None or v.id in facts[ym]:
                out[ym].append(v.key)
    return out


def month_vehicle_keys(db: Session, ym: str) -> list[str]:
    return month_vehicle_map(db, [ym])[ym]
