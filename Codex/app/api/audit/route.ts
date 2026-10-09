import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getAuditDb} from '@/db';
import {AuditService,AuditError,auditCsv,sha256} from '@/lib/audit-service.mjs';

export const runtime='edge';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
const failure=(e:unknown)=>{
  if(e instanceof AuditError)return reply({error:e.message},e.status);
  console.error('Audit request failed', e instanceof Error?e.message:'Unknown error');
  return reply({error:'Chưa kết nối được lịch sử audit. Giữ trang này và thử lưu lại.'},503);
};

export async function POST(request:Request){
  const user=await getChatGPTUser();
  if(!user)return reply({error:'Hãy đăng nhập để lưu audit.'},401);
  if(request.headers.get('sec-fetch-site')==='cross-site'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Yêu cầu không hợp lệ.'},403);
  try{
    if(Number(request.headers.get('content-length'))>1_500_000)return reply({error:'Dữ liệu quá lớn cho một kết quả audit.'},413);
    const text=await request.text();
    if(new TextEncoder().encode(text).length>1_500_000)return reply({error:'Dữ liệu quá lớn cho một kết quả audit.'},413);
    let payload;try{payload=JSON.parse(text);}catch{return reply({error:'JSON không hợp lệ.'},400);}
    return reply(await new AuditService(getAuditDb()).mutate(user.userId,payload));
  }catch(e){return failure(e);}
}

export async function GET(request:Request){
  const user=await getChatGPTUser();
  if(!user)return reply({error:'Hãy đăng nhập để xem audit.'},401);
  try{
    const query=new URL(request.url).searchParams;if(query.has('draftScope'))return reply({scope:await sha256(user.userId)});const service=new AuditService(getAuditDb()),id=query.get('id');
    if(!id)return reply(await service.list(user.userId,query));
    const format=query.get('export');
    if(format==='json'){
      const iterator=await service.exportJson(user.userId,id),encoder=new TextEncoder();
      const stream=new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(encoder.encode(next.value));}catch(e){controller.error(e);}},async cancel(){await iterator.return();}});
      return new Response(stream,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Content-Disposition':`attachment; filename="vn100-audit-${id}.json"`}});
    }
    const detail=await service.detail(user.userId,id);
    if(format==='csv')return new Response(auditCsv(detail),{headers:{'Content-Type':'text/csv; charset=utf-8','Cache-Control':'private, no-store','Content-Disposition':`attachment; filename="vn100-audit-${id}.csv"`}});
    return reply(detail);
  }catch(e){return failure(e);}
}
