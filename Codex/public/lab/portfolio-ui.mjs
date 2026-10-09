import {readJsonResponse,requestJson} from './http-json.mjs';
import {DEFAULT_LIMITS,validatePortfolio,portfolioTotals} from './trade-plan.mjs';
import {escape} from './research-ui.mjs';
const $=id=>document.getElementById(id),fmt=n=>n.toLocaleString('vi-VN',{maximumFractionDigits:0});
let current=null,updatedAt=null,dirty=false;
export const portfolioSnapshot=()=>dirty?null:current?structuredClone(current):null;
export const portfolioSymbols=()=>current?.positions.map(h=>h.symbol)||[];
const labels={riskPct:'Rủi ro mỗi lệnh · % equity',maxPositionPct:'Tối đa một mã · %',maxSectorPct:'Tối đa một ngành · %',maxGrossPct:'Tổng cổ phiếu tối đa · %',maxPortfolioRiskPct:'Tổng rủi ro đến stop · %',maxCorrelatedPct:'Nhóm tương quan tối đa · %',maxGapPct:'Giá mua tối đa cao hơn close · %',minRewardRisk:'Reward/risk tối thiểu sau phí'};
function field(k,value,type='number'){return `<input data-key="${k}" aria-label="${escape({symbol:'Mã',sector:'Ngành',entryDate:'Ngày mở vị thế',available:'Cổ phiếu khả dụng',pending:'Cổ phiếu chờ về',pendingUntil:'Ngày khả dụng',averageCostVnd:'Giá vốn VND',markVnd:'Giá định giá VND',stopVnd:'Stop VND',targetVnd:'Target VND'}[k])}" type="${type}" value="${escape(value??'')}" ${type==='number'?'min="0" step="1"':''}>`;}
function addRow(h={}){const tr=document.createElement('tr');tr.innerHTML=['symbol','sector','entryDate','available','pending','pendingUntil','averageCostVnd','markVnd','stopVnd','targetVnd'].map(k=>`<td>${field(k,h[k],['symbol','sector'].includes(k)?'text':['entryDate','pendingUntil'].includes(k)?'date':'number')}</td>`).join('')+'<td><button type="button" class="text-button" data-remove>Xóa</button></td>';$('portfolio-rows').append(tr);}
function paint(){
 $('portfolio-asof').value=current?.asOf||new Date(Date.now()+7*3600000).toISOString().slice(0,10);$('portfolio-cash').value=current?.cashVnd??'';
 $('portfolio-rows').innerHTML='';for(const h of current?.positions||[])addRow(h);
 $('portfolio-limits').innerHTML=Object.entries(labels).map(([k,label])=>`<label>${label}<input data-limit="${k}" type="number" min="0.1" max="${k==='minRewardRisk'?10:100}" step="0.1" value="${current?.limits[k]??DEFAULT_LIMITS[k]}"></label>`).join('');
 const t=current?portfolioTotals(current):null;$('portfolio-summary').textContent=t?`Equity tham chiếu ${fmt(t.equity)} VND · ${current.positions.length} mã · tiền ${fmt(current.cashVnd)} VND. Dữ liệu do bạn xác nhận, chưa kết nối tài khoản môi giới.`:'Chưa có danh mục. Nhập số liệu thực; có thể chỉ nhập tiền nếu chưa giữ cổ phiếu.';dirty=false;
}
function readForm(){
 const positions=[...$('portfolio-rows').rows].map(row=>{const h={};for(const el of row.querySelectorAll('[data-key]')){const k=el.dataset.key;h[k]=['symbol','sector','entryDate','pendingUntil'].includes(k)?el.value.trim():el.value===''?(['stopVnd','targetVnd'].includes(k)?null:0):Number(el.value);}h.symbol=h.symbol.toUpperCase();h.pendingUntil=h.pendingUntil||null;return h;}).filter(h=>h.symbol);
 const limits=Object.fromEntries([...$('portfolio-limits').querySelectorAll('[data-limit]')].map(el=>[el.dataset.limit,Number(el.value)]));
 return validatePortfolio({schemaVersion:1,asOf:$('portfolio-asof').value,cashVnd:Number($('portfolio-cash').value),positions,limits});
}
export async function initPortfolio(onSaved){
 const changed=()=>{dirty=true;$('portfolio-status').textContent='Có thay đổi chưa lưu. Lưu danh mục để lập lại kế hoạch.';document.dispatchEvent(new Event('portfolio-dirty'));};
 $('portfolio-add').addEventListener('click',()=>{addRow({available:0,pending:0});changed();});
 $('portfolio-rows').addEventListener('click',e=>{if(e.target.closest('[data-remove]')){e.target.closest('tr').remove();changed();}});
 $('portfolio-form').addEventListener('input',changed);
 $('portfolio-form').addEventListener('submit',async e=>{e.preventDefault();$('portfolio-save').disabled=true;try{if($('portfolio-cash').value==='')throw new Error('Nhập tiền khả dụng, kể cả 0.');const portfolio=readForm(),response=await fetch('/api/portfolio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({portfolio,expectedUpdatedAt:updatedAt})}),data=await readJsonResponse(response,{trustedApi:true});if(!response.ok)throw new Error(data.error);current=data.portfolio;updatedAt=data.updatedAt;paint();$('portfolio-status').textContent='Đã lưu danh mục. Đang cập nhật kế hoạch…';await onSaved();$('portfolio-status').textContent='Đã lưu danh mục.';}catch(e){$('portfolio-status').textContent=e.message;}finally{$('portfolio-save').disabled=false;}});
 $('portfolio-load').addEventListener('click',async()=>{dirty=false;await load();await onSaved();});
 $('portfolio-export').addEventListener('click',()=>{try{const p=readForm(),url=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='vn100-personal-portfolio.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('portfolio-status').textContent=e.message;}});
 $('portfolio-import').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>100000)throw new Error('Tệp quá lớn.');const p=validatePortfolio(JSON.parse(await file.text()));const previous=current;current=p;paint();current=previous;changed();$('portfolio-status').textContent='Đã nạp vào biểu mẫu. Kiểm tra và bấm Lưu để cập nhật.';}catch(e){$('portfolio-status').textContent=e.message;}finally{e.target.value='';}});
 async function load(){try{const response=await fetch('/api/portfolio',{cache:'no-store'}),data=await readJsonResponse(response,{trustedApi:true});if(!response.ok)throw new Error(data.error);current=data.portfolio;updatedAt=data.updatedAt;paint();$('portfolio-status').textContent=current?'Đã tải danh mục đã lưu.':'Nhập danh mục để bắt đầu.';}catch(e){paint();$('portfolio-status').textContent=e.message;}}
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 await load();
}
