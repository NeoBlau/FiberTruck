"""Права проверяются на сервере. Бухгалтер не получает агрегатов ни в каком виде."""
import json

import pytest
from fastapi.routing import APIRoute

from app.main import app
from tests.conftest import SECRET_PROFIT_RUB, login

# Кому разрешён каждый изменяющий маршрут. Новый маршрут без записи здесь — тест упадёт.
MATRIX = {
    ('PUT', '/api/settings'): {'admin'},
    ('POST', '/api/vehicles'): {'admin', 'input'},
    ('PATCH', '/api/vehicles/{key}'): {'admin', 'input'},
    ('POST', '/api/periods/{ym}/open'): {'admin'},
    ('POST', '/api/periods/{ym}/close'): {'admin'},
    ('POST', '/api/periods/{ym}/reopen'): {'admin'},
    ('PUT', '/api/input/{ym}/{key}'): {'admin', 'input'},
    ('POST', '/api/review/{item_id}/resolve'): {'admin', 'input'},
}
OPEN_TO_ALL = {('POST', '/api/auth/login'), ('POST', '/api/auth/logout'), ('GET', '/api/auth/me'), ('GET', '/api/bootstrap'), ('GET', '/api/health')}
SAMPLE = {'{key}': '885', '{ym}': '2026-12', '{item_id}': '1'}


def api_routes():
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path.startswith('/api'):
            for m in r.methods:
                yield m, r.path


def test_every_api_route_is_classified():
    unknown = [x for x in api_routes() if x not in MATRIX and x not in OPEN_TO_ALL]
    assert not unknown, f'Маршруты без правил доступа: {unknown}'


@pytest.mark.parametrize('route,allowed', MATRIX.items(), ids=[f'{m} {p}' for m, p in MATRIX])
@pytest.mark.parametrize('role', ['admin', 'viewer', 'input'])
def test_route_permissions(route, allowed, role):
    method, path = route
    for k, v in SAMPLE.items():
        path = path.replace(k, v)
    r = login(role).request(method, path, json={})
    if role in allowed:
        assert r.status_code != 403, f'{role} должен иметь доступ к {method} {path}: {r.text}'
    else:
        assert r.status_code == 403, f'{role} не должен иметь доступ к {method} {path}'


def test_input_role_gets_no_aggregates():
    d = login('input').get('/api/bootstrap').json()
    assert d['profit'] == {} and d['shared'] == {} and d['fuel_month'] == {} and d['idle_hist'] == {} and d['bench'] == {}
    assert d['textdic'] == []
    # от графика — только состав машин, без статусов по дням и итогов
    assert all(set(r) == {'k'} for m in d['schedule'] for r in m['rows'])
    raw = json.dumps(d, ensure_ascii=False)
    assert str(SECRET_PROFIT_RUB) not in raw and 'profit_total' not in raw
    # закрытые месяцы бухгалтеру ни к чему: ввод только по открытым
    assert set(d['input']) <= {ym for ym, s in d['periods'].items() if s == 'open'}


def test_viewer_and_admin_get_profit():
    for role in ('admin', 'viewer'):
        d = login(role).get('/api/bootstrap').json()
        assert d['profit']['885'][7] == SECRET_PROFIT_RUB
        assert d['shared']['gen'][7] == -1000
