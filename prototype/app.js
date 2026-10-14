/* FiberTrack — прототип. Все расчёты здесь повторяют правила из docs/02-schema.md. */
(function () {
'use strict';
const D = window.FT_DATA;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const NB = ' ', MINUS = '−';
const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_DAT = ['январю','февралю','марту','апрелю','маю','июню','июлю','августу','сентябрю','октябрю','ноябрю','декабрю'];
const MSHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- формат ---------- */
const fmtInt = n => Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NB);
const rub = n => n == null || isNaN(n) ? '—' : (n < 0 ? MINUS : '') + fmtInt(n) + NB + '₽';
const int = n => n == null || isNaN(n) ? '—' : (n < 0 ? MINUS : '') + fmtInt(n);
const pct = (n, d = 1) => n == null || !isFinite(n) ? '—' : (n < 0 ? MINUS : '') + Math.abs(n).toFixed(d).replace('.', ',') + '%';
const dec = (n, d = 1) => n == null || !isFinite(n) ? '—' : (n < 0 ? MINUS : '') + Math.abs(n).toFixed(d).replace('.', ',');
const short = n => { const a = Math.abs(n); const s = a >= 1e6 ? (a/1e6).toFixed(1).replace('.', ',') + NB + 'млн' : a >= 1e3 ? Math.round(a/1e3) + NB + 'тыс' : String(Math.round(a)); return (n < 0 ? MINUS : '') + s; };
const ymLabel = ym => { const [y, m] = ym.split('-').map(Number); return cap(MONTHS[m-1]) + ' ' + y; };
const ymShort = ym => { const [y, m] = ym.split('-').map(Number); return MSHORT[m-1] + ' ' + String(y).slice(2); };
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/* ---------- настройки (в рабочей версии — на сервере) ---------- */
const DEFAULTS = { alloc: 'days', groups: [2013, 2017, 2021], fuelPct: 10, glonassMax: 1500, kmMin: 0, kmMax: 20000, lMin: 20, lMax: 45 };
let S = Object.assign({}, DEFAULTS);
try { Object.assign(S, JSON.parse(localStorage.getItem('ft-settings') || '{}')); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('ft-settings', JSON.stringify(S)); } catch (e) {} };
let ROLE = 'admin';
try { ROLE = localStorage.getItem('ft-role') || 'admin'; } catch (e) {}
let INPUT = {};
try { INPUT = JSON.parse(localStorage.getItem('ft-input') || '{}'); } catch (e) {}
const saveInput = () => { try { localStorage.setItem('ft-input', JSON.stringify(INPUT)); } catch (e) {} };

/* ---------- модель данных ---------- */
const V = D.vehicles;
const displayKey = k => { const m = /^(\d+)([МДФ]?)$/.exec(k); return m ? m[1].padStart(3, '0') + (m[2] ? ' ' + m[2] : '') : k; };
let VEDIT = {}, AUDIT = [];
try { VEDIT = JSON.parse(localStorage.getItem('ft-vehicles') || '{}'); AUDIT = JSON.parse(localStorage.getItem('ft-audit') || '[]'); } catch (e) {}
const applyVehicleEdits = () => Object.entries(VEDIT).forEach(([k, v]) => { V[k] = Object.assign({ key: k, name: displayKey(k) }, D.vehicles[k] || {}, v); });
applyVehicleEdits();
const saveFleet = () => { try { localStorage.setItem('ft-vehicles', JSON.stringify(VEDIT)); localStorage.setItem('ft-audit', JSON.stringify(AUDIT.slice(-300))); } catch (e) {} };
const name = k => (V[k] && V[k].name) || k;
/* очередь «Проверить»: пункт «без госномера» исчезает, как только номер указан в справочнике */
const openReview = () => D.review.filter(r => !(r.kind === 'Машина без госномера' && Object.values(V).some(v => v.name === r.value && v.plate)));
const PROFIT_MONTHS = Array.from({length: 12}, (_, i) => `2026-${String(i+1).padStart(2,'0')}`);
const pIdx = ym => PROFIT_MONTHS.indexOf(ym);
const hasProfit = ym => { const i = pIdx(ym); return i >= 0 && D.shared.gen && D.shared.gen[i] != null; };
const PROFIT_YMS = PROFIT_MONTHS.filter(hasProfit);
const SCHED = Object.fromEntries(D.schedule.map(m => [m.ym, m]));
const SCHED_YMS = D.schedule.map(m => m.ym);
const ALL_YMS = [...new Set([...SCHED_YMS, ...PROFIT_YMS])].sort();
const LAST_PROFIT = PROFIT_YMS[PROFIT_YMS.length - 1];
const TODAY = new Date(D.generated);

function filledDays(ym) {
  const m = SCHED[ym]; if (!m) return 0;
  let last = 0;
  for (const r of m.rows) { const i = r.c.replace(/\.+$/, '').length; if (i > last) last = i; }
  return last;
}
function rowOf(ym, k) { const m = SCHED[ym]; return m ? m.rows.find(r => r.k === k) : null; }
/* дни машины за месяц: ручные итоги диспетчера главнее, иначе пересчёт по ячейкам */
function daysOf(ym, k) {
  const r = rowOf(ym, k); if (!r) return null;
  const src = r.tot || r.calc;
  return { worked: src.worked || 0, no_driver: src.no_driver || 0, idle: (src.idle || 0) + (src.loading || 0) + (src.unloading || 0),
           planned: src.planned || 0, unplanned: src.unplanned || 0, basis: r.tot ? 'manual' : 'calc' };
}
function fleetDays(ym) {
  const m = SCHED[ym];
  const z = { worked: 0, no_driver: 0, idle: 0, planned: 0, unplanned: 0, cars: 0, cal: 0, basis: 'manual' };
  if (!m) return null;
  const fd = m.manual ? daysIn(ym) : filledDays(ym);
  for (const r of m.rows) {
    const d = daysOf(ym, r.k); z.cars++; z.cal += fd;
    for (const f of ['worked','no_driver','idle','planned','unplanned']) z[f] += d[f];
    if (d.basis === 'calc') z.basis = 'calc';
  }
  z.filled = fd;
  return z;
}
const ki = ym => { const f = fleetDays(ym); return f && f.cal ? f.worked / f.cal * 100 : null; };
const carKi = (ym, k) => { const d = daysOf(ym, k); if (!d) return null; const fd = SCHED[ym].manual ? daysIn(ym) : filledDays(ym); return fd ? d.worked / fd * 100 : null; };

const profitRaw = (ym, k) => { const i = pIdx(ym); const a = D.profit[k]; return i < 0 || !a ? null : a[i]; };
const carsWithProfit = ym => Object.keys(D.profit).filter(k => profitRaw(ym, k) != null);
const sumCars = ym => carsWithProfit(ym).reduce((s, k) => s + profitRaw(ym, k), 0);
const sharedOf = (ym, f) => { const i = pIdx(ym); return D.shared[f] ? D.shared[f][i] || 0 : 0; };
const fleetTotal = ym => { const i = pIdx(ym); return D.shared.total ? D.shared.total[i] : null; };

/* распределение общих расходов и амортизации на машины */
function allocation(ym) {
  const keys = carsWithProfit(ym);
  const am = k => (V[k] && V[k].amort) || 0;
  const carAm = keys.reduce((s, k) => s + am(k), 0);
  const residual = sharedOf(ym, 'amort') + carAm;          // разница между строкой «амортизация» и суммой по машинам
  const pool = sharedOf(ym, 'tractor') + sharedOf(ym, 'gen') + sharedOf(ym, 'service') + residual;
  const w = Object.fromEntries(keys.map(k => [k, S.alloc === 'equal' ? 1 : ((daysOf(ym, k) || {}).worked || 0)]));
  let W = keys.reduce((s, k) => s + w[k], 0);
  if (!W) { keys.forEach(k => w[k] = 1); W = keys.length; }
  const out = {};
  keys.forEach(k => out[k] = { raw: profitRaw(ym, k), amort: -am(k), share: pool * w[k] / W, alloc: profitRaw(ym, k) - am(k) + pool * w[k] / W });
  return { cars: out, pool, residual };
}
let ALLOC_ON = true;
const carProfit = (ym, k) => { if (profitRaw(ym, k) == null) return null; return ALLOC_ON ? allocation(ym).cars[k].alloc : profitRaw(ym, k); };
const fleetProfit = ym => hasProfit(ym) ? (ALLOC_ON ? fleetTotal(ym) : sumCars(ym)) : null;
const prevYm = ym => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`; };
const nextYm = ym => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y+1}-01` : `${y}-${String(m+1).padStart(2,'0')}`; };

/* ---------- статусы ---------- */
const ST = {
  T: ['Рейс', '--st-T'], t: ['Рейс (продолжение)', '--st-t'], D: ['Нет водителя', '--st-D'], I: ['Простой / нет заявки', '--st-I'],
  R: ['Ремонт', '--st-R'], W: ['Мойка / дефектовка / ТО', '--st-W'], O: ['Выходной / отпуск', '--st-O'], G: ['Подготовка, учёт', '--st-G'],
  S: ['Продажа', '--st-S'], '.': ['Нет записи', null]
};

/* ---------- общие UI-штуки ---------- */
const ICON = {
  dash: '<rect x="2" y="2" width="5" height="5" rx="1.5"/><rect x="9" y="2" width="5" height="5" rx="1.5"/><rect x="2" y="9" width="5" height="5" rx="1.5"/><rect x="9" y="9" width="5" height="5" rx="1.5"/>',
  truck: '<path d="M1.5 4.5h8v6h-8zM9.5 7h3l2 2v1.5h-5"/><circle cx="4" cy="11.5" r="1.3"/><circle cx="12" cy="11.5" r="1.3"/>',
  heat: '<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/>',
  fuel: '<path d="M3 14V3.5A1.5 1.5 0 0 1 4.5 2h4A1.5 1.5 0 0 1 10 3.5V14M2 14h9M10 6h1.5a1 1 0 0 1 1 1v4a1 1 0 0 0 2 0V5l-2-2"/>',
  years: '<circle cx="4" cy="11" r="1.2"/><circle cx="7" cy="6" r="1.2"/><circle cx="10.5" cy="9" r="1.2"/><circle cx="13" cy="4" r="1.2"/><path d="M1.5 14.5h13"/>',
  dyn: '<path d="M1.5 12l4-4 3 2.5 6-6.5"/>',
  recon: '<path d="M5 3h9M5 8h9M5 13h9"/><path d="M1.5 3l1 1 1.5-2M1.5 8l1 1 1.5-2"/>',
  report: '<path d="M4 1.5h5.5L12.5 4.5V14.5H4z"/><path d="M6 8h4.5M6 10.5h4.5"/>',
  upload: '<path d="M8 10.5V2M5 5l3-3 3 3M2.5 10.5v3h11v-3"/>',
  review: '<circle cx="8" cy="8" r="6.3"/><path d="M8 4.8v3.8M8 10.8v.2"/>',
  settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  xls: '<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5"/>',
  pdf: '<path d="M4 1.5h5.5L12.5 4.5V14.5H4z"/>',
  prev: '<path d="M10 3L5 8l5 5"/>', next: '<path d="M6 3l5 5-5 5"/>',
  moon: '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>',
  info: '<circle cx="8" cy="8" r="6.5"/><path d="M8 7v4M8 4.8v.2"/>',
  cal: '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/>',
  menu: '<path d="M2 4h12M2 8h12M2 12h12"/>', dl: '<path d="M8 2v8.5M5 7.5l3 3 3-3M2.5 11v2.5h11V11"/>'
};
const ico = (n, sz = 16) => `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

const NAV = [
  ['dashboard', 'Дашборд', 'dash', ['admin','viewer']],
  ['cars', 'Машины', 'truck', ['admin','viewer']],
  ['heatmap', 'Тепловая карта', 'heat', ['admin','viewer']],
  ['fuel', 'Топливо', 'fuel', ['admin','viewer']],
  ['years', 'Годы выпуска', 'years', ['admin','viewer']],
  ['dynamics', 'Динамика парка', 'dyn', ['admin','viewer']],
  ['recon', 'Сверка', 'recon', ['admin','viewer']],
  ['report', 'Отчёт руководителю', 'report', ['admin','viewer']],
  ['-', 'Данные'],
  ['input', 'Загрузка и ввод', 'upload', ['admin','input']],
  ['periods', 'Месяцы', 'cal', ['admin']],
  ['fleet', 'Справочник машин', 'truck', ['admin','viewer','input']],
  ['review', 'Проверить', 'review', ['admin','input']],
  ['settings', 'Настройки', 'settings', ['admin']],
];
const ROLES = { admin: 'Владелец', viewer: 'Руководитель', input: 'Бухгалтер' };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
const tip = $('#tip');
function showTip(e, html) { tip.innerHTML = html; tip.style.opacity = 1; const r = tip.getBoundingClientRect(); let x = e.clientX + 14, y = e.clientY + 14; if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
const hideTip = () => { tip.style.opacity = 0; };

function deltaChip(cur, prev, kind) {
  if (cur == null || prev == null || (kind !== 'pp' && kind !== 'count' && prev === 0)) return '';
  let txt, neg;
  if (kind === 'pp') { const d = cur - prev; neg = d < 0; txt = (d < 0 ? MINUS : '+') + dec(Math.abs(d)) + NB + 'п.п.'; }
  else if (kind === 'count') { const d = cur - prev; neg = d > 0; txt = (d > 0 ? '+' : d < 0 ? MINUS : '±') + Math.abs(d); }
  else if (prev < 0 || cur < 0) { const d = cur - prev; neg = d < 0; txt = (d < 0 ? MINUS : '+') + short(Math.abs(d)) + NB + '₽'; }  // % от отрицательной базы не читается
  else { const d = (cur - prev) / Math.abs(prev) * 100; neg = d < 0; txt = (d < 0 ? MINUS : '+') + dec(Math.abs(d)) + '%'; }
  return `<span class="chip ${neg ? 'neg' : ''}">${txt}</span>`;
}
function spark(vals) {
  const pts0 = vals.map((v, i) => [i, v]).filter(p => p[1] != null);
  if (pts0.length < 2) return '<span class="muted">—</span>';
  const w = 96, h = 28, pad = 3, n = vals.length;
  const vs = pts0.map(p => p[1]); const mn = Math.min(0, ...vs), mx = Math.max(0, ...vs);
  const x = i => pad + i * (w - 2*pad) / (n - 1), y = v => h - pad - (v - mn) / (mx - mn || 1) * (h - 2*pad);
  const pts = pts0.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const last = pts0[pts0.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" stroke="var(--border-strong)" stroke-dasharray="2 2"/><polyline points="${pts}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${x(last[0])}" cy="${y(last[1])}" r="2.6" fill="${last[1] < 0 ? 'var(--neg)' : 'var(--teal-ink)'}"/></svg>`;
}
function empty(title, text, icon = 'info') { return `<div class="empty-state fade"><span class="ico-circle">${ico(icon, 20)}</span><h3>${title}</h3><p>${text}</p></div>`; }

/* ---------- графики ---------- */
const charts = [];
function chart(el, opt) {
  const c = echarts.init(el, null, { renderer: 'svg' });
  const base = { animationDuration: 420, animationEasing: 'cubicOut', textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    tooltip: { backgroundColor: css('--surface'), borderColor: css('--border'), textStyle: { color: css('--ink'), fontFamily: 'Inter' }, extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12)' } };
  if (opt.tooltip) opt.tooltip = Object.assign({}, base.tooltip, opt.tooltip);
  c.setOption(Object.assign(base, opt));
  charts.push(c);
  return c;
}
const axisCat = (data, extra = {}) => Object.assign({ type: 'category', data, axisTick: { show: false }, axisLine: { lineStyle: { color: css('--grid') } }, axisLabel: { color: css('--ink-2'), fontSize: 12 } }, extra);
const axisVal = (fmt = short, extra = {}) => Object.assign({ type: 'value', splitLine: { lineStyle: { color: css('--grid') } }, axisLabel: { color: css('--ink-3'), formatter: fmt } }, extra);

function waterfall(el, ym, narrowForce) {
  const steps = [['Прибыль машин', sumCars(ym), 'total'], ['Трактор', sharedOf(ym, 'tractor')], ['Общехоз', sharedOf(ym, 'gen')],
    ['Сервис', sharedOf(ym, 'service')], ['Амортизация', sharedOf(ym, 'amort')], ['Прибыль парка', fleetTotal(ym), 'total']];
  let run = 0; const base = [], val = [], colors = [], labels = [];
  steps.forEach(([n, v, t]) => {
    if (t) { base.push(Math.min(0, v)); val.push(Math.abs(v)); colors.push(v < 0 ? css('--s-down') : css('--s-total')); run = v; }
    else { const nr = run + v; base.push(Math.min(run, nr)); val.push(Math.abs(v)); colors.push(v >= 0 ? css('--s-up') : css('--s-down')); run = nr; }
    labels.push(t ? short(v) : (v >= 0 ? '+' : '') + short(v));
  });
  const narrow = narrowForce ?? el.clientWidth < 560;
  return chart(el, {
    grid: { left: 8, right: narrow ? 60 : 8, top: narrow ? 4 : 26, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,.06)' } }, formatter: ps => `<b>${steps[ps[0].dataIndex][0]}</b><br>${rub(steps[ps[0].dataIndex][1])}` },
    [narrow ? 'yAxis' : 'xAxis']: axisCat(steps.map(s => s[0]), { inverse: narrow, axisLabel: { color: css('--ink-2'), fontSize: 12, interval: 0 } }),
    [narrow ? 'xAxis' : 'yAxis']: axisVal(short, { splitNumber: narrow ? 3 : 5, axisLabel: { show: !narrow, color: css('--ink-3'), formatter: short } }),
    series: [
      { type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, silent: true, emphasis: { disabled: true } },
      { type: 'bar', stack: 'w', barWidth: '46%', data: val.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: 4 } })),
        label: { show: true, position: narrow ? 'right' : 'top', color: css('--ink'), fontWeight: 600, fontSize: 12, formatter: p => labels[p.dataIndex] } }]
  });
}
function daysBlock(f) {
  if (!f) return '';
  const total = f.worked + f.no_driver + f.idle + f.planned + f.unplanned;
  const items = [['Рейс', f.worked, '--st-T'], ['Нет водителя', f.no_driver, '--st-D'], ['Нет заявки / простой', f.idle, '--st-I'], ['ТО (план)', f.planned, '--st-W'], ['Ремонт (неплан)', f.unplanned, '--st-R']];
  return `<div class="daysbar">${items.filter(i => i[1]).map(([n, v, c]) => `<span title="${n}: ${v} дн. (${pct(v/total*100)})" style="flex:${v};background:var(${c})"></span>`).join('')}</div>
    <div class="legend">${items.map(([n, v, c]) => `<span><i style="background:var(${c})"></i>${n}<b>${v}</b></span>`).join('')}</div>`;
}

/* ---------- маршрутизация ---------- */
let STATE = { ym: LAST_PROFIT, vat: 'asis' };
function parseHash() { const h = location.hash.replace(/^#\/?/, ''); const [path, q] = h.split('?'); const parts = (path || 'dashboard').split('/'); return { page: parts[0], arg: parts[1] ? decodeURIComponent(parts[1]) : null, q: new URLSearchParams(q || '') }; }
const allowed = page => { const n = NAV.find(x => x[0] === page); return n && n[3] ? n[3].includes(ROLE) : page === 'car' ? ROLE !== 'input' : false; };
function go(h) { location.hash = '#/' + h; }

function renderNav(page) {
  const badge = openReview().filter(r => r.kind !== 'Сумма дней ≠ дней в месяце').length;
  $('#nav').innerHTML = NAV.map(n => n[0] === '-' ? `<div class="nav-label">${n[1]}</div>` :
    n[3].includes(ROLE) ? `<a href="#/${n[0]}" class="${page === n[0] || (page === 'car' && n[0] === 'cars') ? 'on' : ''}">${ico(n[2])}${n[1]}${n[0] === 'review' ? `<span class="badge">${badge}</span>` : ''}</a>` : '').join('');
  $('#roleSel').value = ROLE;
  $('#roleHint').textContent = ROLE === 'input' ? 'Ведёт парк: справочник машин, загрузки и ввод за открытые месяцы. Прибыль и итоги ему недоступны.' : ROLE === 'viewer' ? 'Смотрит всё, ничего не меняет.' : 'Полный доступ.';
}
function topbar(title, opts = {}) {
  const ym = STATE.ym;
  const monthCtl = opts.month ? `<div class="month"><button class="btn" data-mo="-1" aria-label="Предыдущий месяц" ${ALL_YMS.indexOf(ym) <= 0 ? 'disabled' : ''}>${ico('prev', 15)}</button><strong>${ymLabel(ym)}</strong><button class="btn" data-mo="1" aria-label="Следующий месяц" ${ALL_YMS.indexOf(ym) >= ALL_YMS.length - 1 ? 'disabled' : ''}>${ico('next', 15)}</button></div>` : '';
  const tb = opts.money ? `<div class="toolbar-row"><div class="seg" role="group" aria-label="НДС"><button data-vat="asis" class="${STATE.vat === 'asis' ? 'on' : ''}"><span class="l">Деньги (как есть)</span><span class="s">Как есть</span></button><button data-vat="net" class="${STATE.vat === 'net' ? 'on' : ''}">Без НДС</button></div>
    <div class="seg" role="group" aria-label="Общие расходы"><button data-alloc="1" class="${ALLOC_ON ? 'on' : ''}"><span class="l">С распределением</span><span class="s">С общими</span></button><button data-alloc="0" class="${!ALLOC_ON ? 'on' : ''}"><span class="l">Без распределения</span><span class="s">Без общих</span></button></div></div>` : '';
  $('#top').innerHTML = `<button class="btn iconbtn burger" id="burger" aria-label="Меню">${ico('menu')}</button><h1>${title}</h1>${monthCtl}<div class="spacer"></div>${tb}${opts.extra || ''}<button class="btn iconbtn" id="theme" aria-label="Сменить тему">${ico('moon')}</button>`;
  $$('[data-mo]').forEach(b => b.onclick = () => { const i = ALL_YMS.indexOf(STATE.ym) + Number(b.dataset.mo); if (ALL_YMS[i]) { STATE.ym = ALL_YMS[i]; render(); } });
  $$('[data-vat]').forEach(b => b.onclick = () => { STATE.vat = b.dataset.vat; render(); });
  $$('[data-alloc]').forEach(b => b.onclick = () => { ALLOC_ON = b.dataset.alloc === '1'; render(); });
  $('#theme').onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('ft-theme', r.dataset.theme); } catch (e) {} render(); };
  $('#burger').onclick = () => $('#side').classList.toggle('open');
}
const vatNote = () => STATE.vat === 'net' ? `<div class="note warn">${ico('info')}<div>В загруженных данных НДС не выделен: таблица прибыли содержит итог «как есть». Пока бухгалтер не внесёт суммы со ставками, в режиме «Без НДС» показаны те же цифры.</div></div>` : '';

/* =========================================================
   ЭКРАНЫ
   ========================================================= */
const PAGES = {};

/* ---------- Дашборд ---------- */
PAGES.dashboard = () => {
  const ym = STATE.ym, prev = prevYm(ym);
  topbar('Дашборд месяца', { month: true, money: true, extra: `<a class="btn hide-m" href="#/report">${ico('pdf', 15)}PDF</a><button class="btn hide-m" id="xls">${ico('xls', 15)}Excel</button>` });
  const f = fleetDays(ym), fp = fleetDays(prev);
  const kNow = ki(ym), kPrev = SCHED[prev] ? ki(prev) : null;
  const P = fleetProfit(ym), PP = fleetProfit(prev);
  const loss = hasProfit(ym) ? carsWithProfit(ym).filter(k => carProfit(ym, k) < 0).length : null;
  const lossP = hasProfit(prev) ? carsWithProfit(prev).filter(k => carProfit(prev, k) < 0).length : null;
  const partial = f && f.basis === 'calc';
  const head = [];
  if (!hasProfit(ym)) head.push(`<div class="note">${ico('info')}<div><b>Прибыль за ${MONTHS[Number(ym.slice(5)) - 1]} ещё не внесена.</b> Показаны только дни из графика${partial ? `, посчитанные по ячейкам${f.filled < daysIn(ym) ? ` (заполнено по ${f.filled}-е число)` : ''}: ручных итогов диспетчера за этот месяц нет` : ''}.</div></div>`);
  else head.push(`<div class="note">${ico('info')}<div>Прибыль — из таблицы «Прибыль по машинам», дни — ручные итоги диспетчера из графика. Выручка, статьи расходов и пробег появятся после ввода бухгалтером.</div></div>`);
  const kp = [
    { l: 'Выручка', e: `Нет данных за ${MONTHS[Number(ym.slice(5)) - 1]}`, h: ROLE === 'admin' ? '<a href="#/input">Внести по шаблону →</a>' : 'вносит бухгалтер' },
    P == null ? { l: ALLOC_ON ? 'Прибыль парка' : 'Прибыль машин', e: 'Не внесена', h: 'таблица прибыли' } :
      { l: ALLOC_ON ? 'Прибыль парка' : 'Прибыль машин', v: rub(P), neg: P < 0, d: deltaChip(P, PP) + (PP != null ? ` к ${MONTHS_DAT[Number(prev.slice(5)) - 1]}: ${rub(PP)}` : '') },
    { l: 'Маржа', e: 'Посчитается после ввода выручки', h: 'прибыль ÷ выручка' },
    { l: 'Руб/км', e: 'Пробег не внесён', h: ROLE === 'admin' ? '<a href="#/input">Внести пробег →</a>' : 'вносит бухгалтер' },
    kNow == null ? { l: 'КИ парка', e: 'Нет графика', h: '' } : { l: 'КИ парка', v: pct(kNow), d: deltaChip(kNow, kPrev, 'pp') + ` ${f.worked} из ${f.cal} маш.-дн.` },
    loss == null ? { l: 'Машин в убытке', e: 'Нет прибыли за месяц', h: '' } : { l: 'Машин в убытке', v: `${loss}<span class="u">из ${carsWithProfit(ym).length}</span>`, d: deltaChip(loss, lossP, 'count') + (lossP != null ? ` было ${lossP}` : '') },
  ];
  const kpis = kp.map(c => c.e ? `<article class="card kpi empty fade"><div class="lbl">${c.l}</div><div class="val">${c.e}</div><div class="delta">${c.h}</div></article>` :
    `<article class="card kpi fade"><div class="lbl">${c.l}</div><div class="val num ${c.neg ? 'neg-ink' : ''}">${c.v}</div><div class="delta num">${c.d}</div></article>`).join('');
  let ppd = null;
  if (hasProfit(ym) && f) ppd = sumCars(ym) / f.worked;
  const lossTxt = f && ppd ? `Без водителя машины простояли <strong>${f.no_driver}</strong> машино-дней. При средней прибыли машины в рабочий день <strong>${rub(ppd)}</strong> это около <strong>${rub(-f.no_driver * ppd)}</strong> недополученной прибыли. Оценка грубая: когда появится выручка, потери будут считаться по доходу.` :
    f ? `Без водителя: <strong>${f.no_driver}</strong> машино-дней, в ремонте: <strong>${f.unplanned}</strong>. Потери в рублях посчитаются, когда за месяц будет внесена прибыль.` : '';
  $('#content').innerHTML = `${vatNote()}${head.join('')}
    <section class="kpis">${kpis}</section>
    <section class="g21" style="margin-top:14px">
      <div class="card panel"><div class="panel-h"><div><h2>От прибыли машин к прибыли парка</h2><p>${ymLabel(ym)} · общие расходы и амортизация</p></div></div>
        ${hasProfit(ym) ? '<div id="wf" class="chart" role="img" aria-label="Водопад прибыли"></div>' : empty('Нет данных о прибыли', 'Водопад появится, когда за месяц будет внесена прибыль по машинам и общие расходы.')}</div>
      <div class="card panel"><div class="panel-h"><div><h2>Куда ушли машино-дни</h2><p>${f ? `${ymLabel(ym)} · ${f.worked + f.no_driver + f.idle + f.planned + f.unplanned} машино-дней${partial ? ' · по ячейкам графика' : ''}` : 'нет графика'}</p></div></div>
        ${f ? daysBlock(f) : empty('Нет графика', 'За этот месяц график работы не загружен.')}
        <div id="pyear" class="chart" style="height:180px" role="img" aria-label="Прибыль по месяцам"></div>
        ${lossTxt ? `<div class="callout">${lossTxt}</div>` : ''}</div>
    </section>
    <section class="g2" style="margin-top:14px">
      <div class="card panel"><div class="panel-h"><div><h2>Топ-5 машин</h2><p>по прибыли за месяц ${ALLOC_ON ? 'с распределением общих' : 'до общих расходов'}</p></div></div><div id="top5"></div></div>
      <div class="card panel"><div class="panel-h"><div><h2>Анти-топ-5</h2><p>самые убыточные за месяц</p></div></div><div id="bot5"></div></div>
    </section>
    <div class="foot"><span>FiberTrack · Fiber Software</span><span>Данные на ${D.generated.split('-').reverse().join('.')}</span></div>`;
  if (hasProfit(ym)) waterfall($('#wf'), ym);
  const yms = PROFIT_YMS;
  chart($('#pyear'), {
    title: { text: (ALLOC_ON ? 'Прибыль парка' : 'Прибыль машин') + ', 2026', left: 0, top: 0, textStyle: { fontSize: 12.5, fontWeight: 500, color: css('--ink-2') } },
    grid: { left: 4, right: 10, top: 30, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: css('--border-strong') } }, formatter: ps => `<b>${ymLabel(yms[ps[0].dataIndex])}</b><br>${rub(ps[0].value)}` },
    xAxis: axisCat(yms.map(y => MSHORT[Number(y.slice(5)) - 1]), { boundaryGap: false, axisLabel: { color: css('--ink-3') } }),
    yAxis: axisVal(short, { splitNumber: 3 }),
    series: [{ type: 'line', data: yms.map(fleetProfit), symbol: 'circle', symbolSize: 7, showSymbol: true, lineStyle: { width: 2, color: css('--s-up') }, itemStyle: { color: css('--s-up'), borderColor: css('--surface'), borderWidth: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: css('--s-up') + '33' }, { offset: 1, color: css('--s-up') + '00' }]) } }]
  });
  if (hasProfit(ym)) {
    const rows = carsWithProfit(ym).map(k => ({ k, p: carProfit(ym, k), d: (daysOf(ym, k) || {}).worked, s: PROFIT_YMS.map(y => carProfit(y, k)) })).sort((a, b) => b.p - a.p);
    const tbl = list => `<table><thead><tr><th>Машина</th><th>Прибыль</th><th class="col-m">Раб. дней</th><th>На раб. день</th><th>2026</th></tr></thead><tbody>${list.map((r, i) =>
      `<tr class="click" data-car="${r.k}"><td><span class="car"><span class="rank">${i + 1}</span>${name(r.k)}</span></td><td class="${r.p < 0 ? 'neg-ink' : ''}">${rub(r.p)}</td><td class="col-m">${r.d ?? '—'}</td><td class="${r.p < 0 ? 'neg-ink' : ''}">${r.d ? rub(r.p / r.d) : '<span class="muted" title="Нет рабочих дней">—</span>'}</td><td>${spark(r.s)}</td></tr>`).join('')}</tbody></table>`;
    $('#top5').innerHTML = tbl(rows.slice(0, 5));
    $('#bot5').innerHTML = tbl(rows.slice(-5).reverse());
  } else { $('#top5').innerHTML = empty('Нет прибыли за месяц', 'Рейтинг появится после внесения данных.'); $('#bot5').innerHTML = ''; }
  bindCarRows();
  $('#xls').onclick = exportExcel;
};

function bindCarRows() { $$('[data-car]').forEach(tr => tr.onclick = () => (ROLE === 'input' ? null : go('car/' + encodeURIComponent(tr.dataset.car)))); }

/* ---------- Машины ---------- */
let CARS_UI = { q: '', make: 'all', loss: false, sort: 'p', dir: -1 };
PAGES.cars = () => {
  const ym = STATE.ym;
  topbar('Машины', { month: true, money: true, extra: `<button class="btn hide-m" id="xls">${ico('xls', 15)}Excel</button>` });
  const keys = [...new Set([...(SCHED[ym] ? SCHED[ym].rows.map(r => r.k) : []), ...carsWithProfit(ym)])];
  const rows = keys.map(k => {
    const v = V[k] || {}, d = daysOf(ym, k);
    const p = carProfit(ym, k);
    const ytd = PROFIT_YMS.filter(y => y <= ym).map(y => carProfit(y, k)).filter(x => x != null);
    const ytdW = PROFIT_YMS.filter(y => y <= ym).reduce((s, y) => s + (profitRaw(y, k) != null ? ((daysOf(y, k) || {}).worked || 0) : 0), 0);
    const ytdP = ytd.reduce((a, b) => a + b, 0);
    return { k, n: v.name || k, plate: v.plate || '', model: v.model || '', make: v.make || '', year: v.year, p, w: d ? d.worked : null, ki: carKi(ym, k), nd: d ? d.no_driver : null, rep: d ? d.unplanned : null,
      ppd: p != null && d && d.worked ? p / d.worked : null, ytd: ytd.length ? ytdP : null, ytdPpd: ytdW ? ytdP / ytdW : null, s: PROFIT_YMS.map(y => carProfit(y, k)) };
  });
  const makes = ['all', ...[...new Set(rows.map(r => r.make).filter(Boolean))].sort()];
  const cols = [['n', 'Машина', 'l'], ['year', 'Год'], ['p', 'Прибыль'], ['w', 'Раб. дней'], ['ppd', 'На раб. день'], ['ki', 'КИ'], ['nd', 'Без водит.', 'col-m'], ['rep', 'Ремонт, дн.', 'col-m'], ['ytdPpd', 'На раб. день, 2026', 'col-m'], ['s', 'Прибыль 2026', 'nos']];
  function draw() {
    const q = CARS_UI.q.trim().toLowerCase();
    let list = rows.filter(r => (CARS_UI.make === 'all' || r.make === CARS_UI.make) && (!CARS_UI.loss || (r.p != null && r.p < 0)) &&
      (!q || (r.n + ' ' + r.plate + ' ' + r.model).toLowerCase().includes(q)));
    const sk = CARS_UI.sort;
    list.sort((a, b) => { const x = a[sk], y = b[sk]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y, 'ru', { numeric: true }) : x - y) * CARS_UI.dir; });
    const tot = list.reduce((s, r) => s + (r.p || 0), 0), totW = list.reduce((s, r) => s + (r.w || 0), 0);
    $('#carsTable').innerHTML = list.length ? `<table><thead><tr>${cols.map(([k, t, c]) => `<th class="${c === 'nos' ? '' : 'sort'} ${c || ''} ${sk === k ? 'sorted' : ''}" data-sort="${c === 'nos' ? '' : k}">${t}${sk === k ? `<span class="arr">${CARS_UI.dir < 0 ? '↓' : '↑'}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${list.map(r => `<tr class="click ${r.p != null && r.p < 0 ? 'lossrow' : ''}" data-car="${r.k}"><td><span class="car">${r.n}</span> <span class="plate">${esc(r.plate)}</span><div class="plate">${esc(r.model)}</div></td>
        <td>${r.year ?? '—'}</td><td class="${r.p < 0 ? 'neg-ink' : ''}">${rub(r.p)}</td><td>${r.w ?? '—'}</td><td class="${r.ppd < 0 ? 'neg-ink' : ''}">${r.ppd == null ? '—' : rub(r.ppd)}</td><td>${pct(r.ki, 0)}</td>
        <td class="col-m">${r.nd ?? '—'}</td><td class="col-m">${r.rep ?? '—'}</td><td class="col-m ${r.ytdPpd < 0 ? 'neg-ink' : ''}">${r.ytdPpd == null ? '—' : rub(r.ytdPpd)}</td><td>${spark(r.s)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Итого: ${list.length} маш.</td><td></td><td class="${tot < 0 ? 'neg-ink' : ''}">${rub(tot)}</td><td>${totW}</td><td>${totW ? rub(tot / totW) : '—'}</td><td></td><td class="col-m"></td><td class="col-m"></td><td class="col-m"></td><td></td></tr></tfoot></table>`
      : empty('Ничего не найдено', 'Попробуйте изменить поиск или сбросить фильтры.', 'search');
    $$('th[data-sort]').forEach(th => th.dataset.sort && (th.onclick = () => { if (CARS_UI.sort === th.dataset.sort) CARS_UI.dir *= -1; else { CARS_UI.sort = th.dataset.sort; CARS_UI.dir = th.dataset.sort === 'n' ? 1 : -1; } draw(); }));
    bindCarRows();
  }
  $('#content').innerHTML = `${vatNote()}<div class="toolbar"><label class="search">${ico('search')}<input id="q" type="text" placeholder="Номер, госномер или модель" value="${esc(CARS_UI.q)}" aria-label="Поиск"></label>
    ${makes.map(m => `<button class="pill ${CARS_UI.make === m ? 'on' : ''}" data-make="${m}">${m === 'all' ? 'Все марки' : m}</button>`).join('')}
    <button class="pill ${CARS_UI.loss ? 'on' : ''}" id="lossf">Только убыточные</button></div>
    ${!hasProfit(ym) ? `<div class="note">${ico('info')}<div>Прибыль за ${MONTHS[Number(ym.slice(5)) - 1]} не внесена — в таблице только дни из графика.</div></div>` : ''}
    <div class="card"><div class="tbl-wrap" id="carsTable"></div></div>`;
  $('#q').oninput = e => { CARS_UI.q = e.target.value; draw(); };
  $$('[data-make]').forEach(b => b.onclick = () => { CARS_UI.make = b.dataset.make; $$('[data-make]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('#lossf').onclick = e => { CARS_UI.loss = !CARS_UI.loss; e.target.classList.toggle('on', CARS_UI.loss); draw(); };
  $('#xls').onclick = exportExcel;
  draw();
};

/* ---------- Карточка машины ---------- */
PAGES.car = (k) => {
  const v = V[k];
  if (!v) { topbar('Машина'); $('#content').innerHTML = empty('Машина не найдена', 'Такого номера нет в справочнике.', 'truck'); return; }
  const ym = STATE.ym;
  topbar(`Машина ${v.name}`, { month: true, money: true, extra: `<a class="btn hide-m" href="#/cars">← Все машины</a>` });
  const ytd = PROFIT_YMS.map(y => carProfit(y, k));
  const ytdSum = ytd.reduce((s, x) => s + (x || 0), 0);
  const wYtd = PROFIT_YMS.reduce((s, y) => s + ((daysOf(y, k) || {}).worked || 0), 0);
  const calYtd = PROFIT_YMS.reduce((s, y) => s + (rowOf(y, k) ? daysIn(y) : 0), 0);
  const p = carProfit(ym, k), d = daysOf(ym, k);
  const r = rowOf(ym, k);
  const fuel = Object.keys(D.fuel_month).sort().map(y => [y, (D.fuel_month[y] || {})[k]]).filter(x => x[1]);
  const passport = [['Госномер', v.plate || '<span class="neg-ink">нет в «АВТО»</span>'], ['Модель', v.model || '—'], ['Год выпуска', v.year || '—'], ['Тахограф', v.tacho || '—'],
    ['Прицеп', v.trailer ? `${esc(v.trailer)} · ${esc(v.trailer_model || '')}${v.trailer_year ? ', ' + v.trailer_year : ''}` : '—'], ['Пробег по одометру', v.odo ? int(v.odo) + NB + 'км' + (v.odo > 5e6 ? ' <span class="chip warn">похоже на опечатку</span>' : '') : '—'],
    ['Амортизация в месяц', v.amort ? rub(v.amort) : '—']];
  $('#content').innerHTML = `${vatNote()}
    <section class="kpis k5">
      <article class="card kpi fade"><div class="lbl">Прибыль, ${ymLabel(ym).toLowerCase()}</div><div class="val ${p < 0 ? 'neg-ink' : ''}">${rub(p)}</div><div class="delta">${deltaChip(p, carProfit(prevYm(ym), k))} ${ALLOC_ON ? 'с общими' : 'до общих'}</div></article>
      <article class="card kpi fade"><div class="lbl">Прибыль с начала 2026</div><div class="val ${ytdSum < 0 ? 'neg-ink' : ''}">${rub(ytdSum)}</div><div class="delta">${PROFIT_YMS.length} мес.</div></article>
      <article class="card kpi fade"><div class="lbl">Прибыль в рабочий день, 2026</div><div class="val ${ytdSum < 0 ? 'neg-ink' : ''}">${wYtd ? rub(ytdSum / wYtd) : '—'}</div><div class="delta">${wYtd} раб. дней</div></article>
      <article class="card kpi fade"><div class="lbl">КИ, ${ymLabel(ym).toLowerCase()}</div><div class="val">${pct(carKi(ym, k))}</div><div class="delta">${d ? `${d.worked} раб. из ${SCHED[ym].manual ? daysIn(ym) : filledDays(ym)}` : 'нет в графике'}</div></article>
      <article class="card kpi fade"><div class="lbl">КИ с начала 2026</div><div class="val">${calYtd ? pct(wYtd / calYtd * 100) : '—'}</div><div class="delta">${wYtd} из ${calYtd} дн.</div></article>
    </section>
    <section class="g21" style="margin-top:14px">
      <div class="card panel"><div class="panel-h"><div><h2>Прибыль по месяцам</h2><p>2026 · ${ALLOC_ON ? 'с распределением общих' : 'до общих расходов'}</p></div></div><div id="cp" class="chart" style="height:260px"></div></div>
      <div class="card panel"><div class="panel-h"><div><h2>Паспорт</h2><p>из листа «АВТО»</p></div></div>
        <table><tbody>${passport.map(([a, b]) => `<tr><td class="muted">${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="g21" style="margin-top:14px">
      <div class="card panel"><div class="panel-h"><div><h2>Календарь статусов</h2><p>${ymLabel(ym)}${r && r.tx ? ' · текст из графика' : ''}</p></div></div>${r ? calendar(ym, r) : empty('Нет в графике', 'В этом месяце машины нет в графике работы.')}
        ${d ? `<div style="margin-top:12px">${daysBlock(d)}</div><p class="muted" style="font-size:12px;margin:4px 0 0">${d.basis === 'manual' ? 'Итоги — ручные, из графика диспетчера.' : 'Итоги посчитаны по ячейкам: ручных итогов за месяц нет.'}</p>` : ''}</div>
      <div class="stack">
        <div class="card panel"><div class="panel-h"><div><h2>Структура расходов</h2></div></div>${empty('Статьи расходов не внесены', 'Топливо, ремонт, зарплата и другие статьи появятся, когда бухгалтер заполнит шаблон за месяц.')}</div>
        <div class="card panel"><div class="panel-h"><div><h2>Топливо</h2><p>литры по топливной карте и ГЛОНАСС</p></div></div>${fuel.length ? '<div id="cf" class="chart" style="height:200px"></div>' : empty('Нет данных о заправках', 'По этой машине в «Анализе заправок» нет записей.', 'fuel')}</div>
      </div>
    </section>`;
  chart($('#cp'), {
    grid: { left: 4, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,.06)' } }, formatter: ps => `<b>${ymLabel(PROFIT_YMS[ps[0].dataIndex])}</b><br>${rub(ps[0].value)}<br><span style="color:${css('--ink-3')}">${(daysOf(PROFIT_YMS[ps[0].dataIndex], k) || {}).worked ?? '—'} раб. дней</span>` },
    xAxis: axisCat(PROFIT_YMS.map(y => MSHORT[Number(y.slice(5)) - 1])), yAxis: axisVal(),
    series: [{ type: 'bar', barWidth: '52%', data: ytd.map(x => ({ value: x, itemStyle: { color: x < 0 ? css('--s-down') : css('--s-up'), borderRadius: x < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] } })) }]
  });
  if (fuel.length) chart($('#cf'), {
    grid: { left: 4, right: 8, top: 30, bottom: 4, containLabel: true }, legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: css('--ink-2') } },
    tooltip: { trigger: 'axis', valueFormatter: v => v == null ? 'нет данных' : int(v) + NB + 'л' },
    xAxis: axisCat(fuel.map(x => ymShort(x[0]))), yAxis: axisVal(v => int(v)),
    series: [{ name: 'Карта (РН + Е100)', type: 'bar', barGap: '15%', barWidth: '30%', itemStyle: { color: css('--s-2'), borderRadius: [4, 4, 0, 0] }, data: fuel.map(x => Math.round(x[1].rn + x[1].e100)) },
             { name: 'ГЛОНАСС', type: 'bar', barWidth: '30%', itemStyle: { color: css('--s-up'), borderRadius: [4, 4, 0, 0] }, data: fuel.map(x => x[1].gl_days ? Math.round(x[1].gl) : null) }]
  });
  bindCal();
};
function calendar(ym, r) {
  const [y, m] = ym.split('-').map(Number);
  const first = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div></div>');
  for (let i = 0; i < r.c.length; i++) {
    const code = r.c[i]; const txt = r.tx && r.tx[i] != null ? D.textdic[r.tx[i]] : (code === 't' ? '↳ в рейсе' : code === '.' ? '' : ST[code][0]);
    const col = ST[code][1];
    cells.push(`<div class="d" style="--stc:${col ? `var(${col})` : 'transparent'}" data-tip="${esc(`<b>${i + 1} ${MONTHS_GEN[m - 1]}</b>${ST[code][0]}${txt && txt !== ST[code][0] ? '<br>' + txt : ''}`)}"><div class="n">${i + 1}</div><div class="t">${esc(txt || '')}</div></div>`);
  }
  return `<div class="cal">${['пн','вт','ср','чт','пт','сб','вс'].map(x => `<div class="dw">${x}</div>`).join('')}${cells.join('')}</div>`;
}
function bindCal() { $$('[data-tip]').forEach(el => { el.onmousemove = e => showTip(e, el.dataset.tip); el.onmouseleave = hideTip; }); }

/* ---------- Тепловая карта ---------- */
let HM = { mode: 'days', sort: 'ki' };
PAGES.heatmap = () => {
  const ym = STATE.ym;
  topbar('Тепловая карта парка', { month: HM.mode === 'days', extra: `<div class="seg"><button data-hm="days" class="${HM.mode === 'days' ? 'on' : ''}">Дни месяца</button><button data-hm="months" class="${HM.mode === 'months' ? 'on' : ''}">Месяцы</button></div>` });
  $$('[data-hm]').forEach(b => b.onclick = () => { HM.mode = b.dataset.hm; render(); });
  const legend = Object.entries(ST).filter(([c]) => c !== 't').map(([c, [n, v]]) => `<span><i style="background:${v ? `var(${v})` : 'transparent'};box-shadow:inset 0 0 0 1px var(--border-strong)"></i>${n}</span>`).join('');
  if (HM.mode === 'days') {
    const m = SCHED[ym];
    if (!m) { $('#content').innerHTML = empty('Графика нет', `За ${ymLabel(ym).toLowerCase()} график работы не загружен. Он есть с августа 2023 по октябрь 2026.`, 'heat'); return; }
    const nd = daysIn(ym); const [y, mm] = ym.split('-').map(Number);
    const rows = m.rows.slice().map(r => ({ r, w: (r.c.match(/[Tt]/g) || []).length })).sort((a, b) => HM.sort === 'ki' ? b.w - a.w : name(a.r.k).localeCompare(name(b.r.k), 'ru', { numeric: true }));
    const we = d => { const wd = new Date(y, mm - 1, d).getDay(); return wd === 0 || wd === 6; };
    let html = `<div class="hm" style="grid-template-columns:76px repeat(${nd}, minmax(14px,1fr)) 44px"><div></div>${Array.from({ length: nd }, (_, i) => `<div class="hd ${we(i + 1) ? 'we' : ''}">${i + 1}</div>`).join('')}<div class="hd">КИ</div>`;
    for (const { r, w } of rows) {
      html += `<div class="rl" data-car="${r.k}">${name(r.k)}</div>`;
      for (let i = 0; i < nd; i++) {
        const c = r.c[i] || '.'; const col = ST[c][1];
        const txt = r.tx && r.tx[i] != null ? D.textdic[r.tx[i]] : '';
        html += `<div class="c ${col ? '' : 'e'}" style="${col ? `background:var(${col})` : ''}" data-k="${r.k}" data-t="${esc(`<b>${name(r.k)} · ${i + 1} ${MONTHS_GEN[mm - 1]}</b>${ST[c][0]}${txt && txt !== ST[c][0] ? '<br>' + txt : ''}`)}"></div>`;
      }
      html += `<div class="hd num" style="align-self:center">${pct(w / (m.manual ? nd : filledDays(ym) || nd) * 100, 0)}</div>`;
    }
    html += '</div>';
    $('#content').innerHTML = `<div class="toolbar"><span class="muted">Сортировка:</span><button class="pill ${HM.sort === 'ki' ? 'on' : ''}" data-hs="ki">по рабочим дням</button><button class="pill ${HM.sort === 'n' ? 'on' : ''}" data-hs="n">по номеру</button></div>
      <div class="card panel"><div class="legend" style="margin-top:0">${legend}</div><div style="overflow:auto">${html}</div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Пустая ячейка после маршрута в графике означает, что машина ещё в рейсе: она закрашена светлым тоном рейса. Нажмите на номер, чтобы открыть машину.</p></div>`;
  } else {
    const yms = SCHED_YMS;
    const keys = [...new Set(yms.slice(-12).flatMap(y => SCHED[y].rows.map(r => r.k)))].sort((a, b) => name(a).localeCompare(name(b), 'ru', { numeric: true }));
    let html = `<div class="hm" style="grid-template-columns:76px repeat(${yms.length}, minmax(26px,1fr))"><div></div>${yms.map(y => `<div class="hd" style="font-size:10px">${ymShort(y).replace(' ', '<br>')}</div>`).join('')}`;
    for (const k of keys) {
      html += `<div class="rl" data-car="${k}">${name(k)}</div>`;
      for (const y of yms) {
        const kv = SCHED[y].rows.find(r => r.k === k) ? carKi(y, k) : null;
        const p = profitRaw(y, k);
        html += kv == null ? `<div class="c e"></div>` : `<div class="c m" data-ym="${y}" data-k="${k}" style="background:color-mix(in srgb, var(--st-T) ${Math.round(8 + kv * 0.92)}%, var(--surface-2))" data-t="${esc(`<b>${name(k)} · ${ymLabel(y)}</b>КИ ${pct(kv, 0)}${p != null ? '<br>Прибыль ' + rub(p) : ''}`)}"></div>`;
      }
    }
    html += '</div>';
    $('#content').innerHTML = `<div class="card panel"><div class="panel-h"><div><h2>КИ по месяцам</h2><p>чем темнее, тем больше рабочих дней · машины последних 12 месяцев</p></div></div>
      <div class="legend" style="margin-top:0"><span><i style="background:color-mix(in srgb, var(--st-T) 8%, var(--surface-2))"></i>0%</span><span><i style="background:color-mix(in srgb, var(--st-T) 54%, var(--surface-2))"></i>50%</span><span><i style="background:var(--st-T)"></i>100%</span></div>
      <div style="overflow:auto">${html}</div></div>`;
  }
  $$('[data-hs]').forEach(b => b.onclick = () => { HM.sort = b.dataset.hs; render(); });
  $$('.hm .c[data-t]').forEach(el => { el.onmousemove = e => showTip(e, el.dataset.t); el.onmouseleave = hideTip; el.onclick = () => { if (el.dataset.ym) STATE.ym = el.dataset.ym; hideTip(); go('car/' + encodeURIComponent(el.dataset.k)); }; });
  $$('.hm .rl').forEach(el => el.onclick = () => go('car/' + encodeURIComponent(el.dataset.car)));
};

/* ---------- Годы выпуска ---------- */
PAGES.years = () => {
  topbar('Сравнение по годам выпуска', { money: true });
  const yms = PROFIT_YMS;
  const cars = Object.keys(D.profit).map(k => {
    const v = V[k] || {}; let P = 0, W = 0, cal = 0, rep = 0, n = 0;
    for (const y of yms) { const p = carProfit(y, k), d = daysOf(y, k); if (p != null) { P += p; n++; } if (d) { W += d.worked; rep += d.unplanned + d.planned; cal += daysIn(y); } }
    return { k, year: v.year, make: v.make, P, W, cal, rep, ppd: W >= 10 ? P / W : null };
  }).filter(c => c.year);
  const b = S.groups;
  const groupOf = y => y <= b[0] ? `до ${b[0]}` : y <= b[1] ? `${b[0] + 1}–${b[1]}` : y <= b[2] ? `${b[1] + 1}–${b[2]}` : `${b[2] + 1} и новее`;
  const order = [`до ${b[0]}`, `${b[0] + 1}–${b[1]}`, `${b[1] + 1}–${b[2]}`, `${b[2] + 1} и новее`];
  const G = order.map(g => { const cs = cars.filter(c => groupOf(c.year) === g); const P = cs.reduce((s, c) => s + c.P, 0), W = cs.reduce((s, c) => s + c.W, 0), cal = cs.reduce((s, c) => s + c.cal, 0), rep = cs.reduce((s, c) => s + c.rep, 0);
    return { g, n: cs.length, ppd: W ? P / W : null, ki: cal ? W / cal * 100 : null, rep: cal ? rep / cal * 100 : null, makes: [...new Set(cs.map(c => c.make))].join(', ') }; });
  const old = G[0], nw = G[G.length - 1];
  let concl = 'Недостаточно данных для вывода.';
  if (old.n && nw.n && old.ppd != null && nw.ppd != null) {
    const diff = (old.ppd - nw.ppd) / Math.abs(nw.ppd) * 100;
    const gl = g => g.includes(' и новее') ? g.replace(' и новее', ' г. и новее') : g + ' г.';
    concl = `Машины ${gl(old.g)} приносят в рабочий день ${rub(old.ppd)} против ${rub(nw.ppd)} у машин ${gl(nw.g)} — на ${pct(Math.abs(diff), 0)} ${diff < 0 ? 'меньше' : 'больше'}; в ремонте они проводят ${pct(old.rep, 0)} дней против ${pct(nw.rep, 0)}.`;
  }
  const small = G.filter(g => g.n > 0 && g.n < 5);
  $('#content').innerHTML = `${vatNote()}
    <div class="note">${ico('info')}<div><b>Вывод.</b> ${concl} ${small.length ? `<br><span class="muted">В группах ${small.map(g => `«${g.g}» (${g.n} маш.)`).join(', ')} мало машин — по ним вывод ненадёжен.</span>` : ''}<br><span class="muted">Руб/км и л/100 км появятся, когда будет вноситься пробег. Сейчас сравнение идёт по прибыли в рабочий день и дням в ремонте, январь–${MONTHS[Number(LAST_PROFIT.slice(5)) - 1]} 2026.</span></div></div>
    <section class="g2">
      <div class="card panel"><div class="panel-h"><div><h2>Год выпуска × прибыль в рабочий день</h2><p>каждая точка — машина, не меньше 10 рабочих дней</p></div></div><div id="sc" class="chart" style="height:320px"></div></div>
      <div class="card panel"><div class="panel-h"><div><h2>По группам</h2><p>границы групп меняются в настройках</p></div></div><div id="gb" class="chart" style="height:200px"></div>
        <table><thead><tr><th>Группа</th><th>Машин</th><th>На раб. день</th><th>КИ</th><th>В ремонте</th></tr></thead><tbody>${G.map(g => `<tr><td>${g.g}<div class="plate">${g.makes || '—'}</div></td><td>${g.n}${g.n && g.n < 5 ? ' <span class="chip warn">мало</span>' : ''}</td><td class="${g.ppd < 0 ? 'neg-ink' : ''}">${g.ppd == null ? '—' : rub(g.ppd)}</td><td>${pct(g.ki, 0)}</td><td>${pct(g.rep, 0)}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
  const pts = cars.filter(c => c.ppd != null);
  chart($('#sc'), {
    grid: { left: 4, right: 12, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: 'item', formatter: p => `<b>${name(p.data.k)}</b> · ${p.data.value[0]} г.<br>${rub(p.data.value[1])} в раб. день` },
    xAxis: axisVal(v => String(v), { min: 2004, max: 2025, interval: 3 }), yAxis: axisVal(),
    series: [{ type: 'scatter', symbolSize: 11, data: pts.map(c => ({ k: c.k, value: [c.year + ((c.k.charCodeAt(0) % 5) - 2) * 0.08, Math.round(c.ppd)], itemStyle: { color: c.ppd < 0 ? css('--s-down') : css('--s-up'), opacity: .85, borderColor: css('--surface'), borderWidth: 2 } })),
      markLine: { silent: true, symbol: 'none', lineStyle: { color: css('--border-strong'), type: 'dashed' }, label: { show: false }, data: [{ yAxis: 0 }] } }]
  }).on('click', p => go('car/' + encodeURIComponent(p.data.k)));
  chart($('#gb'), {
    grid: { left: 4, right: 8, top: 22, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,.06)' } }, formatter: ps => `<b>${G[ps[0].dataIndex].g}</b><br>${rub(ps[0].value)} в раб. день<br>${G[ps[0].dataIndex].n} маш.` },
    xAxis: axisCat(G.map(g => g.g)), yAxis: axisVal(),
    series: [{ type: 'bar', barWidth: '46%', data: G.map(g => ({ value: g.ppd == null ? null : Math.round(g.ppd), itemStyle: { color: g.ppd < 0 ? css('--s-down') : css('--s-up'), borderRadius: 4 } })),
      label: { show: true, position: 'top', color: css('--ink'), fontWeight: 600, formatter: p => p.value == null ? '' : short(p.value) } }]
  });
};

/* ---------- Топливо ---------- */
PAGES.fuel = () => {
  const fyms = Object.keys(D.fuel_month).sort();
  let ym = fyms.includes(STATE.ym) ? STATE.ym : fyms[fyms.length - 1];
  topbar('Топливо', { extra: `<div class="seg">${fyms.map(y => `<button data-fy="${y}" class="${y === ym ? 'on' : ''}">${ymShort(y)}</button>`).join('')}</div>` });
  $$('[data-fy]').forEach(b => b.onclick = () => { STATE.ym = b.dataset.fy; render(); });
  const fm = D.fuel_month[ym] || {};
  const rows = Object.entries(fm).map(([k, f]) => { const card = f.rn + f.e100; const gl = f.gl_days ? f.gl : null; const diff = gl != null && gl > 0 ? (card - gl) / gl * 100 : null;
    return { k, card, rn: f.rn, e100: f.e100, gl, diff, anomaly: f.anomaly, flag: f.anomaly ? 'anom' : gl == null ? (card ? 'nogl' : '') : Math.abs(diff) > S.fuelPct ? 'over' : '' }; })
    .filter(r => r.card || r.gl).sort((a, b) => (b.flag === 'over') - (a.flag === 'over') || Math.abs(b.diff || 0) - Math.abs(a.diff || 0));
  const totCard = rows.reduce((s, r) => s + r.card, 0), cmp = rows.filter(r => r.gl != null && !r.anomaly);
  const over = rows.filter(r => r.flag === 'over').length;
  const flagHtml = r => r.flag === 'over' ? `<span class="chip neg">${r.diff > 0 ? 'карта больше' : 'ГЛОНАСС больше'}</span>` : r.flag === 'anom' ? `<span class="chip warn" title="В ГЛОНАСС за сутки больше ${S.glonassMax} л — похоже, внесены километры">проверить ГЛОНАСС</span>` : r.flag === 'nogl' ? '<span class="chip">нет ГЛОНАСС</span>' : '<span class="ok">в норме</span>';
  $('#content').innerHTML = `<div class="note">${ico('info')}<div>Данные — из листа «Анализ ЗАПРАВОК» (литры, ${ymLabel(fyms[0]).toLowerCase()} — ${ymLabel(fyms[fyms.length - 1]).toLowerCase()}). Сумм в рублях и пробега там нет, поэтому л/100 км и руб/км появятся после ввода пробега и загрузки выгрузок РН-Карт / Е100. Порог расхождения — ${S.fuelPct}%${ROLE === 'admin' ? ', меняется в <a href="#/settings" style="color:var(--teal-ink)">настройках</a>' : ''}.</div></div>
    <section class="kpis k5" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <article class="card kpi"><div class="lbl">Заправлено по картам</div><div class="val">${int(totCard)}<span class="u">л</span></div><div class="delta">${rows.length} машин</div></article>
      <article class="card kpi"><div class="lbl">Сравнимо с ГЛОНАСС</div><div class="val">${cmp.length}<span class="u">маш.</span></div><div class="delta">у остальных нет данных ГЛОНАСС</div></article>
      <article class="card kpi"><div class="lbl">Расхождение больше ${S.fuelPct}%</div><div class="val ${over ? 'neg-ink' : ''}">${over}<span class="u">маш.</span></div><div class="delta">карта против ГЛОНАСС</div></article>
      <article class="card kpi"><div class="lbl">Подозрительные данные</div><div class="val">${rows.filter(r => r.anomaly).length}<span class="u">маш.</span></div><div class="delta">ГЛОНАСС больше ${S.glonassMax} л в сутки</div></article>
    </section>
    <section class="g21" style="margin-top:14px">
      <div class="card panel"><div class="panel-h"><div><h2>Карта против ГЛОНАСС</h2><p>литры за месяц, машины с данными ГЛОНАСС</p></div></div><div id="fc" class="chart" style="height:${Math.max(260, cmp.length * 26)}px"></div></div>
      <div class="card"><div class="tbl-wrap" style="max-height:${Math.max(330, cmp.length * 26 + 70)}px"><table><thead><tr><th>Машина</th><th>РН, л</th><th class="col-m">Е100, л</th><th>ГЛОНАСС, л</th><th>Разница</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr class="click" data-car="${r.k}"><td><span class="car">${name(r.k)}</span></td><td>${int(r.rn)}</td><td class="col-m">${r.e100 ? int(r.e100) : '—'}</td><td>${r.gl == null ? '—' : int(r.gl)}</td><td class="${r.flag === 'over' ? 'neg-ink' : ''}">${r.diff == null ? '—' : (r.diff > 0 ? '+' : '') + pct(r.diff, 0)}</td><td>${flagHtml(r)}</td></tr>`).join('')}</tbody></table></div></div>
    </section>`;
  const cs = cmp.slice().sort((a, b) => b.card - a.card);
  if (cs.length) chart($('#fc'), {
    grid: { left: 4, right: 16, top: 30, bottom: 4, containLabel: true }, legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: css('--ink-2') } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,.06)' } }, valueFormatter: v => int(v) + NB + 'л' },
    yAxis: axisCat(cs.map(r => name(r.k)), { inverse: true }), xAxis: axisVal(v => int(v)),
    series: [{ name: 'Карта (РН + Е100)', type: 'bar', barWidth: 8, barGap: '25%', itemStyle: { color: css('--s-2'), borderRadius: [0, 4, 4, 0] }, data: cs.map(r => Math.round(r.card)) },
             { name: 'ГЛОНАСС', type: 'bar', barWidth: 8, itemStyle: { color: css('--s-up'), borderRadius: [0, 4, 4, 0] }, data: cs.map(r => Math.round(r.gl)) }]
  });
  bindCarRows();
};

/* ---------- Динамика ---------- */
PAGES.dynamics = () => {
  topbar('Динамика парка');
  const hist = D.idle_hist; // [worked, no_driver, idle, planned, unplanned] с 2021
  const yms = [...new Set([...Object.keys(hist), ...SCHED_YMS])].sort();
  const val = (ym, i) => hist[ym] ? hist[ym][i] : (() => { const f = fleetDays(ym); return f ? [f.worked, f.no_driver, f.idle, f.planned, f.unplanned][i] : null; })();
  const kis = yms.map(y => SCHED[y] ? ki(y) : null);
  $('#content').innerHTML = `<div class="note">${ico('info')}<div>Итоги по парку — из листа «Анализ простоев» (с января 2021). Помашинный график есть с августа 2023, поэтому КИ считается с этого месяца. Сентябрь и октябрь 2026 посчитаны по ячейкам графика, октябрь — по ${filledDays('2026-10')}-е число.</div></div>
    <div class="stack">
      <div class="card panel"><div class="panel-h"><div><h2>Машино-дни по статусам</h2><p>помесячно, ${ymLabel(yms[0]).toLowerCase()} — ${ymLabel(yms[yms.length - 1]).toLowerCase()}</p></div></div><div id="dd" class="chart" style="height:340px"></div></div>
      <div class="g2">
        <div class="card panel"><div class="panel-h"><div><h2>КИ парка</h2><p>рабочие дни ÷ календарные, с августа 2023</p></div></div><div id="dk" class="chart" style="height:260px"></div></div>
        <div class="card panel"><div class="panel-h"><div><h2>Прибыль парка</h2><p>2026, после общих расходов и амортизации</p></div></div><div id="dp" class="chart" style="height:260px"></div></div>
      </div></div>`;
  const ser = [['Рейс', 0, '--st-T'], ['Нет водителя', 1, '--st-D'], ['Нет заявки', 2, '--st-I'], ['ТО (план)', 3, '--st-W'], ['Ремонт (неплан)', 4, '--st-R']];
  chart($('#dd'), {
    grid: { left: 4, right: 8, top: 34, bottom: 30, containLabel: true }, legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: css('--ink-2') } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,.06)' } }, valueFormatter: v => v == null ? '—' : int(v) + NB + 'дн.' },
    dataZoom: [{ type: 'slider', height: 18, bottom: 4, startValue: Math.max(0, yms.length - 24), borderColor: 'transparent', fillerColor: 'rgba(20,200,180,.12)', textStyle: { color: css('--ink-3') } }, { type: 'inside' }],
    xAxis: axisCat(yms.map(ymShort)), yAxis: axisVal(v => int(v)),
    series: ser.map(([n, i, c], si) => ({ name: n, type: 'bar', stack: 'd', barWidth: '62%', itemStyle: { color: css(c), borderColor: css('--surface'), borderWidth: 1, borderRadius: si === ser.length - 1 ? [3, 3, 0, 0] : 0 }, data: yms.map(y => val(y, i)) }))
  });
  const kiYms = yms.filter((y, i) => kis[i] != null);
  chart($('#dk'), {
    grid: { left: 4, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', formatter: ps => `<b>${ymLabel(kiYms[ps[0].dataIndex])}</b><br>КИ ${pct(ps[0].value)}` },
    xAxis: axisCat(kiYms.map(ymShort), { boundaryGap: false }), yAxis: axisVal(v => v + '%', { max: 100 }),
    series: [{ type: 'line', data: kiYms.map(y => +ki(y).toFixed(1)), symbol: 'none', lineStyle: { width: 2, color: css('--s-up') }, areaStyle: { color: css('--s-up') + '22' } }]
  });
  chart($('#dp'), {
    grid: { left: 4, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,.06)' } }, formatter: ps => `<b>${ymLabel(PROFIT_YMS[ps[0].dataIndex])}</b><br>${rub(ps[0].value)}` },
    xAxis: axisCat(PROFIT_YMS.map(y => MSHORT[Number(y.slice(5)) - 1])), yAxis: axisVal(),
    series: [{ type: 'bar', barWidth: '52%', data: PROFIT_YMS.map(y => { const v = fleetTotal(y); return { value: v, itemStyle: { color: v < 0 ? css('--s-down') : css('--s-up'), borderRadius: v < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] } }; }) }]
  });
};

/* ---------- Сверка ---------- */
PAGES.recon = () => {
  topbar('Сверка');
  const pr = PROFIT_YMS.map(y => { const calc = sumCars(y) + sharedOf(y, 'tractor') + sharedOf(y, 'gen') + sharedOf(y, 'service') + sharedOf(y, 'amort'); return { y, calc, ref: fleetTotal(y), diff: calc - fleetTotal(y) }; });
  const dd = Object.keys(D.idle_hist).filter(y => SCHED[y] && SCHED[y].manual).map(y => { const f = fleetDays(y); const h = D.idle_hist[y]; return { y, g: f.worked, h: h[0], diff: f.worked - h[0] }; });
  const ddBad = dd.filter(x => x.diff);
  const cell = [];
  for (const y of SCHED_YMS.filter(y => y.startsWith('2026'))) for (const r of SCHED[y].rows) if (r.tot) { const dw = (r.calc.worked) - (r.tot.worked || 0); if (dw) cell.push({ y, k: r.k, man: r.tot.worked || 0, calc: r.calc.worked, diff: dw }); }
  const bench = D.bench;
  $('#content').innerHTML = `<div class="stack">
    <div class="card panel"><div class="panel-h"><div><h2>1. Прибыль: машины + общие = «Общий»</h2><p>пересчёт против итоговой строки таблицы прибыли</p></div><div class="spacer"></div>${pr.every(x => !x.diff) ? '<span class="chip pos">всё сходится</span>' : '<span class="chip neg">есть расхождения</span>'}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Месяц</th><th>Посчитано</th><th>В таблице</th><th>Разница</th></tr></thead><tbody>${pr.map(x => `<tr><td>${ymLabel(x.y)}</td><td>${rub(x.calc)}</td><td>${rub(x.ref)}</td><td class="${x.diff ? 'neg-ink' : 'ok'}">${x.diff ? rub(x.diff) : '✓ 0'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card panel"><div class="panel-h"><div><h2>2. Рабочие дни: график против «Анализа простоев»</h2><p>сумма ручных итогов по машинам против помесячной сводки</p></div><div class="spacer"></div><span class="chip ${ddBad.length ? 'warn' : 'pos'}">${ddBad.length ? `${ddBad.length} мес. расходятся` : 'всё сходится'} из ${dd.length}</span></div>
      ${ddBad.length ? `<table><thead><tr><th>Месяц</th><th>По графику</th><th>В «Анализе простоев»</th><th>Разница</th></tr></thead><tbody>${ddBad.map(x => `<tr><td>${ymLabel(x.y)}</td><td>${x.g}</td><td>${x.h}</td><td class="neg-ink">${int(x.diff)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
    <div class="card panel"><div class="panel-h"><div><h2>3. Ручные итоги против ячеек графика</h2><p>2026: где число рабочих дней диспетчера отличается от пересчёта по ячейкам. В расчётах используются ручные итоги.</p></div><div class="spacer"></div><span class="chip warn">${cell.length} строк</span></div>
      <div class="tbl-wrap" style="max-height:360px"><table><thead><tr><th>Месяц</th><th>Машина</th><th>Ручные итоги</th><th>По ячейкам</th><th>Разница</th></tr></thead><tbody>${cell.map(x => `<tr class="click" data-car="${x.k}" data-ym="${x.y}"><td>${ymLabel(x.y)}</td><td><span class="car">${name(x.k)}</span></td><td>${x.man}</td><td>${x.calc}</td><td class="neg-ink">${(x.diff > 0 ? '+' : '') + int(x.diff)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card panel"><div class="panel-h"><div><h2>4. Ваши заметки руб/км</h2><p>себестоимость и средняя стоимость 1 км из таблицы прибыли</p></div></div>
      <table><thead><tr><th>Месяц</th><th>Себестоимость, ₽/км</th><th>Стоимость км, ₽</th><th>Расчёт FiberTrack</th></tr></thead><tbody>${Object.entries(bench).sort((a, b) => a[0] - b[0]).map(([m, b]) => `<tr><td>${cap(MONTHS[m - 1])} 2026</td><td>${dec(b.cost, 0)}${b.tax ? ' <span class="chip">налоговая</span>' : ''}</td><td>${dec(b.rate)}</td><td class="muted">нет пробега — не с чем сравнить</td></tr>`).join('')}</tbody></table>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Заметок за июль и август в таблице нет. Месяц для заметки «на 1-е число» принят как предыдущий (на 1.02 — январь).</p></div>
    <div class="card panel"><div class="panel-h"><div><h2>5. Отчёт 1С</h2></div></div>${empty('Отчёт не загружен', 'Когда загрузите отчёт с выручкой и расходами (1С или любой другой) через «Загрузка и ввод», здесь появится сверка по строкам.', 'recon')}</div>
  </div>`;
  $$('tr[data-ym]').forEach(tr => tr.onclick = () => { STATE.ym = tr.dataset.ym; (ROLE === 'input' ? null : go('car/' + encodeURIComponent(tr.dataset.car))); });
};

/* ---------- Отчёт для руководителя (A4) ---------- */
PAGES.report = () => {
  if (!hasProfit(STATE.ym)) STATE.ym = LAST_PROFIT;
  const ym = STATE.ym, prev = prevYm(ym);
  topbar('Отчёт для руководителя', { month: true, extra: `<button class="btn primary" id="print">${ico('pdf', 15)}Печать / PDF</button><button class="btn hide-m" id="xls">${ico('xls', 15)}Excel</button>` });
  const f = fleetDays(ym), P = fleetTotal(ym), PP = hasProfit(prev) ? fleetTotal(prev) : null;
  const rows = carsWithProfit(ym).map(k => ({ k, p: allocation(ym).cars[k].alloc, raw: profitRaw(ym, k), d: (daysOf(ym, k) || {}).worked })).sort((a, b) => b.raw - a.raw);
  const loss = rows.filter(r => r.raw < 0).length;
  const t = list => `<table><thead><tr><th>Машина</th><th>Прибыль</th><th>Раб. дн.</th><th>На раб. день</th></tr></thead><tbody>${list.map(r => `<tr><td><b>${name(r.k)}</b></td><td class="${r.raw < 0 ? 'neg-ink' : ''}">${rub(r.raw)}</td><td>${r.d ?? '—'}</td><td class="${r.raw < 0 ? 'neg-ink' : ''}">${r.d ? rub(r.raw / r.d) : '—'}</td></tr>`).join('')}</tbody></table>`;
  const kNow = ki(ym), kPrev = SCHED[prev] ? ki(prev) : null;
  const best = rows[0], worst = rows[rows.length - 1];
  $('#content').innerHTML = `<div class="a4" id="a4">
    <div class="rh"><div class="mark"><svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 4.5h10.5M3 9h7.5M3 13.5h4.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="12.5" r="2.4" fill="#14C8B4"/></svg></div>
      <div><div class="wordmark" style="font-size:13px">Fiber<b>Track</b></div><h1>Работа парка · ${ymLabel(ym).toLowerCase()}</h1></div>
      <div class="meta">Сформировано ${new Date().toLocaleDateString('ru-RU')}<br>${carsWithProfit(ym).length} машин в отчёте</div></div>
    <div class="rk">
      <div><small>Прибыль парка</small><b class="${P < 0 ? 'neg-ink' : ''}">${rub(P)}</b><span>${PP != null ? `${deltaChip(P, PP).replace(/<[^>]+>/g, '')} к прошлому месяцу` : ''}</span></div>
      <div><small>Прибыль машин до общих</small><b>${rub(sumCars(ym))}</b><span>общие и амортизация: ${rub(P - sumCars(ym))}</span></div>
      <div><small>КИ парка</small><b>${pct(kNow)}</b><span>${kPrev != null ? (kNow - kPrev < 0 ? MINUS : '+') + dec(Math.abs(kNow - kPrev)) + ' п.п.' : ''} · ${f.worked} из ${f.cal} маш.-дн.</span></div>
      <div><small>Машин в убытке</small><b>${loss} из ${rows.length}</b><span>до распределения общих</span></div>
    </div>
    <div class="concl"><b>Коротко.</b> Прибыль парка ${rub(P)}${PP != null ? `, ${P >= PP ? 'больше' : 'меньше'} прошлого месяца на ${rub(Math.abs(P - PP))}` : ''}. Лучшая машина — ${name(best.k)} (${rub(best.raw)}), худшая — ${name(worst.k)} (${rub(worst.raw)}). Без водителя потеряно ${f.no_driver} машино-дней, во внеплановом ремонте — ${f.unplanned}.</div>
    <div class="two"><div><h3>От прибыли машин к прибыли парка</h3><div id="rw" class="chart"></div></div><div><h3>Машино-дни по статусам</h3>${daysBlock(f)}<div id="rp" class="chart" style="height:44mm"></div></div></div>
    <div class="two"><div><h3>Топ-5</h3>${t(rows.slice(0, 5))}</div><div><h3>Анти-топ-5</h3>${t(rows.slice(-5).reverse())}</div></div>
    <div class="rf"><span>FiberTrack · отчёт о рентабельности парка</span><span>Прибыль до распределения — из таблицы «Прибыль по машинам»; дни — график работы</span></div>
  </div>`;
  // в отчёте всегда светлая палитра
  const root = document.documentElement, saved = root.dataset.theme; root.dataset.theme = 'light';
  waterfall($('#rw'), ym, true);
  chart($('#rp'), { grid: { left: 4, right: 8, top: 10, bottom: 4, containLabel: true }, xAxis: axisCat(PROFIT_YMS.map(y => MSHORT[Number(y.slice(5)) - 1]), { axisLabel: { color: '#8590A2', fontSize: 10 } }), yAxis: axisVal(short, { splitNumber: 2, axisLabel: { color: '#8590A2', fontSize: 10, formatter: short } }),
    series: [{ type: 'bar', barWidth: '50%', data: PROFIT_YMS.map(y => ({ value: fleetTotal(y), itemStyle: { color: y === ym ? '#0B1F3A' : (fleetTotal(y) < 0 ? '#E5484D' : '#9FB0C6'), borderRadius: 3 } })) }] });
  if (saved) root.dataset.theme = saved; else delete root.dataset.theme;
  $('#print').onclick = () => window.print();
  $('#xls').onclick = exportExcel;
};

/* ---------- Загрузка и ввод ---------- */
/* ---------- периоды: владелец открывает и закрывает месяцы ---------- */
let PERIODS = {};
try { PERIODS = JSON.parse(localStorage.getItem('ft-periods') || '{}'); } catch (e) {}
const savePeriods = () => { try { localStorage.setItem('ft-periods', JSON.stringify(PERIODS)); } catch (e) {} };
const CUR_YM = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`;
/* по умолчанию: месяцы с внесённой прибылью закрыты, остальные до текущего включительно — открыты, будущие — не начаты */
const periodStatus = ym => PERIODS[ym] || (hasProfit(ym) ? 'closed' : ym <= CUR_YM ? 'open' : 'future');
const PERIOD_YMS = () => { const out = []; let y = '2026-01'; const last = nextYm(nextYm(nextYm(CUR_YM))); while (y <= last) { out.push(y); y = nextYm(y); } return out; };
const openMonths = () => PERIOD_YMS().filter(y => periodStatus(y) === 'open');
/* машины месяца: из графика, а для месяца без графика — все машины в работе */
const LAST_SCHED = SCHED_YMS[SCHED_YMS.length - 1];
const monthCars = ym => [...new Set([...(SCHED[ym] ? SCHED[ym].rows.map(r => r.k) : SCHED[LAST_SCHED].rows.map(r => r.k)), ...Object.keys(VEDIT)])].filter(k => V[k] && isActive(k, V[k]));
PAGES.input = () => {
  const OPEN = openMonths();
  if (!OPEN.length) { topbar('Загрузка и ввод'); $('#content').innerHTML = empty('Нет открытых месяцев', ROLE === 'admin' ? 'Откройте месяц на экране <a href="#/periods" style="color:var(--teal-ink)">«Месяцы»</a>.' : 'Все месяцы закрыты. Попросите владельца открыть нужный месяц.', 'upload'); return; }
  let ym = OPEN.includes(STATE.ym) ? STATE.ym : OPEN[OPEN.length - 1];
  topbar('Загрузка и ввод', { extra: `<div class="seg">${OPEN.map(y => `<button data-iy="${y}" class="${y === ym ? 'on' : ''}">${ymLabel(y)}</button>`).join('')}</div>` });
  $$('[data-iy]').forEach(b => b.onclick = () => { STATE.ym = b.dataset.iy; render(); });
  const keys = monthCars(ym);
  const inp = INPUT[ym] || {};
  const done = keys.filter(k => inp[k] && inp[k].km != null && inp[k].rev != null).length;
  const part = keys.filter(k => inp[k] && !(inp[k].km != null && inp[k].rev != null)).length;
  $('#content').innerHTML = `<div class="g21">
    <div class="stack">
      <div class="card panel"><div class="panel-h"><div><h2>Загрузить файл</h2><p>шаблон FiberTrack, отчёт 1С или другой отчёт, график работы, заправки, справочник машин (лист «АВТО»)</p></div></div>
        <label class="drop" id="drop"><input type="file" id="file" hidden accept=".xlsx,.xls,.csv"><span class="ico-circle">${ico('upload', 20)}</span><h3>Перетащите файл сюда</h3><p>или нажмите, чтобы выбрать · xlsx, xls, csv</p></label>
        <div id="preview"></div></div>
      <div class="card panel"><div class="panel-h"><div><h2>Статус по машинам</h2><p>${ymLabel(ym)} · открыт для ввода${SCHED[ym] ? '' : ' · графика ещё нет, в списке все машины в работе'}</p></div><div class="spacer"></div><button class="btn" id="tpl">${ico('dl', 15)}Скачать шаблон на месяц</button></div>
        <div style="display:flex;align-items:center;gap:12px;margin:6px 0 14px"><div class="progress" style="flex:1"><span style="width:${keys.length ? done / keys.length * 100 : 0}%"></span></div><b class="num">Внесено ${done} из ${keys.length}</b></div>
        <div class="tbl-wrap" style="max-height:440px"><table><thead><tr><th>Машина</th><th>Пробег, км</th><th>Выручка</th><th>Расходы</th><th>Статус</th><th></th></tr></thead><tbody>
        ${keys.map(k => { const x = inp[k] || {}; const st = x.km != null && x.rev != null ? ['внесено', 'var(--st-T)'] : x.km != null || x.rev != null ? ['частично', 'var(--st-I)'] : ['не внесено', 'var(--border-strong)'];
          const exp = ['fuel', 'repair', 'salary', 'other'].reduce((s, f) => s + (x[f] || 0), 0);
          return `<tr class="click" data-row="${k}"><td><span class="car">${name(k)}</span> <span class="plate">${esc((V[k] || {}).plate || '')}</span></td><td>${x.km != null ? int(x.km) : '—'}</td><td>${x.rev != null ? rub(x.rev) : '—'}</td><td>${exp ? rub(exp) : '—'}</td><td class="l"><span class="status-dot" style="background:${st[1]}"></span>${st[0]}</td><td><button class="btn" data-edit="${k}">Ввести</button></td></tr>`; }).join('')}
        </tbody></table></div></div>
    </div>
    <div class="stack">
      <div class="card panel"><div class="panel-h"><div><h2>Как это работает</h2></div></div>
        <ol style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.7">
          <li>Скачайте шаблон: в нём уже стоят все машины месяца.</li><li>Заполните пробег, выручку и расходы по статьям, укажите ставку НДС.</li>
          <li>Перетащите файл в окно слева и проверьте предпросмотр: ошибки подсвечены.</li><li>Нажмите «Применить». Пока месяц открыт, данные можно исправить: повторная загрузка шаблона за тот же месяц заменяет прошлую по тем же машинам и статьям, прошлая остаётся в истории.</li></ol></div>
      <div class="card panel"><div class="panel-h"><div><h2>Проверки при вводе</h2></div></div>
        <ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.7"><li>Пробег от ${int(S.kmMin)} до ${int(S.kmMax)} км в месяц</li><li>Расход от ${S.lMin} до ${S.lMax} л/100 км</li><li>Дни — не больше, чем дней в месяце</li><li>Нет дублей: машина + статья + документ</li><li>При ставке «без НДС» сумма НДС = 0</li></ul></div>
      <div class="note" style="margin:0">${ico('info')}<div>Это прототип: файлы разбирает сервер в рабочей версии. Ручной ввод здесь сохраняется только в этом браузере.</div></div>
    </div></div>`;
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  const onFile = file => { if (!file) return; const kind = /шаблон|fibertrack/i.test(file.name) ? 'Шаблон FiberTrack' : /1с|1c|рентаб/i.test(file.name) ? 'Отчёт 1С' : /парк|график/i.test(file.name) ? 'График работы' : 'Отчёт (мастер колонок)';
    $('#preview').innerHTML = `<div class="callout fade"><b>${esc(file.name)}</b> · ${(file.size / 1024).toFixed(0)} КБ · тип: ${kind}<br>В рабочей версии здесь появится предпросмотр: распознанные машины и суммы, ошибки подсвечены красным, несопоставленное уйдёт в очередь «Проверить». Затем — кнопка «Применить».</div>`; };
  drop.addEventListener('drop', e => onFile(e.dataTransfer.files[0]));
  $('#file').onchange = e => onFile(e.target.files[0]);
  $('#tpl').onclick = () => downloadTemplate(ym, keys);
  $$('[data-row]').forEach(tr => tr.onclick = () => openEntry(ym, tr.dataset.row));
};
function openEntry(ym, k) {
  const x = (INPUT[ym] || {})[k] || {};
  const nd = daysIn(ym);
  const f = (id, label, val, extra = '') => `<label>${label}<input type="number" id="${id}" value="${val ?? ''}" ${extra}><span class="err" id="${id}-e"></span></label>`;
  $('#modal').innerHTML = `<div class="card modal fade" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">${name(k)} · ${ymLabel(ym).toLowerCase()}</h2><p class="muted" style="margin:0">${esc((V[k] || {}).plate || '')} · суммы в рублях</p>
    <div class="form">${f('km', 'Пробег, км', x.km, 'min="0"')}${f('days', 'Рабочих дней (если нет в графике)', x.days, `min="0" max="${nd}"`)}
      ${f('rev', 'Выручка от перевозок', x.rev)}<label>Ставка НДС<select class="inp" id="vat">${['22%', '10%', '7%', '5%', '0%', 'без НДС'].map(v => `<option ${x.vat === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${f('fuel', 'Топливо', x.fuel)}${f('repair', 'Ремонт и запчасти', x.repair)}${f('salary', 'Зарплата водителей', x.salary)}${f('other', 'Прочие расходы', x.other)}
      <label class="full" style="display:flex;gap:8px;align-items:center;flex-direction:row"><input type="checkbox" id="gross" ${x.gross !== false ? 'checked' : ''}> Суммы указаны с НДС</label></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="btn" id="mc">Отмена</button><button class="btn primary" id="ms">Сохранить</button></div></div>`;
  $('#modal').classList.add('open');
  $('#km').focus();
  const close = () => $('#modal').classList.remove('open');
  $('#mc').onclick = close; $('#modal').onclick = e => { if (e.target.id === 'modal') close(); };
  $('#ms').onclick = () => {
    const num = id => { const v = $('#' + id).value; return v === '' ? null : Number(v); };
    const data = { km: num('km'), days: num('days'), rev: num('rev'), fuel: num('fuel'), repair: num('repair'), salary: num('salary'), other: num('other'), vat: $('#vat').value, gross: $('#gross').checked };
    let ok = true; $$('.err', $('#modal')).forEach(e => e.textContent = '');
    const err = (id, t) => { $('#' + id + '-e').textContent = t; ok = false; };
    if (data.km != null && (data.km < S.kmMin || data.km > S.kmMax)) err('km', `Пробег должен быть от ${int(S.kmMin)} до ${int(S.kmMax)} км`);
    if (data.days != null && (data.days < 0 || data.days > nd)) err('days', `В месяце ${nd} дней`);
    if (data.fuel != null && data.km) { /* литров нет — проверка л/100 км будет на сервере по заправкам */ }
    if (data.vat === 'без НДС' && data.gross && [data.rev, data.fuel, data.repair, data.salary, data.other].some(v => v)) err('fuel', 'Ставка «без НДС», а отмечено «с НДС» — снимите галочку или выберите ставку');
    ['rev', 'fuel', 'repair', 'salary', 'other'].forEach(id => { if (data[id] != null && data[id] < 0) err(id, 'Сумма не может быть отрицательной'); });
    if (!ok) return;
    INPUT[ym] = INPUT[ym] || {}; INPUT[ym][k] = data; saveInput(); close(); toast(`${name(k)}: сохранено`); render();
  };
  document.onkeydown = e => { if (e.key === 'Escape') close(); };
}

/* ---------- Проверить ---------- */
PAGES.review = () => {
  topbar('Проверить');
  const groups = {};
  openReview().forEach(r => (groups[r.kind] = groups[r.kind] || []).push(r));
  const hint = { 'Машина без госномера': 'Укажите госномер в <a href="#/fleet" style="color:var(--teal-ink)">справочнике машин</a>: после этого пункт исчезнет, а номер будет сопоставляться автоматически.', 'Дубль машины в графике': 'В одном месяце машина записана дважды. Проверьте, какая строка верная.', 'Сумма дней ≠ дней в месяце': 'Итоги по статусам в строке не складываются в число дней месяца.' };
  $('#content').innerHTML = `<div class="note">${ico('info')}<div>Здесь всё, что программа не стала угадывать при импорте. Пока пункт не разобран, данные по нему не попадают в расчёты (кроме ручных итогов дней — они взяты как есть).</div></div>
    <div class="stack">${Object.entries(groups).map(([kind, list]) => `<div class="card panel"><div class="panel-h"><div><h2>${kind}</h2><p>${hint[kind] || ''}</p></div><div class="spacer"></div><span class="chip warn">${list.length}</span></div>
      <div class="tbl-wrap" style="max-height:320px"><table><thead><tr><th>Значение</th><th class="l">Где</th><th class="l">Что сделано</th><th></th></tr></thead><tbody>${list.map(r => `<tr><td><b>${esc(r.value)}</b></td><td class="l">${esc(r.where)}</td><td class="l muted">${esc(r.action)}</td><td><button class="btn" onclick="this.closest('tr').style.opacity=.4;this.textContent='Разобрано';this.disabled=true">Разобрать</button></td></tr>`).join('')}</tbody></table></div></div>`).join('')}</div>`;
};


/* ---------- Месяцы (открытие и закрытие) ---------- */
PAGES.periods = () => {
  topbar('Месяцы');
  const ST_LABEL = { open: ['открыт', 'pos'], closed: ['закрыт', ''], future: ['не начат', 'warn'] };
  const rows = PERIOD_YMS().slice().reverse().map(ym => {
    const st = periodStatus(ym), keys = monthCars(ym), inp = INPUT[ym] || {};
    const done = keys.filter(k => inp[k] && inp[k].km != null && inp[k].rev != null).length;
    const fill = hasProfit(ym) ? 'прибыль внесена (таблица прибыли)' : `внесено ${done} из ${keys.length}`;
    const btn = st === 'open' ? `<button class="btn" data-close="${ym}">Закрыть</button>` : st === 'closed' ? `<button class="btn" data-reopen="${ym}">Переоткрыть</button>` : `<button class="btn primary" data-open="${ym}">Открыть для ввода</button>`;
    return `<tr><td><b>${ymLabel(ym)}</b>${ym === CUR_YM ? ' <span class="chip">текущий</span>' : ''}</td><td class="l"><span class="chip ${ST_LABEL[st][1]}">${ST_LABEL[st][0]}</span></td><td class="l muted">${fill}</td><td>${btn}</td></tr>`;
  }).join('');
  $('#content').innerHTML = `<div class="note">${ico('info')}<div><b>Как это работает.</b> Бухгалтер вносит данные только в открытые месяцы. Закрытый месяц не меняется: цифры в отчётах фиксируются. Новый месяц можно открыть заранее — например, ноябрь, чтобы бухгалтер начал вносить первые документы. В рабочей версии текущий месяц будет открываться сам 1-го числа.</div></div>
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Месяц</th><th class="l">Статус</th><th class="l">Заполнение</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  const log = (ym, a, b, why) => { AUDIT.push({ at: new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), who: ROLES[ROLE], car: ymLabel(ym), field: 'Статус месяца' + (why ? ` (${why})` : ''), before: a, after: b }); saveFleet(); };
  $$('[data-open]').forEach(b => b.onclick = () => { const ym = b.dataset.open; PERIODS[ym] = 'open'; savePeriods(); log(ym, 'не начат', 'открыт'); toast(`${ymLabel(ym)} открыт для ввода`); render(); });
  $$('[data-close]').forEach(b => b.onclick = () => {
    const ym = b.dataset.close, keys = monthCars(ym), inp = INPUT[ym] || {};
    const left = keys.filter(k => !(inp[k] && inp[k].km != null && inp[k].rev != null)).length;
    if (!confirm(`Закрыть ${ymLabel(ym).toLowerCase()}?${left ? `\n\nНе внесено по ${left} машинам из ${keys.length}.` : ''}\nПосле закрытия бухгалтер не сможет менять данные за этот месяц.`)) return;
    PERIODS[ym] = 'closed'; savePeriods(); log(ym, 'открыт', 'закрыт'); toast(`${ymLabel(ym)} закрыт`); render(); });
  $$('[data-reopen]').forEach(b => b.onclick = () => {
    const ym = b.dataset.reopen; const why = prompt(`Причина переоткрытия: ${ymLabel(ym).toLowerCase()}`); if (!why || !why.trim()) return;
    PERIODS[ym] = 'open'; savePeriods(); log(ym, 'закрыт', 'открыт', why.trim()); toast(`${ymLabel(ym)} снова открыт`); render(); });
};

/* ---------- Справочник машин ---------- */
const PLATE_RE = /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/;
const LAT2CYR = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
const normPlate = s => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[ABEKMHOPCTYX]/g, c => LAT2CYR[c]);
const MAKES = ['FAW', 'MAN', 'DAF', 'SCANIA', 'MERCEDES', 'OTHER'];
const FIELDS = { plate: 'Госномер', make: 'Марка', model: 'Модель', year: 'Год выпуска', trailer: 'Прицеп', trailer_model: 'Модель прицепа', trailer_year: 'Год прицепа', amort: 'Амортизация в месяц', from: 'В парке с', to: 'Выведена', active: 'Активна' };
let FLEET_UI = { q: '', show: 'active' };
const isActive = (k, v) => v.active !== undefined ? v.active : !v.history_only && !v.to;
PAGES.fleet = () => {
  const canEdit = ROLE !== 'viewer';
  topbar('Справочник машин', { extra: canEdit ? `<button class="btn primary" id="addCar">+ Добавить машину</button>` : '' });
  const keys = Object.keys(V).sort((a, b) => name(a).localeCompare(name(b), 'ru', { numeric: true }));
  const draw = () => {
    const q = FLEET_UI.q.trim().toLowerCase();
    const list = keys.filter(k => { const v = V[k]; const act = isActive(k, v);
      return (FLEET_UI.show === 'all' || (FLEET_UI.show === 'active' ? act : FLEET_UI.show === 'noplate' ? !v.plate && act : !act)) && (!q || `${v.name} ${v.plate || ''} ${v.model || ''} ${v.trailer || ''}`.toLowerCase().includes(q)); });
    $('#fleetTable').innerHTML = list.length ? `<table><thead><tr><th>Машина</th><th class="l">Госномер</th><th class="l">Модель</th><th>Год</th><th class="l col-m">Прицеп</th><th class="col-m">Амортизация</th><th class="l">Статус</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>
      ${list.map(k => { const v = V[k]; const act = isActive(k, v); return `<tr class="${canEdit ? 'click' : ''}" data-fk="${esc(k)}"><td><span class="car">${esc(v.name)}</span>${VEDIT[k] ? ' <span class="chip" title="Изменено вручную">изм.</span>' : ''}</td>
        <td class="l">${v.plate ? esc(v.plate) : '<span class="chip warn">нет госномера</span>'}</td><td class="l">${esc(v.model || '—')}</td><td>${v.year || '—'}</td>
        <td class="l col-m">${v.trailer ? esc(v.trailer) + `<div class="plate">${esc(v.trailer_model || '')}</div>` : '—'}</td><td class="col-m">${v.amort ? rub(v.amort) : '—'}</td>
        <td class="l"><span class="status-dot" style="background:${act ? 'var(--st-T)' : 'var(--border-strong)'}"></span>${act ? 'в работе' : 'выведена' + (v.to ? ' с ' + esc(v.to) : '')}</td>${canEdit ? '<td><button class="btn">Изменить</button></td>' : ''}</tr>`; }).join('')}</tbody></table>`
      : empty('Ничего не найдено', 'Измените поиск или фильтр.', 'search');
    if (canEdit) $$('[data-fk]').forEach(tr => tr.onclick = () => editCar(tr.dataset.fk));
  };
  const nopl = keys.filter(k => !V[k].plate && isActive(k, V[k])).length;
  $('#content').innerHTML = `${nopl ? `<div class="note warn">${ico('info')}<div>У ${nopl} машин нет госномера — без него не сопоставляются выгрузки 1С и топливных карт.</div></div>` : ''}
    <div class="toolbar"><label class="search">${ico('search')}<input id="fq" type="text" placeholder="Номер, госномер, модель, прицеп" value="${esc(FLEET_UI.q)}" aria-label="Поиск"></label>
      ${[['active', 'В работе'], ['noplate', 'Без госномера'], ['out', 'Выведены'], ['all', 'Все']].map(([v, t]) => `<button class="pill ${FLEET_UI.show === v ? 'on' : ''}" data-fs="${v}">${t}</button>`).join('')}</div>
    <div class="stack"><div class="card"><div class="tbl-wrap" id="fleetTable" style="max-height:640px"></div></div>
      <div class="card panel"><div class="panel-h"><div><h2>Журнал изменений</h2><p>кто, что и когда менял в справочнике</p></div></div>
        ${AUDIT.length ? `<div class="tbl-wrap" style="max-height:360px"><table><tbody>${AUDIT.slice().reverse().slice(0, 60).map(a => `<tr><td class="l" style="white-space:normal"><b>${esc(a.car)}</b> · ${esc(a.field)}<div class="plate">${esc(a.before ?? '—')} → <b style="color:var(--ink)">${esc(a.after ?? '—')}</b></div></td><td class="muted" style="font-size:12px">${esc(a.who)}<br>${esc(a.at)}</td></tr>`).join('')}</tbody></table></div>`
          : empty('Изменений пока нет', 'Здесь появится каждая правка: кто изменил, что было и что стало.')}</div></div>`;
  $('#fq').oninput = e => { FLEET_UI.q = e.target.value; draw(); };
  $$('[data-fs]').forEach(b => b.onclick = () => { FLEET_UI.show = b.dataset.fs; $$('[data-fs]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  if (canEdit) $('#addCar').onclick = () => editCar(null);
  draw();
};
function editCar(k) {
  const isNew = !k, v = isNew ? { make: 'FAW' } : V[k];
  const inp = (id, label, val, attrs = '') => `<label>${label}<input id="${id}" ${attrs} value="${esc(val ?? '')}"><span class="err" id="${id}-e"></span></label>`;
  $('#modal').innerHTML = `<div class="card modal fade" role="dialog" aria-modal="true" aria-labelledby="ct"><h2 id="ct">${isNew ? 'Новая машина' : 'Машина ' + esc(v.name)}</h2><p class="muted" style="margin:0">Изменения сразу видны во всех отчётах и попадают в журнал</p>
    <div class="form">
      ${inp('f-short', 'Короткий номер', isNew ? '' : v.name, `type="text" placeholder="например, 885 или 308 М" ${isNew ? '' : 'disabled'}`)}
      ${inp('f-plate', 'Госномер', v.plate, 'type="text" placeholder="Т970ОН58"')}
      <label>Марка<select class="inp" id="f-make">${MAKES.map(m => `<option ${v.make === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      ${inp('f-model', 'Модель', v.model, 'type="text" placeholder="FAW J7 EURO 6"')}
      ${inp('f-year', 'Год выпуска', v.year, 'type="number" min="1990"')}
      ${inp('f-amort', 'Амортизация в месяц, ₽', v.amort, 'type="number" min="0" step="1000"')}
      ${inp('f-trailer', 'Прицеп (госномер)', v.trailer, 'type="text" placeholder="АН 9275/58"')}
      ${inp('f-tmodel', 'Модель прицепа', v.trailer_model, 'type="text"')}
      ${inp('f-from', 'В парке с', v.from, 'type="date"')}
      ${inp('f-to', 'Выведена из парка', v.to, 'type="date"')}
      <label class="full" style="display:flex;gap:8px;align-items:center;flex-direction:row"><input type="checkbox" id="f-active" ${isActive(k, v) ? 'checked' : ''}> Машина в работе (попадает в шаблон месяца)</label>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="btn" id="mc">Отмена</button><button class="btn primary" id="ms">Сохранить</button></div></div>`;
  $('#modal').classList.add('open');
  (isNew ? $('#f-short') : $('#f-plate')).focus();
  const close = () => $('#modal').classList.remove('open');
  $('#mc').onclick = close; $('#modal').onclick = e => { if (e.target.id === 'modal') close(); };
  document.onkeydown = e => { if (e.key === 'Escape') close(); };
  $('#ms').onclick = () => {
    $$('.err', $('#modal')).forEach(e => e.textContent = '');
    let ok = true; const err = (id, t) => { $('#' + id + '-e').textContent = t; ok = false; };
    let key = k;
    if (isNew) {
      const m = /^0*(\d{1,3})\s*([МДФ]?)$/i.exec($('#f-short').value.trim().toUpperCase());
      if (!m) err('f-short', 'Номер из 1–3 цифр, при двойнике — буква М, Д или Ф');
      else { key = String(Number(m[1])) + (m[2] || ''); if (V[key]) err('f-short', `Машина ${displayKey(key)} уже есть в справочнике`); }
    }
    const plate = normPlate($('#f-plate').value);
    if (plate && !PLATE_RE.test(plate)) err('f-plate', 'Формат: буква, 3 цифры, 2 буквы, регион — например Т970ОН58');
    const dup = plate && Object.entries(V).find(([kk, vv]) => kk !== key && vv.plate === plate);
    if (dup) err('f-plate', `Этот госномер уже у машины ${dup[1].name}`);
    const year = $('#f-year').value ? Number($('#f-year').value) : null;
    if (year != null && (year < 1990 || year > TODAY.getFullYear() + 1)) err('f-year', `Год от 1990 до ${TODAY.getFullYear() + 1}`);
    const amort = $('#f-amort').value ? Number($('#f-amort').value) : null;
    if (amort != null && amort < 0) err('f-amort', 'Не может быть отрицательной');
    const from = $('#f-from').value || null, to = $('#f-to').value || null;
    if (from && to && to < from) err('f-to', 'Дата вывода раньше даты ввода');
    if (!ok) return;
    const after = { plate: plate || null, make: $('#f-make').value, model: $('#f-model').value.trim() || null, year, amort, trailer: $('#f-trailer').value.trim().toUpperCase() || null,
      trailer_model: $('#f-tmodel').value.trim() || null, from, to, active: $('#f-active').checked };
    const before = isNew ? {} : V[key];
    const who = ROLES[ROLE], at = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    let changes = 0;
    for (const f of Object.keys(after)) {
      const b = f === 'active' ? isActive(key, before) : before[f] ?? null, a = after[f];
      if (String(b ?? '') !== String(a ?? '')) { changes++; const fmt = x => f === 'active' ? (x ? 'да' : 'нет') : f === 'amort' && x != null ? rub(x) : x; AUDIT.push({ at, who, car: displayKey(key), field: FIELDS[f], before: fmt(b), after: fmt(a) }); }
    }
    if (!changes) { close(); return; }
    if (isNew) AUDIT.push({ at, who, car: displayKey(key), field: 'Машина добавлена', before: null, after: plate || '' });
    VEDIT[key] = Object.assign(VEDIT[key] || {}, after);
    applyVehicleEdits(); saveFleet(); close();
    toast(isNew ? `Машина ${displayKey(key)} добавлена` : `${displayKey(key)}: сохранено`); render();
  };
}

/* ---------- Настройки ---------- */
PAGES.settings = () => {
  topbar('Настройки');
  $('#content').innerHTML = `<div class="g2">
    <div class="card panel"><div class="panel-h"><div><h2>Распределение общих расходов</h2><p>общехоз, сервис, трактор и амортизация без привязки к машине</p></div></div>
      <div style="display:grid;gap:8px">${[['days', 'По рабочим дням', 'по умолчанию'], ['equal', 'Поровну', ''], ['km', 'По пробегу', 'станет доступно, когда будет вноситься пробег']].map(([v, t, h]) => `<label style="display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--border);border-radius:10px;${v === 'km' ? 'opacity:.5' : ''}"><input type="radio" name="alloc" value="${v}" ${S.alloc === v ? 'checked' : ''} ${v === 'km' ? 'disabled' : ''}><span><b>${t}</b><br><span class="muted" style="font-size:12.5px">${h}</span></span></label>`).join('')}</div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Группы по году выпуска</h2><p>верхние границы трёх первых групп</p></div></div>
      <div class="form" style="grid-template-columns:repeat(3,1fr);margin-top:0">${S.groups.map((g, i) => `<label>Граница ${i + 1}<input type="number" data-g="${i}" value="${g}" min="2000" max="2030"></label>`).join('')}</div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Топливо</h2></div></div>
      <div class="form" style="margin-top:0"><label>Порог расхождения карта/ГЛОНАСС, %<input type="number" id="fp" value="${S.fuelPct}" min="1" max="100"></label><label>ГЛОНАСС: максимум литров в сутки<input type="number" id="gm" value="${S.glonassMax}"></label>
        <label>Расход: минимум, л/100 км<input type="number" id="lmin" value="${S.lMin}"></label><label>Расход: максимум, л/100 км<input type="number" id="lmax" value="${S.lMax}"></label></div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Пробег за месяц</h2></div></div>
      <div class="form" style="margin-top:0"><label>Минимум, км<input type="number" id="kmin" value="${S.kmMin}"></label><label>Максимум, км<input type="number" id="kmax" value="${S.kmMax}"></label></div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Ставки НДС</h2></div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${['22%', '10%', '7%', '5%', '0%', 'без НДС'].map(v => `<span class="chip">${v}</span>`).join('')}</div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Пользователи</h2></div></div><table><tbody>
      <tr><td>Владелец</td><td class="l muted">все разделы, закрытие месяца, откат загрузок</td></tr><tr><td>Руководитель</td><td class="l muted">дашборды, отчёты, печать, Excel</td></tr><tr><td>Бухгалтер</td><td class="l muted">только «Загрузка и ввод» за открытые месяцы</td></tr></tbody></table></div>
  </div><div style="margin-top:14px;display:flex;gap:8px"><button class="btn primary" id="save">Сохранить</button><button class="btn" id="reset">Сбросить</button></div>`;
  $('#save').onclick = () => {
    S.alloc = ($('input[name=alloc]:checked') || {}).value || 'days';
    S.groups = $$('[data-g]').map(i => Number(i.value)).sort((a, b) => a - b);
    S.fuelPct = Number($('#fp').value) || 10; S.glonassMax = Number($('#gm').value) || 1500; S.lMin = Number($('#lmin').value); S.lMax = Number($('#lmax').value);
    S.kmMin = Number($('#kmin').value); S.kmMax = Number($('#kmax').value);
    saveSettings(); toast('Настройки сохранены');
  };
  $('#reset').onclick = () => { S = Object.assign({}, DEFAULTS); saveSettings(); render(); toast('Настройки сброшены'); };
};

/* ---------- Excel (.xlsx: открывается в Excel, Numbers, Google Таблицах) ---------- */
const XSTYLE = { h: 1, n: 2, b: 3, t: 4, i: 5 };
const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const xesc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
function sheetXml(sh) {
  const rows = sh.rows.map((r, ri) => {
    const cells = r.map((c, ci) => {
      const [v, st] = Array.isArray(c) ? c : [c, null];
      const ref = colName(ci) + (ri + 1);
      const sAttr = st ? ` s="${XSTYLE[st]}"` : (typeof v === 'number' ? ' s="2"' : '');
      if (v == null || v === '') return st ? `<c r="${ref}"${sAttr}/>` : '';
      if (typeof v === 'number') return `<c r="${ref}"${sAttr}><v>${Math.round(v)}</v></c>`;
      return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const pane = sh.freeze ? '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>' : '';
  const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${(w / 6.5).toFixed(1)}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}
function workbook(sheets) {
  const names = sheets.map((s, i) => xesc(String(s.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Лист' + (i + 1)));
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0;[Red]\-#,##0"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B1F3A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF3CC"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFD6D9DF"/></left><right style="thin"><color rgb="FFD6D9DF"/></right><top style="thin"><color rgb="FFD6D9DF"/></top><bottom style="thin"><color rgb="FFD6D9DF"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  sheets.forEach((sh, i) => files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sh));
  return zipStore(files);
}
/* ZIP без сжатия: этого достаточно для xlsx, внешние библиотеки не нужны */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034b50), ...common]);
    parts.push(local, nb, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += local.length + nb.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0), n = Object.keys(files).length;
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(cdSize), ...u32(off), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function exportExcel() {
  const months = PROFIT_MONTHS;
  const head = ['Машина', 'Амортизация', ...months.map(y => cap(MONTHS[Number(y.slice(5)) - 1])), 'Итого за год', 'Раб. дней', 'Прибыль в раб. день'];
  const keys = Object.keys(D.profit).sort((a, b) => name(a).localeCompare(name(b), 'ru', { numeric: true }));
  const rows = keys.map(k => { const ps = months.map(y => profitRaw(y, k)); const tot = ps.reduce((s, x) => s + (x || 0), 0); const w = months.reduce((s, y) => s + (profitRaw(y, k) != null ? ((daysOf(y, k) || {}).worked || 0) : 0), 0);
    return [[name(k), 'b'], (V[k] || {}).amort ?? null, ...ps.map(x => x ?? null), [tot, 'b'], w, w ? tot / w : null]; });
  const sh = f => months.map(y => (D.shared[f] || [])[pIdx(y)] ?? null);
  const sum = arr => arr.reduce((s, x) => s + (x || 0), 0);
  const extra = [['трактор', 'tractor'], ['общехоз', 'gen'], ['сервис', 'service'], ['амортизация', 'amort'], ['Общий', 'total']].map(([n, f]) => [[n, 'b'], null, ...sh(f).map(v => v == null ? null : [v, f === 'total' ? 'b' : 'n']), [sum(sh(f)), 'b'], null, null]);
  const xlsx = workbook([{ name: '2026', freeze: true, widths: [70, 80, ...months.map(() => 78), 90, 60, 90], rows: [[['FiberTrack · прибыль по машинам, 2026 (до распределения общих расходов)', 't']], head.map(h => [h, 'h']), ...rows, [], ...extra] }]);
  download('FiberTrack_прибыль_2026.xlsx', xlsx);
  toast('Файл Excel сформирован');
}
function downloadTemplate(ym, keys) {
  const head = ['Машина', 'Госномер', 'Пробег, км', 'Выручка от перевозок', 'Прочий доход', 'Топливо', 'Ремонт и запчасти', 'ТО', 'Шины', 'Зарплата водителей', 'Суточные', 'Платные дороги и «Платон»', 'Страхование', 'Лизинг / кредит', 'Мойка', 'Штрафы', 'Прочее', 'Ставка НДС', 'Суммы с НДС (да/нет)', 'Документ'];
  const rows = keys.sort((a, b) => name(a).localeCompare(name(b), 'ru', { numeric: true })).map(k => [[name(k), 'b'], (V[k] || {}).plate || '', ...head.slice(2, 17).map(() => ['', 'i']), '22%', 'да', '']);
  const xlsx = workbook([{ name: ymLabel(ym), freeze: true, widths: [70, 90, ...head.slice(2).map(() => 90)], rows: [[[`FiberTrack · шаблон ввода · ${ymLabel(ym)} · заполните жёлтые ячейки, суммы в рублях`, 't']], head.map(h => [h, 'h']), ...rows,
    [], [['Общие расходы (без машины)', 'b']], ...['Общехоз', 'Сервис', 'Трактор'].map(n => [[n, 'b'], '', ...head.slice(2, 17).map(() => ['', 'i']), '22%', 'да', ''])] }]);
  download(`FiberTrack_шаблон_${ym}.xlsx`, xlsx);
  toast('Шаблон скачан');
}

/* ---------- рендер ---------- */
function render() {
  charts.splice(0).forEach(c => c.dispose());
  hideTip();
  document.onkeydown = null;
  let { page, arg } = parseHash();
  if (!PAGES[page]) page = ROLE === 'input' ? 'input' : 'dashboard';
  if (!allowed(page)) {
    renderNav(page); topbar('Нет доступа');
    $('#content').innerHTML = empty('Этот раздел вам недоступен', ROLE === 'input' ? 'Бухгалтеру доступны справочник машин, загрузка и ввод, очередь «Проверить». Прибыль и отчёты смотрят владелец и руководитель.' : 'Раздел доступен только владельцу.', 'review') + `<p style="text-align:center"><a class="btn" href="#/${ROLE === 'input' ? 'input' : 'dashboard'}">Перейти в доступный раздел</a></p>`;
    return;
  }
  renderNav(page);
  $('#side').classList.remove('open');
  $('#content').innerHTML = `<div class="kpis">${'<div class="card kpi"><div class="sk" style="height:12px;width:60%"></div><div class="sk" style="height:24px;width:80%;margin-top:14px"></div></div>'.repeat(6)}</div>`;
  PAGES[page](arg);
  window.scrollTo({ top: 0 });
}
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => charts.forEach(c => c.resize()), 120); });
addEventListener('hashchange', render);
$('#roleSel').onchange = e => { ROLE = e.target.value; try { localStorage.setItem('ft-role', ROLE); } catch (x) {} render(); };
try { const t = localStorage.getItem('ft-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
const q = new URLSearchParams(location.search);
if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
if (q.get('role')) ROLE = q.get('role');
render();
})();
