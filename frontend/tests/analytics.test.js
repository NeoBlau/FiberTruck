const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyze,aggregate}=require('../analytics.js');
const row=(overrides={})=>({k:'1',ym:'2025-12',make:'DAF',income:1000,expense:600,cost:700,profit:300,raw:400,overhead:100,amort:0,km:1000,days:15,capacity:30,liters:200,articles:{revenue:1000,fuel:300,repair:300},financial:true,...overrides});
test('weighted ratios use only matched same-car same-month values',()=>{
 const r=aggregate([row(),row({ym:'2026-01',km:9000,liters:3600}),row({k:'2',km:50000,liters:null,cost:null})]);
 assert.equal(r.rate,38);assert.equal(r.coverage.matched,2);assert.equal(r.costKm,0.14);assert.equal(r.km,60000);
});
test('missing is not zero, explicit zero remains known',()=>{
 assert.equal(aggregate([]).profit,null);
 const a=aggregate([row({profit:null,income:null,expense:null,cost:null,km:null,days:null,liters:null})]);
 assert.equal(a.rate,null);assert.equal(a.margin,null);assert.equal(a.costKm,null);
 assert.equal(aggregate([row({liters:0,profit:0})]).rate,0);assert.equal(aggregate([row({profit:0})]).profit,0);
});
test('all years included and period/car/make filters apply to every result',()=>{
 const rows=[row(),row({ym:'2026-01'}),row({k:'2',ym:'2026-02',make:'FAW'})];
 const all=analyze(rows);assert.deepEqual(all.years,['2025','2026']);assert.equal(all.monthCount,3);assert.equal(all.carCount,2);
 const a=analyze(rows,{from:'2026-01',to:'2026-02',make:'DAF',car:'1'});assert.equal(a.rows.length,1);assert.equal(a.totals.income,1000);
 assert.equal(analyze(rows,{from:'2026-02',to:'2026-01'}).monthCount,0);
});
test('historical profit cannot invent income, costs or margin',()=>{
 const a=aggregate([row(),row({profit:-500,income:null,cost:null,expense:null,financial:false})]);
 assert.equal(a.profit,-200);assert.equal(a.margin,null);assert.equal(a.income,1000);
});
test('utilization uses calendar capacity, not average of percentages',()=>{
 const a=aggregate([row({days:10,capacity:10}),row({days:0,capacity:30})]);assert.equal(a.utilization,25);
});
test('growth compares adjacent calendar months across year boundary; gaps not bridged',()=>{
 const a=analyze([row({liters:200}),row({ym:'2026-01',liters:400}),row({ym:'2026-03',liters:600})]);
 assert.deepEqual(a.recs.find(r=>r.code==='fuelJump').months,['2026-01']);
});
test('recommendations respect thresholds, explicit zero amortization and report source months',()=>{
 const a=analyze([row({liters:600}),row({ym:'2026-01',profit:-100,days:0,liters:0})],{},{lMin:20,lMax:50,fuelJumpPct:20});
 const high=a.recs.find(r=>r.code==='highFuel');assert.equal(high.value,100);assert.deepEqual(high.months,['2025-12']);
 assert.ok(a.recs.some(r=>r.code==='loss'));assert.ok(a.recs.some(r=>r.code==='fuelLiters'));assert.ok(!a.recs.some(r=>r.code==='amort'));
});
test('missing mileage never produces consumption or high-fuel accusation',()=>{
 const a=analyze([row({km:null,liters:2000})]);assert.equal(a.totals.rate,null);assert.ok(a.recs.some(r=>r.code==='fuelKm'));assert.ok(!a.recs.some(r=>r.code==='highFuel'));
});
test('explicit zero mileage costs remain in fleet cost per kilometer; unknown mileage excluded',()=>{
 const a=aggregate([row({cost:100,km:100}),row({cost:500,km:0}),row({cost:1000,km:null})]);assert.equal(a.costKm,6);
 assert.equal(aggregate([row({km:0,cost:500})]).costKm,null);
});
test('expense growth needs adjacent month and known incomes; omitted months are not inferred',()=>{
 const a=analyze([row(),row({ym:'2026-01',expense:900}),row({ym:'2026-03',expense:1800})]);
 assert.deepEqual(a.recs.find(r=>r.code==='expenseGrowth').months,['2026-01']);
});
test('available days intersect service dates and observed schedule, including leap February',()=>{
 const {capacity}=require('../analytics.js');
 assert.equal(capacity('2026-02'),28);assert.equal(capacity('2024-02'),29);
 assert.equal(capacity('2026-09',{from:'2026-09-21',filled:10}),0);
 assert.equal(capacity('2026-09',{from:'2026-09-05',to:'2026-09-20',filled:10}),6);
 assert.equal(capacity('2026-09',{filled:0}),0);
 assert.equal(capacity('2026-09',{from:'2026-10-01'}),0);
});
