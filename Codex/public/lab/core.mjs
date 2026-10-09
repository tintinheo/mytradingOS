import {providerSessionDate,ohlcvNumber} from './ohlcv-values.mjs';
import {entryGeometry} from './trade-plan.mjs';
import {indicators,swingSignal,swingForecast} from './swing.mjs';
import {technicalSeries,membershipAt} from './vn-market.mjs';
import {priceRiskTimeline} from './price-risk.mjs';
import {vnBacktest} from './vn-execution.mjs';
const average = a => a.reduce((x, y) => x + y, 0) / a.length;
const sumRange = (rows, end, count, field) => {
  if (end - count + 1 < 0) return NaN;
  let total = 0;
  for (let i = end - count + 1; i <= end; i++) total += rows[i][field];
  return total / count;
};

function csvCells(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted && c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      if (c === ',') { row.push(cell.trim()); cell = ''; }
      else if (c === '\n' || text[i + 1] !== '\n') {
        row.push(cell.trim()); cell = '';
        if (row.some(x => x !== '')) rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  row.push(cell.trim()); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

function isoDate(input) {
  let y, m, d; const value = String(input).trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) [, y, m, d] = match;
  else { match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value); if (!match) throw new Error(`Invalid date: ${value}`); [, d, m, y] = match; }
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) throw new Error(`Invalid date: ${value}`);
  return date.toISOString().slice(0, 10);
}

export function parseCsv(text, filename = '') {
  const rows = csvCells(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('CSV needs a header and at least one daily bar.');
  const aliases = {symbol:'ticker', stock:'ticker', tradingdate:'date', time:'date', openprice:'open', highprice:'high', highest:'high', lowprice:'low', lowest:'low', closeprice:'close', totalvolume:'volume'};
  const headers = rows[0].map(x => { const key = x.toLowerCase().replace(/[\s_-]/g, ''); return aliases[key] || key; });
  for (const field of ['date','open','high','low','close','volume']) if (!headers.includes(field)) throw new Error(`Missing CSV column: ${field}.`);
  const fallback = /^[A-Z]{2,10}$/.test(filename.replace(/\.csv$/i,'').toUpperCase()) ? filename.replace(/\.csv$/i,'').toUpperCase() : '';
  if (!headers.includes('ticker') && !fallback) throw new Error('Add a ticker column, or name a one-symbol file VCB.csv.');
  const result = new Map(); const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const record = Object.fromEntries(headers.map((h,j) => [h, rows[i][j]]));
    const ticker = String(record.ticker || fallback).trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(ticker)) throw new Error(`Row ${i + 1}: invalid ticker.`);
    let date; try { date = isoDate(record.date); } catch(e) { throw new Error(`Row ${i + 1}: ${e.message}`); }
    if (seen.has(`${ticker}:${date}`)) throw new Error(`Duplicate daily bar: ${ticker} ${date}.`);
    seen.add(`${ticker}:${date}`);
    const bar = {date};
    for (const field of ['open','high','low','close','volume']) {
      if (record[field] === undefined || String(record[field]).trim() === '') throw new Error(`Row ${i + 1}: missing ${field}.`);
      bar[field] = Number(String(record[field]).replace(/,/g, ''));
      if (!Number.isFinite(bar[field]) || (field !== 'volume' && bar[field] <= 0) || (field === 'volume' && bar[field] < 0)) throw new Error(`Row ${i + 1}: invalid ${field}.`);
    }
    if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) throw new Error(`Row ${i + 1}: OHLC range is inconsistent.`);
    if (!result.has(ticker)) result.set(ticker, []);
    result.get(ticker).push(bar);
  }
  for (const bars of result.values()) bars.sort((a,b) => a.date.localeCompare(b.date));
  return result;
}

export function mergeData(data, incoming) {
  const output = new Map(data);
  for (const [symbol, bars] of incoming) {
    const existing = output.get(symbol) || [];
    const seen = new Set(existing.map(b => b.date));
    for (const b of bars) if (seen.has(b.date)) throw new Error(`${symbol}: duplicate ${b.date} across imported files. Clear or combine files before import.`);
    output.set(symbol, [...existing, ...bars].sort((a,b) => a.date.localeCompare(b.date)));
  }
  return output;
}

export function withDefaults(p){
  return {settlement:3,cashDelay:3,maxHold:10,stopMode:'percent',atrStop:2,atrTarget:3,sellTax:0.1,minVolume:100000,trapFilter:'off',execution:'research',capitalVnd:100000000,participation:1,requireVN100:false,...p};
}
export function optionsValid(input) {
  const p=withDefaults(input);
  for (const [key,min,max] of [['fast',2,100],['slow',3,250],['lookback',5,100],['stop',0.5,50],['target',0,100],['risk',0.1,10],['fee',0,5],['atrStop',0.5,10],['atrTarget',0,20],['maxHold',0,60],['sellTax',0,5],['minVolume',0,1000000000]]) {
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new Error(`${key}: enter a value from ${min} to ${max}.`);
  }
  for(const k of ['fast','slow','lookback','maxHold','minVolume'])if(!Number.isInteger(p[k]))throw new Error(`${k}: whole sessions / shares required.`);
  if (p.strategy === 'sma' && p.fast >= p.slow) throw new Error('Fast moving average must be shorter than slow moving average.');
  if (!['sma','breakout','hold','pullback','confirmed','range'].includes(p.strategy)) throw new Error('Unknown strategy.');
  if (![0,1,1.5].includes(p.volumeFilter)) throw new Error('Unknown volume filter.');
  if(![0,3].includes(p.settlement)||![0,3].includes(p.cashDelay))throw new Error('Unknown settlement assumption.');
  if(!['percent','atr'].includes(p.stopMode))throw new Error('Unknown stop mode.');
  if(p.maxHold&&p.maxHold<p.settlement)throw new Error('Holding limit must be at least 3 sessions under conservative T+ settlement.');
  if(!['off','high'].includes(p.trapFilter)||!['research','vn'].includes(p.execution)||typeof p.requireVN100!=='boolean')throw new Error('Unknown market / risk setting.');
  if(!Number.isInteger(p.capitalVnd)||p.capitalVnd<1000000||p.capitalVnd>100000000000||!Number.isFinite(p.participation)||p.participation<0.1||p.participation>10)throw new Error('Vốn: 1 triệu–100 tỷ VND; tỷ lệ tham gia: 0,1–10%.');
  if(p.execution==='vn'&&(p.settlement!==3||p.cashDelay!==3))throw new Error('Mô phỏng VN dùng T+3 mở cửa cho cổ phiếu và tiền, không ứng trước.');
}

export function signals(rawRows, input, context=null) {
  const series=technicalSeries(rawRows,context),rows=series.rows;
  if(series.boundaries.length){const boundaries=new Set(series.boundaries);let start=0,result=[];for(let i=1;i<=rawRows.length;i++)if(i===rawRows.length||boundaries.has(rawRows[i]?.date)){result.push(...signals(rows.slice(start,i),input));start=i;}return result;}
  const p=withDefaults(input),features=indicators(rows);
  const values = rows.map((_,i) => {
    if (p.strategy === 'hold') return {buy:i === 0, sell:false};
    if(['pullback','confirmed','range'].includes(p.strategy))return swingSignal(rows,features,i,p.strategy);
    if (p.strategy === 'sma') {
      if (i < p.slow) return {buy:false,sell:false};
      const now = sumRange(rows,i,p.fast,'close') - sumRange(rows,i,p.slow,'close');
      const prev = sumRange(rows,i-1,p.fast,'close') - sumRange(rows,i-1,p.slow,'close');
      return {buy:prev <= 0 && now > 0, sell:prev >= 0 && now < 0};
    }
    if (i < p.lookback) return {buy:false,sell:false};
    const previous = rows.slice(i-p.lookback,i).map(b=>b.close);
    return {buy:rows[i].close > Math.max(...previous),sell:rows[i].close < Math.min(...previous)};
  });
  if(p.strategy!=='hold')for(let i=0;i<values.length;i++){
    const baseline=features[i].avgVol;
    if((p.volumeFilter||p.minVolume)&&(!Number.isFinite(baseline)||baseline*series.volumeFactors[i]<p.minVolume||baseline<=0||rows[i].volume<baseline*p.volumeFilter))values[i].buy=false;
  }
  return values;
}

export function backtest(rows, input, context=null, riskData=null) {
  const p=withDefaults(input);optionsValid(p);
  if (rows.length < 2) throw new Error('At least two daily bars are needed for a backtest.');
  const series=technicalSeries(rows,context),sig=signals(rows,p,context),features=indicators(series.rows),fee=p.fee/100,tax=p.sellTax/100;
  const risks=riskData||priceRiskTimeline(series.rows,{boundaries:series.boundaries});
  if(p.execution==='vn'){
    const result=vnBacktest(rows,p,context,sig,features,series.factors,risks.timeline);
    result.buyHoldPct=p.strategy==='hold'?result.returnPct:vnBacktest(rows,{...p,strategy:'hold',trapFilter:'off'},context,signals(rows,{...p,strategy:'hold'},context),features,series.factors,risks.timeline).returnPct;
    return result;
  }
  let cash=100,shares=0,entry=null,pending=null,peak=100,maxDrawdown=0,heldOnce=false;
  const equity=[],trades=[],receivables=[],audit={lockedStopBars:0,blockedFillBars:0,cashBlockedEntries:0,trapBlockedEntries:0,membershipBlockedEntries:0};
  const sell=(price,reason,bar,i)=>{
    const proceeds=shares*price*(1-fee-tax);
    if(p.cashDelay)receivables.push({value:proceeds,release:i+p.cashDelay});else cash+=proceeds;
    trades.push({entryDate:entry.date,exitDate:bar.date,entryPrice:entry.price,exitPrice:price,reason,net:proceeds/entry.cost-1,holding:i-entry.index});
    shares=0;entry=null;
  };
  for (let i=0;i<rows.length;i++) {
    const bar=rows[i];
    for(let j=receivables.length-1;j>=0;j--)if(receivables[j].release<=i){cash+=receivables[j].value;receivables.splice(j,1);}
    // Conservative full-bar fillability proxy, not an order-book reconstruction.
    const fillable=bar.volume>0&&bar.high>bar.low;
    let sold=false;
    if(shares){
      const age=i-entry.index,eligible=age>=p.settlement;
      const reason=entry.deferred||(pending==='sell'?'Signal':p.strategy!=='hold'&&p.maxHold&&age>=p.maxHold?'Time exit':null);
      if(reason){
        if(eligible&&fillable){sell(bar.open,reason,bar,i);sold=true;}
        else {entry.deferred=reason;if(eligible&&!fillable)audit.blockedFillBars++;}
      }
    }
    if(!shares&&!sold&&(!p.tradeFromDate||bar.date>=p.tradeFromDate)&&(pending==='buy'||p.strategy==='hold'&&!heldOnce&&i>=1)){
      if(p.strategy!=='hold'&&p.trapFilter==='high'&&risks.timeline[i-1]?.blockEntry)audit.trapBlockedEntries++;
      else if(p.requireVN100&&membershipAt(context,rows[i-1]?.date)!==true)audit.membershipBlockedEntries++;
      else if(!fillable)audit.blockedFillBars++;
      else if(cash<=1e-9)audit.cashBlockedEntries++;
      else {
        const geometry=entryGeometry(bar.open,features[i-1]?.atr/series.factors[i],p,null),stopDistance=geometry.distance;
        const valid=p.strategy==='hold'||geometry.valid;
        if(valid){
          const exposure=p.strategy==='hold'?1:Math.min(1,(p.risk/100)/(stopDistance/bar.open));
          const notional=cash*exposure/(1+fee);shares=notional/bar.open;
          const cost=notional*(1+fee);cash-=cost;heldOnce=true;
          entry={date:bar.date,index:i,price:bar.open,cost,stop:bar.open-stopDistance,target:p.stopMode==='atr'?(p.atrTarget?bar.open+p.atrTarget*features[i-1].atr/series.factors[i]:null):(p.target?bar.open*(1+p.target/100):null),deferred:null};
        }
      }
    }
    pending=null;
    if(shares&&p.strategy!=='hold'){
      const eligible=i-entry.index>=p.settlement;
      if(!eligible||!fillable){
        if(bar.low<=entry.stop){entry.deferred='Deferred stop';if(!eligible)audit.lockedStopBars++;else audit.blockedFillBars++;}
      }else {
        let price=null,reason=null;
        if(bar.open<=entry.stop){price=bar.open;reason='Stop gap';}
        else if(entry.target&&bar.open>=entry.target){price=bar.open;reason='Target gap';}
        else if(bar.low<=entry.stop){price=entry.stop;reason='Stop';}
        else if(entry.target&&bar.high>=entry.target){price=entry.target;reason='Target';}
        if(price!==null)sell(price,reason,bar,i);
      }
    }
    const value=cash+receivables.reduce((s,r)=>s+r.value,0)+shares*bar.close;
    peak=Math.max(peak,value);maxDrawdown=Math.max(maxDrawdown,1-value/peak);
    equity.push({date:bar.date,value});
    if(shares&&sig[i].sell)pending='sell';else if(!shares&&sig[i].buy)pending='buy';
  }
  const last=equity.at(-1).value;
  const firstFill=rows.findIndex((b,i)=>i>=1&&(!p.tradeFromDate||b.date>=p.tradeFromDate)&&b.volume>0&&b.high>b.low&&(!p.requireVN100||membershipAt(context,rows[i-1].date)===true));
  const baseline=firstFill<0?100:100/(1+fee)*(rows.at(-1).close/rows[firstFill].open);
  return {equity,trades,returnPct:last-100,buyHoldPct:baseline-100,maxDrawdownPct:maxDrawdown*100,winRate:trades.length?100*trades.filter(t=>t.net>0).length/trades.length:null,openPosition:!!shares,signal:sig.at(-1),lastPrice:rows.at(-1).close,audit,entry,cashPending:receivables.reduce((s,r)=>s+r.value,0),sellable:entry?rows.length-1-entry.index>=p.settlement:false};
}

export function forecast(rows,method){return swingForecast(rows,method,10);}

export function demoBars(seed=1) {
  let state=seed*314159+19, value=seed===1?42:seed===2?76:29, day=new Date(Date.UTC(2025,0,2));
  const bars=[];
  while(bars.length<260) {
    if(day.getUTCDay()!==0 && day.getUTCDay()!==6) {
      state=(state*1664525+1013904223)>>>0; const u=state/4294967296;
      const open=value*(1+(u-0.5)*0.025);
      const trend=(seed===2?-0.0001:0.00035)+Math.sin(bars.length/19+seed)*0.003;
      value=Math.max(3,open*(1+trend+(u-0.5)*0.055));
      const high=Math.max(open,value)*(1+u*0.012),low=Math.min(open,value)*(1-(1-u)*0.012);
      bars.push({date:day.toISOString().slice(0,10),open,high,low,close:value,volume:Math.round((0.6+u*1.4)*1500000)});
    }
    day.setUTCDate(day.getUTCDate()+1);
  }
  return bars;
}

export function normalizeDnseClient(payload) {
  const raw=payload?.data||payload;
  if(!raw||!Array.isArray(raw.t)||!['o','h','l','c','v'].every(k=>Array.isArray(raw[k])&&raw[k].length===raw.t.length)) throw new Error('DNSE response has an unknown format.');
  const rows=raw.t.map((stamp,i)=>{
    const date=providerSessionDate(stamp);
    const [open,high,low,close,volume]=['o','h','l','c','v'].map(k=>ohlcvNumber(raw[k][i]));
    if([open,high,low,close,volume].some(n=>!Number.isFinite(n))||Math.min(open,high,low,close)<=0||volume<0||high<Math.max(open,close,low)||low>Math.min(open,close,high))throw new Error(`Invalid bar at ${date}`);
    return {date,open,high,low,close,volume};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  for(let i=1;i<rows.length;i++)if(rows[i].date===rows[i-1].date)throw new Error(`Duplicate bar ${rows[i].date}`);
  return rows;
}
