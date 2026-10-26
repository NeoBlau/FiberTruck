import hashlib
import io
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import ScheduleMonth, Upload, User, Vehicle
from ..security import require_roles
from ..uploads import UploadError, apply_upload, build_template, make_preview, rollback_upload

router = APIRouter(prefix='/api', tags=['uploads'])
editors = require_roles('admin', 'input')
STATUS = {'parsed': 'ждёт «Применить»', 'applied': 'применена', 'rolled_back': 'откачена', 'discarded': 'отменена'}


def upload_dict(u: Upload, names: dict[int, str]) -> dict:
    return {'id': u.id, 'kind': u.kind, 'kind_name': u.preview.get('kind_name'), 'filename': u.filename, 'status': u.status,
            'status_name': STATUS[u.status], 'months': u.months, 'uploaded_by': names.get(u.uploaded_by), 'uploaded_at': u.uploaded_at.isoformat(),
            'applied_at': u.applied_at.isoformat() if u.applied_at else None, 'result': u.preview.get('result'),
            'sections': u.preview.get('sections'), 'can_apply': u.status == 'parsed' and u.preview.get('can_apply', False),
            'duplicate_of': u.preview.get('duplicate_of')}


def visible(user: User, u: Upload) -> bool:
    return user.role == 'admin' or u.kind != 'profit'     # таблица прибыли — данные не для бухгалтера


def get_upload(db: Session, upload_id: int, user: User) -> Upload:
    u = db.get(Upload, upload_id)
    if not u or not visible(user, u):
        raise HTTPException(404, 'Загрузка не найдена')
    return u


def user_names(db: Session) -> dict[int, str]:
    return {u.id: u.full_name for u in db.scalars(select(User))}


@router.post('/uploads')
async def create(file: UploadFile = File(...), ym: str | None = Form(None), user: User = Depends(editors), db: Session = Depends(get_db)):
    name = Path(file.filename or 'файл.xlsx').name
    if not re.search(r'\.(xlsx|xlsm)$', name, re.I):
        raise HTTPException(422, 'Нужен файл Excel .xlsx. Если у вас .xls или .csv — откройте его в Excel и сохраните как .xlsx.')
    data = await file.read(settings.upload_max_mb * 1024 * 1024 + 1)
    if len(data) > settings.upload_max_mb * 1024 * 1024:
        raise HTTPException(413, f'Файл больше {settings.upload_max_mb} МБ')
    if not data:
        raise HTTPException(422, 'Файл пустой')
    sha = hashlib.sha256(data).hexdigest()
    folder = Path(settings.upload_dir)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f'{sha[:16]}.xlsx'
    path.write_bytes(data)
    if ym and not re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])', ym):
        ym = None
    try:
        res = make_preview(db, str(path), ym, user.role)
    except UploadError as e:
        raise HTTPException(422, str(e))
    dup = db.scalar(select(Upload).where(Upload.sha256 == sha, Upload.status == 'applied').order_by(Upload.id.desc()))
    preview = {'kind_name': res['kind_name'], 'sections': res['sections'], 'can_apply': bool(res['months']),
               'duplicate_of': {'id': dup.id, 'at': dup.applied_at.isoformat()} if dup else None}
    # прежние неприменённые предпросмотры этого пользователя больше не нужны
    for old in db.scalars(select(Upload).where(Upload.uploaded_by == user.id, Upload.status == 'parsed')):
        old.status = 'discarded'
    u = Upload(kind=res['kind'], filename=name[:255], sha256=sha, size=len(data), path=str(path), months=res['months'],
               status='parsed', preview=preview, plan=res['plan'], uploaded_by=user.id)
    db.add(u)
    db.commit()
    return upload_dict(u, user_names(db))


@router.get('/uploads')
def list_(user: User = Depends(editors), db: Session = Depends(get_db)):
    names = user_names(db)
    ups = db.scalars(select(Upload).where(Upload.status != 'discarded').order_by(Upload.id.desc()).limit(50))
    return [{k: v for k, v in upload_dict(u, names).items() if k != 'sections'} for u in ups if visible(user, u)]


@router.get('/uploads/{upload_id}')
def get_(upload_id: int, user: User = Depends(editors), db: Session = Depends(get_db)):
    return upload_dict(get_upload(db, upload_id, user), user_names(db))


@router.post('/uploads/{upload_id}/apply')
def apply(upload_id: int, user: User = Depends(editors), db: Session = Depends(get_db)):
    u = get_upload(db, upload_id, user)
    if u.status != 'parsed':
        raise HTTPException(409, f'Загрузка уже {STATUS[u.status]}')
    if not u.preview.get('can_apply'):
        raise HTTPException(409, 'В этом файле нечего применять')
    try:
        done = apply_upload(db, u, user)
    except UploadError as e:
        db.rollback()
        raise HTTPException(409, str(e))
    u.preview = {**u.preview, 'result': done}
    db.commit()
    return upload_dict(u, user_names(db))


@router.post('/uploads/{upload_id}/discard')
def discard(upload_id: int, user: User = Depends(editors), db: Session = Depends(get_db)):
    u = get_upload(db, upload_id, user)
    if u.status != 'parsed':
        raise HTTPException(409, f'Загрузка уже {STATUS[u.status]}')
    u.status = 'discarded'
    db.commit()
    return {'ok': True}


@router.post('/uploads/{upload_id}/rollback')
def rollback(upload_id: int, user: User = Depends(require_roles('admin')), db: Session = Depends(get_db)):
    u = get_upload(db, upload_id, user)
    try:
        rollback_upload(db, u, user)
    except UploadError as e:
        db.rollback()
        raise HTTPException(409, str(e))
    db.commit()
    return upload_dict(u, user_names(db))


@router.get('/template/{ym}')
def template(ym: str, user: User = Depends(editors), db: Session = Depends(get_db)):
    if not re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])', ym):
        raise HTTPException(422, 'Месяц в формате ГГГГ-ММ')
    # машины месяца: из графика этого месяца, а если его нет — из последнего графика; плюс добавленные вручную; только в работе
    have = db.scalar(select(ScheduleMonth.ym).where(ScheduleMonth.ym == ym).limit(1))
    src_ym = have or db.scalar(select(ScheduleMonth.ym).order_by(ScheduleMonth.ym.desc()).limit(1))
    ids = set(db.scalars(select(ScheduleMonth.vehicle_id).where(ScheduleMonth.ym == src_ym))) if src_ym else set()
    keys = [v.key for v in db.scalars(select(Vehicle).where(Vehicle.is_active.is_(True))) if v.id in ids or v.manual or not src_ym]  # графиков нет — весь парк
    wb = build_template(db, ym, keys)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f'FiberTrack_шаблон_{ym}.xlsx'
    from urllib.parse import quote
    return StreamingResponse(buf, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': f"attachment; filename*=UTF-8''{quote(fname)}"})

