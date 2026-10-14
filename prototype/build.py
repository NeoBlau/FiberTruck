"""Собирает прототип FiberTrack в один HTML-файл.

python3 -I prototype/build.py <прибыль.xlsx> <парк.xlsx> <выход.html>
"""
import datetime as dt, json, pathlib, sys
from collections import defaultdict

here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here.parent / 'backend'))
from app.parsing import parse_sources  # noqa: E402  — тот же разбор, что и в рабочей версии

profit, park, out = sys.argv[1:4]
src = parse_sources(profit, park)
dic, idx = [], {}


def code(t):
    if t is None:
        return None
    if t not in idx:
        idx[t] = len(dic)
        dic.append(t)
    return idx[t]


for m in src['schedule']:
    for r in m['rows']:
        tx = r.pop('tx')
        r.pop('row', None); r.pop('raw', None)
        r['tx'] = [code(t) for t in tx] if m['ym'].startswith('2026') else None
fm = defaultdict(lambda: defaultdict(lambda: {'rn': 0.0, 'e100': 0.0, 'gl': 0.0, 'gl_days': 0, 'card_days': 0, 'anomaly': 0}))
for k, days in src['fuel_daily'].items():
    for d, (rn, e1, gl) in days.items():
        f = fm[d[:7]][k]
        f['rn'] += rn; f['e100'] += e1; f['card_days'] += 1 if rn or e1 else 0
        if gl > 1500: f['anomaly'] += 1
        elif gl > 0: f['gl'] += gl; f['gl_days'] += 1
payload = {'generated': dt.date.today().isoformat(), 'vehicles': src['vehicles'], 'profit': src['profit'], 'shared': src['shared'],
           'bench': src['bench'], 'schedule': src['schedule'], 'textdic': dic, 'fuel_month': {k: dict(v) for k, v in fm.items()},
           'idle_hist': src['idle_hist'], 'review': src['review']}
data = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
html = (here / 'shell.html').read_text(encoding='utf-8')
parts = {
    '/*__CSS__*/': (here / 'app.css').read_text(encoding='utf-8'),
    '/*__ECHARTS__*/': (here.parent / 'mockup' / 'vendor' / 'echarts.min.js').read_text(encoding='utf-8'),
    '/*__DATA__*/': data.replace('</', '<\\/'),
    '/*__APP__*/': (here / 'app.js').read_text(encoding='utf-8'),
}
for k, v in parts.items():
    assert '</script' not in v.lower() or k == '/*__CSS__*/', k
    html = html.replace(k, v, 1)
pathlib.Path(out).write_text(html, encoding='utf-8')
print('готово:', out, round(len(html.encode()) / 1024), 'КБ')
