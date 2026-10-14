from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..audit import log
from ..db import get_db
from ..models import ReviewItem, User
from ..security import now, require_roles

router = APIRouter(prefix='/api/review', tags=['review'])


@router.post('/{item_id}/resolve')
def resolve(item_id: int, user: User = Depends(require_roles('admin', 'input')), db: Session = Depends(get_db)):
    r = db.get(ReviewItem, item_id)
    if not r:
        raise HTTPException(404, 'Пункт не найден')
    if r.resolved_at is None:
        r.resolved_at, r.resolved_by = now(), user.id
        log(db, user, 'review', r.value, r.kind, None, 'разобрано')
        db.commit()
    return {'ok': True}
