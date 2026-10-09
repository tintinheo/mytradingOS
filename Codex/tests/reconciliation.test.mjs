import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {compareCaptures,bindReconciliation,sourceRevisions} from '../public/lab/reconciliation.mjs';
import {reconciliationHtml} from '../public/lab/reconciliation-ui.mjs';
import {captureSource} from '../lib/source-capture.mjs';
import {ReconciliationService} from '../lib/reconciliation-service.mjs';
import {AuditService} from '../lib/audit-service.mjs';
import {validateMarketContext,regularLimits} from '../public/lab/vn-market.mjs';
import {withDefaults,normalizeDnseClient} from '../public/lab/core.mjs';
import {normalizeDnse} from '../lib/ohlcv.ts';
import {buildTradePlan,DEFAULT_LIMITS} from '../public/lab/trade-plan.mjs';

const now='2026-10-04T14:00:00.000Z',dates=['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02'];
const rows=dates.map(date=>({date,open:10000,high:10100,low:9900,close:10000,volume:100000}));
const declaration={priceUnit:'VND',priceBasis:'raw',volumeKind:'matched'};
const context=validateMarketContext({schemaVersion:1,symbol:'LAB1',source:'SYNTHETIC TEST ONLY',exchange:'HOSE',priceUnit:'VND',priceBasis:'raw',coverage:{from:dates[0],to:'2026-10-09'},actionsReviewed:true,calendar:[...dates,'2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'],sessions:rows.map(b=>({date:b.date,reference:10000,...regularLimits(10000,'HOSE'),status:'normal',kind:'regular'})),actions:[],sector:'Test'});
function captures(){
 return [{provider:'dnse',label:'DNSE',acquisition:'server',status:'ok',capturedAt:now,...declaration,bars:structuredClone(rows),rawHash:'a',seriesHash:'a',attempts:[]},{provider:'cafef',label:'CafeF',acquisition:'server',status:'ok',capturedAt:now,priceUnit:'thousand-VND',priceBasis:'raw',volumeKind:'matched',bars:rows.map(b=>({...b,open:b.open/1000,high:b.high/1000,low:b.low/1000,close:b.close/1000})),rawHash:'b',seriesHash:'b',attempts:[]}];
}
function record(c=captures(),cxt=context){const r={schemaVersion:1,id:crypto.randomUUID(),createdAt:now,symbol:'LAB1',mode:'live',requested:{from:dates[0],to:dates.at(-1)},captures:c,context:cxt};r.report=compareCaptures({...r,...r.requested,now});r.revisions={previousId:null,changed:0,removed:0,details:[]};return r;}
function database(){const sqlite=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {sqlite,prepare(sql){return {bind(...args){const q=sqlite.prepare(sql);return {async first(){return q.get(...args)||null;},async all(){return {results:q.all(...args)};},async run(){return q.run(...args);}};}};}};}
function seeded(){const db=database();db.sqlite.prepare('INSERT INTO market_profiles VALUES (?,?,?,?)').run('owner','LAB1',JSON.stringify(context),now);return db;}
const request=()=>({id:crypto.randomUUID(),symbol:'LAB1',from:dates[0],to:dates.at(-1),mode:'live',dnse:declaration});
const fakeCapture=async provider=>captures().find(c=>c.provider===provider);

test('Reconciliation scales explicit units, compares all OHLCV and never infers a missing unit',()=>{
 const r=record();assert.equal(r.report.status,'MATCHED');assert.equal(r.report.commonSessions,5);assert.equal(r.report.rawCloseRatio,1000);assert.ok(r.report.issues.some(i=>i.code==='SCALE_HINT'));
 const c=captures();c[0].priceUnit='unknown';assert.equal(record(c).report.status,'MAPPING_REQUIRED');assert.equal(record(c).report.priceComparable,false);
 c[0].priceUnit='VND';c[0].priceBasis='adjusted';assert.equal(record(c).report.status,'MAPPING_REQUIRED');
 c[0].priceBasis='raw';c[0].volumeKind='total';assert.equal(record(c).report.volumeComparable,false);
});
test('Even minor discrepancies remain differences; sign, VND, volume and severity are explicit',()=>{
 const c=captures();c[0].bars[0].close+=50;c[0].bars[1].volume+=50;c[0].bars[2].high+=500;
 const r=record(c).report;assert.equal(r.status,'DIFFERENCE');assert.equal(r.priceDifferences,2);assert.equal(r.volumeDifferences,1);assert.equal(r.majorDifferences,1);
 assert.equal(r.details[0].differences[0].delta,50);assert.equal(r.details[0].differences[0].right,10000);assert.equal(r.details[1].differences[0].severity,'minor');
});
test('Missing sessions on both feeds cannot disappear from the denominator; suspension is explicit',()=>{
 const c=captures();for(const s of c)s.bars.splice(2,1);
 const report=record(c).report;assert.equal(report.status,'INCOMPLETE');assert.equal(report.missingSessions,1);assert.equal(report.expectedSessions,5);
 const suspended=structuredClone(context);suspended.sessions[2].status='suspended';assert.equal(record(c,suspended).report.status,'MATCHED');
 const partial=captures();partial[1].bars.pop();assert.equal(record(partial).report.missingSessions,1);
 assert.equal(record(captures(),null).report.status,'INCOMPLETE');
});
test('Unfinished Vietnam daily bars are excluded and numeric timestamps map to Vietnam session dates',()=>{
 const r=compareCaptures({symbol:'LAB1',from:dates[0],to:dates.at(-1),captures:captures(),context,now:'2026-10-02T05:00:00Z'});assert.equal(r.commonSessions,4);assert.deepEqual(r.excludedIncomplete,[1,1]);assert.equal(r.status,'MATCHED');
 const t=Date.parse('2026-09-28T17:00:00Z')/1000,payload={t:[t],o:[10],h:[11],l:[9],c:[10],v:[100]};
 assert.equal(normalizeDnse(payload)[0].date,'2026-09-29');assert.deepEqual(normalizeDnseClient(payload),normalizeDnse(payload));
});
test('New source captures expose historical edits without changing the original records',()=>{
 const old=record(),before=JSON.stringify(old),c=captures();c[0].bars[0].volume++;c[1].bars.splice(1,1);
 const revisions=sourceRevisions(old,record(c));assert.equal(revisions.changed,1);assert.equal(revisions.removed,1);assert.equal(revisions.details[0].before.volume,100000);assert.equal(JSON.stringify(old),before);
});
test('Binding requires matching user profile, complete analysis input, source and a recent server capture',()=>{
 const r=record(),args={rows,source:'dnse',context,now};assert.equal(bindReconciliation(r,args,true).eligible,true);
 assert.equal(bindReconciliation(r,args,false).status,'PROFILE_CHANGED');
 assert.equal(bindReconciliation(r,{...args,now:'2026-10-06T00:00:00Z'},true).status,'EXPIRED');
 const changed=structuredClone(rows);changed[0].volume++;assert.equal(bindReconciliation(r,{...args,rows:changed},true).status,'INPUT_CHANGED');
 assert.equal(bindReconciliation(r,{...args,rows:rows.slice(1,-1).filter((_,i)=>i!==1)},true).status,'INPUT_CHANGED');
 assert.equal(bindReconciliation({...r,mode:'uploads'},args,true).eligible,false);
 assert.equal(bindReconciliation(r,{...args,source:'csv'},true).eligible,false);
 const c=captures();c[1].bars[0].volume++;assert.equal(bindReconciliation(record(c),args,true).blocking,true);assert.equal(bindReconciliation(record(c),args,true).volumeDisagreement,1);assert.equal(bindReconciliation(record(c),args,true).priceDisagreement,0);
});
test('Capture distinguishes fallback hosts from providers and does not bypass a 429',async()=>{
 const input={t:dates.slice(0,2).map(d=>Date.parse(d+'T00:00:00Z')/1000),o:[10,10],h:[11,11],l:[9,9],c:[10,10],v:[100,100]};let calls=0;
 const args={symbol:'LAB1',from:dates[0],to:dates.at(-1),declaration};
 const r=await captureSource('dnse',args,async()=>{calls++;return calls===1?new Response('',{status:404}):Response.json(input);});
 assert.equal(r.status,'ok');assert.equal(r.provider,'dnse');assert.equal(r.attempts.length,2);assert.equal(r.rawHash.length,64);assert.equal(r.seriesHash.length,64);
 calls=0;const limited=await captureSource('dnse',args,async()=>{calls++;return new Response('',{status:429});});assert.equal(limited.status,'error');assert.equal(calls,1);
 const malformed=await captureSource('dnse',args,async()=>Response.json({...input,c:[null,10]}));assert.equal(malformed.status,'error');assert.equal(malformed.rawHash.length,64);
});
test('CafeF capture selects unadjusted close and matched volume while rejecting oversized responses',async()=>{
 const data={Data:{Data:dates.slice(0,2).map(d=>({Ngay:d,GiaMoCua:10,GiaCaoNhat:11,GiaThapNhat:9,GiaDongCua:10,GiaDieuChinh:5,KhoiLuongKhopLenh:100,TongKhoiLuong:1000}))}};
 const args={symbol:'LAB1',from:dates[0],to:dates.at(-1),declaration},r=await captureSource('cafef',args,async()=>Response.json(data));
 assert.equal(r.bars[0].close,10);assert.equal(r.bars[0].volume,100);assert.equal(r.priceUnit,'thousand-VND');
 const tooBig=await captureSource('cafef',args,async()=>new Response('{}',{headers:{'content-length':'4000001'}}));assert.equal(tooBig.status,'error');
});
test('Stored reconciliation is immutable, idempotent, account-scoped and rejects claimed server fields',async()=>{
 const db=seeded(),service=new ReconciliationService(db,{capture:fakeCapture,now:()=>now}),p=request(),saved=await service.create('owner',p);
 assert.equal(saved.report.status,'MATCHED');assert.deepEqual(await service.create('owner',p),saved);
 await assert.rejects(()=>service.detail('other',p.id),e=>e.status===404);assert.equal((await service.list('other','LAB1')).checks.length,0);
 await assert.rejects(()=>service.create('owner',{...p,to:'2026-10-01'}),e=>e.status===409);
 await assert.rejects(()=>service.create('owner',{...request(),captures:captures()}),e=>e.status===400);
 const bound=await service.resolve('owner',{symbol:'LAB1',rows,source:'dnse',context,now});assert.equal(bound.eligible,true);assert.equal(bound.checkId,p.id);
});
test('A failed source is saved as unavailable, and a later correction preserves the earlier evidence',async()=>{
 const db=seeded(),time={value:now},state={failed:true};const capture=async provider=>provider==='cafef'&&state.failed?{...await fakeCapture(provider),status:'error',bars:[],error:'timeout'}:fakeCapture(provider);
 const service=new ReconciliationService(db,{capture,now:()=>time.value}),first=await service.create('owner',request());assert.equal(first.report.status,'UNAVAILABLE');
 state.failed=false;time.value='2026-10-04T14:01:00.000Z';const second=await service.create('owner',request());assert.equal(second.report.status,'MATCHED');assert.deepEqual(await service.detail('owner',first.id),first);
 assert.equal((await service.list('owner','LAB1')).checks[0].id,second.id);
});
test('Uploaded reference files retain provenance and cannot authorize personal plans',async()=>{
 const db=seeded(),service=new ReconciliationService(db,{now:()=>now}),csv='ticker,date,open,high,low,close,volume\n'+rows.map(b=>['LAB1',b.date,b.open,b.high,b.low,b.close,b.volume].join(',')).join('\n');
 const p={...request(),mode:'uploads',files:[{label:'Reference A',provenance:'User export A',csv,declaration},{label:'Reference B',provenance:'User export B',csv,declaration}]};delete p.dnse;
 const saved=await service.create('owner',p);assert.equal(saved.report.status,'MATCHED');assert.ok(saved.report.issues.some(x=>x.code==='IDENTICAL_UPLOAD'));
 assert.equal(bindReconciliation(saved,{rows,source:'dnse',context,now},true).eligible,false);
 assert.equal((await service.resolve('owner',{symbol:'LAB1',rows,source:'dnse',context,now})).eligible,false);
});
test('Audit links the server-owned check and rejects client claims of verified reconciliation',async()=>{
 const db=seeded(),actualNow=new Date().toISOString(),service=new ReconciliationService(db,{capture:fakeCapture,now:()=>actualNow}),check=await service.create('owner',request()),audit=new AuditService(db),id=crypto.randomUUID(),parameters=withDefaults({strategy:'breakout',fast:2,slow:3,lookback:5,stop:5,target:15,risk:1,fee:.25,volumeFilter:0});
 await audit.mutate('owner',{action:'start',id,mode:'single',origin:'manual',source:'dnse',symbols:['LAB1'],settings:{parameters,forecastMethod:'none',horizon:5,from:dates[0],to:dates.at(-1)}});
 await assert.rejects(()=>audit.mutate('owner',{action:'result',id,symbol:'LAB1',rows,metadata:{source:'DNSE',marketContext:context,reconciliation:{eligible:true}}}),e=>e.status===400);
 const result=await audit.mutate('owner',{action:'result',id,symbol:'LAB1',rows,metadata:{source:'DNSE',marketContext:context}});
 assert.equal(result.result.snapshot.schemaVersion,4);assert.equal(result.result.snapshot.quality.reconciliation.checkId,check.id);assert.equal(result.result.snapshot.quality.crossSourceReady,true);
});
test('Personal plans require the cross-source gate, and source discrepancies suppress quantities',()=>{
 const calendar=[];for(let d=new Date('2026-08-03');calendar.length<65;d.setUTCDate(d.getUTCDate()+1))if(![0,6].includes(d.getUTCDay()))calendar.push(d.toISOString().slice(0,10));
 const bars=calendar.slice(0,30).map(date=>({...rows[0],date,volume:1000000})),last=bars.at(-1).date,c={...context,calendar,actions:[]},p=withDefaults({execution:'vn',stop:5,target:30,fee:.25,participation:1,maxHold:10}),base={symbol:'LAB1',rows:bars,p,context:c,features:{atr:100},marketSignal:{buy:true,entryEligible:true},quality:{freshness:'fresh',today:last,crossSourceReady:false},validation:{qualified:true},portfolio:{schemaVersion:1,asOf:last,cashVnd:100000000,positions:[],limits:DEFAULT_LIMITS}};
 assert.equal(buildTradePlan(base).status,'PAPER_ONLY');
 assert.equal(buildTradePlan({...base,quality:{...base.quality,crossSourceReady:true}}).status,'CONDITIONAL_PLAN');
 const blocked=buildTradePlan({...base,quality:{...base.quality,reconciliation:{blocking:true,reason:'Mismatch'}}});assert.equal(blocked.status,'DATA_REVIEW');assert.equal(blocked.quantity,0);
});
test('Reconciliation rendering escapes source labels, provenance and upstream errors',()=>{
 const r=record();r.captures[0].label='<img src=x onerror=alert(1)>';r.captures[0].provenance='<script>alert(1)</script>';
 const html=reconciliationHtml(r);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.match(html,/&lt;img/);assert.match(html,/Khớp số liệu/);
});
