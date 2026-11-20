import datetime as dt
import io

import openpyxl
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import func, select

from app.config import settings
from app.db import SessionLocal
from app.models import FuelDay, Mileage, Operation, Period, Upload, User, Vehicle
from app.reviewed_package import MAGIC, process_package, seal_package
from app.uploads import UploadError, row_to_dict
from tests.conftest import login


def save(wb):
    out = io.BytesIO(); wb.save(out); return out.getvalue()


def package(tmp_path, monkeypatch, *, bad_month=False, superseded=False):
    monkeypatch.setattr(settings, 'upload_dir', str(tmp_path / 'uploads'))
    c = login('admin')
    finance = openpyxl.load_workbook(io.BytesIO(c.get('/api/template/2026-08').content))
    fuel = openpyxl.load_workbook(io.BytesIO(c.get('/api/fuel-template/2026-08').content))
    fs, ls = finance.active, fuel.active
    r = next(i for i in range(3, fs.max_row + 1) if str(fs.cell(i, 1).value) == '885')
    for col, value in [(3, 10000), (4, 1000000), (6, 195000), (18, 20)]: fs.cell(r, col).value = value
    r = next(i for i in range(3, ls.max_row + 1) if str(ls.cell(i, 1).value) == '885')
    ls.cell(r, 2).value = 3000
    if superseded:
        for sheet in [fs, ls]:
            r = next(i for i in range(3, sheet.max_row + 1) if str(sheet.cell(i, 1).value) == '409')
            sheet.delete_rows(r)
    if bad_month: fuel['_ft_fuel']['A2'] = '2026-09'
    key = Fernet.generate_key()
    blob = seal_package([('financial', '2026-08', 'Финансы.xlsx', save(finance)), ('fuel', '2026-08', 'Топливо.xlsx', save(fuel))], key,
                        superseded={'2026-08': ['409']} if superseded else None)
    path = tmp_path / 'private.ftpack'; path.write_bytes(blob)
    return path, key


def snapshot():
    with SessionLocal() as db:
        return {model.__tablename__: [row_to_dict(r) for r in db.scalars(select(model).order_by(model.id))]
                for model in [Vehicle, Operation, Mileage, FuelDay, Period, User]}


def seed_previous():
    with SessionLocal() as db:
        ids = {v.key: v.id for v in db.scalars(select(Vehicle))}
        db.add_all([Mileage(ym='2026-08', vehicle_id=ids['885'], km=777, source='manual'),
                    FuelDay(vehicle_id=ids['885'], date=dt.date(2026, 8, 1), rn_l=123),
                    FuelDay(vehicle_id=ids['409'], date=dt.date(2026, 8, 1), rn_l=750),
                    FuelDay(vehicle_id=ids['885'], date=dt.date(2026, 9, 1), rn_l=555)])
        db.commit()


def test_preview_changes_nothing_and_authenticated_payload_hides_excel(tmp_path, monkeypatch):
    path, key = package(tmp_path, monkeypatch); seed_previous(); before = snapshot()
    result = process_package(path, key)
    assert result['status'] == 'preview' and len(result['files']) == 2
    assert snapshot() == before
    with SessionLocal() as db: assert db.scalar(select(func.count()).select_from(Upload)) == 0
    assert not (tmp_path / 'uploads').exists()
    assert path.read_bytes().startswith(MAGIC)
    assert 'Финансы.xlsx'.encode() not in path.read_bytes() and key not in path.read_bytes()


def test_apply_blank_reset_closed_period_and_full_rollback(tmp_path, monkeypatch):
    path, key = package(tmp_path, monkeypatch); seed_previous(); before = snapshot()
    assert process_package(path, key, apply=True)['status'] == 'applied'
    with SessionLocal() as db:
        ids = {v.key: v.id for v in db.scalars(select(Vehicle))}
        assert db.scalar(select(Period.status).where(Period.ym == '2026-08')) == 'closed'
        assert db.scalar(select(Mileage.km).where(Mileage.ym == '2026-08', Mileage.vehicle_id == ids['885'])) == 10000
        assert not db.scalar(select(FuelDay.id).where(FuelDay.vehicle_id == ids['409'], FuelDay.date == dt.date(2026, 8, 1)))
        assert db.scalar(select(FuelDay.rn_l).where(FuelDay.vehicle_id == ids['885'], FuelDay.date == dt.date(2026, 9, 1))) == 555
        assert not db.scalar(select(Operation.id).where(Operation.ym == '2026-08', Operation.article == 'profit_total'))
        assert all(u.backup is not None for u in db.scalars(select(Upload)))
    with SessionLocal() as db:
        km = db.scalar(select(Mileage.km).where(Mileage.ym == '2026-08', Mileage.vehicle_id == ids['885']))
        liters = db.scalar(select(FuelDay.rn_l).where(FuelDay.date == dt.date(2026, 8, 1), FuelDay.vehicle_id == ids['885']))
        assert float(liters) / km * 100 == 30
    assert process_package(path, key, rollback=True)['status'] == 'rolled_back'
    assert snapshot() == before


def test_repeated_apply_does_not_overwrite_later_manual_changes(tmp_path, monkeypatch):
    path, key = package(tmp_path, monkeypatch); process_package(path, key, apply=True)
    with SessionLocal() as db:
        db.scalar(select(Mileage).where(Mileage.ym == '2026-08')).km = 43210; db.commit()
    before = snapshot()
    assert process_package(path, key, apply=True)['status'] == 'already_applied'
    assert snapshot() == before
    with SessionLocal() as db: assert db.scalar(select(func.count()).select_from(Upload)) == 2


def test_bad_last_file_rolls_back_everything_and_cleans_new_source_files(tmp_path, monkeypatch):
    path, key = package(tmp_path, monkeypatch, bad_month=True); seed_previous(); before = snapshot()
    with pytest.raises(UploadError): process_package(path, key, apply=True)
    assert snapshot() == before
    with SessionLocal() as db: assert db.scalar(select(func.count()).select_from(Upload)) == 0
    assert not list((tmp_path / 'uploads').glob('*.xlsx'))


def test_wrong_key_and_tampering_cannot_change_data(tmp_path, monkeypatch):
    path, key = package(tmp_path, monkeypatch); before = snapshot()
    with pytest.raises(UploadError): process_package(path, Fernet.generate_key(), apply=True)
    data = bytearray(path.read_bytes()); data[len(data)//2] ^= 1; path.write_bytes(data)
    with pytest.raises(UploadError): process_package(path, key, apply=True)
    assert snapshot() == before


def test_superseded_identity_is_cleared_only_in_selected_month_and_can_be_restored(tmp_path, monkeypatch):
    path, key = package(tmp_path, monkeypatch, superseded=True); seed_previous()
    with SessionLocal() as db:
        v = db.scalar(select(Vehicle).where(Vehicle.key == '409'))
        for ym, amount in [('2026-08',12300),('2026-09',45600)]:
            db.add(Operation(ym=ym, vehicle_id=v.id, article='profit_total', amount_gross_kop=amount, amount_net_kop=amount, vat_kop=0, source='import', vat_mode='unknown'))
        db.commit()
    before = snapshot(); process_package(path, key, apply=True)
    with SessionLocal() as db:
        v = db.scalar(select(Vehicle).where(Vehicle.key == '409'))
        assert not db.scalar(select(Operation.id).where(Operation.ym == '2026-08', Operation.vehicle_id == v.id))
        assert db.scalar(select(Operation.id).where(Operation.ym == '2026-09', Operation.vehicle_id == v.id))
    process_package(path, key, rollback=True); assert snapshot() == before


def test_hidden_month_conflict_is_rejected_by_regular_upload(tmp_path, monkeypatch):
    c = login('admin'); w = openpyxl.load_workbook(io.BytesIO(c.get('/api/fuel-template/2026-10').content))
    w.active['A1'] = 'FiberTrack · топливо за месяц · Август 2026'
    r = c.post('/api/uploads', files={'file': ('fuel.xlsx', save(w))})
    assert r.status_code == 422 and 'не совпадает' in r.json()['detail']


@pytest.mark.parametrize('hidden,visible', [('2026-09', 'Август 2026'), ('2026/08', 'Август 2026')])
def test_financial_hidden_month_mismatch_or_invalid_metadata_is_rejected(hidden, visible):
    c = login('admin')
    w = openpyxl.load_workbook(io.BytesIO(c.get('/api/template/2026-10').content))
    w['_ft']['A2'] = hidden
    w.active['A1'] = f'FiberTrack · шаблон ввода · {visible}'
    r = c.post('/api/uploads', files={'file': ('finance.xlsx', save(w))})
    assert r.status_code == 422


def test_fuel_only_patch_preserves_finance_and_other_vehicles(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'upload_dir', str(tmp_path / 'uploads'))
    c = login('admin')
    fuel = openpyxl.load_workbook(io.BytesIO(c.get('/api/fuel-template/2026-08').content))
    sheet = fuel.active
    for row in range(sheet.max_row, 2, -1):
        if str(sheet.cell(row, 1).value) != '885':
            sheet.delete_rows(row)
    sheet['B3'] = 1900
    seed_previous()
    before = snapshot()
    key = Fernet.generate_key()
    path = tmp_path / 'fuel-only.ftpack'
    path.write_bytes(seal_package([('fuel', '2026-08', 'Исправления.xlsx', save(fuel))], key))
    process_package(path, key, apply=True)
    after = snapshot()
    for table in before:
        if table != 'fuel_days':
            assert after[table] == before[table]
    with SessionLocal() as db:
        ids = {v.key: v.id for v in db.scalars(select(Vehicle))}
        assert db.scalar(select(FuelDay.rn_l).where(FuelDay.vehicle_id == ids['885'], FuelDay.date == dt.date(2026, 8, 1))) == 1900
        assert db.scalar(select(FuelDay.rn_l).where(FuelDay.vehicle_id == ids['409'], FuelDay.date == dt.date(2026, 8, 1))) == 750
    process_package(path, key, rollback=True)
    assert snapshot() == before
