import {inspectCalendar} from './exchange-calendar.mjs';
import {technicalSeries} from './vn-market.mjs';

export const QUALITY_VERSION='quality-2026.10.04.1';
export function assessData(rows,context,source,now=new Date().toISOString()){
  const vn=new Date(Date.parse(now)+7*3600000),today=vn.toISOString().slice(0,10),finished=vn.getUTCHours()*60+vn.getUTCMinutes()>=915;
  const last=rows.at(-1)?.date,calendar=context?.calendar||[],covered=calendar.at(-1)>=today;
  const expected=covered?calendar.filter(d=>d<today||d===today&&finished).at(-1):null;
  const freshness=last>today||last===today&&!finished?'incomplete':expected?(last===expected?'fresh':last<expected?'stale':'incomplete'):source==='csv'?'historical':Date.parse(now)-Date.parse(last+'T23:59:59+07:00')>7*86400000?'stale':'unverified';
  const issues=[];if(freshness!=='fresh')issues.push({code:'FRESHNESS',message:{incomplete:'Có nến chưa hoàn thành hoặc ngày tương lai.',stale:expected?`Dữ liệu dừng ở ${last}; lịch nhập yêu cầu phiên ${expected}.`:`Dữ liệu dừng ở ${last}, quá 7 ngày lịch và chưa có lịch đủ bao phủ.`,historical:'CSV lịch sử; cần lịch bao phủ hiện tại để xét kế hoạch hôm nay.',unverified:'Chưa có lịch bao phủ hiện tại; không xác nhận dữ liệu mới chỉ bằng số ngày đã trôi qua.'}[freshness]});
  const set=new Set(rows.map(b=>b.date)),sessions=new Map((context?.sessions||[]).map(s=>[s.date,s]));
  const gaps=calendar.filter(d=>d>=rows[0]?.date&&d<=last&&!set.has(d)&&sessions.get(d)?.status!=='suspended');
  if(gaps.length)issues.push({code:'GAPS',message:`Thiếu ${gaps.length} phiên trong lịch đã nhập.`,dates:gaps.slice(0,30)});
  if(!context)issues.push({code:'PROVENANCE',message:'Chưa đối chiếu đơn vị giá, raw/adjusted, lịch và quyền.'});
  else if(!context.actionsReviewed||context.coverage.from>rows[0].date||context.coverage.to<last)issues.push({code:'ACTIONS',message:'Hồ sơ quyền chưa bao phủ toàn bộ mẫu.'});
  const normalized=technicalSeries(rows,context),jumps=normalized.rows.slice(1).filter((b,i)=>Math.abs(b.close/normalized.rows[i].close-1)>.25).map(b=>b.date);
  if(jumps.length)issues.push({code:'JUMPS',message:`Có ${jumps.length} thay đổi giá trên 25% sau chuẩn hóa; cần đối chiếu nguồn/quyền.`,dates:jumps.slice(0,30)});
  if(normalized.boundaries.length)issues.push({code:'UNMODELED_ACTION',message:'Có quyền chưa đủ hệ số điều chỉnh; không nối mẫu qua sự kiện.'});
  const calendarReview=inspectCalendar(calendar,context?.exchange,rows[0]?.date,last);
  if(calendarReview.unexpected.length)issues.push({code:'CALENDAR_CONFLICT',message:'Lịch nhập chứa ngày nghỉ theo lịch sàn: '+calendarReview.unexpected.slice(0,10).join(', ')});
  const researchReady=!calendarReview.unexpected.length&&!!context&&rows.every(b=>calendar.includes(b.date))&&context.actionsReviewed&&context.coverage.from<=rows[0].date&&context.coverage.to>=last&&!gaps.length&&!jumps.length&&!normalized.boundaries.length;
  return {calendarReview,version:QUALITY_VERSION,freshness,expected,last,today,issues,researchReady,source,unit:context?.priceUnit||'unknown',priceBasis:context?.priceBasis||'unknown',sourceVerifiedBySystem:false,provenance:'Hồ sơ do người dùng đối chiếu; hệ thống kiểm tra cấu trúc và tính nhất quán, chưa chứng thực nguồn độc lập.'};
}

// Convert a scenario on today's price basis to raw future per-share prices.
// Only actions known at the forecast origin may enter this transformation.
export function forecastWithActions(forecast,context,asOf){
  if(!forecast)return {forecast:null,reason:null};
  if(!context)return {forecast:{...forecast,basis:'unverified',actions:[]},reason:'Chưa đối chiếu quyền trong kỳ dự báo.'};
  const future=context.calendar.filter(d=>d>asOf).slice(0,forecast.horizon),known=context.actions.filter(a=>a.knownAt<=asOf&&a.exDate>asOf);
  if(future.length<forecast.horizon)return {forecast:null,reason:'Cần lịch đủ toàn kỳ dự báo để đối chiếu quyền và ngày đích.'};
  if(inspectCalendar(future,context.exchange,asOf,future.at(-1)).unexpected.length)return {forecast:null,reason:'Lịch dự báo chứa ngày nghỉ sàn; cần sửa lịch trước khi dự báo.'};
  const relevant=known.filter(a=>a.exDate<=future.at(-1));
  if(relevant.some(a=>!['cash','split','bonus'].includes(a.type)||!(a.priceFactor>0)))return {forecast:null,reason:'Kỳ dự báo có quyền chưa đủ mô hình điều chỉnh; tạm ngừng giá dự báo.'};
  const factorAt=date=>relevant.filter(a=>a.exDate<=date).reduce((p,a)=>p*a.priceFactor,1),endFactor=factorAt(future.at(-1));
  return {forecast:{...forecast,center:forecast.center*endFactor,lower:forecast.lower==null?null:forecast.lower*endFactor,upper:forecast.upper==null?null:forecast.upper*endFactor,points:forecast.points.map((p,i)=>({...p,date:future[i],center:p.center*factorAt(future[i]),lower:p.lower*factorAt(future[i]),upper:p.upper*factorAt(future[i])})),basis:'future-raw-per-share',currentBasisCenter:forecast.center,targetDate:future.at(-1),actions:relevant.map(a=>({type:a.type,exDate:a.exDate,knownAt:a.knownAt,priceFactor:a.priceFactor})),adjustmentFactor:endFactor},reason:relevant.length?'Giá tương lai đã áp hệ số quyền công bố, theo từng phiên; hệ số là dữ liệu đối chiếu nhập.':null};
}
