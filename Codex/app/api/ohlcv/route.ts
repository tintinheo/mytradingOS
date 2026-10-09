import {NextRequest,NextResponse} from 'next/server';
import {loadHistory} from '@/lib/history-service.mjs';

export const runtime='edge';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store, max-age=0'}});

export async function GET(request:NextRequest) {
  const u=request.nextUrl.searchParams;
  const symbol=(u.get('symbol')||'').toUpperCase();
  const from=u.get('from')||'',to=u.get('to')||'';
  if(!/^[A-Z0-9]{2,10}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return reply({error:'Use a symbol and ISO date range.'},400);
  const start=Date.parse(`${from}T00:00:00Z`),end=Date.parse(`${to}T00:00:00Z`);
  if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start).toISOString().slice(0,10)!==from||new Date(end).toISOString().slice(0,10)!==to||start>end||end-start>10*366*86400000||end>Date.now()+86400000) return reply({error:'Choose a valid range up to ten years ending today.'},400);
  const source=u.get('source')||'dnse';
  if(!['dnse','cafef'].includes(source)) return reply({error:'This feed is not configured. Choose DNSE, CafeF or import CSV.'},503);
  const captured=await loadHistory(source,{symbol,from,to});
  if(captured.status!=='ok'){
    console.error('OHLCV capture failed',JSON.stringify({source,symbol,code:captured.code,attempts:captured.attempts.map((a:{url:string;httpStatus:number|null;code?:string})=>({host:new URL(a.url).hostname,status:a.httpStatus,code:a.code}))}));
    return reply({error:captured.error,code:captured.code||'DATA_UNAVAILABLE',primaryCode:captured.primaryCode,recommendation:'NO SIGNAL',source,symbol,from,to,attempts:captured.attempts,captures:captured.captures,dataQuality:captured.dataQuality,fallbackAttempted:captured.fallbackAttempted},502);
  }
  return reply({source:captured.label,symbol,bars:captured.bars,fetchedAt:captured.capturedAt,lastBar:captured.bars.at(-1)?.date,adjustment:'unverified',membership:'unverified'});
}
