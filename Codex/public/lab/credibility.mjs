export const FINAL_DECISION_NAMES={'STRONG BUY':'STRONG BUY',BUY:'BUY',WATCH:'WATCH',HOLD:'HOLD',REDUCE:'REDUCE',SELL:'SELL','NO SIGNAL':'NO SIGNAL'};
export const CREDIBILITY_POLICY={version:'credibility-2026.10.05.1',minimumHistory:180,maximumIntervalPct:20,minimumRewardRisk:1.5};
// Scores count checks; they are never described as probabilities.
export function dataQualityResult(quality,rows){
 const dates=rows.map(b=>b.date),duplicateSessions=[...new Set(dates.filter((d,i)=>dates.indexOf(d)!==i))];
 const invalidOhlcv=rows.filter(b=>![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||Math.min(b.open,b.high,b.low,b.close)<=0||b.volume<0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)).map(b=>b.date);
 const ohlcConsistency=invalidOhlcv.length===0;
 const reconciliation=quality.reconciliation||{},integrity=quality.researchReady===true&&ohlcConsistency&&!duplicateSessions.length,fresh=quality.freshness==='fresh',matched=quality.crossSourceReady===true;
 const independent=matched&&reconciliation.upstreamIndependence==='verified';
 const checks={history:rows.length>=CREDIBILITY_POLICY.minimumHistory,integrity,freshness:fresh,reconciliation:matched,independentOrigin:independent};
 const status=reconciliation.status==='UNAVAILABLE'?'UNAVAILABLE':!ohlcConsistency||duplicateSessions.length>0||reconciliation.blocking||reconciliation.priceDisagreement>0||reconciliation.volumeDisagreement>0||['stale','incomplete'].includes(quality.freshness)||quality.issues.some(i=>['JUMPS','GAPS','UNMODELED_ACTION','CALENDAR_CONFLICT'].includes(i.code))?'QUARANTINED':Object.values(checks).every(Boolean)?'VERIFIED':'WARNING';
 const code=status==='UNAVAILABLE'?'DATA_UNAVAILABLE':quality.freshness==='stale'?'DATA_STALE':reconciliation.blocking||reconciliation.priceDisagreement>0||reconciliation.volumeDisagreement>0?'DATA_SOURCE_MISMATCH':!ohlcConsistency||duplicateSessions.length?'DATA_PROVIDER_SCHEMA_ERROR':null;
 return {status,code,freshness:quality.freshness,duplicateSessions,ohlcConsistency,invalidOhlcv,priceDisagreement:reconciliation.priceDisagreement??null,volumeDisagreement:reconciliation.volumeDisagreement??null,comparisonDetails:reconciliation.comparisonDetails||[],score:20*Object.values(checks).filter(Boolean).length,scoreMeaning:'Checklist completeness / 100; not a probability of correct data.',checks,eligible:status==='VERIFIED',missingSessions:quality.issues.find(i=>i.code==='GAPS')?.dates||[],latestSession:quality.last,expectedSession:quality.expected,sourceNames:reconciliation.sourceNames||[],corporateActionWarnings:quality.issues.filter(i=>['ACTIONS','UNMODELED_ACTION','CALENDAR_CONFLICT'].includes(i.code)),upstreamIndependence:reconciliation.upstreamIndependence||'unknown'};
}
export function finalRecommendation({quality,rows,marketSignal,validation,priceRisk,forecast,calibration,personalPlan,features,asset}){
 const policy=CREDIBILITY_POLICY,data=dataQualityResult(quality,rows),reasons=[];
 if(!data.eligible)reasons.push('DATA_GATE: Cần dữ liệu mới, hồ sơ đầy đủ và nguồn gốc độc lập được xác minh.');
 if(!validation.qualified)reasons.push('OOS_GATE: Chưa đạt kiểm định chiến lược ngoài mẫu.');
 if(!calibration?.qualified)reasons.push('CALIBRATION_GATE: Chưa đủ bằng chứng hiệu chuẩn ngoài mẫu.');
 if(rows.length<policy.minimumHistory)reasons.push('HISTORY_GATE: Chưa đủ 180 phiên.');
 if(priceRisk.latest.blockEntry)reasons.push('TRAP_GATE: Rủi ro giá cao; tạm ngừng khuyến nghị.');
 const width=forecast?.hasBand?100*(forecast.upper-forecast.lower)/rows.at(-1).close:null;
 if(width===null||!Number.isFinite(width)||width>policy.maximumIntervalPct)reasons.push('UNCERTAINTY_GATE: Dải dự báo thiếu hoặc quá rộng.');
 if(!Number.isFinite(features.avgVol)||features.avgVol<=0)reasons.push('LIQUIDITY_GATE: Không đủ dữ liệu thanh khoản.');
 if(asset&&(asset.marketRegime.state==='UNKNOWN'||asset.marketRegime.stale))reasons.push('REGIME_GATE: Thiếu chỉ số thị trường đúng phiên.');
 if(asset?.marketRegime.volatility==='HIGH_VOLATILITY')reasons.push('REGIME_GATE: Biến động thị trường cao, cần đánh giá riêng.');
 let state='NO SIGNAL';
 if(!reasons.length){
   if(marketSignal.buy&&marketSignal.sell||marketSignal.forecastConflict)state='WATCH';
   else if(marketSignal.sell)state=personalPlan.holding&&personalPlan.quantity>0?'SELL':'WATCH';
   else if(marketSignal.buy){if(!marketSignal.entryEligible||personalPlan.status!=='CONDITIONAL_PLAN'||!(personalPlan.rewardRisk>=policy.minimumRewardRisk))state='WATCH';else state='BUY';}
   else state=personalPlan.holding?'HOLD':'WATCH';
 }
 return {policy,state,supportedStates:['STRONG BUY','BUY','WATCH','HOLD','REDUCE','SELL','NO SIGNAL'],reason:reasons.join(' ')||'Đối chiếu điều kiện giá và danh mục trước quyết định.',reasons,dataQuality:data,modelConfidence:calibration?.qualified?calibration.probability:null,finalConfidence:state==='NO SIGNAL'?null:calibration?.qualified?calibration.probability:null,confidenceMeaning:'Probability of an upward horizon close, not probability of profitable execution.',intervalWidthPct:width,entryZone:state==='BUY'?personalPlan.entryRangeVnd:null,target:state==='BUY'?personalPlan.targetVnd:null,stop:state==='BUY'?personalPlan.stopVnd:null,classification:'EXPERIMENTAL'};
}
