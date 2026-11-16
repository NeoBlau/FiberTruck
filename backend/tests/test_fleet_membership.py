import datetime as dt
import io

import openpyxl
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import FuelDay, Operation, Vehicle
from tests.conftest import login


def template_names(c, ym, fuel=False):
    r = c.get(f"/api/{'fuel-template' if fuel else 'template'}/{ym}")
    assert r.status_code == 200, r.text
    w = openpyxl.load_workbook(io.BytesIO(r.content))
    names = {v['name'] for v in c.get('/api/bootstrap').json()['vehicles'].values()}
    return [str(w.active.cell(r, 1).value) for r in range(3, w.active.max_row + 1)
            if str(w.active.cell(r, 1).value) in names]


def same(c, ym):
    names = template_names(c, ym)
    assert names == template_names(c, ym, True)
    return names


def test_imported_active_vehicle_not_in_schedule_is_in_both_templates_and_input():
    c = login('admin')
    assert same(c, '2026-10') == ['409', '885']
    assert c.get('/api/bootstrap').json()['month_vehicles']['2026-10'] == ['409', '885']
    b = login('input').get('/api/bootstrap').json()
    assert b['month_vehicles']['2026-10'] == ['409', '885']
    assert '2026-08' not in b['month_vehicles']


@pytest.mark.parametrize('ym,expected', [('2026-08',False),('2026-09',True),('2026-10',True),('2026-11',False)])
def test_dates_include_part_of_month_and_exclude_month_of_retirement_first_day(ym, expected):
    c = login('admin')
    with SessionLocal() as db:
        v=db.scalar(select(Vehicle).where(Vehicle.key=='409'))
        v.in_service_from=dt.date(2026,9,15)
        v.in_service_to=dt.date(2026,11,1)
        v.is_active=False
        db.commit()
    assert ('409' in same(c, ym)) == expected


def test_mid_month_retirement_and_future_entry():
    c=login('admin')
    with SessionLocal() as db:
        v=db.scalar(select(Vehicle).where(Vehicle.key=='409'))
        v.is_active=False;v.in_service_to=dt.date(2026,10,15)
        db.add(Vehicle(key='777',name='777',is_active=True,in_service_from=dt.date(2027,1,1)))
        db.commit()
    assert '409' in same(c,'2026-10') and '409' not in same(c,'2026-11')
    assert '777' not in same(c,'2026-12') and '777' in same(c,'2027-01')
    assert '777' not in c.get('/api/bootstrap').json()['month_vehicles']['2026-12']
    assert '777' in c.get('/api/bootstrap').json()['month_vehicles']['2027-01']


def test_inactive_without_dates_uses_month_facts_without_rewriting_them():
    c=login('admin')
    with SessionLocal() as db:
        for v in db.scalars(select(Vehicle)): v.is_active=False
        v=db.scalar(select(Vehicle).where(Vehicle.key=='409'))
        db.add(FuelDay(vehicle_id=v.id,date=dt.date(2026,9,1),rn_l=100,e100_l=0,glonass_l=0))
        db.commit()
        before=[(o.id,o.amount_gross_kop) for o in db.scalars(select(Operation))]
    assert same(c,'2026-08') == ['885']  # archived profit
    assert same(c,'2026-09') == ['409']  # archived fuel
    assert same(c,'2026-10') == ['885']  # actual schedule, not last schedule fallback
    assert same(c,'2026-11') == []
    with SessionLocal() as db:
        assert [(o.id,o.amount_gross_kop) for o in db.scalars(select(Operation))] == before


def test_manual_add_edit_and_deactivate_refresh_both_downloads():
    c=login('admin')
    assert c.post('/api/vehicles',json={'short':'777','plate':'А777АА58','active':True,'from':'2026-09-01'}).status_code==200
    assert '777' in same(c,'2026-10')
    before=c.get('/api/template/2026-10').content
    assert c.patch('/api/vehicles/777',json={'plate':'В777ВВ58','active':False,'from':'2026-09-01','to':'2026-11-01'}).status_code==200
    assert '777' in same(c,'2026-10') and '777' not in same(c,'2026-11')
    new=openpyxl.load_workbook(io.BytesIO(c.get('/api/template/2026-10').content)).active
    old=openpyxl.load_workbook(io.BytesIO(before)).active
    row=next(r for r in range(3,new.max_row+1) if new.cell(r,1).value=='777')
    assert new.cell(row,2).value=='В777ВВ58' and old.cell(row,2).value=='А777АА58'


def test_zero_day_service_interval_is_not_in_templates():
    c=login('admin')
    with SessionLocal() as db:
        v=db.scalar(select(Vehicle).where(Vehicle.key=='409'))
        v.in_service_from=v.in_service_to=dt.date(2026,10,15)
        db.commit()
    assert '409' not in same(c,'2026-10')
