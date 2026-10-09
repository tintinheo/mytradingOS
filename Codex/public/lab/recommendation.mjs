import {assetProfile} from './asset-profile.mjs';
import {evaluateEnsemble} from './calibration.mjs';
import {finalRecommendation} from './credibility.mjs';
import {backtest, signals, withDefaults} from './core.mjs';
import {indicators, profile, regimeNames, modelNames, swingForecast, validateForecasts} from './swing.mjs';
import {validateMarketContext,technicalSeries,marketAssessment} from './vn-market.mjs';
import {priceRiskTimeline,evaluateRiskOutcomes} from './price-risk.mjs';
import {assessData,forecastWithActions} from './data-quality.mjs';
import {entryGeometry,buildTradePlan} from './trade-plan.mjs';
import {strategyValidation} from './validation.mjs';

export const ENGINE_VERSION = 'swing-2026.10.05-p0.2';
export const strategyNames = {pullback:'Swing pullback', confirmed:'Breakout xác nhận', range:'Hồi về trung bình', sma:'MA crossover', breakout:'Breakout cơ bản', hold:'Buy & hold'};
export const decisionNames = {BUY_CONDITION:'Điều kiện mua kỹ thuật',SELL_CONDITION:'Điều kiện thoát kỹ thuật',INVALID_PLAN:'Khoảng stop không hợp lệ',ENTRY_SIGNAL:'Theo dõi điểm mua', RESEARCH_SIGNAL:'Tín hiệu nghiên cứu', RISK_BLOCKED:'Tạm chặn mua · rủi ro giá', DATA_REQUIRED:'Cần bổ sung dữ liệu', POSITION_CONSTRAINED:'Còn lô lẻ / cổ phiếu chờ về', WAIT:'Chờ tín hiệu', HOLD:'Giữ vị thế mô phỏng', POSITION_LOCKED:'Vị thế đang khóa T+', EXIT_SIGNAL:'Có điều kiện thoát', EXIT_LOCKED:'Chờ thoát khi đủ T+', STALE:'Dữ liệu cũ', ERROR:'Không có kết quả'};
const fmt = n => Number.isFinite(n) ? n.toLocaleString('vi-VN', {maximumFractionDigits:2}) : 'chưa đủ dữ liệu';
const avg = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : NaN;
const clean = value => JSON.parse(JSON.stringify(value));

// The evidence mirrors the exact entry predicates, including the shared volume gate.
export function entryEvidence(rows, input) {
  const p=withDefaults(input), features=indicators(rows), f=features.at(-1), prev=features.at(-2), b=rows.at(-1), i=rows.length-1, checks=[];
  const add=(label,passed,detail)=>checks.push({label,passed:!!passed,detail});
  if(p.strategy==='hold') {
    add('Đối chứng mua một lần', i===0, 'Buy & hold mua một lần từ phiên thứ hai có thể khớp; không tạo điểm mua mới ở cuối mẫu.');
    return checks;
  }
  if(['pullback','confirmed','range'].includes(p.strategy)) add('Đủ lịch sử swing',i>=59,`${rows.length} phiên; yêu cầu ít nhất 60.`);
  if(p.strategy==='pullback') {
    add('Xu hướng tăng',f.regime==='up',`EMA20 ${fmt(f.ema20)}, EMA50 ${fmt(f.ema50)}, ADX14 ${fmt(f.adx)}, close ${fmt(b.close)}. Cần EMA20 > EMA50, close > EMA50 và ADX ≥25.`);
    add('RSI cắt lên 50',prev?.rsi<50&&f.rsi>=50,`RSI phiên trước ${fmt(prev?.rsi)} → hiện tại ${fmt(f.rsi)}; cần phiên trước <50 và hiện tại ≥50.`);
    add('Giá trên EMA20',b.close>f.ema20,`Close ${fmt(b.close)}; EMA20 ${fmt(f.ema20)}.`);
  } else if(p.strategy==='confirmed') {
    const high=Math.max(...rows.slice(Math.max(0,i-20),i).map(b=>b.high));
    add('Xu hướng tăng',f.regime==='up',`Trạng thái: ${regimeNames[f.regime]}; ADX14 ${fmt(f.adx)}, EMA20 ${fmt(f.ema20)}, EMA50 ${fmt(f.ema50)}.`);
    add('Vượt đỉnh 20 phiên trước',b.close>high,`Close ${fmt(b.close)} phải lớn hơn high cao nhất 20 phiên trước: ${fmt(high)}.`);
    add('Khối lượng xác nhận',f.relVolume>=1.5,`Khối lượng bằng ${fmt(f.relVolume)}× trung bình 20 phiên trước; cần ≥1,5×.`);
  } else if(p.strategy==='range') {
    add('Trạng thái đi ngang',f.regime==='range',`ADX14 ${fmt(f.adx)}; cần <20 và đủ lịch sử.`);
    add('Phiên trước dưới Bollinger dưới',rows.at(-2)?.close<prev?.lower,`Close trước ${fmt(rows.at(-2)?.close)}; dải dưới trước ${fmt(prev?.lower)}.`);
    add('Giá trở lại dải Bollinger',b.close>=f.lower,`Close ${fmt(b.close)}; dải dưới hiện tại ${fmt(f.lower)}.`);
    add('RSI phiên trước thấp',prev?.rsi<35,`RSI phiên trước ${fmt(prev?.rsi)}; cần <35.`);
  } else if(p.strategy==='sma') {
    const ma=(end,n)=>end+1>=n?avg(rows.slice(end-n+1,end+1).map(b=>b.close)):NaN;
    const now=ma(i,p.fast)-ma(i,p.slow),before=ma(i-1,p.fast)-ma(i-1,p.slow);
    add('Đủ lịch sử giao cắt',i>=p.slow,`${rows.length} phiên; cần ít nhất ${p.slow+1}.`);
    add('SMA nhanh vừa cắt lên SMA chậm',before<=0&&now>0,`Chênh lệch SMA${p.fast} − SMA${p.slow}: phiên trước ${fmt(before)} → hiện tại ${fmt(now)}. Cần từ ≤0 sang >0.`);
  } else if(p.strategy==='breakout') {
    const high=Math.max(...rows.slice(Math.max(0,i-p.lookback),i).map(b=>b.close));
    add('Đủ lịch sử breakout',i>=p.lookback,`${rows.length} phiên; cần ít nhất ${p.lookback+1}.`);
    add('Vượt đỉnh giá đóng cửa',b.close>high,`Close ${fmt(b.close)} phải lớn hơn close cao nhất ${p.lookback} phiên trước: ${fmt(high)}.`);
  }
  if(p.minVolume||p.volumeFilter) {
    add('Thanh khoản tối thiểu',Number.isFinite(f.avgVol)&&f.avgVol>0&&f.avgVol>=p.minVolume,`Khối lượng trung bình 20 phiên trước ${fmt(f.avgVol)}; cần >0 và ≥${fmt(p.minVolume)}.`);
    if(p.volumeFilter) add('Bộ lọc volume',b.volume>=f.avgVol*p.volumeFilter,`Khối lượng hiện tại ${fmt(f.relVolume)}× trung bình; yêu cầu ≥${fmt(p.volumeFilter)}×.`);
  }
  return checks;
}

export function buildSnapshot({symbol,rows,parameters,forecastMethod='none',horizon=5,source,metadata={},now=new Date().toISOString(),reconciliation=null}) {
  if(rows.length<2)throw new Error('Cần ít nhất hai phiên dữ liệu.');
  const p=withDefaults(parameters),context=validateMarketContext(metadata.marketContext,symbol),series=technicalSeries(rows,context),factor=series.factors.at(-1);
  const fullAnalysisRows=series.rows.map(b=>({...b,open:b.open/factor,high:b.high/factor,low:b.low/factor,close:b.close/factor,volume:b.volume*series.volumeFactors.at(-1)}));
  const boundary=series.boundaries.at(-1),analysisRows=boundary?fullAnalysisRows.filter(b=>b.date>=boundary):fullAnalysisRows;
  const priceRisk=priceRiskTimeline(fullAnalysisRows,{boundaries:series.boundaries}),market=marketAssessment(rows,context,p,analysisRows);
  priceRisk.outcomes=evaluateRiskOutcomes(fullAnalysisRows,priceRisk,horizon);
  let r;
  try{
    if(p.execution==='research'&&context?.priceBasis==='raw'&&context.actions.some(a=>a.exDate>=rows[0].date&&a.exDate<=rows.at(-1).date))throw new Error('Giá raw có sự kiện quyền: chọn mô phỏng VN với hồ sơ đầy đủ, hoặc nhập giá adjusted để nghiên cứu.');
    r=backtest(rows,p,context,priceRisk);
  }catch(e){r={blocked:true,blockedReason:e.message,equity:[],trades:[],returnPct:null,buyHoldPct:null,maxDrawdownPct:null,winRate:null,openPosition:false,signal:signals(rows,p,context).at(-1),lastPrice:rows.at(-1).close,audit:{lockedStopBars:0,blockedFillBars:0,trapBlockedEntries:0},entry:null,cashPending:0,sellable:false};}
  const x=profile(analysisRows,p.minVolume),baseForecast=swingForecast(analysisRows,forecastMethod,horizon),adjustedForecast=forecastWithActions(baseForecast,context,rows.at(-1).date),f=adjustedForecast.forecast,checks=validateForecasts(analysisRows,horizon);
  const last=rows.at(-1),quality=assessData(rows,context,source,now),stale=['stale','incomplete'].includes(quality.freshness),expected=quality.expected;
  quality.reconciliation=reconciliation||{status:'NO_CHECK',eligible:false,blocking:false,reason:'Chưa gắn bản đối chiếu được máy chủ xác nhận vào mẫu phân tích.'};
  quality.crossSourceReady=!!quality.reconciliation.eligible;
  const holdingToNext=r.openPosition?(p.execution==='vn'?context.calendar.indexOf(last.date)-context.calendar.indexOf(r.entry.date)+1:rows.length-r.entry.index):0;
  const timeExit=r.openPosition&&p.strategy!=='hold'&&p.maxHold>0&&holdingToNext>=p.maxHold;
  const exit=r.openPosition&&(r.signal.sell||r.entry?.deferred||timeExit);
  const constrained=r.openPosition&&p.execution==='vn'&&r.shares<100&&last.date>=r.entry.sellableDate;
  const simulationCode=r.blocked?'DATA_REQUIRED':constrained?'POSITION_CONSTRAINED':exit?(r.sellable?'EXIT_SIGNAL':'EXIT_LOCKED'):r.openPosition?(r.sellable?'HOLD':'POSITION_LOCKED'):'WAIT';
  const simulation={code:simulationCode,label:decisionNames[simulationCode],entry:r.entry,openPosition:r.openPosition,sellable:r.sellable,description:'Vị thế và hành động của backtest; không thay thế danh mục thực.'};
  const geometry=entryGeometry(last.close,x.atr,p,context),blockers=[];
  if(quality.freshness!=='fresh')blockers.push(...quality.issues.filter(x=>x.code==='FRESHNESS').map(x=>x.message));
  if(quality.reconciliation.blocking)blockers.push(quality.reconciliation.reason);
  if(!market.entryReady)blockers.push(...market.warnings);
  if(!geometry.valid&&p.strategy!=='hold')blockers.push('Khoảng stop không hợp lệ; không lập kế hoạch mua.');
  if(r.signal.buy&&r.signal.sell)blockers.push('Điều kiện mua và thoát đồng thời; chờ xác nhận.');
  if(priceRisk.latest.blockEntry&&p.trapFilter==='high')blockers.push('Bộ lọc rủi ro giá đang chặn mua mới.');
  const marketSignal={...r.signal,asOf:last.date,forecastConflict:!!r.signal.buy&&!!baseForecast&&baseForecast.center<last.close,entryEligible:!!r.signal.buy&&!blockers.length,blockers:[...new Set(blockers)]};
  const code=stale?'STALE':r.signal.buy?(priceRisk.latest.blockEntry&&p.trapFilter==='high'?'RISK_BLOCKED':!geometry.valid?'INVALID_PLAN':marketSignal.entryEligible?'BUY_CONDITION':p.execution==='research'?'RESEARCH_SIGNAL':'DATA_REQUIRED'):r.signal.sell?'SELL_CONDITION':'WAIT';
  const validation=strategyValidation(rows,p,context,quality);
  const personalPlan=buildTradePlan({symbol,rows,p,context,features:x,marketSignal,quality,validation,portfolio:metadata.portfolio,reservations:metadata.reservations});
  const conditions=entryEvidence(analysisRows,p),missed=conditions.filter(c=>!c.passed).map(c=>c.label);
  conditions.push({label:'Đối chiếu đa nguồn',passed:quality.crossSourceReady,detail:quality.reconciliation.reason});
  conditions.push({label:'Bộ lọc bẫy giá',passed:p.trapFilter==='off'||!priceRisk.latest.blockEntry,detail:p.trapFilter==='off'?'Đang tắt bộ lọc; điểm rủi ro vẫn được lưu.':`Điểm ưu tiên kiểm tra ${fmt(priceRisk.latest.score)}/100; chặn mua mới từ 60, duy trì 3 phiên quan sát.`});
  conditions.push({label:'Hồ sơ giao dịch Việt Nam',passed:market.entryReady,detail:market.entryReady?'Đủ hồ sơ theo dữ liệu người dùng nhập.':market.warnings.join(' ')});
  const summary={
    BUY_CONDITION:`${symbol}: điều kiện mua kỹ thuật đạt tại close ${last.date}. Xem kế hoạch cá nhân để kiểm tra giá, vốn và bằng chứng; tín hiệu không phải lệnh mua.`,
    SELL_CONDITION:`${symbol}: có điều kiện thoát kỹ thuật tại close ${last.date}. Chỉ áp dụng cho cổ phiếu thực đang giữ và đủ điều kiện bán.`,
    INVALID_PLAN:`${symbol}: có điều kiện mua nhưng khoảng stop không hợp lệ. Tạm chặn kế hoạch; kiểm tra cấu hình ATR và dữ liệu.`,
    STALE:`${symbol}: ${quality.issues.find(x=>x.code==='FRESHNESS')?.message} Không xem đây là tín hiệu hiện tại. Tạm chặn kế hoạch mới; cần cập nhật dữ liệu.`,
    POSITION_CONSTRAINED:`${symbol}: vị thế mô phỏng còn ${fmt(r.shares)} cổ phiếu khả dụng và ${fmt(r.sharesPending)} cổ phiếu chờ về. Chưa có lô chẵn để bán; lô lẻ không được giả định khớp bằng OHLCV lô chẵn.`,
    DATA_REQUIRED:`${symbol}: có điều kiện kỹ thuật; ${marketSignal.blockers.join(' ')} Chưa lập kế hoạch mua.`,
    RISK_BLOCKED:`${symbol}: có tín hiệu kỹ thuật nhưng điểm rủi ro giá ${fmt(priceRisk.latest.score)}/100 đang chặn mua mới. ${priceRisk.latest.active.map(e=>e.label).filter((v,i,a)=>a.indexOf(v)===i).join('; ')}. Đây không phải kết luận có thao túng.`,
    RESEARCH_SIGNAL:`${symbol}: điều kiện kỹ thuật đạt trên mẫu nghiên cứu. ${marketSignal.blockers.join(' ')} Chưa coi đây là kế hoạch giao dịch hiện tại.`,
    ENTRY_SIGNAL:`${symbol} đã thỏa điều kiện mua của ${strategyNames[p.strategy]} tại close ${last.date}. Chỉ xem xét lệnh giả định ở mở cửa phiên kế tiếp; chưa có giá khớp.`,
    WAIT:`${symbol} chưa có điểm mua mới tại close ${last.date} theo ${strategyNames[p.strategy]}.${missed.length?` Điều kiện chưa đạt: ${missed.join('; ')}.`:''}`,
    HOLD:`${symbol} còn vị thế trong backtest và chưa có điều kiện thoát tại close ${last.date}. Đây là vị thế mô phỏng, không phải danh mục thực tế của bạn.`,
    POSITION_LOCKED:`${symbol} còn vị thế mô phỏng nhưng chưa đủ số phiên T+ để bán theo cấu hình. Không giả định có thể thực hiện stop ngay.`,
    EXIT_SIGNAL:`${symbol} có điều kiện thoát vị thế mô phỏng: ${r.entry?.deferred|| (r.signal.sell?'tín hiệu bán của chiến lược':'đạt thời hạn giữ ở phiên mở cửa tiếp theo')}. Xét khớp ở phiên mở cửa kế tiếp có thể giao dịch.`,
    EXIT_LOCKED:`${symbol} có điều kiện thoát nhưng cổ phiếu mô phỏng đang khóa T+. Lệnh cần chờ đủ điều kiện; giá thoát có thể vượt mức stop.`
  }[code];
  const validGeometry=geometry.valid,stop=p.strategy==='hold'?null:geometry.stop,target=p.strategy==='hold'?null:geometry.target;
  const risk={reference:'Close cuối mẫu; mức tham chiếu đã làm tròn khi có hồ sơ sàn. Xem kế hoạch cá nhân để biết giá tối đa và số lượng.',entry:null,stop,target,validGeometry,settlement:p.settlement,cashDelay:p.cashDelay};
  const v=checks.find(v=>v.method===forecastMethod);
  const forecastText=forecastMethod==='none'?'Dự báo đang tắt.':!f?(adjustedForecast.reason||'Mô hình dự báo chưa đủ lịch sử hoặc mẫu tương đồng để trả kết quả.'):`${modelNames[forecastMethod]} cho giá trung tâm ${fmt(f.center)} sau ${horizon} phiên${f.hasBand?`, dải lịch sử P10–P90 ${fmt(f.lower)}–${fmt(f.upper)} từ ${f.sampleCount} mẫu`: '; chưa đủ mẫu để tạo dải'}. ${!v||v.n<12?'Chưa đủ 12 mốc kiểm định ngoài mẫu để kết luận chất lượng.':!Number.isFinite(v.skill)?'Không tính được mức cải thiện vì sai số đối chứng bằng 0.':v.skill>0?`Trên ${v.n} mốc kiểm định, sai số thấp hơn giá không đổi ${fmt(v.skill)}%.`:`Trên ${v.n} mốc kiểm định, sai số không tốt hơn giá không đổi.`} ${adjustedForecast.reason||''} Đây là kịch bản giá, không phải xác suất thắng hay mục tiêu chốt lời và không quyết định tín hiệu.`;
  const exitRule={pullback:`Close dưới EMA20 (${fmt(x.ema20)})`,confirmed:`Close dưới EMA20 (${fmt(x.ema20)})`,range:`Close đạt SMA20 (${fmt(x.mid)}) hoặc ADX ≥25`,sma:`SMA${p.fast} cắt xuống SMA${p.slow}`,breakout:`Close dưới đáy close ${p.lookback} phiên trước`,hold:'Đối chứng giữ đến cuối mẫu, không dùng stop/target'}[p.strategy];
  const paragraphs=[
    `${source==='csv'?'Phân tích lịch sử CSV':'Dữ liệu được yêu cầu từ '+(metadata.source||source)}: ${rows.length} phiên, từ ${rows[0].date} đến ${last.date}; close cuối ${fmt(last.close)} theo đơn vị nguồn.`,
    `Mã đang ở trạng thái ${regimeNames[x.regime].toLowerCase()}. ADX14 ${fmt(x.adx)} mô tả độ mạnh xu hướng; RSI14 ${fmt(x.rsi)} mô tả động lượng. ATR14 bằng ${fmt(x.atrPct)}% giá; khối lượng hiện tại bằng ${fmt(x.relVolume)}× trung bình 20 phiên trước.`,
    `Điều kiện thoát của chiến lược: ${exitRule}. Tín hiệu thoát tại phiên cuối: ${r.signal.sell?'có':'không'}.${r.entry?.deferred?` Lý do thoát đang chờ: ${r.entry.deferred}.`:''}`,
    p.strategy==='hold'?`Buy & hold là đối chứng không stop/target hay giới hạn thời gian giữ. ${p.execution==='vn'?'Vốn triển khai còn phụ thuộc lô và giới hạn thanh khoản TB20.':'Chế độ nghiên cứu sử dụng toàn vốn.'}`:`Stop tham chiếu ${fmt(stop)}; target ${target===null?'đang tắt hoặc chưa tính được':fmt(target)}. ${risk.reference} Ngân sách rủi ro ${fmt(p.risk)}% tiền khả dụng chưa bao gồm phí, gap và rủi ro chưa bán được. ${!r.entry&&!validGeometry?'Chưa có khoảng stop hợp lệ; chưa thể giả định mở vị thế.':''}`,
    `Giả định bán sau ${p.settlement} phiên, tiền bán dùng lại sau ${p.cashDelay} phiên; phí và trượt giá mỗi chiều ${fmt(p.fee)}%, phụ phí bán ${fmt(p.sellTax)}%. Backtest ghi nhận ${r.audit.lockedStopBars} phiên chạm stop lúc khóa và ${r.audit.blockedFillBars} lần hoãn/bỏ khớp. Đây là giả định mô phỏng từ OHLCV ngày.`,
    forecastText,
    r.blocked?`Chưa tính hiệu suất giao dịch: ${r.blockedReason}`:`Backtest toàn mẫu có ${r.trades.length} phần lệnh đã đóng, lợi nhuận ${fmt(r.returnPct)}%, sụt giảm tối đa ${fmt(r.maxDrawdownPct)}%. ${r.trades.length?'Các thống kê là kết quả lịch sử, chưa chứng minh lợi thế ngoài mẫu.':'Chưa có lệnh đóng để đánh giá tỷ lệ thắng.'}`,
    `Rủi ro giá: ${priceRisk.latest.level==='insufficient'?'chưa đủ 20 phiên trước':`${fmt(priceRisk.latest.score)}/100 điểm ưu tiên kiểm tra`}. ${priceRisk.latest.active.length?priceRisk.latest.active.map(e=>`${e.date}: ${e.label}. ${e.detail} ${e.action}`).join(' '):'Chưa thấy mẫu đạt ngưỡng; điều này không xác nhận an toàn.'} Chỉ số này không phải xác suất hoặc bằng chứng thao túng.`,
    `Thị trường: ${context?`${context.exchange}, ${context.priceUnit}, ${context.priceBasis}; nguồn đối chiếu do người dùng nhập: ${context.source}`:'chưa có hồ sơ đối chiếu'}. ${p.execution==='vn'?'Mô phỏng theo vốn VND, lô 100 và giới hạn tham gia TB20.':'Backtest nghiên cứu dùng số cổ phiếu phân số; không đại diện khả năng đặt lệnh thực.'} ${market.warnings.join(' ')}`
  ];
  const strategies=Object.keys(strategyNames).map(strategy=>{
    try {if(r.blocked)throw new Error(r.blockedReason);const b=backtest(rows,{...p,strategy},context,priceRisk);return {strategy,returnPct:b.returnPct,maxDrawdownPct:b.maxDrawdownPct,tradeCount:b.trades.length};}
    catch(e){return {strategy,error:e.message};}
  });
  const forecasts=Object.keys(modelNames).map(method=>({method,result:method===forecastMethod?f:forecastWithActions(swingForecast(analysisRows,method,horizon),context,rows.at(-1).date).forecast}));
  const contextReturns=Object.entries(market.benchmarks).filter(([,v])=>v).map(([k,v])=>`${k==='market'?'Thị trường':'Ngành'}: chênh lệch lợi suất ${fmt(v.excessPct)} điểm % trong 20 mốc cùng ngày (${v.from}–${v.to}).`);
  paragraphs.push(contextReturns.length?contextReturns.join(' '):'Chưa có đủ dữ liệu chỉ số thị trường / ngành cùng ngày. Không suy ra bối cảnh thị trường chỉ từ một mã.');
  const asset=assetProfile(analysisRows,context);
  const ensembleEvidence=evaluateEnsemble(analysisRows,horizon);
  const ensembleForecast=ensembleEvidence.forecast?forecastWithActions({...ensembleEvidence.forecast,points:[]},context,last.date).forecast:null;
  const recommendation=finalRecommendation({quality,rows,marketSignal:{...marketSignal,forecastConflict:marketSignal.forecastConflict||ensembleEvidence.forecast?.disagreement},validation,priceRisk,forecast:ensembleForecast,calibration:ensembleEvidence,personalPlan,features:x,asset});
  if(recommendation.state==='NO SIGNAL'&&personalPlan.status==='CONDITIONAL_PLAN'){personalPlan.status='PAPER_ONLY';personalPlan.label='Kế hoạch thử nghiệm · NO SIGNAL';personalPlan.reasons.push(recommendation.reason);}
  return clean({assetProfile:asset,ensembleEvidence:{...ensembleEvidence,observations:undefined,forecast:ensembleForecast},recommendation,schemaVersion:4,engineVersion:ENGINE_VERSION,symbol,asOf:last.date,calculatedAt:now,source,metadata,parameters:p,forecastMethod,horizon,data:{count:rows.length,first:rows[0].date,last:last.date},features:x,signal:r.signal,marketSignal,simulation,personalPlan,quality,validation,forecastNote:adjustedForecast.reason,decision:{code,label:decisionNames[code],summary},risk,priceRisk:{...priceRisk,timeline:undefined,eventCount:priceRisk.events.length,events:priceRisk.events.slice(-200)},market,backtest:r,forecast:f,forecastValidation:checks,comparisons:{strategies,forecasts},explanation:{summary,paragraphs,conditions,limits:[...x.warnings,...priceRisk.limits,...quality.issues.map(i=>i.message),...(r.limitations||[]),'Hồ sơ nhập là dữ liệu do người dùng đối chiếu, không phải nguồn đã được hệ thống xác thực độc lập. Chưa có sổ lệnh, tài khoản, BCTC và tin tức thời gian thực.']},inputBars:rows});
}
