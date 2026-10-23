"""Разбор исходных xlsx заказчика: «прибыль по машинам» и «парк».

parse_sources() возвращает машины, график, прибыль, общие расходы, заправки, сводку простоев
и список того, что не сопоставилось (review). Ничего не угадывает.
"""
from __future__ import annotations

import calendar
import datetime as dt
import re
from collections import Counter, defaultdict

import openpyxl

MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август',
             'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
review: list[dict] = []


def grid(ws) -> list[list]:
    """Весь лист списком строк одинаковой длины — в разы быстрее, чем ws.cell() по одной ячейке."""
    mc = ws.max_column
    out = []
    for row in ws.iter_rows(values_only=True):
        row = list(row)
        out.append(row + [None] * (mc - len(row)) if len(row) < mc else row)
    return out


def norm(v) -> str:
    return re.sub(r'\s+', ' ', str(v).replace('\xa0', ' ').strip().upper())


# ---------- номера машин ----------
TWINS = {'20', '308', '700'}
MAKE_LETTER = {'DAF': 'Д', 'МАН': 'М', 'MAN': 'М', 'FAW': 'Ф', 'ФАВ': 'Ф'}


def car_key(raw, y: int | None = None, m: int | None = None) -> str | None:
    """Короткий номер → канонический ключ: '885', '308М', '20Ф'. Ведущие нули отбрасываются."""
    s = norm(raw)
    if re.fullmatch(r'\d+\.0', s):
        s = s[:-2]
    d = re.search(r'\d{2,3}', s)
    if not d:
        return None
    num = str(int(d.group()))
    suf = ''
    mm = re.search(r'\(\s*([МДФ])\s*\)|^\d+\s*([МДФ])\b|\b(DAF|МАН|MAN|FAW|ФАВ)\b|\d\s+([МДФ])\s', s + ' ')
    if mm:
        t = [g for g in mm.groups() if g][0]
        suf = MAKE_LETTER.get(t, t)
    if num not in TWINS:
        return num  # у номера нет двойника — суффикс («069 ФАВ», «МАН 606») не нужен
    # До раздвоения номера были только машины MAN: 020 = С020ВТ58, 700 = А700ХС164
    if num in ('20', '700') and not suf:
        suf = 'М'
    return num + suf


def display(key: str) -> str:
    m = re.fullmatch(r'(\d+)([МДФ]?)', key)
    if not m:
        return key
    n, s = m.groups()
    return n.zfill(3) + (f' {s}' if s else '')


# ---------- статусы дня ----------
def classify(s: str) -> str:
    if s in ('НЕТ ВОДИТЕЛЯ', 'БЕЗ ВОДИТЕЛЯ'):
        return 'D'
    if s.startswith('МОЙКА') or s.startswith('ДЕФ') or s == 'ДЕФЕКТОВКА':
        return 'W'
    if not s.startswith('ПРОСТОЙ') and any(k in s for k in ('РЕМОНТ', 'ДТП', 'ПОЛОМКА', 'НЕПОДАЧА', 'ЭВАКУАЦИЯ', 'ПОМОЩЬ НА ДОРОГЕ')):
        return 'R'
    if s.startswith('ПРОСТОЙ') or s in ('ОТМЕНА ЗАЯВКИ', 'ПОЧТА ОТМЕНИЛА', 'СТОИТ НА СТОЯНКЕ'):
        return 'I'
    if s.startswith('ВЫХОДНОЙ') or s == 'ОТПУСК':
        return 'O'
    if s == 'ПРОДАЖА':
        return 'S'
    if s in ('ПОДГОТОВКА К РАБОТЕ', 'НОВЫЙ ТЯГАЧ', 'ПОСТАНОВКА НА УЧЕТ', 'УЧЕТ'):
        return 'G'
    return 'T'


TOT_FIELDS = ['worked', 'no_driver', 'loading', 'unloading', 'idle', 'planned', 'unplanned']


def label_field(lab: str) -> str | None:
    if 'ОТРАБОТ' in lab:
        return 'worked'
    if 'НЕТ ВОДИТЕЛЯ' in lab:
        return 'no_driver'
    if 'ЗАГРУЗК' in lab:
        return 'loading'
    if 'ВЫГРУЗК' in lab:
        return 'unloading'
    if 'ЗАЯВК' in lab:
        return 'idle'
    if 'НЕПЛАН' in lab:
        return 'unplanned'
    if 'ПЛАНОВ' in lab or 'ТО/РЕМОНТ' in lab:
        return 'planned'
    return None


SCHEDULE_SHEET = re.compile(r'^\s*(20\d\d|\d{2}\.\d{2}\.20\d\d)\s*$')


def schedule_sheets(wb) -> list[str]:
    """Листы графика: по договорённости называются годом («2025») или датой выгрузки («02.10.2026»)."""
    return [n for n in wb.sheetnames if SCHEDULE_SHEET.match(n)]


def parse_schedule(wb, only_check: bool = False):
    if only_check:
        return bool(schedule_sheets(wb))
    months = []  # [{y,m,rows:[{key,raw,codes,texts,tot}]}]
    for name in schedule_sheets(wb):
        ws = wb[name]
        g = grid(ws)
        mc = ws.max_column
        cur = None
        for i, row in enumerate(g):
            dcols = [c for c, v in enumerate(row) if isinstance(v, dt.datetime)]
            if len(dcols) >= 5:
                d0 = row[dcols[0]]
                nd = calendar.monthrange(d0.year, d0.month)[1]
                first = dcols[0] - (d0.day - 1)
                cols = list(range(first, first + nd))
                fmap: dict[int, str] = {}
                for rr in (i - 1, i, i + 1):  # ниже по строке — точнее
                    if 0 <= rr < len(g):
                        for c in range(first + nd, mc):
                            v = g[rr][c]
                            if isinstance(v, str):
                                f = label_field(norm(v))
                                if f:
                                    fmap[c] = f
                cur = {'y': d0.year, 'm': d0.month, 'cols': cols, 'fmap': fmap, 'rows': [], 'seen': set(),
                       'sheet': name, 'hdr': i + 1}
                months.append(cur)
                continue
            if not cur or row[1] is None or norm(row[1]) in ('№ АВТО', ''):
                continue
            key = car_key(row[1], cur['y'], cur['m'])
            if key is None:
                continue
            if key in cur['seen']:
                review.append({'kind': 'Дубль машины в графике', 'value': str(row[1]),
                               'where': f"лист «{name}», строка {i + 1}, {MONTHS_RU[cur['m'] - 1]} {cur['y']}",
                               'action': 'взята первая строка, вторая пропущена'})
                continue
            cur['seen'].add(key)
            texts = []
            for c in cur['cols']:
                v = row[c] if c < len(row) else None
                texts.append(norm(v) if isinstance(v, str) and v.strip() else None)
            tot = {}
            for c, f in cur['fmap'].items():
                v = row[c] if c < len(row) else None
                if isinstance(v, (int, float)):
                    tot[f] = tot.get(f, 0) + int(v)
            cur['rows'].append({'key': key, 'raw': norm(row[1]), 'texts': texts, 'tot': tot or None, 'row': i + 1})
    months.sort(key=lambda b: (b['y'], b['m']))
    # коды по дням: пустая ячейка после рейса = продолжение рейса (t), в том числе через границу месяца
    last_state: dict[str, str] = {}
    for b in months:
        for r in b['rows']:
            codes = []
            prev = last_state.get(r['key'])
            for t in r['texts']:
                if t is None:
                    c = 't' if prev in ('T', 't') else '.'
                else:
                    c = classify(t)
                codes.append(c)
                if c != '.':
                    prev = c
            last_state[r['key']] = prev
            r['codes'] = ''.join(codes)
            cnt = Counter(codes)
            r['calc'] = {'worked': cnt['T'] + cnt['t'], 'no_driver': cnt['D'], 'idle': cnt['I'] + cnt['O'],
                         'planned': cnt['W'], 'unplanned': cnt['R'], 'loading': 0, 'unloading': 0}
    return months


def find_profit_sheet(wb):
    """Лист таблицы прибыли: строка заголовка с «январь» … «декабрь» и «амортизация»."""
    for ws in wb.worksheets:
        for r in range(1, min(ws.max_row, 15) + 1):
            row = [norm(ws.cell(r, c).value) for c in range(1, min(ws.max_column, 20) + 1)]
            if 'ЯНВАРЬ' in row and any(x.startswith('АМОРТИЗАЦИЯ') for x in row):
                return ws, r
    return None, None


def profit_year(ws, header_row: int) -> int:
    for r in range(1, header_row + 1):
        m = re.search(r'(20\d\d)', str(ws.cell(r, 1).value or ''))
        if m:
            return int(m.group(1))
    return dt.date.today().year


def parse_profit(path_or_wb):
    wb = path_or_wb if hasattr(path_or_wb, 'worksheets') else openpyxl.load_workbook(path_or_wb, data_only=True)
    ws, header = find_profit_sheet(wb)
    if ws is None:
        ws, header = wb['Лист1'], 5
    cars, shared, notes = {}, {}, []
    for r in range(header + 1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        if a is None:
            continue
        vals = [ws.cell(r, c).value for c in range(3, 15)]
        s = norm(a)
        if s in ('ТРАКТОР', 'ОБЩЕХОЗ', 'СЕРВИС', 'АМОРТИЗАЦИЯ', 'ОБЩИЙ'):
            shared[{'ТРАКТОР': 'tractor', 'ОБЩЕХОЗ': 'gen', 'СЕРВИС': 'service', 'АМОРТИЗАЦИЯ': 'amort', 'ОБЩИЙ': 'total'}[s]] = \
                [round(v, 2) if isinstance(v, (int, float)) else None for v in vals]
            continue
        if s.startswith('СЕБЕСТОИМОСТЬ') or s.startswith('СРЕДНЯЯ'):
            notes.append(str(a).strip())
            continue
        if isinstance(a, (int, float)) or re.fullmatch(r'\d+\s*[МДФ]?', s):
            key = car_key(a)
            cars[key] = {'label': str(a), 'amort': ws.cell(r, 2).value,
                         'p': [round(v, 2) if isinstance(v, (int, float)) else None for v in vals]}
    # заметки: «себестоимость на 1.02.26 — 61 руб/км» относится к январю
    bench = {}
    for n in notes:
        m = re.search(r'1\.(\d{2})\.?\s*26', n)
        v = re.search(r'-\s*(\d+(?:,\d+)?)\s*руб', n)
        if not (m and v):
            continue
        month = int(m.group(1)) - 1
        val = float(v.group(1).replace(',', '.'))
        b = bench.setdefault(month, {})
        if n.lower().startswith('себестоимость'):
            b['cost'] = val
            b['tax'] = 'налоговая' in n
    # «средняя стоимость 1 км» идёт строкой ниже соответствующей себестоимости
    order = [n for n in notes]
    month = None
    for n in order:
        m = re.search(r'1\.(\d{2})\.?\s*26', n)
        if m:
            month = int(m.group(1)) - 1
        elif n.lower().startswith('средняя') and month is not None:
            v = re.search(r'-\s*(\d+(?:,\d+)?)\s*руб', n)
            if v:
                bench.setdefault(month, {})['rate'] = float(v.group(1).replace(',', '.'))
    return cars, shared, bench


def parse_profit_year(path_or_wb) -> int:
    wb = path_or_wb if hasattr(path_or_wb, 'worksheets') else openpyxl.load_workbook(path_or_wb, data_only=True)
    ws, header = find_profit_sheet(wb)
    return profit_year(ws, header) if ws is not None else dt.date.today().year


def parse_avto(wb):
    ws = wb['АВТО']
    out = {}
    for r in range(3, 80):
        plate = ws.cell(r, 2).value
        model = ws.cell(r, 3).value
        if not plate or not str(plate).strip() or not model:
            continue
        p = re.sub(r'\s', '', str(plate).upper())
        num = re.search(r'\d{3}', p)
        if not num:
            continue
        mdl = norm(model)
        make = 'FAW' if 'FAW' in mdl else 'MAN' if 'MAN' in mdl else 'DAF' if 'DAF' in mdl else \
            'SCANIA' if 'SCANIA' in mdl else 'MERCEDES' if 'MERCEDES' in mdl else 'OTHER'
        yr = re.match(r'\s*(\d{4})', str(ws.cell(r, 4).value or ''))
        tacho = re.search(r'\((.+)\)', str(ws.cell(r, 4).value or ''))
        odo = ws.cell(r, 5).value
        if isinstance(odo, str):
            odo = int(re.sub(r'\D', '', odo) or 0) or None
        trailer = ws.cell(r, 7).value
        out.setdefault(str(int(num.group())), []).append({
            'plate': p, 'model': str(model).strip(), 'make': make,
            'year': int(yr.group(1)) if yr else None, 'tacho': tacho.group(1) if tacho else None,
            'odo': int(odo) if isinstance(odo, (int, float)) else None,
            'trailer': norm(trailer) if trailer else None, 'trailer_model': str(ws.cell(r, 8).value or '').strip() or None,
            'trailer_year': ws.cell(r, 9).value if isinstance(ws.cell(r, 9).value, (int, float)) else None,
        })
    return out


def parse_fuel(wb):
    ws = wb['Анализ ЗАПРАВОК']
    g = grid(ws)
    mc = ws.max_column
    hdr = [i for i, row in enumerate(g) if sum(1 for v in row if v == 'Дата') >= 2]
    daily = defaultdict(dict)  # key -> date -> [rn, e100, gl]
    for k, h in enumerate(hdr):
        end = hdr[k + 1] - 1 if k + 1 < len(hdr) else len(g)
        for c in [c for c, v in enumerate(g[h]) if v == 'Дата']:
            lab = next((g[h - 1][c + d] for d in range(6) if c + d < mc and g[h - 1][c + d] is not None), None)
            if lab is None:
                continue
            s = norm(lab)
            if s.startswith('FAW') and re.fullmatch(r'FAW\s*', s):
                continue
            key = car_key(lab)
            if key is None:
                review.append({'kind': 'Непонятный заголовок в заправках', 'value': str(lab), 'where': 'Анализ ЗАПРАВОК', 'action': 'пропущено'})
                continue
            for r in range(h + 1, end):
                d = g[r][c]
                if not isinstance(d, dt.datetime):
                    continue
                vals = [g[r][c + j] if c + j < mc else None for j in (1, 2, 3)]
                vals = [float(v) if isinstance(v, (int, float)) else 0.0 for v in vals]
                if any(vals):
                    daily[key][d.date().isoformat()] = vals
    return daily, set(daily)


def parse_idle_history(wb):
    ws = wb['Анализ простоев']
    out = {}
    for r in range(3, 100):
        a = ws.cell(r, 1).value
        if isinstance(a, dt.datetime) and isinstance(ws.cell(r, 2).value, (int, float)):
            out[f'{a.year}-{a.month:02d}'] = [int(ws.cell(r, c).value or 0) for c in range(2, 7)]
    return out


def parse_sources(profit_path, park_path) -> dict:
    review.clear()
    wb = openpyxl.load_workbook(park_path, data_only=True)
    cars_p, shared, bench = parse_profit(profit_path)
    sched = parse_schedule(wb)
    avto = parse_avto(wb)
    fuel_daily, fuel_keys = parse_fuel(wb)
    idle_hist = parse_idle_history(wb)

    # ---- справочник машин
    keys = set(cars_p)
    for b in sched:
        if b['y'] == 2026:
            keys |= {r['key'] for r in b['rows']}
    keys |= fuel_keys
    letter_make = {'М': 'MAN', 'Д': 'DAF', 'Ф': 'FAW'}
    vehicles = {}
    for k in keys:
        base, suf = re.fullmatch(r'(\d+)([МДФ]?)', k).groups()
        cands = avto.get(base, [])
        info = None
        if len(cands) == 1 and (not suf or cands[0]['make'] == letter_make[suf]):
            info = cands[0]
        elif suf:
            info = next((c for c in cands if c['make'] == letter_make[suf]), None)
        if not info:
            reason = 'нет в листе «АВТО»' if not cands else 'несколько машин с этим номером в «АВТО»'
            where = []
            if k in cars_p:
                where.append('прибыль')
            if any(r['key'] == k for b in sched for r in b['rows']):
                where.append('график')
            if k in fuel_keys:
                where.append('заправки')
            review.append({'kind': 'Машина без госномера', 'value': display(k),
                           'where': ', '.join(where), 'action': reason})
        vehicles[k] = {'key': k, 'name': display(k), **(info or {}), 'amort': (cars_p.get(k) or {}).get('amort')}
    # машины из истории графика (2023–2025), которых больше нет
    hist_only = sorted({r['key'] for b in sched for r in b['rows']} - set(vehicles), key=lambda x: int(re.match(r'\d+', x).group()))
    for k in hist_only:
        base = re.match(r'\d+', k).group()
        info = (avto.get(base) or [None])[0]
        vehicles[k] = {'key': k, 'name': display(k), **(info or {}), 'history_only': True}

    # ---- месяцы графика
    sched_out = []
    for b in sched:
        ym = f"{b['y']}-{b['m']:02d}"
        rows = []
        for r in b['rows']:
            tot = r['tot']
            nd = len(r['codes'])
            if tot and sum(tot.values()) != nd:
                review.append({'kind': 'Сумма дней ≠ дней в месяце', 'value': display(r['key']),
                               'where': f"{MONTHS_RU[b['m'] - 1]} {b['y']}, строка {r['row']}",
                               'action': f"в итогах {sum(tot.values())} дн. из {nd}"})
            rows.append({'k': r['key'], 'c': r['codes'], 'tot': tot, 'calc': r['calc'],
                         'tx': r['texts'], 'row': r['row'], 'raw': r['raw']})
        sched_out.append({'ym': ym, 'rows': rows, 'manual': any(r['tot'] for r in b['rows'])})

    return {
        'vehicles': vehicles,
        'profit': {k: v['p'] for k, v in cars_p.items()},
        'shared': shared,
        'bench': bench,
        'schedule': sched_out,
        'fuel_daily': {k: v for k, v in fuel_daily.items()},
        'idle_hist': idle_hist,
        'review': list(review),
    }
