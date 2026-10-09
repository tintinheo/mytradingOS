import {validatePortfolio} from '../public/lab/trade-plan.mjs';
export class PortfolioService{
  constructor(db){this.db=db;}
  async get(user){const row=await this.db.prepare('SELECT portfolio_json,updated_at FROM personal_portfolios WHERE user_id = ?').bind(user).first();return row?{portfolio:JSON.parse(row.portfolio_json),updatedAt:row.updated_at}:{portfolio:null,updatedAt:null};}
  async save(user,raw,expectedUpdatedAt){
    const portfolio=validatePortfolio(raw);if(!portfolio)throw new Error('Cần danh mục hợp lệ.');
    const current=await this.get(user);if(current.updatedAt!==(expectedUpdatedAt??null))throw new Error('Danh mục đã được cập nhật ở phiên khác. Tải lại trước khi lưu.');
    const now=new Date().toISOString();
    if(current.updatedAt)await this.db.prepare('UPDATE personal_portfolios SET portfolio_json = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?').bind(JSON.stringify(portfolio),now,user,current.updatedAt).run();
    else await this.db.prepare('INSERT INTO personal_portfolios (user_id,portfolio_json,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING').bind(user,JSON.stringify(portfolio),now).run();
    const saved=await this.get(user);if(saved.updatedAt!==now||JSON.stringify(saved.portfolio)!==JSON.stringify(portfolio))throw new Error('Có cập nhật đồng thời. Tải lại danh mục.');return saved;
  }
}
