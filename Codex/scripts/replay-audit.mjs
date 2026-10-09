// Usage: node scripts/replay-audit.mjs /path/to/exported-audit.json
import {readFileSync} from 'node:fs';
import {buildSnapshot,ENGINE_VERSION} from '../public/lab/recommendation.mjs';
import {sha256} from '../lib/hashes.mjs';
const file=process.argv[2];if(!file)throw new Error('Supply an exported audit JSON file.');
const audit=JSON.parse(readFileSync(file,'utf8')),report=[];
for(const result of audit.results){
 const s=result.snapshot;
 if(result.payloadHash&&await sha256(JSON.stringify(s))!==result.payloadHash){report.push({symbol:result.symbol,status:'HASH_MISMATCH'});continue;}
 if(s.error){report.push({symbol:result.symbol,status:'ERROR_RECORD_VERIFIED'});continue;}
 if(s.engineVersion!==ENGINE_VERSION){report.push({symbol:result.symbol,status:'ENGINE_VERSION_REQUIRED',engine:s.engineVersion});continue;}
 if(!s.inputBars){report.push({symbol:result.symbol,status:'FULL_EXPORT_REQUIRED'});continue;}
 const rebuilt=buildSnapshot({symbol:s.symbol,rows:s.inputBars,parameters:s.parameters,forecastMethod:s.forecastMethod,horizon:s.horizon,source:s.source,metadata:s.metadata,now:s.calculatedAt,reconciliation:s.quality.reconciliation});
 report.push({symbol:s.symbol,status:await sha256(rebuilt)===await sha256(s)?'REPRODUCED':'REPRODUCTION_MISMATCH'});
}
console.log(JSON.stringify(report,null,2));if(report.some(r=>!['REPRODUCED','ERROR_RECORD_VERIFIED'].includes(r.status)))process.exitCode=1;
