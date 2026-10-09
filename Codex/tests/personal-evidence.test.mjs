import {announcedSession} from '../public/lab/exchange-calendar.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {PortfolioService} from '../lib/portfolio-service.mjs';
import {EvidenceService} from '../lib/evidence-service.mjs';
import {AuditService} from '../lib/audit-service.mjs';
import {DEFAULT_LIMITS} from '../public/lab/trade-plan.mjs';
import {observationFromSnapshot,evaluateObservation,summarizeObservations} from '../public/lab/outcomes.mjs';
import {buildSnapshot} from '../public/lab/recommendation.mjs';
import {withDefaults} from '../public/lab/core.mjs';
import {regularLimits} from '../public/lab/vn-market.mjs';
const dates=[];for(let d=new Date('2026-01-05');dates.length<180;d.setUTCDate(d.getUTCDate()+1))if(announcedSession(d.toISOString().slice(0,10),'HOSE'))dates.push(d.toISOString().slice(0,10));
const rows=dates.slice(0,140).map(date=>({date,open:10000,high:10050,low:9950,close:10000,volume:100000}));
const context={schemaVersion:1,symbol:'LAB1',source:'SYNTHETIC TEST',exchange:'HOSE',priceUnit:'VND',priceBasis:'raw',coverage:{from:dates[0],to:dates[150]},actionsReviewed:true,calendar:dates,sessions:dates.slice(0,151).map(date=>({date,reference:10000,...regularLimits(10000,'HOSE'),status:'normal',kind:'regular'})),actions:[],sector:'Test',membership:[]};
const p=withDefaults({strategy:'breakout',fast:2,slow:3,lookback:5,stop:5,target:15,risk:1,fee:.25,volumeFilter:0});
const snapshot=()=>buildSnapshot({symbol:'LAB1',rows,parameters:p,forecastMethod:'naive',horizon:5,source:'dnse',metadata:{marketContext:context},now:dates[139]+'T10:00:00Z'});
function database(){const sqlite=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {sqlite,prepare(sql){return {bind(...args){const q=sqlite.prepare(sql);return {async first(){return q.get(...args)||null;},async all(){return {results:q.all(...args)};},async run(){return q.run(...args);}};}};}};}
function seed(db,s,id,user='owner'){db.sqlite.prepare('INSERT INTO audit_runs (id,user_id,started_at,status,mode,origin,source,symbols_json,settings_json,request_hash,engine_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,user,s.calculatedAt,'completed','single','manual','dnse','["LAB1"]','{}','test',s.engineVersion);db.sqlite.prepare('INSERT INTO audit_results (run_id,symbol,recorded_at,status,recommendation,as_of,input_hash,payload_hash,payload_json) VALUES (?,?,?,?,?,?,?,?,?)').run(id,'LAB1',s.calculatedAt,'success',s.decision.code,s.asOf,'test','test',JSON.stringify(s));}
const future=()=>[...rows,...dates.slice(140,145).map(date=>({date,open:10200,high:10350,low:10150,close:10300,volume:100000}))];

test('Personal portfolio persists per account and rejects stale overwrite or invalid balances',async()=>{
 const db=database(),service=new PortfolioService(db),portfolio={schemaVersion:1,asOf:dates[139],cashVnd:100000000,positions:[],limits:DEFAULT_LIMITS};
 const saved=await service.save('owner',portfolio,null);assert.deepEqual((await new PortfolioService(db).get('owner')).portfolio,portfolio);assert.equal((await service.get('other')).portfolio,null);
 await assert.rejects(()=>service.save('owner',{...portfolio,cashVnd:1},null),/phiên khác/);
 await assert.rejects(()=>service.save('owner',{...portfolio,cashVnd:-1},saved.updatedAt),/không hợp lệ/);
});
test('Prospective outcomes wait for exact maturity, preserve forecasts and detect source/history revisions',()=>{
 const s=snapshot(),before=JSON.stringify(s),o=observationFromSnapshot(s);assert.equal(o.status,'waiting');assert.equal(o.targetDate,dates[144]);
 assert.equal(evaluateObservation(o,rows,context,'dnse').status,'waiting');
 const done=evaluateObservation(o,future(),context,'dnse');assert.equal(done.status,'evaluated');assert.equal(done.errorPct,3);assert.equal(done.baselineErrorPct,3);assert.equal(done.covered,false);assert.equal(JSON.stringify(s),before);
 assert.equal(evaluateObservation(o,future(),context,'cafef').status,'data_issue');
 const revised=future().map(x=>({...x}));revised[139].volume+=1;assert.equal(evaluateObservation(o,revised,context,'dnse').status,'data_issue');
 assert.equal(evaluateObservation(o,future(),{...context,coverage:{...context.coverage,to:dates[139]}},'dnse').status,'data_issue');
 const csv=observationFromSnapshot({...s,source:'csv'});assert.equal(csv.status,'excluded');
});
test('New or changed corporate actions cannot silently change the scoring basis',()=>{
 const o=observationFromSnapshot(snapshot()),events={...context,actions:[{type:'bonus',exDate:dates[142],knownAt:dates[141],ratio:2,priceFactor:.5,tradableDate:dates[160]}]};
 assert.equal(evaluateObservation(o,future(),events,'dnse').status,'data_issue');
 const known=structuredClone(snapshot());known.metadata.marketContext.actions=[{...events.actions[0],knownAt:dates[139]}];
 assert.equal(evaluateObservation(observationFromSnapshot(known),future(),context,'dnse').status,'data_issue');
});
test('Outcome storage is account-scoped, idempotent and immutable after evaluation',async()=>{
 const db=database(),s=snapshot(),id=crypto.randomUUID(),service=new EvidenceService(db);seed(db,s,id);
 await service.register('other',id,s);assert.equal((await service.list('other')).records.length,0);
 await service.register('owner',id,s);await service.register('owner',id,s);assert.equal((await service.list('owner')).records.length,1);
 assert.equal((await service.evaluate('owner','LAB1',future(),context,'cafef')).checked,0);assert.equal((await service.list('owner')).records[0].status,'waiting');
 await service.evaluate('owner','LAB1',future(),context,'dnse');const first=(await new EvidenceService(db).list('owner')).records[0];assert.equal(first.status,'evaluated');
 const changed=future();changed.at(-1).close=12000;await service.evaluate('owner','LAB1',changed,context,'dnse');assert.deepEqual((await service.list('owner')).records[0].outcome,first.outcome);
 assert.equal((await service.list('other')).summary.evaluated,0);
 const raw=db.sqlite.prepare('SELECT payload_json FROM audit_results WHERE run_id=?').get(id).payload_json;assert.equal(raw,JSON.stringify(s));
});
test('A bounded refresh rotates past unresolved observations instead of starving later records',async()=>{
 const db=database(),s=snapshot(),service=new EvidenceService(db);let last;
 for(let i=0;i<101;i++){last=crypto.randomUUID();seed(db,s,last);await service.register('owner',last,s);}
 const incomplete={...context,coverage:{...context.coverage,to:dates[139]}};
 const first=await service.evaluate('owner','LAB1',future(),incomplete,'dnse');assert.equal(first.checked,100);assert.equal(first.limited,true);
 assert.equal(db.sqlite.prepare('SELECT status FROM evidence_observations WHERE run_id=?').get(last).status,'waiting');
 await service.evaluate('owner','LAB1',future(),context,'dnse');assert.equal(db.sqlite.prepare('SELECT status FROM evidence_observations WHERE run_id=?').get(last).status,'evaluated');
});
test('Repeated same-origin forecasts count once, with the first published forecast retained',()=>{
 const config=observationFromSnapshot(snapshot()),r={runId:'first',recordedAt:dates[139]+'T10:00:00Z',config,status:'evaluated',outcome:{errorPct:3,baselineErrorPct:3,covered:false}},later={...r,runId:'second',recordedAt:dates[139]+'T11:00:00Z',outcome:{errorPct:0,baselineErrorPct:3,covered:true}};
 const summary=summarizeObservations([later,r]);assert.equal(summary.evaluated,1);assert.equal(summary.duplicates,1);assert.equal(summary.maePct,3);
});
test('Audit saves the actual portfolio and reservations with immutable per-run plans',async()=>{
 const db=database(),service=new AuditService(db),id=crypto.randomUUID(),portfolio={schemaVersion:1,asOf:dates[139],cashVnd:5000000,positions:[],limits:DEFAULT_LIMITS};
 await service.mutate('owner',{action:'start',id,mode:'single',origin:'manual',source:'csv',symbols:['LAB1'],settings:{parameters:p,forecastMethod:'naive',horizon:5,from:dates[0],to:dates[139]}});
 const saved=await service.mutate('owner',{action:'result',id,symbol:'LAB1',rows,metadata:{source:'CSV',marketContext:context,portfolio,reservations:[]}});
 assert.equal(saved.evidenceWarning,null);assert.deepEqual(saved.result.snapshot.metadata.portfolio,portfolio);assert.equal((await new EvidenceService(db).list('owner')).records[0].status,'excluded');
 await assert.rejects(()=>service.mutate('owner',{action:'result',id,symbol:'LAB1',rows,metadata:{source:'CSV',marketContext:context,portfolio:{...portfolio,cashVnd:1},reservations:[]}}),e=>e.status===409);
});
