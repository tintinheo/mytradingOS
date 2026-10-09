import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getAuditDb} from '@/db';
import {PortfolioService} from '@/lib/portfolio-service.mjs';
export const runtime='edge';export const dynamic='force-dynamic';
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function GET(){const u=await getChatGPTUser();if(!u)return reply({error:'Cần đăng nhập để tải danh mục.'},401);try{return reply(await new PortfolioService(getAuditDb()).get(u.userId));}catch{return reply({error:'Chưa tải được danh mục.'},503);}}
export async function POST(request:Request){
 const u=await getChatGPTUser();if(!u)return reply({error:'Cần đăng nhập để lưu danh mục.'},401);
 if(request.headers.get('sec-fetch-site')==='cross-site'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Yêu cầu không hợp lệ.'},403);
 try{const text=await request.text();if(text.length>100000)return reply({error:'Danh mục quá lớn.'},413);const body=JSON.parse(text);return reply(await new PortfolioService(getAuditDb()).save(u.userId,body.portfolio,body.expectedUpdatedAt));}catch(e){return reply({error:e instanceof Error?e.message:'Không lưu được danh mục.'},400);}
}
