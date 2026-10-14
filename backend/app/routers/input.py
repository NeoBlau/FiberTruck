"""Ручной ввод по машине за открытый месяц. Повторное сохранение заменяет прежние данные."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..audit import log
from ..data import INPUT_ARTICLES, days_in, ui_settings
from ..db import get_db
from ..models import Mileage, Operation, Period, User, Vehicle
from ..security import require_roles
from .periods import label as month_label

router = APIRouter(prefix='/api/input', tags=['input'])
VAT = {'22%': 22, '10%': 10, '7%': 7, '5%': 5, '0%': 0, 'без НДС': None}


class EntryIn(BaseModel):
    km: int | None = None
    days: int | None = None
    rev: float | None = None
    fuel: float | None = None
    repair: float | None = None
    salary: float | None = None
    other: float | None = None
    vat: str = '22%'
    gross: bool = True


def split_vat(amount_kop: int, rate: int | None, gross: bool) -> tuple[int, int, int]:
    """→ (брутто, нетто, НДС) в копейках."""
    if not rate:
        return amount_kop, amount_kop, 0
    if gross:
        net = round(amount_kop * 100 / (100 + rate))
        return amount_kop, net, amount_kop - net
    vat = round(amount_kop * rate / 100)
    return amount_kop + vat, amount_kop, vat


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
    if e.vat not in VAT:
        errs['vat'] = 'Неизвестная ставка НДС'
    amounts = {f: getattr(e, f) for f in INPUT_ARTICLES}
    for f, val in amounts.items():
        if val is not None and val < 0:
            errs[f] = 'Сумма не может быть отрицательной'
    if e.vat == 'без НДС' and e.gross and any(amounts.values()):
        errs['fuel'] = 'Ставка «без НДС», а отмечено «с НДС» — снимите галочку или выберите ставку'
    if errs:
        raise HTTPException(422, errs)

    db.execute(delete(Mileage).where(Mileage.ym == ym, Mileage.vehicle_id == v.id))
    db.execute(delete(Operation).where(Operation.ym == ym, Operation.vehicle_id == v.id, Operation.source == 'manual'))
    if e.km is not None or e.days is not None:
        db.add(Mileage(ym=ym, vehicle_id=v.id, km=e.km, worked_days=e.days, entered_by=user.id))
    rate = VAT.get(e.vat)
    for f, article in INPUT_ARTICLES.items():
        if amounts[f] is None:
            continue
        g, n, vat = split_vat(int(round(amounts[f] * 100)), rate, e.gross)
        db.add(Operation(ym=ym, vehicle_id=v.id, article=article, amount_gross_kop=g, amount_net_kop=n, vat_kop=vat,
                         vat_rate=e.vat, vat_mode='gross' if e.gross else 'net', source='manual', entered_by=user.id))
    log(db, user, 'input', v.name, f'Ввод за {month_label(ym).lower()}', None, 'сохранено')
    db.commit()
    return {'ok': True}
