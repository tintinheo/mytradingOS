import {FINAL_DECISION_NAMES} from './credibility.mjs';
import {auditFailurePayload} from './acquisition-failure.mjs';
import {readJsonResponse,requestJson} from './http-json.mjs';
import {decisionNames} from './recommendation.mjs';
import {loadDrafts,saveDrafts} from './audit-drafts.mjs';
import {layersHtml,validationHtml} from './research-ui.mjs';
const $=id=>document.getElementById(id);
export const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>value?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false}):'—';
const statuses={running:'Chưa kết thúc',completed:'Đã lưu đầy đủ',partial:'Có mã lỗi',failed:'Không có kết quả',cancelled:'Đã dừng'};
const origins={manual:'Bấm chạy',startup:'Mở ứng dụng',settings:'Đổi tham số', 'csv-import':'Nhập CSV','source-change':'Đổi nguồn'};
let draftScope=null,draftsReady=false,recoveryExported=false;const runs=new Map();
let pending=[],historyCursor=null,historySeq=0,detailSeq=0,currentDetail=null;
function newRunId(){
  if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

async function api(payload,query=''){
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(`/api/audit${query}`,{method:payload?'POST':'GET',cache:'no-store',headers:{Accept:'application/json',...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(30000)});
      const value=await readJsonResponse(response,{trustedApi:true,endpoint:'/api/audit'});
      if(!response.ok){const error=new Error(value.error||'Không thể lưu hoặc tải audit.');error.status=response.status;error.retry=response.status>=500||response.status===429;throw error;}
      return value;
    }catch(e){if(attempt===1||e.retry===false)throw e;}
  }
}
export function auditStatus(message,error=false){$('audit-save-status').textContent=message;$('audit-save-status').classList.toggle('error',error);$('audit-retry').hidden=!pending.length;for(const id of ['audit-export-pending','audit-discard-pending'])if($(id))$(id).hidden=!pending.length;if($('audit-pending-count'))$('audit-pending-count').textContent=pending.length?`${pending.length} bản nháp chưa lưu trên máy chủ. Lỗi cố định có thể xuất rồi bỏ bản nháp để tạo lần chạy mới.`:'';}
export function hasPendingAudit(){return pending.length>0;}
export async function beginAudit(config){
  if(!draftsReady)await restoreDrafts();
  if(pending.length)throw new Error('Còn bản nháp chưa lưu. Thử lưu lại hoặc xuất và bỏ bản nháp trước khi tạo lần chạy mới.');
  auditStatus('Đang tạo bản ghi cho lần chạy…');
  const value=await api({action:'start',id:newRunId(),...config});
  runs.set(value.run.id,value.run);
  auditStatus(`Đã tạo lần chạy ${value.run.id.slice(0,8)} · đang xử lý.`);return value.run;
}
async function preserveDrafts(){try{await saveDrafts(draftScope,pending);return true;}catch{return false;}}
async function restoreDrafts(){
  if(draftsReady)return;const value=await api(null,'?draftScope=1');draftScope=value.scope;
  try{pending=await loadDrafts(draftScope);}catch{pending=[];}
  draftsReady=true;if(pending.length)auditStatus('Đã phục hồi bản nháp chưa lưu từ lần mở trước. Thử lưu lại hoặc xuất bản sao.',true);
}
async function persist(payload){
  if(pending.length){pending.push({payload,run:runs.get(payload.id)||null,retryable:true});await preserveDrafts();auditStatus('Có bản nháp đang chờ xử lý.',true);return null;}
  try{return await api(payload);}
  catch(e){pending.push({payload,run:runs.get(payload.id)||null,retryable:e.retry!==false,status:e.status||null,error:e.message});recoveryExported=false;const saved=await preserveDrafts();auditStatus(`Chưa lưu đủ audit: ${e.message} ${saved?'Đã giữ bản nháp trên thiết bị này.':'Giữ trang và xuất bản sao trước khi đóng.'}`,true);return null;}
}
export async function saveAuditResult(id,symbol,rows,metadata,error){
  return persist({action:'result',id,symbol,...(error?auditFailurePayload(error):{rows,metadata})});
}
export async function finishAudit(id,cancelled=false){
  const response=await persist({action:'finish',id,cancelled});
  if(response){auditStatus(`${statuses[response.run.status]} · lần chạy ${id.slice(0,8)}.`);void loadHistory();}
  return response;
}
export function explanationHtml(snapshot,expanded=false){
  if(!snapshot)return '<p class="scan-note">Chạy phân tích để xem lý do của recommendation.</p>';
  const original=snapshot.explanation,e=snapshot.recommendation?{...original,summary:snapshot.recommendation.state+' · '+snapshot.recommendation.reason}:original;
  const titles=snapshot.acquisitionFailure?['Nguồn chính','Nguồn dự phòng']:['Dữ liệu dùng để tính','Vì sao có trạng thái này?','Khi nào thoát?','Stop và target','T+ và chi phí','Đọc dự báo thế nào?','Bằng chứng lịch sử','Bẫy giá & rủi ro bất thường','Quy tắc giao dịch Việt Nam','Bối cảnh thị trường / ngành'];
  return `<p class="explanation-summary">${escape(e.summary)}</p>${snapshot.error?'':`<div class="explanation-meta"><span>${escape(snapshot.decision.label)}</span><span>${escape(snapshot.symbol)} · phiên ${escape(snapshot.asOf)}</span></div>`}<details class="evidence-details" ${expanded?'open':''}><summary>Xem lý do, điều kiện và rủi ro</summary><div class="explanation-grid">${e.paragraphs.map((p,i)=>`<div><h4>${titles[i]||'Giải thích'}</h4><p>${escape(p)}</p></div>`).join('')}</div>${e.conditions.length?`<details class="evidence-details" open><summary>Điều kiện mua · ${e.conditions.filter(c=>c.passed).length}/${e.conditions.length} đạt</summary><ul class="condition-list">${e.conditions.map(c=>`<li><span class="condition-state ${c.passed?'passed':'unmet'}">${c.passed?'Đạt':'Chưa đạt'}</span><div><strong>${escape(c.label)}</strong><p>${escape(c.detail)}</p></div></li>`).join('')}</ul></details>`:''}${e.limits.length?`<ul class="explanation-limits">${e.limits.map(p=>`<li>${escape(p)}</li>`).join('')}</ul>`:''}${expanded&&snapshot.schemaVersion>=3?`<details class="evidence-details"><summary>Kế hoạch và kiểm định tại lúc phát hành</summary>${layersHtml(snapshot)}${validationHtml(snapshot.validation)}</details>`:''}<p class="panel-note">Diễn giải từ số liệu và quy tắc đã tính tại lần chạy này. Vị thế là mô phỏng; dự báo không phải cam kết lợi nhuận.</p></details>`;
}
export function showExplanation(snapshot){$('recommendation-explanation').innerHTML=explanationHtml(snapshot);}

export async function loadHistory(more=false){
  const seq=++historySeq,query=new URLSearchParams();
  for(const [key,id] of [['symbol','audit-symbol'],['recommendation','audit-recommendation'],['from','audit-from'],['to','audit-to']])if($(id).value)query.set(key,$(id).value.trim().toUpperCase());
  if(more&&historyCursor)query.set('cursor',historyCursor);
  $('audit-history-status').textContent='Đang tải lịch sử…';$('audit-more').disabled=true;
  try{
    const result=await api(null,`?${query}`);if(seq!==historySeq)return;
    const html=result.runs.map(r=>`<tr><td>${escape(time(r.startedAt))}<small>${escape(origins[r.origin]||r.origin)}</small></td><td>${r.mode==='scan'?'Quét danh sách':'Một mã'}<small>${escape(r.source.toUpperCase())}</small></td><td class="audit-symbol-cell">${escape(r.symbols.slice(0,5).join(', '))}${r.symbols.length>5?` +${r.symbols.length-5}`:''}</td><td>${r.savedCount}/${r.symbols.length} mã<small>${r.errorCount} lỗi</small></td><td>${escape(statuses[r.status])}</td><td><button class="ticker-link" data-audit-id="${r.id}" aria-label="Xem lần chạy ${r.id.slice(0,8)}">Xem chi tiết</button></td></tr>`).join('');
    if(more)$('audit-rows').insertAdjacentHTML('beforeend',html);else $('audit-rows').innerHTML=html||'<tr><td colspan="6" class="empty">Chưa có lần chạy phù hợp. Lịch sử bắt đầu từ khi bật audit.</td></tr>';
    historyCursor=result.nextCursor;$('audit-more').hidden=!historyCursor;
    $('audit-history-status').textContent='Thời gian hiển thị theo Việt Nam · Mở chi tiết để xem snapshot và tải dữ liệu.';
  }catch(e){if(seq===historySeq){$('audit-history-status').textContent=e.message;if(!more){$('audit-rows').innerHTML='<tr><td colspan="6" class="empty">Chưa tải được lịch sử. Dùng “Tải lại lịch sử” để thử lại.</td></tr>';$('audit-more').hidden=true;}}}
  finally{if(seq===historySeq)$('audit-more').disabled=false;}
}
async function openDetail(id){
  const seq=++detailSeq;$('audit-detail').hidden=false;$('audit-detail-content').textContent='Đang tải snapshot…';$('audit-detail-controls').hidden=true;
  try{
    const detail=await api(null,`?id=${encodeURIComponent(id)}`);if(seq!==detailSeq)return;
    currentDetail=detail;const r=detail.run;
    $('audit-detail-title').textContent=`Lần chạy ${r.id.slice(0,8)} · ${time(r.startedAt)}`;
    $('audit-detail-meta').textContent=`${statuses[r.status]} · ${detail.results.length}/${r.symbols.length} mã · ${r.engineVersion}${detail.unprocessed.length?` · Chưa có kết quả: ${detail.unprocessed.join(', ')}`:''}`;
    $('audit-detail-symbol').innerHTML=detail.results.map(item=>`<option value="${item.symbol}">${item.symbol} · ${escape(decisionNames[item.recommendation]||item.recommendation)}</option>`).join('');
    $('audit-detail-controls').hidden=false;$('audit-detail-symbol').disabled=!detail.results.length;
    $('audit-export-json').href=`/api/audit?id=${encodeURIComponent(id)}&export=json`;
    $('audit-export-csv').href=`/api/audit?id=${encodeURIComponent(id)}&export=csv`;
    $('audit-settings').textContent=JSON.stringify(r.settings,null,2);renderArchived();
  }catch(e){if(seq===detailSeq)$('audit-detail-content').textContent=e.message;}
}
function renderArchived(){
  const result=currentDetail?.results.find(r=>r.symbol===$('audit-detail-symbol').value);
  $('audit-detail-content').innerHTML=result?explanationHtml(result.snapshot,true)+'<details class="evidence-details"><summary>Snapshot và dấu vết dữ liệu</summary><pre class="audit-json"></pre></details>':'Lần chạy chưa lưu được kết quả nào. Nếu trang bị đóng giữa chừng, các mã chưa xử lý không có recommendation.';
  if(result)$('audit-detail-content').querySelector('pre').textContent=JSON.stringify(result,null,2);
}
export async function initAudit(){
  $('audit-recommendation').innerHTML='<option value="">Tất cả kết quả</option>'+Object.entries({...decisionNames,...FINAL_DECISION_NAMES}).map(([code,label])=>`<option value="${code}">${label}</option>`).join('');
  $('audit-filter').addEventListener('submit',e=>{e.preventDefault();void loadHistory();});
  $('audit-refresh').addEventListener('click',()=>void loadHistory());
  $('audit-more').addEventListener('click',()=>void loadHistory(true));
  $('audit-rows').addEventListener('click',e=>{const button=e.target.closest('[data-audit-id]');if(button)void openDetail(button.dataset.auditId);});
  $('audit-detail-symbol').addEventListener('change',renderArchived);
  $('audit-detail-close').addEventListener('click',()=>{++detailSeq;$('audit-detail').hidden=true;});
  $('audit-retry').addEventListener('click',async()=>{
    $('audit-retry').disabled=true;
    try{
      while(pending.length){await api(pending[0].payload);pending.shift();await preserveDrafts();}
      auditStatus('Đã lưu toàn bộ kết quả đang chờ.');void loadHistory();
    }catch(e){auditStatus(`Chưa lưu đủ audit: ${e.message} Giữ trang này để thử lại.`,true);}
    finally{$('audit-retry').disabled=false;}
  });
  $('audit-export-pending').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),note:'Bản nháp phục hồi; chưa được lưu thành audit máy chủ.',pending},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='vn100-unsaved-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);recoveryExported=true;
  });
  $('audit-discard-pending').addEventListener('click',async()=>{
    if(!recoveryExported){auditStatus('Tải bản sao bản nháp trước khi bỏ hàng chờ. Bản audit đã lưu trên máy chủ vẫn giữ nguyên.',true);return;}
    const ids=[...new Set(pending.map(x=>x.payload.id))];pending=[];await preserveDrafts();
    for(const id of ids)try{await api({action:'finish',id,cancelled:true});}catch{}
    auditStatus('Đã bỏ bản nháp khỏi hàng chờ; có thể sửa dữ liệu và chạy lại.');void loadHistory();
  });
  window.addEventListener('beforeunload',e=>{if(pending.length){e.preventDefault();e.returnValue='';}});
  try{await restoreDrafts();}catch(e){auditStatus(e.message,true);}
  void loadHistory();
}
