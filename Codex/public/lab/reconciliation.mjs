import {announcedSession} from './exchange-calendar.mjs';
import {tickSize} from './vn-market.mjs';

export const RECONCILIATION_VERSION='cross-source-2026.10.04.1';
export const RECONCILIATION_POLICY={priceEpsilonVnd:0.01,volumeEpsilon:0.001,minorVolumePct:0.5,minorVolumeShares:100,maxAgeHours:24};
export const reconciliationNames={MATCHED:'Khớp số liệu',DIFFERENCE:'Có sai lệch',INCOMPLETE:'Thiếu phiên / hồ sơ',MAPPING_REQUIRED:'Chưa xác định cùng loại dữ liệu',UNAVAILABLE:'Nguồn không khả dụng',NO_CHECK:'Chưa đối chiếu',EXPIRED:'Cần đối chiếu lại',INPUT_CHANGED:'Giá đầu vào đã thay đổi',PROFILE_CHANGED:'Hồ sơ đã thay đổi',RANGE_MISMATCH:'Chưa bao phủ mẫu phân tích',UPLOAD_ONLY:'Chỉ đối chiếu tệp nhập'};
export const FIELDS=['open','high','low','close','volume'];
export function completedAt(date,now){
  const vn=new Date(Date.parse(now)+7*3600000),today=vn.toISOString().slice(0,10);
  return date<today||date===today&&vn.getUTCHours()*60+vn.getUTCMinutes()>=915;
}
const scale=s=>s.priceUnit==='VND'?1:s.priceUnit==='thousand-VND'?1000:null;
const median=a=>{const x=[...a].sort((a,b)=>a-b);return x.length?x[Math.floor(x.length/2)]:null;};
export function compareCaptures({symbol,from,to,captures,context,now}){
  const [a,b]=captures,issues=[],details=[],policy=RECONCILIATION_POLICY;
  const available=captures.every(s=>s.status==='ok');
  const clean=s=>(s.bars||[]).filter(x=>x.date>=from&&x.date<=to&&completedAt(x.date,now));
  const aa=clean(a),bb=clean(b),am=new Map(aa.map(x=>[x.date,x])),bm=new Map(bb.map(x=>[x.date,x]));
  const expected=(context?.calendar||[]).filter(d=>d>=from&&d<=to&&completedAt(d,now));
  const sessionMap=new Map((context?.sessions||[]).map(s=>[s.date,s]));
  const dates=[...new Set([...am.keys(),...bm.keys(),...expected])].sort(),common=dates.filter(d=>am.has(d)&&bm.has(d));
  if(a.acquisition==='upload'&&b.acquisition==='upload'&&a.rawHash===b.rawHash)issues.push({code:'IDENTICAL_UPLOAD',message:'Hai tệp có cùng nội dung byte; chưa có bằng chứng hai lần xuất độc lập.'});
  const priceComparable=!!scale(a)&&!!scale(b)&&a.priceBasis!=='unknown'&&a.priceBasis===b.priceBasis;
  const volumeComparable=a.volumeKind!=='unknown'&&a.volumeKind===b.volumeKind;
  if(!available)issues.push({code:'SOURCE_UNAVAILABLE',message:'Ít nhất một nguồn không trả đủ dữ liệu hợp lệ; không coi nguồn còn lại là đã được đối chiếu.'});
  if(!priceComparable)issues.push({code:'PRICE_MAPPING',message:'Cần đơn vị rõ ràng và cùng cơ sở raw/adjusted. Không tự đoán hoặc đổi hệ số để làm hai nguồn khớp.'});
  if(!volumeComparable)issues.push({code:'VOLUME_MAPPING',message:'Cần xác nhận cùng loại khối lượng: khớp lệnh hoặc tổng giao dịch.'});
  const calendarCovered=!!context&&context.calendar.length>0&&context.coverage.from<=from&&context.calendar.at(-1)>=to&&context.coverage.to>=(expected.at(-1)||to);
  if(!calendarCovered)issues.push({code:'CALENDAR',message:'Hồ sơ đã lưu chưa bao phủ lịch của khoảng yêu cầu. Hai nguồn cùng thiếu một ngày vẫn có thể trông như khớp.'});
  if(!context?.actionsReviewed)issues.push({code:'ACTIONS',message:'Chưa xác nhận hồ sơ quyền; đối chiếu OHLCV không xác minh lịch quyền hoặc lịch sử thành viên chỉ số.'});
  let priceDifferences=0,volumeDifferences=0,missingSessions=0,majorDifferences=0,unexpectedSessions=0;
  for(const date of dates){
    const left=am.get(date),right=bm.get(date),suspended=sessionMap.get(date)?.status==='suspended';
    if(!left&&!right&&suspended)continue;
    const differences=[];
    if(!left||!right){missingSessions++;differences.push({field:'session',severity:'major',left:!!left,right:!!right});}
    if(context&&calendarCovered&&(!context.calendar.includes(date)||announcedSession(date,context.exchange)===false||suspended&&(left||right))){unexpectedSessions++;differences.push({field:'calendar',severity:'major',left:!!left,right:!!right});}
    if(left&&right)for(const field of FIELDS){
      const volume=field==='volume';if(volume?!volumeComparable:!priceComparable)continue;
      const l=left[field]*(volume?1:scale(a)),r=right[field]*(volume?1:scale(b)),delta=l-r,absolute=Math.abs(delta);
      if(absolute<=(volume?policy.volumeEpsilon:policy.priceEpsilonVnd))continue;
      const pct=100*absolute/Math.max(Math.abs(l),Math.abs(r),1),minor=volume?absolute<=Math.max(policy.minorVolumeShares,Math.max(l,r)*policy.minorVolumePct/100):absolute<=(tickSize(Math.max(l,r),context?.exchange)||0);
      differences.push({field,left:l,right:r,delta,pct,severity:minor?'minor':'major'});
      if(volume)volumeDifferences++;else priceDifferences++;if(!minor)majorDifferences++;
    }
    if(differences.length)details.push({date,differences,corporateAction:context?.actions.find(x=>x.exDate===date)?.type||null});
  }
  if(common.length<2)issues.push({code:'OVERLAP',message:'Cần ít nhất hai phiên hoàn thành có mặt ở cả hai nguồn.'});
  if(missingSessions)issues.push({code:'MISSING',message:'Có '+missingSessions+' phiên chỉ có một nguồn hoặc cùng thiếu theo lịch.'});
  if(unexpectedSessions)issues.push({code:'UNEXPECTED_SESSION',message:'Có dữ liệu vào ngày ngoài lịch hoặc ngày được ghi là đình chỉ.'});
  if(context?.actions.some(a=>a.exDate>=from&&a.exDate<=to))issues.push({code:'ACTION_WINDOW',message:'Khoảng kiểm tra có ngày quyền theo hồ sơ. Sai lệch gần ngày quyền cần kiểm tra raw/adjusted; app không tự sửa.'});
  const rawRatio=median(common.map(d=>am.get(d).close/bm.get(d).close));
  if(rawRatio&&[1000,0.001].some(x=>Math.abs(rawRatio/x-1)<0.02))issues.push({code:'SCALE_HINT',message:'Tỷ lệ close gốc trung vị gần '+rawRatio.toLocaleString('vi-VN')+'×; đây chỉ là gợi ý kiểm tra đơn vị, chưa áp dụng hiệu chỉnh.'});
  const mismatch=priceDifferences+volumeDifferences+unexpectedSessions>0;
  const status=!available?'UNAVAILABLE':!priceComparable||!volumeComparable?'MAPPING_REQUIRED':mismatch?'DIFFERENCE':missingSessions||!calendarCovered||!context?.actionsReviewed||common.length<2?'INCOMPLETE':'MATCHED';
  return {version:RECONCILIATION_VERSION,symbol,requested:{from,to},status,label:reconciliationNames[status],policy,priceComparable,volumeComparable,calendarCovered,commonSessions:common.length,expectedSessions:expected.length,firstCommon:common[0]||null,lastCommon:common.at(-1)||null,sourceCounts:[aa.length,bb.length],excludedIncomplete:captures.map((s,i)=>(s.bars||[]).filter(x=>x.date>=from&&x.date<=to).length-[aa,bb][i].length),priceDifferences,volumeDifferences,missingSessions,unexpectedSessions,majorDifferences,rawCloseRatio:rawRatio,issues,details,upstreamIndependence:'unknown',interpretation:'Hai bên được thu nhận riêng. Cùng kết quả không chứng minh độc lập nguồn gốc hoặc độ chính xác tuyệt đối. Mọi sai lệch vượt nhiễu số học đều được giữ; ngưỡng nhỏ/lớn chỉ xếp ưu tiên kiểm tra.'};
}

export function sourceRevisions(previous,current){
  if(!previous)return {previousId:null,changed:0,removed:0,details:[]};
  const details=[];let changed=0,removed=0;
  for(const s of current.captures){
    const old=previous.captures.find(x=>x.provider===s.provider&&x.acquisition===s.acquisition);
    if(!old||s.status!=='ok'||old.status!=='ok')continue;
    const map=new Map(s.bars.map(b=>[b.date,b]));
    for(const b of old.bars){
      if(b.date<current.requested.from||b.date>current.requested.to||!completedAt(b.date,current.createdAt))continue;
      const newer=map.get(b.date);
      if(!newer){removed++;details.push({source:s.provider,date:b.date,kind:'removed'});}
      else{const fields=FIELDS.filter(k=>b[k]!==newer[k]);if(fields.length){changed++;details.push({source:s.provider,date:b.date,kind:'changed',fields,before:b,after:newer});}}
    }
  }
  return {previousId:previous.id,changed,removed,details};
}

export function bindReconciliation(record,{rows,source,context,now},profileMatches){
  const base={priceDisagreement:record?.report?.priceDifferences??null,volumeDisagreement:record?.report?.volumeDifferences??null,comparisonDetails:record?.report?.details||[],eligible:false,blocking:false,sourceNames:record?.captures?.map(c=>c.label)||[],status:'NO_CHECK',checkId:record?.id||null,checkedAt:record?.createdAt||null,reason:'Chưa có đối chiếu từ hai nguồn do máy chủ thu nhận.',upstreamIndependence:'unknown'};
  if(!record)return base;
  const out=(status,reason,blocking=false)=>({...base,status,reason,blocking,comparisonStatus:record.report.status,payloadHash:record.payloadHash,range:record.requested});
  if(record.mode!=='live'||source==='csv')return out('UPLOAD_ONLY','Đối chiếu tệp nhập chỉ là bằng chứng do người dùng cung cấp.');
  if(!profileMatches)return out('PROFILE_CHANGED','Hồ sơ hiện tại khác hồ sơ đã dùng để đối chiếu; chạy đối chiếu lại.');
  if(Date.parse(now)<Date.parse(record.createdAt)||Date.parse(now)-Date.parse(record.createdAt)>RECONCILIATION_POLICY.maxAgeHours*3600000)return out('EXPIRED','Bản đối chiếu quá 24 giờ; lấy lại cả hai nguồn trước kế hoạch mới.');
  const capture=record.captures.find(s=>s.provider===source);
  if(!capture||capture.status!=='ok')return out('UNAVAILABLE','Nguồn phân tích chưa được thu nhận thành công trong lần đối chiếu.');
  if(!context||capture.priceUnit!==context.priceUnit||capture.priceBasis!==context.priceBasis)return out('MAPPING_REQUIRED','Đơn vị hoặc cơ sở giá trong hồ sơ không khớp khai báo của nguồn phân tích.');
  if(rows[0].date<record.requested.from||rows.at(-1).date>record.requested.to)return out('RANGE_MISMATCH','Đối chiếu chưa bao phủ toàn bộ mẫu phân tích.');
  const captured=capture.bars.filter(b=>b.date>=rows[0].date&&b.date<=rows.at(-1).date&&completedAt(b.date,now));
  if(captured.length!==rows.length||captured.some((b,i)=>b.date!==rows[i].date||FIELDS.some(k=>b[k]!==rows[i][k])))return out('INPUT_CHANGED','OHLCV phân tích khác dữ liệu gốc đã đối chiếu; chạy đối chiếu lại.',true);
  if(record.report.status!=='MATCHED')return out(record.report.status,record.report.label+'. Kiểm tra chi tiết trước khi dùng cho kế hoạch cá nhân.',record.report.status==='DIFFERENCE');
  return {...out('MATCHED','Mẫu phân tích khớp bản thu nhận của nguồn; hai nguồn khớp số liệu trong khoảng kiểm tra.'),eligible:true};
}
