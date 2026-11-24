/* All-period aggregation. Missing measurements stay null; ratios use matched rows. */
(function (root) {
'use strict';
const known = v => typeof v === 'number' && Number.isFinite(v);
const sum = values => { const a = values.filter(known); return a.length ? a.reduce((s,v)=>s+v,0) : null; };
const previous = ym => { const [y,m]=ym.split('-').map(Number); return m===1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`; };
function capacity(ym, {from=null,to=null,filled=null}={}) {
  const [year,month]=ym.split('-').map(Number), days=new Date(Date.UTC(year,month,0)).getUTCDate();
  const observed=filled==null?days:Math.min(days,Math.max(0,filled));
  if(!observed) return 0;
  const first=ym+'-01', last=ym+'-'+String(observed).padStart(2,'0');
  const start=from&&from>first?from:first, end=to&&to<last?to:last;
  return end<start?0:Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
}
function aggregate(rows) {
  const fields=['income','expense','cost','profit','raw','overhead','amort','km','days','liters','noDriver','idle','planned','unplanned'];
  const out=Object.fromEntries(fields.map(f=>[f,sum(rows.map(r=>r[f]))]));
  const fuel=rows.filter(r=>known(r.liters)&&r.km>0), cost=rows.filter(r=>known(r.cost)&&known(r.km)&&r.km>=0);
  const worked=rows.filter(r=>known(r.days)&&r.capacity>0), profits=rows.filter(r=>known(r.profit));
  out.rate=fuel.length ? sum(fuel.map(r=>r.liters))/sum(fuel.map(r=>r.km))*100 : null;
  out.costKm=cost.length && sum(cost.map(r=>r.km))>0 ? sum(cost.map(r=>r.cost))/sum(cost.map(r=>r.km)) : null;
  out.utilization=worked.length ? sum(worked.map(r=>r.days))/sum(worked.map(r=>r.capacity))*100 : null;
  out.margin=profits.length && profits.every(r=>known(r.income)) && sum(profits.map(r=>r.income))>0 ? out.profit/sum(profits.map(r=>r.income))*100 : null;
  out.coverage={rows:rows.length,finance:profits.length,income:rows.filter(r=>known(r.income)).length,km:rows.filter(r=>known(r.km)).length,days:worked.length,liters:rows.filter(r=>known(r.liters)).length,matched:fuel.length,costMatched:cost.length};
  out.lossMonths=rows.filter(r=>known(r.profit)&&r.profit<0).length;
  out.articles={};
  for (const r of rows) for (const [a,v] of Object.entries(r.articles||{})) if (known(v)) out.articles[a]=(out.articles[a]||0)+v;
  return out;
}
function group(rows,field) {
  const groups=new Map();
  rows.forEach(r=>{ if (!groups.has(r[field])) groups.set(r[field],[]); groups.get(r[field]).push(r); });
  return [...groups].map(([key,rs])=>({key,...aggregate(rs),months:new Set(rs.map(r=>r.ym)).size}));
}
function recommendations(rows, allRows, limits) {
  const result=new Map(), prior=new Map(allRows.map(r=>[r.ym+'|'+r.k,r]));
  function add(r,code,priority,title,action,value=null) {
    const id=r.k+'|'+code;
    if (!result.has(id)) result.set(id,{k:r.k,code,priority,title,action,months:[],value:0});
    const rec=result.get(id); rec.months.push(r.ym); if(known(value)) rec.value+=value;
  }
  for(const r of rows) {
    if (known(r.profit)&&r.profit<0) add(r,'loss',1,'Убыточные месяцы','Сопоставьте тарифы, загрузку, ремонт и постоянные расходы по указанным месяцам.',-r.profit);
    if (known(r.profit)&&r.income>0&&r.profit/r.income*100<10&&r.profit>=0) add(r,'margin',2,'Маржа ниже 10%','Проверьте тарифы и структуру затрат; сравните с похожими рейсами.');
    const repair=sum(['repair','maintenance','tires'].map(a=>r.articles?.[a]));
    if (r.income>0&&repair/r.income>0.2) add(r,'repair',2,'Ремонт, ТО и шины выше 20% доходов','Разберите повторные ремонты и разовые покупки; проверьте план ТО.',repair);
    if (r.liters>0&&(!known(r.km)||r.km===0)) add(r,'fuelKm',0,'Литры есть, пробега нет','Уточните пробег за тот же месяц. Расход л/100 км пока не рассчитывается.');
    if (r.km>0&&(!known(r.liters)||r.liters===0)) add(r,'fuelLiters',0,'Пробег есть, литры отсутствуют или равны нулю','Проверьте топливный файл и полноту заправок за месяц.');
    const rate=known(r.liters)&&r.km>0 ? r.liters/r.km*100 : null;
    if (rate!=null&&rate>limits.lMax+1e-9) add(r,'highFuel',1,'Расход топлива выше порога','Проверьте литры, пробег, условия рейсов и техническое состояние. Объём выше порога не равен доказанному перерасходу.',r.liters-r.km*limits.lMax/100);
    if (rate!=null&&r.liters>0&&rate<limits.lMin-1e-9) add(r,'lowFuel',2,'Расход топлива ниже порога','Проверьте, все ли заправки и правильный ли пробег внесены.');
    const p=prior.get(previous(r.ym)+'|'+r.k), old=p&&p.km>0&&p.liters>0 ? p.liters/p.km*100 : null;
    if (p&&p.expense>0&&p.income>0&&known(r.expense)&&known(r.income)&&r.expense/p.expense>1.2&&r.expense/p.expense>r.income/p.income) add(r,'expenseGrowth',2,'Расходы растут быстрее доходов','Рост прямых затрат превысил 20% к предыдущему календарному месяцу. Проверьте статьи и разовые расходы.');
    if(rate!=null&&old>0&&(rate/old-1)*100>limits.fuelJumpPct+1e-9) add(r,'fuelJump',1,'Рост расхода к предыдущему месяцу','Сравните маршруты, нагрузку и внесённые данные с предыдущим календарным месяцем.');
    if (known(r.days)&&r.capacity>0&&r.days/r.capacity<0.5) add(r,'utilization',2,'Использование ниже 50%','Уточните причины дней без работы: ремонт, отсутствие водителя или заявок.');
    if (r.financial&&!known(r.income)) add(r,'income',0,'Не заполнены доходы','Уточните выручку. Прибыль по имеющимся затратам предварительная.');
    if(known(r.profit)&&!known(r.amort)) add(r,'amort',0,'Не заполнена амортизация','Укажите месячную сумму в справочнике машин, если она должна учитываться. Нулевая сумма считается заполненной.');
  }
  return [...result.values()].sort((a,b)=>a.priority-b.priority||b.value-a.value||a.k.localeCompare(b.k,'ru',{numeric:true}));
}
function analyze(allRows, filters={}, limits={lMin:20,lMax:45,fuelJumpPct:20}) {
  const rows=allRows.filter(r=>(!filters.from||r.ym>=filters.from)&&(!filters.to||r.ym<=filters.to)&&(!filters.car||r.k===filters.car)&&(!filters.make||r.make===filters.make));
  const months=group(rows,'ym').sort((a,b)=>a.key.localeCompare(b.key));
  const cars=group(rows,'k').sort((a,b)=>(b.profit??-Infinity)-(a.profit??-Infinity)||a.key.localeCompare(b.key,'ru',{numeric:true}));
  const totals=aggregate(rows);
  const recs=recommendations(rows,allRows,limits);
  return {rows,months,cars,totals,recs,years:[...new Set(allRows.map(r=>r.ym.slice(0,4)))].sort(),monthCount:months.length,carCount:cars.length};
}
const exported={analyze,aggregate,previous,capacity};
if(typeof module!=='undefined'&&module.exports) module.exports=exported;
else root.FiberAnalytics=exported;
})(typeof window!=='undefined'?window:globalThis);
