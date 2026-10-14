"""Командная строка FiberTrack.

  python -m app.cli create-user <логин> <роль: admin|viewer|input> "<Имя>"   (пароль спросит)
  python -m app.cli import-history <прибыль.xlsx> <парк.xlsx>
"""
import getpass
import os
import sys

from sqlalchemy import select

from .db import SessionLocal
from .importer import import_history
from .models import ROLES, User
from .security import hash_password


def create_user(login: str, role: str, name: str, password: str | None = None) -> None:
    if role not in ROLES:
        sys.exit(f'Роль должна быть одной из: {", ".join(ROLES)}')
    password = password or os.environ.get('FT_NEW_PASSWORD') or getpass.getpass('Пароль: ')
    if len(password) < 10:
        sys.exit('Пароль должен быть не короче 10 символов')
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.login == login.lower()))
        if u:
            u.password_hash, u.role, u.full_name, u.is_active = hash_password(password), role, name, True
            print(f'Пользователь {login} обновлён')
        else:
            db.add(User(login=login.lower(), role=role, full_name=name, password_hash=hash_password(password)))
            print(f'Пользователь {login} создан')
        db.commit()


def main(argv: list[str]) -> None:
    if len(argv) >= 4 and argv[0] == 'create-user':
        create_user(argv[1], argv[2], argv[3])
    elif len(argv) == 3 and argv[0] == 'import-history':
        with SessionLocal() as db:
            for k, v in import_history(db, argv[1], argv[2]).items():
                print(f'{k}: {v}')
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
