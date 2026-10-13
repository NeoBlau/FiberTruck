"""Собирает прототип FiberTrack в один HTML-файл.

python3 -I prototype/build.py <прибыль.xlsx> <парк.xlsx> <выход.html>
"""
import json, pathlib, subprocess, sys, tempfile

here = pathlib.Path(__file__).resolve().parent
profit, park, out = sys.argv[1:4]
with tempfile.TemporaryDirectory() as td:
    data_path = pathlib.Path(td) / 'ft.json'
    subprocess.run([sys.executable, '-I', str(here / 'build_data.py'), profit, park, str(data_path)], check=True)
    data = data_path.read_text(encoding='utf-8')
json.loads(data)
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
