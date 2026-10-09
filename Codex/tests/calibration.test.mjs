import test from 'node:test';
import assert from 'node:assert/strict';
import {ensembleAt,evaluateEnsemble,probabilityMetrics,assertAvailable} from '../public/lab/calibration.mjs';
const rows=Array.from({length:720},(_,i)=>{const c=100+Math.sin(i/8)*5+i*.01;return {date:new Date(Date.UTC(2022,0,1+i)).toISOString().slice(0,10),open:c,high:c+1,low:c-1,close:c,volume:100000};});
test('ML-03: Brier and ECE match hand calculation and invalid probabilities fail',()=>{
 const m=probabilityMetrics([{probability:.8,actual:1},{probability:.8,actual:0}]);assert.ok(Math.abs(m.brier-.34)<1e-10);assert.ok(Math.abs(m.ece-.3)<1e-10);
 assert.throws(()=>probabilityMetrics([{probability:NaN,actual:1}]));
});
test('BT-02/ML-02: ensemble is prefix-stable; declared future features are rejected',()=>{
 const before=ensembleAt(rows,300,5),changed=rows.map((b,i)=>i>300?{...b,close:b.close*10}:b);assert.deepEqual(ensembleAt(changed,300,5),before);
 assert.throws(()=>assertAvailable([{value:1,availableAt:301}],300),/TEMPORAL_LEAKAGE/);assert.doesNotThrow(()=>assertAvailable([{value:1,availableAt:300}],300));
});
test('BT-07/08: calibration labels mature before test, test outcomes cannot alter fitted bins',()=>{
 const e=evaluateEnsemble(rows,5);assert.equal(e.calibrationN,60);assert.ok(e.split.calibrationThrough<=e.split.testFrom);
 for(let i=1;i<e.observations.length;i++)assert.ok(e.observations[i-1].target<=e.observations[i].origin);
 const shock=rows.map((b,i)=>i>450?{...b,close:b.close*(1+i/1000)}:b);assert.deepEqual(evaluateEnsemble(shock,5).bins,e.bins);
 assert.ok(e.forecast.lower<=e.forecast.center&&e.forecast.center<=e.forecast.upper);
});
test('ML-01: shuffled labels remove a deliberately perfect synthetic predictor advantage',()=>{
 const x=Array.from({length:200},(_,i)=>({probability:i%2?.9:.1,actual:i%2}));const original=probabilityMetrics(x).brier;
 let seed=7;const labels=x.map(o=>o.actual);for(let i=labels.length-1;i>0;i--){seed=(seed*1664525+1013904223)>>>0;const j=seed%(i+1);[labels[i],labels[j]]=[labels[j],labels[i]];}
 const shuffled=probabilityMetrics(x.map((o,i)=>({...o,actual:labels[i]})));assert.ok(original<.02);assert.ok(shuffled.brier>.25);
});
test('SIG-01: short history cannot produce calibrated confidence',()=>{const e=evaluateEnsemble(rows.slice(0,180),5);assert.equal(e.qualified,false);assert.equal(e.probability,null);});

test('Model evidence remains deterministic and scale invariant',()=>{const a=evaluateEnsemble(rows,5),b=evaluateEnsemble(rows.map(x=>({...x,open:x.open*1000,high:x.high*1000,low:x.low*1000,close:x.close*1000})),5);assert.deepEqual(a.metrics,b.metrics);assert.deepEqual(a.bins,b.bins);assert.ok(Math.abs(a.forecast.center*1000-b.forecast.center)<1e-7);assert.deepEqual(evaluateEnsemble(rows,5),a);});
