import {observationFromSnapshot,evaluateObservation,summarizeObservations} from '../public/lab/outcomes.mjs';
const unpack=r=>({runId:r.run_id,symbol:r.symbol,recordedAt:r.recorded_at,status:r.status,config:JSON.parse(r.config_json),outcome:r.outcome_json?JSON.parse(r.outcome_json):null,updatedAt:r.updated_at});
export class EvidenceService{
  constructor(db){this.db=db;}
  async register(user,runId,snapshot){
    if(snapshot.schemaVersion<3||snapshot.error)return;
    const o=observationFromSnapshot(snapshot);
    await this.db.prepare('INSERT INTO evidence_observations (user_id,run_id,symbol,recorded_at,origin_date,status,config_json,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM audit_results a JOIN audit_runs r ON a.run_id=r.id WHERE a.run_id=? AND a.symbol=? AND r.user_id=?) ON CONFLICT(run_id,symbol) DO NOTHING').bind(user,runId,o.symbol,o.recordedAt,o.originDate,o.status,JSON.stringify(o),o.recordedAt,runId,o.symbol,user).run();
  }
  async evaluate(user,symbol,rows,context,source){
    const {results}=await this.db.prepare("SELECT * FROM evidence_observations WHERE user_id = ? AND symbol = ? AND json_extract(config_json,'$.source') = ? AND json_extract(config_json,'$.targetDate') <= ? AND status IN ('waiting','data_issue') ORDER BY updated_at ASC, recorded_at ASC LIMIT 100").bind(user,symbol,source,rows.at(-1)?.date||'').all();
    const now=new Date().toISOString();let changed=0;
    for(const row of results){const o=evaluateObservation(JSON.parse(row.config_json),rows,context,source);if(o.status==='waiting')continue;await this.db.prepare("UPDATE evidence_observations SET status=?,outcome_json=?,updated_at=? WHERE run_id=? AND symbol=? AND user_id=? AND status != 'evaluated'").bind(o.status,JSON.stringify(o),now,row.run_id,symbol,user).run();changed++;}
    return {checked:results.length,changed,limited:results.length===100};
  }
  /** @param {string} user @param {string|null} [symbol] */
  async list(user,symbol=null){
    if(symbol&&!/^[A-Z0-9]{2,10}$/.test(symbol))throw new Error('Mã không hợp lệ.');
    const {results}=await this.db.prepare('SELECT * FROM evidence_observations WHERE user_id = ?'+(symbol?' AND symbol = ?':'')+' ORDER BY recorded_at DESC LIMIT 1000').bind(...(symbol?[user,symbol]:[user])).all(),records=results.map(unpack);
    const groups=new Map();for(const r of records){const key=[r.config.forecastMethod,r.config.horizon,r.config.engineVersion,r.config.source].join(' · ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
    return {records,summary:summarizeObservations(records),groups:[...groups].map(([key,items])=>({key,...summarizeObservations(items)})),limited:records.length===1000};
  }
}
