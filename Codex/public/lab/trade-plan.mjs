import {roundTick,priceScale,nextSession,EXCHANGE_RULES,sessionCheck} from './vn-market.mjs';

export const DEFAULT_LIMITS={riskPct:1,maxPositionPct:15,maxSectorPct:30,maxGrossPct:70,maxPortfolioRiskPct:5,maxCorrelatedPct:35,maxGapPct:2,minRewardRisk:1.5};
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const fail=m=>{throw new Error(`Danh mục: ${m}`);};
export function validatePortfolio(raw){
  if(raw==null)return null;
  if(typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['schemaVersion','asOf','cashVnd','positions','limits'].includes(k)))fail('sai cấu trúc.');
  const p=JSON.parse(JSON.stringify(raw));
  if(p.schemaVersion!==1||!validDate(p.asOf)||!Number.isFinite(p.cashVnd)||p.cashVnd<0||p.cashVnd>1e12||!Array.isArray(p.positions)||p.positions.length>100)fail('ngày, tiền hoặc danh sách mã không hợp lệ.');
  const seen=new Set();for(const h of p.positions){
    if(Object.keys(h).some(k=>!['symbol','sector','entryDate','available','pending','pendingUntil','averageCostVnd','markVnd','stopVnd','targetVnd'].includes(k))||!/^[A-Z0-9]{2,10}$/.test(h.symbol)||seen.has(h.symbol))fail('mã trùng hoặc không hợp lệ.');seen.add(h.symbol);
    if(!validDate(h.entryDate)||h.entryDate>p.asOf)fail('cần ngày mở vị thế không sau ngày cập nhật.');
    if(typeof h.sector!=='string'||h.sector.length>100||!h.sector.trim())fail('cần ngành cho từng vị thế.');
    for(const k of ['available','pending'])if(!Number.isInteger(h[k])||h[k]<0||h[k]>1e9)fail('số cổ phiếu phải là số nguyên không âm.');
    if(h.available+h.pending===0)fail('bỏ dòng không giữ cổ phiếu.');
    for(const k of ['averageCostVnd','markVnd'])if(!Number.isFinite(h[k])||h[k]<=0||h[k]>1e9)fail('giá vốn / giá định giá phải dương, đơn vị VND.');
    for(const k of ['stopVnd','targetVnd'])if(h[k]!==null&&(!Number.isFinite(h[k])||h[k]<=0||h[k]>1e9))fail('stop/target phải dương hoặc để trống.');
    if(h.pending&&(!validDate(h.pendingUntil)||h.pendingUntil<=p.asOf))fail('cổ phiếu chờ về cần ngày khả dụng sau ngày cập nhật; cập nhật số khả dụng nếu đã về.');
    if(!h.pending)h.pendingUntil=null;
  }
  p.limits={...DEFAULT_LIMITS,...p.limits};
  if(Object.keys(p.limits).some(k=>!Object.hasOwn(DEFAULT_LIMITS,k)))fail('giới hạn không được hỗ trợ.');
  for(const [k,v] of Object.entries(p.limits))if(!Number.isFinite(v)||v<=0||v>(k==='minRewardRisk'?10:k==='maxGapPct'?7:k==='riskPct'?10:100))fail(`giới hạn ${k} ngoài khoảng.`);
  return p;
}
export function entryGeometry(price,atr,p,context){
  const distance=p.stopMode==='atr'?p.atrStop*atr:price*p.stop/100;
  if(!Number.isFinite(distance)||distance<=0||distance>=price)return {valid:false,stop:null,target:null,reason:'Khoảng stop không hợp lệ.'};
  const scale=priceScale(context),round=(v,d)=>context?roundTick(v*scale,context.exchange,d)/scale:v;
  const stop=round(price-distance,'down'),target=p.stopMode==='atr'?(p.atrTarget?round(price+p.atrTarget*atr,'up'):null):(p.target?round(price*(1+p.target/100),'up'):null);
  return {valid:stop>0&&stop<price&&(!target||target>price),stop,target,distance:price-stop};
}
export function portfolioTotals(p,costs={fee:0,sellTax:0}){
  const sectors={},values={};let gross=0,risk=0,unbounded=false,breached=false;
  for(const h of p.positions){const value=(h.available+h.pending)*h.markVnd;values[h.symbol]=value;gross+=value;sectors[h.sector]=(sectors[h.sector]||0)+value;if(h.stopVnd==null)unbounded=true;else{risk+=(h.available+h.pending)*Math.max(0,h.markVnd-h.stopVnd*(1-costs.fee/100-costs.sellTax/100));if(h.markVnd<=h.stopVnd)breached=true;}}
  return {equity:p.cashVnd+gross,gross,risk,sectors,values,unbounded,breached};
}
export function validateReservations(raw=[]){
  if(!Array.isArray(raw)||raw.length>100)fail('kế hoạch đang phân bổ không hợp lệ.');const seen=new Set();
  return raw.map(x=>{if(!x||Object.keys(x).some(k=>!['symbol','sector','costVnd','riskVnd','notionalVnd'].includes(k))||!/^[A-Z0-9]{2,10}$/.test(x.symbol)||seen.has(x.symbol)||typeof x.sector!=='string'||x.sector.length>100)fail('kế hoạch đang phân bổ không hợp lệ.');seen.add(x.symbol);for(const k of ['costVnd','riskVnd','notionalVnd'])if(!Number.isFinite(x[k])||x[k]<0||x[k]>1e12)fail('giá trị phân bổ không hợp lệ.');return {...x};});
}
export function buildTradePlan({symbol,rows,p,context,features,marketSignal,quality,validation,portfolio:rawPortfolio,reservations:rawReservations=[]}){
  const portfolio=validatePortfolio(rawPortfolio),reservations=validateReservations(rawReservations),last=rows.at(-1),limits=portfolio?.limits||DEFAULT_LIMITS;
  const result={schemaVersion:1,status:'NO_PORTFOLIO',label:'Chưa có danh mục cá nhân',reasons:[],symbol,quantity:0,asOf:last.date,validFor:context?nextSession(last.date,1,context.calendar):null,portfolioAsOf:portfolio?.asOf||null,limits,orderType:'LO',cancelIf:[],reservation:null};
  if(!portfolio){result.reasons.push('Nhập tiền và cổ phiếu thực đang giữ để tính kế hoạch.');return result;}
  const holding=portfolio.positions.find(h=>h.symbol===symbol),scale=priceScale(context),closeVnd=last.close*scale;
  if(quality.freshness!=='fresh'||portfolio.asOf<last.date||portfolio.asOf>quality.today){result.status='UPDATE_REQUIRED';result.label='Cần cập nhật giá / danh mục';result.reasons.push('Cần phiên giá hoàn thành mới nhất và danh mục cập nhật cùng phiên hoặc mới hơn.');return result;}
  if(quality.reconciliation?.blocking){result.status='DATA_REVIEW';result.label='Cần xử lý sai lệch dữ liệu';result.reasons.push(quality.reconciliation.reason);return result;}
  if(holding){
    const heldIndex=context?.calendar.indexOf(holding.entryDate)??-1,age=heldIndex>=0?context.calendar.indexOf(last.date)-heldIndex:null,timeExit=p.maxHold>0&&age!==null&&age+1>=p.maxHold;
    if(p.maxHold>0&&age===null)result.reasons.push('Lịch chưa bao phủ ngày mở vị thế; chưa xác định được số phiên nắm giữ.');
    const stopHit=holding.stopVnd!=null&&closeVnd<=holding.stopVnd,targetHit=holding.targetVnd!=null&&closeVnd>=holding.targetVnd,exit=marketSignal.sell||stopHit||targetHit||timeExit;
    result.status=exit?(holding.available>=100?'EXIT_REVIEW':'EXIT_LOCKED'):'HOLD_REVIEW';result.label=exit?(holding.available>=100?'Xem xét thoát cổ phiếu khả dụng':'Có điều kiện thoát; chưa đủ lô khả dụng'):'Theo dõi vị thế thực';
    const check=sessionCheck(last,context),avg=rows.slice(-20).reduce((n,b)=>n+b.volume,0)/Math.min(20,rows.length),capacity=Math.floor(avg*p.participation/100/100)*100;
    result.quantity=exit?Math.min(Math.floor(holding.available/100)*100,capacity,context?EXCHANGE_RULES[context.exchange].maxOrder:0):0;result.holding=holding;
    if(exit&&(!check.ok||check.atFloor||last.volume<=0||last.high===last.low||holding.available>=100&&result.quantity<100)){result.status='EXIT_CONSTRAINED';result.label='Cần thoát nhưng khả năng khớp chưa xác nhận';result.quantity=0;result.reasons.push(check.reason||'Đóng cửa tại sàn, nến thiếu thanh khoản hoặc giới hạn tham gia chưa đủ một lô bán.');}result.reasons.push(exit?(stopHit?'Close đã chạm stop của vị thế thực.':targetHit?'Close đã đạt target của vị thế thực.':timeExit?'Đạt thời hạn giữ ở phiên tới, tính từ ngày mở vị thế thực.':'Có tín hiệu thoát của chiến lược.'):'Chưa có điều kiện thoát tại close; không tự suy ra cần mua thêm.');
    result.reasons.push('Số lượng khả dụng do bạn xác nhận; lô lẻ, giá sàn và hàng đợi có thể làm lệnh không khớp.');return result;
  }
  result.status='WAIT';result.label='Chưa có điều kiện mua';if(!marketSignal.buy)return result;
  if(!marketSignal.entryEligible){result.status='BLOCKED';result.label='Chặn kế hoạch mua';result.reasons.push(...marketSignal.blockers);return result;}
  const horizon=Math.max(p.maxHold||10,3),futureDates=context.calendar.filter(d=>d>last.date).slice(0,horizon),actions=context.actions.filter(a=>a.knownAt<=last.date&&a.exDate>last.date&&(!futureDates.at(-1)||a.exDate<=futureDates.at(-1)));
  if(futureDates.length<horizon)result.reasons.push('Lịch chưa bao phủ toàn thời hạn giữ dự kiến.');
  if(actions.length)result.reasons.push('Có quyền đã công bố trong thời hạn giữ dự kiến; cần lập lại kế hoạch sau điều chỉnh.');
  const totals=portfolioTotals(portfolio,{fee:p.fee,sellTax:p.sellTax}),sector=context.sector;if(!sector)result.reasons.push('Thiếu ngành để kiểm tra giới hạn danh mục.');
  if(totals.breached)result.reasons.push('Có vị thế đã chạm stop; cần xử lý và cập nhật danh mục trước khi mua mới.');
  if(totals.unbounded)result.reasons.push('Có vị thế chưa nhập stop; chưa lượng hóa được tổng rủi ro danh mục.');
  const maxBuyVnd=roundTick(closeVnd*(1+limits.maxGapPct/100),context.exchange,'down'),g=entryGeometry(last.close,features.atr,p,context),stopVnd=g.stop*scale,targetVnd=g.target?g.target*scale:null;
  const fee=p.fee/100,tax=p.sellTax/100,unitCost=maxBuyVnd*(1+fee),unitRisk=unitCost-stopVnd*(1-fee-tax),reward=targetVnd?targetVnd*(1-fee-tax)-unitCost:null,rr=reward!=null&&unitRisk>0?reward/unitRisk:null;
  const reservedCost=reservations.reduce((s,r)=>s+r.costVnd,0),reservedRisk=reservations.reduce((s,r)=>s+r.riskVnd,0),reservedGross=reservations.reduce((s,r)=>s+r.notionalVnd,0),reservedSector=reservations.filter(r=>r.sector===sector).reduce((s,r)=>s+r.notionalVnd,0);
  const cash=Math.max(0,portfolio.cashVnd-reservedCost),riskBudget=Math.max(0,Math.min(totals.equity*limits.riskPct/100,totals.equity*limits.maxPortfolioRiskPct/100-totals.risk-reservedRisk));
  // Without a verified price matrix, treat all exposure as one correlated group.
  // This guarantees the concentration cap without inventing correlations.
  const notionalBudget=Math.max(0,Math.min(totals.equity*limits.maxPositionPct/100,totals.equity*limits.maxSectorPct/100-(totals.sectors[sector]||0)-reservedSector,totals.equity*limits.maxGrossPct/100-totals.gross-reservedGross,totals.equity*limits.maxCorrelatedPct/100-totals.gross-reservedGross));
  const avgVol=rows.slice(-20).reduce((s,b)=>s+b.volume,0)/Math.min(20,rows.length),capacity=Math.floor(avgVol*p.participation/100/100)*100;
  let quantity=Math.max(0,Math.floor(Math.min(cash/unitCost,riskBudget/unitRisk,notionalBudget/maxBuyVnd,capacity,EXCHANGE_RULES[context.exchange].maxOrder)/100)*100);
  if(!g.valid||!Number.isFinite(unitRisk)||unitRisk<=0)result.reasons.push('Stop hoặc rủi ro trên mỗi cổ phiếu không hợp lệ.');
  if(rr==null||rr<limits.minRewardRisk)result.reasons.push(`Reward/risk sau chi phí chưa đạt ${limits.minRewardRisk} tại giá mua tối đa.`);
  if(quantity<100)result.reasons.push('Không đủ vốn, ngân sách rủi ro, giới hạn tập trung hoặc thanh khoản cho một lô.');
  if(result.reasons.length)quantity=0;
  Object.assign(result,{quantity,maxBuyVnd,entryRangeVnd:[roundTick(closeVnd,context.exchange,'down'),maxBuyVnd],stopVnd,targetVnd,rewardRisk:rr,riskVnd:quantity*unitRisk,costVnd:quantity*unitCost,portfolioEquityVnd:totals.equity,sector,capacityShares:capacity,concentrationMethod:'Thận trọng: toàn bộ vị thế và lệnh dự kiến cùng một nhóm tương quan; chưa ước lượng tương quan thống kê.'});
  result.cancelIf=[`Hết phiên ${result.validFor}; phải chạy lại.`,`Giá mở cửa vượt ${maxBuyVnd.toLocaleString('vi-VN')} VND hoặc thấp hơn vùng mua; không đuổi giá.`,`Giá tham chiếu/trần sàn, quyền, trạng thái giao dịch hoặc danh mục thay đổi.`,`Giá chạm stop khi chưa bán được; stop không bảo đảm mức lỗ tối đa.`];
  const evidenceReady=validation?.qualified&&p.execution==='vn'&&quality.crossSourceReady;
  result.status=!quantity?'BLOCKED':evidenceReady?'CONDITIONAL_PLAN':'PAPER_ONLY';result.label=!quantity?'Chưa lập được lệnh hợp lệ':evidenceReady?'Kế hoạch có điều kiện · cần kiểm tra phiên tới':'Kế hoạch thử nghiệm · chưa đủ bằng chứng';
  if(quantity&&!quality.crossSourceReady)result.reasons.push(quality.reconciliation?.reason||'Chưa có bản đối chiếu đa nguồn bao phủ mẫu phân tích.');
  if(quantity&&(!validation?.qualified||p.execution!=='vn'))result.reasons.push(p.execution!=='vn'?'Cần kiểm định bằng mô hình VN có lô và lịch giao dịch; hiện chỉ lập kế hoạch thử nghiệm.':validation?.reason||'Chưa có kiểm định ngoài mẫu.');
  if(quantity)result.reservation={symbol,sector,costVnd:result.costVnd,riskVnd:result.riskVnd,notionalVnd:quantity*maxBuyVnd};
  return result;
}
