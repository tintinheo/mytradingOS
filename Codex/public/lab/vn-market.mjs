export const MARKET_VERSION='vn-equity-2026.09.29.1';
export const RULES_FROM='2025-05-05';
export const EXCHANGE_RULES={HOSE:{band:0.07,lot:100,maxOrder:500000},HNX:{band:0.10,lot:100,maxOrder:Infinity},UPCOM:{band:0.15,lot:100,maxOrder:Infinity}};
const fail=m=>{throw new Error(`Hồ sơ thị trường: ${m}`);};
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const object=(o,keys)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))fail('trường dữ liệu không hợp lệ.');};
const positive=n=>Number.isFinite(n)&&n>0;
const dates=(a,key)=>{if(!Array.isArray(a)||a.length>5500)fail('tối đa 5.500 phiên.');let previous='';for(const x of a){const d=key?x[key]:x;if(!date(d)||d<=previous)fail('ngày phải hợp lệ, tăng dần và không trùng.');previous=d;}};

export function validateMarketContext(value,symbol){
  if(value==null)return null;
  object(value,['schemaVersion','symbol','source','exchange','priceUnit','priceBasis','coverage','actionsReviewed','calendar','sessions','actions','membership','sector','benchmarks']);
  const c=JSON.parse(JSON.stringify(value));
  if(c.schemaVersion!==1||!/^[A-Z0-9]{2,10}$/.test(c.symbol)||symbol&&symbol!==c.symbol)fail('mã hoặc phiên bản không khớp.');
  if(typeof c.source!=='string'||!c.source.trim()||c.source.length>500)fail('cần nguồn đối chiếu.');
  if(!Object.hasOwn(EXCHANGE_RULES,c.exchange)||!['VND','thousand-VND'].includes(c.priceUnit)||!['raw','adjusted'].includes(c.priceBasis))fail('cần sàn, đơn vị giá và loại giá raw/adjusted.');
  object(c.coverage,['from','to']);if(!date(c.coverage.from)||!date(c.coverage.to)||c.coverage.from>c.coverage.to)fail('khoảng bao phủ không hợp lệ.');
  if(typeof c.actionsReviewed!=='boolean')fail('actionsReviewed phải là boolean.');
  c.calendar??=[];dates(c.calendar);
  c.sessions??=[];dates(c.sessions,'date');
  for(const s of c.sessions){
    object(s,['date','reference','ceiling','floor','status','kind']);
    if(!['normal','restricted','suspended'].includes(s.status)||!['regular','special'].includes(s.kind))fail('trạng thái / loại phiên không hợp lệ.');
    if(![s.reference,s.ceiling,s.floor].every(positive)||s.floor>s.reference||s.reference>s.ceiling)fail('giá tham chiếu, trần, sàn không hợp lệ.');
    if(s.kind==='regular'&&s.date>=RULES_FROM){const limits=regularLimits(s.reference,c.exchange);if(s.ceiling!==limits.ceiling||s.floor!==limits.floor)fail('biên độ phiên regular không khớp bộ quy tắc; phiên ngoại lệ phải ghi special.');}
  }
  c.actions??=[];if(!Array.isArray(c.actions)||c.actions.length>100)fail('tối đa 100 sự kiện.');
  const seen=new Set();
  for(const a of c.actions){
    object(a,['type','exDate','knownAt','priceFactor','payDate','netCashVnd','tradableDate','ratio','note']);
    if(!['cash','split','bonus','rights','other'].includes(a.type)||!date(a.exDate)||!date(a.knownAt)||a.knownAt>a.exDate)fail('sự kiện cần ngày công bố không sau ngày GDKHQ.');
    if(seen.has(a.exDate))fail('gộp sự kiện cùng ngày bằng dữ liệu điều chỉnh đã đối chiếu; chưa hỗ trợ nhiều sự kiện cùng ngày.');seen.add(a.exDate);
    if(a.priceFactor!==undefined&&(!positive(a.priceFactor)||a.priceFactor>10))fail('hệ số điều chỉnh phải dương, hữu hạn và ≤10.');
    if(a.note!==undefined&&(typeof a.note!=='string'||a.note.length>500))fail('ghi chú quá dài.');
    if(['cash','split','bonus'].includes(a.type)&&(!positive(a.priceFactor)||a.priceFactor>10))fail('sự kiện cần priceFactor đã đối chiếu.');
    if(a.type==='cash'&&(!date(a.payDate)||a.payDate<a.exDate||!Number.isFinite(a.netCashVnd)||a.netCashVnd<0))fail('cổ tức cần ngày trả và số tiền ròng trên mỗi cổ phiếu.');
    if(['split','bonus'].includes(a.type)&&(!date(a.tradableDate)||a.tradableDate<a.exDate||!positive(a.ratio)||a.ratio<1||a.ratio>100))fail('cần tỷ lệ tổng cổ phiếu mới/cũ ≥1 và ngày được bán.');
  }
  c.actions.sort((a,b)=>a.exDate.localeCompare(b.exDate));
  c.membership??=[];if(!Array.isArray(c.membership)||c.membership.length>100)fail('lịch sử VN100 quá lớn.');
  let end='';for(const m of c.membership){object(m,['from','to','knownAt','member']);if(!date(m.from)||!date(m.to)||!date(m.knownAt)||m.from>m.to||m.knownAt>m.from||m.from<=end||typeof m.member!=='boolean')fail('lịch sử VN100 phải có hiệu lực, ngày công bố và không chồng lấn.');end=m.to;}
  if(c.sector!==undefined&&(typeof c.sector!=='string'||c.sector.length>100))fail('ngành không hợp lệ.');
  c.benchmarks??={};object(c.benchmarks,['market','sector']);
  for(const list of Object.values(c.benchmarks)){dates(list,'date');for(const b of list){object(b,['date','close']);if(!positive(b.close))fail('giá chỉ số không hợp lệ.');}}
  return c;
}

export function parseContextFile(text){
  if(new TextEncoder().encode(text).length>4_000_000)fail('tệp tối đa 4 MB.');
  let json;try{json=JSON.parse(text);}catch{fail('JSON không hợp lệ.');}
  object(json,['schemaVersion','securities']);if(json.schemaVersion!==1||!Array.isArray(json.securities)||!json.securities.length||json.securities.length>100)fail('cần 1–100 mã.');
  const result=new Map();for(const raw of json.securities){const c=validateMarketContext(raw);if(result.has(c.symbol))fail('mã bị trùng.');result.set(c.symbol,c);}return result;
}
export const priceScale=c=>c?.priceUnit==='thousand-VND'?1000:1;
export function tickSize(priceVnd,exchange){if(!Object.hasOwn(EXCHANGE_RULES,exchange)||!positive(priceVnd))return null;return exchange==='HOSE'?(priceVnd<10000?10:priceVnd<50000?50:100):100;}
export function roundTick(priceVnd,exchange,direction='down'){
  const tick=tickSize(priceVnd,exchange);if(!tick)return null;
  const rounded=(direction==='up'?Math.ceil(priceVnd/tick-1e-9):Math.floor(priceVnd/tick+1e-9))*tick;
  return Math.max(tickSize(Math.max(1,rounded),exchange),rounded);
}
export function regularLimits(referenceVnd,exchange){const rule=EXCHANGE_RULES[exchange];if(!rule||!positive(referenceVnd))return null;return {ceiling:roundTick(referenceVnd*(1+rule.band),exchange,'down'),floor:roundTick(referenceVnd*(1-rule.band),exchange,'up')};}
export function nextSession(date,offset,calendar){const i=calendar.indexOf(date);return i<0?null:calendar[i+offset]??null;}
export function membershipAt(c,date){return c?.membership?.find(m=>m.from<=date&&m.to>=date&&m.knownAt<=date)?.member??null;}

// Forward normalization: actions enter only on their ex-date. Future events cannot
// change any previous technical bar. Execution always uses the original raw OHLC.
export function technicalSeries(rows,c){
  if(!c||c.priceBasis==='adjusted')return {rows:rows.map(b=>({...b})),factors:rows.map(()=>1),volumeFactors:rows.map(()=>1),boundaries:[]};
  let priceFactor=1,volumeFactor=1;const factors=[],volumeFactors=[],boundaries=[];
  const events=new Map(c.actions.map(a=>[a.exDate,a]));
  const adjusted=rows.map(b=>{
    const a=events.get(b.date);
    if(a){if(positive(a.priceFactor)){priceFactor/=a.priceFactor;if(a.ratio)volumeFactor*=a.ratio;}else boundaries.push(b.date);}
    factors.push(priceFactor);volumeFactors.push(volumeFactor);return {...b,open:b.open*priceFactor,high:b.high*priceFactor,low:b.low*priceFactor,close:b.close*priceFactor,volume:b.volume/volumeFactor};
  });return {rows:adjusted,factors,volumeFactors,boundaries};
}
export function sessionCheck(bar,c){
  if(!c)return {ok:false,reason:'Chưa có hồ sơ sàn / đơn vị / trần sàn.'};
  const s=c.sessions.find(s=>s.date===bar.date),scale=priceScale(c),eps=1e-5;
  if(!s||!c.calendar.includes(bar.date))return {ok:false,reason:'Thiếu lịch hoặc hồ sơ phiên.'};
  if(s.status!=='normal')return {ok:false,reason:`Trạng thái ${s.status}; không mô phỏng khớp từ OHLCV.`,session:s};
  if(s.kind!=='regular')return {ok:false,reason:'Phiên đặc biệt cần dữ liệu khớp riêng.',session:s};
  const tick=tickSize(bar.close*scale,c.exchange);
  const outside=bar.low*scale<s.floor-eps||bar.high*scale>s.ceiling+eps;
  const invalidTick=['open','high','low','close'].some(k=>Math.abs(bar[k]*scale/ tickSize(bar[k]*scale,c.exchange)-Math.round(bar[k]*scale/tickSize(bar[k]*scale,c.exchange)))>1e-6);
  if(outside||invalidTick)return {ok:false,reason:outside?'OHLC ngoài trần/sàn được nhập.':'OHLC không đúng bước giá.',session:s};
  return {ok:true,session:s,tick,atCeiling:bar.close*scale>=s.ceiling-eps,atFloor:bar.close*scale<=s.floor+eps};
}
export function executionReadiness(rows,c){
  const missing=[];
  if(!c)return {ready:false,missing:['Cần nhập hồ sơ thị trường: sàn, đơn vị, lịch, trần/sàn và sự kiện quyền.'],checked:0};
  if(c.priceBasis!=='raw')missing.push('Mô phỏng giao dịch yêu cầu giá raw; giá adjusted chỉ dùng nghiên cứu.');
  if(rows[0].date<RULES_FROM)missing.push(`Bộ quy tắc giao dịch chỉ dùng từ ${RULES_FROM}; chọn lại khoảng ngày.`);
  if(!c.actionsReviewed||c.coverage.from>rows[0].date||c.coverage.to<rows.at(-1).date)missing.push('Chưa đối chiếu quyền / hồ sơ cho toàn khoảng dữ liệu.');
  const set=new Set(rows.map(b=>b.date)),sm=new Map(c.sessions.map(s=>[s.date,s]));
  if(rows.some(b=>!c.calendar.includes(b.date)||!sm.has(b.date)))missing.push('Thiếu lịch hoặc trần/sàn/trạng thái cho một số phiên.');
  if(c.calendar.some(d=>d>=rows[0].date&&d<=rows.at(-1).date&&!set.has(d)&&sm.get(d)?.status!=='suspended'))missing.push('Có phiên giao dịch bị thiếu OHLCV mà chưa ghi nhận đình chỉ.');
  if(c.actions.some(a=>a.exDate>=rows[0].date&&a.exDate<=rows.at(-1).date&&['rights','other'].includes(a.type)))missing.push('Khoảng kiểm thử chứa quyền mua / sự kiện chưa có mô hình dòng tiền; chưa tính hiệu suất giao dịch.');
  if(c.actions.some(a=>a.exDate>=rows[0].date&&a.exDate<=rows.at(-1).date&&!set.has(a.exDate)))missing.push('Thiếu giá ngày GDKHQ.');
  if(rows.some(b=>{const s=sm.get(b.date);return s?.status==='normal'&&s.kind==='regular'&&!sessionCheck(b,c).ok;}))missing.push('Giá / bước giá có phiên không phù hợp hồ sơ.');
  return {ready:!missing.length,missing,checked:rows.length};
}

export function marketAssessment(rows,c,p,analysisRows=rows){
  const b=rows.at(-1),s=c?sessionCheck(b,c):{ok:false,reason:'Chưa có hồ sơ thị trường.'},readiness=executionReadiness(rows,c);
  const member=membershipAt(c,b.date),warnings=[...readiness.missing];
  const next=c?nextSession(b.date,1,c.calendar):null;
  const futureAction=c?.actions.find(a=>a.knownAt<=b.date&&a.exDate>b.date&&(!next||a.exDate<=next));
  if(futureAction)warnings.push(`Phiên tới có sự kiện ${futureAction.type} đã công bố; chờ giá tham chiếu và điều chỉnh quyền.`);
  if(member===null)warnings.push('Chưa có thành viên VN100 tại ngày phân tích.');else if(!member)warnings.push('Mã không thuộc VN100 trong hồ sơ tại ngày phân tích.');
  if(!next)warnings.push('Chưa có phiên kế tiếp trong lịch nhập.');
  const settlementDate=next?nextSession(next,3,c.calendar):null;
  if(!settlementDate)warnings.push('Cần lịch đến ít nhất T+3 của phiên dự kiến mua để kiểm tra ngày cổ phiếu về.');
  if(!s.ok)warnings.push(s.reason);
  if(s.atFloor)warnings.push('Đóng cửa sát giá sàn; không bảo đảm bán được.');
  if(s.atCeiling)warnings.push('Đóng cửa sát giá trần; không bảo đảm mua được.');
  const benchmarks={};
  for(const key of ['market','sector']){
    const map=new Map((c?.benchmarks?.[key]||[]).map(x=>[x.date,x.close]));
    const matched=analysisRows.filter(x=>map.has(x.date));
    if(matched.length>=21&&matched.at(-1).date===b.date){const a=matched.at(-21),z=matched.at(-1);const marketReturn=map.get(z.date)/map.get(a.date)-1,stockReturn=z.close/a.close-1;benchmarks[key]={from:a.date,to:z.date,sessions:20,stockReturnPct:stockReturn*100,benchmarkReturnPct:marketReturn*100,excessPct:(stockReturn-marketReturn)*100};}
    else benchmarks[key]=null;
  }
  if(!benchmarks.market)warnings.push('Thiếu chỉ số thị trường để tính sức mạnh tương đối.');
  if(!benchmarks.sector)warnings.push('Thiếu chỉ số ngành để tính sức mạnh tương đối.');
  const entryReady=readiness.ready&&s.ok&&!!next&&!!settlementDate&&!futureAction&&(!p.requireVN100||member===true);
  return {version:MARKET_VERSION,source:c?.source??null,exchange:c?.exchange??null,unit:c?.priceUnit??'unknown',priceBasis:c?.priceBasis??'unknown',member,nextSession:next,session:s,execution:readiness,entryReady,warnings:[...new Set(warnings)],benchmarks,sector:c?.sector??null,coverage:{calendar:!!c?.calendar.length,corporateActions:!!c?.actionsReviewed,dailyRules:!!c?.sessions.length,membership:member!==null,orderBook:false,market:!!benchmarks.market,sector:!!benchmarks.sector}};
}
