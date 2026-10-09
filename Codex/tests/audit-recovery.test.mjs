import test from 'node:test';
import assert from 'node:assert/strict';

test('A permanent audit error can be exported and cleared, then a new run starts',async()=>{
 const nodes=new Map(),listeners=new Map();let exported=false;
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,classList:{toggle(){}},addEventListener(type,fn){listeners.set(id+':'+type,fn);}});return nodes.get(id);};
 globalThis.document={getElementById:get,createElement(){return {click(){exported=true;}};}};globalThis.window={addEventListener(){}};
 globalThis.fetch=async(url,options={})=>{
  if(String(url).includes('draftScope'))return Response.json({scope:'account-test'});
  if(!options.body)return Response.json({runs:[],nextCursor:null});
  const p=JSON.parse(options.body);
  if(p.action==='result')return Response.json({error:'Snapshot too large'},{status:413});
  return Response.json({run:{id:p.id,status:p.action==='finish'?'cancelled':'running',settings:{}}});
 };
 try{
  const audit=await import('../public/lab/audit-ui.mjs');await audit.initAudit();const first=await audit.beginAudit({});await audit.saveAuditResult(first.id,'LAB1',[],{});
  assert.equal(audit.hasPendingAudit(),true);await assert.rejects(()=>audit.beginAudit({}),/bản nháp/);
  await listeners.get('audit-discard-pending:click')();assert.equal(audit.hasPendingAudit(),true);
  listeners.get('audit-export-pending:click')();assert.equal(exported,true);await listeners.get('audit-discard-pending:click')();assert.equal(audit.hasPendingAudit(),false);
  const second=await audit.beginAudit({});assert.notEqual(second.id,first.id);
 }finally{delete globalThis.document;delete globalThis.window;delete globalThis.fetch;}
});

test('UI: structured acquisition evidence survives save failure and explicit audit retry',async()=>{
 const nodes=new Map(),listeners=new Map(),sent=[];let accept=false;
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,classList:{toggle(){}},addEventListener(type,fn){listeners.set(id+':'+type,fn);}});return nodes.get(id);};
 globalThis.document={getElementById:get};globalThis.window={addEventListener(){}};
 globalThis.fetch=async(url,options={})=>{
   if(String(url).includes('draftScope'))return Response.json({scope:'account-test'});
   if(!options.body)return Response.json({runs:[],nextCursor:null});
   const p=JSON.parse(options.body);if(p.action==='result'){sent.push(p);return accept?Response.json({result:{snapshot:{}}}):Response.json({error:'Audit temporarily unavailable'},{status:503});}
   return Response.json({run:{id:p.id,status:'running',settings:{}}});
 };
 try{
   const audit=await import('../public/lab/audit-ui.mjs');await audit.initAudit();const run=await audit.beginAudit({});
   const error=new Error('DATA_UNAVAILABLE: no trustworthy data');error.acquisitionFailure={version:'acquisition-failure-1',captures:[{code:'DATA_PROVIDER_HTML_RESPONSE'}]};
   await audit.saveAuditResult(run.id,'FPT',null,null,error);assert.equal(audit.hasPendingAudit(),true);
   assert.deepEqual(sent[0].acquisitionFailure,error.acquisitionFailure);assert.equal(sent[0].error,error.message);
   accept=true;await listeners.get('audit-retry:click')();assert.equal(audit.hasPendingAudit(),false);
   assert.deepEqual(sent.at(-1),sent[0]);
   // The retry handler intentionally refreshes history in the background.
   // Let that refresh finish while its browser environment still exists.
   await new Promise(resolve=>setImmediate(resolve));
 }finally{delete globalThis.document;delete globalThis.window;delete globalThis.fetch;}
});
