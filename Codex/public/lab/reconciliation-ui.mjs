import {readJsonResponse,requestJson} from './http-json.mjs';
import {escape} from './research-ui.mjs';
import {reconciliationNames} from './reconciliation.mjs';
const $=id=>document.getElementById(id),fmt=n=>Number.isFinite(n)?n.toLocaleString('vi-VN',{maximumFractionDigits:4}):'—';
const time=t=>new Date(t).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
const fieldNames={open:'Mở cửa',high:'Cao nhất',low:'Thấp nhất',close:'Đóng cửa',volume:'Khối lượng',session:'Thiếu phiên',calendar:'Ngoài lịch / đình chỉ'};
const unitNames={VND:'VND','thousand-VND':'nghìn VND',unknown:'chưa xác định',raw:'chưa điều chỉnh',adjusted:'đã điều chỉnh',matched:'khớp lệnh',total:'tổng giao dịch'};
let current=null,historySequence=0,detailSequence=0;
const metric=(label,value)=>'<div><span>'+label+'</span><strong>'+value+'</strong></div>';
export function reconciliationHtml(r,filter='all'){
 const s=r.report,all=s.details.flatMap(d=>d.differences.map(x=>({...x,date:d.date,action:d.corporateAction}))).reverse();
 const filtered=all.filter(d=>filter==='all'||filter==='price'&&['open','high','low','close'].includes(d.field)||filter==='volume'&&d.field==='volume'||filter==='missing'&&['session','calendar'].includes(d.field)),rows=filtered.slice(0,300);
 const note=r.mode==='uploads'?'Hai tệp do bạn cung cấp; hệ thống chưa xác minh nguồn xuất. Kết quả này không mở điều kiện khuyến nghị cá nhân.':'Thu nhận trực tiếp từ hai nhà cung cấp. Nguồn dữ liệu thượng nguồn có thể trùng nhau.';
 return '<div class="recon-verdict '+(s.status==='MATCHED'?'matched':'needs-review')+'"><div><span class="eyebrow">'+escape(r.symbol)+' · '+escape(r.requested.from)+' — '+escape(r.requested.to)+'</span><h4>'+escape(s.label)+'</h4><p>'+note+'</p></div><small>'+escape(time(r.createdAt))+'<br>Mã '+escape(r.id.slice(0,8))+'</small></div>'+
 '<div class="plan-metrics">'+metric('Phiên chung / theo lịch',fmt(s.commonSessions)+' / '+fmt(s.expectedSessions))+metric('Phiên thiếu',fmt(s.missingSessions))+metric('Trường giá sai lệch',fmt(s.priceDifferences))+metric('Trường volume sai lệch',fmt(s.volumeDifferences))+metric('Lịch sử nguồn thay đổi',fmt(r.revisions.changed)+ ' sửa · '+fmt(r.revisions.removed)+' thiếu')+'</div>'+
 '<div class="recon-sources">'+r.captures.map(c=>'<article><h4>'+escape(c.label)+'</h4><p>'+escape(c.status==='ok'?c.bars.length+' nến thu nhận':'Không lấy được: '+c.error)+'</p><p>'+escape(unitNames[c.priceUnit])+' · '+escape(unitNames[c.priceBasis])+' · '+escape(unitNames[c.volumeKind])+'</p><small>'+escape(c.acquisition==='server'?'Lấy trực tiếp':'Tệp nhập')+' · '+escape(time(c.capturedAt))+'</small><details class="evidence-details"><summary>Bằng chứng nguồn</summary><p>'+escape(c.provenance||c.declarationSource)+'</p><p class="recon-hash">SHA-256 phản hồi / tệp: '+escape(c.rawHash||'không có phản hồi hợp lệ')+'</p><p class="recon-hash">SHA-256 nến gốc: '+escape(c.seriesHash||'—')+'</p>'+(c.attempts||[]).map(a=>'<p class="recon-hash">'+escape(a.url)+' · '+escape(a.httpStatus||'không phản hồi')+' '+escape(a.error||'')+'</p>').join('')+'</details></article>').join('')+'</div>'+
 '<ul class="recon-issues">'+s.issues.map(i=>'<li>'+escape(i.message)+'</li>').join('')+'</ul>'+
 '<p class="panel-note">Giá so sánh quy về VND bằng đơn vị đã khai báo; volume là số cổ phiếu. Bỏ qua nhiễu ≤0,01 VND / ≤0,001 CP. Lệch nhỏ chỉ là mức ưu tiên, vẫn được giữ là sai lệch. Đã loại '+s.excludedIncomplete.join(' / ')+' nến chưa hoàn thành.</p>'+
 '<div class="table-scroll"><table><thead><tr><th>Phiên</th><th>Trường</th><th>'+escape(r.captures[0].label)+'</th><th>'+escape(r.captures[1].label)+'</th><th>Chênh lệch A − B</th><th>Mức kiểm tra</th></tr></thead><tbody>'+
 (rows.map(d=>'<tr><td>'+escape(d.date)+(d.action?'<small>Quyền: '+escape(d.action)+'</small>':'')+'</td><td>'+escape(fieldNames[d.field])+'</td><td>'+(typeof d.left==='boolean'?(d.left?'Có':'Thiếu'):fmt(d.left))+'</td><td>'+(typeof d.right==='boolean'?(d.right?'Có':'Thiếu'):fmt(d.right))+'</td><td>'+fmt(d.delta)+(Number.isFinite(d.pct)?' ('+fmt(d.pct)+'%)':'')+'</td><td>'+escape(d.severity==='major'?'Ưu tiên cao':'Sai lệch nhỏ')+'</td></tr>').join('')||'<tr><td colspan="6">Không có sai lệch thuộc bộ lọc. Xem trạng thái phía trên: thiếu nguồn hoặc khác cơ sở giá chưa thể kết luận khớp.</td></tr>')+'</tbody></table></div>'+
 (filtered.length>300?'<p class="panel-note">Hiện 300/'+filtered.length+' dòng. JSON chứa toàn bộ.</p>':'')+
 '<details class="evidence-details"><summary>Dữ liệu bị sửa giữa các lần thu nhận</summary><p>So với bản '+escape(r.revisions.previousId?.slice(0,8)||'chưa có')+'. Chỉ so các phiên trùng khoảng yêu cầu. Các bản cũ được giữ nguyên.</p>'+
 r.revisions.details.slice(0,50).map(d=>'<p>'+escape(d.source)+' · '+escape(d.date)+' · '+escape(d.kind==='removed'?'lần này thiếu phiên':'đổi '+d.fields.join(', '))+'</p>').join('')+
 (r.revisions.details.length>50?'<p>Xem JSON để có toàn bộ thay đổi.</p>':'')+'</details><p class="panel-note">'+escape(s.interpretation)+'</p>';
}
async function api(query='',payload){
 const response=await fetch('/api/reconciliation'+query,{method:payload?'POST':'GET',cache:'no-store',headers:{Accept:'application/json',...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(45000)}),data=await readJsonResponse(response,{trustedApi:true});
 if(!response.ok)throw new Error(data.error||'Chưa đối chiếu được.');return data;
}
function show(record){current=record;$('recon-result').innerHTML=reconciliationHtml(record,$('recon-filter').value);$('recon-export').hidden=false;$('recon-export').href='/api/reconciliation?id='+encodeURIComponent(record.id)+'&export=json';}
function declaration(prefix){return {priceUnit:$(prefix+'-unit').value,priceBasis:$(prefix+'-basis').value,volumeKind:$(prefix+'-volume').value};}
export function initReconciliation({getInputs,isBusy,setBusy,onSaved}){
 function mode(){const live=$('recon-mode').value==='live';$('recon-a-name').value=live?'DNSE chart':'Nguồn tệp A';$('recon-b-name').value=live?'CafeF history':'Nguồn tệp B';for(const id of ['recon-a-name','recon-b-name','recon-b-unit','recon-b-basis','recon-b-volume'])$(id).disabled=live;$('recon-b-unit').value=live?'thousand-VND':'unknown';$('recon-b-basis').value=live?'raw':'unknown';$('recon-b-volume').value=live?'matched':'unknown';document.querySelectorAll('.recon-upload').forEach(el=>el.hidden=live);}
 async function history(){
  const seq=++historySequence,{symbol}=getInputs();$('recon-history-status').textContent='Đang tải đối chiếu của '+symbol+'…';
  try{const data=await api('?symbol='+encodeURIComponent(symbol));if(seq!==historySequence)return;
   $('recon-history').innerHTML=data.checks.map(c=>'<tr><td>'+escape(time(c.createdAt))+'</td><td>'+escape(c.from)+' — '+escape(c.to)+'</td><td>'+escape(c.mode==='live'?'Trực tuyến':'Hai tệp')+'</td><td>'+escape(reconciliationNames[c.status])+'</td><td><button type="button" class="text-button" data-recon-id="'+escape(c.id)+'">Chi tiết</button></td></tr>').join('')||'<tr><td colspan="5">Chưa có đối chiếu cho '+escape(symbol)+'.</td></tr>';
   $('recon-history-status').textContent='Lịch sử '+symbol+' · '+(data.limited?'30 bản gần nhất. ':'')+'Mở bản cũ không thay đổi bằng chứng dùng cho khuyến nghị.';
  }catch(e){if(seq===historySequence)$('recon-history-status').textContent=e.message;}
 }
 $('recon-mode').addEventListener('change',mode);mode();
 $('recon-filter').addEventListener('change',()=>{if(current)show(current);});
 $('recon-history-load').addEventListener('click',()=>void history());
 $('recon-history').addEventListener('click',async e=>{const id=e.target.closest('[data-recon-id]')?.dataset.reconId;if(!id)return;const seq=++detailSequence;try{const r=await api('?id='+encodeURIComponent(id));if(seq!==detailSequence)return;show(r);$('recon-status').textContent='Đang xem bản lưu '+r.symbol+' · '+time(r.createdAt)+'.';}catch(e){$('recon-status').textContent=e.message;}});
 $('reconciliation-form').addEventListener('submit',async e=>{
  e.preventDefault();if(isBusy())return;const input=getInputs(),live=$('recon-mode').value==='live',payload={...input,id:crypto.randomUUID(),mode:live?'live':'uploads'};let saved=null;
  try{
   setBusy(true);
   if(live)payload.dnse=declaration('recon-a');
   else{payload.files=[];for(const prefix of ['recon-a','recon-b']){const f=$(prefix+'-file').files[0];if(!f||f.size>350000)throw new Error('Chọn hai CSV, mỗi tệp tối đa 350 KB.');payload.files.push({label:$(prefix+'-name').value.trim(),provenance:$(prefix+'-provenance').value.trim(),declaration:declaration(prefix),csv:await f.text()});}}
   setBusy(true);$('recon-status').textContent=live?'Đang lấy độc lập DNSE và CafeF, kiểm tra rồi lưu bằng chứng…':'Đang đối chiếu hai tệp và lưu bằng chứng…';
   ++detailSequence;saved=await api('',payload);show(saved);$('recon-status').textContent='Đã lưu '+saved.report.label.toLowerCase()+'. '+(saved.report.status==='MATCHED'?'Kết quả chỉ áp dụng cho khoảng và bộ giá đã thu nhận.':'Mở chi tiết nguồn và các phiên sai lệch để xử lý.');
  }catch(e){$('recon-status').textContent=e.message+' Nếu mất kết nối khi lưu, tải lịch sử trước khi thử lại.';}
  finally{setBusy(false);const liveNow=$('recon-mode').value==='live';for(const id of ['recon-a-name','recon-b-name','recon-b-unit','recon-b-basis','recon-b-volume'])$(id).disabled=liveNow;}
  if(saved){await history();if(live)await onSaved(saved);}
 });
 void history();
}
