import {readJsonResponse,DataError} from '../public/lab/http-json.mjs';
import {buildDnseUrl,buildCafeUrl,normalizeDnse,normalizeCafe} from './ohlcv.ts';
import {sha256} from './hashes.mjs';
export const SOURCE_ADAPTER_VERSION='daily-capture-2026.10.06.1';
export async function captureSource(provider,{symbol,from,to,declaration={priceUnit:'unknown',priceBasis:'unknown',volumeKind:'unknown'}},fetcher=fetch){
  if(!['dnse','cafef'].includes(provider)||!/^[A-Z0-9]{2,10}$/.test(symbol))throw new Error('Nguồn hoặc mã không hợp lệ.');
  const spec=provider==='cafef'?{priceUnit:'thousand-VND',priceBasis:'raw',volumeKind:'matched'}:declaration;
  const base={provider,label:provider==='dnse'?'DNSE chart':'CafeF history',acquisition:'server',adapterVersion:SOURCE_ADAPTER_VERSION,...spec,declarationSource:provider==='cafef'?'CafeF history columns; adapter mapping':'user-declared; chart endpoint metadata undocumented',upstreamIndependence:'unknown',error:null,code:null,attempts:[],bars:[]};
  const urls=provider==='dnse'?[buildDnseUrl(symbol,from,to),buildDnseUrl(symbol,from,to,true)]:[buildCafeUrl(symbol,from,to)];
  for(let i=0;i<urls.length;i++){
    const url=urls[i],attempt={url,requestedAt:new Date().toISOString(),httpStatus:null,error:null};base.attempts.push(attempt);
    try{
      // Workers supports follow/manual only. Reject redirects after receiving the
      // response instead of using redirect:'error', which throws before fetching.
      const response=await fetcher(url,{headers:{Accept:'application/json'},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(10000)});attempt.httpStatus=response.status;
      if(response.status>=300&&response.status<400)throw new DataError('DATA_PROVIDER_REDIRECT','Nguồn giá chuyển hướng khỏi API; chưa có dữ liệu mới.',response.status);
      if(!response.ok){attempt.error='DATA_PROVIDER_HTTP_ERROR: HTTP '+response.status;attempt.code='DATA_PROVIDER_HTTP_ERROR';if([404,502,503,504].includes(response.status)&&i+1<urls.length)continue;throw new Error(attempt.error);}
      const parsed=await readJsonResponse(response,{onRaw:async raw=>{base.rawHash=await sha256(raw);}}),rawHash=base.rawHash;let all;try{all=(provider==='dnse'?normalizeDnse:normalizeCafe)(parsed);}catch{throw new DataError('DATA_PROVIDER_SCHEMA_ERROR','OHLCV không hợp lệ.');}const bars=all.filter(b=>b.date>=from&&b.date<=to);
      const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);if(all.some(b=>b.date>today))throw new DataError('DATA_PROVIDER_SCHEMA_ERROR','Nguồn có ngày tương lai.');
      if(bars.length<2||bars.length>1000)throw new DataError('DATA_PROVIDER_SCHEMA_ERROR','Cần 2–1.000 nến trong khoảng yêu cầu; nguồn có thể trả thiếu hoặc giới hạn lịch sử.');
      return {...base,status:'ok',capturedAt:new Date().toISOString(),url,rawHash,seriesHash:await sha256(bars),providerDate:response.headers.get('date'),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),responseBars:all.length,bars};
    }catch(e){
      attempt.code=e.code||attempt.code||(e.name==='TimeoutError'?'DATA_PROVIDER_TIMEOUT':'DATA_UNAVAILABLE');
      attempt.error=(e instanceof Error?e.message:'Không lấy được nguồn').slice(0,200);
      // A blocked/rate-limited or malformed response is never bypassed by another hostname.
      if(attempt.httpStatus!==null||i===urls.length-1)return {...base,status:'error',capturedAt:new Date().toISOString(),error:attempt.error,code:attempt.code};
    }
  }
  return {...base,status:'error',capturedAt:new Date().toISOString(),error:'Không lấy được dữ liệu.'};
}
