const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../insights.js');
const B={from:'2026-08',to:'2026-08'},C={from:'2026-09',to:'2026-09'};
const almost=(a,b)=>assert.ok(Math.abs(a-b)<.011,`${a} != ${b}`);
function row(ym,patch={}){
 const articles={revenue:1000,other_income:0,fuel:100,salary:200,repair:50,...patch.articles};
 const expense=Object.entries(articles).filter(([k])=>!['revenue','other_income'].includes(k)).reduce((s,[,v])=>s+v,0);
 const overhead=patch.overhead??30,income=(articles.revenue??0)+(articles.other_income??0);
 return {k:'001',ym,make:'FAW',financial:true,allocated:true,articles,income,expense,cost:expense+overhead,raw:income-expense,profit:income-expense-overhead,overhead,km:100,days:10,capacity:31,liters:20,amort:10,...patch,articles};
}
const effects=m=>Object.fromEntries(m.factors.map(f=>[f.code,f.value]));
function verify(m){assert.ok(m.reconciled);almost(m.delta,m.current.profit-m.base.profit);almost(m.sumEffects,m.delta);almost(m.cars.reduce((s,c)=>s+c.delta,0),m.delta);}
test('dashboard sorts names naturally, direction changes, stable ties, and never moves blanks to the top',()=>{
 const rows=[{k:'b',name:'Машина 10',profit:null},{k:'a',name:'Машина 2',profit:0},{k:'c',name:'Машина 1',profit:-12},{k:'d',name:'Машина 3',profit:20}];
 assert.deepEqual(I.sortRows(rows,'name',1).map(r=>r.k),['c','a','d','b']);
 assert.deepEqual(I.sortRows(rows,'profit',1).map(r=>r.k),['c','a','d','b']);
 assert.deepEqual(I.sortRows(rows,'profit',-1).map(r=>r.k),['d','a','c','b']);assert.equal(rows[0].k,'b');
});
test('chain revenue decomposition: days, distance per day, and income per km',()=>{
 const m=I.factorAnalysis([row('2026-08'),row('2026-09',{km:240,days:20,articles:{revenue:3600}})],B,C),f=effects(m);
 verify(m);almost(f.days,1000);almost(f.productivity,400);almost(f.rate,1200);
});
test('fuel decomposition reconciles volume, liters per km and expenses per liter',()=>{
 const m=I.factorAnalysis([row('2026-08'),row('2026-09',{km:200,liters:60,articles:{fuel:360}})],B,C),f=effects(m);
 verify(m);almost(f.fuelVolume,-100);almost(f.fuelRate,-100);almost(f.fuelUnit,-60);
});
test('salary uses days and expense per day; common costs and amort are separate',()=>{
 const m=I.factorAnalysis([row('2026-08'),row('2026-09',{days:20,overhead:55,amort:20,articles:{salary:600}})],B,C),f=effects(m);
 verify(m);almost(f.salaryDays,-200);almost(f.salaryDaily,-200);almost(f.shared,-15);almost(f.amort,-10);
});
test('zero or missing days/km/liters never cause division by zero; missing article is a data effect',()=>{
 const before=row('2026-08',{km:null,days:0,liters:null});delete before.articles.fuel;
 const after=row('2026-09',{km:0,days:null,articles:{revenue:1300,fuel:150}});
 const m=I.factorAnalysis([before,after],B,C);verify(m);assert.equal(effects(m).transport,300);assert.equal(effects(m).coverage,-150);assert.ok(!('fuelRate' in effects(m)));
});
test('real zero articles are filled data; zeros do not become missing measurements',()=>{
 const m=I.factorAnalysis([row('2026-08',{articles:{repair:0}}),row('2026-09',{articles:{repair:20}})],B,C);verify(m);assert.equal(effects(m)['cost:repair'],-20);assert.ok(!effects(m).coverage);
});
test('new and missing financial cars are explicit and reconcile with profits',()=>{
 const rows=[row('2026-08'),row('2026-08',{k:'old'}),row('2026-09'),row('2026-09',{k:'new',articles:{revenue:1400}})];
 const m=I.factorAnalysis(rows,B,C);verify(m);assert.equal(m.newCount,1);assert.equal(m.missingCount,1);assert.equal(m.common,1);almost(effects(m).newRows,1020);almost(effects(m).missingRows,-620);
});
test('legacy profit-only history stays an unexplained accounting effect',()=>{
 const before={k:'001',ym:'2026-08',financial:false,profit:300,articles:{},overhead:0,allocated:false};
 const after={...before,ym:'2026-09',profit:450};const m=I.factorAnalysis([before,after],B,C);verify(m);assert.equal(effects(m).unexplained,150);assert.equal(m.base.income,null);
});
test('no financial data on either side cannot manufacture a zero baseline',()=>{
 assert.equal(I.factorAnalysis([row('2026-09')],B,C).valid,false);assert.equal(I.factorAnalysis([],B,C).delta,null);
});
test('car/make/month filters including multi-year ranges are respected',()=>{
 const rows=[row('2025-12'),row('2026-01'),row('2026-02',{k:'other',make:'DAF'}),row('2026-09')];
 const m=I.factorAnalysis(rows,{from:'2025-12',to:'2025-12',make:'FAW'},{from:'2026-01',to:'2026-09',car:'001'});verify(m);assert.equal(m.baseRows.length,1);assert.equal(m.currentRows.length,2);
});
test('allocation disabled leaves current registry amortization out of the profit bridge',()=>{
 const m=I.factorAnalysis([row('2026-08',{overhead:0,amort:100,allocated:false}),row('2026-09',{overhead:0,amort:300,allocated:false})],B,C);verify(m);assert.ok(!effects(m).amort);assert.ok(!effects(m).shared);
});
test('randomized accounting reconciles to cents across many cars with partial articles',()=>{
 let seed=247;const rand=()=>{seed=seed*16807%2147483647;return seed/2147483647;};
 for(let n=0;n<50;n++){
  const rows=[];for(let k=0;k<12;k++)for(const ym of ['2026-08','2026-09']){
   if(rand()<.1)continue;
   const articles={revenue:Math.round(rand()*1e7)/100,other_income:0,fuel:Math.round(rand()*1e6)/100,salary:Math.round(rand()*1e6)/100,repair:Math.round(rand()*1e6)/100};
   const r=row(ym,{k:String(k),km:Math.floor(rand()*20000),days:Math.ceil(rand()*30),liters:Math.round(rand()*10000),overhead:Math.round(rand()*1e5)/100,amort:10,articles});
   if(rand()<.25)delete r.articles.repair;rows.push(r);
  }
  const m=I.factorAnalysis(rows,B,C);verify(m);assert.ok(m.factors.every(f=>Number.isFinite(f.value)));
 }
});
function flowBalanced(m){const incoming=m.links.filter(l=>l.target==='Бюджет парка').reduce((s,l)=>s+l.value,0),outgoing=m.links.filter(l=>l.source==='Бюджет парка').reduce((s,l)=>s+l.value,0);almost(incoming,outgoing);almost(m.profit,m.flow.profit);}
test('business flow balances with profitable and loss periods and excludes legacy rows',()=>{
 for(const revenue of [1000,300,0]){
  const m=I.businessModel([row('2026-09',{articles:{revenue}}),{k:'old',ym:'2026-09',profit:20,articles:{}}]);
  assert.equal(m.flowRows.length,1);assert.equal(m.flowExcluded,1);flowBalanced(m);
  assert.equal(m.links.some(l=>l.source==='Дефицит доходов'),revenue<380);
 }
});
test('common income is shown as an inflow; direct income required for zero profit accounts for credit',()=>{
 const m=I.businessModel([row('2026-09',{overhead:-50})]);flowBalanced(m);assert.equal(m.requiredIncome,300);assert.ok(m.links.some(l=>l.source==='Доход общих статей'));
});
test('missing or inconsistent financial data cannot enter the money flow',()=>{
 const m=I.businessModel([row('2026-09',{expense:null,cost:null}),row('2026-09',{k:'bad',profit:99999}),row('2026-09',{k:'negative',articles:{fuel:-10}})]);
 assert.equal(m.flowRows.length,0);assert.equal(m.profit,null);assert.equal(m.requiredIncome,null);assert.deepEqual(I.scenario(m),{profit:null,delta:null});
});
test('scenario has independent proportional changes; zero scenario preserves profit',()=>{
 const m=I.businessModel([row('2026-09')]);almost(I.scenario(m).profit,620);
 assert.deepEqual(I.scenario(m,{income:10,fuel:-10,repair:20,other:10}),{profit:700,delta:80});
 assert.equal(m.profit,620);
});
test('business recommendations use the configured fuel limits',()=>{
 const rows=[row('2026-09')];
 assert.ok(I.businessModel(rows,{}, {lMin:0,lMax:10,fuelJumpPct:20}).recs.some(r=>r.code==='highFuel'));
 assert.ok(!I.businessModel(rows,{}, {lMin:0,lMax:50,fuelJumpPct:20}).recs.some(r=>r.code==='highFuel'));
});
