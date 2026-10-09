import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getAuditDb} from '@/db';
import {ReconciliationService,ReconciliationError} from '@/lib/reconciliation-service.mjs';
export const runtime='edge';export const dynamic='force-dynamic';
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
const error=(e:unknown)=>reply({error:e instanceof ReconciliationError?e.message:'Chưa hoàn tất đối chiếu. Thử tải lại lịch sử trước khi tạo lần mới.'},e instanceof ReconciliationError?e.status:503);
export async function GET(request:Request){
 const user=await getChatGPTUser();if(!user)return reply({error:'Cần đăng nhập để xem đối chiếu.'},401);
 try{const q=new URL(request.url).searchParams,service=new ReconciliationService(getAuditDb());
  if(q.has('id')){const value=await service.detail(user.userId,q.get('id')||'');return q.get('export')==='json'?new Response(JSON.stringify(value,null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="vn100-reconciliation-'+value.symbol+'-'+value.id+'.json"','Cache-Control':'private, no-store'}}):reply(value);}
  return reply(await service.list(user.userId,q.get('symbol')||''));
 }catch(e){return error(e);}
}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return reply({error:'Cần đăng nhập để đối chiếu.'},401);
 if(request.headers.get('sec-fetch-site')==='cross-site'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Yêu cầu không hợp lệ.'},403);
 try{if(Number(request.headers.get('content-length'))>800000)return reply({error:'Hai tệp tổng cộng tối đa 800 KB.'},413);
  const text=await request.text();if(new TextEncoder().encode(text).length>800000)return reply({error:'Hai tệp tổng cộng tối đa 800 KB.'},413);
  let body;try{body=JSON.parse(text);}catch{return reply({error:'JSON không hợp lệ.'},400);}
  return reply(await new ReconciliationService(getAuditDb()).create(user.userId,body));
 }catch(e){return error(e);}
}
