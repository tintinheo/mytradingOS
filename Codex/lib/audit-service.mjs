import {FINAL_DECISION_NAMES} from '../public/lab/credibility.mjs';
import {z} from 'zod';
import {acquisitionFailureSchema} from './acquisition-failure-schema.mjs';
import {optionsValid} from '../public/lab/core.mjs';
import {buildSnapshot,ENGINE_VERSION,decisionNames} from '../public/lab/recommendation.mjs';
import {validateMarketContext} from '../public/lab/vn-market.mjs';
import {validatePortfolio,validateReservations} from '../public/lab/trade-plan.mjs';
import {EvidenceService} from './evidence-service.mjs';
import {ReconciliationService} from './reconciliation-service.mjs';
import {sha256} from './hashes.mjs';
export {sha256} from './hashes.mjs';

export class AuditError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
const uuid=z.string().uuid(), symbol=z.string().regex(/^[A-Z0-9]{2,10}$/);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const parameters=z.object({strategy:z.enum(['sma','breakout','hold','pullback','confirmed','range']),fast:z.number(),slow:z.number(),lookback:z.number(),stop:z.number(),target:z.number(),risk:z.number(),fee:z.number(),volumeFilter:z.number(),settlement:z.number(),cashDelay:z.number(),maxHold:z.number(),stopMode:z.enum(['percent','atr']),atrStop:z.number(),atrTarget:z.number(),sellTax:z.number(),minVolume:z.number(),trapFilter:z.enum(['off','high']).optional(),execution:z.enum(['research','vn']).optional(),capitalVnd:z.number().optional(),participation:z.number().optional(),requireVN100:z.boolean().optional()}).strict();
const settings=z.object({parameters,forecastMethod:z.enum(['none','naive','momentum','reversion','regime']),horizon:z.union([z.literal(3),z.literal(5),z.literal(10)]),from:date,to:date}).strict();
const bar=z.object({date,open:z.number().positive().finite(),high:z.number().positive().finite(),low:z.number().positive().finite(),close:z.number().positive().finite(),volume:z.number().nonnegative().finite()}).strict();
const metadata=z.object({source:z.string().max(100),fetchedAt:z.string().datetime().optional(),lastBar:date.optional(),adjustment:z.string().max(100).optional(),membership:z.string().max(100).optional(),marketContext:z.record(z.unknown()).optional(),portfolio:z.record(z.unknown()).optional(),reservations:z.array(z.record(z.unknown())).max(100).optional()}).strict();
const startInput=z.object({action:z.literal('start'),id:uuid,mode:z.enum(['single','scan']),origin:z.enum(['manual','startup','settings','csv-import','source-change']),source:z.enum(['dnse','cafef','csv']),symbols:z.array(symbol).min(1).max(100),settings}).strict();
const resultInput=z.object({action:z.literal('result'),id:uuid,symbol,rows:z.array(bar).min(2).max(5000).optional(),metadata:metadata.optional(),error:z.string().min(1).max(1000).optional(),acquisitionFailure:acquisitionFailureSchema.optional()}).strict();
const finishInput=z.object({action:z.literal('finish'),id:uuid,cancelled:z.boolean()}).strict();
const input=z.discriminatedUnion('action',[startInput,resultInput,finishInput]);
const parse=(schema,value)=>{const r=schema.safeParse(value);if(!r.success)throw new AuditError('Dữ liệu audit không hợp lệ. Kiểm tra mã, khoảng ngày và tham số.');return r.data;};
const unpack=r=>({id:r.id,startedAt:r.started_at,completedAt:r.completed_at,status:r.status,mode:r.mode,origin:r.origin,source:r.source,symbols:JSON.parse(r.symbols_json),settings:JSON.parse(r.settings_json),engineVersion:r.engine_version});
const unpackResult=r=>({symbol:r.symbol,recordedAt:r.recorded_at,status:r.status,recommendation:r.recommendation,asOf:r.as_of,inputHash:r.input_hash,payloadHash:r.payload_hash,snapshot:JSON.parse(r.payload_json)});

export class AuditService {
  constructor(db){this.db=db;}
  async owned(user,id){
    const run=await this.db.prepare('SELECT * FROM audit_runs WHERE id = ? AND user_id = ?').bind(id,user).first();
    if(!run)throw new AuditError('Không tìm thấy lần chạy.',404);return run;
  }
  async mutate(user,raw){
    const p=parse(input,raw);
    if(p.action==='start')return this.start(user,p);
    if(p.action==='result')return this.record(user,p);
    return this.finish(user,p);
  }
  async start(user,p){
    try{optionsValid(p.settings.parameters);}catch(e){throw new AuditError(e.message);}
    if(p.settings.from>p.settings.to||new Set(p.symbols).size!==p.symbols.length||(p.mode==='single'&&p.symbols.length!==1))throw new AuditError('Danh sách mã hoặc khoảng ngày không hợp lệ.');
    const requestHash=await sha256(p), now=new Date().toISOString();
    await this.db.prepare('INSERT INTO audit_runs (id,user_id,started_at,status,mode,origin,source,symbols_json,settings_json,request_hash,engine_version) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(p.id,user,now,'running',p.mode,p.origin,p.source,JSON.stringify(p.symbols),JSON.stringify(p.settings),requestHash,ENGINE_VERSION).run();
    const run=await this.owned(user,p.id);
    if(run.request_hash!==requestHash)throw new AuditError('Mã lần chạy đã dùng cho cấu hình khác.',409);
    return {run:unpack(run)};
  }
  async record(user,p){
    const run=await this.owned(user,p.id), settings=JSON.parse(run.settings_json);
    if(!JSON.parse(run.symbols_json).includes(p.symbol))throw new AuditError('Mã không thuộc lần chạy này.');
    if((!p.error&&!p.rows)||(p.error&&p.rows))throw new AuditError('Cần dữ liệu giá hoặc lý do không có kết quả.');
    const failure=p.acquisitionFailure;
    if(failure&&(!p.error||failure.symbol!==p.symbol||failure.source!==run.source||failure.from!==settings.from||failure.to!==settings.to))throw new AuditError('Dấu vết nguồn không khớp mã, nguồn hoặc khoảng ngày của lần chạy.');
    try{validateMarketContext(p.metadata?.marketContext,p.symbol);validatePortfolio(p.metadata?.portfolio);validateReservations(p.metadata?.reservations);}catch(e){throw new AuditError(e.message);}
    // Preserve legacy idempotency hashes when no structured failure was supplied.
    const inputHash=await sha256({symbol:p.symbol,rows:p.rows??null,metadata:p.metadata??null,error:p.error??null,...(failure?{acquisitionFailure:failure}:{})});
    const existing=await this.db.prepare('SELECT * FROM audit_results WHERE run_id = ? AND symbol = ?').bind(p.id,p.symbol).first();
    if(existing){if(existing.input_hash!==inputHash)throw new AuditError('Kết quả đã lưu không thể ghi đè. Tạo lần chạy mới.',409);return this.afterRecord(user,p.id,unpackResult(existing));}
    if(run.status!=='running')throw new AuditError('Lần chạy đã kết thúc.',409);
    if(run.engine_version!==ENGINE_VERSION)throw new AuditError('Ứng dụng đã đổi phiên bản. Hãy tạo lần chạy mới.',409);
    const now=new Date().toISOString();
    let snapshot;
    if(p.error) snapshot={schemaVersion:1,engineVersion:ENGINE_VERSION,symbol:p.symbol,error:p.error,explanation:{summary:`${p.symbol}: không tạo recommendation vì ${p.error}`,paragraphs:[],conditions:[],limits:[]}};
    else {
      for(let i=0;i<p.rows.length;i++){
        const b=p.rows[i];
        if(b.date<settings.from||b.date>settings.to||(i&&p.rows[i-1].date>=b.date)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))throw new AuditError('OHLCV không hợp lệ, trùng phiên hoặc ngoài khoảng ngày.');
      }
      const reconciliation=await new ReconciliationService(this.db).resolve(user,{symbol:p.symbol,rows:p.rows,source:run.source,context:p.metadata?.marketContext,now});
      snapshot=buildSnapshot({symbol:p.symbol,rows:p.rows,parameters:settings.parameters,forecastMethod:settings.forecastMethod,horizon:settings.horizon,source:run.source,metadata:p.metadata,now,reconciliation});
    }
    if(failure){
      Object.assign(snapshot,{schemaVersion:2,recordedAt:now,source:run.source,acquisitionFailure:failure,evidenceOrigin:'client-relayed-api-diagnostics',
        recommendation:{state:'NO SIGNAL',reason:p.error},
        dataQuality:{status:failure.qualityStatus,eligible:false,sourceNames:failure.captures.map(c=>c.provider),upstreamIndependence:'unknown'}});
      snapshot.explanation.paragraphs=failure.captures.map(c=>`${c.provider.toUpperCase()} · ${c.capturedAt} · ${c.status==='ok'?'Có dữ liệu, chưa đủ căn cứ tin cậy':c.code} · ${c.count} nến · ${c.attempts.length} lần yêu cầu.`);
      snapshot.explanation.limits=['Dấu vết API được trình duyệt chuyển vào audit; chưa có chữ ký xác thực nguồn. Không lưu nội dung HTML, header hay query của nguồn giá.'];
    }
    const payloadJson=JSON.stringify(snapshot),payloadHash=await sha256(payloadJson);
    if(new TextEncoder().encode(payloadJson).length>1_800_000)throw new AuditError('Snapshot quá lớn. Rút ngắn khoảng lịch sử hoặc hồ sơ nhập rồi tạo lần chạy mới.',413);
    // The INSERT's ownership/state predicate prevents a late worker from writing after cancellation.
    await this.db.prepare('INSERT INTO audit_results (run_id,symbol,recorded_at,status,recommendation,as_of,input_hash,payload_hash,payload_json) SELECT id,?,?,?,?,?,?,?,? FROM audit_runs WHERE id = ? AND user_id = ? AND status = ? ON CONFLICT(run_id,symbol) DO NOTHING').bind(p.symbol,now,p.error?'error':'success',snapshot.recommendation?.state??snapshot.decision?.code??'ERROR',snapshot.asOf??null,inputHash,payloadHash,payloadJson,p.id,user,'running').run();
    const saved=await this.db.prepare('SELECT * FROM audit_results WHERE run_id = ? AND symbol = ?').bind(p.id,p.symbol).first();
    if(!saved)throw new AuditError('Lần chạy đã kết thúc trước khi lưu kết quả.',409);
    if(saved.input_hash!==inputHash)throw new AuditError('Kết quả đã lưu không thể ghi đè.',409);
    return this.afterRecord(user,p.id,unpackResult(saved));
  }
  async afterRecord(user,id,result){
    let evidenceWarning=null;
    try{const service=new EvidenceService(this.db);await service.register(user,id,result.snapshot);if(result.snapshot.inputBars)await service.evaluate(user,result.symbol,result.snapshot.inputBars,result.snapshot.metadata?.marketContext,result.snapshot.source);}
    catch{evidenceWarning='Audit đã lưu; theo dõi kết quả chưa đồng bộ. Dùng “Kiểm tra mốc đến hạn” để phục hồi.';}
    return {result,evidenceWarning};
  }
  async finish(user,p){
    let run=await this.owned(user,p.id);
    if(run.status!=='running')return {run:unpack(run)};
    const counts=await this.db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'error'),0) AS errors FROM audit_results WHERE run_id = ?").bind(p.id).first();
    const expected=JSON.parse(run.symbols_json).length;
    if(!p.cancelled&&counts.total!==expected)throw new AuditError('Chưa lưu đủ kết quả của lần chạy.',409);
    const status=p.cancelled?'cancelled':counts.errors===expected?'failed':counts.errors?'partial':'completed';
    await this.db.prepare('UPDATE audit_runs SET status = ?, completed_at = ? WHERE id = ? AND user_id = ? AND status = ?').bind(status,new Date().toISOString(),p.id,user,'running').run();
    run=await this.owned(user,p.id);return {run:unpack(run)};
  }
  async list(user,query){
    const clauses=['r.user_id = ?'], values=[user];
    const ticker=query.get('symbol'), decision=query.get('recommendation'),from=query.get('from'),to=query.get('to');
    if(ticker)parse(symbol,ticker);
    if(decision&&!Object.hasOwn(decisionNames,decision)&&!Object.hasOwn(FINAL_DECISION_NAMES,decision))throw new AuditError('Bộ lọc recommendation không hợp lệ.');
    if(decision){clauses.push(`EXISTS (SELECT 1 FROM audit_results a WHERE a.run_id = r.id${ticker?' AND a.symbol = ?':''} AND a.recommendation = ?)`);if(ticker)values.push(ticker);values.push(decision);}
    else if(ticker){clauses.push('EXISTS (SELECT 1 FROM json_each(r.symbols_json) WHERE value = ?)');values.push(ticker);}
    if(from){parse(date,from);clauses.push('r.started_at >= ?');values.push(new Date(`${from}T00:00:00+07:00`).toISOString());}
    if(to){parse(date,to);clauses.push('r.started_at <= ?');values.push(new Date(`${to}T23:59:59.999+07:00`).toISOString());}
    if(from&&to&&from>to)throw new AuditError('Ngày bắt đầu phải trước ngày kết thúc.');
    if(query.get('cursor')){
      let c;try{c=JSON.parse(query.get('cursor'));}catch{throw new AuditError('Con trỏ lịch sử không hợp lệ.');}
      const cursor=parse(z.object({time:z.string().datetime(),id:uuid}).strict(),c);
      clauses.push('(r.started_at < ? OR (r.started_at = ? AND r.id < ?))');values.push(cursor.time,cursor.time,cursor.id);
    }
    const {results}=await this.db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM audit_results a WHERE a.run_id = r.id) AS saved_count, (SELECT COUNT(*) FROM audit_results a WHERE a.run_id = r.id AND a.status = 'error') AS error_count FROM audit_runs r WHERE ${clauses.join(' AND ')} ORDER BY r.started_at DESC,r.id DESC LIMIT 26`).bind(...values).all();
    const page=results.slice(0,25),last=page.at(-1);
    return {runs:page.map(r=>({...unpack(r),savedCount:r.saved_count,errorCount:r.error_count})),nextCursor:results.length>25?JSON.stringify({time:last.started_at,id:last.id}):null};
  }
  async detail(user,id,includeInputs=false){
    parse(uuid,id);const run=await this.owned(user,id);
    // Strip large inputs inside SQLite, before materializing 100 results in a Worker.
    const columns=includeInputs?'*':"run_id,symbol,recorded_at,status,recommendation,as_of,input_hash,payload_hash,json_remove(payload_json,'$.inputBars','$.backtest.equity','$.metadata.marketContext.calendar','$.metadata.marketContext.sessions','$.metadata.marketContext.benchmarks') AS payload_json";
    const {results}=await this.db.prepare(`SELECT ${columns} FROM audit_results WHERE run_id = ? ORDER BY symbol`).bind(id).all();
    const items=results.map(unpackResult);
    if(!includeInputs)for(const item of items){delete item.snapshot.inputBars;delete item.snapshot.backtest?.equity;}
    return {run:unpack(run),results:items,unprocessed:JSON.parse(run.symbols_json).filter(symbol=>!items.some(x=>x.symbol===symbol))};
  }
  async exportJson(user,id){
    parse(uuid,id);const rawRun=await this.owned(user,id),db=this.db;
    const {results}=await db.prepare('SELECT symbol FROM audit_results WHERE run_id = ? ORDER BY symbol').bind(id).all();
    const symbols=results.map(r=>r.symbol),unprocessed=JSON.parse(rawRun.symbols_json).filter(s=>!symbols.includes(s));
    // One row per pull keeps a 100-symbol full-input export within Worker memory.
    async function* chunks(){
      yield '{"run":'+JSON.stringify(unpack(rawRun))+',"results":[';
      for(let i=0;i<symbols.length;i++){
        const row=await db.prepare('SELECT * FROM audit_results WHERE run_id = ? AND symbol = ?').bind(id,symbols[i]).first();
        yield (i?',':'')+JSON.stringify(unpackResult(row));
      }
      yield '],"unprocessed":'+JSON.stringify(unprocessed)+'}';
    }
    return chunks();
  }
}

export function auditCsv(detail){
  const cell=value=>{let s=String(value??'');if(/^[=+@\-\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const header=['run_id','started_at_utc','status','symbol','as_of','recommendation','source','engine_version','close','stop','target','forecast_center','explanation','input_sha256','payload_sha256','price_risk_score','price_risk_level','market_entry_ready','risk_rules_version','personal_plan','planned_quantity','max_buy_vnd','planned_risk_vnd','validation_status','data_freshness'];
  const lines=detail.results.map(r=>[detail.run.id,detail.run.startedAt,r.status,r.symbol,r.asOf,r.recommendation,detail.run.source,detail.run.engineVersion,r.snapshot.backtest?.lastPrice,r.snapshot.risk?.stop,r.snapshot.risk?.target,r.snapshot.forecast?.center,[r.snapshot.explanation?.summary,...(r.snapshot.explanation?.paragraphs||[])].join('\n'),r.inputHash,r.payloadHash,r.snapshot.priceRisk?.latest?.score,r.snapshot.priceRisk?.latest?.level,r.snapshot.market?.entryReady,r.snapshot.priceRisk?.version,r.snapshot.personalPlan?.status,r.snapshot.personalPlan?.quantity,r.snapshot.personalPlan?.maxBuyVnd,r.snapshot.personalPlan?.riskVnd,r.snapshot.validation?.status,r.snapshot.quality?.freshness]);
  for(const symbol of detail.unprocessed)lines.push([detail.run.id,detail.run.startedAt,'not_processed',symbol,'','',detail.run.source,detail.run.engineVersion]);
  return '\uFEFF'+[header,...lines].map(row=>row.map(cell).join(',')).join('\r\n');
}
