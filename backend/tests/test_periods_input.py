from tests.conftest import login


def test_owner_opens_november_and_input_sees_it():
    a = login('admin')
    assert a.post('/api/periods/2026-11/open').status_code == 200
    d = login('input').get('/api/bootstrap').json()
    assert d['periods']['2026-11'] == 'open'


def test_cannot_open_too_far_ahead():
    r = login('admin').post('/api/periods/2030-01/open')
    assert r.status_code == 409


def test_reopen_requires_reason_and_is_logged():
    a = login('admin')
    assert a.post('/api/periods/2026-08/reopen', json={}).status_code == 422
    assert a.post('/api/periods/2026-08/reopen', json={'reason': 'исправление выручки'}).status_code == 200
    log = a.get('/api/bootstrap').json()['audit']
    assert any('исправление выручки' in x['field'] and x['after'] == 'открыт' for x in log)


def test_input_into_closed_month_is_refused():
    r = login('input').put('/api/input/2026-08/885', json={'km': 1000})
    assert r.status_code == 409


def test_input_validation():
    u = login('input')
    r = u.put('/api/input/2026-10/885', json={'km': 99_999})
    assert r.status_code == 422 and 'km' in r.json()['detail']
    r = u.put('/api/input/2026-10/885', json={'days': 32})
    assert r.status_code == 422 and 'days' in r.json()['detail']
    r = u.put('/api/input/2026-10/885', json={'rev': 100, 'vat': 'без НДС', 'gross': True})
    assert r.status_code == 422
    r = u.put('/api/input/2026-10/885', json={'fuel': -5})
    assert r.status_code == 422


def test_vat_split_and_replace_on_resave():
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Operation
    u = login('input')
    assert u.put('/api/input/2026-10/885', json={'km': 11200, 'rev': 12200, 'vat': '22%', 'gross': True}).status_code == 200
    assert u.put('/api/input/2026-10/885', json={'km': 11300, 'rev': 10000, 'vat': '22%', 'gross': False}).status_code == 200
    with SessionLocal() as db:
        ops = list(db.scalars(select(Operation).where(Operation.source == 'manual')))
    assert len(ops) == 1                                    # повторное сохранение заменило прежнее
    assert (ops[0].amount_gross_kop, ops[0].amount_net_kop, ops[0].vat_kop) == (12200_00, 10000_00, 2200_00)
    e = u.get('/api/bootstrap').json()['input']['2026-10']['885']
    assert e['km'] == 11300 and e['rev'] == 10000 and e['gross'] is False
