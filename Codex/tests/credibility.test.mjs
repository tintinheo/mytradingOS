import test from 'node:test';
import assert from 'node:assert/strict';
import {finalRecommendation,dataQualityResult} from '../public/lab/credibility.mjs';
const rows=Array.from({length:180},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:100,high:101,low:99,close:100,volume:1000}));
const quality={researchReady:true,freshness:'fresh',crossSourceReady:true,issues:[],reconciliation:{status:'MATCHED',upstreamIndependence:'unknown'}};
const args={quality,rows,marketSignal:{buy:true,entryEligible:true},validation:{qualified:true},priceRisk:{latest:{blockEntry:false}},forecast:{hasBand:true,lower:95,upper:105},calibration:{qualified:true,probability:.7},personalPlan:{status:'CONDITIONAL_PLAN',rewardRisk:2},features:{avgVol:1000000}};
test('Unknown upstream lineage cannot masquerade as independent-source verification',()=>{assert.equal(dataQualityResult(quality,rows).eligible,false);assert.equal(finalRecommendation(args).state,'NO SIGNAL');});
test('SIG-01/03/04/07: each critical gate independently abstains',()=>{
 const good={...args,quality:{...quality,reconciliation:{status:'MATCHED',upstreamIndependence:'verified'}}};assert.equal(finalRecommendation(good).state,'BUY');
 for(const changed of [{rows:rows.slice(0,30)},{quality:{...good.quality,freshness:'stale'}},{quality:{...good.quality,crossSourceReady:false}},{calibration:null},{validation:{qualified:false}},{priceRisk:{latest:{blockEntry:true}}},{forecast:{hasBand:true,lower:50,upper:150}}])assert.equal(finalRecommendation({...good,...changed}).state,'NO SIGNAL');
});
test('SIG-02/06: conflict and inadequate reward/risk cannot produce BUY',()=>{
 const good={...args,quality:{...quality,reconciliation:{status:'MATCHED',upstreamIndependence:'verified'}}};
 assert.equal(finalRecommendation({...good,marketSignal:{buy:true,sell:true}}).state,'WATCH');
 assert.equal(finalRecommendation({...good,personalPlan:{status:'CONDITIONAL_PLAN',rewardRisk:1}}).state,'WATCH');
});

test('AUD-02: complete snapshot recomputes identically from its frozen evidence',async()=>{
 const {buildSnapshot}=await import('../public/lab/recommendation.mjs');const {demoBars,withDefaults}=await import('../public/lab/core.mjs');const {sha256}=await import('../lib/hashes.mjs');
 const s=buildSnapshot({symbol:'LAB1',rows:demoBars(),parameters:withDefaults({}),forecastMethod:'momentum',horizon:5,source:'csv',metadata:{source:'synthetic'},now:'2026-10-05T00:00:00Z'});
 const replay=buildSnapshot({symbol:s.symbol,rows:s.inputBars,parameters:s.parameters,forecastMethod:s.forecastMethod,horizon:s.horizon,source:s.source,metadata:s.metadata,now:s.calculatedAt,reconciliation:s.quality.reconciliation});
 assert.equal(await sha256(s),await sha256(replay));assert.equal(s.recommendation.state,'NO SIGNAL');
});
