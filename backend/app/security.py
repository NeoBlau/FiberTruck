"""Пароли, сессии, CSRF, ограничение попыток входа, проверка ролей. Всё — только на сервере."""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets

import bcrypt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import LoginAttempt, User, UserSession

SESSION_COOKIE = 'ft_session'
CSRF_COOKIE = 'ft_csrf'
CSRF_HEADER = 'X-CSRF-Token'
SAFE_METHODS = {'GET', 'HEAD', 'OPTIONS'}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def client_ip(request: Request) -> str | None:
    fwd = request.headers.get('x-forwarded-for')
    return fwd.split(',')[0].strip() if fwd else (request.client.host if request.client else None)


def login_locked(db: Session, login: str) -> bool:
    since = now() - dt.timedelta(minutes=settings.login_window_minutes)
    fails = db.scalar(select(func.count()).select_from(LoginAttempt)
                      .where(LoginAttempt.login == login, LoginAttempt.success.is_(False), LoginAttempt.at >= since))
    return (fails or 0) >= settings.login_max_failures


def create_session(db: Session, user: User, request: Request) -> tuple[str, str]:
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    db.add(UserSession(token_hash=_hash_token(token), user_id=user.id, csrf_token=csrf,
                       expires_at=now() + dt.timedelta(days=settings.session_days),
                       ip=client_ip(request), user_agent=(request.headers.get('user-agent') or '')[:256]))
    return token, csrf


def find_session(db: Session, token: str | None) -> UserSession | None:
    if not token:
        return None
    s = db.scalar(select(UserSession).where(UserSession.token_hash == _hash_token(token)))
    if not s or s.revoked_at or s.expires_at < now() or not s.user.is_active:
        return None
    return s


def current_session(request: Request, db: Session = Depends(get_db)) -> UserSession:
    s = find_session(db, request.cookies.get(SESSION_COOKIE))
    if not s:
        raise HTTPException(401, 'Войдите в систему')
    if request.method not in SAFE_METHODS:
        sent = request.headers.get(CSRF_HEADER, '')
        if not secrets.compare_digest(sent, s.csrf_token):
            raise HTTPException(403, 'Страница устарела. Обновите её и повторите действие.')
    return s


def current_user(s: UserSession = Depends(current_session)) -> User:
    return s.user


def require_roles(*roles: str):
    """Зависимость маршрута: пускает только перечисленные роли, остальным — 403."""
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, 'Недостаточно прав для этого действия')
        return user
    dep.roles = roles  # для теста, перебирающего все маршруты
    return dep
