import datetime as dt
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import log
from ..data import today, vehicle_dict
from ..db import get_db
from ..models import ReviewItem, User, Vehicle
from ..security import now, require_roles

router = APIRouter(prefix='/api/vehicles', tags=['vehicles'])
editors = require_roles('admin', 'input')

PLATE_RE = re.compile(r'^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$')
LAT2CYR = str.maketrans('ABEKMHOPCTYX', 'АВЕКМНОРСТУХ')
MAKES = ('FAW', 'MAN', 'DAF', 'SCANIA', 'MERCEDES', 'OTHER')
FIELDS = {'plate': 'Госномер', 'make': 'Марка', 'model': 'Модель', 'year': 'Год выпуска', 'trailer': 'Прицеп',
          'trailer_model': 'Модель прицепа', 'amort': 'Амортизация в месяц', 'from': 'В парке с', 'to': 'Выведена', 'active': 'Активна'}


def norm_plate(s: str | None) -> str | None:
    s = re.sub(r'\s+', '', (s or '').upper()).translate(LAT2CYR)
    return s or None


def short_key(s: str) -> tuple[str, str]:
    m = re.fullmatch(r'0*(\d{1,3})\s*([МДФ]?)', s.strip().upper())
    if not m:
        raise HTTPException(422, {'field': 'short', 'msg': 'Номер из 1–3 цифр, при двойнике — буква М, Д или Ф'})
    key = str(int(m.group(1))) + m.group(2)
    name = str(int(m.group(1))).zfill(3) + (f' {m.group(2)}' if m.group(2) else '')
    return key, name


def validate(db: Session, data: dict, key: str) -> dict:
    errs = {}
    plate = norm_plate(data.get('plate'))
    if plate and not PLATE_RE.fullmatch(plate):
        errs['plate'] = 'Формат: буква, 3 цифры, 2 буквы, регион — например Т970ОН58'
    if plate:
        other = db.scalar(select(Vehicle).where(Vehicle.plate == plate, Vehicle.key != key))
        if other:
            errs['plate'] = f'Этот госномер уже у машины {other.name}'
    if data.get('make') and data['make'] not in MAKES:
        errs['make'] = 'Неизвестная марка'
    y = data.get('year')
    if y is not None and not (1990 <= y <= today().year + 1):
        errs['year'] = f'Год от 1990 до {today().year + 1}'
    if data.get('amort') is not None and data['amort'] < 0:
        errs['amort'] = 'Не может быть отрицательной'
    if data.get('from') and data.get('to') and data['to'] < data['from']:
        errs['to'] = 'Дата вывода раньше даты ввода'
    if errs:
        raise HTTPException(422, errs)
    return {'plate': plate, 'make': data.get('make') or None, 'model': (data.get('model') or '').strip() or None, 'year': y,
            'amort': data.get('amort'), 'trailer': (data.get('trailer') or '').strip().upper() or None,
            'trailer_model': (data.get('trailer_model') or '').strip() or None, 'from': data.get('from'), 'to': data.get('to'),
            'active': bool(data.get('active', True))}


def apply(db: Session, v: Vehicle, clean: dict, user: User) -> int:
    cur = vehicle_dict(v)
    changes = 0
    for f, label in FIELDS.items():
        b, a = cur[f], clean[f]
        if isinstance(a, dt.date):
            a = a.isoformat()
        if str(b if b is not None else '') == str(a if a is not None else ''):
            continue
        changes += 1
        fmt = (lambda x: 'да' if x else 'нет') if f == 'active' else \
              (lambda x: f'{int(x):,} ₽'.replace(',', ' ') if x is not None else None) if f == 'amort' else (lambda x: x)
        log(db, user, 'vehicle', v.name, label, fmt(b), fmt(a))
    v.plate, v.make, v.model, v.year = clean['plate'], clean['make'], clean['model'], clean['year']
    v.amort_kop = int(round(clean['amort'] * 100)) if clean['amort'] is not None else None
    v.trailer, v.trailer_model = clean['trailer'], clean['trailer_model']
    v.in_service_from, v.in_service_to, v.is_active = clean['from'], clean['to'], clean['active']
    if changes:
        v.edited = True
    # машина получила госномер — пункт «без госномера» в очереди «Проверить» разобран
    if v.plate:
        for r in db.scalars(select(ReviewItem).where(ReviewItem.kind == 'Машина без госномера', ReviewItem.value == v.name,
                                                     ReviewItem.resolved_at.is_(None))):
            r.resolved_at, r.resolved_by = now(), user.id
    return changes


def body(raw: dict) -> dict:
    d = dict(raw)
    for f in ('from', 'to'):
        d[f] = dt.date.fromisoformat(d[f]) if d.get(f) else None
    for f in ('year',):
        d[f] = int(d[f]) if d.get(f) not in (None, '') else None
    d['amort'] = float(d['amort']) if d.get('amort') not in (None, '') else None
    return d


@router.post('')
def create(raw: dict, user: User = Depends(editors), db: Session = Depends(get_db)):
    key, name = short_key(str(raw.get('short') or ''))
    if db.scalar(select(Vehicle).where(Vehicle.key == key)):
        raise HTTPException(422, {'short': f'Машина {name} уже есть в справочнике'})
    clean = validate(db, body(raw), key)
    v = Vehicle(key=key, name=name, manual=True, history_only=False)
    db.add(v)
    db.flush()
    log(db, user, 'vehicle', name, 'Машина добавлена', None, clean['plate'] or '')
    apply(db, v, clean, user)
    db.commit()
    return vehicle_dict(v)


@router.patch('/{key}')
def update(key: str, raw: dict, user: User = Depends(editors), db: Session = Depends(get_db)):
    v = db.scalar(select(Vehicle).where(Vehicle.key == key))
    if not v:
        raise HTTPException(404, 'Машина не найдена')
    clean = validate(db, body(raw), key)
    apply(db, v, clean, user)
    db.commit()
    return vehicle_dict(v)
