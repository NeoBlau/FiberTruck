"""Командная строка FiberTrack.

  python -m app.cli init-users [--reset]     создать владельца, руководителя и бухгалтера со случайными паролями
  python -m app.cli create-user <логин> <роль: admin|viewer|input> "<Имя>"   (пароль спросит)
  python -m app.cli import-history <прибыль.xlsx> <парк.xlsx>
"""
import getpass
import os
import secrets
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


DEFAULT_USERS = (('owner', 'admin', 'Владелец'), ('boss', 'viewer', 'Руководитель'), ('buh', 'input', 'Бухгалтер'))
ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'   # без похожих 0/O, 1/l/I


def gen_password() -> str:
    """16 символов группами по 4: легко переписать с экрана, ~94 бита случайности."""
    raw = ''.join(secrets.choice(ALPHABET) for _ in range(16))
    return '-'.join(raw[i:i + 4] for i in range(0, 16, 4))


def init_users(reset: bool = False) -> list[tuple[str, str, str, str | None]]:
    """Создаёт трёх пользователей ролей. Существующих не трогает, если не reset. → [(логин, роль, имя, пароль|None)]"""
    out = []
    with SessionLocal() as db:
        for login, role, name in DEFAULT_USERS:
            u = db.scalar(select(User).where(User.login == login))
            if u and not reset:
                out.append((login, role, name, None))
                continue
            pw = gen_password()
            if u:
                u.password_hash, u.role, u.is_active = hash_password(pw), role, True
            else:
                db.add(User(login=login, role=role, full_name=name, password_hash=hash_password(pw)))
            out.append((login, role, name, pw))
        db.commit()
    return out


def main(argv: list[str]) -> None:
    if argv and argv[0] == 'init-users':
        rows = init_users(reset='--reset' in argv)
        print('Пользователи FiberTrack (пароли показываются один раз — сохраните их):')
        for login, role, name, pw in rows:
            print(f'  {name:<13} логин: {login:<6} пароль: {pw}' if pw else f'  {name:<13} логин: {login:<6} уже был — пароль не менял (новый: init-users --reset)')
    elif len(argv) >= 4 and argv[0] == 'create-user':
        create_user(argv[1], argv[2], argv[3])
    elif len(argv) == 3 and argv[0] == 'import-history':
        with SessionLocal() as db:
            for k, v in import_history(db, argv[1], argv[2]).items():
                print(f'{k}: {v}')
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
