import {captureSource} from './source-capture.mjs';
import type {Bar} from './ohlcv';
export async function fetchHistory(symbol:string,from:string,to:string,source:string):Promise<Bar[]>{
 const result=await captureSource(source,{symbol,from,to});
 if(result.status!=='ok')throw new Error(result.error||'DATA_UNAVAILABLE');
 return result.bars;
}
export function completedHistory(rows:Bar[],now=new Date()){
 const vn=new Date(now.getTime()+7*3600000),today=vn.toISOString().slice(0,10),finished=vn.getUTCHours()*60+vn.getUTCMinutes()>=915;
 return rows.filter(b=>b.date<today||b.date===today&&finished);
}
