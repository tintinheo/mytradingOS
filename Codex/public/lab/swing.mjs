// Daily, long-only research primitives. All features at index i use bars <= i.
export const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : NaN;
const sd = a => Math.sqrt(mean(a.map(v=>(v-mean(a))**2)));
export function quantile(a,p){
  if(!a.length)return NaN;
  const s=[...a].sort((x,y)=>x-y),n=(s.length-1)*p,l=Math.floor(n);
  return s[l]+(s[Math.ceil(n)]-s[l])*(n-l);
}
function smooth(values,n,alpha){
  let previous=NaN,seed=[];
  return values.map(v=>{
    if(!Number.isFinite(v))return NaN;
    if(!Number.isFinite(previous)){
      seed.push(v);if(seed.length<n)return NaN;
      previous=mean(seed);
    }else previous+=alpha*(v-previous);
    return previous;
  });
}
const wilder=(a,n)=>smooth(a,n,1/n);
export function indicators(rows){
  const c=rows.map(b=>b.close),e20=smooth(c,20,2/21),e50=smooth(c,50,2/51);
  const tr=[],up=[],down=[],gain=[],loss=[];
  rows.forEach((b,i)=>{
    const prev=rows[i-1];
    tr.push(prev?Math.max(b.high-b.low,Math.abs(b.high-prev.close),Math.abs(b.low-prev.close)):b.high-b.low);
    const u=prev?b.high-prev.high:0,d=prev?prev.low-b.low:0;
    up.push(i?(u>d&&u>0?u:0):NaN);down.push(i?(d>u&&d>0?d:0):NaN);
    gain.push(i?Math.max(b.close-prev.close,0):NaN);loss.push(i?Math.max(prev.close-b.close,0):NaN);
  });
  const atr=wilder(tr,14),du=wilder(up,14),dd=wilder(down,14),g=wilder(gain,14),l=wilder(loss,14);
  const dx=du.map((v,i)=>Number.isFinite(v)?(v+dd[i]===0?0:100*Math.abs(v-dd[i])/(v+dd[i])):NaN),adx=wilder(dx,14);
  return rows.map((b,i)=>{
    const window=c.slice(Math.max(0,i-19),i+1),mid=i>=19?mean(window):NaN,dev=i>=19?sd(window):NaN;
    const avgVol=i>=20?mean(rows.slice(i-20,i).map(x=>x.volume)):NaN;
    const rsi=Number.isFinite(g[i])?(g[i]+l[i]===0?50:l[i]===0?100:100-100/(1+g[i]/l[i])):NaN;
    const regime=i<59?'unknown':adx[i]<20?'range':adx[i]>=25?(e20[i]>e50[i]&&b.close>e50[i]?'up':e20[i]<e50[i]&&b.close<e50[i]?'down':'mixed'):'mixed';
    return {ema20:e20[i],ema50:e50[i],atr:atr[i],atrPct:100*atr[i]/b.close,rsi,adx:adx[i],mid,upper:mid+2*dev,lower:mid-2*dev,avgVol,relVolume:avgVol>0?b.volume/avgVol:NaN,regime};
  });
}
export const regimeNames={unknown:'Chưa đủ 60 phiên',up:'Xu hướng tăng',down:'Xu hướng giảm',range:'Đi ngang / ADX thấp',mixed:'Chuyển tiếp / chưa rõ'};
export function profile(rows,minimumVolume=100000){
  const features=indicators(rows),last=features.at(-1);
  if(!last)return null;
  const recent=rows.slice(-60),gaps=recent.slice(1).map((b,i)=>Math.abs(b.open/recent[i].close-1)*100);
  const flat=recent.filter(b=>b.volume===0||b.high===b.low).length;
  const atrHistory=features.slice(-253,-1).map(f=>f.atrPct).filter(Number.isFinite);
  const atrRank=atrHistory.length>=60?100*atrHistory.filter(v=>v<=last.atrPct).length/atrHistory.length:NaN;
  const warnings=[];
  if(rows.length<120)warnings.push('Lịch sử ngắn: nên có ít nhất 120 phiên; dự báo cần mẫu kiểm định riêng.');
  if(last.avgVol<minimumVolume)warnings.push('Khối lượng trung bình thấp hơn ngưỡng bạn đặt: chặn tín hiệu mua mới.');
  if(last.atrPct>4)warnings.push('ATR trên 4% giá: nhạy với gap và rủi ro chưa bán được trong T+. Ngưỡng mô tả do lab đặt.');
  if(atrRank>=80)warnings.push('ATR% đang ở nhóm 20% cao nhất lịch sử gần đây của chính mã này; giả định biến động ổn định có thể không phù hợp.');
  if(flat)warnings.push(`${flat}/${recent.length} nến gần nhất không có khối lượng hoặc chỉ có một mức giá; giả định bỏ qua khớp lệnh trên các nến này.`);
  const jumps=rows.slice(1).filter((b,i)=>Math.abs(b.close/rows[i].close-1)>.20).length;
  if(jumps)warnings.push(`${jumps} biến động đóng cửa trên 20%: kiểm tra điều chỉnh quyền, đơn vị giá hoặc dữ liệu sai.`);
  const guide={up:'Ưu tiên kiểm tra pullback và breakout; so sánh drawdown, số lệnh và chi phí trước khi diễn giải.',down:'Chế độ long-only: thận trọng mở mua. RSI thấp không đủ chứng minh giá sắp hồi.',range:'Có thể thử hồi về trung bình; một cú phá vùng có thể làm giả định đi ngang mất hiệu lực.',mixed:'Chưa có trạng thái rõ: quan sát thêm hoặc đối chiếu nhiều giả thuyết.',unknown:'Cần thêm lịch sử để phân loại đặc tính mã.'}[last.regime];
  return {...last,atrRank,gap90:quantile(gaps,.9),flat,warnings,guide,rows:rows.length};
}
export function swingSignal(rows,features,i,strategy){
  const f=features[i],prev=features[i-1],b=rows[i];
  if(i<59)return {buy:false,sell:false};
  if(strategy==='pullback')return {buy:f.regime==='up'&&prev.rsi<50&&f.rsi>=50&&b.close>f.ema20,sell:b.close<f.ema20};
  if(strategy==='confirmed')return {buy:f.regime==='up'&&b.close>Math.max(...rows.slice(i-20,i).map(x=>x.high))&&f.relVolume>=1.5,sell:b.close<f.ema20};
  if(strategy==='range')return {buy:f.regime==='range'&&rows[i-1].close<prev.lower&&b.close>=f.lower&&prev.rsi<35,sell:b.close>=f.mid||f.adx>=25};
  return {buy:false,sell:false};
}
export const modelNames={naive:'Giá không đổi',momentum:'Drift 20 phiên',reversion:'Hồi về MA20',regime:'Lịch sử cùng trạng thái'};
// The terminal outcome of a candidate may only enter training after it is observed.
export function predictAt(rows,features,method,origin,h){
  if(origin<59)return null;
  const last=rows[origin].close;
  if(method==='naive')return {center:last};
  if(method==='momentum')return {center:last*Math.exp(Math.log(last/rows[origin-20].close)/20*h)};
  if(method==='reversion'){
    const m=mean(rows.slice(origin-19,origin+1).map(b=>b.close));
    return {center:m+(last-m)*.9**h};
  }
  if(method!=='regime')throw new Error('Unknown forecast method.');
  const sample=[];
  for(let t=origin-h;t>=Math.max(59,origin-504);t-=h){
    if(features[t].regime===features[origin].regime)sample.push(Math.log(rows[t+h].close/rows[t].close));
  }
  if(sample.length<12)return null;
  return {center:last*Math.exp(quantile(sample,.5)),lower:last*Math.exp(quantile(sample,.1)),upper:last*Math.exp(quantile(sample,.9)),sampleCount:sample.length,upFrequency:sample.filter(v=>v>0).length/sample.length};
}
function forecastAt(rows,features,method,origin,h){
  const f=predictAt(rows,features,method,origin,h);
  if(!f)return null;
  if(method==='regime')return f;
  const residuals=[];
  for(let t=origin-h;t>=Math.max(59,origin-504);t-=h){
    const p=predictAt(rows,features,method,t,h);
    residuals.push(Math.log(rows[t+h].close/p.center));
  }
  if(residuals.length<12)return {...f,lower:null,upper:null,sampleCount:residuals.length};
  return {...f,lower:f.center*Math.exp(quantile(residuals,.1)),upper:f.center*Math.exp(quantile(residuals,.9)),sampleCount:residuals.length};
}
export function swingForecast(rows,method,h=5){
  if(![3,5,10].includes(h))throw new Error('Forecast horizon must be 3, 5 or 10 sessions.');
  if(method==='none'||rows.length<60)return null;
  const features=indicators(rows),i=rows.length-1,last=rows[i].close;
  const f=forecastAt(rows,features,method,i,h);
  if(!f)return null;
  const points=Array.from({length:h},(_,j)=>{
    const step=j+1,center=method==='regime'?last*Math.exp(Math.log(f.center/last)*step/h):predictAt(rows,features,method,i,step).center;
    return {step,center,lower:f.lower===null?center:center*Math.exp(Math.log(f.lower/f.center)*Math.sqrt(step/h)),upper:f.upper===null?center:center*Math.exp(Math.log(f.upper/f.center)*Math.sqrt(step/h))};
  });
  return {...f,method,horizon:h,points,hasBand:f.lower!==null};
}
export function validateForecasts(rows,h=5){
  if(![3,5,10].includes(h))throw new Error('Invalid horizon');
  const features=indicators(rows),origins=[];
  // Non-overlapping targets; each model's baseline uses its own valid origins.
  for(let i=rows.length-1-h;i>=Math.max(119,rows.length-1-h*40);i-=h)origins.unshift(i);
  const naive=origins.map(i=>({i,actual:rows[i+h].close,base:rows[i].close}));
  return Object.keys(modelNames).map(method=>{
    const observations=[];
    for(const b of naive){
      const f=forecastAt(rows,features,method,b.i,h);if(!f)continue;
      observations.push({...b,...f,date:rows[b.i].date});
    }
    const bands=observations.filter(o=>o.lower!==null&&o.lower!==undefined);
    const directional=observations.filter(o=>Math.abs(o.center/o.base-1)>1e-10);
    const error=mean(observations.map(o=>100*Math.abs(o.center-o.actual)/o.base));
    const baseline=mean(observations.map(o=>100*Math.abs(o.base-o.actual)/o.base));
    return {method,n:observations.length,error,baseline,skill:baseline>0?100*(1-error/baseline):null,direction:directional.length?100*mean(directional.map(o=>Number(Math.sign(o.center-o.base)===Math.sign(o.actual-o.base)))):null,coverage:bands.length?100*mean(bands.map(o=>Number(o.actual>=o.lower&&o.actual<=o.upper))):null,bandN:bands.length,first:observations[0]?.date,last:observations.at(-1)?.date};
  });
}
