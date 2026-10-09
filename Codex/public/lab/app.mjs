import {readJsonResponse,requestJson} from './http-json.mjs';
import './session-ui.mjs';
import {parseCsv,mergeData,backtest,optionsValid,normalizeDnseClient} from './core.mjs';
import {profile,regimeNames,modelNames,swingForecast,validateForecasts} from './swing.mjs';
import {buildSnapshot} from './recommendation.mjs';
import {parseContextFile,validateMarketContext} from './vn-market.mjs';
import {renderMarketRisk} from './risk-ui.mjs';
import {initReconciliation} from './reconciliation-ui.mjs';
import {initPortfolio,portfolioSnapshot} from './portfolio-ui.mjs';
import {initResearch,renderResearch,loadEvidence} from './research-ui.mjs';
let marketProfiles=new Map();
import {beginAudit,saveAuditResult,finishAudit,hasPendingAudit,auditStatus,showExplanation,initAudit} from './audit-ui.mjs';

const $ = id => document.getElementById(id);
const data = new Map();
const watchSymbols=['FPT','HPG','VCB','VNM','MWG','MSN','GAS','VIC','VHM','ACB'];
let imported = null;
let liveMeta = new Map();
let scanController = null;
let runSeq = 0;
let hasActiveResult = false;
let busy = false;
function setBusy(value, scanning=false){
  busy=value;
  document.querySelectorAll('.controls input,.controls select,.controls button,#watchlist,#portfolio-form input,#portfolio-form button,#portfolio-load,#reconciliation-form input,#reconciliation-form select,#reconciliation-form button').forEach(el=>el.disabled=value);
  if(!value&&$('recon-mode')?.value==='live')for(const id of ['recon-a-name','recon-b-name','recon-b-unit','recon-b-basis','recon-b-volume'])$(id).disabled=true;
  $('audit-retry').disabled=false;
  $('scan').disabled=value&&!scanning;
}
function auditSettings(){return {parameters:params(),forecastMethod:$('forecast').value,horizon:option('horizon'),from:$('from-date').value,to:$('to-date').value};}
function auditMetadata(symbol){
  const marketContext=marketProfiles.get(symbol),portfolio=portfolioSnapshot(),extra={...(marketContext?{marketContext}:{}),...(portfolio?{portfolio}:{} )};
  if(isCsv())return {source:'Uploaded CSV',adjustment:marketContext?.priceBasis||'unverified',membership:marketContext?'user-supplied':'unverified',...extra};
  const meta=liveMeta.get(symbol);
  return {source:meta?.source||$('source').value,...(meta?.fetchedAt?{fetchedAt:meta.fetchedAt}:{}),...(meta?.lastBar?{lastBar:meta.lastBar}:{}),adjustment:marketContext?.priceBasis||'unverified',membership:marketContext?'user-supplied':'unverified',...extra};
}
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
const fmt = n => !Number.isFinite(n)?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const pct = n => Number.isFinite(n)?`${n >= 0 ? '+' : ''}${n.toFixed(1)}%`:'—';
const option = (id) => Number($(id).value);
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function refreshSymbols(selected) {
  const symbols=isCsv()?[...(imported?.keys()||[])].sort():[...new Set([...watchSymbols,...data.keys()])].sort();
  $('ticker-suggestions').innerHTML=symbols.map(s=>`<option value="${escape(s)}"></option>`).join('');
  if(selected!==undefined)$('symbol').value=selected;
}
function ticker(){const symbol=$('symbol').value.trim().toUpperCase();$('symbol').value=symbol;return symbol;}
function validTicker(symbol){return /^[A-Z0-9]{2,10}$/.test(symbol);}
function isCsv(){return $('source').value==='csv';}
function activeData(){return isCsv()?(imported||new Map()):data;}
function resetRange(){
  if(isCsv()) {
    const rows=activeData().get($('symbol').value);
    if(!rows)return;
    $('from-date').value=rows[0].date; $('to-date').value=rows.at(-1).date;
  } else {
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    $('to-date').value=today;$('from-date').value=`${Number(today.slice(0,4))-2}${today.slice(4)}`;
  }
}
function params(){return {trapFilter:$('trap-filter').value,execution:$('execution').value,capitalVnd:option('capital-vnd'),participation:option('participation'),requireVN100:option('require-vn100')===1,settlement:option('settlement'),cashDelay:option('cash-delay'),maxHold:option('max-hold'),stopMode:$('stop-mode').value,atrStop:option('atr-stop'),atrTarget:option('atr-target'),sellTax:option('sell-tax'),minVolume:option('min-volume'),strategy:$('strategy').value,fast:option('fast'),slow:option('slow'),lookback:option('lookback'),stop:option('stop'),target:option('target'),risk:option('risk'),fee:option('fee'),volumeFilter:option('volume-filter')};}
const forecast=(rows,method)=>swingForecast(rows,method,option('horizon'));
function metric(label,value,sub,negative=false){return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value ${negative?'negative':''}">${value}</div><div class="metric-sub">${sub}</div></div>`;}

function priceChart(rows, projection) {
  const bars=rows.slice(-140), w=940,h=335,l=48,r=18,top=20,priceBottom=240,volTop=264,volBottom=307;
  const xEnd=projection?790:w-r, plotWidth=xEnd-l;
  const xx=i=>l+(i/Math.max(1,bars.length-1))*plotWidth;
  const candidates=bars.map(b=>b.close);
  if(projection) for(const p of projection.points) candidates.push(p.lower,p.upper,p.center);
  let min=Math.min(...candidates),max=Math.max(...candidates);const pad=Math.max(0.01,(max-min)*0.10);min-=pad;max+=pad;
  const yy=n=>priceBottom-(n-min)/(max-min)*(priceBottom-top);
  const line=bars.map((b,i)=>`${i?'L':'M'}${xx(i).toFixed(1)},${yy(b.close).toFixed(1)}`).join(' ');
  const maxVol=Math.max(1,...bars.map(b=>b.volume));
  const barWidth=Math.max(1,Math.min(5,plotWidth/bars.length*0.62));
  const volume=bars.map((b,i)=>`<rect x="${(xx(i)-barWidth/2).toFixed(1)}" y="${(volBottom-b.volume/maxVol*(volBottom-volTop)).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(b.volume/maxVol*(volBottom-volTop)).toFixed(1)}"/>`).join('');
  const labels=[0,1,2,3].map(k=>{const v=min+(max-min)*k/3,y=yy(v);return `<path d="M${l} ${y.toFixed(1)} H${w-r}" class="grid-line"/><text x="${l-8}" y="${(y+4).toFixed(1)}" text-anchor="end" class="axis-text">${fmt(v)}</text>`;}).join('');
  const dates=[0,Math.floor((bars.length-1)/2),bars.length-1].map(i=>`<text x="${xx(i).toFixed(1)}" y="328" text-anchor="middle" class="axis-text">${bars[i].date}</text>`).join('');
  let projectionSvg='';
  if(projection){
    const px=i=>xEnd+(i/projection.horizon)*(w-r-xEnd);
    const points=[{center:bars.at(-1).close,upper:bars.at(-1).close,lower:bars.at(-1).close},...projection.points];
    const center=points.map((p,i)=>`${i?'L':'M'}${px(i).toFixed(1)},${yy(p.center).toFixed(1)}`).join(' ');
    const upper=points.map((p,i)=>`${px(i).toFixed(1)},${yy(p.upper).toFixed(1)}`).join(' ');
    const lower=points.slice().reverse().map((p,reverse)=>{const i=projection.horizon-reverse;return `${px(i).toFixed(1)},${yy(p.lower).toFixed(1)}`;}).join(' ');
    projectionSvg=`<rect x="${xEnd}" y="${top}" width="${w-r-xEnd}" height="${priceBottom-top}" fill="#a8f2c7" opacity=".035"/><path d="M${xEnd} ${top} V${priceBottom}" stroke="#647a82" stroke-dasharray="4 5"/>${projection.hasBand?`<polygon points="${upper} ${lower}" fill="#7ceab1" opacity=".11"/>`:""}<path d="${center}" fill="none" stroke="#7ceab1" stroke-width="2" stroke-dasharray="5 5"/><text x="${xEnd+7}" y="${top+16}" class="forecast-text">MODEL / NOT OBSERVED</text>`;
  }
  $('price-chart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily closing prices and trading volume for ${escape($('symbol').value)}, with ${projection?'a separate model scenario':'no forecast'}"><g>${labels}</g><g class="volume-bars">${volume}</g><path d="${line}" fill="none" stroke="#f6c97a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${projectionSvg}<g>${dates}</g><path d="M${l} ${volTop-8} H${w-r}" class="separator"/><text x="${l}" y="${volTop-12}" class="volume-label">VOLUME</text></svg><div id="chart-tooltip" class="chart-tooltip" hidden></div>`;
  const svg=$('price-chart').querySelector('svg'),tip=$('chart-tooltip');
  svg.addEventListener('pointermove',e=>{
    const box=svg.getBoundingClientRect();const pointer=(e.clientX-box.left)/box.width*w;
    const i=Math.round((pointer-l)/plotWidth*(bars.length-1));
    if(i<0||i>=bars.length){tip.hidden=true;return;}
    const b=bars[i];tip.textContent=`${b.date}  •  close ${fmt(b.close)}  •  vol ${fmt(b.volume)}`;
    tip.style.left=`${Math.min(box.width-215,Math.max(8,e.clientX-box.left-80))}px`;
    tip.hidden=false;
  });
  svg.addEventListener('pointerleave',()=>{tip.hidden=true;});
}

function equityChart(rows){
  if(!rows.length){$('equity-chart').innerHTML='<p class="scan-note">Chưa tính hiệu suất: cần đủ hồ sơ cho mô hình đã chọn.</p>';return;}
  const values=rows.map(r=>r.value),min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,0.1),w=600,h=126;
  const d=rows.map((r,i)=>`${i?'L':'M'}${(i/(rows.length-1)*w).toFixed(1)},${(h-8-(r.value-min)/span*(h-23)).toFixed(1)}`).join(' ');
  const y=(h-8-(100-min)/span*(h-23)).toFixed(1);
  $('equity-chart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Backtest equity curve"><path d="M0 ${y} H${w}" stroke="#31434a" stroke-dasharray="4 4"/><path d="${d}" fill="none" stroke="#72dbae" stroke-width="2.5"/><text x="4" y="12" fill="#80969b" font-size="11">${fmt(max)}</text><text x="4" y="${h-4}" fill="#80969b" font-size="11">${fmt(min)}</text></svg>`;
}

const strategyNames={pullback:'Swing pullback',confirmed:'Breakout xác nhận',range:'Hồi về trung bình',sma:'MA crossover',breakout:'Breakout cơ bản',hold:'Buy & hold'};
const strategyHints={pullback:'EMA20 > EMA50, close > EMA50, ADX ≥25; RSI cắt lên 50 và close > EMA20.',confirmed:'Trạng thái tăng + close vượt high 20 phiên trước + relative volume ≥1.5.',range:'ADX <20; close trở lại dải Bollinger sau phiên dưới dải và RSI <35.',sma:'SMA nhanh cắt SMA chậm; cần một giao cắt mới.',breakout:'Close vượt N mức đóng cửa trước; không dùng đỉnh high.',hold:'Đối chứng toàn vốn, một lần mua; bỏ qua stop, target, thời hạn giữ và volume filter.'};
function controlHints(){
  $('vn-capital').hidden=$('execution').value!=='vn';
  $('strategy-hint').textContent=strategyHints[$('strategy').value];
  $('sma-params').hidden=$('strategy').value!=='sma';
  $('breakout-params').hidden=$('strategy').value!=='breakout';
  $('percent-params').hidden=$('stop-mode').value!=='percent';
  $('atr-params').hidden=$('stop-mode').value!=='atr';
}
function completedRows(all){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const d=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const today=`${d.year}-${d.month}-${d.day}`,finished=Number(d.hour)*60+Number(d.minute)>=15*60+15;
  return all.filter(b=>b.date<today||(b.date===today&&finished));
}
function researchRows(all){const rows=all.filter(b=>b.date>=$('from-date').value&&b.date<=$('to-date').value);return isCsv()?rows:completedRows(rows);}
function profileView(rows,p,x=profile(rows,p.minVolume)){
  $('regime-label').textContent=`· ${regimeNames[x.regime]}`;
  const stats=[['ATR14 / giá',`${fmt(x.atrPct)}% · P${fmt(x.atrRank)}`],['ADX14',fmt(x.adx)],['RSI14',fmt(x.rsi)],['Volume / TB20',`${fmt(x.relVolume)}×`],['TB volume 20 trước',fmt(x.avgVol)],['Gap tuyệt đối · P90/60',`${fmt(x.gap90)}%`],['EMA20 / EMA50',`${fmt(x.ema20)} / ${fmt(x.ema50)}`],['Bollinger 20 · dưới / trên',`${fmt(x.lower)} / ${fmt(x.upper)}`]];
  $('ticker-profile').innerHTML=`<div class="profile-grid">${stats.map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><p class="profile-guide">${x.guide}</p>${x.warnings.length?`<ul class="profile-warnings">${x.warnings.map(w=>`<li>${w}</li>`).join('')}</ul>`:''}<p class="panel-note">P của ATR% là thứ hạng so với tối đa 252 phiên trước của chính mã (cần ≥60 mẫu). Đặc tính thay đổi theo thời gian. Thông tin quyền, VN100 và chỉ số so sánh nằm trong bảng kiểm thị trường. BCTC và tin tức chưa được đưa vào mô hình.</p>`;
  return x;
}
function evidenceView(rows,f,checks=validateForecasts(rows,option('horizon'))){
  const h=option('horizon'),selected=checks.find(x=>x.method===$('forecast').value);
  const last=rows.at(-1).close;
  const forecastText=f?`Giá trung tâm sau ${h} phiên: <strong>${fmt(f.center)}</strong> (${pct((f.center/last-1)*100)}). ${f.hasBand?`Dải P10–P90: <strong>${fmt(f.lower)} – ${fmt(f.upper)}</strong>, từ ${f.sampleCount} mẫu quá khứ.`:`Chưa đủ 12 mẫu sai số để vẽ dải.`} ${f.upFrequency===undefined?'':`Tần suất tăng trong ${f.sampleCount} mẫu cùng trạng thái: ${fmt(f.upFrequency*100)}% (không phải xác suất dự báo).`}`:$('forecast').value==='none'?'Dự báo đang tắt; vẫn có thể so sánh kiểm định dưới đây.':'Chưa đủ dữ liệu cho mô hình đã chọn (≥60 phiên, mô hình cùng trạng thái cần ≥12 mẫu đã hoàn thành).';
  const verdict=!selected||selected.n<12?'Chưa đủ 12 mốc kiểm định: không kết luận chất lượng mô hình.':selected.skill===null?'Đối chứng không có sai số; không thể tính mức cải thiện.':selected.skill>0?`Sai số thấp hơn đối chứng ${fmt(selected.skill)}% trên ${selected.n} mốc. Đây là kết quả lịch sử, chưa chứng minh lợi thế giao dịch.`:`Sai số không tốt hơn giá không đổi trên ${selected.n} mốc. Cần thận trọng với giá trung tâm.`;
  $('forecast-evidence').innerHTML=`<p class="forecast-summary">${forecastText}</p><p class="evidence-verdict">${verdict}</p><div class="table-scroll"><table><thead><tr><th>Mô hình</th><th>Mốc OOS</th><th>Sai số · % giá gốc</th><th>Đối chứng cùng mốc</th><th>Đúng hướng</th><th>Coverage P10–P90</th></tr></thead><tbody>${checks.map(v=>`<tr><td>${modelNames[v.method]}</td><td>${v.n}</td><td>${fmt(v.error)}%</td><td>${fmt(v.baseline)}%</td><td>${v.direction===null?'—':`${fmt(v.direction)}%`}</td><td>${v.coverage===null?'—':`${fmt(v.coverage)}% / ${v.bandN} mốc`}</td></tr>`).join('')}</tbody></table></div><p class="panel-note">Walk-forward: tối đa 40 mốc, đích cách nhau ${h} phiên; mỗi dự báo chỉ dùng lịch sử tại mốc đó. ${selected?.first?`Mốc của mô hình chọn: ${selected.first} → ${selected.last}.`:''} Sai số = mean(|dự báo − thực tế| / giá gốc)×100. Dải phân vị danh nghĩa 80% cần đối chiếu coverage thực tế; không bảo đảm độ bao phủ. Mẫu giữa các mô hình có thể khác; đối chứng luôn dùng đúng các mốc tương ứng. Forecast tính giá close, chưa trừ phí; không tham gia backtest.</p>`;
}
function render(snapshot){
  contextStatus();
  const symbol=$('symbol').value,all=activeData().get(symbol)||[];
  const start=$('from-date').value,end=$('to-date').value;
  const rows=researchRows(all);
  if(start>end) throw new Error('From date must be on or before To date.');
  snapshot ||= buildSnapshot({symbol,rows,parameters:params(),forecastMethod:$('forecast').value,horizon:option('horizon'),source:$('source').value,metadata:auditMetadata(symbol)});
  const p=snapshot.parameters,r=snapshot.backtest,f=snapshot.forecast;
  const meta=liveMeta.get(symbol),x=profileView(rows,p,snapshot.features);
  evidenceView(rows,f,snapshot.forecastValidation);showExplanation(snapshot);renderMarketRisk(snapshot);renderResearch(snapshot);
  $('data-badge').textContent=isCsv()?'IMPORTED · AUDIT ENABLED':`${(meta?.source||'FEED').toUpperCase()} · FETCHED`;
  $('data-alert').classList.add('real-data');
  $('data-alert').innerHTML=isCsv()?'<span class="alert-icon">i</span><div><strong>Uploaded history · user supplied</strong><br>Verify corporate actions, source rights and VN100 membership. Backtests are simulations, not realized returns.</div>':`<span class="alert-icon">i</span><div><strong>${escape(meta?.source||'Source')} daily OHLCV · fetched ${escape(meta?.fetchedAt||'unknown')}</strong><br>Last available bar: ${escape(meta?.lastBar||'unknown')}. ${snapshot.market.source?"Hồ sơ đối chiếu do người dùng nhập; xem bảng kiểm thị trường.":"Chưa có hồ sơ đối chiếu quyền, đơn vị và thành viên VN100."} Đây là dữ liệu ngày, không phải báo giá trực tiếp. ${all.length-rows.length>0?"Chỉ phân tích các phiên hoàn thành trong khoảng ngày đã chọn (loại phiên hiện tại trước 15:15 giờ Việt Nam).":""}</div>`;
  $('ticker-title').innerHTML=`${escape(symbol)} <span>· Historical research</span>`;
  $('date-range').textContent=`${rows[0].date} → ${rows.at(-1).date}  ·  ${rows.length} sessions`;
  $('coverage').textContent=`${all.length} bars available · ${all[0].date} – ${all.at(-1).date}`;
  $('metrics').innerHTML=[metric('STRATEGY RETURN',pct(r.returnPct),r.blocked?'Chưa đủ dữ liệu':p.execution==='vn'?`Vốn ${fmt(p.capitalVnd)} VND`:'Lý thuyết · cổ phiếu phân số',r.returnPct<0),metric('BUY & HOLD',pct(r.buyHoldPct),p.execution==='vn'?'Cùng quy tắc lô / lịch / thanh khoản':'Toàn vốn · mark-to-close',r.buyHoldPct<0),metric('MAX DRAWDOWN',Number.isFinite(r.maxDrawdownPct)?`${r.maxDrawdownPct.toFixed(1)}%`:'—','Peak to trough · equity',true),metric('WIN RATE',r.winRate===null?'—':`${r.winRate.toFixed(0)}%`,`${r.trades.length} ${p.execution==='vn'?'phần bán đã khớp':'lệnh đã đóng'}`)].join('');
  $('chart-subtitle').textContent=`· last close ${fmt(r.lastPrice)} source units`;
  $('forecast-legend').hidden=!f;
  priceChart(rows,f);equityChart(r.equity);
  $('chart-caption').textContent=f?`Solid line and bars: ${isCsv()?'uploaded':meta?.source} historical bars. Dashed line and shaded band: ${modelNames[f.method]} · ${f.horizon} phiên tương lai; ${f.hasBand?'P10–P90 tại đích, dải giữa nội suy':'chưa đủ mẫu để vẽ dải'}; dải lịch sử không bảo đảm xác suất. ${snapshot.forecastNote||''}`:`Solid line and bars: ${isCsv()?'uploaded':meta?.source} historical bars. No forecast included in the backtest.`;
  $('trades-label').textContent=`${r.trades.length} ${p.execution==='vn'?'phần bán':'lệnh đóng'} · ${r.openPosition?'còn vị thế':'không giữ cổ phiếu'}`;
  $('decision').innerHTML=`<div class="decision-status">${escape(snapshot.recommendation?.state||snapshot.decision.label)}</div><p>${escape(snapshot.recommendation?.reason||snapshot.decision.summary)}</p><div class="decision-grid"><div><span>LAST CLOSE</span><strong>${fmt(r.lastPrice)}</strong></div><div><span>FORECAST</span><strong>${f?`${fmt(f.center)} · +${f.horizon} phiên`:$('forecast').value==='none'?'Off':'Chưa đủ mẫu'}</strong></div></div><p class="decision-foot">Stop tham chiếu ${fmt(snapshot.risk.stop)} · Target ${fmt(snapshot.risk.target)}. ${escape(snapshot.risk.reference)}. Xem giải thích và điều kiện ở đầu trang.</p>`;
  $('execution-note').textContent=r.blocked?r.blockedReason:`${p.settlement?'Bán sớm nhất T+3 mở cửa (quy ước dữ liệu ngày).':'Không khóa T+: đối chiếu lý thuyết, không phản ánh khả năng bán cổ phiếu mới mua.'} ${r.audit.lockedStopBars} phiên chạm stop khi đang khóa; ${r.audit.blockedFillBars} lần hoãn/bỏ khớp nến không phù hợp. ${r.audit.trapBlockedEntries||0} lần chặn mua do rủi ro giá. Tiền chờ nhận: ${fmt(r.cashPending)} / 100 đơn vị vốn. ${p.execution==='vn'?`Cổ phiếu: ${fmt(r.shares)} khả dụng, ${fmt(r.sharesPending)} chờ về, ${fmt(r.oddLotShares)} lô lẻ.`:''} Vị thế mở chưa trừ phí bán; risk% là kế hoạch, có thể bị vượt.`;
  $('trade-rows').innerHTML=r.trades.length?r.trades.slice().reverse().slice(0,20).map(t=>`<tr><td>${t.entryDate}</td><td>${t.exitDate}</td><td>${fmt(t.entryPrice)}</td><td>${fmt(t.exitPrice)}</td><td>${t.reason} · ${t.holding} phiên${t.quantity?` · ${fmt(t.quantity)} CP`:''}</td><td class="${t.net<0?'negative':'positive'}">${pct(t.net*100)}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">No completed trades with these settings.</td></tr>';
  $('bar-count').textContent=`${rows.length} bars · latest 60 shown`;
  $('bar-rows').innerHTML=rows.slice(-60).reverse().map(b=>`<tr><td>${b.date}</td><td>${fmt(b.open)}</td><td>${fmt(b.high)}</td><td>${fmt(b.low)}</td><td>${fmt(b.close)}</td><td>${fmt(b.volume)}</td></tr>`).join('');
  $('signal-comparison').innerHTML=snapshot.comparisons.strategies.map(val=>{const key=val.strategy;
    try {
      if(val.error)throw new Error(val.error);
      return `<div class="compare-row ${key===p.strategy?'selected':''}"><span>${strategyNames[key]}</span><strong class="${val.returnPct<0?'negative':''}">${pct(val.returnPct)}</strong><small>${val.tradeCount} lệnh · DD ${fmt(val.maxDrawdownPct)}%</small></div>`;
    } catch { return `<div class="compare-row"><span>${strategyNames[key]}</span><strong>—</strong><small>Check settings</small></div>`; }
  }).join('')+'<p class="panel-note">Toàn mẫu lịch sử, chưa OOS chiến lược. Buy & hold không stop/target; chế độ VN còn giới hạn lô và thanh khoản. Các chiến lược khác dùng risk budget. Không so lợi nhuận đơn lẻ để chọn chiến lược.</p>';
  $('forecast-comparison-title').textContent=`Model scenarios · ${option('horizon')} phiên`;
  $('forecast-comparison').innerHTML=snapshot.comparisons.forecasts.map(({method:key,result:val})=>{
    const change=val?(val.center/r.lastPrice-1)*100:null;
    return `<div class="compare-row ${key===$('forecast').value?'selected':''}"><span>${modelNames[key]}</span><strong>${change===null?'—':pct(change)}</strong><small>${change===null?'Chưa đủ mẫu':'Giá close giả định'}</small></div>`;
  }).join('');
}

function clearResults(message) {
  showExplanation(null);
  for(const id of ['decision-layers-content','strategy-validation','price-risk-content','market-content','metrics','price-chart','equity-chart','trade-rows','bar-rows','signal-comparison','forecast-comparison','ticker-profile','forecast-evidence']) $(id).innerHTML='';
  $('ticker-title').innerHTML=`${escape($('symbol').value.trim().toUpperCase()||'Ticker')} <span>· Historical research</span>`;
  $('forecast-legend').hidden=true;
  for(const id of ['chart-subtitle','chart-caption','trades-label','bar-count','regime-label']) $(id).textContent='';
  $('execution-note').textContent='Chờ dữ liệu hợp lệ.';
  $('price-risk-content').innerHTML='<p class="scan-note">Chưa tính cảnh báo. Cần chạy với dữ liệu hợp lệ.</p>';
  $('market-content').innerHTML='<p class="scan-note">Chưa đánh giá đủ điều kiện giao dịch.</p>';
  $('decision').textContent='NO SIGNAL · Cần lịch sử giá hợp lệ trước khi phân tích.';
  $('date-range').textContent='';$('coverage').textContent='';
  $('data-badge').textContent='DATA UNAVAILABLE';
  $('data-alert').classList.remove('real-data');
  $('data-alert').innerHTML=`<span class="alert-icon">!</span><div><strong>No new signal calculated</strong><br>${escape(message)}</div>`;
}
function recalc(){
  if(!hasActiveResult||!activeData().has($('symbol').value)||busy)return;
  void freshRun({reuse:true,origin:'settings'});
}
async function fetchBars(symbol,signal) {
  const source=$('source').value;
  const fromDate=$('from-date').value,toDate=$('to-date').value;
  const query=new URLSearchParams({source,symbol,from:fromDate,to:toDate});
  let payload=await requestJson(`/api/ohlcv?${query}`,{cache:'no-store',signal,headers:{Accept:'application/json'}},35000);
  if(!Array.isArray(payload.bars)||payload.bars.length<2||payload.symbol!==symbol) throw new Error('Provider returned incomplete or mismatched bars.');
  payload={...payload,bars:payload.bars.filter(b=>b.date>=fromDate&&b.date<=toDate)};
  if(payload.bars.length<2)throw new Error('Provider returned fewer than two bars in the requested range.');
  payload.lastBar=payload.bars.at(-1).date;
  if(source!==$('source').value||fromDate!==$('from-date').value||toDate!==$('to-date').value)throw new Error('Inputs changed during the request. Fetch again.');
  return payload;
}
async function freshRun({reuse=false,origin='manual'}={}){
  if(busy)return;
  if(hasPendingAudit()){auditStatus('Còn kết quả chưa lưu. Chọn “Thử lưu lại” trước khi chạy tiếp.',true);return;}
  const symbol=ticker();
  try{
    if(!validTicker(symbol))throw new Error('Enter a ticker with 2–10 letters or digits.');
    optionsValid(params());
    if(!$('from-date').value||!$('to-date').value||$('from-date').value>$('to-date').value)throw new Error('Choose a valid date range.');
    if(isCsv()&&!imported?.has(symbol))throw new Error(imported?.size?`${symbol} is not in the uploaded CSV.`:'Import OHLCV CSV to analyze offline.');
  }catch(e){clearResults(e.message);$('import-status').textContent=e.message;$('import-status').classList.add('error');return;}
  const settings=auditSettings(),source=$('source').value;
  let run=null,resultCreated=false;
  setBusy(true);hasActiveResult=false;
  try{
    run=await beginAudit({mode:'single',origin,source,symbols:[symbol],settings});
    if(!isCsv()&&!reuse){
      data.delete(symbol);liveMeta.delete(symbol);
      clearResults(`Requesting fresh ${symbol} daily OHLCV…`);
      $('run').firstChild.textContent='Fetching daily OHLCV… ';
      $('import-status').textContent=`Requesting ${symbol} from ${source.toUpperCase()}…`;
      const payload=await fetchBars(symbol);data.set(symbol,payload.bars);liveMeta.set(symbol,payload);
      refreshSymbols(symbol);
    }
    const rows=researchRows(activeData().get(symbol)||[]),metadata=auditMetadata(symbol);
    const local=buildSnapshot({symbol,rows,parameters:settings.parameters,forecastMethod:settings.forecastMethod,horizon:settings.horizon,source,metadata});
    resultCreated=true;
    const saved=await saveAuditResult(run.id,symbol,rows,metadata);
    hasActiveResult=true;render(saved?.result.snapshot||local);
    $('import-status').textContent=`${symbol} · ${rows.length} phiên · ${metadata.source}. ${saved?(saved.evidenceWarning||'Kết quả và giải thích đã lưu vào audit.'):'Kết quả đã tính; audit đang chờ lưu lại.'}`;
    $('import-status').classList.remove('error');
  }catch(e){
    clearResults(e.message);$('import-status').textContent=e.message;$('import-status').classList.add('error');
    if(run&&!resultCreated)await saveAuditResult(run.id,symbol,null,null,e);
    else if(!run)auditStatus(`Chưa bắt đầu phân tích: ${e.message}`,true);
  }finally{
    if(run)await finishAudit(run.id);
    void loadEvidence();
    setBusy(false);$('run').firstChild.textContent=isCsv()?'Analyze uploaded CSV ':'Fetch & run analysis ';
  }
}

$('source').addEventListener('change',()=>{
  ++runSeq;hasActiveResult=false;invalidateScan();$('run').disabled=false;
  data.clear();liveMeta.clear();
  refreshSymbols(isCsv()?(imported?.has(ticker())?ticker():[...(imported?.keys()||[])][0]||ticker()):ticker());resetRange();
  $('run').firstChild.textContent=isCsv()?'Analyze uploaded CSV ':'Fetch & run analysis ';
  if(isCsv()&&!imported?.has($('symbol').value))clearResults('Import OHLCV CSV to analyze offline.');
  else void freshRun({origin:'source-change'});
});
function invalidateScan(){scanController?.abort();$('scan-rows').innerHTML='<tr><td colspan="8" class="empty">Settings changed. Run a fresh scan.</td></tr>';}
$('strategy').addEventListener('change',()=>{invalidateScan();controlHints();recalc();});
$('symbol').addEventListener('input',()=>{
  contextStatus();
  ++runSeq;hasActiveResult=false;$('run').disabled=false;
  $('run').firstChild.textContent=isCsv()?'Analyze uploaded CSV ':'Fetch & run analysis ';
  clearResults('Ticker changed. Run analysis to load matching history.');
  $('import-status').textContent='Ticker changed. Run analysis for the entered symbol.';
  $('import-status').classList.remove('error');
});
$('symbol').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();freshRun();}});
$('run').addEventListener('click',freshRun);
for(const id of ['fast','slow','lookback','stop','target','risk','fee','volume-filter','forecast','horizon','stop-mode','atr-stop','atr-target','max-hold','sell-tax','settlement','cash-delay','min-volume','trap-filter','capital-vnd','participation','require-vn100']) $(id).addEventListener('change',()=>{invalidateScan();controlHints();recalc();});
$('execution').addEventListener('change',()=>{if($('execution').value==='vn'){$('settlement').value='3';$('cash-delay').value='3';}invalidateScan();controlHints();recalc();});
for(const id of ['from-date','to-date']) $(id).addEventListener('change',()=>{if(isCsv())recalc();else {++runSeq;hasActiveResult=false;invalidateScan();$('run').disabled=false;data.delete($('symbol').value);liveMeta.delete($('symbol').value);clearResults('Date range changed. Fetch new history before interpreting a signal.');$('import-status').textContent='Date range changed. Click Fetch & run analysis for a new provider response.';}});
$('csv-file').addEventListener('change',async e=>{
  const files=[...e.target.files];if(!files.length)return;
  try{
    let combined=new Map(imported || []);
    for(const file of files) combined=mergeData(combined,parseCsv(await file.text(),file.name));
    if([...combined.values()].some(b=>b.length<2)) throw new Error('Each ticker needs at least two daily bars.');
    ++runSeq;scanController?.abort();$('run').disabled=false;imported=combined;
    const first=[...combined.keys()].sort()[0];
    $('source').value='csv';
    refreshSymbols(first);
    resetRange();
    $('import-status').textContent=`Imported ${files.length} file${files.length===1?'':'s'} · ${combined.size} ticker${combined.size===1?'':'s'} · processed locally. Verify source and corporate actions.`;
    $('run').firstChild.textContent='Analyze uploaded CSV ';
    $('import-status').classList.remove('error');void freshRun({origin:'csv-import'});
  }catch(err){$('import-status').textContent=`Import failed: ${err.message}`;$('import-status').classList.add('error');}
  e.target.value='';
});
$('sample-csv').addEventListener('click',()=>{
  const csv='ticker,date,open,high,low,close,volume\nLAB1,2025-01-02,42,43,41,42.5,1200000\nLAB1,2025-01-03,42.5,44,42,43,1450000\n';
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const a=document.createElement('a');a.href=url;a.download='ohlcv-format-example.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
});
async function scanList(){
  if(scanController){scanController.abort();return;}
  if(busy)return;
  if(hasPendingAudit()){auditStatus('Còn kết quả chưa lưu. Chọn “Thử lưu lại” trước khi chạy tiếp.',true);return;}
  if(isCsv()){$('scan-status').textContent='Choose DNSE or CafeF to fetch a watchlist. Imported data is for offline analysis.';return;}
  const symbols=[...new Set($('watchlist').value.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  if(!symbols.length||symbols.length>100||symbols.some(s=>!validTicker(s))){$('scan-status').textContent='Enter 1–100 valid ticker symbols separated by commas.';return;}
  const settings=auditSettings(),source=$('source').value;
  try{optionsValid(settings.parameters);}catch(e){$('scan-status').textContent=e.message;return;}
  const controller=new AbortController();scanController=controller;setBusy(true,true);
  $('scan').textContent='Stop scan';$('scan-rows').innerHTML='';
  let run=null,next=0,completed=0,failed=0;const reservations=[];const prefetch=new Map();
  const prepare=index=>{if(index<symbols.length&&!prefetch.has(index)&&!controller.signal.aborted)prefetch.set(index,fetchBars(symbols[index],controller.signal).then(payload=>({payload}),error=>({error})));};
  const worker=async()=>{
    while(next<symbols.length&&!controller.signal.aborted){
      const index=next++,symbol=symbols[index];let created=false;
      try{
        prepare(index);const fetched=await prefetch.get(index);prefetch.delete(index);prepare(index+2);if(controller.signal.aborted)break;if(fetched.error)throw fetched.error;const payload=fetched.payload;
        data.set(symbol,payload.bars);liveMeta.set(symbol,payload);
        const rows=completedRows(payload.bars),metadata={...auditMetadata(symbol),reservations:[...reservations]};
        const local=buildSnapshot({symbol,rows,parameters:settings.parameters,forecastMethod:settings.forecastMethod,horizon:settings.horizon,source,metadata});
        created=true;const saved=await saveAuditResult(run.id,symbol,rows,metadata),snapshot=saved?.result.snapshot||local;
        if(snapshot.personalPlan?.reservation)reservations.push(snapshot.personalPlan.reservation);
        const r=snapshot.backtest,x=snapshot.features,row=document.createElement('tr');
        row.innerHTML=`<td><button class="ticker-link" data-ticker="${escape(symbol)}">${escape(symbol)}</button></td><td>${escape(snapshot.asOf)}</td><td>${fmt(r.lastPrice)}</td><td>${escape(snapshot.recommendation?.state||snapshot.decision.label)}</td><td>${regimeNames[x.regime]} · ${fmt(x.atrPct)}%</td><td class="${r.returnPct<0?'negative':'positive'}">${pct(r.returnPct)}</td><td>${escape(payload.source)}</td><td><details class="scan-explanation"><summary>Vì sao?</summary><p>${escape(snapshot.recommendation?.reason||snapshot.explanation.summary)}</p><p>${escape(snapshot.explanation.paragraphs[7])}</p><p>${escape(snapshot.personalPlan.label)} · ${fmt(snapshot.personalPlan.quantity)} CP · vốn ${fmt(snapshot.personalPlan.costVnd)} VND.</p><p>Hồ sơ: ${snapshot.market.entryReady?'đủ để xét':'còn thiếu'} · rủi ro ${fmt(snapshot.priceRisk.latest.score)}/100.</p></details></td>`;
        $('scan-rows').append(row);
        if(symbol===$('symbol').value){hasActiveResult=true;render(snapshot);}
        if(!saved)controller.abort();
      }catch(e){
        if(controller.signal.aborted&&!created)break;
        if(symbol===$('symbol').value){hasActiveResult=false;data.delete(symbol);liveMeta.delete(symbol);clearResults(e.message);}
        if(!created)await saveAuditResult(run.id,symbol,null,null,e);
        failed++;const row=document.createElement('tr');row.innerHTML=`<td>${escape(symbol)}</td><td colspan="7" class="negative">${escape(e.message)}</td>`;$('scan-rows').append(row);
        if(hasPendingAudit())controller.abort();
      }
      completed++;$('scan-status').textContent=`${completed}/${symbols.length} checked · ${failed} errors · saving each result`;
    }
  };
  try{
    run=await beginAudit({mode:'scan',origin:'manual',source,symbols,settings});
    prepare(0);prepare(1);await worker();
  }catch(e){$('scan-status').textContent=e.message;auditStatus(`Chưa bắt đầu quét: ${e.message}`,true);}
  finally{
    if(run){await finishAudit(run.id,controller.signal.aborted);$('scan-status').textContent=`${controller.signal.aborted?'Đã dừng · ':''}${completed}/${symbols.length} mã · ${failed} lỗi. ${hasPendingAudit()?'Còn audit chờ lưu lại.':'Xem toàn bộ kết quả và mã chưa xử lý trong lịch sử.'}`;}
    void loadEvidence();$('scan').textContent='Fetch & scan list';scanController=null;setBusy(false);refreshSymbols($('symbol').value);
  }
}
$('scan').addEventListener('click',scanList);
$('scan-rows').addEventListener('click',e=>{if(busy)return;const target=e.target.closest('[data-ticker]');if(!target)return;$('symbol').value=target.dataset.ticker;freshRun();window.scrollTo({top:0,behavior:'smooth'});});

function contextStatus(){
  const c=marketProfiles.get($('symbol').value.trim().toUpperCase());
  $('context-status').textContent=c?`${c.symbol} · ${c.exchange} · ${c.priceUnit} · ${c.coverage.from}–${c.coverage.to}. ${marketProfiles.size} hồ sơ đã lưu.`:`Chưa có hồ sơ của mã này. ${marketProfiles.size} hồ sơ đã lưu.`;
}
async function contextApi(method='GET',body,symbol){
  const response=await fetch('/api/market-context'+(symbol?'?symbol='+encodeURIComponent(symbol):''),{method,cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body}:{}),signal:AbortSignal.timeout(20000)});
  const value=await readJsonResponse(response,{trustedApi:true});if(!response.ok)throw new Error(value.error||'Không truy cập được hồ sơ.');return value;
}
$('context-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  setBusy(true);let saved=false;
  try{
    if(file.size>4000000)throw new Error('Tệp tối đa 4 MB.');
    const text=await file.text(),profiles=parseContextFile(text);
    await contextApi('POST',text);for(const [symbol,c] of profiles)marketProfiles.set(symbol,c);
    contextStatus();invalidateScan();saved=true;
  }catch(e){$('context-status').textContent=e.message;}
  finally{setBusy(false);e.target.value='';}
  if(saved&&hasActiveResult)void freshRun({reuse:true,origin:'settings'});
});
$('context-remove').addEventListener('click',async()=>{
  const symbol=ticker();if(!marketProfiles.has(symbol)){contextStatus();return;}
  setBusy(true);let removed=false;
  try{await contextApi('DELETE',undefined,symbol);marketProfiles.delete(symbol);contextStatus();invalidateScan();removed=true;}
  catch(e){$('context-status').textContent=e.message;}
  finally{setBusy(false);}
  if(removed&&hasActiveResult)void freshRun({reuse:true,origin:'settings'});
});
setBusy(true);await initAudit();initResearch();controlHints();refreshSymbols('FPT');resetRange();
await initPortfolio(()=>hasActiveResult?freshRun({reuse:true,origin:'settings'}):Promise.resolve());
document.addEventListener('portfolio-dirty',()=>{$('decision-layers-content').innerHTML='<p class="scan-note">Danh mục có thay đổi chưa lưu. Lưu rồi chạy lại để có kế hoạch mới.</p>';});
setBusy(true);
try{const loaded=await contextApi();for(const item of loaded.profiles){const c=validateMarketContext(item.context);marketProfiles.set(c.symbol,c);}contextStatus();}
catch(e){$('context-status').textContent=e.message;}
finally{setBusy(false);}
initReconciliation({getInputs:()=>({symbol:ticker(),from:$('from-date').value,to:$('to-date').value}),isBusy:()=>busy,setBusy,onSaved:async record=>{if(hasActiveResult&&ticker()===record.symbol&&!isCsv())await freshRun({reuse:false,origin:'manual'});}});
void freshRun({origin:'startup'});
