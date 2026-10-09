import {z} from 'zod';
import {parseCsv} from '../public/lab/core.mjs';
import {validateMarketContext} from '../public/lab/vn-market.mjs';
import {compareCaptures,sourceRevisions,bindReconciliation} from '../public/lab/reconciliation.mjs';
import {sha256} from './hashes.mjs';
import {captureSource} from './source-capture.mjs';

export class ReconciliationError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d);
const declaration=z.object({priceUnit:z.enum(['unknown','VND','thousand-VND']),priceBasis:z.enum(['unknown','raw','adjusted']),volumeKind:z.enum(['unknown','matched','total'])}).strict();
const file=z.object({label:z.string().trim().min(2).max(100),provenance:z.string().trim().min(5).max(500),csv:z.string().min(1).max(350000),declaration}).strict();
const schema=z.object({id:z.string().uuid(),symbol:z.string().regex(/^[A-Z0-9]{2,10}$/),from:date,to:date,mode:z.enum(['live','uploads']),dnse:declaration.optional(),files:z.array(file).length(2).optional()}).strict();
const read=r=>({...JSON.parse(r.payload_json),payloadHash:r.payload_hash});
export class ReconciliationService{
  constructor(db,options={}){this.db=db;this.capture=options.capture||captureSource;this.now=options.now||(()=>new Date().toISOString());}
  async detail(user,id){
    if(!z.string().uuid().safeParse(id).success)throw new ReconciliationError('Mã đối chiếu không hợp lệ.');
    const r=await this.db.prepare('SELECT payload_json,payload_hash FROM data_reconciliations WHERE user_id=? AND id=?').bind(user,id).first();
    if(!r)throw new ReconciliationError('Không tìm thấy bản đối chiếu.',404);return read(r);
  }
  async list(user,symbol){
    if(!/^[A-Z0-9]{2,10}$/.test(symbol))throw new ReconciliationError('Mã không hợp lệ.');
    const {results}=await this.db.prepare('SELECT id,created_at,status,mode,from_date,to_date,payload_hash FROM data_reconciliations WHERE user_id=? AND symbol=? ORDER BY created_at DESC,id DESC LIMIT 30').bind(user,symbol).all();
    return {checks:results.map(r=>({id:r.id,createdAt:r.created_at,status:r.status,mode:r.mode,from:r.from_date,to:r.to_date,payloadHash:r.payload_hash})),limited:results.length===30};
  }
  async latest(user,symbol,mode='live'){
    const r=await this.db.prepare('SELECT payload_json,payload_hash FROM data_reconciliations WHERE user_id=? AND symbol=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(user,symbol,mode).first();return r?read(r):null;
  }
  async create(user,raw){
    const parsed=schema.safeParse(raw);if(!parsed.success)throw new ReconciliationError('Kiểm tra mã, ngày, khai báo nguồn và tệp CSV.');
    const p=parsed.data,now=this.now(),today=new Date(Date.parse(now)+7*3600000).toISOString().slice(0,10);
    if(p.from>p.to||p.to>today||Date.parse(p.to)-Date.parse(p.from)>1098*86400000)throw new ReconciliationError('Chọn khoảng không quá 3 năm, kết thúc không sau hôm nay.');
    if(p.mode==='live'&&(!p.dnse||p.files)||p.mode==='uploads'&&(!p.files||p.dnse))throw new ReconciliationError('Cấu hình nguồn không đúng chế độ.');
    if(p.files&&p.files[0].label.toLowerCase()===p.files[1].label.toLowerCase())throw new ReconciliationError('Ghi rõ hai nguồn xuất tệp khác nhau.');
    const requestHash=await sha256(p),existing=await this.db.prepare('SELECT user_id,request_hash,payload_json,payload_hash FROM data_reconciliations WHERE id=?').bind(p.id).first();
    if(existing){if(existing.user_id!==user||existing.request_hash!==requestHash)throw new ReconciliationError('Mã đối chiếu đã được dùng; tạo lần mới.',409);return read(existing);}
    const recent=await this.db.prepare("SELECT created_at FROM data_reconciliations WHERE user_id=? AND mode='live' ORDER BY created_at DESC LIMIT 1").bind(user).first();
    if(p.mode==='live'&&recent&&Date.parse(now)-Date.parse(recent.created_at)<20000)throw new ReconciliationError('Chờ 20 giây giữa hai lần lấy nguồn để tránh gọi dồn.',429);
    const stored=await this.db.prepare('SELECT context_json FROM market_profiles WHERE user_id=? AND symbol=?').bind(user,p.symbol).first(),context=stored?validateMarketContext(JSON.parse(stored.context_json),p.symbol):null;
    let captures;
    if(p.mode==='live')captures=await Promise.all(['dnse','cafef'].map(provider=>this.capture(provider,{symbol:p.symbol,from:p.from,to:p.to,declaration:p.dnse})));
    else captures=await Promise.all(p.files.map(async(f,i)=>{
      let map;try{map=parseCsv(f.csv,p.symbol+'.csv');}catch(e){throw new ReconciliationError('Tệp '+(i+1)+': '+String(e.message).slice(0,250));}
      if(map.size!==1||!map.has(p.symbol))throw new ReconciliationError('Mỗi tệp chỉ được chứa mã '+p.symbol+'.');
      const bars=map.get(p.symbol).filter(b=>b.date>=p.from&&b.date<=p.to);if(bars.length<2||bars.length>1000)throw new ReconciliationError('Mỗi tệp cần 2–1.000 phiên trong khoảng chọn.');
      return {provider:'file-'+(i+1),label:f.label,provenance:f.provenance,acquisition:'upload',status:'ok',capturedAt:now,...f.declaration,rawHash:await sha256(f.csv),seriesHash:await sha256(bars),bars,declarationSource:'user-declared',upstreamIndependence:'unknown',attempts:[]};
    }));
    const createdAt=this.now(),report=compareCaptures({symbol:p.symbol,from:p.from,to:p.to,captures,context,now:createdAt});
    const previous=await this.latest(user,p.symbol,p.mode),record={schemaVersion:1,id:p.id,symbol:p.symbol,createdAt,mode:p.mode,requested:{from:p.from,to:p.to},context,contextHash:await sha256(context),captures,report};
    record.revisions=sourceRevisions(previous,record);
    const payload=JSON.stringify(record);if(new TextEncoder().encode(payload).length>1800000)throw new ReconciliationError('Bản đối chiếu quá lớn; rút ngắn khoảng dữ liệu.',413);
    const hash=await sha256(payload);
    await this.db.prepare('INSERT INTO data_reconciliations (id,user_id,symbol,created_at,status,mode,from_date,to_date,request_hash,payload_hash,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(p.id,user,p.symbol,createdAt,report.status,p.mode,p.from,p.to,requestHash,hash,payload).run();
    const saved=await this.db.prepare('SELECT user_id,request_hash,payload_json,payload_hash FROM data_reconciliations WHERE id=?').bind(p.id).first();
    if(saved.user_id!==user||saved.request_hash!==requestHash)throw new ReconciliationError('Mã đối chiếu đã dùng.',409);
    return read(saved);
  }
  async resolve(user,{symbol,rows,source,context,now}){
    context=validateMarketContext(context,symbol);
    const record=await this.latest(user,symbol);
    return bindReconciliation(record,{rows,source,context,now},!!record&&record.contextHash===await sha256(context||null));
  }
}
