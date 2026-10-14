from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import LoginAttempt, User
from ..security import (CSRF_COOKIE, SESSION_COOKIE, client_ip, create_session, current_session, login_locked, now,
                        verify_password)

router = APIRouter(prefix='/api/auth', tags=['auth'])
ROLE_NAMES = {'admin': 'Владелец', 'viewer': 'Руководитель', 'input': 'Бухгалтер'}


class LoginIn(BaseModel):
    login: str
    password: str


def me_payload(user: User) -> dict:
    return {'login': user.login, 'name': user.full_name, 'role': user.role, 'role_name': ROLE_NAMES[user.role]}


@router.post('/login')
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    login_ = data.login.strip().lower()
    if login_locked(db, login_):
        raise HTTPException(429, f'Слишком много неудачных попыток. Попробуйте через {settings.login_window_minutes} минут.')
    user = db.scalar(select(User).where(User.login == login_))
    ok = bool(user and user.is_active and verify_password(data.password, user.password_hash))
    db.add(LoginAttempt(login=login_, ip=client_ip(request), success=ok))
    if not ok:
        db.commit()
        raise HTTPException(401, 'Неверный логин или пароль')
    token, csrf = create_session(db, user, request)
    user.last_login_at = now()
    db.commit()
    max_age = settings.session_days * 86400
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=settings.cookie_secure, samesite='lax', path='/')
    response.set_cookie(CSRF_COOKIE, csrf, max_age=max_age, httponly=False, secure=settings.cookie_secure, samesite='lax', path='/')
    return me_payload(user)


@router.post('/logout')
def logout(response: Response, s=Depends(current_session), db: Session = Depends(get_db)):
    db.get(type(s), s.id).revoked_at = now()
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path='/')
    response.delete_cookie(CSRF_COOKIE, path='/')
    return {'ok': True}


@router.get('/me')
def me(s=Depends(current_session)):
    return me_payload(s.user)
