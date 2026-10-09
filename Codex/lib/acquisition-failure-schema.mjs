import {z} from 'zod';
import {ACQUISITION_FAILURE_VERSION} from '../public/lab/acquisition-failure.mjs';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const code=z.string().regex(/^DATA_[A-Z_]{1,60}$/),token=z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/).nullable();
const provider=z.enum(['dnse','cafef']);
const attempt=z.object({host:z.string().max(253).regex(/^[a-z0-9.-]+$/).nullable(),requestedAt:z.string().datetime().nullable(),httpStatus:z.number().int().min(100).max(599).nullable(),code:code.nullable()}).strict();
const capture=z.object({provider,status:z.enum(['ok','error']),code:code.nullable(),capturedAt:z.string().datetime(),adapterVersion:token.nullable(),rawHash:hash,seriesHash:hash,priceUnit:token.nullable(),priceBasis:token.nullable(),volumeKind:token.nullable(),lastBar:date.nullable(),count:z.number().int().min(0).max(1000),attempts:z.array(attempt).min(1).max(3)}).strict();
export const acquisitionFailureSchema=z.object({version:z.literal(ACQUISITION_FAILURE_VERSION),symbol:z.string().regex(/^[A-Z0-9]{2,10}$/),source:provider,from:date,to:date,code:z.literal('DATA_UNAVAILABLE'),primaryCode:code,fallbackAttempted:z.literal(true),qualityStatus:z.enum(['QUARANTINED','UNAVAILABLE']),recommendation:z.literal('NO SIGNAL'),captures:z.array(capture).length(2)}).strict().refine(v=>v.from<=v.to&&v.captures[0].provider===v.source&&v.captures[0].status==='error'&&v.captures[0].code===v.primaryCode&&v.captures[1].provider!==v.source&&v.qualityStatus===(v.captures[1].status==='ok'?'QUARANTINED':'UNAVAILABLE'));
