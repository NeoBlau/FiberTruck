import io

import openpyxl
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import FuelDay, Mileage, Operation, ScheduleMonth, Vehicle
from tests.conftest import login
from tests.test_monthly_fuel import monthly
from tests.test_uploads import filled_template, upload, own_template


def identity_rows():
    with SessionLocal() as db:
        return {model.__tablename__: [tuple(r) for r in db.execute(select(model.id,model.vehicle_id))]
                for model in (Mileage,Operation,ScheduleMonth,FuelDay)}


def test_rename_keeps_vehicle_id_and_all_history_and_reupload_rollback():
    c=login('admin')
    p=upload(c,filled_template(c,C3=10000,D3=1220000,F3=366000,R3=20)).json()
    assert c.post(f"/api/uploads/{p['id']}/apply").status_code==200
    fuel=upload(c,monthly(c,5000)).json()
    assert c.post(f"/api/uploads/{fuel['id']}/apply").status_code==200
    before=identity_rows()
    with SessionLocal() as db:
        vehicle_id=db.scalar(select(Vehicle.id).where(Vehicle.key=='885'))
    r=c.patch('/api/vehicles/885',json={'short':'0777 ф'})
    assert r.status_code==200,r.text
    assert r.json()['key']=='777Ф' and r.json()['name']=='777 Ф'
    assert r.json()['plate']=='Т885ВХ58' and r.json()['amort']==54000
    with SessionLocal() as db:
        assert db.scalar(select(Vehicle.id).where(Vehicle.key=='777Ф'))==vehicle_id
        assert db.scalar(select(Vehicle.id).where(Vehicle.key=='885')) is None
    assert identity_rows()==before
    d=c.get('/api/bootstrap').json()
    assert '885' not in d['vehicles'] and d['fin']['2026-10']['cars']['777Ф']['g']['revenue']==1220000
    assert d['km']['2026-10']['777Ф']==10000 and d['wdays']['2026-10']['777Ф']==20
    assert d['fuel_month']['2026-10']['777Ф']['monthly_liters']==5000
    assert d['profit']['777Ф'][7]==777123
    assert d['schedule'][0]['rows'][0]['k']=='777Ф'
    assert any(x['field']=='Короткий номер' and x['before']=='885' and x['after']=='777 Ф' for x in d['audit'])
    wb=openpyxl.load_workbook(io.BytesIO(c.get('/api/fuel-template/2026-10').content))
    s=wb.active; row=next(r for r in range(3,s.max_row+1) if s.cell(r,1).value=='777 Ф');s.cell(row,2,6000)
    b=io.BytesIO();wb.save(b)
    newfuel=upload(c,b.getvalue()).json()
    assert newfuel['can_apply']
    assert c.post(f"/api/uploads/{newfuel['id']}/apply").status_code==200
    assert c.post(f"/api/uploads/{newfuel['id']}/rollback").status_code==200
    assert c.post(f"/api/uploads/{fuel['id']}/rollback").status_code==200
    assert c.post(f"/api/uploads/{p['id']}/rollback").status_code==200
    assert '777Ф' in c.get('/api/bootstrap').json()['vehicles']


@pytest.mark.parametrize('value',['409','0409','', '1234','abc'])
def test_duplicate_or_invalid_number_does_not_change_vehicle(value):
    c=login('input')
    r=c.patch('/api/vehicles/885',json={'short':value})
    assert r.status_code==422 and 'short' in r.json()['detail']
    assert c.get('/api/bootstrap').json()['vehicles']['885']['plate']=='Т885ВХ58'


def test_leading_zero_same_number_is_allowed_and_review_tracks_new_name():
    c=login('input')
    assert c.patch('/api/vehicles/885',json={'short':'0885'}).status_code==200
    assert c.patch('/api/vehicles/409',json={'short':'043'}).json()['key']=='43'
    assert any(r['value']=='043' for r in c.get('/api/bootstrap').json()['review'])
    r=c.patch('/api/vehicles/43',json={'short':'044','plate':'А044АА58'})
    assert r.status_code==200
    assert not any(r['kind']=='Машина без госномера' for r in c.get('/api/bootstrap').json()['review'])


@pytest.mark.parametrize('kind',['finance','fuel'])
def test_pending_preview_is_cancelled_but_applied_data_keeps_history(kind):
    c=login('admin')
    p=upload(c,monthly(c) if kind=='fuel' else filled_template(c,D3=1220)).json()
    assert p['can_apply']
    r=c.patch('/api/vehicles/885',json={'short':'777'})
    assert r.status_code==200 and r.json()['discarded_previews']==1
    refused=c.post(f"/api/uploads/{p['id']}/apply")
    assert refused.status_code==409 and 'номер' in refused.json()['detail']
    assert '777' in c.get('/api/bootstrap').json()['vehicles']


def test_renamed_import_created_car_survives_upload_rollback():
    c=login('admin')
    wb=openpyxl.load_workbook(io.BytesIO(own_template()));wb.active['A3']='777';wb.active['B3']='А777АА58'
    buf=io.BytesIO();wb.save(buf)
    p=upload(c,buf.getvalue()).json()
    assert c.post(f"/api/uploads/{p['id']}/apply").status_code==200
    assert c.patch('/api/vehicles/777',json={'short':'778'}).status_code==200
    assert c.post(f"/api/uploads/{p['id']}/rollback").status_code==200
    assert '778' in c.get('/api/bootstrap').json()['vehicles']


def test_viewer_cannot_rename():
    assert login('viewer').patch('/api/vehicles/885',json={'short':'777'}).status_code==403
