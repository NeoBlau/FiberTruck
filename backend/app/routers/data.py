import math

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..data import DEFAULT_UI_SETTINGS, build_payload, ui_settings
from ..db import get_db
from ..models import Setting, User
from ..security import current_user, require_roles

router = APIRouter(prefix='/api', tags=['data'])


@router.get('/bootstrap')
def bootstrap(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Все данные экранов, доступные роли пользователя."""
    return build_payload(db, user)


@router.put('/settings')
def put_settings(data: dict, user: User = Depends(require_roles('admin')), db: Session = Depends(get_db)):
    cur = ui_settings(db)
    clean = {k: data[k] for k in DEFAULT_UI_SETTINGS if k in data}
    if 'alloc' in clean and clean['alloc'] not in ('days', 'equal', 'km'):
        clean.pop('alloc')
    if 'groups' in clean:
        clean['groups'] = sorted(int(x) for x in clean['groups'])[:3]
    for k in ('fuelPct', 'glonassMax', 'kmMin', 'kmMax', 'lMin', 'lMax', 'fuelJumpPct'):
        if k in clean:
            try:
                clean[k] = float(clean[k])
                if not math.isfinite(clean[k]):
                    raise ValueError
            except (TypeError, ValueError):
                raise HTTPException(422, 'Порог должен быть конечным числом.') from None
    proposed = {**cur, **clean}
    if not 0 <= proposed['lMin'] < proposed['lMax'] <= 1000:
        raise HTTPException(422, 'Пороги топлива: 0 ≤ минимум < максимум ≤ 1000 л/100 км.')
    if not 0 < proposed['fuelJumpPct'] <= 1000:
        raise HTTPException(422, 'Порог роста расхода должен быть больше 0 и не больше 1000%.')
    row = db.get(Setting, 'ui') or Setting(key='ui', value={})
    row.value = {**cur, **clean}
    db.merge(row)
    db.commit()
    return row.value
