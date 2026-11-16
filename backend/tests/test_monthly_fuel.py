import datetime as dt
import io

import openpyxl
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import FuelDay, Operation, Vehicle
from tests.conftest import login
from tests.test_uploads import upload


def monthly(c, value=5000.125, ym='2026-10', duplicate=False):
    w = openpyxl.load_workbook(io.BytesIO(c.get(f'/api/fuel-template/{ym}').content))
    s=w['Анализ ЗАПРАВОК']
    row=next(r for r in range(3,s.max_row+1) if s.cell(r,1).value=='885')
    s.cell(row,2).value=value
    if duplicate:s.append(['885',10])
    b=io.BytesIO();w.save(b)
    return b.getvalue()


def test_monthly_replaces_only_filled_car_and_preserves_finances_and_rollback():
    c,a=login('input'),login('admin')
    with SessionLocal() as db:
        ids={v.key:v.id for v in db.scalars(select(Vehicle))}
        db.add_all([FuelDay(vehicle_id=ids['885'],date=dt.date(2026,10,d),rn_l=100,e100_l=20,glonass_l=110) for d in (1,2)])
        db.add(FuelDay(vehicle_id=ids['409'],date=dt.date(2026,10,1),rn_l=77,e100_l=0,glonass_l=75))
        db.add(FuelDay(vehicle_id=ids['885'],date=dt.date(2026,9,1),rn_l=99,e100_l=0,glonass_l=90))
        db.commit()
        before_ops=[(o.id,o.amount_gross_kop) for o in db.scalars(select(Operation))]
    first=upload(c,monthly(c)).json()
    assert first['can_apply'] and first['months']==['2026-10']
    section=first['sections'][0]
    assert section['title']=='Топливо за месяц' and len(section['columns'])==3
    assert '5\xa0000,125' in section['rows'][0]['cells'][2]
    assert c.post(f"/api/uploads/{first['id']}/apply").status_code==200
    data=a.get('/api/bootstrap').json()['fuel_month']
    assert data['2026-10']['885']['monthly_liters']==5000.125
    assert data['2026-10']['885']['rn']==0 and data['2026-10']['885']['anomaly']==0
    assert data['2026-10']['885']['card_days']==0
    assert data['2026-10']['409']['rn']==77 and data['2026-09']['885']['rn']==99
    with SessionLocal() as db:
        assert [(o.id,o.amount_gross_kop) for o in db.scalars(select(Operation))]==before_ops
    second=upload(c,monthly(c,6000)).json()
    assert c.post(f"/api/uploads/{second['id']}/apply").status_code==200
    assert a.get('/api/bootstrap').json()['fuel_month']['2026-10']['885']['monthly_liters']==6000
    assert a.post(f"/api/uploads/{second['id']}/rollback").status_code==200
    assert a.get('/api/bootstrap').json()['fuel_month']['2026-10']['885']['monthly_liters']==5000.125
    assert a.post(f"/api/uploads/{first['id']}/rollback").status_code==200
    data=a.get('/api/bootstrap').json()['fuel_month']['2026-10']['885']
    assert 'monthly_liters' not in data and data['rn']==200 and data['gl']==220


@pytest.mark.parametrize('value',[-1,'не число',True,'NaN',0.0001,1000001])
def test_invalid_monthly_liters(value):
    c=login('input')
    assert upload(c,monthly(c,value)).status_code==422


def test_monthly_empty_zero_duplicate_and_closed():
    c=login('input')
    assert not upload(c,monthly(c,None)).json()['can_apply']
    assert not upload(c,monthly(c,10,ym='2026-08')).json()['can_apply']
    assert upload(c,monthly(c,duplicate=True)).status_code==422
    p=upload(c,monthly(c,0)).json()
    assert p['can_apply']
    assert c.post(f"/api/uploads/{p['id']}/apply").status_code==200
    assert login('admin').get('/api/bootstrap').json()['fuel_month']['2026-10']['885']['monthly_liters']==0
    assert c.get('/api/bootstrap').json()['fuel_month']=={}


def test_old_partial_daily_upload_cannot_mix_into_monthly_total():
    from tests.test_fuel_template import filled
    c=login('input')
    p=upload(c,monthly(c,'5 000,125')).json()
    assert c.post(f"/api/uploads/{p['id']}/apply").status_code==200
    r=upload(c,filled(c))
    assert r.status_code==422 and 'месячный итог' in r.json()['detail']
    assert login('admin').get('/api/bootstrap').json()['fuel_month']['2026-10']['885']['monthly_liters']==5000.125
