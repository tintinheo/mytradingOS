import test from 'node:test';
import assert from 'node:assert/strict';
import {readJsonResponse,requestJson} from '../public/lab/http-json.mjs';
import {captureSource} from '../lib/source-capture.mjs';
const args={symbol:'FPT',from:'2026-09-28',to:'2026-09-30'};
const data={t:[1790557200,1790643600],o:[10,10],h:[11,11],l:[9,9],c:[10,10],v:[100,100]};
test('DATA-01/02/06: JSON succeeds; HTML, mislabeled HTML and malformed JSON are typed',async()=>{
 assert.deepEqual(await readJsonResponse(Response.json({ok:true})),{ok:true});
 for(const headers of [{'content-type':'text/html'},{'content-type':'application/json'}])await assert.rejects(()=>readJsonResponse(new Response('<!DOCTYPE html><html>secret upstream body</html>',{headers})),e=>e.code==='DATA_PROVIDER_HTML_RESPONSE'&&!e.message.includes('secret'));
 await assert.rejects(()=>readJsonResponse(new Response('{',{headers:{'content-type':'application/json'}})),e=>e.code==='DATA_PROVIDER_INVALID_JSON');
 await assert.rejects(()=>readJsonResponse(new Response('{}')),e=>e.code==='DATA_PROVIDER_CONTENT_TYPE');
});
test('DATA-03/04/05: 403 and 429 never rotate the same-provider hostname; 500 is typed',async()=>{
 for(const status of [403,429,500]){let calls=0;const r=await captureSource('dnse',args,async()=>{calls++;return new Response('<html>',{status});});assert.equal(r.code,'DATA_PROVIDER_HTTP_ERROR');assert.equal(calls,1);assert.equal(r.bars.length,0);}
});
test('DATA-07/10/12/13/14: invalid bar data and future dates cannot reach analysis',async()=>{
 for(const input of [{...data,v:[-1,100]},{...data,c:[20,10]},{...data,h:[8,11]},{...data,o:undefined},{...data,t:[4102444800,4102531200]}]){const r=await captureSource('dnse',args,async()=>Response.json(input));assert.equal(r.status,'error');assert.equal(r.code,'DATA_PROVIDER_SCHEMA_ERROR');}
});
test('UI-01/02: audit HTML never leaks a parser crash; timeout covers response body',async()=>{
 await assert.rejects(()=>requestJson('/api/audit',{},100,async()=>new Response('<!DOCTYPE html>',{headers:{'content-type':'text/html'}})),e=>e.code==='API_HTML_RESPONSE'&&e.endpoint==='/api/audit');
 await assert.rejects(()=>requestJson('/api/ohlcv',{},5,async(_url,{signal})=>new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(new Error('aborted')));}}),{headers:{'content-type':'application/json'}})),e=>e.code==='DATA_PROVIDER_TIMEOUT');
});

test('UI-01 FPT regression: actual audit startup handles HTML and can recover on a later request',async()=>{
 const nodes=new Map();globalThis.document={getElementById(id){if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,classList:{toggle(){}}});return nodes.get(id);}};
 let html=true;const original=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>html?new Response('<!DOCTYPE html>',{headers:{'content-type':'text/html'}}):Response.json(String(url).includes('draftScope')?{scope:'test-fpt'}:{run:{id:JSON.parse(options.body).id}});
 try{const audit=await import('../public/lab/audit-ui.mjs?fpt-regression');await assert.rejects(()=>audit.beginAudit({symbols:['FPT']}),e=>e.code==='API_HTML_RESPONSE'&&e.endpoint==='/api/audit');assert.equal(audit.hasPendingAudit(),false);html=false;assert.ok((await audit.beginAudit({symbols:['FPT']})).id);}
 finally{globalThis.fetch=original;delete globalThis.document;}
});

test('API auth, service HTML and upstream HTML stay distinct; retry preserves 429',async()=>{
 for(const content of [Response.json({error:'Sign in'},{status:401}),new Response('<html>',{status:401,headers:{'content-type':'text/html'}})])await assert.rejects(()=>readJsonResponse(content,{trustedApi:true,endpoint:'/api/audit'}),e=>e.code==='API_AUTH_REQUIRED');
 await assert.rejects(()=>requestJson('/api/ohlcv',{},100,async()=>Response.json({code:'DATA_PROVIDER_HTML_RESPONSE',error:'DATA_PROVIDER_HTML_RESPONSE: Nguồn giá trả HTML'},{status:502})),e=>e.code==='DATA_PROVIDER_HTML_RESPONSE'&&e.message.split('DATA_PROVIDER_HTML_RESPONSE').length===2);
 await assert.rejects(()=>readJsonResponse(Response.json({error:'Try later'},{status:429}),{trustedApi:true}),e=>e.retry===true);
});

test('Provider redirects are rejected without following a sign-in page or rotating hosts',async()=>{
 let calls=0;const r=await captureSource('dnse',args,async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://example.invalid/signin'}});});
 assert.equal(r.code,'DATA_PROVIDER_REDIRECT');assert.equal(calls,1);assert.deepEqual(r.bars,[]);
});
