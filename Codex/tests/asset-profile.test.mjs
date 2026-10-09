import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMarket,assetProfile} from '../public/lab/asset-profile.mjs';
import {riskAdjustedMetrics} from '../public/lab/validation.mjs';
const make=f=>Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),close:f(i),open:f(i),high:f(i)+1,low:f(i)-1,volume:1000}));
test('ML-04/05/06: market regime uses index history available at origin',()=>{
 for(const [f,state] of [[i=>100+i,'BULL'],[i=>200-i,'BEAR']]){const r=make(f);assert.equal(classifyMarket(r,r.at(-1).date).state,state);}
 const r=make(()=>100);assert.equal(classifyMarket(r,r.at(-1).date).state,'SIDEWAYS');assert.equal(classifyMarket([],r.at(-1).date).state,'UNKNOWN');
 assert.equal(classifyMarket([...r,{date:'2099-01-01',close:1}],r.at(-1).date).state,'SIDEWAYS');
});
test('Asset profile respects units and computes beta on aligned observations',()=>{const r=make(i=>100+i+Math.sin(i));const p=assetProfile(r,{priceUnit:'thousand-VND',sector:'Test',benchmarks:{market:r}});assert.ok(Math.abs(p.beta-1)<1e-10);assert.ok(p.avgTurnoverVnd20>100000000);assert.equal(assetProfile(r,null).beta,null);});
test('Risk-adjusted metrics return null for zero variance rather than fabricated infinity',()=>{assert.equal(riskAdjustedMetrics([{value:100},{value:100},{value:100}]).sharpe,null);assert.ok(Number.isFinite(riskAdjustedMetrics([{value:100},{value:101},{value:99}]).sortino));});
