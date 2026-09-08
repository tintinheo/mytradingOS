# Kế hoạch quản lý dự án TinTradingOS

Tài liệu này áp dụng các nhóm quản lý của PMBOK/PMP cho việc kiểm soát dự án.
PMP không phải tiêu chuẩn kiểm thử phần mềm; chiến lược chất lượng dùng requirement
traceability, test pyramid, contract tests, backtest validation và acceptance gates.

## 1. Project charter

**Mục tiêu:** xây công cụ nghiên cứu chứng khoán Việt Nam EOD, long-only, local-first,
không auto-trading, không tư vấn đầu tư, có backtest execution-aware trước signal.

**Thành công khi:** dữ liệu có nguồn và ngày hiệu lực; mọi yêu cầu có test hoặc bằng
chứng nghiệm thu; không phát signal nếu QC thất bại; paper trading đạt gate trước khi
cho phép cấu hình tiền thật.

**Ngoài phạm vi hiện tại:** intraday, phái sinh, margin, đặt lệnh tự động, phân phối
dữ liệu, kết luận thao túng, cloud compute và meta-model khi chưa đủ mẫu.

## 2. Quản lý tích hợp

- Baseline gồm báo cáo thẩm định, plan này, RTM và risk register.
- Thay đổi quy tắc thị trường, công thức, nguồn, schema hoặc tham số phải có change ID.
- Mỗi change ghi lý do, bằng chứng, ảnh hưởng, test và quyết định chấp thuận/từ chối.
- Definition of Done: code review, RTM cập nhật, test pass, không còn blocker mở cho
  phạm vi phát hành, và tài liệu vận hành được cập nhật.

## 3. Quản lý phạm vi

| Giai đoạn | Deliverable | Exit gate |
|---|---|---|
| P0 | Python package, market rules, encoding/path policy | Unit + boundary tests pass |
| P1 | CafeF price ingest, real fixture, archive, QC | Contract tests và idempotency pass |
| P2 | Corporate factor events, calendar, point-in-time reference data | Manual reconciliation pass |
| P3 | Indicators, breadth, VN100_EW | Golden/property tests pass |
| P4 | T+1 execution backtest, costs, T+2 constraints | Phantom-profit comparison produced |
| P5 | Profiles/clusters | Placebo và stability gate pass hoặc clustering bị loại |
| P6 | Statistical risk flags | Labelled validation, false-positive report |
| P7 | Seven-gate signal engine and exits | RTM signal cases pass; still paper-only |
| P8 | Local Streamlit UI and journal | Local E2E and usability acceptance |
| P9 | Scheduler, recovery, notification | One-week unattended soak test |
| P10 | Optional cloud read-only view | Privacy, memory and page-time gates |

## 4. Quản lý tiến độ

Áp dụng thứ tự P0→P10; P4 phải xong trước P7; P8 local trước P10 cloud. Kế hoạch
được cập nhật theo milestone, không cam kết ngày khi chưa có capacity của owner.
Đường găng hiện tại: data contract → QC → indicators → backtest → placebo → signal.

## 5. Quản lý chi phí

Ngân sách hạ tầng mục tiêu là 0 VND/tháng theo proposal. [ASSUME] Chi phí thời gian,
điện, máy local, dữ liệu dự phòng và tài khoản broker chưa được lượng hóa, nên “0” chỉ
là chi phí dịch vụ cloud trực tiếp, không phải total cost of ownership.

## 6. Quản lý chất lượng và kiểm thử

“Tất cả cases được test” được định nghĩa có thể kiểm toán như sau:

1. Mỗi requirement trong RTM có ít nhất một positive case, negative case và boundary
   case khi có biên số học.
2. Mỗi decision/gate có branch test và rejection reason test.
3. Mỗi nguồn ngoài có fixture thực, schema test, freshness test và malformed-data test.
4. Mỗi công thức có golden test; invariant có property/parametric test.
5. Mỗi pipeline có idempotency, partial failure, retry và stale-data test.
6. Backtest có look-ahead, survivorship, T+1 fill, no-fill, corporate-action và cost test.
7. UI có local/cloud permission, stale banner, empty/error/loading và privacy tests.
8. Không tuyên bố “mọi input khả dĩ” đã test; completion nghĩa là 100% requirement và
   decision-path coverage theo RTM, cùng risk-based tests cho failure modes.

Quality gates:

- Commit gate: unit/contract tests và lint pass.
- Phase gate: RTM của phase 100% PASS, không blocker/critical defect mở.
- Paper gate: walk-forward, DSR/PBO, EOD fill và placebo pass.
- Production gate: tối thiểu một chu kỳ paper trading được owner phê duyệt; thời lượng
  là open decision, không được tự giả định.

## 7. Quản lý nguồn lực

Owner là sponsor, product owner và người duyệt giao dịch. Copilot hỗ trợ phân tích,
code, test và tài liệu; không quyết định đầu tư. Các xác minh pháp lý/thị trường cần
nguồn chính thức hoặc chuyên gia phù hợp.

## 8. Quản lý truyền thông

- Báo cáo milestone: phạm vi hoàn thành, test, rủi ro mới, quyết định cần owner duyệt.
- Job EOD: một thông báo success ngắn; failure gồm run ID, nguồn lỗi và log path.
- Mọi output UI phải tách FACT / ASSUMPTION / UNCALIBRATED.

## 9. Quản lý rủi ro

Risk owner, trigger, response và residual risk được quản lý tại `risk-register.md`.
Blocker không được “accept” ngầm bằng code fallback.

## 10. Quản lý mua sắm

Không mua dịch vụ trong baseline. Trước khi dùng nguồn miễn phí phải lưu URL, điều
khoản sử dụng, rate policy và quyền lưu trữ. Nguồn không SLA phải có recovery hoặc
manual fallback đã test.

## 11. Quản lý stakeholder

| Stakeholder | Vai trò | Nhu cầu |
|---|---|---|
| Owner | Sponsor/Product Owner/User | Đúng dữ liệu, giải thích được, thao tác ngắn |
| Data providers | External supplier | Polite access, không tái phân phối |
| Regulators/exchanges | Rule authority | Không xuyên tạc quy tắc hay hành vi vi phạm |
| Broker | Execution venue | Giá, phí, lot và khả dụng chứng khoán đúng tài khoản |

## 12. Change control

Một change request phải có: `CR-ID`, vấn đề, nguồn bằng chứng, phạm vi ảnh hưởng,
phương án, risk delta, test delta, rollback và quyết định owner. Thay đổi `[D]` không
được hợp thức hóa chỉ vì in-sample tốt hơn.
