import {backtest} from './core.mjs';
import {indicators,mean,quantile} from './swing.mjs';
import {technicalSeries} from './vn-market.mjs';

export const VALIDATION_PROTOCOL={version:'fixed-walk-forward-2026.10.04.1',warmup:120,foldSessions:60,maxFolds:5,minFolds:3,minClosedTrades:20};
function closedRounds(r){
  const map=new Map();for(const t of r.trades){if(r.entry?.date===t.entryDate)continue;const a=map.get(t.entryDate)||{cost:0,profit:0};const cost=t.costVnd??1;a.cost+=cost;a.profit+=cost*t.net;map.set(t.entryDate,a);}return [...map.values()].map(t=>t.profit/t.cost);
}
// Deterministic block resampling for a descriptive interval; not a significance test.
export function expectancyInterval(values){
  if(values.length<20)return null;let state=41971;const rand=()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;},means=[];
  for(let b=0;b<300;b++){const sample=[];while(sample.length<values.length){const i=Math.floor(rand()*values.length);for(let j=0;j<3&&sample.length<values.length;j++)sample.push(values[(i+j)%values.length]);}means.push(mean(sample)*100);}return {lower:quantile(means,.025),upper:quantile(means,.975),method:'Block bootstrap 3 lệnh; 300 mẫu; khoảng mô tả 95%'};
}
export function riskAdjustedMetrics(equity){
  const returns=equity.slice(1).map((b,i)=>b.value/equity[i].value-1);
  if(returns.length<2)return {sharpe:null,sortino:null};
  const avg=mean(returns),variance=mean(returns.map(x=>(x-avg)**2)),downside=mean(returns.map(x=>Math.min(0,x)**2));
  return {sharpe:variance>0?Math.sqrt(252)*avg/Math.sqrt(variance):null,sortino:downside>0?Math.sqrt(252)*avg/Math.sqrt(downside):null,annualization:252,riskFree:0};
}
export function strategyValidation(rows,p,context,quality){
  const protocol=VALIDATION_PROTOCOL,warmup=Math.max(protocol.warmup,p.slow+1),n=Math.min(protocol.maxFolds,Math.floor((rows.length-warmup)/protocol.foldSessions));
  const limits=['Tham số cố định do người dùng chọn; không tối ưu trong từng fold. Đổi tham số sau khi xem kết quả vẫn có thể gây overfit.','Mỗi fold bắt đầu bằng tiền mặt sau warmup; vị thế cuối fold định giá close, chưa giả định khớp thanh lý.','Các fold không trùng đích nhưng không bảo đảm độc lập thống kê. Khoảng bootstrap không chứng minh lợi thế tương lai.'];
  if(n<1)return {protocol,status:'INSUFFICIENT',qualified:false,folds:[],closedTrades:0,limits,reason:`Cần ít nhất ${warmup+protocol.foldSessions} phiên để có một fold.`};
  if(context?.priceBasis==='raw'&&context.actions.some(a=>a.exDate>=rows[0].date&&a.exDate<=rows.at(-1).date)&&p.execution!=='vn')return {protocol,status:'DATA_REQUIRED',qualified:false,folds:[],closedTrades:0,limits,reason:'Giá raw có quyền cần mô hình VN đầy đủ để kiểm định dòng tiền.'};
  const folds=[],rounds=[],features=indicators(technicalSeries(rows,context).rows);let failure=null;
  for(let k=0;k<n;k++){
    const start=rows.length-(n-k)*protocol.foldSessions,end=start+protocol.foldSessions-1,prefix=rows.slice(0,end+1),config={...p,tradeFromDate:rows[start].date};
    try{
      const result=backtest(prefix,config,context),off=backtest(prefix,{...config,trapFilter:'off'},context),on=backtest(prefix,{...config,trapFilter:'high'},context),stress=backtest(prefix,{...config,fee:Math.min(5,p.fee*2+.1)},context);
      const closed=closedRounds(result);rounds.push(...closed);
      const regimePerformance={};const byDate=new Map(rows.map((b,i)=>[b.date,i]));
      for(let j=1;j<result.equity.length;j++){const b=result.equity[j],i=byDate.get(b.date);if(b.date<rows[start].date)continue;const regime=features[Math.max(0,i-1)]?.regime||'unknown';(regimePerformance[regime]??=[]).push(b.value/result.equity[j-1].value-1);}
      const regimeMetrics=Object.fromEntries(Object.entries(regimePerformance).map(([regime,returns])=>[regime,{sessions:returns.length,meanDailyReturnPct:100*mean(returns),positiveSessionRate:returns.filter(x=>x>0).length/returns.length}]));
      const regimes={};for(const f of features.slice(start,end+1))regimes[f.regime]=(regimes[f.regime]||0)+1;
      folds.push({...riskAdjustedMetrics(result.equity.filter(b=>b.date>=rows[start].date)),regimeMetrics,hitRate:closed.length?closed.filter(x=>x>0).length/closed.length:null,expectancyPct:closed.length?mean(closed)*100:null,from:rows[start].date,to:rows[end].date,regimes,returnPct:result.returnPct,benchmarkPct:result.buyHoldPct,maxDrawdownPct:result.maxDrawdownPct,closedTrades:closed.length,openAtEnd:result.openPosition,filterOnReturnPct:on.returnPct,filterOffReturnPct:off.returnPct,filterOnDrawdownPct:on.maxDrawdownPct,filterOffDrawdownPct:off.maxDrawdownPct,stressedReturnPct:stress.returnPct});
    }catch(e){failure=e.message;break;}
  }
  if(failure)return {protocol,status:'DATA_REQUIRED',qualified:false,folds,closedTrades:rounds.length,limits,reason:failure};
  const positive=rounds.filter(x=>x>0),negative=rounds.filter(x=>x<0),loss=-negative.reduce((a,b)=>a+b,0),profitFactor=loss?positive.reduce((a,b)=>a+b,0)/loss:null,interval=expectancyInterval(rounds);
  const enough=folds.length>=protocol.minFolds&&rounds.length>=protocol.minClosedTrades;
  const metrics={hitRate:rounds.length?positive.length/rounds.length:null,averageGainPct:positive.length?mean(positive)*100:null,averageLossPct:negative.length?mean(negative)*100:null,maxDrawdownPct:Math.max(...folds.map(f=>f.maxDrawdownPct)),closedTrades:rounds.length,expectancyPct:rounds.length?mean(rounds)*100:null,profitFactor,positiveFolds:folds.filter(f=>f.returnPct>0).length,meanFoldReturnPct:mean(folds.map(f=>f.returnPct)),meanBenchmarkPct:mean(folds.map(f=>f.benchmarkPct)),meanStressReturnPct:mean(folds.map(f=>f.stressedReturnPct)),interval};
  const regimeTotals={};for(const f of folds)for(const [k,n] of Object.entries(f.regimes))regimeTotals[k]=(regimeTotals[k]||0)+n;const regimeBreadth=Object.entries(regimeTotals).filter(([k,n])=>k!=='unknown'&&n>=15).length;
  const dataReady=!!quality?.researchReady&&quality?.crossSourceReady===true&&quality?.reconciliation?.upstreamIndependence==='verified';
  const qualified=regimeBreadth>=2&&dataReady&&enough&&metrics.meanFoldReturnPct>metrics.meanBenchmarkPct&&metrics.meanStressReturnPct>0&&metrics.positiveFolds/folds.length>=.6&&interval?.lower>0;
  const status=!dataReady?'UNVERIFIED_DATA':!enough?'INSUFFICIENT':qualified?'PRELIMINARY_SUPPORT':'NO_CLEAR_EDGE';
  return {protocol,status,qualified,folds,...metrics,regimeTotals,regimeBreadth,limits,reason:!dataReady?'Cần dữ liệu đủ hồ sơ và bản đối chiếu đa nguồn khớp toàn mẫu trước khi đánh giá độ tin cậy.':!enough?'Cần ít nhất 3 fold và 20 vòng giao dịch đã đóng.':qualified?'Đạt tiêu chí nghiên cứu sơ bộ; vẫn cần theo dõi tín hiệu phát hành thực tế.':'Chưa đạt đồng thời các tiêu chí lợi suất, chi phí tăng, tính ổn định và khoảng expectancy.'};
}
