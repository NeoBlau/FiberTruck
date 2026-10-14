import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import log
from ..data import current_ym
from ..db import get_db
from ..models import Period, User
from ..security import require_roles

router = APIRouter(prefix='/api/periods', tags=['periods'])
owner = require_roles('admin')
MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
STATUS = {'open': 'открыт', 'closed': 'закрыт', None: 'не начат'}


class Reason(BaseModel):
    reason: str | None = None


def label(ym: str) -> str:
    y, m = ym.split('-')
    return f'{MONTHS[int(m) - 1].capitalize()} {y}'


def get(db: Session, ym: str) -> Period | None:
    if not re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])', ym):
        raise HTTPException(422, 'Месяц в формате ГГГГ-ММ')
    return db.scalar(select(Period).where(Period.ym == ym))


def set_status(db: Session, user: User, ym: str, status: str, reason: str | None = None) -> dict:
    p = get(db, ym)
    before = p.status if p else None
    if p is None:
        p = Period(ym=ym, status=status)
        db.add(p)
    p.status = status
    log(db, user, 'period', label(ym), 'Статус месяца' + (f' ({reason})' if reason else ''), STATUS[before], STATUS[status])
    db.commit()
    return {'ym': ym, 'status': status}


@router.post('/{ym}/open')
def open_(ym: str, user: User = Depends(owner), db: Session = Depends(get_db)):
    p = get(db, ym)
    if p and p.status == 'closed':
        raise HTTPException(409, 'Месяц закрыт — используйте «Переоткрыть» с причиной')
    y, m = map(int, current_ym().split('-'))
    limit = f'{y + (m + 2) // 12}-{(m + 2) % 12 + 1:02d}'
    if ym > limit:
        raise HTTPException(409, 'Заранее можно открыть не больше трёх месяцев вперёд')
    return set_status(db, user, ym, 'open')


@router.post('/{ym}/close')
def close(ym: str, user: User = Depends(owner), db: Session = Depends(get_db)):
    p = get(db, ym)
    if not p or p.status != 'open':
        raise HTTPException(409, 'Закрыть можно только открытый месяц')
    return set_status(db, user, ym, 'closed')


@router.post('/{ym}/reopen')
def reopen(ym: str, data: Reason, user: User = Depends(owner), db: Session = Depends(get_db)):
    p = get(db, ym)
    if not p or p.status != 'closed':
        raise HTTPException(409, 'Переоткрыть можно только закрытый месяц')
    if not (data.reason or '').strip():
        raise HTTPException(422, 'Укажите причину переоткрытия')
    return set_status(db, user, ym, 'open', data.reason.strip()[:200])
