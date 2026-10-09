import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDnseUrl,buildCafeUrl,normalizeDnse,normalizeCafe} from '../lib/ohlcv.ts';
import {normalizeDnseClient} from '../public/lab/core.mjs';

test('DNSE compact arrays normalize and reject broken bar shapes',()=>{
  const input={t:[1750032000,1750118400],o:[10,11],h:[11,12],l:[9,10],c:[10.5,11.4],v:[200,300]};
  assert.equal(normalizeDnse(input)[0].volume,200);
  assert.deepEqual(normalizeDnseClient(input),normalizeDnse(input));
  assert.throws(()=>normalizeDnse({...input,h:[9,9]}),/Invalid OHLCV/);
  assert.throws(()=>normalizeDnseClient({...input,t:[1750032000,1750032000]}),/Duplicate/);
});

test('CafeF records normalize with date and matched volume',()=>{
  const input={Data:{Data:[{Ngay:'01/09/2026',GiaMoCua:100,GiaCaoNhat:105,GiaThapNhat:98,GiaDongCua:103,KhoiLuongKhopLenh:123456}]}};
  assert.deepEqual(normalizeCafe(input),[{date:'2026-09-01',open:100,high:105,low:98,close:103,volume:123456}]);
});

test('provider builders use fixed hosts and encode symbol and range',()=>{
  const dnse=new URL(buildDnseUrl('FPT','2026-01-01','2026-01-31'));
  const cafe=new URL(buildCafeUrl('FPT','2026-01-01','2026-01-31'));
  assert.equal(dnse.hostname,'api.dnse.com.vn');
  assert.equal(dnse.searchParams.get('resolution'),'1D');
  assert.equal(cafe.searchParams.get('Symbol'),'FPT');
  assert.equal(cafe.searchParams.get('PageSize'),'31');
});
