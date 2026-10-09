// Announced schedule, not a fabricated history. Unknown years require imported data.
export const CALENDAR_RELEASE={version:'vn-calendar-2026.10.05.1',from:'2026-01-01',to:'2026-12-31',reviewedAt:'2026-10-05',sources:[
 'https://www.gov.hnx.vn/vi-vn/chi-tiet-lich-nghi-gd-60021971.html?_page=1',
 'https://www.hnx.vn/vi-vn/chi-tiet-lich-nghi-gd-60022084.html?_page=1',
 'https://cafef1.mediacdn.vn/download/240426/hose-thong-bao-lich-nghi-giao-dich-nam-2026-0.pdf',
 'https://cafef1.mediacdn.vn/download/240426/hose-thong-bao-lich-nghi-giao-dich-nam-2026-1.pdf'
]};
const closures=new Set(['2026-01-01','2026-01-02','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-04-27','2026-04-30','2026-05-01','2026-08-31','2026-09-01','2026-09-02']);
const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export function announcedSession(date,exchange='HOSE'){
 if(!valid(date)||!['HOSE','HNX','UPCOM'].includes(exchange))return null;
 if([0,6].includes(new Date(date).getUTCDay()))return false;
 if(date<CALENDAR_RELEASE.from||date>CALENDAR_RELEASE.to)return null;
 return !closures.has(date);
}
export function exchangeCalendar({from,to,exchange='HOSE',closures:extra=[]}){
 if(!valid(from)||!valid(to)||from>to||from<CALENDAR_RELEASE.from||to>CALENDAR_RELEASE.to)throw new Error('CALENDAR_UNAVAILABLE: cần lịch được đối chiếu cho năm ngoài 2026.');
 for(const c of extra)if(!valid(c.date)||!valid(c.knownAt)||!c.source?.trim())throw new Error('Special closure needs date, knownAt and source.');
 const sessions=[];for(let t=Date.parse(from);t<=Date.parse(to);t+=86400000){const d=new Date(t).toISOString().slice(0,10);if(announcedSession(d,exchange)&&!extra.some(x=>x.date===d))sessions.push(d);}
 return {release:CALENDAR_RELEASE,sessions,specialClosures:extra};
}
export function inspectCalendar(calendar,exchange,from,to){
 const unexpected=calendar.filter(d=>d>=from&&d<=to&&announcedSession(d,exchange)===false);
 return {version:CALENDAR_RELEASE.version,unexpected,covered:from>=CALENDAR_RELEASE.from&&to<=CALENDAR_RELEASE.to,sources:CALENDAR_RELEASE.sources};
}
