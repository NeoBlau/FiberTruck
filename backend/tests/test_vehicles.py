from tests.conftest import login


def test_plate_is_normalised_and_review_item_resolved():
    u = login('input')
    r = u.patch('/api/vehicles/409', json={'plate': 'у 409 ek 58', 'make': 'FAW', 'year': 2026})
    assert r.status_code == 200 and r.json()['plate'] == 'У409ЕК58'
    d = u.get('/api/bootstrap').json()
    assert not [x for x in d['review'] if x['value'] == '409']
    assert any(x['car'] == '409' and x['field'] == 'Госномер' and x['after'] == 'У409ЕК58' for x in d['audit'])


def test_duplicate_and_malformed_plate():
    u = login('admin')
    r = u.patch('/api/vehicles/409', json={'plate': 'Т885ВХ58'})
    assert r.status_code == 422 and 'уже у машины 885' in r.json()['detail']['plate']
    r = u.patch('/api/vehicles/409', json={'plate': 'X1'})
    assert r.status_code == 422 and 'plate' in r.json()['detail']


def test_create_vehicle_and_duplicates():
    u = login('input')
    r = u.post('/api/vehicles', json={'short': '777 ф', 'plate': 'У777ЕК58', 'make': 'FAW', 'year': 2026, 'active': True})
    assert r.status_code == 200 and r.json()['name'] == '777 Ф' and r.json()['manual'] is True
    r = u.post('/api/vehicles', json={'short': '0885'})
    assert r.status_code == 422 and 'short' in r.json()['detail']


def test_viewer_cannot_edit_but_sees_directory():
    v = login('viewer')
    assert v.patch('/api/vehicles/885', json={'plate': 'Т885ВХ58'}).status_code == 403
    assert '885' in v.get('/api/bootstrap').json()['vehicles']
