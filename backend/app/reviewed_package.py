"""Authenticated private Excel packages. Explicit apply; one transaction; existing upload rollback."""
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import uuid
import zipfile

import openpyxl
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import or_, select, text

from .audit import log
from .config import settings
from .db import SessionLocal
from .models import FuelDay, Mileage, Operation, Period, Upload, User, Vehicle
from .parsing import car_key, display
from .uploads import (Ctx, SHARED_ROWS, UploadError, apply_upload, label_to_ym, make_preview,
                      rollback_upload, row_to_dict)

DEFAULT_PACKAGE = Path(__file__).parent / 'packages' / 'reviewed-input.ftpack'
MAGIC = b'FIBERTRUCK-PRIVATE-PACKAGE-1\n'
MAX_BYTES = 100 * 1024 * 1024


def seal_package(files, key, package_id=None, superseded=None):
    """files: [(kind:financial|fuel, ym, original_filename, Excel bytes)]. No key in artifact."""
    manifest = {'version': 1, 'id': package_id or uuid.uuid4().hex, 'mode': 'replace-listed', 'files': [], 'superseded': superseded or {}}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for i, (kind, ym, filename, data) in enumerate(files):
            entry = f'file_{i:03}.xlsx'
            archive.writestr(entry, data)
            manifest['files'].append({'entry': entry, 'kind': kind, 'ym': ym, 'filename': filename,
                                      'sha256': hashlib.sha256(data).hexdigest()})
        archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False))
    return MAGIC + Fernet(key).encrypt(stream.getvalue())


def open_package(path, key):
    try:
        data = Path(path).read_bytes()
        if not data.startswith(MAGIC) or len(data) > MAX_BYTES:
            raise ValueError
        plain = Fernet(key).decrypt(data[len(MAGIC):])
        with zipfile.ZipFile(io.BytesIO(plain)) as archive:
            if sum(i.file_size for i in archive.infolist()) > MAX_BYTES or len(archive.infolist()) > 25:
                raise ValueError
            manifest = json.loads(archive.read('manifest.json'))
            if manifest.get('version') != 1 or manifest.get('mode') != 'replace-listed' or not re.fullmatch(r'[a-f0-9]{32}', manifest.get('id', '')):
                raise ValueError
            files = manifest['files']
            if not 2 <= len(files) <= 24 or len({f['entry'] for f in files}) != len(files):
                raise ValueError
            pairs = set()
            result = []
            for f in files:
                if not re.fullmatch(r'file_\d{3}\.xlsx', f['entry']) or f['kind'] not in ('financial', 'fuel') or not re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])', f['ym']):
                    raise ValueError
                if (f['ym'], f['kind']) in pairs:
                    raise ValueError
                pairs.add((f['ym'], f['kind']))
                raw = archive.read(f['entry'])
                if hashlib.sha256(raw).hexdigest() != f['sha256']:
                    raise ValueError
                stale = manifest.get('superseded', {}).get(f['ym'], [])
                if not isinstance(stale, list) or any(not isinstance(k, str) or not re.fullmatch(r'\d{1,4}[МДФ]?', k) for k in stale):
                    raise ValueError
                result.append({**f, 'data': raw, 'superseded': stale})
            months = sorted({ym for ym, _ in pairs})
            if pairs != {(ym, kind) for ym in months for kind in ('financial', 'fuel')}:
                raise ValueError
            return manifest['id'], sorted(result, key=lambda f: (f['ym'], f['kind'] != 'financial'))
    except (InvalidToken, ValueError, KeyError, TypeError, zipfile.BadZipFile, json.JSONDecodeError):
        raise UploadError('Неверный ключ, повреждённый или неподдерживаемый пакет. Данные не изменены.') from None


def _roster(db, wb):
    ctx = Ctx(db)
    rows, seen = [], set()
    for values in wb.worksheets[0].iter_rows(min_row=3, values_only=True):
        name, plate, *_ = values
        if str(name or '').startswith('Общие расходы'):
            break
        if name is None or not str(name).strip():
            continue
        by_name, by_plate = ctx.find_vehicle(name), ctx.find_vehicle(plate)
        if by_name and by_plate and by_name.id != by_plate.id:
            raise UploadError(f'Машина {name}: номер и госномер указывают на разные записи справочника.')
        v = by_name or by_plate
        key = v.key if v else car_key(name)
        if not key or key in seen:
            raise UploadError(f'Неоднозначная или повторная машина: {name}.')
        seen.add(key)
        normalized_plate = re.sub(r'\s+', '', str(plate or '').upper()).translate(str.maketrans('ABEKMHOPCTYX', 'АВЕКМНОРСТУХ')) or None
        if v and v.plate and normalized_plate and normalized_plate != v.plate:
            raise UploadError(f'Госномер машины {name} отличается от справочника. Нужна проверка владельца.')
        rows.append({'name': str(name).strip(), 'key': key, 'id': v.id if v else None,
                     'create': None if v else {'key': key, 'name': display(key), 'plate': normalized_plate}})
    if not rows:
        raise UploadError('В финансовом файле нет списка машин.')
    return rows


def _take(db, model, where):
    rows = list(db.scalars(select(model).where(where)))
    snapshot = [row_to_dict(row) for row in rows]
    for row in rows:
        db.delete(row)
    db.flush()
    return snapshot


def process_package(path, key, *, apply=False, rollback=False, actor_login=None):
    package_id, files = open_package(path, key)
    months = sorted({f['ym'] for f in files})
    prefix = f'[package:{package_id}] '
    created_paths = []
    with SessionLocal() as db:
        try:
            # Serialize against regular imports and manual entries; normal readers stay available.
            if db.bind.dialect.name == 'postgresql':
                db.execute(text('LOCK TABLE vehicles, periods, operations, mileage, fuel_days, uploads IN SHARE ROW EXCLUSIVE MODE'))
            actor_q = select(User).where(User.role == 'admin', User.is_active.is_(True))
            if actor_login:
                actor_q = actor_q.where(User.login == actor_login)
            actor = db.scalar(actor_q.order_by(User.id))
            if not actor:
                raise UploadError('Не найден активный владелец для аудита импорта.')
            old = list(db.scalars(select(Upload).where(Upload.filename.like(prefix + '%')).order_by(Upload.id)))
            if not rollback and old:
                if len(old) == len(files) and all(u.status == 'applied' for u in old) and sorted(u.sha256 for u in old) == sorted(f['sha256'] for f in files):
                    return {'status': 'already_applied', 'package': package_id, 'months': months}
                raise UploadError('Этот пакет уже применялся и был полностью или частично откачен. Автоматически повторно его не применяю.')
            periods = {p.ym: p for p in db.scalars(select(Period).where(Period.ym.in_(months)))}
            statuses = {ym: periods[ym].status if ym in periods else None for ym in months}
            changed_at = {ym: p.changed_at for ym,p in periods.items()}
            for ym in months:
                if ym not in periods:
                    periods[ym] = Period(ym=ym, status='open')
                    db.add(periods[ym])
                periods[ym].status = 'open'
            db.flush()
            if rollback:
                if len(old) != len(files) or any(u.status != 'applied' for u in old):
                    raise UploadError('Нельзя откатить пакет: набор применённых загрузок неполон.')
                for upload in reversed(old):
                    rollback_upload(db, upload, actor)
                    db.flush()
                report = {'status': 'rolled_back', 'package': package_id, 'months': months}
            else:
                report = {'status': 'applied' if apply else 'preview', 'package': package_id, 'months': months, 'files': []}
                aliases = {}
                with tempfile.TemporaryDirectory(prefix='ft-review-') as temp:
                    for i, f in enumerate(files):
                        ym = f['ym']
                        wb = openpyxl.load_workbook(io.BytesIO(f['data']))
                        if f['kind'] == 'financial':
                            declared = str(wb['_ft']['A2'].value) if '_ft' in wb.sheetnames else label_to_ym(wb.active['A1'].value)
                            if declared != ym:
                                raise UploadError(f'{f["filename"]}: месяц не совпадает с пакетом.')
                            roster = _roster(db, wb)
                            scope = [r['id'] for r in roster if r['id']]
                        else:
                            if '_ft_fuel' not in wb.sheetnames or wb['_ft_fuel']['A1'].value != 'fibertrack-fuel-monthly' or str(wb['_ft_fuel']['A2'].value) != ym:
                                raise UploadError('Нужен месячный топливный шаблон указанного месяца.')
                            scope = []
                            for row in range(3, wb.active.max_row + 1):
                                name = wb.active.cell(row, 1).value
                                if name is None:
                                    continue
                                key = aliases[ym].get(str(name).strip())
                                if key is None:
                                    raise UploadError(f'Топливо {ym}: машина {name} отсутствует в финансовом файле.')
                                vehicle = db.scalar(select(Vehicle).where(Vehicle.key == key))
                                scope.append(vehicle.id)
                                wb.active.cell(row, 1).value = key
                        ctx = Ctx(db)
                        scope.extend(v.id for k in f['superseded'] if (v := ctx.find_vehicle(k)) is not None)
                        normalized = Path(temp) / f'{i}.xlsx'
                        if f['kind'] == 'financial':
                            normalized.write_bytes(f['data'])  # Preserve Excel formula caches.
                        else:
                            wb.save(normalized)
                        res = make_preview(db, str(normalized), ym, actor.role)
                        expected = 'template' if f['kind'] == 'financial' else 'park'
                        if res['kind'] != expected or any(m != ym for m in res['months']):
                            raise UploadError('Файл распознан как другой тип или месяц.')
                        errors = [r['note'] for s in res['sections'] for r in s['rows'] if r['status'] == 'error']
                        if errors:
                            raise UploadError(f'{f["filename"]}: ' + '; '.join(errors[:8]))
                        if f['kind'] == 'financial':
                            present = {c['key'] for c in res['plan']['cars']}
                            for row in roster:
                                if row['create'] and row['key'] not in present:
                                    res['plan']['cars'].append({'vehicle_id': None, 'create': row['create'], 'key': row['key'],
                                        'km': None, 'days': None, 'amounts': {}, 'vat': '22%', 'gross': True, 'doc': ''})
                        shared = {SHARED_ROWS.get(str(row[0] or '').strip().upper()) for row in wb.active.values} & set(SHARED_ROWS.values()) if f['kind'] == 'financial' else set()
                        source = Path(settings.upload_dir) / f'package-{package_id}-{f["sha256"][:16]}.xlsx'
                        if apply:
                            source.parent.mkdir(parents=True, exist_ok=True)
                            if not source.exists():
                                with source.open('xb') as out:
                                    out.write(f['data'])
                                source.chmod(0o600)
                                created_paths.append(source)
                            elif hashlib.sha256(source.read_bytes()).hexdigest() != f['sha256']:
                                raise UploadError('Файл пакета на сервере изменён; импорт остановлен.')
                        upload = Upload(kind=res['kind'], filename=(prefix + f['filename'])[:255], sha256=f['sha256'], size=len(f['data']),
                            path=str(source), months=[ym], status='parsed', plan=res['plan'], uploaded_by=actor.id,
                            preview={'kind_name': res['kind_name'], 'sections': res['sections'], 'can_apply': True, 'package_id': package_id, 'snapshot': True})
                        db.add(upload)
                        db.flush()
                        extra = {}
                        if f['kind'] == 'financial':
                            extra['operations'] = _take(db, Operation, (Operation.ym == ym) & or_(Operation.vehicle_id.in_(scope), Operation.vehicle_id.is_(None) & Operation.article.in_(shared)))
                            extra['mileage'] = _take(db, Mileage, (Mileage.ym == ym) & Mileage.vehicle_id.in_(scope))
                        else:
                            first = dt.date.fromisoformat(ym + '-01')
                            end = dt.date(first.year + (first.month == 12), first.month % 12 + 1, 1)
                            extra['fuel_days'] = _take(db, FuelDay, (FuelDay.date >= first) & (FuelDay.date < end) & FuelDay.vehicle_id.in_(scope))
                        done = apply_upload(db, upload, actor)
                        backup = dict(upload.backup)
                        for field, values in extra.items():
                            backup[field] = values + backup[field]
                        upload.backup = backup
                        upload.preview = {**upload.preview, 'result': done}
                        db.flush()
                        if f['kind'] == 'financial':
                            aliases[ym] = {r['name']: r['key'] for r in roster}
                        report['files'].append({'filename': f['filename'], 'month': ym, 'type': f['kind'], 'vehicles': len(roster) if f['kind'] == 'financial' else len(set(scope)),
                            'replaced': {field: len(rows) for field, rows in extra.items()}, 'result': done})
            for ym, status in statuses.items():
                if status is not None:
                    periods[ym].status = status
                    periods[ym].changed_at = changed_at[ym]
            log(db, actor, 'package', package_id, 'Откат проверенного пакета' if rollback else 'Применён проверенный пакет', None, ', '.join(months))
            if apply or rollback:
                db.commit()
            else:
                db.rollback()
            return report
        except Exception:
            db.rollback()
            for source in created_paths:
                source.unlink(missing_ok=True)
            raise
