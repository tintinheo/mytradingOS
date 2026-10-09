export const RISK_VERSION='price-risk-2026.10.04.1';
export const RISK_RULES={lookback:20,breakBuffer:0.001,confirmationBars:3,relativeVolume:1.5,volumeSpike:3,wickFraction:0.5,pumpReturn:0.20,pumpWindow:10,distributionClose:0.35,highScore:60,watchScore:30,cooldown:3};
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const fmt=n=>Number.isFinite(n)?n.toLocaleString('vi-VN',{maximumFractionDigits:2}):'—';

// Every event is timestamped when observable, never at a future-confirmed breakout date.
// Scores rank review priority. They are not probabilities or evidence of intent.
export function priceRiskTimeline(rows,{boundaries=[]}={}){
  const rules=RISK_RULES,events=[],timeline=[];let segmentStart=0;
  const boundarySet=new Set(boundaries);
  for(let i=0;i<rows.length;i++){
    const b=rows[i];if(boundarySet.has(b.date))segmentStart=i;
    const current=[];
    const add=(type,label,score,group,detail,evidence,action)=>{
      const event={type,label,score,group,date:b.date,index:i,detail,evidence,action};current.push(event);events.push(event);
    };
    if(i-segmentStart>=rules.lookback){
      const previous=rows.slice(i-rules.lookback,i),high=Math.max(...previous.map(x=>x.high)),low=Math.min(...previous.map(x=>x.low));
      const avgVolume=mean(previous.map(x=>x.volume)),rv=avgVolume>0?b.volume/avgVolume:null;
      const span=b.high-b.low,upper=span>0?(b.high-Math.max(b.open,b.close))/span:0,lower=span>0?(Math.min(b.open,b.close)-b.low)/span:0,clv=span>0?(b.close-b.low)/span:0.5;
      const evidence={close:b.close,high:b.high,low:b.low,priorHigh:high,priorLow:low,relativeVolume:rv,upperWick:upper,lowerWick:lower};
      if(b.high>high*(1+rules.breakBuffer)&&b.close<high&&upper>=rules.wickFraction&&rv>=rules.relativeVolume)
        add('UPTHRUST','Vượt đỉnh rồi bị bán ngược',45,'trap',`High vượt đỉnh 20 phiên nhưng close trở lại dưới ${fmt(high)}; râu trên ${fmt(upper*100)}%, volume ${fmt(rv)}×.`,evidence,'Chờ close vượt lại vùng đỉnh và giữ được ở phiên sau; không mua đuổi.');
      if(b.low<low*(1-rules.breakBuffer)&&b.close>low&&lower>=rules.wickFraction&&rv>=rules.relativeVolume)
        add('SPRING','Thủng đáy rồi hồi lại',30,'trap',`Low thủng đáy 20 phiên nhưng close trở lại trên ${fmt(low)}; râu dưới ${fmt(lower*100)}%, volume ${fmt(rv)}×.`,evidence,'Chỉ là mẫu đảo chiều tiềm năng; chờ phiên xác nhận, không tự tạo lệnh mua hoặc bán khống.');
      for(let j=Math.max(segmentStart+rules.lookback,i-rules.confirmationBars);j<i;j++){
        const level=Math.max(...rows.slice(j-rules.lookback,j).map(x=>x.high));
        if(rows[j].close>level*(1+rules.breakBuffer)&&rows[i-1].close>=level&&b.close<level){
          add('FAILED_BREAKOUT','Breakout thất bại',60,'trap',`Close vượt ${fmt(level)} ở ${rows[j].date}, nhưng đóng lại dưới mức này sau ${i-j} phiên.`,{...evidence,level,breakoutDate:rows[j].date,barsToFailure:i-j},'Tạm chặn điểm mua mới trong 3 phiên kể từ khi quan sát thất bại.');break;
        }
      }
      for(let j=Math.max(segmentStart+rules.lookback,i-rules.confirmationBars);j<i;j++){
        const level=Math.min(...rows.slice(j-rules.lookback,j).map(x=>x.low));
        if(rows[j].close<level*(1-rules.breakBuffer)&&rows[i-1].close<=level&&b.close>level){
          add('FAILED_BREAKDOWN','Breakdown thất bại',30,'trap',`Giá trở lại trên đáy ${fmt(level)} sau ${i-j} phiên kể từ ${rows[j].date}.`,{level,breakdownDate:rows[j].date,close:b.close},'Cần xác nhận độc lập; mô hình chỉ giao dịch mua trước, bán sau.');break;
        }
      }
      const rise=rows[i-1].close/rows[i-rules.pumpWindow-1]?.close-1;
      if(rise>=rules.pumpReturn&&rv>=2&&clv<=rules.distributionClose&&b.close<b.open)
        add('RUNUP_DISTRIBUTION','Tăng nóng kèm phiên phân phối',65,'distribution',`Tăng ${fmt(rise*100)}% trong 10 phiên trước; volume ${fmt(rv)}×, close nằm ở ${fmt(clv*100)}% biên nến.`,{priorReturn:rise,relativeVolume:rv,closeLocation:clv},'Kiểm tra công bố thông tin, giao dịch nội bộ và thanh khoản; tránh mở mới khi chưa giải thích được biến động.');
      if(rv>=rules.volumeSpike)
        add('VOLUME_SHOCK','Khối lượng đột biến',30,'volume',`Khối lượng ${fmt(rv)}× trung bình 20 phiên trước. Tin doanh nghiệp, cơ cấu ETF hoặc giao dịch lớn cũng có thể gây hiện tượng này.`,{relativeVolume:rv,volume:b.volume,averageVolume:avgVolume},'Đối chiếu sự kiện và dữ liệu khớp lệnh trước khi diễn giải.');
      if(Math.abs(b.open/rows[i-1].close-1)>=0.07)
        add('LARGE_GAP','Khoảng nhảy giá lớn',35,'gap',`Gap mở cửa ${fmt((b.open/rows[i-1].close-1)*100)}%.`,{previousClose:rows[i-1].close,open:b.open},'Kiểm tra quyền, thay đổi đơn vị, giá tham chiếu và tin tức.');
    }
    if(b.volume===0||b.high===b.low)add('ILLIQUID_BAR','Không có giao dịch / nến một giá',60,'liquidity',`Volume ${fmt(b.volume)}, biên nến ${fmt(b.high-b.low)}. Không suy ra có lệnh đối ứng.`,{volume:b.volume,range:b.high-b.low},'Không giả định khớp lệnh từ nến này.');
    const active=events.filter(e=>i-e.index<rules.cooldown&&e.index>=segmentStart);
    const groups={};for(const e of active)groups[e.group]=Math.max(groups[e.group]||0,e.score);
    // Correlated trap/volume patterns do not accumulate repeatedly across days.
    const scores=Object.values(groups).sort((a,b)=>b-a),score=Math.min(100,(scores[0]||0)+Math.min(20,(scores[1]||0)/2));
    const enough=i-segmentStart>=rules.lookback;
    timeline.push({date:b.date,score,level:!enough?'insufficient':score>=rules.highScore?'high':score>=rules.watchScore?'watch':'quiet',blockEntry:score>=rules.highScore,events:current,active});
  }
  return {version:RISK_VERSION,thresholds:rules,timeline,events,latest:timeline.at(-1),limits:['Chỉ quan sát OHLCV ngày; không xác định chủ thể, ý định hay hành vi thao túng.','Không phát hiện được lệnh giả, hủy lệnh, wash trading hoặc kéo giá ATC từ dữ liệu ngày.','Ngưỡng là giả thuyết nghiên cứu chưa được hiệu chuẩn trên tập vụ việc có nhãn; điểm không phải xác suất.','Không có cảnh báo không đồng nghĩa an toàn. Tin tức, quyền và tái cân bằng chỉ số có thể tạo tín hiệu tương tự.']};
}

export function evaluateRiskOutcomes(rows,risk,horizon=5){
  const samples=[];let last=-Infinity;
  for(let i=0;i<risk.timeline.length;i++){
    const point=risk.timeline[i];
    if(i-last<horizon||!point.blockEntry||!rows[i+horizon])continue;
    last=i;const start=rows[i].close,end=rows[i+horizon].close;
    samples.push({date:point.date,type:[...new Set(point.active.map(e=>e.type))].join('+'),score:point.score,returnPct:(end/start-1)*100});
  }
  return {horizon,n:samples.length,meanReturnPct:samples.length?mean(samples.map(x=>x.returnPct)):null,negativeShare:samples.length?samples.filter(x=>x.returnPct<0).length/samples.length:null,samples,interpretation:'Mô tả lợi suất close sau cảnh báo đã hoàn thành, cách nhau ít nhất chân trời đánh giá; không phải độ chính xác phát hiện thao túng hoặc kiểm định ngoài mẫu.'};
}
