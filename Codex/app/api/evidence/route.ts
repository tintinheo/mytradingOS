import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getAuditDb} from '@/db';
import {EvidenceService} from '@/lib/evidence-service.mjs';
import {fetchHistory,completedHistory} from '@/lib/fetch-bars';
import {validateMarketContext} from '@/public/lab/vn-market.mjs';
export const runtime='edge';export const dynamic='force-dynamic';
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function GET(request:Request){const u=await getChatGPTUser();if(!u)return reply({error:'Cần đăng nhập.'},401);try{return reply(await new EvidenceService(getAuditDb()).list(u.userId,new URL(request.url).searchParams.get('symbol')));}catch{return reply({error:'Chưa tải được theo dõi kết quả.'},503);}}
export async function POST(request:Request){
 const u=await getChatGPTUser();if(!u)return reply({error:'Cần đăng nhập.'},401);
 if(request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Yêu cầu không hợp lệ.'},403);
 const db=getAuditDb(),service=new EvidenceService(db);
 try{
  const missing=await db.prepare("SELECT a.run_id,a.symbol FROM audit_results a JOIN audit_runs r ON r.id=a.run_id LEFT JOIN evidence_observations e ON e.run_id=a.run_id AND e.symbol=a.symbol WHERE r.user_id=? AND e.run_id IS NULL AND json_extract(a.payload_json,'$.schemaVersion')>=3 ORDER BY a.recorded_at ASC LIMIT 20").bind(u.userId).all<{run_id:string;symbol:string}>();
  for(const row of missing.results){const saved=await db.prepare('SELECT payload_json FROM audit_results WHERE run_id=? AND symbol=?').bind(row.run_id,row.symbol).first<{payload_json:string}>();if(saved)await service.register(u.userId,row.run_id,JSON.parse(saved.payload_json));}
  const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  const pending=await db.prepare("SELECT symbol,config_json FROM evidence_observations WHERE user_id=? AND status IN ('waiting','data_issue') AND json_extract(config_json,'$.targetDate') <= ? ORDER BY updated_at ASC, recorded_at ASC LIMIT 500").bind(u.userId,today).all<{symbol:string;config_json:string}>();
  const groups=new Map<string,{symbol:string;source:string;from:string}>();
  for(const row of pending.results){const o=JSON.parse(row.config_json);if(!o.targetDate||o.targetDate>today)continue;const key=row.symbol+':'+o.source,old=groups.get(key),from=o.tail[0].date;groups.set(key,{symbol:row.symbol,source:o.source,from:old&&old.from<from?old.from:from});}
  const jobs=[...groups.values()].slice(0,6),errors:string[]=[];let evaluated=0,limited=false;
  const defer=async(j:{symbol:string;source:string})=>{await db.prepare("UPDATE evidence_observations SET updated_at=? WHERE user_id=? AND symbol=? AND json_extract(config_json,'$.source')=? AND status IN ('waiting','data_issue') AND json_extract(config_json,'$.targetDate')<=?").bind(new Date().toISOString(),u.userId,j.symbol,j.source,today).run();};
  for(let i=0;i<jobs.length;i+=2)await Promise.all(jobs.slice(i,i+2).map(async j=>{try{const record=await db.prepare('SELECT context_json FROM market_profiles WHERE user_id=? AND symbol=?').bind(u.userId,j.symbol).first<{context_json:string}>();if(!record)throw new Error('thiếu hồ sơ thị trường');const context=validateMarketContext(JSON.parse(record.context_json),j.symbol),rows=completedHistory(await fetchHistory(j.symbol,j.from,today,j.source));const result=await service.evaluate(u.userId,j.symbol,rows,context,j.source);evaluated+=result.changed;limited=limited||result.limited;if(!result.checked)await defer(j);}catch(e){errors.push(`${j.symbol}: ${e instanceof Error?e.message:'không lấy được giá'}`);await defer(j);}}));
  return reply({evaluated,errors,more:limited||groups.size>6||pending.results.length===500||missing.results.length===20,...await service.list(u.userId)});
 }catch{return reply({error:'Chưa kiểm tra được các mốc đến hạn. Các snapshot gốc vẫn được giữ.'},503);}
}
