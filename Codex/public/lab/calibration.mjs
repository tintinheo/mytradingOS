import {indicators,predictAt,quantile,mean} from './swing.mjs';
export const CALIBRATION_POLICY={version:'chronological-ensemble-2026.10.05.1',methods:['momentum','reversion','regime'],calibrationSamples:60,minimumTestSamples:30,minimumBinSamples:12,bins:5,maximumECE:.1,minimumCoverage:.7,maximumCoverage:.9};
export function assertAvailable(features,origin){
 for(const f of features)if(!Number.isInteger(f.availableAt)||f.availableAt>origin)throw new Error('TEMPORAL_LEAKAGE: feature unavailable at forecast origin');
}
export function probabilityMetrics(observations){
 if(!observations.length)return {n:0,brier:null,ece:null,buckets:[]};
 if(observations.some(o=>!Number.isFinite(o.probability)||o.probability<0||o.probability>1||![0,1].includes(o.actual)))throw new Error('Invalid probability observations');
 const buckets=Array.from({length:5},(_,i)=>{const a=observations.filter(o=>Math.min(4,Math.floor(o.probability*5))===i);return {from:i/5,to:(i+1)/5,n:a.length,meanProbability:a.length?mean(a.map(o=>o.probability)):null,observedRate:a.length?mean(a.map(o=>o.actual)):null};});
 return {n:observations.length,brier:mean(observations.map(o=>(o.probability-o.actual)**2)),ece:buckets.reduce((v,b)=>v+b.n/observations.length*(b.n?Math.abs(b.meanProbability-b.observedRate):0),0),buckets};
}
function engine(rows,h){
 const features=indicators(rows),cache=new Map();
 const point=i=>{
  if(cache.has(i))return cache.get(i);
  const components=CALIBRATION_POLICY.methods.map(method=>({method,result:predictAt(rows,features,method,i,h)})).filter(x=>x.result&&Number.isFinite(x.result.center)&&x.result.center>0);
  const value=components.length>=2?{center:Math.exp(mean(components.map(x=>Math.log(x.result.center)))),components:components.map(x=>({method:x.method,center:x.result.center})),regime:features[i].regime}:null;cache.set(i,value);return value;
 };
 return origin=>{
  if(origin<119)return null;const f=point(origin);if(!f)return null;
  const residuals=[];
  for(let t=origin-h;t>=Math.max(59,origin-504);t-=h){const p=point(t);if(p)residuals.push(Math.log(rows[t+h].close/p.center));}
  if(residuals.length<12)return null;
  const logReturn=Math.log(f.center/rows[origin].close),sample=residuals.map(e=>logReturn+e),close=rows[origin].close;
  return {...f,center:close*Math.exp(quantile(sample,.5)),lower:close*Math.exp(quantile(sample,.1)),upper:close*Math.exp(quantile(sample,.9)),rawProbability:(sample.filter(v=>v>0).length+1)/(sample.length+2),sampleCount:sample.length,hasBand:true,method:'ensemble',horizon:h,disagreement:Math.min(...f.components.map(x=>x.center))<close&&Math.max(...f.components.map(x=>x.center))>close};
 };
}
export function ensembleAt(rows,origin,h=5){if(![3,5,10].includes(h)||origin>=rows.length||origin<0)throw new Error('Invalid forecast origin/horizon');return engine(rows.slice(0,origin+1),h)(origin);}
// The first 60 matured forecasts calibrate bins. Later outcomes never refit them.
export function evaluateEnsemble(rows,h=5){
 if(![3,5,10].includes(h))throw new Error('Invalid forecast horizon');
 const predict=engine(rows,h),policy=CALIBRATION_POLICY,observations=[];
 for(let i=119;i+h<rows.length;i+=h){const f=predict(i);if(f)observations.push({origin:i,target:i+h,date:rows[i].date,targetDate:rows[i+h].date,rawProbability:f.rawProbability,actual:Number(rows[i+h].close>rows[i].close),covered:rows[i+h].close>=f.lower&&rows[i+h].close<=f.upper,regime:f.regime});}
 const train=observations.slice(0,policy.calibrationSamples),test=observations.slice(policy.calibrationSamples);
 const bins=Array.from({length:policy.bins},(_,i)=>{const a=train.filter(o=>Math.min(4,Math.floor(o.rawProbability*5))===i);return {n:a.length,probability:(a.reduce((n,o)=>n+o.actual,0)+1)/(a.length+2)};});
 const calibrate=p=>bins[Math.min(4,Math.floor(p*5))];
 const scored=test.filter(o=>calibrate(o.rawProbability).n>=policy.minimumBinSamples).map(o=>({...o,probability:calibrate(o.rawProbability).probability}));
 const metrics=probabilityMetrics(scored),baselineP=(train.reduce((n,o)=>n+o.actual,0)+1)/(train.length+2),baselineBrier=scored.length?mean(scored.map(o=>(baselineP-o.actual)**2)):null;
 const coverage=scored.length?mean(scored.map(o=>Number(o.covered))):null;
 const regimes=Object.fromEntries([...new Set(scored.map(o=>o.regime))].map(regime=>[regime,probabilityMetrics(scored.filter(o=>o.regime===regime))]));
 const current=predict(rows.length-1),currentBin=current?calibrate(current.rawProbability):null;
 const qualified=train.length===policy.calibrationSamples&&metrics.n>=policy.minimumTestSamples&&metrics.brier<baselineBrier&&metrics.ece<=policy.maximumECE&&coverage>=policy.minimumCoverage&&coverage<=policy.maximumCoverage&&currentBin?.n>=policy.minimumBinSamples;
 const status=metrics.n<policy.minimumTestSamples||train.length<policy.calibrationSamples?'INSUFFICIENT':qualified?'PRELIMINARY_CALIBRATION':'NOT_QUALIFIED';
 return {policy,status,qualified,probability:qualified?currentBin.probability:null,candidateProbability:currentBin?.n>=policy.minimumBinSamples?currentBin.probability:null,forecast:current,metrics,baselineBrier,coverage,regimes,calibrationN:train.length,testN:test.length,unscoredTestN:test.length-scored.length,bins,split:{calibrationFrom:train[0]?.date||null,calibrationThrough:train.at(-1)?.targetDate||null,testFrom:test[0]?.date||null,testThrough:test.at(-1)?.targetDate||null},observations:scored,reason:qualified?'Đạt chính sách hiệu chuẩn sơ bộ trên phần test theo thời gian; cần dữ liệu được xác minh và theo dõi tiến cứu.':'Chưa đủ mẫu hoặc chưa đạt Brier, ECE, độ bao phủ và số mẫu mỗi bin. Không công bố xác suất đáng tin cậy.',limits:['Đích: close sau h phiên tăng so với close gốc; không phải xác suất lệnh có lãi.','Ensemble dùng trọng số bằng nhau cố định trên log-price; không tối ưu bằng tập test.','Brier so với tần suất nền học từ calibration; ECE dùng 5 bin và phụ thuộc kích thước mẫu.','60 mốc đầu dùng hiệu chuẩn; các mốc sau chỉ đánh giá, không refit. Chân trời không chồng nhau; vẫn có phụ thuộc chuỗi.']};
}
