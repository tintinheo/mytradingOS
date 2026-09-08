# Nhật ký quyết định

| ID | Ngày | Quyết định | Lý do/Bằng chứng | Trạng thái |
|---|---|---|---|---|
| ADR-001 | 07/09/2026 | Đơn vị giá nội bộ là VND; CafeF nhân 1.000 tại ingest | Fixture thực và trang CafeF ghi giá nghìn VND | Accepted |
| ADR-002 | 07/09/2026 | Tách `settlement_session=T+2` và `planned_eod_exit=T+3` | Phân biệt khả dụng chứng khoán và lịch quyết định EOD | Accepted |
| ADR-003 | 07/09/2026 | Block CCNN cho tới khi có data dictionary | Header file không mô tả semantic cột | Accepted |
| ADR-004 | 07/09/2026 | Execution chỉ nhận `MarketPrice.RAW` | Adjusted price không phải tradable quote | Accepted |
| ADR-005 | 07/09/2026 | Fill policy là tham số bắt buộc; baseline conservative dùng trade-through | Daily low chỉ chứng minh touch, không chứng minh full fill | Accepted |
| ADR-006 | 07/09/2026 | Giữ cửa loại LO `>= 99,5%` giá trần | Yêu cầu có trong signal/build spec; đây là risk policy, không phải luật khớp lệnh | Accepted, uncalibrated |