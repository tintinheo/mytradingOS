// Bounded diagnostics only: never retain upstream bodies, URL queries or headers.
export const ACQUISITION_FAILURE_VERSION='acquisition-failure-1';
const code=value=>typeof value==='string'&&/^DATA_[A-Z_]{1,60}$/.test(value)?value:null;
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(value)?value:null;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
const timestamp=value=>typeof value==='string'&&value.length<=30&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value?value:null;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:null;
function host(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.hostname:null;}catch{return null;}}
export function acquisitionFailure(payload){
  if(!payload||payload.code!=='DATA_UNAVAILABLE'||!['dnse','cafef'].includes(payload.source)||
    !/^[A-Z0-9]{2,10}$/.test(payload.symbol||'')||!date(payload.from)||!date(payload.to)||
    payload.from>payload.to||!Array.isArray(payload.captures)||payload.captures.length!==2)return null;
  const captures=payload.captures.map(c=>({provider:c?.provider,status:c?.status,code:code(c?.code),
    capturedAt:timestamp(c?.capturedAt),adapterVersion:token(c?.adapterVersion),
    rawHash:hash(c?.rawHash),seriesHash:hash(c?.seriesHash),
    priceUnit:token(c?.priceUnit),priceBasis:token(c?.priceBasis),volumeKind:token(c?.volumeKind),
    lastBar:date(c?.lastBar),count:Number.isInteger(c?.count)&&c.count>=0&&c.count<=1000?c.count:null,
    attempts:Array.isArray(c?.attempts)?c.attempts.slice(0,3).map(a=>({host:host(a?.url),requestedAt:timestamp(a?.requestedAt),
      httpStatus:Number.isInteger(a?.httpStatus)&&a.httpStatus>=100&&a.httpStatus<=599?a.httpStatus:null,code:code(a?.code)})):[]}));
  if(captures[0].provider!==payload.source||captures[0].status!=='error'||!captures[0].code||
    captures[1].provider!==(payload.source==='dnse'?'cafef':'dnse')||
    captures.some(c=>!['ok','error'].includes(c.status)||!c.capturedAt||c.count===null||!c.attempts.length))return null;
  // Derive the blocking state; never accept a remote eligibility/confidence flag.
  return {version:ACQUISITION_FAILURE_VERSION,symbol:payload.symbol,source:payload.source,from:payload.from,to:payload.to,
    code:'DATA_UNAVAILABLE',primaryCode:captures[0].code,fallbackAttempted:true,
    qualityStatus:captures[1].status==='ok'?'QUARANTINED':'UNAVAILABLE',recommendation:'NO SIGNAL',captures};
}
export function auditFailurePayload(error){
  return {error:String(error?.message??error).slice(0,1000),...(error?.acquisitionFailure?{acquisitionFailure:error.acquisitionFailure}:{})};
}
