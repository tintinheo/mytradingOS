import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDnse,normalizeCafe} from '../lib/ohlcv.ts';
import {normalizeDnseClient} from '../public/lab/core.mjs';
import {captureSource} from '../lib/source-capture.mjs';
import {loadHistory} from '../lib/history-service.mjs';
const day='2026-09-29';
const dnse=(value=100,stamp=1790643600)=>({t:[stamp],o:[10],h:[11],l:[9],c:[10],v:[value]});
const cafe=(value=100,stamp='29/09/2026')=>({Data:{Data:[{Ngay:stamp,GiaMoCua:10,GiaCaoNhat:11,GiaThapNhat:9,GiaDongCua:10,KhoiLuongKhopLenh:value}]}});

test('OHLCV schema rejects container coercion and non-decimal numeric strings in both adapters and browser',()=>{
 for(const bad of [[],[100],{},true,null,'',' ','0x64','0b1100100','1e2','Infinity']){
  assert.throws(()=>normalizeDnse(dnse(bad)),`DNSE accepted ${JSON.stringify(bad)}`);
  assert.throws(()=>normalizeDnseClient(dnse(bad)),`browser accepted ${JSON.stringify(bad)}`);
  assert.throws(()=>normalizeCafe(cafe(bad)),`CafeF accepted ${JSON.stringify(bad)}`);
 }
 for(const good of [0,100,'100',' 100.0 ']){
  assert.equal(normalizeDnse(dnse(good))[0].volume,Number(good));
  assert.deepEqual(normalizeDnseClient(dnse(good)),normalizeDnse(dnse(good)));
  assert.equal(normalizeCafe(cafe(good))[0].volume,Number(good));
 }
});
test('Provider session dates reject invalid suffixes, rollover days and ambiguous local timestamps',()=>{
 for(const stamp of ['2026-09-29garbage','2026-02-30','2026-02-30T00:00:00Z','2026-09-29T12:00:00','2026-09-29T25:00:00Z',null,true,[],[1790643600]]){
  assert.throws(()=>normalizeDnse(dnse(100,stamp)),`server accepted ${JSON.stringify(stamp)}`);
  assert.throws(()=>normalizeDnseClient(dnse(100,stamp)),`browser accepted ${JSON.stringify(stamp)}`);
  assert.throws(()=>normalizeCafe(cafe(100,stamp)),`CafeF accepted ${JSON.stringify(stamp)}`);
 }
});
test('Equivalent timestamp representations resolve to the same Vietnam session before duplicate checks',()=>{
 for(const stamp of [1790643600,1790643600000,day,'29/09/2026','2026-09-28T17:00:00Z','2026-09-29T00:00:00+07:00']){
  assert.equal(normalizeDnse(dnse(100,stamp))[0].date,day);
  assert.deepEqual(normalizeDnseClient(dnse(100,stamp)),normalizeDnse(dnse(100,stamp)));
 }
 const duplicate={t:['2026-09-28T17:00:00Z',day],o:[10,10],h:[11,11],l:[9,9],c:[10,10],v:[100,100]};
 assert.throws(()=>normalizeDnse(duplicate),/Duplicate/);
 assert.throws(()=>normalizeDnseClient(duplicate),/Duplicate/);
});
test('Malformed numeric OHLCV triggers typed acquisition failure, fallback and NO SIGNAL',async()=>{
 const calls=[];
 const args={symbol:'FPT',from:'2026-09-28',to:'2026-09-30'};
 const invalid={t:[1790557200,1790643600],o:[10,10],h:[11,11],l:[9,9],c:[10,10],v:[[],100]};
 const result=await loadHistory('dnse',args,(p,a)=>captureSource(p,a,async()=>{calls.push(p);return p==='dnse'?Response.json(invalid):new Response('',{status:503});}));
 assert.deepEqual(calls,['dnse','cafef']);assert.equal(result.primaryCode,'DATA_PROVIDER_SCHEMA_ERROR');
 assert.equal(result.dataQuality.status,'UNAVAILABLE');assert.equal(result.recommendation,'NO SIGNAL');assert.deepEqual(result.bars,[]);
 assert.match(result.captures[0].rawHash,/^[a-f0-9]{64}$/);
});
