import test from 'node:test';
import assert from 'node:assert/strict';
import {withDefaults,signals,backtest} from '../public/lab/core.mjs';
import {buildSnapshot} from '../public/lab/recommendation.mjs';
import {validateMarketContext,regularLimits,technicalSeries} from '../public/lab/vn-market.mjs';
import {indicators} from '../public/lab/swing.mjs';
import {vnBacktest} from '../public/lab/vn-execution.mjs';
import {priceRiskTimeline,evaluateRiskOutcomes} from '../public/lab/price-risk.mjs';
import {validatePortfolio,DEFAULT_LIMITS,buildTradePlan} from '../public/lab/trade-plan.mjs';
import {assessData,forecastWithActions} from '../public/lab/data-quality.mjs';
import {strategyValidation} from '../public/lab/validation.mjs';
import {layersHtml,validationHtml} from '../public/lab/research-ui.mjs';
const dates=[];for(let d=new Date('2025-06-02');dates.length<550;d.setUTCDate(d.getUTCDate()+1))if(![0,6].includes(d.getUTCDay()))dates.push(d.toISOString().slice(0,10));
const bars=(n=70)=>dates.slice(0,n).map(date=>({date,open:10000,high:10050,low:9950,close:10000,volume:1000000}));
const p=withDefaults({strategy:'breakout',fast:2,slow:3,lookback:5,stop:5,target:15,risk:1,fee:.25,volumeFilter:0,minVolume:0,settlement:3,cashDelay:3,sellTax:.1,maxHold:0,execution:'vn',capitalVnd:100000000,participation:1,trapFilter:'off'});
const ctx=(rows,extra={})=>validateMarketContext({schemaVersion:1,symbol:'LAB1',source:'SYNTHETIC TEST ONLY',exchange:'HOSE',priceUnit:'VND',priceBasis:'raw',coverage:{from:rows[0].date,to:rows.at(-1).date},actionsReviewed:true,calendar:dates,sessions:rows.map((b,i)=>({date:b.date,reference:rows[i-1]?.close??b.open,...regularLimits(rows[i-1]?.close??b.open,'HOSE'),status:'normal',kind:'regular'})),actions:[],sector:'Test sector',membership:[{from:dates[0],to:dates.at(-1),knownAt:dates[0],member:true}],...extra});
const snap=(rows,parameters=p,c=ctx(rows),extra={})=>buildSnapshot({symbol:'LAB1',rows,parameters,forecastMethod:'naive',horizon:5,source:'dnse',metadata:{marketContext:c},now:rows.at(-1).date+'T10:00:00Z',...extra});
const portfolio=(asOf,cashVnd=100000000)=>validatePortfolio({schemaVersion:1,asOf,cashVnd,positions:[],limits:{...DEFAULT_LIMITS,maxGapPct:1}});

test('Recent but stale live feeds and incomplete bars cannot authorize a new plan',()=>{
 const a=bars();a.at(-1).close=10200;a.at(-1).high=10250;const c=ctx(a,{calendar:dates.slice(0,71)}),s=snap(a,p,c,{now:dates[73]+'T10:00:00Z'});
 assert.equal(s.quality.freshness,'unverified');assert.equal(s.marketSignal.entryEligible,false);assert.notEqual(s.decision.code,'BUY_CONDITION');
 const full=snap(a,p,ctx(a),{now:dates[73]+'T10:00:00Z'});assert.equal(full.decision.code,'STALE');
 const unfinished=snap(a,p,ctx(a),{now:a.at(-1).date+'T05:00:00Z'});assert.equal(unfinished.quality.freshness,'incomplete');assert.equal(unfinished.marketSignal.entryEligible,false);
});
test('Invalid stop blocks recommendations and tick rounding reaches reference prices',()=>{
 const a=bars();for(const b of a){b.high=10700;b.low=9300;}a.at(-1).close=10050;
 const bad=snap(a,{...p,stopMode:'atr',atrStop:10});assert.equal(bad.decision.code,'INVALID_PLAN');assert.equal(bad.marketSignal.entryEligible,false);assert.equal(bad.risk.stop,null);
 const normal=bars();normal.at(-1).close=10200;normal.at(-1).high=10250;
 const good=snap(normal,{...p,stopMode:'atr',atrStop:2});assert.equal(good.risk.stop%10,0);assert.equal(good.risk.target%50,0);
});
test('Announced future bonus adjusts the price path at ex-date; unsupported rights suppress forecast',()=>{
 const a=bars(),action={type:'bonus',knownAt:dates[65],exDate:dates[72],tradableDate:dates[90],ratio:2,priceFactor:.5},s=snap(a,p,ctx(a,{actions:[action]}));
 assert.equal(s.forecast.center,5000);assert.equal(s.forecast.points[1].center,10000);assert.equal(s.forecast.points[2].center,5000);assert.equal(s.forecast.targetDate,dates[74]);assert.match(s.forecastNote,/hệ số quyền/);
 const rights=snap(a,p,ctx(a,{actions:[{type:'rights',knownAt:dates[65],exDate:dates[72]}]}));assert.equal(rights.forecast,null);
 const unknown=snap(a,p,ctx(a,{actions:[{...action,knownAt:dates[71]}]}));assert.equal(unknown.forecast.center,10000);
});
test('A partial target remains a limit target, not a next-open market liquidation',()=>{
 const a=bars(27);a[23]={...a[23],high:10600,close:10400,volume:100000};a[24]={...a[24],open:9900,high:10000,low:9850,close:9900};
 const c=ctx(a),series=technicalSeries(a,c),q={...p,strategy:'sma',risk:10,stop:10,target:5,fee:0,sellTax:0,participation:1},sig=a.map((_,i)=>({buy:i===19,sell:false}));
 const r=vnBacktest(a,q,c,sig,indicators(series.rows),series.factors,priceRiskTimeline(series.rows).timeline);
 assert.equal(r.trades.length,1);assert.equal(r.trades[0].exitPrice,10500);assert.equal(r.shares,9000);assert.equal(r.entry.deferred,null);
});
test('Combined high-score alerts enter mature outcome statistics exactly once per horizon',()=>{
 const a=bars(30);a[20]={...a[20],high:10700,volume:3000000};const risk=priceRiskTimeline(a),out=evaluateRiskOutcomes(a,risk,5);
 assert.equal(risk.timeline[20].score,60);assert.equal(out.n,1);assert.equal(out.samples[0].date,a[20].date);
});
test('Market decision is independent of historical simulated position',()=>{
 const a=bars();for(let i=25;i<a.length;i++)a[i]={...a[i],open:10200,high:10250,low:10150,close:10200};a[25].open=10000;a[25].low=9950;
 const full=snap(a),short=snap(a.slice(30));assert.equal(full.simulation.openPosition,true);assert.equal(short.simulation.openPosition,false);assert.equal(full.decision.code,short.decision.code);assert.deepEqual(full.marketSignal.buy,short.marketSignal.buy);
});
test('Personal plans respect money, lots, net risk, shared reservations and data freshness',()=>{
 const a=bars();a.at(-1).close=10200;a.at(-1).high=10250;const c=ctx(a),s=snap(a),account=portfolio(s.asOf),base={symbol:'LAB1',rows:a,p,context:c,features:s.features,marketSignal:s.marketSignal,quality:s.quality,validation:{qualified:true}};
 const poor=buildTradePlan({...base,portfolio:portfolio(s.asOf,1000000)});assert.equal(poor.quantity,0);assert.equal(poor.status,'BLOCKED');
 const first=buildTradePlan({...base,portfolio:account});assert.ok(first.quantity>=100);assert.equal(first.quantity%100,0);assert.ok(first.riskVnd<=account.cashVnd*.01+1e-6);assert.ok(first.costVnd<=account.cashVnd);
 const second=buildTradePlan({...base,symbol:'LAB2',portfolio:account,reservations:[first.reservation]});const third=buildTradePlan({...base,symbol:'LAB3',portfolio:account,reservations:[first.reservation,second.reservation].filter(Boolean)});
 assert.ok(first.quantity*first.maxBuyVnd+second.quantity*second.maxBuyVnd+third.quantity*third.maxBuyVnd<=account.cashVnd*.30+1e-6);
 const paper=buildTradePlan({...base,portfolio:account,validation:{qualified:false,reason:'Insufficient'}});assert.equal(paper.status,'PAPER_ONLY');
 const old=buildTradePlan({...base,portfolio:{...account,asOf:dates[68]}});assert.equal(old.status,'UPDATE_REQUIRED');assert.equal(old.quantity,0);
});
test('Real holdings drive exits and unavailable shares are never presented as sellable',()=>{
 const a=bars(),s=snap(a),account=portfolio(s.asOf);account.positions=[{symbol:'LAB1',sector:'Test sector',entryDate:dates[68],available:0,pending:1000,pendingUntil:dates[72],averageCostVnd:11000,markVnd:10000,stopVnd:10200,targetVnd:12000}];
 const plan=buildTradePlan({symbol:'LAB1',rows:a,p,context:ctx(a),features:s.features,marketSignal:s.marketSignal,quality:s.quality,portfolio:account});assert.equal(plan.status,'EXIT_LOCKED');assert.equal(plan.quantity,0);
 assert.throws(()=>validatePortfolio({...account,positions:[...account.positions,...account.positions]}),/trùng/);
});
test('Walk-forward never trades in warmup and future shocks do not alter completed folds',()=>{
 const a=bars(480);for(let i=0;i<a.length;i++){const v=10000+Math.round((Math.sin(i/7)*300+i*2)/50)*50;a[i]={...a[i],open:v,high:v+100,low:v-100,close:v};}
 const q={...p,strategy:'sma',execution:'research'},r=backtest(a,{...q,tradeFromDate:dates[180]});assert.ok(r.trades.every(t=>t.entryDate>=dates[180]));assert.ok(r.equity.slice(0,180).every(e=>e.value===100));
 const quality={researchReady:true},c=ctx(a,{priceBasis:'adjusted'}),base=strategyValidation(a,q,c,quality),changed=structuredClone(a);for(let i=420;i<480;i++)for(const k of ['open','high','low','close'])changed[i][k]*=2;
 const future=strategyValidation(changed,q,c,quality);assert.equal(base.folds.length,5);assert.deepEqual(base.folds.slice(0,4),future.folds.slice(0,4));
 assert.equal(strategyValidation(a.slice(0,150),q,c,quality).status,'INSUFFICIENT');
});
test('New research views escape untrusted portfolio text and render empty evidence',()=>{
 const s=snap(bars());s.personalPlan.reasons=['<img src=x onerror=alert(1)>'];assert.ok(!layersHtml(s).includes('<img'));assert.match(layersHtml(s),/&lt;img/);assert.match(validationHtml(s.validation),/Chưa đủ/);
});
