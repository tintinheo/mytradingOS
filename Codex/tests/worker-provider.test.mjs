import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));

test('Daily capture runs with native Cloudflare Request semantics (v12 redirect regression)',async()=>{
 const {outputFiles}=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),contents:`
  import {captureSource} from './lib/source-capture.mjs';
  export default {async fetch(){
   let calls=0;
   const captured=await captureSource('dnse',{symbol:'FPT',from:'2026-09-28',to:'2026-09-30'},async(url,options)=>{
    // Node accepts redirect:error, but the deployed Workers runtime rejects it.
    new Request(url,options);calls++;
    return Response.json({t:[1790557200,1790643600],o:[10,10],h:[11,11],l:[9,9],c:[10,10],v:[100,100]});
   });
   return Response.json({calls,captured});
  }};
 `},bundle:true,format:'esm',platform:'browser',write:false});
 // Match the published Worker's compatibility date and flags.
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],script:outputFiles[0].text});
 try{
  const response=await mf.dispatchFetch('http://localhost/'),{calls,captured}=await response.json();
  assert.equal(captured.status,'ok',captured.error);assert.equal(calls,1);
  assert.equal(captured.bars.length,2);assert.match(captured.rawHash,/^[a-f0-9]{64}$/);
 }finally{await mf.dispose();}
});
