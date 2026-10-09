import {captureSource} from './source-capture.mjs';

// A second hostname is not an independent provider. Keep each acquisition intact.
// Neither currently configured adapter has verified independent upstream lineage.
// Failed-primary fallback captures therefore remain quarantined, never relabeled
// as the requested source or silently substituted into its market/audit profile.
export async function loadHistory(provider,args,capture=captureSource){
  const primary=await capture(provider,args);
  if(primary.status==='ok')return {...primary,requestedProvider:provider,fallbackAttempted:false,primaryCode:null,captures:null,dataQuality:null};
  const alternate=provider==='dnse'?'cafef':'dnse';
  const fallback=await capture(alternate,{symbol:args.symbol,from:args.from,to:args.to});
  const summary=c=>({provider:c.provider,label:c.label,status:c.status,code:c.code,
    capturedAt:c.capturedAt,adapterVersion:c.adapterVersion,rawHash:c.rawHash,seriesHash:c.seriesHash,
    priceUnit:c.priceUnit,priceBasis:c.priceBasis,volumeKind:c.volumeKind,
    upstreamIndependence:c.upstreamIndependence,lastBar:c.bars.at(-1)?.date,
    count:c.bars.length,attempts:c.attempts});
  const available=fallback.status==='ok';
  return {...primary,bars:[],code:'DATA_UNAVAILABLE',primaryCode:primary.code,
    requestedProvider:provider,fallbackAttempted:true,recommendation:'NO SIGNAL',
    dataQuality:{status:available?'QUARANTINED':'UNAVAILABLE',eligible:false,
      sourceNames:[primary.label,fallback.label],upstreamIndependence:'unknown'},
    captures:[summary(primary),summary(fallback)],
    error:`DATA_UNAVAILABLE: ${primary.code||'DATA_UNAVAILABLE'}. ${available?
      `Nguồn dự phòng ${fallback.label} có dữ liệu nhưng chưa xác minh độc lập và cơ sở giá; đã cách ly. Chọn nguồn này và đối chiếu lại để nghiên cứu.`:
      'Cả nguồn chính và dự phòng đều không khả dụng.'} Recommendation: NO SIGNAL.`};
}
