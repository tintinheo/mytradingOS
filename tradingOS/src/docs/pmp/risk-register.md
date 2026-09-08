# Sổ đăng ký rủi ro

Thang điểm: xác suất (P) và tác động (I) từ 1 đến 5; exposure = P × I.

| ID | Rủi ro/Trigger | P | I | Exposure | Owner | Ứng phó | Residual |
|---|---|---:|---:|---:|---|---|---|
| R-001 | CCNN bị ánh xạ sai vì header giả | 5 | 5 | 25 | Data lead | Block parser; lấy dictionary và reconcile | High |
| R-002 | Giá nghìn VND bị dùng như VND | 1 | 5 | 5 | Dev | Normalize tại ingest + fixture thực | Low |
| R-003 | Nhầm settlement pháp lý với lịch EOD | 2 | 4 | 8 | Domain owner | Hai field/hàm riêng + tests | Low |
| R-004 | CafeF trễ/ngừng/đổi schema | 4 | 5 | 20 | Ops | Cache, retry, Upto recovery, fallback, fail closed | Medium |
| R-005 | Corporate action gây false gap/sai history | 4 | 5 | 20 | Data lead | Factor event + VSDC reconciliation + monthly rebuild | Medium |
| R-006 | Survivorship do thiếu VN100 point-in-time | 5 | 5 | 25 | Research lead | Block historical VN100 backtest | High |
| R-007 | Overfit cluster/parameters | 4 | 5 | 20 | Research lead | Placebo first, walk-forward, DSR/PBO | Medium |
| R-008 | “Anomaly” bị hiểu là kết luận thao túng | 3 | 5 | 15 | Product owner | Neutral labels, evidence, disclaimer | Medium |
| R-009 | Máy local tắt hoặc DuckDB lock | 3 | 3 | 9 | Ops | catch-up, lock retry, failure notify | Low |
| R-010 | Lộ NAV/qty qua publish artifact | 2 | 5 | 10 | Security owner | Allowlist schema + PII scan | Low |
| R-011 | Quy tắc/phí thay đổi theo ngày | 3 | 4 | 12 | Domain owner | Effective-dated config + source register | Medium |
| R-012 | Output chưa hiệu chuẩn được dùng tiền thật | 4 | 5 | 20 | Owner | Feature flag paper-only, visible warning, release gate | Medium |

## Escalation

- Exposure 20–25: blocker; không phát hành phạm vi bị ảnh hưởng.
- Exposure 12–19: cần mitigation owner và test trước phase gate.
- Exposure 6–11: theo dõi tại milestone.
- Exposure 1–5: chấp nhận có ghi nhận.