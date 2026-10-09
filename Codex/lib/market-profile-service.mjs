import {parseContextFile} from '../public/lab/vn-market.mjs';
export class MarketProfileService{
  constructor(db){this.db=db;}
  async list(user){
    const {results}=await this.db.prepare('SELECT context_json, updated_at FROM market_profiles WHERE user_id = ? ORDER BY symbol').bind(user).all();
    return {profiles:results.map(r=>({context:JSON.parse(r.context_json),updatedAt:r.updated_at}))};
  }
  async save(user,text){
    const profiles=parseContextFile(text),now=new Date().toISOString();
    const existing=await this.list(user),all=new Set([...existing.profiles.map(x=>x.context.symbol),...profiles.keys()]);
    if(all.size>100)throw new Error('Chỉ lưu tối đa 100 hồ sơ mã. Xóa mã không dùng trước khi nhập thêm.');
    if([...profiles.values()].some(c=>new TextEncoder().encode(JSON.stringify(c)).length>700000))throw new Error('Một hồ sơ tối đa 700 KB; rút ngắn lịch sử nhập.');
    const merged=new Map(existing.profiles.map(x=>[x.context.symbol,x.context]));for(const [symbol,c] of profiles)merged.set(symbol,c);
    const totalBytes=[...merged.values()].reduce((sum,c)=>sum+new TextEncoder().encode(JSON.stringify(c)).length,0);
    if(totalBytes>12_000_000)throw new Error('Tổng hồ sơ tối đa 12 MB; rút ngắn lịch sử hoặc bỏ hồ sơ không dùng.');
    const statements=[...profiles.values()].map(c=>this.db.prepare('INSERT INTO market_profiles (user_id,symbol,context_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,symbol) DO UPDATE SET context_json=excluded.context_json,updated_at=excluded.updated_at').bind(user,c.symbol,JSON.stringify(c),now));
    await this.db.batch(statements);
    return {saved:profiles.size,updatedAt:now};
  }
  async remove(user,symbol){
    if(!/^[A-Z0-9]{2,10}$/.test(symbol))throw new Error('Mã không hợp lệ.');
    await this.db.prepare('DELETE FROM market_profiles WHERE user_id = ? AND symbol = ?').bind(user,symbol).run();
    return {removed:symbol};
  }
}
