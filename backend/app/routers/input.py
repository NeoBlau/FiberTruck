"""Ручной ввод по машине за открытый месяц. Сохранение заменяет прежние данные машины за месяц
(и введённые вручную, и пришедшие из шаблона) — двойного счёта не бывает."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..audit import log
from ..data import days_in, ui_settings
from ..db import get_db
from ..models import Mileage, Operation, Period, User, Vehicle
from ..security import require_roles
from ..uploads import MONEY_ARTICLES, TEMPLATE_COLUMNS, VAT_RATES, split_vat
from .periods import label as month_label

router = APIRouter(prefix='/api/input', tags=['input'])
TITLES = dict(TEMPLATE_COLUMNS)


class EntryIn(BaseModel):
    km: int | None = None
    days: int | None = None
    amounts: dict[str, float | None] = {}
    vat: str = '22%'
    gross: bool = True


@router.put('/{ym}/{key}')
def save(ym: str, key: str, e: EntryIn, user: User = Depends(require_roles('admin', 'input')), db: Session = Depends(get_db)):
    p = db.scalar(select(Period).where(Period.ym == ym))
    if not p or p.status != 'open':
        raise HTTPException(409, 'Месяц закрыт для ввода. Попросите владельца открыть его.')
    v = db.scalar(select(Vehicle).where(Vehicle.key == key))
    if not v:
        raise HTTPException(404, 'Машина не найдена')
    s, errs = ui_settings(db), {}
    if e.km is not None and not (s['kmMin'] <= e.km <= s['kmMax']):
        errs['km'] = f"Пробег должен быть от {int(s['kmMin']):,} до {int(s['kmMax']):,} км".replace(',', ' ')
    if e.days is not None and not (0 <= e.days <= days_in(ym)):
        errs['days'] = f'В месяце {days_in(ym)} дней'
    if e.vat not in VAT_RATES:
        errs['vat'] = 'Неизвестная ставка НДС'
    unknown = [a for a in e.amounts if a not in MONEY_ARTICLES]
    if unknown:
        errs['amounts'] = 'Неизвестные статьи: ' + ', '.join(unknown)
    amounts = {a: val for a, val in e.amounts.items() if a in MONEY_ARTICLES and val is not None}
    for a, val in amounts.items():
        if val < 0:
            errs[a] = 'Сумма не может быть отрицательной'
    if e.vat == 'без НДС' and e.gross and any(amounts.values()):
        errs['vat'] = 'Ставка «без НДС», а отмечено «с НДС» — снимите галочку или выберите ставку'
    if errs:
        raise HTTPException(422, errs)

    db.execute(delete(Mileage).where(Mileage.ym == ym, Mileage.vehicle_id == v.id))
    db.execute(delete(Operation).where(Operation.ym == ym, Operation.vehicle_id == v.id, Operation.source.in_(('manual', 'template'))))
    if e.km is not None or e.days is not None:
        db.add(Mileage(ym=ym, vehicle_id=v.id, km=e.km, worked_days=e.days, entered_by=user.id))
    rate = VAT_RATES[e.vat]
    for article, val in amounts.items():
        g, n, vat = split_vat(int(round(val * 100)), rate, e.gross)
        db.add(Operation(ym=ym, vehicle_id=v.id, article=article, amount_gross_kop=g, amount_net_kop=n, vat_kop=vat,
                         vat_rate=e.vat, vat_mode='gross' if e.gross else 'net', source='manual', entered_by=user.id))
    log(db, user, 'input', v.name, f'Ввод за {month_label(ym).lower()}', None, 'сохранено')
    db.commit()
    return {'ok': True}
