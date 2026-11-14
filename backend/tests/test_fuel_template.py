import datetime as dt
import io
from decimal import Decimal

import openpyxl
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import FuelDay, Operation, Vehicle
from tests.conftest import login
from tests.test_uploads import upload


def filled(client, ym='2026-10', values=(100.125, 20, 115), date=None):
    response = client.get(f'/api/fuel-template/{ym}')
    assert response.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(response.content))
    ws = wb['Анализ ЗАПРАВОК']
    row = next(r for r in range(3, ws.max_row + 1) if str(ws.cell(r, 2).value) == '885')
    for c, value in enumerate(values, 4):
        ws.cell(row, c).value = value
    if date is not None:
        ws.cell(row, 1, date)
    data = io.BytesIO()
    wb.save(data)
    return data.getvalue()


def test_download_is_prefilled_with_dates_vehicles_and_liter_columns():
    c = login('input')
    wb = openpyxl.load_workbook(io.BytesIO(c.get('/api/fuel-template/2026-08').content))
    ws = wb['Анализ ЗАПРАВОК']
    assert wb['_ft_fuel']['A2'].value == '2026-08'
    assert ws.max_row == 64  # two vehicles, 31 days, two header rows
    assert [ws.cell(2, c).value for c in range(1, 7)] == ['Дата', 'Машина', 'Госномер', 'РН, л', 'Е100, л', 'ГЛОНАСС, л']
    assert all(ws.cell(r, 1).value.month == 8 for r in range(3, ws.max_row + 1))
    assert set(ws.cell(r, 2).value for r in range(3, ws.max_row + 1)) == {'409', '885'}
    assert all(ws.cell(r, c).value is None for r in range(3, ws.max_row + 1) for c in range(4, 7))
    assert c.get('/api/fuel-template/2026-99').status_code == 422


def test_upload_replaces_only_filled_days_and_rolls_back():
    c, owner = login('input'), login('admin')
    with SessionLocal() as db:
        ids = {v.key: v.id for v in db.scalars(select(Vehicle))}
        db.add_all([
            FuelDay(vehicle_id=ids['885'], date=dt.date(2026, 10, 1), rn_l=10, e100_l=1, glonass_l=9),
            FuelDay(vehicle_id=ids['885'], date=dt.date(2026, 10, 2), rn_l=30, e100_l=0, glonass_l=29),
            FuelDay(vehicle_id=ids['409'], date=dt.date(2026, 10, 1), rn_l=40, e100_l=0, glonass_l=39),
        ])
        db.commit()
        before_ops = [(o.id, o.amount_gross_kop) for o in db.scalars(select(Operation))]
    preview = upload(c, filled(c)).json()
    assert preview['kind'] == 'park' and preview['can_apply'] and preview['months'] == ['2026-10']
    assert 'только заполненные' in preview['sections'][0]['rows'][0]['note']
    assert preview['sections'][0]['rows'][0]['cells'][2:4] == ['120,125\xa0л', '115,000\xa0л']
    assert c.post(f"/api/uploads/{preview['id']}/apply").status_code == 200
    with SessionLocal() as db:
        facts = {(f.vehicle_id, f.date.day): (f.rn_l, f.e100_l, f.glonass_l) for f in db.scalars(select(FuelDay))}
        assert facts[(ids['885'], 1)] == (Decimal('100.125'), Decimal('20'), Decimal('115'))
        assert facts[(ids['885'], 2)][0] == 30 and facts[(ids['409'], 1)][0] == 40
        assert len(facts) == 3
        assert [(o.id, o.amount_gross_kop) for o in db.scalars(select(Operation))] == before_ops
    data = owner.get('/api/bootstrap').json()['fuel_month']['2026-10']['885']
    assert data['rn'] == 130.125 and data['e100'] == 20 and data['gl'] == 144
    assert c.get('/api/bootstrap').json()['fuel_month'] == {}
    assert owner.post(f"/api/uploads/{preview['id']}/rollback").status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(FuelDay.rn_l).where(FuelDay.vehicle_id == ids['885'], FuelDay.date == dt.date(2026, 10, 1))) == 10


@pytest.mark.parametrize('values,date', [((-1, None, None), None), (('много', None, None), None), ((0.0001,None,None),None), ((10,None,None),dt.datetime(2026,9,1))])
def test_bad_liters_or_wrong_month_do_not_apply(values, date):
    r = upload(login('input'), filled(login('input'), values=values, date=date))
    assert r.status_code == 422


def test_blank_and_closed_templates_do_not_write_and_zero_is_explicit():
    c = login('input')
    empty = upload(c, filled(c, values=(None,None,None))).json()
    assert not empty['can_apply'] and 'нет заполненных' in ' '.join(empty['sections'][0]['notes'])
    closed = upload(c, filled(c, ym='2026-08')).json()
    assert not closed['can_apply']
    zero = upload(c, filled(c, values=(0,None,None))).json()
    assert zero['can_apply']
    assert c.post(f"/api/uploads/{zero['id']}/apply").status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(FuelDay.rn_l)) == 0


def test_legacy_fuel_workbook_still_imports():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Анализ ЗАПРАВОК'
    ws.append(['885', None, None, None, None, '409'])
    ws.append(['Дата', 'РН', 'Е100', 'ГЛОНАСС', None, 'Дата', 'РН', 'Е100', 'ГЛОНАСС'])
    ws.append([dt.datetime(2026,10,1), 100,20,115,None,dt.datetime(2026,10,1),50,0,49])
    buf = io.BytesIO()
    wb.save(buf)
    c = login('input')
    preview = upload(c,buf.getvalue()).json()
    assert preview['can_apply']
    assert c.post(f"/api/uploads/{preview['id']}/apply").status_code == 200
    result = login('admin').get('/api/bootstrap').json()['fuel_month']['2026-10']
    assert result['885']['rn'] == 100 and result['409']['gl'] == 49
