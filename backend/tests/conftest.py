import os

os.environ.setdefault('FT_DATABASE_URL', os.environ.get('FT_TEST_DATABASE_URL', 'postgresql+psycopg://postgres@/fibertrack_test?host=/tmp&port=5433'))
os.environ['FT_COOKIE_SECURE'] = 'false'
os.environ['FT_LOGIN_MAX_FAILURES'] = '5'

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Operation, Period, ReviewItem, ScheduleMonth, User, Vehicle  # noqa: E402
from app.security import hash_password  # noqa: E402

PASSWORD = 'Test-pass-123'
ROLES = ('admin', 'viewer', 'input')
SECRET_PROFIT_RUB = 777_123   # уникальное число: не должно утечь бухгалтеру


@pytest.fixture(scope='session', autouse=True)
def schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def clean_db():
    with engine.begin() as c:
        c.execute(text('TRUNCATE ' + ', '.join(t.name for t in Base.metadata.sorted_tables) + ' RESTART IDENTITY CASCADE'))
    with SessionLocal() as db:
        _hash = hash_password(PASSWORD)
        for r in ROLES:
            db.add(User(login=r, full_name=f'Тест {r}', role=r, password_hash=_hash))
        v = Vehicle(key='885', name='885', plate='Т885ВХ58', make='DAF', model='DAF FT 105', year=2013, amort_kop=54_000_00)
        v2 = Vehicle(key='409', name='409', make='FAW', year=2026)
        db.add_all([v, v2])
        db.flush()
        db.add_all([Period(ym='2026-08', status='closed'), Period(ym='2026-10', status='open')])
        db.add(Operation(ym='2026-08', vehicle_id=v.id, article='profit_total', amount_gross_kop=SECRET_PROFIT_RUB * 100,
                         amount_net_kop=SECRET_PROFIT_RUB * 100, vat_kop=0, vat_mode='unknown', source='import'))
        db.add(Operation(ym='2026-08', vehicle_id=None, article='shared_gen', amount_gross_kop=-1_000_00, amount_net_kop=-1_000_00,
                         vat_kop=0, vat_mode='unknown', source='import'))
        db.add(ScheduleMonth(ym='2026-10', vehicle_id=v.id, codes='TTTTT', texts=['ЛЬВОВСКИЙ-БЕЛГОРОД'] * 5, totals=None,
                             calc={'worked': 5}, source_row=1))
        db.add(ReviewItem(kind='Машина без госномера', value='409', where_text='график', action='нет в листе «АВТО»'))
        db.commit()
    yield


def login(role: str) -> TestClient:
    c = TestClient(app)
    r = c.post('/api/auth/login', json={'login': role, 'password': PASSWORD})
    assert r.status_code == 200, r.text
    c.headers['X-CSRF-Token'] = c.cookies.get('ft_csrf')
    return c


@pytest.fixture
def as_role():
    return login
