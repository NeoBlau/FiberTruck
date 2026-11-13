"""Regression coverage for the full fleet, empty templates and recovery archives."""
import hashlib
import io
import json
import shutil
import subprocess
import zipfile

import openpyxl
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Vehicle
from app.routers import backups
from tests.conftest import login
from tests.test_uploads import upload


def test_full_fleet_template_reaches_both_analytics_roles():
    with SessionLocal() as db:
        db.scalar(select(Vehicle).where(Vehicle.key == '409')).manual = True
        # Existing fixture has 2 cars; deliberately test all 58 with no schedule.
        for n in range(100, 156):
            db.add(Vehicle(key=str(n), name=str(n), plate=f'А{n}АА58', amort_kop=1000000, manual=True))
        db.commit()
    accountant = login('input')
    wb = openpyxl.load_workbook(io.BytesIO(accountant.get('/api/template/2026-09').content))
    ws = wb.active
    from app.uploads import MONEY_ARTICLES
    count = 0
    for row in range(3, ws.max_row + 1):
        if str(ws.cell(row, 1).value) not in {'885', '409', *map(str, range(100, 156))}:
            continue
        count += 1
        ws.cell(row, 3, 10000)
        for col in range(4, 18):
            ws.cell(row, col, 1220000 if col == 4 else 1220)
        ws.cell(row, 18, 20)
        ws.cell(row, 21, 'Документ №1')
    assert count == 58
    stream = io.BytesIO()
    wb.save(stream)
    preview = upload(accountant, stream.getvalue()).json()
    assert preview['can_apply']
    assert accountant.post(f"/api/uploads/{preview['id']}/apply").status_code == 200
    for role in ('admin', 'viewer'):
        payload = login(role).get('/api/bootstrap').json()
        assert payload['periods']['2026-09'] == 'open'
        assert len(payload['fin']['2026-09']['cars']) == 58
        assert sum(payload['km']['2026-09'].values()) == 580000
        assert sum(payload['wdays']['2026-09'].values()) == 1160
        for key, car in payload['fin']['2026-09']['cars'].items():
            assert set(car['g']) == set(MONEY_ARTICLES)
            assert car['n']['revenue'] == 1000000
            assert car['n']['fuel'] == 1000
            assert payload['input']['2026-09'][key]['documents'] == ['Документ №1']
    assert accountant.get('/api/bootstrap').json()['fin'] == {}


def test_empty_template_explains_missing_values():
    c = login('input')
    preview = upload(c, c.get('/api/template/2026-09').content).json()
    assert not preview['can_apply']
    assert any('нет заполненных' in n for n in preview['sections'][0]['notes'])


def test_document_survives_manual_save():
    c = login('input')
    r = c.put('/api/input/2026-10/885', json={'amounts': {'revenue': 1220}, 'document': 'Акт 1'})
    assert r.status_code == 200
    assert c.get('/api/bootstrap').json()['input']['2026-10']['885']['documents'] == ['Акт 1']


@pytest.mark.skipif(not shutil.which('pg_dump'), reason='pg_dump is required for real archive verification')
def test_real_backup_contents_and_checksums(tmp_path, monkeypatch):
    monkeypatch.setattr(backups.settings, 'upload_dir', str(tmp_path))
    (tmp_path / 'sample.xlsx').write_bytes(b'saved upload')
    r = login('admin').get('/api/backup')
    assert r.status_code == 200, r.text
    assert r.headers['cache-control'] == 'no-store'
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        assert {'database.sql', 'RESTORE.txt', 'manifest.json', 'uploads/sample.xlsx', 'project/docker-compose.yml'} <= set(z.namelist())
        manifest = json.loads(z.read('manifest.json'))
        for name, checksum in manifest['sha256'].items():
            assert hashlib.sha256(z.read(name)).hexdigest() == checksum
        sql = z.read('database.sql').decode()
        assert 'COPY public.users' in sql and 'COPY public.vehicles' in sql
        assert 'fibertruck-test' not in sql
        assert not any(name.endswith('/.env') for name in z.namelist())


def test_backup_failure_is_actionable_without_secrets(monkeypatch):
    def fail(*a, **kw):
        raise subprocess.CalledProcessError(1, 'pg_dump', stderr='secret password')
    monkeypatch.setattr(backups.subprocess, 'run', fail)
    r = login('admin').get('/api/backup')
    assert r.status_code == 503
    assert 'pg_dump' in r.json()['detail'] and 'secret password' not in r.text


def test_backup_anonymous_is_denied():
    from fastapi.testclient import TestClient
    from app.main import app
    assert TestClient(app).get('/api/backup').status_code == 401


def test_profit_upload_fills_missing_amort_only_and_rolls_back():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(['Прибыль 2026'])
    ws.append(['Машина', 'Амортизация', 'январь'])
    ws.append(['885', 99999])   # existing value 54000 must remain intact
    ws.append(['409', 12000])   # missing value must be offered in preview
    stream = io.BytesIO()
    wb.save(stream)
    c = login('admin')
    preview = upload(c, stream.getvalue()).json()
    assert preview['can_apply'] and preview['months'] == ['vehicles']
    assert preview['sections'][1]['title'] == 'Амортизация в справочнике'
    assert c.post(f"/api/uploads/{preview['id']}/apply").status_code == 200
    vehicles = c.get('/api/bootstrap').json()['vehicles']
    assert vehicles['885']['amort'] == 54000 and vehicles['409']['amort'] == 12000
    assert c.post(f"/api/uploads/{preview['id']}/rollback").status_code == 200
    assert c.get('/api/bootstrap').json()['vehicles']['409']['amort'] is None
