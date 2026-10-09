import test from 'node:test';
import assert from 'node:assert/strict';
import {indicators,profile,predictAt,swingForecast,validateForecasts} from '../public/lab/swing.mjs';
import {backtest,signals,demoBars,optionsValid} from '../public/lab/core.mjs';
const bar=(i,open,close,low=Math.min(open,close)-.2,high=Math.max(open,close)+.2)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open,close,low,high,volume:1000000});
const p={strategy:'sma',fast:2,slow:3,lookback:5,stop:10,target:0,risk:1,fee:0,volumeFilter:0,minVolume:0,settlement:3,cashDelay:3,sellTax:0,maxHold:0};

test('Wilder RSI matches a known seed; ATR includes gaps; monotonic ADX reaches 100',()=>{
  const prices=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  const rsi=indicators(prices.map((v,i)=>bar(i,v,v))).at(-1).rsi;
  assert.ok(Math.abs(rsi-70.46413502109705)<1e-9);
  const flat=Array.from({length:30},(_,i)=>bar(i,100,100,99,101));
  assert.equal(indicators(flat)[13].atr,2);
  assert.equal(indicators(flat)[14].rsi,50);
  flat[14]=bar(14,109,110,108,111);
  assert.ok(Math.abs(indicators(flat)[14].atr-(2*13+11)/14)<1e-12);
  const trend=Array.from({length:80},(_,i)=>bar(i,100+i,100+i));
  assert.equal(indicators(trend)[27].adx,100);
  assert.equal(profile(trend).regime,'up');
});

test('future shocks cannot change earlier indicators, signals, equity or forecasts',()=>{
  const original=demoBars(),cut=180;
  const mutated=original.map((b,i)=>i<cut?b:{...b,open:b.open*8,high:b.high*8,low:b.low*8,close:b.close*8,volume:0});
  assert.deepEqual(indicators(original).slice(0,cut),indicators(mutated).slice(0,cut));
  for(const strategy of ['sma','breakout','pullback','confirmed','range']){
    assert.deepEqual(signals(original,{...p,strategy}).slice(0,cut),signals(mutated,{...p,strategy}).slice(0,cut));
    assert.deepEqual(backtest(original,{...p,strategy}).equity.slice(0,cut),backtest(mutated,{...p,strategy}).equity.slice(0,cut));
  }
  for(const method of ['naive','momentum','reversion','regime'])assert.deepEqual(predictAt(original,indicators(original),method,cut-1,5),predictAt(mutated,indicators(mutated),method,cut-1,5));
});

test('T+ lock prevents an impossible stop and fills a deferred exit at the eligible open',()=>{
  const rows=[bar(0,10,10),bar(1,9,9),bar(2,8,8),bar(3,12,12),bar(4,20,20,17,24),bar(5,17,17),bar(6,16,16),bar(7,15,15)];
  const r=backtest(rows,p);
  assert.equal(r.trades.length,1);
  assert.equal(r.trades[0].holding,3);
  assert.equal(r.trades[0].exitPrice,15);
  assert.equal(r.trades[0].reason,'Deferred stop');
  assert.ok(r.audit.lockedStopBars>0);
  assert.ok(r.returnPct < -p.risk);
  assert.ok(r.cashPending>0);
  const flat=rows.map(b=>({...b}));flat[7]={...flat[7],open:15,high:15,low:15,close:15};
  const blocked=backtest(flat,p);assert.equal(blocked.trades.length,0);assert.ok(blocked.audit.blockedFillBars>0);
});

test('time exit and unsettled proceeds obey independent settings',()=>{
  const rows=[bar(0,10,10),bar(1,9,9),bar(2,8,8),bar(3,12,12),bar(4,12,12),bar(5,13,13),bar(6,14,14),bar(7,15,15)];
  const r=backtest(rows,{...p,risk:10,maxHold:3});
  assert.equal(r.trades[0].reason,'Time exit');assert.equal(r.trades[0].holding,3);
  assert.ok(r.cashPending>100);
  const advanced=backtest(rows,{...p,risk:10,maxHold:3,cashDelay:0});
  assert.equal(advanced.cashPending,0);assert.equal(advanced.returnPct,r.returnPct);
  const settled=backtest([...rows,bar(8,15,15),bar(9,15,15),bar(10,15,15)],{...p,risk:10,maxHold:3});
  assert.equal(settled.cashPending,0);
});

test('ATR sizing uses the last completed bar, not the entry-day volatility',()=>{
  const rows=demoBars(),a=backtest(rows,{...p,strategy:'breakout',stopMode:'atr',maxHold:3});
  const first=a.trades[0];assert.ok(first);
  const idx=rows.findIndex(b=>b.date===first.entryDate),modified=rows.map(b=>({...b}));
  modified[idx].high*=2;
  const b=backtest(modified,{...p,strategy:'breakout',stopMode:'atr',maxHold:3});
  assert.equal(a.equity[idx].value,b.equity[idx].value);
});

test('buy and hold is a true full-capital benchmark despite filters and stops',()=>{
  const rows=demoBars();const r=backtest(rows,{...p,strategy:'hold',minVolume:1e9,volumeFilter:1.5,stop:1,target:1,maxHold:3,fee:.25});
  assert.equal(r.trades.length,0);assert.ok(r.openPosition);assert.ok(Math.abs(r.returnPct-r.buyHoldPct)<1e-10);
});

test('walk-forward uses non-overlapping targets and matches a hand-calculated naive error',()=>{
  const rows=Array.from({length:160},(_,i)=>bar(i,100+i,100+i)),h=5;
  const check=validateForecasts(rows,h).find(x=>x.method==='naive');
  const origins=[119,124,129,134,139,144,149,154];
  const expected=origins.reduce((s,i)=>s+100*h/(100+i),0)/origins.length;
  assert.equal(check.n,8);assert.ok(Math.abs(check.error-expected)<1e-12);
  assert.equal(check.direction,null);assert.equal(check.error,check.baseline);
  assert.equal(swingForecast(rows.slice(0,59),'momentum',5),null);
  assert.equal(swingForecast(rows.slice(0,65),'regime',10),null);
  assert.equal(swingForecast(rows,'momentum',5).points.length,5);
  assert.equal(swingForecast(rows,'momentum',10).points.length,10);
  assert.throws(()=>swingForecast(rows,'momentum',4));
});

test('relative diagnostics and price forecasts are invariant to price-unit rescaling',()=>{
  const rows=demoBars(),scaled=rows.map(b=>({...b,open:b.open*1000,high:b.high*1000,low:b.low*1000,close:b.close*1000}));
  assert.ok(Math.abs(profile(rows).atrPct-profile(scaled).atrPct)<1e-10);
  const a=swingForecast(rows,'momentum',5),b=swingForecast(scaled,'momentum',5);
  assert.ok(Math.abs(a.center*1000-b.center)<1e-8);
});

test('invalid fractional windows and a holding limit below settlement are rejected',()=>{
  assert.throws(()=>optionsValid({...p,fast:2.5}),/whole/);
  assert.throws(()=>optionsValid({...p,maxHold:1}),/Holding/);
});
