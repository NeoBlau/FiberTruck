import pytest

from app.fuel_stats import build_fuel_statistics
from tests.conftest import login

SETTINGS={'lMin':20,'lMax':45,'fuelJumpPct':20}


def stats(fuel, km=None, finances=None):
    return build_fuel_statistics(fuel,km or {},finances or {},SETTINGS)


def monthly(liters):
    return {'monthly_liters':liters}


def codes(row):
    return {flag['code'] for flag in row['flags']}


def test_weighted_rate_and_high_volume_with_proportional_mileage_is_normal():
    data=stats({'2026-10':{'a':monthly(9000),'b':monthly(1800)}},{'2026-10':{'a':30000,'b':3000}})['2026-10']
    rows={r['key']:r for r in data['rows']}
    assert rows['a']['rate']==30 and not rows['a']['flags']
    assert rows['b']['rate']==60 and codes(rows['b'])=={'high_rate'}
    assert rows['b']['above_limit_liters']==450
    assert data['fleet_rate']==pytest.approx(10800/33000*100)
    assert data['high_rate_vehicles']==1


def test_month_comparison_uses_rate_not_absolute_liters():
    data=stats({'2026-09':{'a':monthly(3000),'b':monthly(3000)},'2026-10':{'a':monthly(6000),'b':monthly(2000)}},
               {'2026-09':{'a':10000,'b':10000},'2026-10':{'a':20000,'b':4000}})['2026-10']
    a,b=data['rows']
    assert a['rate']==30 and a['change_pct']==0 and not a['flags']
    assert b['rate']==50 and b['change_pct']==pytest.approx(66.6666666667)
    assert codes(b)=={'high_rate','rate_jump'}


def test_missing_and_zero_values_are_distinct_and_no_infinite_rates():
    data=stats({'2026-10':{'a':monthly(2000),'b':monthly(0),'c':monthly(3000)}},
               {'2026-10':{'a':0,'b':10000,'d':10000}})['2026-10']
    r={row['key']:row for row in data['rows']}
    assert r['a']['rate'] is None and codes(r['a'])=={'zero_km'}
    assert r['b']['rate']==0 and codes(r['b'])=={'zero_liters'}
    assert r['c']['rate'] is None and codes(r['c'])=={'missing_km'}
    assert r['d']['liters'] is None and codes(r['d'])=={'missing_liters'}
    assert data['comparable_vehicles']==1 and data['liters_vehicles']==3 and data['missing_km_vehicles']==2
    assert data['total_cost'] is None


def test_gap_month_does_not_compare_to_last_available_month():
    data=stats({'2026-08':{'a':monthly(3000)},'2026-10':{'a':monthly(6000)}},
               {'2026-08':{'a':10000},'2026-10':{'a':10000}})['2026-10']['rows'][0]
    assert data['previous_rate'] is None and data['change_pct'] is None
    assert 'rate_jump' not in codes(data)


def test_card_data_and_glonass_only_are_not_confused_with_monthly_liters():
    data=stats({'2026-10':{'a':{'rn':2000,'e100':1000,'card_days':3},'b':{'rn':0,'e100':0,'card_days':0,'gl':4000,'gl_days':4}}},
               {'2026-10':{'a':10000,'b':10000}})['2026-10']
    rows={r['key']:r for r in data['rows']}
    assert rows['a']['liters']==3000 and rows['a']['rate']==30
    assert rows['b']['liters'] is None and data['liters_vehicles']==1


def test_money_is_optional_and_keeps_explicit_zero_and_coverage():
    data=stats({'2026-10':{'a':monthly(3000),'b':monthly(3000)}},
               {'2026-10':{'a':10000,'b':10000}},
               {'2026-10':{'cars':{'a':{'g':{'fuel':122000}},'b':{'g':{'fuel':0}}}}})['2026-10']
    assert data['total_cost']==122000 and data['cost_vehicles']==2
    assert data['rows'][0]['cost_per_km']==12.2 and data['rows'][1]['cost_per_km']==0


def test_threshold_boundaries_and_january_comparison():
    data=stats({'2026-12':{'a':monthly(3000)},'2027-01':{'a':monthly(3600),'b':monthly(4500)}},
               {'2026-12':{'a':10000},'2027-01':{'a':10000,'b':10000}})['2027-01']
    assert not data['rows'][0]['flags'] and not data['rows'][1]['flags']


def test_input_role_does_not_receive_fuel_statistics():
    assert login('input').get('/api/bootstrap').json()['fuel_stats']=={}


@pytest.mark.parametrize('settings',[{'fuelJumpPct':0},{'fuelJumpPct':'NaN'},{'lMin':50,'lMax':45},{'lMin':-1}])
def test_invalid_threshold_settings_rejected(settings):
    assert login('admin').put('/api/settings',json=settings).status_code==422


def test_new_threshold_can_be_saved_and_seen_by_viewer():
    c=login('admin')
    assert c.put('/api/settings',json={'fuelJumpPct':30,'lMin':15,'lMax':50}).status_code==200
    assert login('viewer').get('/api/bootstrap').json()['settings']['fuelJumpPct']==30


def test_api_statistics_link_monthly_liters_mileage_money_and_live_thresholds():
    from tests.test_monthly_fuel import monthly as monthly_file
    from tests.test_uploads import upload
    c=login('admin')
    assert c.put('/api/input/2026-10/885',json={'km':10000,'days':20,'amounts':{'fuel':325000,'revenue':1220000}}).status_code==200
    p=upload(c,monthly_file(c,5000)).json()
    assert c.post(f"/api/uploads/{p['id']}/apply").status_code==200
    before=c.get('/api/bootstrap').json()
    row=before['fuel_stats']['2026-10']['rows'][0]
    assert row['rate']==50 and row['cost_per_km']==32.5 and codes(row)=={'high_rate'}
    assert c.put('/api/settings',json={'lMax':55}).status_code==200
    after=login('viewer').get('/api/bootstrap').json()
    assert after['fuel_stats']['2026-10']['rows'][0]['flags']==[]
    for field in ['fin','km','wdays','fuel_month']:
        assert before[field]==after[field]
