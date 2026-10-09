import {acquisitionFailure} from './acquisition-failure.mjs';
// Shared by browser API clients and server providers. Never render upstream bodies.
export class DataError extends Error {
  constructor(code,message,status=0){super(message.startsWith(`${code}:`)?message:`${code}: ${message}`);this.name='DataError';this.code=code;this.status=status;this.retry=status>=500||status===429;}
}
function apiError(code,message,response,endpoint){
  let path='';try{path=new URL(endpoint||response.url,'https://app.invalid').pathname;}catch{}
  const error=new DataError(code,`${message}${path?` (${path}, HTTP ${response.status})`:''}`,response.status);
  error.endpoint=path;
  if(globalThis.window?.dispatchEvent&&typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('vn100-api-error',{detail:{code,message:error.message}}));
  return error;
}
export async function readJsonResponse(response,{maxBytes=4000000,onRaw,trustedApi=false,endpoint}={}){
  if(trustedApi){
    let signInRedirect=false;try{signInRedirect=response.redirected&&/\/(?:signin-with-chatgpt|callback)(?:\/|$)/.test(new URL(response.url).pathname);}catch{}
    if(response.status===401||signInRedirect)throw apiError('API_AUTH_REQUIRED','Phiên đăng nhập chưa hợp lệ. Đăng nhập lại rồi chạy phân tích.',response,endpoint);
  }
  if(!response.ok&&!trustedApi)throw new DataError('DATA_PROVIDER_HTTP_ERROR',`HTTP ${response.status}. Không có kết quả mới; thử lại sau hoặc chọn nguồn khác.`,response.status);
  const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const htmlError=()=>trustedApi?apiError('API_HTML_RESPONSE','Dịch vụ ứng dụng trả trang HTML thay vì JSON. Mở lại ứng dụng rồi thử lại; đây chưa phải phản hồi từ nguồn giá.',response,endpoint):new DataError('DATA_PROVIDER_HTML_RESPONSE','Nguồn giá trả trang HTML thay vì dữ liệu; chưa tính tín hiệu mới.',response.status);
  if(type==='text/html'||type==='application/xhtml+xml')throw htmlError();
  if(!/^application\/(?:[a-z0-9.+-]+\+)?json$/.test(type))throw new DataError('DATA_PROVIDER_CONTENT_TYPE','Dịch vụ không trả Content-Type JSON.',response.status);
  if(Number(response.headers.get('content-length'))>maxBytes)throw new DataError('DATA_PROVIDER_TOO_LARGE','Phản hồi vượt giới hạn dung lượng.');
  if(!response.body)throw new DataError('DATA_PROVIDER_INVALID_JSON','Phản hồi rỗng.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new DataError('DATA_PROVIDER_TOO_LARGE','Phản hồi vượt giới hạn dung lượng.');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  const raw=new TextDecoder().decode(bytes);if(onRaw)await onRaw(raw);
  if(/^\s*</.test(raw))throw htmlError();
  let parsed;try{parsed=JSON.parse(raw);}catch{throw new DataError('DATA_PROVIDER_INVALID_JSON','JSON hỏng hoặc không đầy đủ; không tính tín hiệu.');}
  if(!response.ok){
    const error=new DataError(typeof parsed?.code==='string'?parsed.code:'DATA_PROVIDER_HTTP_ERROR',typeof parsed?.error==='string'?parsed.error.slice(0,500):`HTTP ${response.status}`,response.status);
    if(trustedApi&&endpoint?.split('?')[0]==='/api/ohlcv'){
      const evidence=acquisitionFailure(parsed);if(evidence)error.acquisitionFailure=evidence;
    }
    throw error;
  }
  return parsed;
}
export async function requestJson(url,options={},timeout=30000,fetcher=fetch){
  const controller=new AbortController(),parent=options.signal,abort=()=>controller.abort();
  if(parent?.aborted)abort();else parent?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,timeout);
  try{return await readJsonResponse(await fetcher(url,{credentials:'same-origin',...options,signal:controller.signal}),{trustedApi:true,endpoint:url});}
  catch(e){if(controller.signal.aborted)throw new DataError('DATA_PROVIDER_TIMEOUT','Yêu cầu đã hủy hoặc quá thời gian.');if(e instanceof DataError)throw e;throw new DataError('DATA_UNAVAILABLE','Không kết nối được dịch vụ.');}
  finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);}
}
