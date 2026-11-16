"""Fuel checks use same-month mileage; volume alone never establishes overspending."""

def previous_month(ym):
    year, month = map(int, ym.split('-'))
    return f'{year-1}-12' if month == 1 else f'{year}-{month-1:02d}'


def liters_of(value):
    if not value:
        return None
    if 'monthly_liters' in value:
        return value['monthly_liters']
    return value.get('rn', 0) + value.get('e100', 0) if value.get('card_days', 0) > 0 else None


def build_fuel_statistics(fuel, mileage, finances, settings):
    minimum, maximum = settings['lMin'], settings['lMax']
    jump_limit = settings.get('fuelJumpPct', 20)
    months = sorted(set(fuel) | set(mileage) | {ym for ym, f in finances.items() if any('fuel' in c.get('g', {}) for c in f.get('cars', {}).values())})
    output = {}
    for ym in months:
        fm, km = fuel.get(ym, {}), mileage.get(ym, {})
        money = finances.get(ym, {}).get('cars', {})
        keys = set(fm) | set(km) | {k for k, c in money.items() if 'fuel' in c.get('g', {})}
        prior = previous_month(ym)
        rows = []
        for key in sorted(keys):
            liters, distance = liters_of(fm.get(key)), km.get(key)
            cost = money.get(key, {}).get('g', {}).get('fuel')
            rate = liters / distance * 100 if liters is not None and distance is not None and distance > 0 else None
            old_liters, old_km = liters_of(fuel.get(prior, {}).get(key)), mileage.get(prior, {}).get(key)
            old_rate = old_liters / old_km * 100 if old_liters is not None and old_km is not None and old_km > 0 else None
            change = (rate / old_rate - 1) * 100 if rate is not None and old_rate is not None and old_rate > 0 else None
            flags = []
            def flag(code, text, severity='warn'):
                flags.append({'code': code, 'text': text, 'severity': severity})
            if liters is None:
                flag('missing_liters', 'Не внесены литры за месяц')
            if distance is None:
                flag('missing_km', 'Не внесён пробег')
            elif distance == 0 and liters is not None and liters > 0:
                flag('zero_km', 'Литры есть, пробег равен нулю')
            if liters == 0 and distance is not None and distance > 0:
                flag('zero_liters', 'Пробег есть, литры равны нулю')
            elif rate is not None and rate > maximum + 1e-9:
                flag('high_rate', f'Выше порога {maximum:g} л/100 км', 'alert')
            elif rate is not None and rate < minimum - 1e-9:
                flag('low_rate', f'Ниже порога {minimum:g} л/100 км — проверьте полноту данных')
            if change is not None and change > jump_limit + 1e-9:
                flag('rate_jump', f'Рост л/100 км больше {jump_limit:g}% к предыдущему месяцу')
            rows.append({'key': key, 'liters': liters, 'km': distance, 'cost': cost, 'rate': rate,
                         'previous_rate': old_rate, 'change_pct': change,
                         'cost_per_km': cost / distance if cost is not None and distance is not None and distance > 0 else None,
                         'above_limit_liters': max(0, liters - distance * maximum / 100) if rate is not None else None,
                         'flags': flags})
        comparable = [r for r in rows if r['rate'] is not None]
        known_liters = [r['liters'] for r in rows if r['liters'] is not None]
        costs = [r['cost'] for r in rows if r['cost'] is not None]
        distance = sum(r['km'] for r in comparable)
        output[ym] = {'rows': rows, 'total_liters': sum(known_liters) if known_liters else None,
                      'fleet_rate': sum(r['liters'] for r in comparable) / distance * 100 if distance else None,
                      'total_cost': sum(costs) if costs else None,
                      'vehicles': len(rows), 'liters_vehicles': len(known_liters),
                      'comparable_vehicles': len(comparable), 'cost_vehicles': len(costs),
                      'review_vehicles': sum(bool(r['flags']) for r in rows),
                      'high_rate_vehicles': sum(any(f['code'] == 'high_rate' for f in r['flags']) for r in rows),
                      'missing_km_vehicles': sum(r['km'] is None or (r['km'] == 0 and (r['liters'] or 0) > 0) for r in rows)}
    return output
