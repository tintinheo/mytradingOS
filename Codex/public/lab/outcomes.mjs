import {probabilityMetrics} from './calibration.mjs';
import {technicalSeries} from './vn-market.mjs';

export function observationFromSnapshot(s){
  const context=s.metadata.marketContext,calendar=context?.calendar||[],origin=calendar.indexOf(s.asOf),targetDate=origin>=0?calendar[origin+s.horizon]:null;
  const eligible=s.source!=='csv'&&s.quality?.freshness==='fresh'&&s.quality?.researchReady&&!!targetDate;
  return {ensemble:s.ensembleEvidence?{probability:s.ensembleEvidence.candidateProbability,forecast:s.ensembleEvidence.forecast,version:s.ensembleEvidence.policy.version}:null,schemaVersion:1,symbol:s.symbol,originDate:s.asOf,targetDate:targetDate||null,horizon:s.horizon,source:s.source,engineVersion:s.engineVersion,recordedAt:s.calculatedAt,decision:s.decision.code,buy:s.marketSignal?.buy||false,personalPlan:s.personalPlan?.status,forecast:s.forecast,forecastMethod:s.forecastMethod,unit:context?.priceUnit,basis:context?.priceBasis,tail:s.inputBars.slice(-20),knownActions:context?.actions.filter(a=>a.knownAt<=s.asOf)||[],fees:s.parameters.fee,sellTax:s.parameters.sellTax,eligible,status:eligible?'waiting':'excluded',reason:eligible?'Chờ đủ phiên đích.':'Chỉ tính kết quả tiến cứu cho lần lấy dữ liệu hiện tại, đủ hồ sơ/lịch; CSV và lịch sử chưa đủ điều kiện được loại khỏi tổng hợp.'};
}
export function evaluateObservation(o,rows,context,source){
  if(!o.eligible)return {status:'excluded',reason:o.reason};
  if(source!==o.source||!context||context.priceUnit!==o.unit||context.priceBasis!==o.basis)return {status:'data_issue',reason:'Nguồn, đơn vị hoặc cơ sở giá khác lần phát hành; chưa so sánh.'};
  if(rows.at(-1).date<o.targetDate)return {status:'waiting',reason:`Chờ dữ liệu đến ${o.targetDate}.`};
  if(!context.actionsReviewed||context.coverage.from>o.originDate||context.coverage.to<o.targetDate||context.calendar.indexOf(o.targetDate)-context.calendar.indexOf(o.originDate)!==o.horizon)return {status:'data_issue',reason:'Hồ sơ quyền/lịch chưa bao phủ và khớp toàn kỳ đánh giá.'};
  const map=new Map(rows.map(b=>[b.date,b])),origin=map.get(o.originDate),target=map.get(o.targetDate);
  if(!origin||!target)return {status:'data_issue',reason:'Thiếu phiên gốc hoặc phiên đích chính xác; mở rộng khoảng lấy dữ liệu.'};
  if(o.tail.some(b=>!map.has(b.date)||['open','high','low','close','volume'].some(k=>Math.abs(map.get(b.date)[k]-b[k])>1e-8)))return {status:'data_issue',reason:'Lịch sử tại mốc phát hành đã bị sửa hoặc thiếu; giữ nguyên snapshot gốc, không tự tính lại dự báo.'};
  const events=context.actions.filter(a=>a.exDate>o.originDate&&a.exDate<=o.targetDate);
  const originalEvents=o.knownActions.filter(a=>a.exDate>o.originDate&&a.exDate<=o.targetDate);
  if(events.length!==originalEvents.length||events.some(a=>!originalEvents.some(k=>JSON.stringify(k)===JSON.stringify(a))))return {status:'data_issue',reason:'Có quyền mới, bị bỏ khỏi hồ sơ hoặc hệ số quyền thay đổi sau phát hành; cần đối chiếu riêng trước khi chấm sai số giá.'};
  const normalized=technicalSeries(rows,context).rows,nmap=new Map(normalized.map(b=>[b.date,b]));
  const adjustedReturnPct=(nmap.get(o.targetDate).close/nmap.get(o.originDate).close-1)*100,actual=target.close,forecast=o.forecast;
  const baseline=origin.close*(forecast?.adjustmentFactor||1),errorPct=forecast?100*Math.abs(forecast.center-actual)/origin.close:null,baselineErrorPct=100*Math.abs(baseline-actual)/origin.close;
  const ensembleBrier=Number.isFinite(o.ensemble?.probability)?(o.ensemble.probability-Number(adjustedReturnPct>0))**2:null;
  return {ensembleBrier,ensembleActual:Number(adjustedReturnPct>0),status:'evaluated',targetDate:o.targetDate,actualClose:actual,rawReturnPct:(actual/origin.close-1)*100,adjustedReturnPct,errorPct,baselineErrorPct,directionCorrect:forecast&&Math.abs(forecast.center-baseline)>1e-10?Math.sign(forecast.center-baseline)===Math.sign(actual-baseline):null,covered:forecast?.hasBand?actual>=forecast.lower&&actual<=forecast.upper:null,interpretation:'Kết quả close sau ngày phát hành; không phải lợi nhuận khớp lệnh. Tín hiệu cùng ngày/model được khử trùng khi tổng hợp.'};
}
export function summarizeObservations(records){
  const unique=new Map();for(const r of [...records].sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt))){const key=[r.config.symbol,r.config.originDate,r.config.horizon,r.config.forecastMethod,r.config.engineVersion,r.config.source].join('|');if(!unique.has(key))unique.set(key,r);}
  const chosen=[...unique.values()],done=chosen.filter(r=>r.status==='evaluated'),forecasts=done.filter(r=>Number.isFinite(r.outcome.errorPct)),bands=forecasts.filter(r=>r.outcome.covered!==null),mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const ensembleUnique=new Map();for(const r of done){const key=[r.config.symbol,r.config.originDate,r.config.horizon,r.config.engineVersion,r.config.source].join('|');if(Number.isFinite(r.config.ensemble?.probability)&&Number.isFinite(r.outcome.ensembleBrier)&&!ensembleUnique.has(key))ensembleUnique.set(key,{probability:r.config.ensemble.probability,actual:r.outcome.ensembleActual});}
  const ensembleCalibration=probabilityMetrics([...ensembleUnique.values()]);
  return {ensembleCalibration,unique:chosen.length,duplicates:records.length-chosen.length,evaluated:done.length,waiting:chosen.filter(r=>r.status==='waiting').length,dataIssues:chosen.filter(r=>r.status==='data_issue').length,excluded:chosen.filter(r=>r.status==='excluded').length,forecastN:forecasts.length,maePct:mean(forecasts.map(r=>r.outcome.errorPct)),baselineMaePct:mean(forecasts.map(r=>r.outcome.baselineErrorPct)),coveragePct:bands.length?100*mean(bands.map(r=>Number(r.outcome.covered))):null,coverageN:bands.length,minimumReached:forecasts.length>=30,interpretation:'Trong tập đang xem, lấy lần phát hành đầu tiên cho mỗi mã/ngày/horizon/model/engine/nguồn; chỉ tổng hợp mẫu đã đủ kỳ. Các mẫu có thể chồng chân trời, không xem là độc lập.'};
}
