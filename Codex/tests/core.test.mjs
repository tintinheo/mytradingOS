import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,mergeData,backtest,forecast,signals,demoBars} from '../public/lab/core.mjs';

const p={strategy:'sma',fast:2,slow:3,lookback:5,stop:10,target:0,risk:1,fee:0,volumeFilter:0,minVolume:0,settlement:0,cashDelay:0,sellTax:0,maxHold:0};
const row=(date,open,close,low=Math.min(open,close),high=Math.max(open,close))=>({date,open,high,low,close,volume:1000});

test('CSV import validates OHLC and duplicate dates while normalizing dates',()=>{
  const text='ticker,date,open,high,low,close,volume\nVCB,01/01/2025,10,11,9,10.5,100\nVCB,2025-01-02,10,11,9,10.2,120';
  const result=parseCsv(text);
  assert.equal(result.get('VCB')[0].date,'2025-01-01');
  assert.throws(()=>parseCsv(text+'\nVCB,2025-01-02,10,11,9,10,100'),/Duplicate/);
  assert.throws(()=>parseCsv(text.replace('10,11,9,10.5','10,9,8,10.5')),/OHLC/);
  assert.throws(()=>mergeData(result,result),/duplicate/);
});

test('crossing after a close fills at the following open, then stop fills conservatively',()=>{
  const bars=[
    row('2025-01-01',10,10),row('2025-01-02',9,9),row('2025-01-03',8,8),
    row('2025-01-06',12,12),row('2025-01-07',20,20,17,24),
    row('2025-01-08',19,19)
  ];
  assert.equal(signals(bars,p)[3].buy,true);
  const r=backtest(bars,p);
  assert.equal(r.trades[0].entryDate,'2025-01-07');
  assert.equal(r.trades[0].entryPrice,20);
  assert.equal(r.trades[0].exitDate,'2025-01-07');
  assert.equal(r.trades[0].exitPrice,18);
  assert.equal(r.trades[0].reason,'Stop');
  assert.ok(Math.abs(r.returnPct+1)<1e-8);
});

test('forecast is separate from backtest and finite on supplied bars',()=>{
  const bars=demoBars();
  const a=backtest(bars,{...p,strategy:'hold'});
  const f=forecast(bars,'momentum');
  const b=backtest(bars,{...p,strategy:'hold'});
  assert.equal(f.points.length,10);
  assert.ok(f.points.every(x=>Number.isFinite(x.center)&&x.lower<=x.center&&x.center<=x.upper));
  assert.deepEqual(a.equity,b.equity);
});
