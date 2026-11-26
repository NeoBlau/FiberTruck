"""A car appended below the shared-expense/footer rows must not disappear."""
import io

import openpyxl
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Mileage, Operation, Vehicle
from app.reviewed_package import process_package, seal_package
from tests.conftest import login
from tests.test_uploads import upload


def save(wb):
    stream = io.BytesIO()
    wb.save(stream)
    return stream.getvalue()


def source(c):
    wb = openpyxl.load_workbook(io.BytesIO(c.get('/api/template/2026-09').content))
    sheet = wb.active
    r = next(r for r in range(3, sheet.max_row + 1) if str(sheet.cell(r, 1).value) == '885')
    sheet.cell(r, 3, 2222)
    sheet.cell(r, 4, 100000)
    shared = next(r for r in range(3, sheet.max_row + 1) if sheet.cell(r, 1).value == 'Общехоз')
    sheet.cell(shared, 3, 2500)
    values = ['741', 'У741ОВ58', '=1000+234', 50000, None, 10000] + [None] * 11 + [5, '22%', 'да', None]
    return wb, values


@pytest.mark.parametrize('known', [True, False])
def test_append_741_after_footer_is_previewed_and_applied_by_identity(known):
    c = login('admin')
    wb, values = source(c)  # saved before 741 was registered
    if known:
        with SessionLocal() as db:
            db.add(Vehicle(key='741', name='741', plate='У741ОВ58', is_active=True))
            db.commit()
    wb.active.append(values)
    p = upload(c, save(wb)).json()
    row = next(r for r in p['sections'][0]['rows'] if r['cells'][0] == '741')
    assert row['status'] in ('ok', 'warn'), row
    assert p['can_apply']
    assert c.post(f"/api/uploads/{p['id']}/apply").status_code == 200
    with SessionLocal() as db:
        ids = {v.key: v.id for v in db.scalars(select(Vehicle))}
        assert db.scalar(select(Mileage.km).where(Mileage.ym == '2026-09', Mileage.vehicle_id == ids['741'])) == 1234
        assert db.scalar(select(Mileage.km).where(Mileage.ym == '2026-09', Mileage.vehicle_id == ids['885'])) == 2222
        assert db.scalar(select(Operation.amount_gross_kop).where(Operation.ym == '2026-09', Operation.vehicle_id == ids['741'], Operation.article == 'fuel')) == 1000000
        assert db.scalar(select(Operation.amount_gross_kop).where(Operation.ym == '2026-09', Operation.vehicle_id.is_(None), Operation.article == 'shared_gen')) == 250000
    assert c.post(f"/api/uploads/{p['id']}/rollback").status_code == 200
    with SessionLocal() as db:
        assert not db.scalar(select(Mileage.id).where(Mileage.ym == '2026-09'))


def test_new_active_741_registered_in_october_is_listed_in_fresh_september_templates():
    c = login('admin')
    with SessionLocal() as db:
        db.add(Vehicle(key='741', name='741', plate='У741ОВ58', is_active=True))
        db.commit()
    for route in ('template', 'fuel-template'):
        wb = openpyxl.load_workbook(io.BytesIO(c.get(f'/api/{route}/2026-09').content))
        assert sum(str(r[0]).strip() == '741' for r in wb.active.values) == 1
    assert '741' in c.get('/api/bootstrap').json()['month_vehicles']['2026-09']


def test_appended_duplicate_of_filled_vehicle_is_an_error():
    c = login('admin')
    wb, values = source(c)
    values[0:2] = ['885', 'Т885ВХ58']
    wb.active.append(values)
    p = upload(c, save(wb)).json()
    assert any(r['status'] == 'error' and 'повторяется' in r['note'] for r in p['sections'][0]['rows'])


def test_package_accepts_appended_vehicle_and_rollback_is_complete(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'upload_dir', str(tmp_path / 'uploads'))
    c = login('admin')
    wb, values = source(c)
    wb.active.append(values)
    key = Fernet.generate_key()
    path = tmp_path / 'appended.ftpack'
    path.write_bytes(seal_package([('financial', '2026-09', 'Сентябрь.xlsx', save(wb))], key))
    result = process_package(path, key, apply=True)
    assert result['files'][0]['vehicles'] == 3
    with SessionLocal() as db:
        vid = db.scalar(select(Vehicle.id).where(Vehicle.key == '741'))
        assert db.scalar(select(Mileage.km).where(Mileage.vehicle_id == vid, Mileage.ym == '2026-09')) == 1234
    process_package(path, key, rollback=True)
    with SessionLocal() as db:
        assert not db.scalar(select(Vehicle.id).where(Vehicle.key == '741'))


def test_footer_mentioning_a_vehicle_number_is_not_a_vehicle_row():
    c = login('admin')
    wb, values = source(c)
    wb.active.append(['Примечание по автомобилю 885', None, 777])
    wb.active.append(values)
    p = upload(c, save(wb)).json()
    rows = p['sections'][0]['rows']
    assert sum(r['cells'][0] == '885' for r in rows) == 1
    assert sum(r['cells'][0] == '741' for r in rows) == 1
    assert not any(r['status'] == 'error' for r in rows)
