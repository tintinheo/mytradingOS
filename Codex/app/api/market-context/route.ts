import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getAuditDb} from '@/db';
import {MarketProfileService} from '@/lib/market-profile-service.mjs';
export const runtime='edge';
export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function GET(){
  const user=await getChatGPTUser();if(!user)return reply({error:'Cần đăng nhập để tải hồ sơ thị trường.'},401);
  try{return reply(await new MarketProfileService(getAuditDb()).list(user.userId));}catch{return reply({error:'Chưa tải được hồ sơ đã lưu.'},503);}
}
export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return reply({error:'Cần đăng nhập để lưu hồ sơ.'},401);
  if(request.headers.get('sec-fetch-site')==='cross-site'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Yêu cầu không hợp lệ.'},403);
  try{
    if(Number(request.headers.get('content-length'))>4_000_000)return reply({error:'Tệp tối đa 4 MB.'},413);
    const text=await request.text();if(new TextEncoder().encode(text).length>4_000_000)return reply({error:'Tệp tối đa 4 MB.'},413);
    return reply(await new MarketProfileService(getAuditDb()).save(user.userId,text));
  }catch(e){return reply({error:e instanceof Error?e.message:'Không lưu được hồ sơ.'},400);}
}
export async function DELETE(request:Request){
  const user=await getChatGPTUser();if(!user)return reply({error:'Cần đăng nhập.'},401);
  if(request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Yêu cầu không hợp lệ.'},403);
  try{return reply(await new MarketProfileService(getAuditDb()).remove(user.userId,new URL(request.url).searchParams.get('symbol')||''));}
  catch{return reply({error:'Không xóa được hồ sơ.'},400);}
}
