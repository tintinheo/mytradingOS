import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSource} from '../lib/source-capture.mjs';
import {loadHistory} from '../lib/history-service.mjs';
import {dataQualityResult} from '../public/lab/credibility.mjs';
import {readJsonResponse} from '../public/lab/http-json.mjs';
import {normalizeDnse} from '../lib/ohlcv.ts';
const args={symbol:'FPT',from:'2026-09-28',to:'2026-09-30'};
const dnse={t:[1790557200,1790643600],o:[10,10],h:[11,11],l:[9,9],c:[10,10],v:[100,100]};
const cafe={Data:{Data:['28/09/2026','29/09/2026'].map(Ngay=>({Ngay,GiaMoCua:10,GiaCaoNhat:11,GiaThapNhat:9,GiaDongCua:10,KhoiLuongKhopLenh:100}))}};

test('FPT upstream HTML: attempt alternate provider, retain evidence, quarantine unverified fallback',async()=>{
 const calls=[];
 const fetcher=async url=>{calls.push(new URL(url).hostname);return url.includes('cafef')?Response.json(cafe):new Response('<!DOCTYPE html><html>challenge</html>',{headers:{'content-type':'text/html'}});};
 const r=await loadHistory('dnse',args,(p,a)=>captureSource(p,a,fetcher));
 assert.deepEqual(calls,['api.dnse.com.vn','s.cafef.vn']);
 assert.equal(r.primaryCode,'DATA_PROVIDER_HTML_RESPONSE');assert.equal(r.code,'DATA_UNAVAILABLE');
 assert.equal(r.fallbackAttempted,true);assert.equal(r.dataQuality.status,'QUARANTINED');
 assert.equal(r.recommendation,'NO SIGNAL');assert.deepEqual(r.bars,[]);
 assert.equal(r.captures[1].priceUnit,'thousand-VND');assert.equal(r.captures[1].count,2);
 assert.match(r.captures[1].rawHash,/^[a-f0-9]{64}$/);assert.ok(!r.error.includes('challenge'));
 await assert.rejects(()=>readJsonResponse(Response.json(r,{status:502}),{trustedApi:true,endpoint:'/api/ohlcv'}),e=>e.code==='DATA_UNAVAILABLE'&&e.message.includes('NO SIGNAL'));
});
test('UI-04 all providers unavailable: no bars or recommendation, bounded attempts with no 429 host rotation',async()=>{
 let calls=0;
 const r=await loadHistory('dnse',args,(p,a)=>captureSource(p,a,async()=>{calls++;return new Response('',{status:429});}));
 assert.equal(calls,2);assert.equal(r.dataQuality.status,'UNAVAILABLE');assert.equal(r.recommendation,'NO SIGNAL');assert.deepEqual(r.bars,[]);
 assert.ok(r.captures.every(c=>c.code==='DATA_PROVIDER_HTTP_ERROR'));
});
test('Valid primary preserves identity and data, without unnecessary fallback calls',async()=>{
 const providers=[];
 const r=await loadHistory('dnse',args,(p,a)=>{providers.push(p);return captureSource(p,a,async()=>Response.json(dnse));});
 assert.deepEqual(providers,['dnse']);assert.equal(r.status,'ok');assert.equal(r.provider,'dnse');assert.equal(r.fallbackAttempted,false);assert.equal(r.bars.length,2);
});
test('CafeF failure never passes its declarations to DNSE fallback',async()=>{
 const requests=[];
 const r=await loadHistory('cafef',{...args,declaration:{priceUnit:'thousand-VND',priceBasis:'raw',volumeKind:'matched'}},(p,a)=>{
  requests.push(a);return captureSource(p,a,async()=>p==='cafef'?new Response('',{status:500}):Response.json(dnse));
 });
 assert.equal(requests[1].declaration,undefined);assert.equal(r.captures[1].priceUnit,'unknown');assert.equal(r.dataQuality.status,'QUARANTINED');
});
test('DATA-07/08/09: empty history and duplicates rejected; unordered valid input normalized',async()=>{
 const empty=await captureSource('dnse',args,async()=>Response.json({t:[],o:[],h:[],l:[],c:[],v:[]}));
 assert.equal(empty.code,'DATA_PROVIDER_SCHEMA_ERROR');
 assert.throws(()=>normalizeDnse({...dnse,t:[dnse.t[0],dnse.t[0]]}),/Duplicate/);
 const reversed=Object.fromEntries(Object.entries(dnse).map(([k,v])=>[k,[...v].reverse()]));
 assert.deepEqual(normalizeDnse(reversed),normalizeDnse(dnse));
});
test('Data quality records duplicate/invalid OHLCV and quarantines each independently',()=>{
 const quality={researchReady:true,freshness:'fresh',crossSourceReady:true,issues:[],reconciliation:{upstreamIndependence:'verified',priceDisagreement:2,volumeDisagreement:1}};
 const rows=normalizeDnse(dnse),duplicate=dataQualityResult(quality,[...rows,rows[0]]);
 assert.deepEqual(duplicate.duplicateSessions,[rows[0].date]);assert.equal(duplicate.status,'QUARANTINED');assert.equal(duplicate.eligible,false);
 const bad=dataQualityResult(quality,[{...rows[0],close:100},rows[1]]);
 assert.equal(bad.ohlcConsistency,false);assert.equal(bad.status,'QUARANTINED');assert.equal(bad.priceDisagreement,2);assert.equal(bad.volumeDisagreement,1);
 const unchecked=dataQualityResult({...quality,reconciliation:{}},rows);assert.equal(unchecked.priceDisagreement,null);assert.equal(unchecked.volumeDisagreement,null);
});

test('DATA-11/15/16: stale data and each independent-source mismatch receive blocking typed quality states',()=>{
 const rows=normalizeDnse(dnse),base={researchReady:true,freshness:'fresh',crossSourceReady:true,issues:[],reconciliation:{status:'MATCHED',upstreamIndependence:'verified'}};
 const stale=dataQualityResult({...base,freshness:'stale'},rows);assert.equal(stale.code,'DATA_STALE');assert.equal(stale.status,'QUARANTINED');
 for(const field of ['priceDisagreement','volumeDisagreement']){const r=dataQualityResult({...base,reconciliation:{...base.reconciliation,[field]:1}},rows);assert.equal(r.code,'DATA_SOURCE_MISMATCH');assert.equal(r.status,'QUARANTINED');assert.equal(r.eligible,false);}
});
