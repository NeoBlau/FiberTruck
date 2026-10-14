"""Цифры на реальных файлах заказчика. Файлы в репозиторий не кладутся:
FT_TEST_PROFIT=…/прибыль_по_машинам.xlsx FT_TEST_PARK=…/парк.xlsx pytest"""
import os

import pytest
from sqlalchemy import func, select

from app.db import SessionLocal
from app.importer import import_history
from app.models import FleetDaysHistory, Operation, ReferenceValue, ScheduleMonth, Vehicle

PROFIT, PARK = os.environ.get('FT_TEST_PROFIT'), os.environ.get('FT_TEST_PARK')
pytestmark = pytest.mark.skipif(not (PROFIT and PARK), reason='не заданы пути к файлам заказчика')


@pytest.fixture
def imported():
    with SessionLocal() as db:
        import_history(db, PROFIT, PARK)
        yield db


def test_cars_plus_shared_equals_owner_total(imported):
    db = imported
    for ym, ref in db.execute(select(ReferenceValue.ym, ReferenceValue.value).where(ReferenceValue.metric == 'fleet_total')):
        total = db.scalar(select(func.sum(Operation.amount_gross_kop)).where(Operation.ym == ym, Operation.source == 'import'))
        assert total == int(ref * 100), ym
    assert db.scalar(select(ReferenceValue.value).where(ReferenceValue.ym == '2026-08', ReferenceValue.metric == 'fleet_total')) == 11_339_347


def test_worked_days_match_idle_analysis_except_two_known_months(imported):
    db = imported
    bad = []
    for h in db.scalars(select(FleetDaysHistory)):
        rows = list(db.scalars(select(ScheduleMonth).where(ScheduleMonth.ym == h.ym)))
        if not rows or not any(r.totals for r in rows):
            continue
        worked = sum((r.totals or {}).get('worked', 0) for r in rows)
        if worked != h.worked:
            bad.append((h.ym, worked, h.worked))
    assert bad == [('2025-01', 819, 820), ('2025-06', 771, 780)]


def test_august_fleet_utilisation(imported):
    rows = list(imported.scalars(select(ScheduleMonth).where(ScheduleMonth.ym == '2026-08')))
    assert sum(r.totals['worked'] for r in rows) == 712 and len(rows) * 31 == 1767


def test_twins_and_leading_zeros_matched(imported):
    plates = {v.key: v.plate for v in imported.scalars(select(Vehicle))}
    assert plates['20М'] == 'С020ВТ58' and plates['20Ф'] == 'У020РК58'
    assert plates['308М'] == 'С308УА58' and plates['308Д'] == 'Е308МО164'
    assert plates['78'] == 'Т078ОУ58' and plates['970'] == 'Т970ОН58'
    assert plates['409'] is None    # нет в «АВТО» — не угадываем


def test_reimport_is_idempotent(imported):
    db = imported
    n = db.scalar(select(func.count()).select_from(Operation))
    import_history(db, PROFIT, PARK)
    assert db.scalar(select(func.count()).select_from(Operation)) == n
