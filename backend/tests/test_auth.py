from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import PASSWORD, login


def test_wrong_password_is_rejected():
    c = TestClient(app)
    assert c.post('/api/auth/login', json={'login': 'admin', 'password': 'нет'}).status_code == 401


def test_login_is_locked_after_five_failures():
    c = TestClient(app)
    for _ in range(5):
        assert c.post('/api/auth/login', json={'login': 'admin', 'password': 'нет'}).status_code == 401
    r = c.post('/api/auth/login', json={'login': 'admin', 'password': PASSWORD})
    assert r.status_code == 429          # даже верный пароль — пауза
    assert 'попыток' in r.json()['detail']


def test_session_cookie_is_httponly():
    c = TestClient(app)
    r = c.post('/api/auth/login', json={'login': 'viewer', 'password': PASSWORD})
    cookies = r.headers.get_list('set-cookie')
    session = next(x for x in cookies if x.startswith('ft_session='))
    assert 'HttpOnly' in session and 'SameSite=lax' in session
    assert 'HttpOnly' not in next(x for x in cookies if x.startswith('ft_csrf='))


def test_logout_revokes_session():
    c = login('admin')
    assert c.get('/api/bootstrap').status_code == 200
    assert c.post('/api/auth/logout').status_code == 200
    c.cookies.clear()
    assert c.get('/api/bootstrap').status_code == 401


def test_mutation_without_csrf_is_forbidden():
    c = login('admin')
    del c.headers['X-CSRF-Token']
    r = c.patch('/api/vehicles/885', json={'plate': 'Т885ВХ58'})
    assert r.status_code == 403


def test_everything_except_login_and_health_requires_session():
    c = TestClient(app)
    for path, method in [('/api/bootstrap', 'get'), ('/api/auth/me', 'get'), ('/api/settings', 'put'), ('/api/vehicles', 'post'),
                         ('/api/vehicles/885', 'patch'), ('/api/periods/2026-11/open', 'post'), ('/api/input/2026-10/885', 'put'),
                         ('/api/review/1/resolve', 'post')]:
        assert c.request(method.upper(), path, json={} if method != 'get' else None).status_code == 401, path
    assert c.get('/api/health').status_code == 200


def test_init_users_creates_three_roles_once():
    from app.cli import init_users
    from app.db import SessionLocal
    from app.models import User
    from sqlalchemy import delete
    with SessionLocal() as db:
        db.execute(delete(User))
        db.commit()
    first = init_users()
    assert [(r[0], r[1]) for r in first] == [('owner', 'admin'), ('boss', 'viewer'), ('buh', 'input')]
    assert all(r[3] and len(r[3]) == 19 for r in first)
    for login, _, _, pw in first:
        assert TestClient(app).post('/api/auth/login', json={'login': login, 'password': pw}).status_code == 200
    again = init_users()
    assert all(r[3] is None for r in again)            # повторный запуск пароли не меняет
    reset = init_users(reset=True)
    assert reset[0][3] != first[0][3]
    assert TestClient(app).post('/api/auth/login', json={'login': 'owner', 'password': first[0][3]}).status_code == 401
