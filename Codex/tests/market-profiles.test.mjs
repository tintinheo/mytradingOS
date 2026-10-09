import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {MarketProfileService} from '../lib/market-profile-service.mjs';
import {AuditService} from '../lib/audit-service.mjs';
import {demoBars,withDefaults} from '../public/lab/core.mjs';
import {buildSnapshot} from '../public/lab/recommendation.mjs';
import {renderMarketRisk} from '../public/lab/risk-ui.mjs';
const example=JSON.parse(readFileSync(new URL('../public/lab/market-context-example.json',import.meta.url),'utf8'));
function services(){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const db={prepare(sql){return {bind(...args){const q=sqlite.prepare(sql);return {async first(){return q.get(...args)||null;},async all(){return {results:q.all(...args)};},async run(){return q.run(...args);}};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return {profiles:new MarketProfileService(db),audit:new AuditService(db)};
}
const p=withDefaults({strategy:'pullback',fast:10,slow:30,lookback:20,stop:7,target:18,risk:1,fee:.25,volumeFilter:0,stopMode:'atr'});
test('Imported market profiles persist per user, validate atomically, and never rewrite archived inputs',async()=>{
  const {profiles,audit}=services();
  await profiles.save('owner',JSON.stringify(example));assert.equal((await profiles.list('owner')).profiles.length,1);assert.equal((await profiles.list('other')).profiles.length,0);
  const context=(await profiles.list('owner')).profiles[0].context,rows=demoBars(),id=crypto.randomUUID();
  await audit.mutate('owner',{action:'start',id,mode:'single',origin:'manual',source:'csv',symbols:['LAB1'],settings:{parameters:p,forecastMethod:'none',horizon:5,from:rows[0].date,to:rows.at(-1).date}});
  const first=await audit.mutate('owner',{action:'result',id,symbol:'LAB1',rows,metadata:{source:'CSV',marketContext:context}});
  const updated=structuredClone(example);updated.securities[0].source='Changed source';await profiles.save('owner',JSON.stringify(updated));
  const archived=await audit.detail('owner',id,true);assert.equal(archived.results[0].snapshot.metadata.marketContext.source,context.source);assert.equal(archived.results[0].payloadHash,first.result.payloadHash);
  await profiles.remove('other','LAB1');assert.equal((await profiles.list('owner')).profiles.length,1);
  const bad=structuredClone(updated);bad.securities.push({...bad.securities[0],symbol:'ZZ1',calendar:['invalid']});
  await assert.rejects(()=>profiles.save('owner',JSON.stringify(bad)),/ngày/);assert.equal((await profiles.list('owner')).profiles.length,1);
  await profiles.remove('owner','LAB1');assert.equal((await profiles.list('owner')).profiles.length,0);assert.equal((await audit.detail('owner',id)).results.length,1);
});
test('Risk and market rendering works with absent metadata and escapes imported source text',()=>{
  const nodes=new Map(['price-risk-content','market-content'].map(id=>[id,{innerHTML:''}]));globalThis.document={getElementById:id=>nodes.get(id)};
  try{
    const snapshot=buildSnapshot({symbol:'LAB1',rows:demoBars(),parameters:p,source:'csv'});renderMarketRisk(snapshot);
    assert.match(nodes.get('price-risk-content').innerHTML,/Điểm không phải xác suất/);assert.match(nodes.get('market-content').innerHTML,/Chưa có \/ chưa đủ/);
    snapshot.market.source='<img src=x onerror=alert(1)>';renderMarketRisk(snapshot);assert.ok(!nodes.get('market-content').innerHTML.includes('<img'));assert.match(nodes.get('market-content').innerHTML,/&lt;img/);
  }finally{delete globalThis.document;}
});
