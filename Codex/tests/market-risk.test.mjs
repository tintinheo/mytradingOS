import test from 'node:test';
import assert from 'node:assert/strict';
import {priceRiskTimeline,RISK_RULES,evaluateRiskOutcomes} from '../public/lab/price-risk.mjs';
import {validateMarketContext,tickSize,roundTick,regularLimits,technicalSeries,executionReadiness,nextSession,membershipAt,marketAssessment} from '../public/lab/vn-market.mjs';
import {backtest,withDefaults,signals} from '../public/lab/core.mjs';
import {vnBacktest} from '../public/lab/vn-execution.mjs';
import {indicators} from '../public/lab/swing.mjs';
import {buildSnapshot} from '../public/lab/recommendation.mjs';
const dates=(()=>{const out=[],d=new Date('2026-06-01T00:00:00Z');while(out.length<110){if(d.getUTCDay()!==0&&d.getUTCDay()!==6)out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;})();
const bars=(n=70)=>dates.slice(0,n).map(date=>({date,open:10000,high:10050,low:9950,close:10000,volume:100000}));
function ctx(rows,extra={}){return validateMarketContext({schemaVersion:1,symbol:'LAB1',source:'Synthetic test fixture; not market data',exchange:'HOSE',priceUnit:'VND',priceBasis:'raw',coverage:{from:rows[0].date,to:rows.at(-1).date},actionsReviewed:true,calendar:dates,sessions:rows.map(b=>({date:b.date,reference:b.open,...regularLimits(b.open,'HOSE'),status:'normal',kind:'regular'})),actions:[],membership:[{from:dates[0],to:dates.at(-1),knownAt:dates[0],member:true}],...extra});}
const p=withDefaults({strategy:'hold',fast:2,slow:3,lookback:5,stop:10,target:0,risk:10,fee:0,volumeFilter:0,minVolume:0,settlement:3,cashDelay:3,sellTax:0,maxHold:0,execution:'vn',capitalVnd:1000000,participation:1,trapFilter:'high'});
function run(rows,c,overrides={},sig){const q={...p,...overrides},series=technicalSeries(rows,c);return vnBacktest(rows,q,c,sig||signals(rows,q,c),indicators(series.rows),series.factors,priceRiskTimeline(series.rows).timeline);}

test('False breakout records confirmation date, keeps a bounded cooldown and never labels intent',()=>{
  const a=bars(30);a[20]={...a[20],open:10000,high:10300,close:10200,volume:180000};a[21]={...a[21],open:10200,high:10250,low:9900,close:10000,volume:160000};
  const risk=priceRiskTimeline(a),e=risk.events.find(e=>e.type==='FAILED_BREAKOUT');
  assert.equal(e.date,a[21].date);assert.equal(e.evidence.breakoutDate,a[20].date);
  assert.equal(risk.timeline[20].events.some(e=>e.type==='FAILED_BREAKOUT'),false);
  assert.equal(risk.timeline[21].blockEntry,true);assert.equal(risk.timeline[23].blockEntry,true);assert.equal(risk.timeline[24].blockEntry,false);
  assert.match(risk.limits.join(' '),/không xác định/);
  const short=priceRiskTimeline(a.slice(0,20));assert.equal(short.latest.level,'insufficient');
});

test('Wick sweeps, failed breakdown, runup distribution and volume shocks expose numeric evidence',()=>{
  const upper=bars(21);upper[20]={...upper[20],high:10700,close:10000,volume:200000};
  assert.ok(priceRiskTimeline(upper).latest.events.some(e=>e.type==='UPTHRUST'&&e.evidence.upperWick>0.5));
  const lower=bars(21);lower[20]={...lower[20],low:9300,volume:200000};
  assert.ok(priceRiskTimeline(lower).latest.events.some(e=>e.type==='SPRING'));
  const breakdown=bars(22);breakdown[20]={...breakdown[20],low:9700,close:9800};
  assert.ok(priceRiskTimeline(breakdown).latest.events.some(e=>e.type==='FAILED_BREAKDOWN'));
  const pump=bars(32);for(let i=20;i<31;i++){const x=10000+(i-20)*300;pump[i]={...pump[i],open:x,high:x+100,low:x-100,close:x};}
  pump[31]={...pump[31],open:13000,high:13100,low:12000,close:12100,volume:400000};
  assert.ok(priceRiskTimeline(pump).latest.events.some(e=>e.type==='RUNUP_DISTRIBUTION'));
  assert.ok(priceRiskTimeline(pump).latest.events.some(e=>e.type==='VOLUME_SHOCK'));
});

test('Risk is prefix-stable, price-scale invariant and future outcome evaluation excludes unfinished targets',()=>{
  const a=bars(40);a[25]={...a[25],volume:0};const b=a.map((v,i)=>i<30?v:{...v,high:v.high*4,close:v.close*3,volume:99999999});
  assert.deepEqual(priceRiskTimeline(a).timeline.slice(0,30),priceRiskTimeline(b).timeline.slice(0,30));
  const scaled=a.map(v=>({...v,open:v.open/1000,high:v.high/1000,low:v.low/1000,close:v.close/1000}));
  assert.deepEqual(priceRiskTimeline(a).timeline.map(v=>[v.score,v.level]),priceRiskTimeline(scaled).timeline.map(v=>[v.score,v.level]));
  assert.equal(evaluateRiskOutcomes(a.slice(0,28),priceRiskTimeline(a.slice(0,28)),5).n,0);
  assert.equal(evaluateRiskOutcomes(a,priceRiskTimeline(a),5).n,1);
  assert.equal(RISK_RULES.highScore,60);
});

test('Exchange ticks, directional rounding and standard bands are currency-correct at boundaries',()=>{
  assert.deepEqual([9990,10000,49950,50000].map(v=>tickSize(v,'HOSE')),[10,50,50,100]);
  assert.equal(tickSize(1000,'HNX'),100);assert.equal(tickSize(9000,'UPCOM'),100);
  assert.equal(roundTick(9999,'HOSE','up'),10000);assert.equal(roundTick(49999,'HOSE','up'),50000);
  assert.deepEqual(regularLimits(10000,'HOSE'),{ceiling:10700,floor:9300});
  assert.deepEqual(regularLimits(10000,'HNX'),{ceiling:11000,floor:9000});
  assert.deepEqual(regularLimits(10000,'UPCOM'),{ceiling:11500,floor:8500});
});

test('Market context rejects wrong symbols, unbounded metadata, invalid bands and overlapping PIT intervals',()=>{
  const c=ctx(bars());assert.throws(()=>validateMarketContext(c,'FPT'),/khớp/);
  assert.throws(()=>validateMarketContext({...c,untrustedField:'x'}),/trường/);
  assert.throws(()=>validateMarketContext({...c,calendar:[dates[0],dates[0]]}),/không trùng/);
  assert.throws(()=>validateMarketContext({...c,sessions:[{...c.sessions[0],ceiling:12000}]}),/biên độ/);
  assert.throws(()=>validateMarketContext({...c,membership:[...c.membership,...c.membership]}),/chồng lấn/);
  assert.equal(membershipAt(c,dates[10]),true);assert.equal(membershipAt(c,'2025-01-01'),null);
  assert.equal(nextSession(dates[4],3,dates),dates[7]);
});

test('Lots and capacity use VND and prior volume; trading-day T+ does not count missing security bars',()=>{
  const a=bars(30),c=ctx(a),r=run(a,c);
  assert.equal(r.entry.date,dates[20]);assert.equal(r.shares,100);assert.equal(r.entry.sellableDate,dates[23]);assert.equal(r.returnPct,0);
  const v=structuredClone(a);v[20].volume=1;const reduced=run(v,ctx(v));assert.equal(reduced.shares,100);assert.equal(reduced.entry.date,dates[21]);assert.equal(run(v.slice(0,21),ctx(v)).shares,0);assert.equal(reduced.audit.capacityCappedEntries,1); // observed volume can reduce fills, never expand the planned order
  const spike=structuredClone(a);spike[20].volume*=100;assert.equal(run(spike,ctx(spike)).entry.orderQuantity,r.entry.orderQuantity);
  const thousand=a.map(b=>({...b,open:b.open/1000,high:b.high/1000,low:b.low/1000,close:b.close/1000}));
  const equivalent=run(thousand,ctx(thousand,{priceUnit:'thousand-VND',sessions:c.sessions}));
  assert.equal(equivalent.shares,r.shares);assert.equal(equivalent.returnPct,r.returnPct);
  const missing=a.filter(b=>b.date!==dates[21]);
  const c2=ctx(missing,{sessions:c.sessions.map(s=>s.date===dates[21]?{...s,status:'suspended'}:s)});
  assert.equal(executionReadiness(missing,c2).ready,true);assert.equal(run(missing,c2).entry.sellableDate,dates[23]);
});

test('Limit-down and T+ defer exits; no fills on restricted sessions; capacity limits partial exits',()=>{
  const a=bars(30),signal=a.map((_,i)=>({buy:i===19,sell:i===21}));
  a[23]={...a[23],open:9300,high:9350,low:9300,close:9300};
  const c=ctx(a);c.sessions[23]={...c.sessions[23],reference:10000,...regularLimits(10000,'HOSE')};
  c.sessions[24].status='restricted';
  const r=run(a,c,{strategy:'sma'},signal);
  assert.equal(r.trades.length,1);assert.equal(r.trades[0].exitDate,dates[25]);assert.ok(r.audit.blockedFillBars>=2);
  assert.equal(r.trades[0].quantity%100,0);
  const capped=run(bars(30),ctx(bars(30)),{capitalVnd:100000000});assert.equal(capped.shares,1000);
});

test('Cash dividend is a receivable until pay date and does not manufacture an ex-date loss',()=>{
  const a=bars(40);for(let i=25;i<a.length;i++)a[i]={...a[i],open:9900,high:9950,low:9850,close:9900};
  const c=ctx(a,{actions:[{type:'cash',knownAt:dates[22],exDate:dates[25],payDate:dates[35],netCashVnd:100,priceFactor:.99}]});
  const before=run(a.slice(0,30),c),after=run(a,c);
  assert.equal(before.returnPct,0);assert.equal(before.claims.cash[0].value,10000);assert.equal(before.cashVnd,0);
  assert.equal(after.returnPct,0);assert.equal(after.cashVnd,10000);assert.equal(after.claims.cash.length,0);
  const series=technicalSeries(a,c);assert.equal(series.rows[25].close,10000);
  assert.equal(priceRiskTimeline(series.rows).timeline[25].events.some(e=>e.type==='LARGE_GAP'),false);
});

test('Share entitlements count in equity but cannot sell until tradableDate; fractional rights block accounting',()=>{
  const a=bars(40);for(let i=25;i<a.length;i++)a[i]={...a[i],open:5000,high:5050,low:4950,close:5000};
  const c=ctx(a,{actions:[{type:'bonus',knownAt:dates[22],exDate:dates[25],tradableDate:dates[35],ratio:2,priceFactor:.5}]});
  const before=run(a.slice(0,30),c),after=run(a,c);
  assert.equal(before.shares,100);assert.equal(before.sharesPending,100);assert.equal(before.returnPct,0);
  assert.equal(after.shares,200);assert.equal(after.sharesPending,0);assert.equal(after.returnPct,0);
  const invalid=structuredClone(c);invalid.actions[0].ratio=1.001;assert.throws(()=>run(a,invalid),/phân số/);
  const unknown=ctx(a,{actions:[{type:'rights',knownAt:dates[22],exDate:dates[25]}]});
  assert.equal(executionReadiness(a,unknown).ready,false);
  assert.throws(()=>backtest(a,p,unknown),/quyền mua/);
});

test('Future corporate actions cannot change earlier normalized history or filled equity',()=>{
  const a=bars(45),c=ctx(a,{actions:[{type:'cash',knownAt:dates[36],exDate:dates[40],payDate:dates[42],netCashVnd:100,priceFactor:.99}]});
  const baseline=ctx(a);assert.deepEqual(technicalSeries(a,c).rows.slice(0,40),technicalSeries(a,baseline).rows.slice(0,40));
  assert.deepEqual(run(a,c).equity.slice(0,40),run(a,baseline).equity.slice(0,40));
});

test('Missing data is explicit, VN100 membership is date-bounded, benchmarks align exact dates',()=>{
  const a=bars(40),c=ctx(a,{benchmarks:{market:a.map((b,i)=>({date:b.date,close:100+i}))}});
  assert.equal(marketAssessment(a,null,p).entryReady,false);
  const m=marketAssessment(a,c,p);assert.equal(m.entryReady,true);assert.ok(m.benchmarks.market.excessPct<0);assert.equal(m.benchmarks.sector,null);
  assert.equal(m.benchmarks.market.from,dates[19]);
  const outsider=ctx(a,{membership:[{from:dates[0],to:dates.at(-1),knownAt:dates[0],member:false}]});
  assert.equal(marketAssessment(a,outsider,{...p,requireVN100:true}).entryReady,false);
  const noContext=buildSnapshot({symbol:'LAB1',rows:a,parameters:p,source:'csv'});
  assert.equal(noContext.simulation.code,'DATA_REQUIRED');assert.equal(noContext.decision.code,'WAIT');assert.equal(noContext.backtest.returnPct,null);assert.ok(noContext.priceRisk);
});

test('Risk gates enter the real backtest and audit snapshot; raw and adjusted action ledgers cannot be mixed',()=>{
  const a=bars(30);a[20]={...a[20],high:10400,close:10300,volume:100000};a[21]={...a[21],open:10300,high:10400,low:9900,close:10000};
  const c=ctx(a),sig=a.map((_,i)=>({buy:i===21,sell:false}));
  const blocked=run(a,c,{strategy:'sma'},sig),unblocked=run(a,c,{strategy:'sma',trapFilter:'off'},sig);
  assert.equal(blocked.openPosition,false);assert.equal(blocked.audit.trapBlockedEntries,1);assert.equal(unblocked.openPosition,true);
  const adjusted=ctx(a,{priceBasis:'adjusted'});assert.equal(executionReadiness(a,adjusted).ready,false);
  const snapshot=buildSnapshot({symbol:'LAB1',rows:a,parameters:p,source:'csv',metadata:{marketContext:c}});
  assert.equal(snapshot.engineVersion,'swing-2026.10.05-p0.2');assert.equal(snapshot.market.exchange,'HOSE');assert.match(snapshot.explanation.paragraphs[7],/không phải/);
});
