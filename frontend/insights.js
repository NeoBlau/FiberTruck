/* Read-only accounting bridges and business diagrams; no inferred missing measurements. */
(function(root,factory){if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./analytics.js'));else root.FiberInsights=factory(root.FiberAnalytics);})(typeof window!=='undefined'?window:globalThis,function(A){
'use strict';
const known=v=>typeof v==='number'&&Number.isFinite(v), round=v=>Math.round((v+Number.EPSILON)*100)/100;
const sum=values=>{const a=values.filter(known);return a.length?a.reduce((s,v)=>s+v,0):null;};
function sortRows(rows,key='profit',direction=-1){
  return [...rows].sort((a,b)=>{
    const x=a[key],y=b[key],missing=v=>v==null||v===''||(typeof v==='number'&&!Number.isFinite(v));
    if(missing(x))return missing(y)?String(a.k||a.name||'').localeCompare(String(b.k||b.name||''),'ru',{numeric:true}):1;
    if(missing(y))return -1;
    const diff=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'ru',{numeric:true,sensitivity:'base'});
    return diff*direction||String(a.name||a.k||'').localeCompare(String(b.name||b.k||''),'ru',{numeric:true});
  });
}
function profile(rows){
  const rs=rows.filter(r=>known(r.profit)), t=A.aggregate(rows);
  return {...t,rows:rs,km:sum(rs.map(r=>r.km)),days:sum(rs.map(r=>r.days)),liters:sum(rs.map(r=>r.liters)),
    complete:a=>rs.length>0&&rs.every(r=>r.financial&&known(r.articles?.[a])),
    metric:f=>rs.length>0&&rs.every(r=>known(r[f])),
    appliedAmort:sum(rs.map(r=>r.allocated===false?0:(r.amort??0))),
    missingAmort:rs.filter(r=>r.allocated!==false&&!known(r.amort)).length};
}
const NAMES={days:'Выручка: рабочие дни',productivity:'Выручка: км на рабочий день',volume:'Выручка: пробег',rate:'Выручка: доход на 1 км',transport:'Выручка без разложения по пробегу',other_income:'Прочий доход',fuelVolume:'Топливо: пробег',fuelRate:'Топливо: учётные литры на км',fuelUnit:'Топливо: расходы на литр',salaryDays:'Зарплата: рабочие дни',salaryDaily:'Зарплата: расходы на день',shared:'Распределённые общие расходы',amort:'Учтённая амортизация',coverage:'Заполненность статей',newRows:'Появившиеся финансовые строки',missingRows:'Отсутствующие финансовые строки',unexplained:'Итоги без полной расшифровки',rounding:'Округление'};
function factorAnalysis(allRows,baseFilter,currentFilter){
  const baseRows=A.analyze(allRows,baseFilter).rows,currentRows=A.analyze(allRows,currentFilter).rows;
  const base=A.aggregate(baseRows),current=A.aggregate(currentRows),effects=new Map(),cars=[];
  const groups=rows=>{const m=new Map();for(const r of rows){if(!m.has(r.k))m.set(r.k,[]);m.get(r.k).push(r);}return m;};
  const bmap=groups(baseRows),cmap=groups(currentRows), keys=new Set([...bmap.keys(),...cmap.keys()]);
  const add=(code,value,k)=>{if(!known(value))return;const f=effects.get(code)||{code,value:0,cars:new Set()};f.value+=value;f.cars.add(k);effects.set(code,f);};
  let common=0,newCount=0,missingCount=0;
  for(const k of keys){
    const b=profile(bmap.get(k)||[]),c=profile(cmap.get(k)||[]),local=[];
    const effect=(code,value)=>{add(code,value,k);local.push({code,value});};
    if(!known(b.profit)&&!known(c.profit))continue;
    const delta=(c.profit??0)-(b.profit??0);
    if(!known(b.profit)){newCount++;effect('newRows',c.profit);}
    else if(!known(c.profit)){missingCount++;effect('missingRows',-b.profit);}
    else{
      common++;
      const arts=new Set([...Object.keys(b.articles),...Object.keys(c.articles)]);
      for(const a of arts){
        const x=b.articles[a],y=c.articles[a],income=['revenue','other_income'].includes(a),sign=income?1:-1;
        if(!b.complete(a)||!c.complete(a)){effect('coverage',sign*((y??0)-(x??0)));continue;}
        if(a==='revenue'&&b.metric('km')&&c.metric('km')&&b.km>0&&c.km>0){
          const price0=x/b.km,price1=y/c.km;
          if(b.metric('days')&&c.metric('days')&&b.days>0&&c.days>0){
            const distance0=b.km/b.days,distance1=c.km/c.days;
            effect('days',(c.days-b.days)*distance0*price0);
            effect('productivity',c.days*(distance1-distance0)*price0);
          }else effect('volume',(c.km-b.km)*price0);
          effect('rate',c.km*(price1-price0));
        }else if(a==='fuel'&&b.metric('km')&&c.metric('km')&&b.metric('liters')&&c.metric('liters')&&b.km>0&&c.km>0&&b.liters>0&&c.liters>0){
          const rate0=b.liters/b.km,rate1=c.liters/c.km,price0=x/b.liters,price1=y/c.liters;
          effect('fuelVolume',-(c.km-b.km)*rate0*price0);
          effect('fuelRate',-c.km*(rate1-rate0)*price0);
          effect('fuelUnit',-c.liters*(price1-price0));
        }else if(a==='salary'&&b.metric('days')&&c.metric('days')&&b.days>0&&c.days>0){
          effect('salaryDays',-(c.days-b.days)*x/b.days);effect('salaryDaily',-c.days*(y/c.days-x/b.days));
        }else effect(a==='revenue'?'transport':a==='other_income'?a:'cost:'+a,sign*(y-x));
      }
      if(b.metric('overhead')&&c.metric('overhead')){
        effect('shared',-((c.overhead-c.appliedAmort)-(b.overhead-b.appliedAmort)));
        effect('amort',-(c.appliedAmort-b.appliedAmort));
      }
      const explained=local.reduce((s,e)=>s+e.value,0);
      if(Math.abs(delta-explained)>1e-7)effect('unexplained',delta-explained);
    }
    cars.push({k,before:b.profit,after:c.profit,delta:round(delta),baseKm:b.km,currentKm:c.km,baseDays:b.days,currentDays:c.days,effects:local.map(e=>({...e,value:round(e.value)}))});
  }
  const valid=known(base.profit)&&known(current.profit),delta=valid?round(current.profit-base.profit):null;
  let factors=[...effects.values()].map(f=>({...f,value:round(f.value),cars:[...f.cars]})).filter(f=>f.value!==0);
  if(valid){const residue=round(delta-factors.reduce((s,f)=>s+f.value,0));if(residue)factors.push({code:'rounding',value:residue,cars:[]});}
  const sumEffects=round(factors.reduce((s,f)=>s+f.value,0));
  return {base,current,baseRows,currentRows,valid,delta,factors,cars:cars.sort((a,b)=>a.delta-b.delta),common,newCount,missingCount,sumEffects,reconciled:valid&&sumEffects===delta,
    baseMonths:[...new Set(baseRows.map(r=>r.ym))].sort(),currentMonths:[...new Set(currentRows.map(r=>r.ym))].sort(),
    missingAmort:[...baseRows,...currentRows].filter(r=>known(r.profit)&&r.allocated!==false&&!known(r.amort)).length};
}
function businessModel(allRows,filters={},limits){
  const model=A.analyze(allRows,filters,limits),rows=model.rows;
  const flowRows=rows.filter(r=>r.financial&&Object.values(r.articles||{}).every(v=>known(v)&&v>=0)&&[r.income,r.expense,r.cost,r.profit].every(known)&&Math.abs(r.income-r.cost-r.profit)<.011);
  const flow=A.aggregate(flowRows),a=flow.articles;
  const cost=keys=>keys.reduce((s,k)=>s+(a[k]||0),0);
  const groups={fuel:cost(['fuel']),repair:cost(['repair','maintenance','tires']),payroll:cost(['salary','per_diem']),other:cost(Object.keys(a).filter(k=>!['revenue','other_income','fuel','repair','maintenance','tires','salary','per_diem'].includes(k)))};
  const overhead=flow.overhead??0,sharedCost=Math.max(0,overhead),credit=Math.max(0,-overhead);
  const incoming=round((flow.income??0)+credit),outgoing=round(Object.values(groups).reduce((s,v)=>s+v,0)+sharedCost),profit=flowRows.length?round(incoming-outgoing):null;
  const links=[];const link=(source,target,value)=>{if(value>0)links.push({source,target,value:round(value)});};
  link('Выручка от перевозок','Бюджет парка',a.revenue||0);link('Прочий доход','Бюджет парка',a.other_income||0);link('Доход общих статей','Бюджет парка',credit);
  if(profit<0)link('Дефицит доходов','Бюджет парка',-profit);
  for(const [k,label] of [['fuel','Топливо'],['repair','Ремонт, ТО, шины'],['payroll','Водители'],['other','Прочие прямые']])link('Бюджет парка',label,groups[k]);
  link('Бюджет парка','Общие и амортизация',sharedCost);if(profit>0)link('Бюджет парка','Прибыль',profit);
  return {...model,flowRows,flow,groups,profit,links,nodes:[...new Set(links.flatMap(l=>[l.source,l.target]))].map(name=>({name})),flowExcluded:rows.length-flowRows.length,requiredIncome:flowRows.length?round(outgoing-credit):null};
}
function scenario(model,changes={}){
  if(!model.flowRows.length)return {profit:null,delta:null};
  const income=model.flow.income||0,expense=model.groups;
  const delta=income*(changes.income||0)/100-expense.fuel*(changes.fuel||0)/100-expense.repair*(changes.repair||0)/100-(expense.payroll+expense.other)*(changes.other||0)/100;
  return {profit:round(model.profit+delta),delta:round(delta)};
}
return {sortRows,factorAnalysis,businessModel,scenario,factorNames:NAMES};
});
