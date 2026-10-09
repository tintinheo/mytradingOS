export type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };

import {providerSessionDate as dateOf, ohlcvNumber as finite} from '../public/lab/ohlcv-values.mjs';

export function normalizeDnse(payload: unknown): Bar[] {
  const root = payload as Record<string,unknown>;
  const data = root && typeof root === 'object' && root.data && typeof root.data === 'object' ? root.data as Record<string,unknown> : root;
  if (!data || typeof data !== 'object') throw new Error('Unexpected DNSE response');
  const times=data.t ?? data.time ?? data.timestamps;
  const bars: Bar[]=[];
  if (Array.isArray(times)) {
    const get=(k:string, alias:string)=>data[k] ?? data[alias];
    const opens=get('o','open'),highs=get('h','high'),lows=get('l','low'),closes=get('c','close'),vols=get('v','volume');
    if (![opens,highs,lows,closes,vols].every(a=>Array.isArray(a)&&a.length===times.length)) throw new Error('DNSE feed is missing OHLCV arrays');
    for(let i=0;i<times.length;i++) bars.push({date:dateOf(times[i]),open:finite((opens as unknown[])[i]),high:finite((highs as unknown[])[i]),low:finite((lows as unknown[])[i]),close:finite((closes as unknown[])[i]),volume:finite((vols as unknown[])[i])});
  } else if (Array.isArray(data.bars)) {
    for(const raw of data.bars as Record<string,unknown>[]) bars.push({date:dateOf(raw.t ?? raw.time ?? raw.date),open:finite(raw.o ?? raw.open),high:finite(raw.h ?? raw.high),low:finite(raw.l ?? raw.low),close:finite(raw.c ?? raw.close),volume:finite(raw.v ?? raw.volume)});
  } else throw new Error('Unrecognized DNSE bar shape');
  for(const b of bars) {
    if(b.open<=0 || b.high<=0 || b.low<=0 || b.close<=0 || b.volume<0 || b.high<Math.max(b.open,b.close,b.low) || b.low>Math.min(b.open,b.close,b.high)) throw new Error(`Invalid OHLCV for ${b.date}`);
  }
  bars.sort((a,b)=>a.date.localeCompare(b.date));
  for(let i=1;i<bars.length;i++) if(bars[i].date===bars[i-1].date) throw new Error(`Duplicate session ${bars[i].date}`);
  return bars;
}

export function buildDnseUrl(symbol:string, from:string, to:string,legacy=false): string {
  const fromMs=Date.parse(`${from}T00:00:00+07:00`);
  const toMs=Date.parse(`${to}T23:59:59+07:00`);
  const params=new URLSearchParams({from:String(Math.floor(fromMs/1000)),to:String(Math.floor(toMs/1000)),symbol,resolution:'1D'});
  return `https://${legacy?'services.entrade.com.vn':'api.dnse.com.vn'}/chart-api/v2/ohlcs/stock?${params}`;
}

export function buildCafeUrl(symbol:string, from:string, to:string): string {
  const days=Math.ceil((Date.parse(to)-Date.parse(from))/86400000)+1;
  const params=new URLSearchParams({Symbol:symbol,StartDate:from,EndDate:to,PageIndex:'1',PageSize:String(days)});
  return `https://s.cafef.vn/Ajax/PageNew/DataHistory/PriceHistory.ashx?${params}`;
}

export function normalizeCafe(payload:unknown): Bar[] {
  const source=(payload as {Data?:{Data?:unknown[]}})?.Data?.Data;
  if(!Array.isArray(source))throw new Error('Unrecognized CafeF response');
  const bars=source.map((raw)=>{
    const r=raw as Record<string,unknown>;
    const date=dateOf(r.Ngay);
    const b={date,open:finite(r.GiaMoCua),high:finite(r.GiaCaoNhat),low:finite(r.GiaThapNhat),close:finite(r.GiaDongCua),volume:finite(r.KhoiLuongKhopLenh)};
    if(Math.min(b.open,b.high,b.low,b.close)<=0||b.volume<0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))throw new Error(`Invalid CafeF bar ${date}`);
    return b;
  }).sort((a,b)=>a.date.localeCompare(b.date));
  for(let i=1;i<bars.length;i++)if(bars[i].date===bars[i-1].date)throw new Error(`Duplicate CafeF bar ${bars[i].date}`);
  return bars;
}
