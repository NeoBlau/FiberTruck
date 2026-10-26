/* FiberTrack — интерфейс. Данные приходят с сервера (/api/bootstrap) уже с учётом роли пользователя:
   бухгалтеру сервер не отдаёт прибыль и итоги, поэтому скрытие в интерфейсе — не защита, а удобство. */
(function () {
'use strict';
const csrf = () => decodeURIComponent((document.cookie.match(/(?:^|; )ft_csrf=([^;]*)/) || [])[1] || '');
class ApiError extends Error {
  constructor(status, detail) { super(typeof detail === 'string' ? detail : 'Проверьте введённые данные'); this.status = status; this.detail = detail; }
}
async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf();
  let res;
  try { res = await fetch(path, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и повторите.'); }
  if (res.status === 401) { location.href = '/login'; throw new ApiError(401, 'Войдите в систему'); }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new ApiError(res.status, (data && data.detail) || 'Что-то пошло не так. Повторите попытку.');
  return data;
}
/* состояние интерфейса переживает перезагрузку данных после сохранения */
const UI = { LAST_UPLOAD: null, STATE: null, ALLOC_ON: true, CARS_UI: { q: '', make: 'all', loss: false, sort: 'p', dir: -1 }, HM: { mode: 'days', sort: 'ki' }, FLEET_UI: { q: '', show: 'active' } };
let app = null;
async function refresh() { const D = await api('/api/bootstrap'); app = createApp(D); app.render(); }

function createApp(D) {
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
const DEFAULTS = { alloc: 'days', groups: [2013, 2017, 2021], fuelPct: 10, glonassMax: 1500, kmMin: 0, kmMax: 30000, lMin: 20, lMax: 45 };
const S = Object.assign({}, DEFAULTS, D.settings || {});
const ROLE = D.me.role;
const INPUT = D.input || {};

/* ---------- модель данных ---------- */
const V = D.vehicles;
const displayKey = k => { const m = /^(\d+)([МДФ]?)$/.exec(k); return m ? m[1].padStart(3, '0') + (m[2] ? ' ' + m[2] : '') : k; };
const AUDIT = (D.audit || []).filter(a => a.entity === 'vehicle');
/* ошибки сервера по полям формы: { поле: текст } → подписи под полями */
function showErrors(e, prefix = '') {
  if (e.detail && typeof e.detail === 'object' && !Array.isArray(e.detail)) {
    let shown = false;
    for (const [f, t] of Object.entries(e.detail)) { const el = $('#' + prefix + f + '-e'); if (el) { el.textContent = t; shown = true; } }
    if (!shown) toast(Object.values(e.detail)[0]);
  } else toast(e.message);
}
const name = k => (V[k] && V[k].name) || k;
/* очередь «Проверить»: пункт «без госномера» исчезает, как только номер указан в справочнике */
const openReview = () => D.review.filter(r => !(r.kind === 'Машина без госномера' && Object.values(V).some(v => v.name === r.value && v.plate)));
const PROFIT_MONTHS = D.profit_months && D.profit_months.length ? D.profit_months : Array.from({ length: 12 }, (_, i) => `${D.generated.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`);
const pIdx = ym => PROFIT_MONTHS.indexOf(ym);
/* введённые доходы и расходы по статьям: g — с НДС, n — без НДС */
const INCOME_ARTS = ['revenue', 'other_income'];
const NET = () => UI.STATE && UI.STATE.vat === 'net';
const FIN = D.fin || {}, KM = D.km || {};
const hasFin = ym => !!(FIN[ym] && Object.keys(FIN[ym].cars).length);
const finCar = (ym, k) => FIN[ym] && FIN[ym].cars[k] ? FIN[ym].cars[k][NET() ? 'n' : 'g'] : null;
const sumArts = (o, pred) => o ? Object.entries(o).filter(([a]) => pred(a)).reduce((s, [, v]) => s + v, 0) : 0;
const carIncome = (ym, k) => sumArts(finCar(ym, k), a => INCOME_ARTS.includes(a));
const carExpense = (ym, k) => sumArts(finCar(ym, k), a => !INCOME_ARTS.includes(a));
const histProfit = (ym, k) => { if (finMonth(ym)) return null; const i = pIdx(ym); const a = D.profit[k]; return i < 0 || !a ? null : a[i]; };
const histMonth = ym => { if (finMonth(ym)) return false; const i = pIdx(ym); return i >= 0 && D.shared.gen && D.shared.gen[i] != null; };
const hasProfit = ym => histMonth(ym) || hasFin(ym);
const kmOf = (ym, k) => (KM[ym] || {})[k] ?? null;
/* отработанные дни: из шаблона бухгалтера, иначе по графику */
const workedOf = (ym, k) => ((D.wdays || {})[ym] || {})[k] ?? (daysOf(ym, k) || {}).worked;
const kmTotal = ym => Object.values(KM[ym] || {}).reduce((s, v) => s + (v || 0), 0);
const revenueOf = ym => hasFin(ym) ? Object.keys(FIN[ym].cars).reduce((s, k) => s + carIncome(ym, k), 0) : null;
/* месяц считается по шаблону, когда в нём есть хотя бы половина машин: тогда он главнее таблицы прибыли */
const finMonth = ym => hasFin(ym) && Object.keys(FIN[ym].cars).length * 2 >= monthCarCount(ym);
const monthCarCount = ym => SCHED[ym] ? SCHED[ym].rows.length : Object.keys(D.profit).length || Object.values(V).filter(v => v.active !== false && !v.history_only).length;
const ART_NAMES = { revenue: 'Выручка от перевозок', other_income: 'Прочий доход', fuel: 'Топливо', repair: 'Ремонт и запчасти', maintenance: 'ТО', tires: 'Шины', salary: 'Зарплата водителей', per_diem: 'Суточные', tolls: 'Дороги и «Платон»', insurance: 'Страхование', leasing: 'Лизинг / кредит', wash: 'Мойка', fines: 'Штрафы', other: 'Прочее' };
const REP_YEAR = () => ((UI.STATE && UI.STATE.ym) || D.generated).slice(0, 4);
const SCHED = Object.fromEntries(D.schedule.map(m => [m.ym, m]));
const PROFIT_YMS = PROFIT_MONTHS.filter(hasProfit);
const SCHED_YMS = D.schedule.map(m => m.ym);
const ALL_YMS = [...new Set([...SCHED_YMS, ...PROFIT_YMS])].sort();
/* месяц по умолчанию: последний, где прибыль из таблицы или введено хотя бы по половине машин */
const isComplete = ym => histMonth(ym) || finMonth(ym);
const LAST_PROFIT = [...PROFIT_YMS].reverse().find(isComplete) || PROFIT_YMS[PROFIT_YMS.length - 1];
/* месяцы для годовых графиков и «с начала года»: год выбранного месяца, только заполненные месяцы */
const YEAR_YMS = () => PROFIT_YMS.filter(y => isComplete(y) && y.startsWith(REP_YEAR()));
const CUR_YM_FALLBACK = () => D.generated.slice(0, 7);
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
  if (!m) {
    /* графика нет — считаем по «Отработано дней» из шаблона: остальные дни машины не в работе */
    const wd = (D.wdays || {})[ym]; if (!wd || !Object.keys(wd).length) return null;
    const n = Object.keys(wd).length, worked = Object.values(wd).reduce((a, b) => a + b, 0);
    return { ...z, worked, off: n * daysIn(ym) - worked, cars: n, cal: n * daysIn(ym), filled: daysIn(ym), basis: 'template' };
  }
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

/* прибыль машины: строка таблицы прибыли главнее; если её нет — доходы минус расходы из введённых статей */
const profitRaw = (ym, k) => { const h = histProfit(ym, k); if (h != null) return h; return finCar(ym, k) ? carIncome(ym, k) - carExpense(ym, k) : null; };
const carsWithProfit = ym => [...new Set([...Object.keys(D.profit), ...(FIN[ym] ? Object.keys(FIN[ym].cars) : [])])].filter(k => profitRaw(ym, k) != null);
const sumCars = ym => carsWithProfit(ym).reduce((s, k) => s + profitRaw(ym, k), 0);
/* общие расходы со знаком «минус»: из таблицы прибыли и из шаблона; амортизация без таблицы — сумма по машинам */
const sharedOf = (ym, f) => {
  const i = pIdx(ym);
  const h = D.shared[f] && i >= 0 && !finMonth(ym) ? D.shared[f][i] : null;
  if (h != null) return h;
  if (!hasFin(ym)) return 0;
  if (f === 'amort') return -carsWithProfit(ym).reduce((s, k) => s + ((V[k] && V[k].amort) || 0), 0);
  const sh = FIN[ym].shared[NET() ? 'n' : 'g'];
  return -((sh && sh['shared_' + f]) || 0);
};
const fleetTotal = ym => {
  const i = pIdx(ym);
  const h = D.shared.total && i >= 0 && !finMonth(ym) ? D.shared.total[i] : null;
  if (h != null) return h;
  return hasFin(ym) ? sumCars(ym) + ['tractor', 'gen', 'service', 'amort'].reduce((s, f) => s + sharedOf(ym, f), 0) : null;
};
/* себестоимость 1 км: все расходы машин + общие + амортизация, делённые на пробег */
const costPerKm = ym => {
  const km = kmTotal(ym); if (!km || !hasFin(ym)) return null;
  const exp = Object.keys(FIN[ym].cars).reduce((s, k) => s + carExpense(ym, k), 0) - ['tractor', 'gen', 'service', 'amort'].reduce((s, f) => s + sharedOf(ym, f), 0);
  return exp / km;
};

/* распределение общих расходов и амортизации на машины */
function allocation(ym) {
  const keys = carsWithProfit(ym);
  const am = k => (V[k] && V[k].amort) || 0;
  const carAm = keys.reduce((s, k) => s + am(k), 0);
  const residual = sharedOf(ym, 'amort') + carAm;          // разница между строкой «амортизация» и суммой по машинам
  const pool = sharedOf(ym, 'tractor') + sharedOf(ym, 'gen') + sharedOf(ym, 'service') + residual;
  const w = Object.fromEntries(keys.map(k => [k, S.alloc === 'equal' ? 1 : S.alloc === 'km' ? (kmOf(ym, k) || 0) : (workedOf(ym, k) || 0)]));
  let W = keys.reduce((s, k) => s + w[k], 0);
  if (!W) { keys.forEach(k => w[k] = 1); W = keys.length; }
  const out = {};
  keys.forEach(k => out[k] = { raw: profitRaw(ym, k), amort: -am(k), share: pool * w[k] / W, alloc: profitRaw(ym, k) - am(k) + pool * w[k] / W });
  return { cars: out, pool, residual };
}
const carProfit = (ym, k) => { if (profitRaw(ym, k) == null) return null; return UI.ALLOC_ON ? allocation(ym).cars[k].alloc : profitRaw(ym, k); };
const fleetProfit = ym => hasProfit(ym) ? (UI.ALLOC_ON ? fleetTotal(ym) : sumCars(ym)) : null;
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
  const fromFin = hasFin(ym) && !histMonth(ym);
  const art = (pred) => -Object.keys(FIN[ym] ? FIN[ym].cars : {}).reduce((s, k) => s + sumArts(finCar(ym, k), pred), 0);
  const GROUPS = { fuel: ['fuel'], repair: ['repair', 'maintenance', 'tires'], salary: ['salary', 'per_diem'] };
  const used = Object.values(GROUPS).flat().concat(INCOME_ARTS);
  const steps = fromFin ? [['Выручка', revenueOf(ym), 'total'], ['Топливо', art(a => GROUPS.fuel.includes(a))], ['Ремонт, ТО, шины', art(a => GROUPS.repair.includes(a))],
    ['Зарплата', art(a => GROUPS.salary.includes(a))], ['Прочие', art(a => !used.includes(a))], ['Общие', sharedOf(ym, 'tractor') + sharedOf(ym, 'gen') + sharedOf(ym, 'service')],
    ['Амортизация', sharedOf(ym, 'amort')], ['Прибыль парка', fleetTotal(ym), 'total']] : [['Прибыль машин', sumCars(ym), 'total'], ['Трактор', sharedOf(ym, 'tractor')], ['Общехоз', sharedOf(ym, 'gen')],
    ['Сервис', sharedOf(ym, 'service')], ['Амортизация', sharedOf(ym, 'amort')], ['Прибыль парка', fleetTotal(ym), 'total']];
  let run = 0; const base = [], val = [], colors = [], labels = [];
  steps.forEach(([n, v, t]) => {
    if (t) { base.push(Math.min(0, v)); val.push(Math.abs(v)); colors.push(v < 0 ? css('--s-down') : css('--s-total')); run = v; }
    else { const nr = run + v; base.push(Math.min(run, nr)); val.push(Math.abs(v)); colors.push(v >= 0 ? css('--s-up') : css('--s-down')); run = nr; }
    labels.push(t ? short(v) : (v >= 0 ? '+' : '') + short(v));
  });
  const narrow = narrowForce ?? (el.clientWidth < 560 || steps.length > 7);
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
  const total = f.worked + f.no_driver + f.idle + f.planned + f.unplanned + (f.off || 0);
  const items = f.basis === 'template' ? [['В работе', f.worked, '--st-T'], ['Не в работе', f.off, '--st-O']] : [['Рейс', f.worked, '--st-T'], ['Нет водителя', f.no_driver, '--st-D'], ['Нет заявки / простой', f.idle, '--st-I'], ['ТО (план)', f.planned, '--st-W'], ['Ремонт (неплан)', f.unplanned, '--st-R']];
  return `<div class="daysbar">${items.filter(i => i[1]).map(([n, v, c]) => `<span title="${n}: ${v} дн. (${pct(v/total*100)})" style="flex:${v};background:var(${c})"></span>`).join('')}</div>
    <div class="legend">${items.map(([n, v, c]) => `<span><i style="background:var(${c})"></i>${n}<b>${v}</b></span>`).join('')}</div>`;
}

/* ---------- маршрутизация ---------- */
/* выбранный месяц переживает перезагрузку страницы (у каждого пользователя в своём браузере) */
const savedYm = (() => { try { const v = localStorage.getItem('ft-ym'); return v && (PROFIT_YMS.includes(v) || SCHED_YMS.includes(v) || D.periods[v]) ? v : null; } catch (e) { return null; } })();
if (!UI.STATE) UI.STATE = { ym: savedYm || LAST_PROFIT || CUR_YM_FALLBACK(), vat: 'asis' };
const STATE = UI.STATE;
function parseHash() { const h = location.hash.replace(/^#\/?/, ''); const [path, q] = h.split('?'); const parts = (path || 'dashboard').split('/'); return { page: parts[0], arg: parts[1] ? decodeURIComponent(parts[1]) : null, q: new URLSearchParams(q || '') }; }
const allowed = page => { const n = NAV.find(x => x[0] === page); return n && n[3] ? n[3].includes(ROLE) : page === 'car' ? ROLE !== 'input' : false; };
function go(h) { location.hash = '#/' + h; }

function renderNav(page) {
  const badge = openReview().filter(r => r.kind !== 'Сумма дней ≠ дней в месяце').length;
  $('#nav').innerHTML = NAV.map(n => n[0] === '-' ? `<div class="nav-label">${n[1]}</div>` :
    n[3].includes(ROLE) ? `<a href="#/${n[0]}" class="${page === n[0] || (page === 'car' && n[0] === 'cars') ? 'on' : ''}">${ico(n[2])}${n[1]}${n[0] === 'review' ? `<span class="badge">${badge}</span>` : ''}</a>` : '').join('');
  $('#userName').textContent = D.me.name;
  $('#userRole').textContent = ROLES[ROLE];
  $('#roleHint').textContent = ROLE === 'input' ? 'Ведёт парк: справочник машин, загрузки и ввод за открытые месяцы. Прибыль и итоги ему недоступны.' : ROLE === 'viewer' ? 'Смотрит всё, ничего не меняет.' : 'Полный доступ.';
}
function topbar(title, opts = {}) {
  const ym = STATE.ym;
  const monthCtl = opts.month ? `<div class="month"><button class="btn" data-mo="-1" aria-label="Предыдущий месяц" ${ALL_YMS.indexOf(ym) <= 0 ? 'disabled' : ''}>${ico('prev', 15)}</button><strong>${ymLabel(ym)}</strong><button class="btn" data-mo="1" aria-label="Следующий месяц" ${ALL_YMS.indexOf(ym) >= ALL_YMS.length - 1 ? 'disabled' : ''}>${ico('next', 15)}</button></div>` : '';
  const tb = opts.money ? `<div class="toolbar-row"><div class="seg" role="group" aria-label="НДС"><button data-vat="asis" class="${STATE.vat === 'asis' ? 'on' : ''}"><span class="l">Деньги (как есть)</span><span class="s">Как есть</span></button><button data-vat="net" class="${STATE.vat === 'net' ? 'on' : ''}">Без НДС</button></div>
    <div class="seg" role="group" aria-label="Общие расходы"><button data-alloc="1" class="${UI.ALLOC_ON ? 'on' : ''}"><span class="l">С распределением</span><span class="s">С общими</span></button><button data-alloc="0" class="${!UI.ALLOC_ON ? 'on' : ''}"><span class="l">Без распределения</span><span class="s">Без общих</span></button></div></div>` : '';
  $('#top').innerHTML = `<button class="btn iconbtn burger" id="burger" aria-label="Меню">${ico('menu')}</button><h1>${title}</h1>${monthCtl}<div class="spacer"></div>${tb}${opts.extra || ''}<button class="btn iconbtn" id="theme" aria-label="Сменить тему">${ico('moon')}</button>`;
  $$('[data-mo]').forEach(b => b.onclick = () => { const i = ALL_YMS.indexOf(STATE.ym) + Number(b.dataset.mo); if (ALL_YMS[i]) { STATE.ym = ALL_YMS[i]; render(); } });
  $$('[data-vat]').forEach(b => b.onclick = () => { STATE.vat = b.dataset.vat; render(); });
  $$('[data-alloc]').forEach(b => b.onclick = () => { UI.ALLOC_ON = b.dataset.alloc === '1'; render(); });
  $('#theme').onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('ft-theme', r.dataset.theme); } catch (e) {} render(); };
  $('#burger').onclick = () => $('#side').classList.toggle('open');
}
const vatNote = () => STATE.vat === 'net' ? `<div class="note warn">${ico('info')}<div>Без НДС считаются суммы, внесённые со ставками (шаблон и ручной ввод). В таблице прибыли по машинам НДС не выделен — её цифры показаны как есть.</div></div>` : '';

/* =========================================================
   ЭКРАНЫ
   ========================================================= */
const PAGES = {};

/* ---------- Дашборд ---------- */
PAGES.dashboard = () => {
  const ym = STATE.ym, prev = prevYm(ym);
  topbar('Дашборд месяца', { month: true, money: true, extra: `<a class="btn hide-m" href="#/report">${ico('pdf', 15)}PDF</a><button class="btn hide-m" id="xls">${ico('xls', 15)}Excel</button>` });
  const f = fleetDays(ym), fp = fleetDays(prev);
  const kNow = ki(ym), kPrev = ki(prev);
  const P = fleetProfit(ym), PP = fleetProfit(prev);
  const loss = hasProfit(ym) ? carsWithProfit(ym).filter(k => carProfit(ym, k) < 0).length : null;
  const lossP = hasProfit(prev) ? carsWithProfit(prev).filter(k => carProfit(prev, k) < 0).length : null;
  const partial = f && f.basis === 'calc';
  const head = [];
  if (hasFin(ym) && !histMonth(ym)) head.push(`<div class="note">${ico('info')}<div>Прибыль за ${MONTHS[Number(ym.slice(5)) - 1]} посчитана по введённым доходам и расходам${kmTotal(ym) ? ' и пробегу' : ''}: ${Object.keys(FIN[ym].cars).length} машин из ${monthCarCount(ym)}. ${carsWithProfit(ym).some(k => V[k] && V[k].amort) ? 'Амортизация — по справочнику машин.' : 'Амортизация в справочнике машин не заполнена — прибыль показана без неё. Впишите её в «Справочнике машин».'}</div></div>`);
  else if (!hasProfit(ym)) head.push(`<div class="note">${ico('info')}<div><b>Прибыль за ${MONTHS[Number(ym.slice(5)) - 1]} ещё не внесена.</b> ${f ? `Показаны только дни из графика${partial ? `, посчитанные по ячейкам${f.filled < daysIn(ym) ? ` (заполнено по ${f.filled}-е число)` : ''}: ручных итогов диспетчера за этот месяц нет` : ''}.` : ''}${LAST_PROFIT && LAST_PROFIT !== ym ? ` <button class="btn" data-goym="${LAST_PROFIT}" style="margin-top:8px">Показать ${MONTHS[Number(LAST_PROFIT.slice(5)) - 1]} ${LAST_PROFIT.slice(0, 4)}</button>` : ''}</div></div>`);
  else head.push(`<div class="note">${ico('info')}<div>Прибыль — из таблицы «Прибыль по машинам», дни — ${SCHED[ym] && SCHED[ym].manual ? 'ручные итоги диспетчера' : 'по ячейкам графика'}.${hasFin(ym) ? '' : ' Выручка, статьи расходов и пробег появятся после ввода бухгалтером.'}</div></div>`);
  const REV = revenueOf(ym), REVP = revenueOf(prev), KMT = kmTotal(ym), CPK = costPerKm(ym), CPKP = costPerKm(prev);
  const kp = [
    REV != null ? { l: 'Выручка', v: rub(REV), d: deltaChip(REV, REVP) + (REVP != null ? ` к ${MONTHS_DAT[Number(prev.slice(5)) - 1]}: ${rub(REVP)}` : ` ${Object.keys(FIN[ym].cars).length} машин`) }
      : { l: 'Выручка', e: `Нет данных за ${MONTHS[Number(ym.slice(5)) - 1]}`, h: ROLE === 'admin' ? '<a href="#/input">Внести по шаблону →</a>' : 'вносит бухгалтер' },
    P == null ? { l: UI.ALLOC_ON ? 'Прибыль парка' : 'Прибыль машин', e: 'Не внесена', h: 'таблица прибыли' } :
      { l: UI.ALLOC_ON ? 'Прибыль парка' : 'Прибыль машин', v: rub(P), neg: P < 0, d: deltaChip(P, PP) + (PP != null ? ` к ${MONTHS_DAT[Number(prev.slice(5)) - 1]}: ${rub(PP)}` : '') },
    REV && P != null ? { l: 'Маржа', v: pct(P / REV * 100), neg: P < 0, d: 'прибыль ÷ выручка' } : { l: 'Маржа', e: 'Посчитается после ввода выручки', h: 'прибыль ÷ выручка' },
    CPK != null ? { l: 'Себестоимость 1 км', v: dec(CPK, 1) + '<span class="u">₽/км</span>', d: deltaChip(-CPK, CPKP != null ? -CPKP : null) + ` доход ${dec(REV / KMT, 1)} ₽/км · ${int(KMT)} км` }
      : KMT ? { l: 'Руб/км', e: 'Пробег внесён, расходов ещё нет', h: `${int(KMT)} км` }
      : { l: 'Руб/км', e: 'Пробег не внесён', h: ROLE === 'admin' ? '<a href="#/input">Внести пробег →</a>' : 'вносит бухгалтер' },
    kNow == null ? { l: 'КИ парка', e: 'Нет графика', h: '' } : { l: 'КИ парка', v: pct(kNow), d: deltaChip(kNow, kPrev, 'pp') + ` ${f.worked} из ${f.cal} маш.-дн.` },
    loss == null ? { l: 'Машин в убытке', e: 'Нет прибыли за месяц', h: '' } : { l: 'Машин в убытке', v: `${loss}<span class="u">из ${carsWithProfit(ym).length}</span>`, d: deltaChip(loss, lossP, 'count') + (lossP != null ? ` было ${lossP}` : '') },
  ];
  const kpis = kp.map(c => c.e ? `<article class="card kpi empty fade"><div class="lbl">${c.l}</div><div class="val">${c.e}</div><div class="delta">${c.h}</div></article>` :
    `<article class="card kpi fade"><div class="lbl">${c.l}</div><div class="val num ${c.neg ? 'neg-ink' : ''}">${c.v}</div><div class="delta num">${c.d}</div></article>`).join('');
  let ppd = null, byIncome = false;
  if (REV && f && f.worked) { ppd = REV / f.worked; byIncome = true; }
  else if (hasProfit(ym) && f && f.worked) ppd = sumCars(ym) / f.worked;
  const lossTxt = f && ppd ? (byIncome
      ? `Без водителя машины простояли <strong>${f.no_driver}</strong> машино-дней. При среднем доходе машины в рабочий день <strong>${rub(ppd)}</strong> это около <strong>${rub(-f.no_driver * ppd)}</strong> недополученной выручки.`
      : `Без водителя машины простояли <strong>${f.no_driver}</strong> машино-дней. При средней прибыли машины в рабочий день <strong>${rub(ppd)}</strong> это около <strong>${rub(-f.no_driver * ppd)}</strong> недополученной прибыли. Оценка грубая: когда появится выручка, потери будут считаться по доходу.`) :
    f ? `Без водителя: <strong>${f.no_driver}</strong> машино-дней, в ремонте: <strong>${f.unplanned}</strong>. Потери в рублях посчитаются, когда за месяц будет внесена прибыль.` : '';
  $('#content').innerHTML = `${vatNote()}${head.join('')}
    <section class="kpis">${kpis}</section>
    <section class="g21" style="margin-top:14px">
      <div class="card panel"><div class="panel-h"><div><h2>${hasFin(ym) && !histMonth(ym) ? 'От выручки к прибыли' : 'От прибыли машин к прибыли парка'}</h2><p>${ymLabel(ym)} · ${hasFin(ym) && !histMonth(ym) ? 'расходы по статьям, общие и амортизация' : 'общие расходы и амортизация'}</p></div></div>
        ${hasProfit(ym) ? '<div id="wf" class="chart" role="img" aria-label="Водопад прибыли"></div>' : empty('Нет данных о прибыли', 'Водопад появится, когда за месяц будет внесена прибыль по машинам и общие расходы.')}</div>
      <div class="card panel"><div class="panel-h"><div><h2>Куда ушли машино-дни</h2><p>${f ? `${ymLabel(ym)} · ${f.cal || f.worked + f.no_driver + f.idle + f.planned + f.unplanned} машино-дней${f.basis === 'template' ? ' · по «Отработано дней» из шаблона' : partial ? ' · по ячейкам графика' : ''}` : 'нет графика'}</p></div></div>
        ${f ? daysBlock(f) : empty('Нет графика', 'За этот месяц график работы не загружен.')}
        <div id="pyear" class="chart" style="height:180px" role="img" aria-label="Прибыль по месяцам"></div>
        ${lossTxt ? `<div class="callout">${lossTxt}</div>` : ''}</div>
    </section>
    <section class="g2" style="margin-top:14px">
      <div class="card panel"><div class="panel-h"><div><h2>Топ-5 машин</h2><p>по прибыли за месяц ${UI.ALLOC_ON ? 'с распределением общих' : 'до общих расходов'}</p></div></div><div id="top5"></div></div>
      <div class="card panel"><div class="panel-h"><div><h2>Анти-топ-5</h2><p>самые убыточные за месяц</p></div></div><div id="bot5"></div></div>
    </section>
    <div class="foot"><span>FiberTrack · Fiber Software</span><span>Данные на ${D.generated.split('-').reverse().join('.')}</span></div>`;
  if (hasProfit(ym)) waterfall($('#wf'), ym);
  const yms = YEAR_YMS();
  chart($('#pyear'), {
    title: { text: (UI.ALLOC_ON ? 'Прибыль парка' : 'Прибыль машин') + ', ' + REP_YEAR(), left: 0, top: 0, textStyle: { fontSize: 12.5, fontWeight: 500, color: css('--ink-2') } },
    grid: { left: 4, right: 10, top: 30, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: css('--border-strong') } }, formatter: ps => `<b>${ymLabel(yms[ps[0].dataIndex])}</b><br>${rub(ps[0].value)}` },
    xAxis: axisCat(yms.map(y => MSHORT[Number(y.slice(5)) - 1]), { boundaryGap: false, axisLabel: { color: css('--ink-3') } }),
    yAxis: axisVal(short, { splitNumber: 3 }),
    series: [{ type: 'line', data: yms.map(fleetProfit), symbol: 'circle', symbolSize: 7, showSymbol: true, lineStyle: { width: 2, color: css('--s-up') }, itemStyle: { color: css('--s-up'), borderColor: css('--surface'), borderWidth: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: css('--s-up') + '33' }, { offset: 1, color: css('--s-up') + '00' }]) } }]
  });
  if (hasProfit(ym)) {
    const rows = carsWithProfit(ym).map(k => ({ k, p: carProfit(ym, k), d: workedOf(ym, k), s: YEAR_YMS().map(y => carProfit(y, k)) })).sort((a, b) => b.p - a.p);
    const tbl = list => `<table><thead><tr><th>Машина</th><th>Прибыль</th><th class="col-m">Раб. дней</th><th>На раб. день</th><th>${REP_YEAR()}</th></tr></thead><tbody>${list.map((r, i) =>
      `<tr class="click" data-car="${r.k}"><td><span class="car"><span class="rank">${i + 1}</span>${name(r.k)}</span></td><td class="${r.p < 0 ? 'neg-ink' : ''}">${rub(r.p)}</td><td class="col-m">${r.d ?? '—'}</td><td class="${r.p < 0 ? 'neg-ink' : ''}">${r.d ? rub(r.p / r.d) : '<span class="muted" title="Нет рабочих дней">—</span>'}</td><td>${spark(r.s)}</td></tr>`).join('')}</tbody></table>`;
    $('#top5').innerHTML = tbl(rows.slice(0, 5));
    $('#bot5').innerHTML = tbl(rows.slice(-5).reverse());
  } else { $('#top5').innerHTML = empty('Нет прибыли за месяц', 'Рейтинг появится после внесения данных.'); $('#bot5').innerHTML = ''; }
  bindCarRows();
  $('#xls').onclick = exportExcel;
};

function bindCarRows() { $$('[data-car]').forEach(tr => tr.onclick = () => (ROLE === 'input' ? null : go('car/' + encodeURIComponent(tr.dataset.car)))); }

/* ---------- Машины ---------- */
const CARS_UI = UI.CARS_UI;
PAGES.cars = () => {
  const ym = STATE.ym;
  topbar('Машины', { month: true, money: true, extra: `<button class="btn hide-m" id="xls">${ico('xls', 15)}Excel</button>` });
  const keys = [...new Set([...(SCHED[ym] ? SCHED[ym].rows.map(r => r.k) : []), ...carsWithProfit(ym)])];
  const rows = keys.map(k => {
    const v = V[k] || {}, d = daysOf(ym, k);
    const p = carProfit(ym, k);
    const ytd = YEAR_YMS().filter(y => y <= ym).map(y => carProfit(y, k)).filter(x => x != null);
    const ytdW = YEAR_YMS().filter(y => y <= ym).reduce((s, y) => s + (profitRaw(y, k) != null ? ((daysOf(y, k) || {}).worked || 0) : 0), 0);
    const ytdP = ytd.reduce((a, b) => a + b, 0);
    return { k, n: v.name || k, plate: v.plate || '', model: v.model || '', make: v.make || '', year: v.year, p, w: d ? d.worked : null, ki: carKi(ym, k), nd: d ? d.no_driver : null, rep: d ? d.unplanned : null,
      ppd: p != null && d && d.worked ? p / d.worked : null, ytd: ytd.length ? ytdP : null, ytdPpd: ytdW ? ytdP / ytdW : null, s: YEAR_YMS().map(y => carProfit(y, k)) };
  });
  const makes = ['all', ...[...new Set(rows.map(r => r.make).filter(Boolean))].sort()];
  const cols = [['n', 'Машина', 'l'], ['year', 'Год'], ['p', 'Прибыль'], ['w', 'Раб. дней'], ['ppd', 'На раб. день'], ['ki', 'КИ'], ['nd', 'Без водит.', 'col-m'], ['rep', 'Ремонт, дн.', 'col-m'], ['ytdPpd', 'На раб. день, год', 'col-m'], ['s', 'Прибыль за год', 'nos']];
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
  const ytd = YEAR_YMS().map(y => carProfit(y, k));
  const ytdSum = ytd.reduce((s, x) => s + (x || 0), 0);
  const wYtd = YEAR_YMS().reduce((s, y) => s + ((daysOf(y, k) || {}).worked || 0), 0);
  const calYtd = YEAR_YMS().reduce((s, y) => s + (rowOf(y, k) ? daysIn(y) : 0), 0);
  const p = carProfit(ym, k), d = daysOf(ym, k);
  const r = rowOf(ym, k);
  const fuel = Object.keys(D.fuel_month).sort().map(y => [y, (D.fuel_month[y] || {})[k]]).filter(x => x[1]);
  const passport = [['Госномер', v.plate || '<span class="neg-ink">нет в «АВТО»</span>'], ['Модель', v.model || '—'], ['Год выпуска', v.year || '—'], ['Тахограф', v.tacho || '—'],
    ['Прицеп', v.trailer ? `${esc(v.trailer)} · ${esc(v.trailer_model || '')}${v.trailer_year ? ', ' + v.trailer_year : ''}` : '—'], ['Пробег по одометру', v.odo ? int(v.odo) + NB + 'км' + (v.odo > 5e6 ? ' <span class="chip warn">похоже на опечатку</span>' : '') : '—'],
    ['Амортизация в месяц', v.amort ? rub(v.amort) : '—']];
  $('#content').innerHTML = `${vatNote()}
    <section class="kpis k5">
      <article class="card kpi fade"><div class="lbl">Прибыль, ${ymLabel(ym).toLowerCase()}</div><div class="val ${p < 0 ? 'neg-ink' : ''}">${rub(p)}</div><div class="delta">${deltaChip(p, carProfit(prevYm(ym), k))} ${UI.ALLOC_ON ? 'с общими' : 'до общих'}</div></article>
      <article class="card kpi fade"><div class="lbl">Прибыль с начала ${REP_YEAR()}</div><div class="val ${ytdSum < 0 ? 'neg-ink' : ''}">${rub(ytdSum)}</div><div class="delta">${YEAR_YMS().length} мес.</div></article>
      <article class="card kpi fade"><div class="lbl">Прибыль в рабочий день, ${REP_YEAR()}</div><div class="val ${ytdSum < 0 ? 'neg-ink' : ''}">${wYtd ? rub(ytdSum / wYtd) : '—'}</div><div class="delta">${wYtd} раб. дней</div></article>
      <article class="card kpi fade"><div class="lbl">КИ, ${ymLabel(ym).toLowerCase()}</div><div class="val">${pct(carKi(ym, k))}</div><div class="delta">${d ? `${d.worked} раб. из ${SCHED[ym].manual ? daysIn(ym) : filledDays(ym)}` : 'нет в графике'}</div></article>
      <article class="card kpi fade"><div class="lbl">КИ с начала ${REP_YEAR()}</div><div class="val">${calYtd ? pct(wYtd / calYtd * 100) : '—'}</div><div class="delta">${wYtd} из ${calYtd} дн.</div></article>
    </section>
    <section class="g21" style="margin-top:14px">
      <div class="card panel"><div class="panel-h"><div><h2>Прибыль по месяцам</h2><p>${REP_YEAR()} · ${UI.ALLOC_ON ? 'с распределением общих' : 'до общих расходов'}</p></div></div><div id="cp" class="chart" style="height:260px"></div></div>
      <div class="card panel"><div class="panel-h"><div><h2>Паспорт</h2><p>из листа «АВТО»</p></div></div>
        <table><tbody>${passport.map(([a, b]) => `<tr><td class="muted">${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="g21" style="margin-top:14px">
      <div class="card panel"><div class="panel-h"><div><h2>Календарь статусов</h2><p>${ymLabel(ym)}${r && r.tx ? ' · текст из графика' : ''}</p></div></div>${r ? calendar(ym, r) : empty('Нет в графике', 'В этом месяце машины нет в графике работы.')}
        ${d ? `<div style="margin-top:12px">${daysBlock(d)}</div><p class="muted" style="font-size:12px;margin:4px 0 0">${d.basis === 'manual' ? 'Итоги — ручные, из графика диспетчера.' : 'Итоги посчитаны по ячейкам: ручных итогов за месяц нет.'}</p>` : ''}</div>
      <div class="stack">
        <div class="card panel"><div class="panel-h"><div><h2>Структура расходов</h2><p>${ymLabel(ym)}${finCar(ym, k) ? ` · доходы ${rub(carIncome(ym, k))}${kmOf(ym, k) ? ` · ${int(kmOf(ym, k))} км · расход ${dec(carExpense(ym, k) / kmOf(ym, k), 1)} ₽/км` : ''}` : ''}</p></div></div>
          ${finCar(ym, k) && carExpense(ym, k) ? '<div id="cx" class="chart" style="height:220px"></div>' : empty('Статьи расходов не внесены', 'Топливо, ремонт, зарплата и другие статьи появятся, когда бухгалтер внесёт их за месяц — по шаблону или вручную.')}</div>
        <div class="card panel"><div class="panel-h"><div><h2>Топливо</h2><p>литры по топливной карте и ГЛОНАСС</p></div></div>${fuel.length ? '<div id="cf" class="chart" style="height:200px"></div>' : empty('Нет данных о заправках', 'По этой машине в «Анализе заправок» нет записей.', 'fuel')}</div>
      </div>
    </section>`;
  if ($('#cx')) {
    const items = Object.entries(finCar(ym, k)).filter(([a, v]) => !INCOME_ARTS.includes(a) && v).sort((a, b) => b[1] - a[1]);
    const tot = items.reduce((t, [, v]) => t + v, 0);
    chart($('#cx'), {
      grid: { left: 4, right: 64, top: 4, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,.06)' } }, formatter: ps => `<b>${ART_NAMES[items[ps[0].dataIndex][0]] || items[ps[0].dataIndex][0]}</b><br>${rub(ps[0].value)} · ${pct(ps[0].value / tot * 100)}` },
      yAxis: axisCat(items.map(([a]) => ART_NAMES[a] || a), { inverse: true }), xAxis: axisVal(short, { axisLabel: { show: false } }),
      series: [{ type: 'bar', barWidth: 12, data: items.map(([, v]) => v), itemStyle: { color: css('--s-2'), borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: css('--ink-2'), fontSize: 11.5, formatter: p => pct(p.value / tot * 100, 0) } }]
    });
  }
  chart($('#cp'), {
    grid: { left: 4, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,.06)' } }, formatter: ps => `<b>${ymLabel(YEAR_YMS()[ps[0].dataIndex])}</b><br>${rub(ps[0].value)}<br><span style="color:${css('--ink-3')}">${(daysOf(YEAR_YMS()[ps[0].dataIndex], k) || {}).worked ?? '—'} раб. дней</span>` },
    xAxis: axisCat(YEAR_YMS().map(y => MSHORT[Number(y.slice(5)) - 1])), yAxis: axisVal(),
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
const HM = UI.HM;
PAGES.heatmap = () => {
  const ym = STATE.ym;
  topbar('Тепловая карта парка', { month: HM.mode === 'days', extra: `<div class="seg"><button data-hm="days" class="${HM.mode === 'days' ? 'on' : ''}">Дни месяца</button><button data-hm="months" class="${HM.mode === 'months' ? 'on' : ''}">Месяцы</button></div>` });
  $$('[data-hm]').forEach(b => b.onclick = () => { HM.mode = b.dataset.hm; render(); });
  const legend = Object.entries(ST).filter(([c]) => c !== 't').map(([c, [n, v]]) => `<span><i style="background:${v ? `var(${v})` : 'transparent'};box-shadow:inset 0 0 0 1px var(--border-strong)"></i>${n}</span>`).join('');
  if (HM.mode === 'days') {
    const m = SCHED[ym];
    if (!m && !SCHED_YMS.length) { $('#content').innerHTML = empty('Графика пока нет', 'Тепловая карта строится по графику работы машин. Загрузите файл парка на экране «Загрузка и ввод».', 'heat'); return; }
    if (!m) { $('#content').innerHTML = empty('Графика нет', `За ${ymLabel(ym).toLowerCase()} график работы не загружен. Он есть с ${ymLabel(SCHED_YMS[0]).toLowerCase()} по ${ymLabel(SCHED_YMS[SCHED_YMS.length - 1]).toLowerCase()}.`, 'heat'); return; }
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
  const yms = YEAR_YMS();
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
    <div class="note">${ico('info')}<div><b>Вывод.</b> ${concl} ${small.length ? `<br><span class="muted">В группах ${small.map(g => `«${g.g}» (${g.n} маш.)`).join(', ')} мало машин — по ним вывод ненадёжен.</span>` : ''}<br><span class="muted">Руб/км и л/100 км появятся, когда будет вноситься пробег. Сейчас сравнение идёт по прибыли в рабочий день и дням в ремонте, ${YEAR_YMS().length ? ymLabel(YEAR_YMS()[0]).toLowerCase() + ' — ' + ymLabel(LAST_PROFIT).toLowerCase() : 'нет данных'}.</span></div></div>
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
  if (!fyms.length) { topbar('Топливо'); $('#content').innerHTML = empty('Заправок пока нет', 'Здесь будут литры по картам и ГЛОНАСС. Загрузите файл парка на экране «Загрузка и ввод» — лист «Анализ ЗАПРАВОК».', 'fuel'); return; }
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
    <section class="kpis k4">
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
  if (!yms.length) { $('#content').innerHTML = empty('Данных пока нет', 'Динамика строится по графику работы и листу «Анализ простоев». Загрузите файл парка на экране «Загрузка и ввод».', 'dyn'); return; }
  const val = (ym, i) => hist[ym] ? hist[ym][i] : (() => { const f = fleetDays(ym); return f ? [f.worked, f.no_driver, f.idle, f.planned, f.unplanned][i] : null; })();
  const kis = yms.map(y => SCHED[y] ? ki(y) : null);
  $('#content').innerHTML = `<div class="note">${ico('info')}<div>Итоги по парку — из листа «Анализ простоев» (с января 2021). Помашинный график есть с августа 2023, поэтому КИ считается с этого месяца. ${SCHED_YMS.filter(y => !SCHED[y].manual).length ? `Без ручных итогов диспетчера (${SCHED_YMS.filter(y => !SCHED[y].manual).map(y => ymLabel(y).toLowerCase()).join(', ')}) дни посчитаны по ячейкам графика.` : ''}</div></div>
    <div class="stack">
      <div class="card panel"><div class="panel-h"><div><h2>Машино-дни по статусам</h2><p>помесячно, ${ymLabel(yms[0]).toLowerCase()} — ${ymLabel(yms[yms.length - 1]).toLowerCase()}</p></div></div><div id="dd" class="chart" style="height:340px"></div></div>
      <div class="g2">
        <div class="card panel"><div class="panel-h"><div><h2>КИ парка</h2><p>рабочие дни ÷ календарные, с августа 2023</p></div></div><div id="dk" class="chart" style="height:260px"></div></div>
        <div class="card panel"><div class="panel-h"><div><h2>Прибыль парка</h2><p>после общих расходов и амортизации</p></div></div><div id="dp" class="chart" style="height:260px"></div></div>
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
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(127,127,127,.06)' } }, formatter: ps => `<b>${ymLabel(YEAR_YMS()[ps[0].dataIndex])}</b><br>${rub(ps[0].value)}` },
    xAxis: axisCat(YEAR_YMS().map(y => MSHORT[Number(y.slice(5)) - 1])), yAxis: axisVal(),
    series: [{ type: 'bar', barWidth: '52%', data: YEAR_YMS().map(y => { const v = fleetTotal(y); return { value: v, itemStyle: { color: v < 0 ? css('--s-down') : css('--s-up'), borderRadius: v < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] } }; }) }]
  });
};

/* ---------- Сверка ---------- */
PAGES.recon = () => {
  topbar('Сверка');
  const pr = PROFIT_YMS.filter(histMonth).map(y => { const calc = sumCars(y) + sharedOf(y, 'tractor') + sharedOf(y, 'gen') + sharedOf(y, 'service') + sharedOf(y, 'amort'); return { y, calc, ref: fleetTotal(y), diff: calc - fleetTotal(y) }; });
  const dd = Object.keys(D.idle_hist).filter(y => SCHED[y] && SCHED[y].manual).map(y => { const f = fleetDays(y); const h = D.idle_hist[y]; return { y, g: f.worked, h: h[0], diff: f.worked - h[0] }; });
  const ddBad = dd.filter(x => x.diff);
  const cell = [];
  for (const y of SCHED_YMS.filter(y => y.startsWith(REP_YEAR()))) for (const r of SCHED[y].rows) if (r.tot) { const dw = (r.calc.worked) - (r.tot.worked || 0); if (dw) cell.push({ y, k: r.k, man: r.tot.worked || 0, calc: r.calc.worked, diff: dw }); }
  const bench = D.bench;
  $('#content').innerHTML = `<div class="stack">
    <div class="card panel"><div class="panel-h"><div><h2>1. Прибыль: машины + общие = «Общий»</h2><p>пересчёт против итоговой строки таблицы прибыли</p></div><div class="spacer"></div>${pr.every(x => !x.diff) ? '<span class="chip pos">всё сходится</span>' : '<span class="chip neg">есть расхождения</span>'}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Месяц</th><th>Посчитано</th><th>В таблице</th><th>Разница</th></tr></thead><tbody>${pr.map(x => `<tr><td>${ymLabel(x.y)}</td><td>${rub(x.calc)}</td><td>${rub(x.ref)}</td><td class="${x.diff ? 'neg-ink' : 'ok'}">${x.diff ? rub(x.diff) : '✓ 0'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card panel"><div class="panel-h"><div><h2>2. Рабочие дни: график против «Анализа простоев»</h2><p>сумма ручных итогов по машинам против помесячной сводки</p></div><div class="spacer"></div><span class="chip ${ddBad.length ? 'warn' : 'pos'}">${ddBad.length ? `${ddBad.length} мес. расходятся` : 'всё сходится'} из ${dd.length}</span></div>
      ${ddBad.length ? `<table><thead><tr><th>Месяц</th><th>По графику</th><th>В «Анализе простоев»</th><th>Разница</th></tr></thead><tbody>${ddBad.map(x => `<tr><td>${ymLabel(x.y)}</td><td>${x.g}</td><td>${x.h}</td><td class="neg-ink">${int(x.diff)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
    <div class="card panel"><div class="panel-h"><div><h2>3. Ручные итоги против ячеек графика</h2><p>${REP_YEAR()}: где число рабочих дней диспетчера отличается от пересчёта по ячейкам. В расчётах используются ручные итоги.</p></div><div class="spacer"></div><span class="chip warn">${cell.length} строк</span></div>
      <div class="tbl-wrap" style="max-height:360px"><table><thead><tr><th>Месяц</th><th>Машина</th><th>Ручные итоги</th><th>По ячейкам</th><th>Разница</th></tr></thead><tbody>${cell.map(x => `<tr class="click" data-car="${x.k}" data-ym="${x.y}"><td>${ymLabel(x.y)}</td><td><span class="car">${name(x.k)}</span></td><td>${x.man}</td><td>${x.calc}</td><td class="neg-ink">${(x.diff > 0 ? '+' : '') + int(x.diff)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card panel"><div class="panel-h"><div><h2>4. Ваши заметки руб/км</h2><p>себестоимость и средняя стоимость 1 км из таблицы прибыли</p></div></div>
      <table><thead><tr><th>Месяц</th><th>Себестоимость, ₽/км</th><th>Стоимость км, ₽</th><th>Расчёт FiberTrack</th></tr></thead><tbody>${Object.entries(bench).sort((a, b) => a[0].localeCompare(b[0])).map(([m, b]) => { const c = costPerKm(m); const diff = c != null && b.cost ? (c - b.cost) / b.cost * 100 : null;
      return `<tr><td>${ymLabel(m)}</td><td>${dec(b.cost, 0)}${b.tax ? ' <span class="chip">налоговая</span>' : ''}</td><td>${dec(b.rate)}</td><td class="${diff != null && Math.abs(diff) > 5 ? 'neg-ink' : c != null ? 'ok' : 'muted'}">${c != null ? dec(c, 1) + ' ₽/км' + (diff != null ? ` (${diff > 0 ? '+' : ''}${dec(diff, 0)}%)` : '') : 'нет пробега — не с чем сравнить'}</td></tr>`; }).join('')}</tbody></table>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Заметок за июль и август в таблице нет. Месяц для заметки «на 1-е число» принят как предыдущий (на 1.02 — январь).</p></div>
    <div class="card panel"><div class="panel-h"><div><h2>5. Отчёт 1С</h2></div></div>${empty('Отчёт не загружен', 'Когда загрузите отчёт с выручкой и расходами (1С или любой другой) через «Загрузка и ввод», здесь появится сверка по строкам.', 'recon')}</div>
  </div>`;
  $$('tr[data-ym]').forEach(tr => tr.onclick = () => { STATE.ym = tr.dataset.ym; (ROLE === 'input' ? null : go('car/' + encodeURIComponent(tr.dataset.car))); });
};

/* ---------- Отчёт для руководителя (A4) ---------- */
PAGES.report = () => {
  if (!hasProfit(STATE.ym) && LAST_PROFIT) STATE.ym = LAST_PROFIT;
  if (!hasProfit(STATE.ym)) { topbar('Отчёт для руководителя'); $('#content').innerHTML = empty('Отчёт пока не из чего собрать', 'Отчёт появится, когда за месяц будут доходы и расходы: загрузите шаблон месяца на экране «Загрузка и ввод».', 'report'); return; }
  const ym = STATE.ym, prev = prevYm(ym);
  topbar('Отчёт для руководителя', { month: true, extra: `<button class="btn primary" id="print">${ico('pdf', 15)}Печать / PDF</button><button class="btn hide-m" id="xls">${ico('xls', 15)}Excel</button>` });
  const f = fleetDays(ym), P = fleetTotal(ym), PP = hasProfit(prev) ? fleetTotal(prev) : null;
  const rows = carsWithProfit(ym).map(k => ({ k, p: allocation(ym).cars[k].alloc, raw: profitRaw(ym, k), d: workedOf(ym, k) })).sort((a, b) => b.raw - a.raw);
  const loss = rows.filter(r => r.raw < 0).length;
  const t = list => `<table><thead><tr><th>Машина</th><th>Прибыль</th><th>Раб. дн.</th><th>На раб. день</th></tr></thead><tbody>${list.map(r => `<tr><td><b>${name(r.k)}</b></td><td class="${r.raw < 0 ? 'neg-ink' : ''}">${rub(r.raw)}</td><td>${r.d ?? '—'}</td><td class="${r.raw < 0 ? 'neg-ink' : ''}">${r.d ? rub(r.raw / r.d) : '—'}</td></tr>`).join('')}</tbody></table>`;
  const kNow = ki(ym), kPrev = ki(prev);
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
  chart($('#rp'), { grid: { left: 4, right: 8, top: 10, bottom: 4, containLabel: true }, xAxis: axisCat(YEAR_YMS().map(y => MSHORT[Number(y.slice(5)) - 1]), { axisLabel: { color: '#8590A2', fontSize: 10 } }), yAxis: axisVal(short, { splitNumber: 2, axisLabel: { color: '#8590A2', fontSize: 10, formatter: short } }),
    series: [{ type: 'bar', barWidth: '50%', data: YEAR_YMS().map(y => ({ value: fleetTotal(y), itemStyle: { color: y === ym ? '#0B1F3A' : (fleetTotal(y) < 0 ? '#E5484D' : '#9FB0C6'), borderRadius: 3 } })) }] });
  if (saved) root.dataset.theme = saved; else delete root.dataset.theme;
  $('#print').onclick = () => window.print();
  $('#xls').onclick = exportExcel;
};

/* ---------- Загрузка и ввод ---------- */
/* ---------- периоды: владелец открывает и закрывает месяцы ---------- */
const PERIODS = D.periods || {};
const CUR_YM = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`;
/* статусы хранит сервер; месяца нет в списке — он не начат */
const periodStatus = ym => PERIODS[ym] || 'future';
const PERIOD_YMS = () => { const out = []; let y = Object.keys(PERIODS).sort()[0] || CUR_YM; const last = nextYm(nextYm(nextYm(CUR_YM))); while (y <= last) { out.push(y); y = nextYm(y); } return out; };
const openMonths = () => PERIOD_YMS().filter(y => periodStatus(y) === 'open');
/* машины месяца: из графика, а для месяца без графика — все машины в работе */
const LAST_SCHED = SCHED_YMS[SCHED_YMS.length - 1];
/* машины месяца: из графика месяца, иначе из последнего графика; графиков нет — весь действующий парк */
const monthCars = ym => {
  const src = SCHED[ym] || SCHED[LAST_SCHED];
  const keys = src ? [...src.rows.map(r => r.k), ...Object.keys(V).filter(k => V[k].manual)] : Object.keys(V);
  return [...new Set(keys)].filter(k => V[k] && isActive(k, V[k]));
};
const ARTICLES = [['revenue', 'Выручка от перевозок'], ['other_income', 'Прочий доход'], ['fuel', 'Топливо'], ['repair', 'Ремонт и запчасти'],
  ['maintenance', 'ТО'], ['tires', 'Шины'], ['salary', 'Зарплата водителей'], ['per_diem', 'Суточные'], ['tolls', 'Платные дороги и «Платон»'],
  ['insurance', 'Страхование'], ['leasing', 'Лизинг / кредит'], ['wash', 'Мойка'], ['fines', 'Штрафы'], ['other', 'Прочее']];
const INCOME = ['revenue', 'other_income'];
const entryTotals = x => {
  const a = (x && x.amounts) || {};
  return { inc: INCOME.reduce((s, k) => s + (a[k] || 0), 0), exp: Object.entries(a).filter(([k]) => !INCOME.includes(k)).reduce((s, [, v]) => s + (v || 0), 0),
    hasRev: a.revenue != null, any: Object.keys(a).length > 0 || (x && (x.km != null || x.days != null)) };
};
const fmtDT = iso => { const d = new Date(iso); return d.toLocaleDateString('ru-RU') + ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
PAGES.input = () => {
  const OPEN = openMonths();
  if (!OPEN.length) { topbar('Загрузка и ввод'); $('#content').innerHTML = empty('Нет открытых месяцев', ROLE === 'admin' ? 'Откройте месяц на экране <a href="#/periods" style="color:var(--teal-ink)">«Месяцы»</a>.' : 'Все месяцы закрыты. Попросите владельца открыть нужный месяц.', 'upload') + uploadsCard(); loadUploads(); return; }
  let ym = OPEN.includes(STATE.ym) ? STATE.ym : OPEN[OPEN.length - 1];
  topbar('Загрузка и ввод', { extra: `<div class="seg">${OPEN.map(y => `<button data-iy="${y}" class="${y === ym ? 'on' : ''}">${ymLabel(y)}</button>`).join('')}</div>` });
  $$('[data-iy]').forEach(b => b.onclick = () => { STATE.ym = b.dataset.iy; render(); });
  const keys = monthCars(ym).sort((a, b) => name(a).localeCompare(name(b), 'ru', { numeric: true }));
  const inp = INPUT[ym] || {};
  const done = keys.filter(k => inp[k] && inp[k].km != null && entryTotals(inp[k]).hasRev).length;
  $('#content').innerHTML = `<div class="g21">
    <div class="stack">
      <div class="card panel"><div class="panel-h"><div><h2>Загрузить файл</h2><p>шаблон месяца в Excel: машины, пробег, дни, доходы, расходы и общие расходы</p></div></div>
        <label class="drop" id="drop"><input type="file" id="file" hidden accept=".xlsx,.xlsm"><span class="ico-circle">${ico('upload', 20)}</span><h3>Перетащите файл сюда</h3><p>или нажмите, чтобы выбрать · Excel .xlsx до 20 МБ</p></label>
        <div id="preview"></div></div>
      <div class="card panel"><div class="panel-h"><div><h2>Статус по машинам</h2><p>${ymLabel(ym)} · открыт для ввода${SCHED[ym] ? '' : ' · графика ещё нет, в списке все машины в работе'}</p></div><div class="spacer"></div><button class="btn" id="tpl">${ico('dl', 15)}Скачать шаблон на месяц</button></div>
        <div style="display:flex;align-items:center;gap:12px;margin:6px 0 14px"><div class="progress" style="flex:1"><span style="width:${keys.length ? done / keys.length * 100 : 0}%"></span></div><b class="num">Внесено ${done} из ${keys.length}</b></div>
        <div class="tbl-wrap" style="max-height:460px"><table><thead><tr><th>Машина</th><th>Пробег, км</th><th>Доходы</th><th class="col-m">Расходы</th><th class="l">Статус</th></tr></thead><tbody>
        ${keys.map(k => { const x = inp[k] || {}; const t = entryTotals(x);
          const st = x.km != null && t.hasRev ? ['внесено', 'var(--st-T)'] : t.any ? ['частично', 'var(--st-I)'] : ['не внесено', 'var(--border-strong)'];
          return `<tr class="click" data-row="${k}"><td><span class="car">${name(k)}</span> <span class="plate">${esc((V[k] || {}).plate || '')}</span></td><td>${x.km != null ? int(x.km) : '—'}</td><td>${t.inc ? rub(t.inc) : '—'}</td><td class="col-m">${t.exp ? rub(t.exp) : '—'}</td>
            <td class="l"><span class="status-dot" style="background:${st[1]}"></span>${st[0]}${x.source === 'template' ? ' <span class="chip" title="Из загруженного шаблона">шаблон</span>' : ''}<span class="muted" style="float:right">›</span></td></tr>`; }).join('')}
        </tbody></table></div></div>
    </div>
    <div class="stack">
      <div class="card panel"><div class="panel-h"><div><h2>Как это работает</h2></div></div>
        <ol style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.7">
          <li>Скачайте шаблон: в нём уже стоят все машины месяца.</li><li>Заполните жёлтые ячейки: пробег, отработанные дни, доходы и расходы по статьям, ставку НДС, внизу — общие расходы. Формулы в ячейках можно.</li>
          <li>Перетащите файл в окно слева. Программа покажет, что запишет, а ошибки подсветит красным с причиной.</li>
          <li>Нажмите «Применить». Исправили файл — загрузите снова: данные машин из файла заменятся, а не сложатся.</li></ol>
        <p class="muted" style="font-size:12.5px;margin:12px 0 0">Можно и без шаблона: нажмите на машину в списке и внесите данные вручную. Файл парка от диспетчера обновит график и заправки за открытые месяцы; закрытые месяцы не меняются.</p></div>
      <div class="card panel"><div class="panel-h"><div><h2>Проверки</h2></div></div>
        <ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.7"><li>Пробег больше ${int(S.kmMax)} км — предупреждение, данные всё равно пишутся</li><li>Отработано дней — от 0 до числа дней в месяце</li><li>Суммы — числа или формулы, не отрицательные</li><li>Указана ставка НДС; при «без НДС» суммы не могут быть «с НДС»</li><li>Машина есть в справочнике, в файле не повторяется</li><li>Месяц открыт для ввода</li></ul><p class="muted" style="font-size:12.5px;margin:10px 0 0">Внести вручную: нажмите на машину в списке «Статус по машинам».</p></div>
    </div></div>${uploadsCard()}`;
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => uploadFile(e.dataTransfer.files[0], ym));
  $('#file').onchange = e => { uploadFile(e.target.files[0], ym); e.target.value = ''; };
  $('#tpl').onclick = () => downloadTemplate(ym);
  $$('[data-row]').forEach(tr => tr.onclick = () => openEntry(ym, tr.dataset.row));
  if (UI.LAST_UPLOAD) showUpload(UI.LAST_UPLOAD);
  loadUploads();
};
const uploadsCard = () => `<div class="card panel" style="margin-top:14px"><div class="panel-h"><div><h2>История загрузок</h2><p>последние 50 · ${ROLE === 'admin' ? 'применённую загрузку можно откатить целиком' : 'откатить загрузку может владелец'}</p></div></div><div id="uploads"><div class="sk" style="height:40px"></div></div></div>`;
async function loadUploads() {
  const box = $('#uploads'); if (!box) return;
  let list;
  try { list = await api('/api/uploads'); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  /* файл загрузили, но «Применить» не нажали, а страницу перезагрузили — возвращаем предпросмотр */
  const pending = list.find(u => u.status === 'parsed' && u.uploaded_by === D.me.name);
  if (pending && !UI.LAST_UPLOAD && $('#preview') && !$('#preview').innerHTML.trim()) api(`/api/uploads/${pending.id}`).then(u => { if (!UI.LAST_UPLOAD) showUpload(u); }).catch(() => {});
  if (!list.length) { box.innerHTML = empty('Загрузок пока нет', 'Здесь появятся все загруженные файлы: кто, когда и что они изменили.', 'upload'); return; }
  const chip = s => ({ applied: 'pos', parsed: 'warn', rolled_back: '' })[s] ?? '';
  box.innerHTML = `<div class="tbl-wrap" style="max-height:420px"><table><thead><tr><th>№</th><th class="l">Файл</th><th class="l col-m">Что</th><th class="l col-m">Кто и когда</th><th class="l">Статус</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr><td>${u.id}</td><td class="l" style="white-space:normal;max-width:260px"><b>${esc(u.filename)}</b><div class="plate">${(u.result || []).map(esc).join('; ')}</div></td>
      <td class="l col-m">${esc(u.kind_name || '')}</td><td class="l col-m muted">${esc(u.uploaded_by || '')}<br>${fmtDT(u.uploaded_at)}</td>
      <td class="l"><span class="chip ${chip(u.status)}">${esc(u.status_name)}</span></td>
      <td><button class="btn" data-view="${u.id}">Открыть</button>${ROLE === 'admin' && u.status === 'applied' ? ` <button class="btn" data-rollback="${u.id}">Откатить</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-view]', box).forEach(b => b.onclick = async () => { try { showUpload(await api(`/api/uploads/${b.dataset.view}`), true); } catch (e) { toast(e.message); } });
  $$('[data-rollback]', box).forEach(b => b.onclick = async () => {
    if (!confirm(`Откатить загрузку №${b.dataset.rollback}? Данные вернутся к состоянию до неё.`)) return;
    b.disabled = true;
    try { await api(`/api/uploads/${b.dataset.rollback}/rollback`, { method: 'POST' }); UI.LAST_UPLOAD = null; toast('Загрузка откачена'); await refresh(); }
    catch (e) { b.disabled = false; alert(e.message); }
  });
}
async function uploadFile(file, ym) {
  if (!file) return;
  const box = $('#preview');
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) { box.innerHTML = `<div class="note warn fade">${ico('info')}<div><b>Нужен файл Excel .xlsx.</b> Если у вас .xls или .csv — откройте его в Excel и сохраните как .xlsx.</div></div>`; return; }
  if (file.size > 20 * 1024 * 1024) { box.innerHTML = `<div class="note warn fade">${ico('info')}<div><b>Файл больше 20 МБ.</b></div></div>`; return; }
  box.innerHTML = `<div class="callout fade" style="display:flex;gap:10px;align-items:center"><span class="spinner"></span>Разбираю «${esc(file.name)}»… обычно до 10 секунд</div>`;
  const fd = new FormData(); fd.append('file', file); fd.append('ym', ym);
  try {
    const res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf() } });
    if (res.status === 401) { location.href = '/login'; return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Не удалось разобрать файл');
    showUpload(data);
    loadUploads();
  } catch (e) {
    box.innerHTML = `<div class="note warn fade">${ico('info')}<div><b>Файл не загружен.</b> ${esc(e.message === 'Failed to fetch' ? 'Нет связи с сервером.' : e.message)}</div></div>`;
  }
}
function showUpload(u, scroll) {
  UI.LAST_UPLOAD = u;
  const box = $('#preview'); if (!box) return;
  const st = { ok: '', warn: 'r-warn', error: 'r-error', skip: 'r-skip' };
  const sec = s => {
    const visible = s.rows.filter(r => r.status !== 'skip'), skipped = s.rows.filter(r => r.status === 'skip');
    return `<div class="upl-s"><div class="upl-st"><h3>${esc(s.title)}</h3><span class="chips">${s.stats.apply ? `<span class="chip pos">${s.stats.apply} запишется</span>` : ''}${s.stats.errors ? `<span class="chip neg">${s.stats.errors} с ошибками</span>` : ''}${s.stats.skip ? `<span class="chip">${s.stats.skip} без изменений</span>` : ''}</span></div>
      ${s.notes.map(n => `<p class="upl-n">${esc(n)}</p>`).join('')}
      ${s.rows.length ? `<div class="tbl-wrap" style="max-height:320px"><table class="upl-t"><thead><tr>${s.columns.map((c, i) => `<th class="${i < 2 ? 'l' : ''}">${esc(c)}</th>`).join('')}<th class="l">Что будет</th></tr></thead><tbody>
        ${[...visible, ...skipped].map((r, i) => `<tr class="${st[r.status] || ''} ${r.status === 'skip' && visible.length && i >= visible.length ? 'upl-hide' : ''}">${r.cells.map((c, j) => `<td class="${j < 2 ? 'l' : ''}">${esc(c)}</td>`).join('')}<td class="l upl-note">${esc(r.note)}</td></tr>`).join('')}
      </tbody></table></div>${skipped.length && visible.length ? `<button class="btn upl-more" style="margin-top:8px">Показать без изменений (${skipped.length})</button>` : ''}` : ''}</div>`;
  };
  const errs = u.sections.reduce((n, s) => n + s.stats.errors, 0);
  box.innerHTML = `<div class="upl fade">
    <div class="upl-h"><div><b>${esc(u.kind_name || 'Файл')}</b> · ${esc(u.filename)}<div class="plate">загрузка №${u.id} · ${esc(u.status_name)}</div></div></div>
    ${u.duplicate_of ? `<div class="note warn" style="margin:10px 0 0">${ico('info')}<div>Этот же файл уже применялся (загрузка №${u.duplicate_of.id}, ${fmtDT(u.duplicate_of.at)}). Если применить снова — данные заменятся теми же значениями.</div></div>` : ''}
    ${u.sections.map(sec).join('')}
    ${u.status === 'parsed' ? `<div class="upl-a">${u.can_apply ? `<button class="btn primary" id="upApply">Применить${errs ? ' без строк с ошибками' : ''}</button>` : `<span class="muted">Применять нечего: всё совпадает или месяцы закрыты.</span>`}<button class="btn" id="upDiscard">${u.can_apply ? 'Отменить' : 'Закрыть'}</button></div>` : ''}
    ${u.status === 'applied' && u.result ? `<div class="callout" style="margin-top:12px"><b>Применено:</b> ${u.result.map(esc).join('; ')}</div>` : ''}
    ${u.status !== 'parsed' ? `<div class="upl-a"><button class="btn" id="upClose">Закрыть</button></div>` : ''}
  </div>`;
  $$('.upl-more', box).forEach(b => b.onclick = () => { b.closest('.upl-s').querySelectorAll('.upl-hide').forEach(tr => tr.classList.remove('upl-hide')); b.remove(); });
  const clear = () => { UI.LAST_UPLOAD = null; box.innerHTML = ''; };
  if ($('#upClose')) $('#upClose').onclick = clear;
  if ($('#upDiscard')) $('#upDiscard').onclick = async () => { try { await api(`/api/uploads/${u.id}/discard`, { method: 'POST' }); } catch (e) {} clear(); loadUploads(); };
  if ($('#upApply')) $('#upApply').onclick = async () => {
    $('#upApply').disabled = true; $('#upApply').textContent = 'Применяю…';
    try { const r = await api(`/api/uploads/${u.id}/apply`, { method: 'POST' }); UI.LAST_UPLOAD = r; toast('Применено');
      const ym = (r.months || []).filter(m => /^\d{4}-\d\d$/.test(m)).sort().pop(); if (ym) UI.STATE.ym = ym;   // дальше все вкладки показывают загруженный месяц
      await refresh(); }
    catch (e) { $('#upApply').disabled = false; $('#upApply').textContent = 'Применить'; alert(e.message); }
  };
  if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function openEntry(ym, k) {
  const x = (INPUT[ym] || {})[k] || {}, a = x.amounts || {};
  const nd = daysIn(ym);
  const f = (id, label, val, extra = '') => `<label>${label}<input type="number" step="any" inputmode="decimal" id="in-${id}" value="${val ?? ''}" ${extra}><span class="err" id="in-${id}-e"></span></label>`;
  $('#modal').innerHTML = `<div class="card modal fade" role="dialog" aria-modal="true" aria-labelledby="mt" style="width:min(680px,100%)"><h2 id="mt">${name(k)} · ${ymLabel(ym).toLowerCase()}</h2><p class="muted" style="margin:0">${esc((V[k] || {}).plate || '')} · суммы в рублях${x.source === 'template' ? ' · сейчас данные из шаблона — сохранение заменит их' : ''}</p>
    <div class="form">${f('km', 'Пробег, км', x.km, 'min="0" inputmode="numeric"')}${f('days', 'Отработано дней', x.days, `min="0" max="${nd}" inputmode="numeric"`)}
      <label>Ставка НДС<select class="inp" id="in-vat">${['22%', '10%', '7%', '5%', '0%', 'без НДС'].map(v => `<option ${(x.vat || '22%') === v ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="err" id="in-vat-e"></span></label>
      <label style="display:flex;gap:8px;align-items:center;flex-direction:row;margin-top:22px"><input type="checkbox" id="in-gross" ${x.gross !== false ? 'checked' : ''}> Суммы указаны с НДС</label>
      <div class="full upl-sub">Доходы</div>${ARTICLES.filter(([c]) => INCOME.includes(c)).map(([c, t]) => f(c, t, a[c])).join('')}
      <div class="full upl-sub">Расходы</div>${ARTICLES.filter(([c]) => !INCOME.includes(c)).map(([c, t]) => f(c, t, a[c])).join('')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;position:sticky;bottom:-22px;background:var(--surface);padding:12px 0"><button class="btn" id="mc">Отмена</button><button class="btn primary" id="ms">Сохранить</button></div></div>`;
  $('#modal').classList.add('open');
  $('#in-km').focus();
  const close = () => $('#modal').classList.remove('open');
  $('#mc').onclick = close; $('#modal').onclick = e => { if (e.target.id === 'modal') close(); };
  $('#ms').onclick = () => {
    const num = id => { const v = $('#in-' + id).value.trim().replace(',', '.'); return v === '' ? null : Number(v); };
    const amounts = {}; ARTICLES.forEach(([c]) => { const v = num(c); if (v != null) amounts[c] = v; });
    const data = { km: num('km'), days: num('days'), vat: $('#in-vat').value, gross: $('#in-gross').checked, amounts };
    let ok = true; $$('.err', $('#modal')).forEach(e => e.textContent = '');
    const err = (id, t) => { $('#in-' + id + '-e').textContent = t; ok = false; };
    if (data.km != null && (!Number.isInteger(data.km) || data.km < S.kmMin || data.km > S.kmMax)) err('km', `Пробег — целое число от ${int(S.kmMin)} до ${int(S.kmMax)} км`);
    if (data.days != null && (!Number.isInteger(data.days) || data.days < 0 || data.days > nd)) err('days', `В месяце ${nd} дней`);
    Object.entries(amounts).forEach(([c, v]) => { if (isNaN(v)) err(c, 'Введите число'); else if (v < 0) err(c, 'Сумма не может быть отрицательной'); });
    if (data.vat === 'без НДС' && data.gross && Object.values(amounts).some(v => v)) err('vat', 'Ставка «без НДС», а отмечено «с НДС» — снимите галочку');
    if (!ok) return;
    $('#ms').disabled = true;
    api(`/api/input/${ym}/${encodeURIComponent(k)}`, { method: 'PUT', body: data })
      .then(async () => { close(); toast(`${name(k)}: сохранено`); await refresh(); })
      .catch(e => { $('#ms').disabled = false; showErrors(e, 'in-'); });
  };
  document.onkeydown = e => { if (e.key === 'Escape') close(); };
}
async function downloadTemplate(ym) {
  try {
    const res = await fetch(`/api/template/${ym}`, { credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/login'; return; }
    if (!res.ok) throw new Error('Не удалось сформировать шаблон');
    download(`FiberTrack_шаблон_${ym}.xlsx`, await res.blob());
    toast('Шаблон скачан');
  } catch (e) { toast(e.message); }
}

/* ---------- Проверить ---------- */
PAGES.review = () => {
  topbar('Проверить');
  const groups = {};
  openReview().forEach(r => (groups[r.kind] = groups[r.kind] || []).push(r));
  const hint = { 'Машина без госномера': 'Укажите госномер в <a href="#/fleet" style="color:var(--teal-ink)">справочнике машин</a>: после этого пункт исчезнет, а номер будет сопоставляться автоматически.', 'Дубль машины в графике': 'В одном месяце машина записана дважды. Проверьте, какая строка верная.', 'Сумма дней ≠ дней в месяце': 'Итоги по статусам в строке не складываются в число дней месяца.' };
  $('#content').innerHTML = `<div class="note">${ico('info')}<div>Здесь всё, что программа не стала угадывать при импорте. Пока пункт не разобран, данные по нему не попадают в расчёты (кроме ручных итогов дней — они взяты как есть).</div></div>
    <div class="stack">${Object.entries(groups).map(([kind, list]) => `<div class="card panel"><div class="panel-h"><div><h2>${kind}</h2><p>${hint[kind] || ''}</p></div><div class="spacer"></div><span class="chip warn">${list.length}</span></div>
      <div class="tbl-wrap" style="max-height:320px"><table><thead><tr><th>Значение</th><th class="l">Где</th><th class="l">Что сделано</th><th></th></tr></thead><tbody>${list.map(r => `<tr><td><b>${esc(r.value)}</b></td><td class="l">${esc(r.where)}</td><td class="l muted">${esc(r.action)}</td><td><button class="btn" data-resolve="${r.id}">Разобрано</button></td></tr>`).join('')}</tbody></table></div></div>`).join('')}</div>`;
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
  $('#content').innerHTML = `<div class="note">${ico('info')}<div><b>Как это работает.</b> Бухгалтер вносит данные только в открытые месяцы. Закрытый месяц не меняется: цифры в отчётах фиксируются. Новый месяц можно открыть заранее — например, ноябрь, чтобы бухгалтер начал вносить первые документы. Текущий месяц открывается сам 1-го числа.</div></div>
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Месяц</th><th class="l">Статус</th><th class="l">Заполнение</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  const act = async (ym, action, body, msg) => { try { await api(`/api/periods/${ym}/${action}`, { method: 'POST', body }); toast(msg); await refresh(); } catch (e) { toast(e.message); } };
  $$('[data-open]').forEach(b => b.onclick = () => { const ym = b.dataset.open; act(ym, 'open', undefined, `${ymLabel(ym)} открыт для ввода`); });
  $$('[data-close]').forEach(b => b.onclick = () => {
    const ym = b.dataset.close, keys = monthCars(ym), inp = INPUT[ym] || {};
    const left = keys.filter(k => !(inp[k] && inp[k].km != null && inp[k].rev != null)).length;
    if (!confirm(`Закрыть ${ymLabel(ym).toLowerCase()}?${left ? `\n\nНе внесено по ${left} машинам из ${keys.length}.` : ''}\nПосле закрытия бухгалтер не сможет менять данные за этот месяц.`)) return;
    act(ym, 'close', undefined, `${ymLabel(ym)} закрыт`); });
  $$('[data-reopen]').forEach(b => b.onclick = () => {
    const ym = b.dataset.reopen; const why = prompt(`Причина переоткрытия: ${ymLabel(ym).toLowerCase()}`); if (!why || !why.trim()) return;
    act(ym, 'reopen', { reason: why.trim() }, `${ymLabel(ym)} снова открыт`); });
};

/* ---------- Справочник машин ---------- */
const PLATE_RE = /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/;
const LAT2CYR = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
const normPlate = s => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[ABEKMHOPCTYX]/g, c => LAT2CYR[c]);
const MAKES = ['FAW', 'MAN', 'DAF', 'SCANIA', 'MERCEDES', 'OTHER'];
const FIELDS = { plate: 'Госномер', make: 'Марка', model: 'Модель', year: 'Год выпуска', trailer: 'Прицеп', trailer_model: 'Модель прицепа', trailer_year: 'Год прицепа', amort: 'Амортизация в месяц', from: 'В парке с', to: 'Выведена', active: 'Активна' };
const FLEET_UI = UI.FLEET_UI;
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
      ${list.map(k => { const v = V[k]; const act = isActive(k, v); return `<tr class="${canEdit ? 'click' : ''}" data-fk="${esc(k)}"><td><span class="car">${esc(v.name)}</span>${v.edited ? ' <span class="chip" title="Изменено в программе">изм.</span>' : ''}</td>
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
  const isNew = !k, v = isNew ? { make: 'FAW', active: true } : V[k];
  const inp = (id, label, val, attrs = '') => `<label>${label}<input id="${id}" ${attrs} value="${esc(val ?? '')}"><span class="err" id="${id}-e"></span></label>`;
  $('#modal').innerHTML = `<div class="card modal fade" role="dialog" aria-modal="true" aria-labelledby="ct"><h2 id="ct">${isNew ? 'Новая машина' : 'Машина ' + esc(v.name)}</h2><p class="muted" style="margin:0">Изменения сразу видны во всех отчётах и попадают в журнал</p>
    <div class="form">
      ${inp('f-short', 'Короткий номер', isNew ? '' : v.name, `type="text" placeholder="например, 885 или 308 М" ${isNew ? '' : 'disabled'}`)}
      ${inp('f-plate', 'Госномер', v.plate, 'type="text" placeholder="Т970ОН58"')}
      <label>Марка<select class="inp" id="f-make"><option value="" ${v.make ? '' : 'selected'}>—</option>${MAKES.map(m => `<option ${v.make === m ? 'selected' : ''}>${m}</option>`).join('')}</select><span class="err" id="f-make-e"></span></label>
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
    const payload = { plate: plate || null, make: $('#f-make').value || null, model: $('#f-model').value.trim() || null, year, amort, trailer: $('#f-trailer').value.trim() || null,
      trailer_model: $('#f-tmodel').value.trim() || null, from, to, active: $('#f-active').checked };
    if (isNew) payload.short = $('#f-short').value;
    $('#ms').disabled = true;
    api(isNew ? '/api/vehicles' : `/api/vehicles/${encodeURIComponent(key)}`, { method: isNew ? 'POST' : 'PATCH', body: payload })
      .then(async () => { close(); toast(isNew ? `Машина ${displayKey(key)} добавлена` : `${displayKey(key)}: сохранено`); await refresh(); })
      .catch(e => { $('#ms').disabled = false; showErrors(e, 'f-'); });
  };
}

/* ---------- Настройки ---------- */
PAGES.settings = () => {
  topbar('Настройки');
  $('#content').innerHTML = `<div class="g2">
    <div class="card panel"><div class="panel-h"><div><h2>Распределение общих расходов</h2><p>общехоз, сервис, трактор и амортизация без привязки к машине</p></div></div>
      <div style="display:grid;gap:8px">${[['days', 'По рабочим дням', 'по умолчанию'], ['equal', 'Поровну', ''], ['km', 'По пробегу', 'по пробегу из шаблона; если пробега за месяц нет — поровну']].map(([v, t, h]) => `<label style="display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--border);border-radius:10px;"><input type="radio" name="alloc" value="${v}" ${S.alloc === v ? 'checked' : ''} ><span><b>${t}</b><br><span class="muted" style="font-size:12.5px">${h}</span></span></label>`).join('')}</div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Группы по году выпуска</h2><p>верхние границы трёх первых групп</p></div></div>
      <div class="form" style="grid-template-columns:repeat(3,1fr);margin-top:0">${S.groups.map((g, i) => `<label>Граница ${i + 1}<input type="number" data-g="${i}" value="${g}" min="2000" max="2030"></label>`).join('')}</div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Топливо</h2></div></div>
      <div class="form" style="margin-top:0"><label>Порог расхождения карта/ГЛОНАСС, %<input type="number" id="fp" value="${S.fuelPct}" min="1" max="100"></label><label>ГЛОНАСС: максимум литров в сутки<input type="number" id="gm" value="${S.glonassMax}"></label>
        <label>Расход: минимум, л/100 км<input type="number" id="lmin" value="${S.lMin}"></label><label>Расход: максимум, л/100 км<input type="number" id="lmax" value="${S.lMax}"></label></div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Пробег за месяц</h2></div></div>
      <div class="form" style="margin-top:0"><label>Минимум, км<input type="number" id="kmin" value="${S.kmMin}"></label><label>Максимум, км<input type="number" id="kmax" value="${S.kmMax}"></label></div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Ставки НДС</h2></div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${['22%', '10%', '7%', '5%', '0%', 'без НДС'].map(v => `<span class="chip">${v}</span>`).join('')}</div></div>
    <div class="card panel"><div class="panel-h"><div><h2>Пользователи</h2></div></div><table><tbody>
      <tr><td>Владелец</td><td class="l muted">все разделы, месяцы, настройки</td></tr><tr><td>Руководитель</td><td class="l muted">дашборды, отчёты, печать, Excel</td></tr><tr><td>Бухгалтер</td><td class="l muted">справочник машин, ввод за открытые месяцы, «Проверить»; прибыль и отчёты не видит</td></tr></tbody></table></div>
  </div><div style="margin-top:14px;display:flex;gap:8px"><button class="btn primary" id="save">Сохранить</button><button class="btn" id="reset">Сбросить</button></div>`;
  $('#save').onclick = () => {
    S.alloc = ($('input[name=alloc]:checked') || {}).value || 'days';
    S.groups = $$('[data-g]').map(i => Number(i.value)).sort((a, b) => a - b);
    S.fuelPct = Number($('#fp').value) || 10; S.glonassMax = Number($('#gm').value) || 1500; S.lMin = Number($('#lmin').value); S.lMax = Number($('#lmax').value);
    S.kmMin = Number($('#kmin').value); S.kmMax = Number($('#kmax').value);
    api('/api/settings', { method: 'PUT', body: S }).then(async () => { toast('Настройки сохранены'); await refresh(); }).catch(e => toast(e.message));
  };
  $('#reset').onclick = () => api('/api/settings', { method: 'PUT', body: DEFAULTS }).then(async () => { toast('Настройки сброшены'); await refresh(); }).catch(e => toast(e.message));
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
  const YEAR = REP_YEAR(), months = PROFIT_MONTHS.filter(y => y.startsWith(YEAR));
  const head = ['Машина', 'Амортизация', ...months.map(y => cap(MONTHS[Number(y.slice(5)) - 1])), 'Итого за год', 'Раб. дней', 'Прибыль в раб. день'];
  const keys = Object.keys(D.profit).sort((a, b) => name(a).localeCompare(name(b), 'ru', { numeric: true }));
  const rows = keys.map(k => { const ps = months.map(y => profitRaw(y, k)); const tot = ps.reduce((s, x) => s + (x || 0), 0); const w = months.reduce((s, y) => s + (profitRaw(y, k) != null ? ((daysOf(y, k) || {}).worked || 0) : 0), 0);
    return [[name(k), 'b'], (V[k] || {}).amort ?? null, ...ps.map(x => x ?? null), [tot, 'b'], w, w ? tot / w : null]; });
  const sh = f => months.map(y => (D.shared[f] || [])[pIdx(y)] ?? null);
  const sum = arr => arr.reduce((s, x) => s + (x || 0), 0);
  const extra = [['трактор', 'tractor'], ['общехоз', 'gen'], ['сервис', 'service'], ['амортизация', 'amort'], ['Общий', 'total']].map(([n, f]) => [[n, 'b'], null, ...sh(f).map(v => v == null ? null : [v, f === 'total' ? 'b' : 'n']), [sum(sh(f)), 'b'], null, null]);
  const xlsx = workbook([{ name: YEAR, freeze: true, widths: [70, 80, ...months.map(() => 78), 90, 60, 90], rows: [[[`FiberTrack · прибыль по машинам, ${YEAR} (до распределения общих расходов)`, 't']], head.map(h => [h, 'h']), ...rows, [], ...extra] }]);
  download(`FiberTrack_прибыль_${YEAR}.xlsx`, xlsx);
  toast('Файл Excel сформирован');
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
  try { localStorage.setItem('ft-ym', STATE.ym); } catch (e) {}
  window.scrollTo({ top: 0 });
}
return { render, resize: () => charts.forEach(c => c.resize()) };
}

let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => app && app.resize(), 120); });
addEventListener('hashchange', () => app && app.render());
document.addEventListener('click', async e => {
  const r = e.target.closest('[data-resolve]');
  if (r) { r.disabled = true; try { await api(`/api/review/${r.dataset.resolve}/resolve`, { method: 'POST' }); await refresh(); } catch (x) { r.disabled = false; alert(x.message); } }
  const g = e.target.closest('[data-goym]');
  if (g && UI.STATE) { UI.STATE.ym = g.dataset.goym; app.render(); }
  if (e.target.closest('#logout')) { try { await api('/api/auth/logout', { method: 'POST' }); } catch (x) {} location.href = '/login'; }
});
try { const t = localStorage.getItem('ft-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
refresh().catch(e => { if (e.status !== 401) document.getElementById('content').innerHTML = `<div class="empty-state"><h3>Не удалось загрузить данные</h3><p>${e.message}</p><p><button class="btn" onclick="location.reload()">Повторить</button></p></div>`; });
})();
