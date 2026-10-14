from sqlalchemy.orm import Session

from .models import AuditLog, User


def log(db: Session, user: User, entity: str, key: str, field: str, before=None, after=None) -> None:
    db.add(AuditLog(user_id=user.id, user_name=f'{user.full_name}', entity=entity, entity_key=key, field=field,
                    before=None if before is None else str(before), after=None if after is None else str(after)))
