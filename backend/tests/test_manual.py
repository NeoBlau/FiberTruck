"""Direct owner edits preserve other data, support exact undo and reject stale forms."""
import datetime as dt
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import FuelDay, Mileage, Operation, Upload, Vehicle
from app.uploads import row_to_dict
from tests.conftest import login


def state(c, ym='2026-10'):
    response=c.get('/api/manual/'+ym)
    assert response.status_code==200,response.text
    return response.json()


def write(c, kind, value, key='885', ym='2026-10', **extra):
    s=state(c,ym)
    collection='shared' if kind=='shared' else kind
    return c.put(f'/api/manual/{ym}/{kind}/{key}',json={'expected':s[collection][key]['version'],**value,**extra})


def snap():
    with SessionLocal() as db:
        return {m.__tablename__:[row_to_dict(r) for r in db.scalars(select(m).order_by(m.id))] for m in [FuelDay,Operation,Mileage,Vehicle]}


def test_finance_fuel_shared_recompute_and_undo_in_reverse():
    c=login('admin');before=snap()
    f=write(c,'finance',{'entry':{'km':10000,'days':20,'amounts':{'revenue':500000,'fuel':120000},'vat':'22%','gross':True}})
    assert f.status_code==200,f.text
    l=write(c,'fuel',{'value':'3000.125'});assert l.status_code==200,l.text
    sh=write(c,'shared',{'value':'10000.01','vat':'22%','gross':True},key='shared_gen');assert sh.status_code==200,sh.text
    d=c.get('/api/bootstrap').json()
    assert d['input']['2026-10']['885']['source']=='manual'
    assert d['fin']['2026-10']['shared']['g']['shared_gen']==10000.01
    assert d['fuel_month']['2026-10']['885']['monthly_liters']==3000.125
    row=next(r for r in d['fuel_stats']['2026-10']['rows'] if r['key']=='885')
    assert row['rate']==pytest.approx(30.00125) and row['cost']==120000
    assert len(state(c)['history'])==3
    assert any(a['entity']=='manual' and '3000.125' in a['after'] for a in d['audit'])
    input_client=login('input')
    assert not any(a['entity']=='manual' for a in input_client.get('/api/bootstrap').json()['audit'])
    assert not any(u['id'] in [f.json()['upload_id'],l.json()['upload_id'],sh.json()['upload_id']] for u in input_client.get('/api/uploads').json())
    for res in [sh,l,f]:
        r=c.post(f"/api/uploads/{res.json()['upload_id']}/rollback");assert r.status_code==200,r.text
    assert snap()==before


@pytest.mark.parametrize('kind,key,payload',[('finance','885',{'entry':{'km':100}}),('fuel','885',{'value':'100'}),('shared','shared_gen',{'value':'100'})])
def test_closed_month_rejects_without_any_change(kind,key,payload):
    c=login('admin');before=snap()
    r=write(c,kind,payload,key=key,ym='2026-08')
    assert r.status_code==409 and snap()==before


def test_stale_edit_rejected_without_overwriting_and_undo_does_not_clobber_later_edit():
    c=login('admin');s=state(c);old=s['fuel']['885']['version']
    first=write(c,'fuel',{'value':100}).json()['upload_id']
    r=c.put('/api/manual/2026-10/fuel/885',json={'expected':old,'value':200})
    assert r.status_code==409 and state(c)['fuel']['885']['liters']==100
    assert write(c,'fuel',{'value':300}).status_code==200
    assert c.post(f'/api/uploads/{first}/rollback').status_code==409
    assert state(c)['fuel']['885']['liters']==300


def test_fuel_conversion_preserves_daily_snapshot_and_other_vehicle():
    c=login('admin')
    with SessionLocal() as db:
        ids={v.key:v.id for v in db.scalars(select(Vehicle))}
        db.add_all([FuelDay(vehicle_id=ids['885'],date=dt.date(2026,10,2),rn_l=100,e100_l=50,glonass_l=140),
                    FuelDay(vehicle_id=ids['409'],date=dt.date(2026,10,2),rn_l=999)])
        db.commit()
    before=snap();assert state(c)['fuel']['885']['daily']
    r=write(c,'fuel',{'value':'234.567'});assert r.status_code==200,r.text
    assert not state(c)['fuel']['885']['daily']
    assert state(c)['fuel']['409']['liters']==999
    assert c.post(f"/api/uploads/{r.json()['upload_id']}/rollback").status_code==200
    assert snap()==before


def test_zero_and_clear_are_distinct_and_shared_can_be_income():
    c=login('admin')
    assert write(c,'fuel',{'value':0}).status_code==200
    assert state(c)['fuel']['885']['liters']==0
    assert write(c,'fuel',{'value':None}).status_code==200
    assert state(c)['fuel']['885']['liters'] is None
    assert write(c,'shared',{'value':'-100.22'},key='shared_tractor').status_code==200
    assert state(c)['shared']['shared_tractor']['amount']==-100.22
    clear=write(c,'shared',{'value':None},key='shared_tractor');assert clear.status_code==200
    assert state(c)['shared']['shared_tractor']['amount'] is None


@pytest.mark.parametrize('kind,payload',[('fuel',{'value':-1}),('fuel',{'value':'1.0001'}),('fuel',{'value':1000001}),('shared',{'value':'NaN'}),('shared',{'value':'1.001'}),('finance',{'entry':{'days':32}}),('finance',{'entry':{'amounts':{'fuel':-5}}})])
def test_invalid_values_do_not_change_data(kind,payload):
    c=login('admin');before=snap()
    key='shared_gen' if kind=='shared' else '885'
    r=write(c,kind,payload,key=key)
    assert r.status_code==422,r.text
    assert snap()==before


def test_missing_value_field_cannot_accidentally_clear_fuel():
    c=login('admin')
    assert write(c,'fuel',{'value':123}).status_code==200
    r=c.put('/api/manual/2026-10/fuel/885',json={'expected':state(c)['fuel']['885']['version']})
    assert r.status_code==422 and state(c)['fuel']['885']['liters']==123


def test_changing_one_financial_field_preserves_other_prefilled_values():
    c=login('admin')
    assert write(c,'finance',{'entry':{'km':10000,'days':15,'amounts':{'revenue':123456.78,'fuel':22222.22,'salary':11111.11},'vat':'22%','gross':False,'document':'Акт 741'}}).status_code==200
    before=snap();s=state(c);e=s['finance']['885']['entry']
    changed={'km':10001,'days':e['days'],'amounts':e['amounts'],'vat':e['vat'],'gross':e['gross'],'document':'; '.join(e['documents'])}
    r=c.put('/api/manual/2026-10/finance/885',json={'expected':s['finance']['885']['version'],'entry':changed})
    assert r.status_code==200,r.text
    after=snap()
    def amounts(snapshot):
        return sorted((r['vehicle_id'] or 0,r['ym'],r['article'],str(r['amount_gross_kop']),str(r['amount_net_kop']),str(r['vat_kop']),r['vat_rate'],r['vat_mode'],r['document']) for r in snapshot['operations'])
    assert amounts(before)==amounts(after)
    assert state(c)['finance']['885']['entry']['days']==15
    assert state(c)['finance']['885']['entry']['km']==10001
    assert before['fuel_days']==after['fuel_days']
    assert c.post(f"/api/uploads/{r.json()['upload_id']}/rollback").status_code==200
    assert snap()==before
