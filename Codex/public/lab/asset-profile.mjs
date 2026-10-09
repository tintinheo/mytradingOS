import {mean,quantile} from './swing.mjs';
import {priceScale} from './vn-market.mjs';
const variance=a=>a.length>1?mean(a.map(x=>(x-mean(a))**2)):null;
const returns=a=>a.slice(1).map((b,i)=>b.close/a[i].close-1);
export function classifyMarket(index,asOf){
 const rows=(index||[]).filter(b=>b.date<=asOf).slice(-253);
 if(rows.length<60)return {state:'UNKNOWN',volatility:'UNKNOWN',sampleCount:rows.length,source:'market index',asOf:rows.at(-1)?.date||null};
 const last=rows.at(-1).close,ma20=mean(rows.slice(-20).map(b=>b.close)),ma60=mean(rows.slice(-60).map(b=>b.close)),r=returns(rows),recent=Math.sqrt(variance(r.slice(-20))),long=Math.sqrt(variance(r));
 return {state:last>ma20&&ma20>ma60?'BULL':last<ma20&&ma20<ma60?'BEAR':'SIDEWAYS',volatility:long===0?'LOW_VOLATILITY':recent>long*1.5?'HIGH_VOLATILITY':recent<long*.5?'LOW_VOLATILITY':'NORMAL',sampleCount:rows.length,source:'user-supplied market index',asOf:rows.at(-1).date,stale:rows.at(-1).date!==asOf,ma20,ma60,dailyVolatility:recent};
}
export function assetProfile(rows,context){
 const recent=rows.slice(-253),r=returns(recent),scale=priceScale(context),mapped=new Map((context?.benchmarks?.market||[]).filter(b=>b.date<=rows.at(-1).date).map(b=>[b.date,b.close])),common=recent.filter(b=>mapped.has(b.date));
 const stock=returns(common),market=common.slice(1).map((b,i)=>mapped.get(b.date)/mapped.get(common[i].date)-1),v=variance(market),beta=stock.length>=60&&v>0?mean(stock.map((x,i)=>(x-mean(stock))*(market[i]-mean(market))))/v:null;
 let peak=0,drawdown=0;for(const b of recent){peak=Math.max(peak,b.close);drawdown=Math.max(drawdown,1-b.close/peak);}
 const prev=r.slice(0,-1),next=r.slice(1),pv=variance(prev),nv=variance(next),autocorrelation=prev.length>=60&&pv>0&&nv>0?mean(prev.map((x,i)=>(x-mean(prev))*(next[i]-mean(next))))/Math.sqrt(pv*nv):null;
 return {version:'asset-profile-2026.10.05.1',sector:context?.sector||'UNKNOWN',avgVolume20:mean(recent.slice(-20).map(b=>b.volume)),avgTurnoverVnd20:context?mean(recent.slice(-20).map(b=>b.close*b.volume*scale)):null,dailyVolatilityPct:r.length>1?100*Math.sqrt(variance(r)):null,beta,betaIntervals:stock.length,gap90Pct:100*quantile(recent.slice(1).map((b,i)=>Math.abs(b.open/recent[i].close-1)),.9),maxDrawdownPct:100*drawdown,returnAutocorrelation:autocorrelation,behavior:autocorrelation===null?'UNKNOWN':autocorrelation>.1?'TREND_PERSISTENCE':autocorrelation<-.1?'MEAN_REVERSION':'MIXED',marketRegime:classifyMarket(context?.benchmarks?.market,rows.at(-1).date),limits:'Descriptive profile, not optimized parameters. Beta uses matched index intervals; sector and benchmark provenance are user supplied. OHLCV cannot identify ownership concentration.'};
}
