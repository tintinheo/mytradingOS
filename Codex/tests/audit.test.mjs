import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {AuditService,auditCsv,sha256} from '../lib/audit-service.mjs';
import {buildSnapshot,entryEvidence} from '../public/lab/recommendation.mjs';
import {demoBars,signals,withDefaults} from '../public/lab/core.mjs';
import {loadHistory} from '../lib/history-service.mjs';
import {captureSource} from '../lib/source-capture.mjs';
import {readJsonResponse} from '../public/lab/http-json.mjs';
import {auditFailurePayload,acquisitionFailure} from '../public/lab/acquisition-failure.mjs';
import {explanationHtml} from '../public/lab/audit-ui.mjs';

const rows=demoBars();
const p=withDefaults({strategy:'pullback',fast:10,slow:30,lookback:20,stop:7,target:18,risk:1,fee:.25,volumeFilter:0,stopMode:'atr'});
const config={mode:'scan',origin:'manual',source:'csv',symbols:['FPT','ACB','VCB'],settings:{parameters:p,forecastMethod:'momentum',horizon:5,from:rows[0].date,to:rows.at(-1).date}};
function service(){
  const sqlite=new DatabaseSync(':memory:');
  for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
  const d1={prepare(sql){return {bind(...args){const q=sqlite.prepare(sql);return {async first(){return q.get(...args)||null;},async all(){return {results:q.all(...args)};},async run(){return q.run(...args);}};}};}};
  return new AuditService(d1);
}
const begin=(s,user='owner',custom={})=>s.mutate(user,{action:'start',id:crypto.randomUUID(),...config,...custom});
const record=(s,id,symbol='FPT',custom={})=>s.mutate('owner',{action:'result',id,symbol,rows,metadata:{source:'Uploaded CSV'},...custom});

test('Audit retains complete snapshots across service instances; run and result retries are idempotent',async()=>{
  const s=service(),request={action:'start',id:crypto.randomUUID(),...config,mode:'single',symbols:['FPT']};
  await s.mutate('owner',request);await s.mutate('owner',request);
  const first=await record(s,request.id),again=await record(s,request.id);
  assert.deepEqual(first,again);
  await s.mutate('owner',{action:'finish',id:request.id,cancelled:false});
  const reopened=new AuditService(s.db),detail=await reopened.detail('owner',request.id,true);
  assert.equal(detail.run.status,'completed');assert.equal(detail.results.length,1);
  assert.deepEqual(detail.results[0].snapshot.inputBars,rows);
  assert.deepEqual(detail.results[0].snapshot.parameters,p);
  assert.equal(await sha256(JSON.stringify(detail.results[0].snapshot)),detail.results[0].payloadHash);
  assert.equal((await reopened.list('owner',new URLSearchParams())).runs.length,1);
  assert.equal((await record(s,request.id)).result.inputHash,first.result.inputHash);
  let downloaded='';for await(const chunk of await reopened.exportJson('owner',request.id))downloaded+=chunk;
  const exported=JSON.parse(downloaded);
  assert.deepEqual(exported.results[0].snapshot.inputBars,rows);
  assert.equal(await sha256(JSON.stringify(exported.results[0].snapshot)),exported.results[0].payloadHash);
});
test('Record isolation, immutable results, explicit missing symbols and cancelled scans',async()=>{
  const s=service(),{run}=await begin(s);
  await record(s,run.id);
  await assert.rejects(()=>s.detail('other',run.id),e=>e.status===404);
  await assert.rejects(()=>s.mutate('other',{action:'result',id:run.id,symbol:'ACB',error:'unauthorized'}),e=>e.status===404);
  assert.equal((await s.list('other',new URLSearchParams())).runs.length,0);
  await assert.rejects(()=>record(s,run.id,'FPT',{rows:rows.slice(1)}),e=>e.status===409);
  await assert.rejects(()=>s.mutate('owner',{action:'finish',id:run.id,cancelled:false}),e=>e.status===409);
  await s.mutate('owner',{action:'finish',id:run.id,cancelled:true});
  const detail=await s.detail('owner',run.id);
  assert.deepEqual(detail.unprocessed,['ACB','VCB']);assert.equal(detail.run.status,'cancelled');
  assert.equal(detail.results[0].snapshot.inputBars,undefined);
  await assert.rejects(()=>record(s,run.id,'ACB'),e=>e.status===409);
  assert.match(auditCsv(detail),/not_processed/);
});
test('Partial and failed scans record errors without inventing recommendations; exports contain all symbols',async()=>{
  const s=service(),{run}=await begin(s);
  await record(s,run.id);
  for(const symbol of ['ACB','VCB'])await record(s,run.id,symbol,{rows:undefined,error:'Provider unavailable'});
  const complete=await s.mutate('owner',{action:'finish',id:run.id,cancelled:false});
  assert.equal(complete.run.status,'partial');
  const detail=await s.detail('owner',run.id);
  assert.equal(detail.results.find(r=>r.symbol==='ACB').recommendation,'ERROR');
  assert.match(auditCsv(detail),/"FPT"/);assert.match(auditCsv(detail),/"VCB"/);
  const filter=new URLSearchParams({symbol:'VCB',recommendation:'ERROR'});
  assert.equal((await s.list('owner',filter)).runs.length,1);
  filter.set('recommendation','WAIT');assert.equal((await s.list('owner',filter)).runs.length,0);
  const failed=await begin(s,'owner',{mode:'single',symbols:['FPT']});
  await record(s,failed.run.id,'FPT',{rows:undefined,error:'No data'});
  assert.equal((await s.mutate('owner',{action:'finish',id:failed.run.id,cancelled:false})).run.status,'failed');
});
test('Duplicate, invalid OHLC and outside-range bars cannot enter the audit',async()=>{
  const s=service(),{run}=await begin(s);
  for(const bad of [[rows[0],rows[0]],[{...rows[0],high:0},rows[1]],[{...rows[0],date:'1900-01-01'},rows[1]]])await assert.rejects(()=>record(s,run.id,'FPT',{rows:bad}),e=>e.status===400);
  assert.equal((await s.detail('owner',run.id)).results.length,0);
});
test('Entry explanation predicates agree with actual entry signals for every strategy and volume filter',()=>{
  for(const strategy of ['pullback','confirmed','range','sma','breakout'])for(const volumeFilter of [0,1,1.5])for(const length of [2,19,59,60,100,150,220,260]){
    const bars=rows.slice(0,length),parameters={...p,strategy,volumeFilter};
    assert.equal(entryEvidence(bars,parameters).every(x=>x.passed),signals(bars,parameters).at(-1).buy,`${strategy}/${length}/${volumeFilter}`);
  }
});
test('Explanations separate historical simulation, stale data and unsupported forecasts',()=>{
  const short=buildSnapshot({symbol:'FPT',rows:rows.slice(0,20),parameters:p,source:'csv',forecastMethod:'regime'});
  assert.equal(short.forecast,null);assert.match(short.explanation.paragraphs[5],/chưa đủ/);
  assert.match(short.explanation.summary,/chưa có điểm mua/);
  const stale=buildSnapshot({symbol:'FPT',rows,parameters:p,source:'dnse',now:'2030-01-01T00:00:00.000Z'});
  assert.equal(stale.decision.code,'STALE');assert.match(stale.explanation.summary,/Không xem đây là tín hiệu hiện tại/);
  assert.equal(stale.risk.entry,null);
});
test('History uses Vietnam calendar dates and stable pagination, including unfinished requested symbols',async()=>{
  const s=service();
  for(let i=0;i<28;i++)await begin(s);
  const first=await s.list('owner',new URLSearchParams({symbol:'VCB'}));
  assert.equal(first.runs.length,25);assert.ok(first.nextCursor);
  const second=await s.list('owner',new URLSearchParams({symbol:'VCB',cursor:first.nextCursor}));
  assert.equal(second.runs.length,3);assert.equal(new Set([...first.runs,...second.runs].map(r=>r.id)).size,28);
  const date=new Date(first.runs[0].startedAt).toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
  assert.equal((await s.list('owner',new URLSearchParams({from:date,to:date}))).runs.length,25);
});

async function providerFailure(){
  const args={symbol:'FPT',from:config.settings.from,to:config.settings.to};
  const captured=await loadHistory('dnse',args,(p,a)=>captureSource(p,a,async()=>p==='dnse'?new Response('<!DOCTYPE html><html>secret challenge</html>',{headers:{'content-type':'text/html'}}):new Response('',{status:429})));
  const body={...captured,...args,source:'dnse'};
  try{await readJsonResponse(Response.json(body,{status:502}),{trustedApi:true,endpoint:'/api/ohlcv?symbol=FPT'});}catch(error){return {body,error};}
  throw new Error('Expected provider failure');
}
test('AUD: FPT HTML and 429 fallback survive HTTP parsing, failed audit, reload and export with NO SIGNAL',async()=>{
  const {error}=await providerFailure(),s=service(),{run}=await begin(s,'owner',{source:'dnse',mode:'single',symbols:['FPT']});
  assert.equal(error.acquisitionFailure.primaryCode,'DATA_PROVIDER_HTML_RESPONSE');
  assert.equal(error.acquisitionFailure.captures[1].attempts[0].httpStatus,429);
  const payload={action:'result',id:run.id,symbol:'FPT',...auditFailurePayload(error)};
  const saved=await s.mutate('owner',payload);assert.deepEqual(await s.mutate('owner',payload),saved);
  assert.equal(saved.result.recommendation,'NO SIGNAL');assert.equal(saved.result.status,'error');
  assert.equal(saved.result.snapshot.dataQuality.status,'UNAVAILABLE');assert.equal(saved.result.snapshot.dataQuality.eligible,false);
  assert.equal(saved.result.snapshot.inputBars,undefined);assert.equal(saved.result.snapshot.risk,undefined);
  assert.match(explanationHtml(saved.result.snapshot,true),/NO SIGNAL/);
  assert.match(explanationHtml(saved.result.snapshot,true),/DATA_PROVIDER_HTML_RESPONSE/);
  await s.mutate('owner',{action:'finish',id:run.id,cancelled:false});
  const reopened=new AuditService(s.db),detail=await reopened.detail('owner',run.id,true);
  assert.equal(detail.run.status,'failed');assert.deepEqual(detail.results[0].snapshot.acquisitionFailure,error.acquisitionFailure);
  let raw='';for await(const chunk of await reopened.exportJson('owner',run.id))raw+=chunk;
  const exported=JSON.parse(raw).results[0];assert.equal(await sha256(JSON.stringify(exported.snapshot)),exported.payloadHash);
  assert.equal((await reopened.list('owner',new URLSearchParams({recommendation:'NO SIGNAL'}))).runs.length,1);
  assert.ok(!raw.includes('secret challenge'));assert.ok(!JSON.stringify(exported.snapshot.acquisitionFailure).includes('?'));
  const revised=structuredClone(payload);revised.acquisitionFailure.captures[1].attempts[0].httpStatus=500;
  await assert.rejects(()=>s.mutate('owner',revised),e=>e.status===409);
  await assert.rejects(()=>reopened.detail('other',run.id),e=>e.status===404);
});
test('AUD: diagnostics are bounded, omit secrets and cannot attach to wrong inputs or successful bars',async()=>{
  const {body,error}=await providerFailure();
  body.captures[0].attempts[0].url='https://username:password@api.dnse.com.vn/prices?token=secret';
  body.captures[0].attempts[0].error='<script>secret</script>';body.captures[0].headers={Authorization:'secret'};
  const clean=acquisitionFailure(body);assert.ok(!JSON.stringify(clean).includes('secret'));assert.ok(!JSON.stringify(clean).includes('password'));
  assert.equal(clean.captures[0].attempts[0].host,'api.dnse.com.vn');
  const s=service(),{run}=await begin(s,'owner',{source:'dnse'}),base={action:'result',id:run.id,symbol:'FPT',...auditFailurePayload(error)};
  for(const mutate of [p=>{p.acquisitionFailure.symbol='ACB';},p=>{p.acquisitionFailure.from='2000-01-01';},p=>{p.acquisitionFailure.captures[0].headers={secret:'x'};},p=>{p.acquisitionFailure.captures[0].attempts=Array(4).fill(p.acquisitionFailure.captures[0].attempts[0]);},p=>{p.acquisitionFailure.recommendation='BUY';},p=>{p.acquisitionFailure.qualityStatus='QUARANTINED';},p=>{delete p.error;p.rows=rows;}]){
    const p=structuredClone(base);mutate(p);await assert.rejects(()=>s.mutate('owner',p),e=>e.status===400);
  }
  const other=await begin(s,'owner',{source:'cafef'});
  await assert.rejects(()=>s.mutate('owner',{...base,id:other.run.id}),e=>e.status===400);
  assert.equal((await s.detail('owner',run.id)).results.length,0);
  await assert.rejects(()=>readJsonResponse(Response.json(body,{status:502}),{trustedApi:true,endpoint:'/api/audit'}),e=>!e.acquisitionFailure);
});
test('AUD: a successful but unverified fallback retains hashes and remains quarantined after reload',async()=>{
  const {body}=await providerFailure();
  const candidate=body.captures[1];
  Object.assign(candidate,{status:'ok',code:null,count:2,rawHash:'a'.repeat(64),seriesHash:'b'.repeat(64),lastBar:config.settings.to});
  Object.assign(candidate.attempts[0],{httpStatus:200,code:null});
  const failure=acquisitionFailure(body),s=service(),{run}=await begin(s,'owner',{source:'dnse',mode:'single',symbols:['FPT']});
  assert.equal(failure.qualityStatus,'QUARANTINED');
  await s.mutate('owner',{action:'result',id:run.id,symbol:'FPT',error:'Unverified fallback',acquisitionFailure:failure});
  const result=(await new AuditService(s.db).detail('owner',run.id,true)).results[0];
  assert.equal(result.recommendation,'NO SIGNAL');assert.equal(result.snapshot.dataQuality.eligible,false);
  assert.equal(result.snapshot.acquisitionFailure.captures[1].rawHash,'a'.repeat(64));
  assert.equal(result.snapshot.acquisitionFailure.captures[1].seriesHash,'b'.repeat(64));
  assert.equal(result.snapshot.forecast,undefined);
});
