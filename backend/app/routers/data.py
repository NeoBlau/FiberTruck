from fastapi import APIRouter, Depends
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
    if 'alloc' in clean and clean['alloc'] not in ('days', 'equal'):
        clean.pop('alloc')
    if 'groups' in clean:
        clean['groups'] = sorted(int(x) for x in clean['groups'])[:3]
    for k in ('fuelPct', 'glonassMax', 'kmMin', 'kmMax', 'lMin', 'lMax'):
        if k in clean:
            clean[k] = float(clean[k])
    row = db.get(Setting, 'ui') or Setting(key='ui', value={})
    row.value = {**cur, **clean}
    db.merge(row)
    db.commit()
    return row.value
