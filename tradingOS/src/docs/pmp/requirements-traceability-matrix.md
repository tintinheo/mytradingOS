# Ma trận truy vết yêu cầu

| ID | Yêu cầu | Nguồn | Tiêu chí nghiệm thu | Test/Bằng chứng | Trạng thái |
|---|---|---|---|---|---|
| REQ-DATA-001 | Giá CafeF được chuẩn hóa sang VND tại ingest | Audit F-01 | `7.13 -> 7,130 VND` | `test_cafef_prices_are_normalized_to_vnd`, `test_parse_real_cafef_fixture_normalizes_price_to_vnd` | PASS |
| REQ-DATA-002 | URL dùng folder YYYYMMDD và file DDMMYYYY | Build spec §7.1 | Daily/Upto URL đúng | `test_build_daily_url_uses_both_date_formats`, `test_build_upto_url_inserts_marker_before_filename_date` | PASS |
| REQ-DATA-003 | Parser fail-fast khi schema/date/encoding/OHLC/volume sai | Build spec §7.6 | Không có silent coercion | `test_cafef.py`: invalid row, schema, date, UTF-8, empty, duplicate | PASS |
| REQ-DATA-004 | CCNN chỉ được dùng sau khi xác minh semantic từng cột | Audit F-02 | Data dictionary + reconciliation | Chưa có | BLOCKED |
| REQ-DATA-005 | Mỗi bar giữ provenance raw/adjusted | Audit F-17 | `PriceBar.basis` bắt buộc | `test_parse_real_cafef_fixture_normalizes_price_to_vnd` | PASS |
| REQ-DATA-006 | Pipeline ZIP parse/QC/persist idempotent | Build spec §7 | Chạy hai lần không nhân bản rows | `test_pipeline.py` | PASS |
| REQ-MKT-001 | Tick HOSE 10/50/100; HNX/UPCOM 100 | Build spec §12.1 | Boundary 10k/50k đúng | `test_tick_size_boundaries` | PASS |
| REQ-MKT-002 | Giá mua làm tròn xuống; lower boundary bảo thủ làm tròn lên | Audit F-05 | Directional rounding đúng | `test_directional_tick_rounding`, `test_price_limits_round_inward_to_valid_ticks` | PASS |
| REQ-MKT-003 | Phân biệt settlement T+2 và EOD exit sáng phiên sau | Audit F-03 | entry+2 và entry+3 là hai field | `test_settlement_and_eod_exit_are_distinct_events` | PASS |
| REQ-BT-001 | Entry không bao giờ là close T | Build spec §19.2 | Fill chỉ từ open/low T+1 | `test_limit_fill_uses_t_plus_one_open_when_it_is_better_than_limit` | PASS |
| REQ-BT-002 | Backtest dùng membership point-in-time | Audit F-10 | Không survivorship | Nguồn chưa có | BLOCKED |
| REQ-BT-003 | Chi phí theo broker và effective date | Audit F-13 | Không gắn broker fee là `[S]` | Planned P4 | NOT STARTED |
| REQ-BT-004 | Mô hình fill phải công bố giả định touch/trade-through | Audit F-16 | Policy bắt buộc, hai boundary được test | `test_touch_policy_is_explicitly_more_optimistic_than_trade_through` | PASS |
| REQ-BT-005 | Execution chỉ nhận raw tradable quote | Audit F-17 | Adjusted input bị từ chối | `test_execution_rejects_adjusted_prices` | PASS |
| REQ-IND-001 | DATR có ADR duy nhất và golden fixture | Audit F-15 | Công thức không mơ hồ | Chưa chốt ADR | BLOCKED |
| REQ-IND-002 | Chỉ báo thuần Python không phụ thuộc TA-Lib | Build spec §8 | Golden values và validation | `test_indicators.py` | PASS |
| REQ-SIG-001 | Downtrend sinh đúng 0 tín hiệu | Signal spec §3 | Zero signals + rejection | Planned P7 | NOT STARTED |
| REQ-SIG-002 | Mọi gate theo thứ tự và có reason | Signal spec §3 | Decision-path coverage | Planned P7 | NOT STARTED |
| REQ-SIG-003 | Stop không vi phạm ngữ nghĩa max loss | Audit F-06 | ADR + golden sizing | Chưa chốt ADR | BLOCKED |
| REQ-SIG-004 | C4/MOM_20 không có nhánh bất khả thi | Audit F-08 | Matrix và Gate 4 nhất quán | Chưa có change decision | BLOCKED |
| REQ-SIG-005 | PB_MA20 paper signal qua regime/dual-RS/portfolio gates | Signal spec §3–§8 | Signal hoặc rejection reason deterministic | `test_signal_engine.py` | PASS |
| REQ-SIG-006 | C3 không áp sai logic mean-reversion | Audit F-08/F-14 | C3 bị fail-closed tới khi có MOM20 | `test_c3_is_rejected_until_momentum_setup_is_implemented` | PASS |
| REQ-PRIV-001 | Không publish NAV, cash, qty, notional VND | Build spec §6.5 | Artifact scan sạch | Planned P10 | NOT STARTED |
| REQ-OPS-001 | Adjusted history refresh tối thiểu tháng/event | Audit F-09 | Scheduled + idempotent | Planned P2/P9 | NOT STARTED |
| REQ-UI-001 | Local write, cloud read-only | Build spec §16 | Permission E2E | Planned P8/P10 | NOT STARTED |

Trạng thái chỉ được chuyển sang PASS khi test chạy trong CI/local validation và bằng
chứng được ghi lại. `BLOCKED` không được đổi thành `NOT APPLICABLE` để né gate.
