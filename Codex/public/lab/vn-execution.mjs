import {entryGeometry} from './trade-plan.mjs';
import {executionReadiness,EXCHANGE_RULES,priceScale,nextSession,sessionCheck,roundTick,membershipAt} from './vn-market.mjs';

// Daily conservative execution. No auction queue, intraday path or order-book
// reconstruction is claimed. Entry capacity is fixed from past volumes only.
export function vnBacktest(rows,p,c,sig,features,factors,riskTimeline){
  const readiness=executionReadiness(rows,c);
  if(!readiness.ready)throw new Error(readiness.missing.join(' '));
  const scale=priceScale(c),capital=p.capitalVnd,fee=p.fee/100,tax=p.sellTax/100,lot=100;
  let cash=capital,shares=0,entry=null,pending=null,heldOnce=false,peak=capital,maxDrawdown=0;
  const receivables=[],stockPending=[],equity=[],trades=[],events=[];
  const audit={lockedStopBars:0,blockedFillBars:0,cashBlockedEntries:0,trapBlockedEntries:0,lotBlockedEntries:0,capacityCappedEntries:0,capacityBlockedExits:0,corporateEvents:0,missingSettlementDates:0};
  const totalShares=()=>shares+stockPending.reduce((s,x)=>s+x.shares,0);
  const cashClaims=()=>receivables.reduce((s,x)=>s+x.value,0);
  const pendingReason=()=>entry?.deferred;
  const capacity=i=>{
    const volumes=rows.slice(Math.max(0,i-20),i).map(x=>x.volume);
    return volumes.length===20?Math.floor(volumes.reduce((s,x)=>s+x,0)/20*p.participation/100/lot)*lot:0;
  };
  const sell=(price,reason,b,i,cap)=>{
    const qty=Math.min(Math.floor(shares/lot)*lot,cap,EXCHANGE_RULES[c.exchange].maxOrder);
    if(qty<=0){entry.deferred=reason.startsWith('Target')?null:reason;audit.capacityBlockedExits++;return false;}
    const all=totalShares(),fraction=qty/all,allocatedCost=entry.remainingCost*fraction,dividends=entry.dividends*fraction;
    const proceeds=qty*price*scale*(1-fee-tax),release=p.cashDelay?nextSession(b.date,p.cashDelay,c.calendar):b.date;
    if(!release)audit.missingSettlementDates++;
    if(release===b.date)cash+=proceeds;else receivables.push({value:proceeds,release,kind:'sale'});
    trades.push({entryDate:entry.date,exitDate:b.date,entryPrice:entry.price,exitPrice:price,quantity:qty,reason,net:(proceeds+dividends)/allocatedCost-1,holding:c.calendar.indexOf(b.date)-c.calendar.indexOf(entry.date),costVnd:allocatedCost,proceedsVnd:proceeds,dividendVnd:dividends});
    shares-=qty;entry.remainingCost-=allocatedCost;entry.dividends-=dividends;
    if(totalShares()<1e-8)entry=null;else entry.deferred=reason.startsWith('Target')?null:reason;
    return true;
  };
  for(let i=0;i<rows.length;i++){
    const b=rows[i],check=sessionCheck(b,c),plannedCap=capacity(i);
    // Ex-post fill feasibility cannot exceed observed volume. This may reduce a
    // pre-sized order, but never increases it using future volume information.
    const cap=Math.min(plannedCap,Math.floor(b.volume*p.participation/100/lot)*lot);
    for(let j=receivables.length-1;j>=0;j--)if(receivables[j].release&&receivables[j].release<=b.date){cash+=receivables[j].value;receivables.splice(j,1);}
    for(let j=stockPending.length-1;j>=0;j--)if(stockPending[j].release<=b.date){shares+=stockPending[j].shares;stockPending.splice(j,1);}
    const action=c.actions.find(a=>a.exDate===b.date);
    if(action&&entry){
      const entitled=totalShares();audit.corporateEvents++;
      if(action.type==='cash'){
        const value=entitled*action.netCashVnd;entry.dividends+=value;
        if(action.payDate<=b.date)cash+=value;else receivables.push({value,release:action.payDate,kind:'dividend'});
      }else if(['split','bonus'].includes(action.type)){
        const extra=entitled*(action.ratio-1);
        if(Math.abs(extra-Math.round(extra))>1e-6)throw new Error('Quyền phát sinh cổ phiếu lẻ phân số; cần quy tắc làm tròn/chi trả của doanh nghiệp để tính sổ tiền chính xác.');
        if(action.tradableDate<=b.date)shares+=Math.round(extra);else stockPending.push({shares:Math.round(extra),release:action.tradableDate});
      }
      entry.stop=roundTick(entry.stop*scale*action.priceFactor,c.exchange,'down')/scale;
      if(entry.target)entry.target=roundTick(entry.target*scale*action.priceFactor,c.exchange,'up')/scale;
      events.push({date:b.date,type:action.type,entitledShares:entitled,priceFactor:action.priceFactor});
    }
    const fillable=check.ok&&b.volume>0&&b.high>b.low;
    // Even a traded limit price does not prove that our order could join the queue.
    const canBuy=fillable&&b.open*scale<check.session.ceiling-1e-5;
    const canSell=fillable&&b.open*scale>check.session.floor+1e-5;
    let sold=false;
    const eligible=()=>entry&&entry.sellableDate&&b.date>=entry.sellableDate;
    if(entry){
      const age=c.calendar.indexOf(b.date)-c.calendar.indexOf(entry.date);
      const reason=pendingReason()||(pending==='sell'?'Signal':p.strategy!=='hold'&&p.maxHold&&age>=p.maxHold?'Time exit':null);
      if(reason){
        if(eligible()&&canSell)sold=sell(b.open,reason,b,i,cap);
        else{entry.deferred=reason;if(eligible()&&!canSell)audit.blockedFillBars++;}
      }
    }
    const wantsBuy=pending==='buy'||p.strategy==='hold'&&!heldOnce&&i>=1;
    if(!entry&&!sold&&wantsBuy&&(!p.tradeFromDate||b.date>=p.tradeFromDate)){
      if(p.strategy!=='hold'&&p.trapFilter==='high'&&riskTimeline[i-1]?.blockEntry)audit.trapBlockedEntries++;
      else if(!canBuy||(p.requireVN100&&membershipAt(c,rows[i-1]?.date)!==true))audit.blockedFillBars++;
      else if(cash<=0)audit.cashBlockedEntries++;
      else{
        const geometry=entryGeometry(b.open,features[i-1]?.atr/factors[i],p,c),distance=geometry.distance;
        if(p.strategy==='hold'||geometry.valid){
          const exposure=p.strategy==='hold'?1:Math.min(1,p.risk/100/(distance/b.open));
          const orderQuantity=Math.min(Math.floor(cash*exposure/(b.open*scale*(1+fee))/lot)*lot,plannedCap,EXCHANGE_RULES[c.exchange].maxOrder);
          const qty=Math.min(orderQuantity,cap);
          if(qty<orderQuantity)audit.capacityCappedEntries++;
          if(qty<lot)audit.lotBlockedEntries++;
          else{
            shares=qty;const cost=qty*b.open*scale*(1+fee);cash-=cost;heldOnce=true;
            const sellableDate=p.settlement?nextSession(b.date,p.settlement,c.calendar):b.date;
            if(!sellableDate)audit.missingSettlementDates++;
            const target=p.stopMode==='atr'?(p.atrTarget?b.open+p.atrTarget*features[i-1].atr/factors[i]:null):(p.target?b.open*(1+p.target/100):null);
            entry={date:b.date,index:i,price:b.open,cost,orderQuantity,remainingCost:cost,dividends:0,stop:geometry.stop,target:target?roundTick(target*scale,c.exchange,'up')/scale:null,sellableDate,deferred:null};
          }
        }
      }
    }
    pending=null;
    if(entry&&p.strategy!=='hold'&&!sold){
      if(!eligible()||!canSell){
        if(b.low<=entry.stop){entry.deferred='Deferred stop';if(!eligible())audit.lockedStopBars++;else audit.blockedFillBars++;}
      }else{
        let price=null,reason=null;
        if(b.open<=entry.stop){price=b.open;reason='Stop gap';}
        else if(entry.target&&b.open>=entry.target){price=b.open;reason='Target gap';}
        else if(b.low<=entry.stop){price=entry.stop;reason='Stop';}
        else if(entry.target&&b.high>=entry.target){price=entry.target;reason='Target';}
        if(price!==null){
          if(price*scale<=check.session.floor+1e-5){entry.deferred=reason;audit.blockedFillBars++;}
          else sell(price,reason,b,i,cap);
        }
      }
    }
    const value=cash+cashClaims()+totalShares()*b.close*scale;
    peak=Math.max(peak,value);maxDrawdown=Math.max(maxDrawdown,1-value/peak);equity.push({date:b.date,value:value/capital*100});
    if(entry&&sig[i].sell)pending='sell';else if(!entry&&sig[i].buy)pending='buy';
  }
  return {equity,trades,returnPct:equity.at(-1).value-100,buyHoldPct:null,maxDrawdownPct:maxDrawdown*100,winRate:trades.length?100*trades.filter(t=>t.net>0).length/trades.length:null,openPosition:!!entry,signal:sig.at(-1),lastPrice:rows.at(-1).close,audit,entry,cashPending:cashClaims()/capital*100,sellable:!!entry?.sellableDate&&rows.at(-1).date>=entry.sellableDate&&shares>=lot,execution:'vn',capitalVnd:capital,cashVnd:cash,shares,sharesPending:stockPending.reduce((s,x)=>s+x.shares,0),oddLotShares:shares%100,corporateEvents:events,claims:{cash:receivables,stock:stockPending},limitations:['Lô lẻ còn lại được định giá theo close, chưa giả định có thể bán bằng giá lô chẵn.','Giới hạn tham gia dùng TB20 phiên trước; không bảo đảm khớp tại mở cửa hoặc tái tạo hàng đợi ATO/ATC.','Cổ tức dùng số tiền ròng và tỷ lệ điều chỉnh do người dùng cung cấp; không tự suy ra thuế quyền.']};
}
