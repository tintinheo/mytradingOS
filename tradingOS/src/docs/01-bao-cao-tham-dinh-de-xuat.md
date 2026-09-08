# Báo cáo thẩm định đề xuất TinTradingOS

**Ngày thẩm định:** 07/09/2026  
**Phạm vi:** bốn tài liệu trong thư mục `tradingOS/docs`  
**Quyết định:** **GO có điều kiện** cho nền tảng dữ liệu và backtest; **NO-GO** cho tín
hiệu tiền thật, CCNN và chấm điểm bất thường cho tới khi đóng các blocker bên dưới.

## 1. Kết luận điều hành

Các tài liệu có hướng kiến trúc phù hợp cho một công cụ cá nhân EOD: local-first,
không auto-trading, backtest trước signal, chống look-ahead và có kiểm soát rủi ro.
Tuy nhiên, một số nội dung đang được gắn nhãn là quy tắc thị trường hoặc dữ liệu đã
xác minh trong khi thực tế mới là giả định. Hai lỗi có thể làm sai toàn bộ phép tính
là **đơn vị giá CafeF** và **hợp đồng cột CCNN**.

Không được dùng các tham số `[D]`, kết quả phân nhóm hay xác suất thắng cho tiền thật
trước khi hoàn thành walk-forward, kiểm định placebo và paper trading.

## 2. Phát hiện có bằng chứng

| ID | Mức độ | Phát hiện và lý do | Hành động bắt buộc | Tin cậy |
|---|---|---|---|---:|
| F-01 | **Blocker** | File giá thật ngày 04/09/2026 ghi `AAA ... 7.09 ... 7.13`, tức giá theo **nghìn VND**, trong khi ví dụ parser của proposal kỳ vọng `8500`, `8720`. Không nhân 1.000 sẽ làm sai turnover, ADV, tick, sizing và NAV. [Nguồn: `tests/fixtures/cafef_price_sample.csv`, dòng AAA; `proposal-v2.1-cafef-eod.md`, Phần A.1/C.1; `VNQD-BUILD-SPEC-EN-v2-local.md`, §7.3] | Chuẩn nội bộ duy nhất là VND; parser phải nhân 1.000 ngay tại biên ingest. Đã triển khai và test. | 100% |
| F-02 | **Blocker** | Gói `CafeF.CCNN.04092026.zip` thực tế có sáu file `CC_*` và `NN_*`. Mỗi file dùng header giả `<Open>...<OI>`, không có tên `bid_volume`, `ask_volume`, `foreign_buy`, `foreign_sell`. Proposal giả định một bảng đã đặt tên và vì vậy chưa đủ để tính OI/OTR/FNET. [Nguồn: gói CafeF tải ngày 07/09/2026; `proposal-v2.1-cafef-eod.md`, A.1/A.3/C.3; `dac-ta-module-tin-hieu.md`, §1.1/§2.5] | Không parse theo suy đoán. Yêu cầu data dictionary CafeF/Indicator Pack hoặc đối chiếu từng cột với một nguồn độc lập trong ít nhất 20 mã và 5 phiên. | 100% |
| F-03 | **Cao** | Tài liệu gọi `entry_idx + 3` là thời điểm “sớm nhất có thể bán”. Chu kỳ T+2 cho phép giao dịch chứng khoán đã về trong buổi chiều ngày T+2; `entry+3` chỉ là thời điểm **chiến lược EOD** đặt lệnh sau khi chờ đóng cửa T+2. Gộp hai khái niệm làm sai mô phỏng intraday/exit. [Nguồn: `VNQD-BUILD-SPEC-EN-v2-local.md`, §14.1; `proposal-v2.1-cafef-eod.md`, B.2/C.4; thông tin triển khai T+2 từ Cổng TTĐT Chính phủ ngày 30/08/2022 và hướng dẫn VNDIRECT] | Dùng hai hàm riêng: `settlement_session_index = entry+2` và `next_morning_eod_exit_index = entry+3`. Đã triển khai và test. | 95% |
| F-04 | **Cao** | Tỷ số `adj_close/raw_close` có thể phát hiện điểm thay đổi hệ số, nhưng không đủ thông tin để kết luận “lịch sự kiện quyền hoàn chỉnh” hoặc phân biệt chắc chắn cổ tức tiền, cổ phiếu thưởng, quyền mua và phát hành. Nhiều sự kiện có thể tạo tỷ lệ gần nhau. [Nguồn: `proposal-v2.1-cafef-eod.md`, A.1/C.2; `VNQD-BUILD-SPEC-EN-v2-local.md`, §7.5] | Đổi tên đầu ra thành `adjustment_factor_events`; loại `implied_type` khỏi dữ liệu quyết định. Đối chiếu ex-date/type với VSDC trước khi dùng. | 98% |
| F-05 | **Cao** | Tính trần/sàn bằng một hàm luôn làm tròn xuống chưa chứng minh là thuật toán giá trần/sàn chính thức; ngày GDKHQ còn có thể có giá tham chiếu khác close T. [Nguồn: `dac-ta-module-tin-hieu.md`, §5.3–5.4; `VNQD-BUILD-SPEC-EN-v2-local.md`, §12.1] | Ingest giá tham chiếu, trần, sàn do Sở/CTCK công bố khi có thể. Hàm hiện tại chỉ mang tên “conservative boundaries”, không được coi là giá chính thức. | 95% |
| F-06 | **Cao** | `exit_stop = min(structure_stop, max_loss_stop)` chọn mức thấp hơn, nên có thể vượt `max_stop_pct`; điều này mâu thuẫn với tên “stop tối đa” và mô tả “stop hẹp”. [Nguồn: `dac-ta-module-tin-hieu.md`, §6.1; `VNQD-BUILD-SPEC-EN-v2-local.md`, §12.2] | Chốt ngữ nghĩa trước khi code. [ASSUME] Nếu `max_stop_pct` là mức lỗ tối đa, phải chọn `max(...)`; nếu là khoảng cách tối thiểu thì đổi tên và tiêu chí nghiệm thu. | 99% |
| F-07 | **Trung bình** | Trailing stop dùng `ATR_14` trong đặc tả tín hiệu nhưng dùng `atr_22` trong build spec; registry không định nghĩa cửa sổ 22. [Nguồn: `dac-ta-module-tin-hieu.md`, §6.3; `VNQD-BUILD-SPEC-EN-v2-local.md`, §12.4/§18] | Chọn một cửa sổ qua change request và golden test; mặc định chưa được phép. | 100% |
| F-08 | **Cao** | Ma trận cho phép `MOM_20` ở C4, nhưng Gate 4 buộc C4 (logic TREND, không phải MOMENTUM) có `rs_20_rank <= 40`, trong khi `MOM_20` yêu cầu `>=65`; nhánh này không bao giờ chạy. [Nguồn: `VNQD-BUILD-SPEC-EN-v2-local.md`, §10 Gate 4/§11 S7 và ma trận; `dac-ta-module-tin-hieu.md`, §3/§4] | Cấm `MOM_20` cho C4 hoặc sửa Gate 4 theo setup thay vì theo cluster. Chưa chọn cho tới khi placebo/backtest có kết quả. | 100% |
| F-09 | **Trung bình** | Tần suất rebuild adjusted history là “mỗi tháng” ở proposal v2.1 nhưng “mỗi quý” ở build spec. Rebuild theo quý có thể để indicator sai sau sự kiện quyền trong nhiều tuần. [Nguồn: `proposal-v2.1-cafef-eod.md`, A.1 Bẫy 2/B.4; `VNQD-BUILD-SPEC-EN-v2-local.md`, §2/§7.4] | Baseline: rebuild khi phát hiện factor thay đổi và tối thiểu hàng tháng; quarterly chỉ dùng cho profile/cluster. | 100% |
| F-10 | **Blocker backtest** | VN100_EW yêu cầu cập nhật thành phần mỗi kỳ nhưng không có hợp đồng dữ liệu membership point-in-time. Dùng rổ hiện tại cho lịch sử tạo survivorship/look-ahead bias. [Nguồn: `dac-ta-module-tin-hieu.md`, §2.2; `VNQD-BUILD-SPEC-EN-v2-local.md`, §8.2] | Thu thập lịch sử hiệu lực thành phần VN100 hoặc giới hạn backtest từ kỳ có snapshot được xác minh. | 99% |
| F-11 | **Cao** | Các thẻ `<cite index="...">` không liên kết tới DOI/URL/trang/bảng; do đó chưa thể tái kiểm tra các con số học thuật. Suy luận “thị trường yếu hiệu quả ⇒ chiến lược có lợi nhuận sau phí” cũng không tự động đúng. [Nguồn: `nghien-cuu-v3-dac-trung-vn100.md`, Phần 1/Phụ lục] | Lập evidence register gồm DOI/URL, kỳ mẫu, thị trường, bảng và kết quả; mọi hệ số số học rút ra từ nghiên cứu vẫn phải gắn `[D]` nếu bài báo không quy định hệ số đó. | 95% |
| F-12 | **Cao** | “29/32 quy tắc anomaly chạy được” là quá mạnh: dữ liệu tổng hợp ngày không chứa trình tự đặt-hủy lệnh nên không thể kết luận spoofing/layering. [Nguồn: `proposal-v2.1-cafef-eod.md`, A.3] | Chỉ gọi là chỉ báo thống kê cung-cầu; cấm nhãn hành vi vi phạm. Kiểm định với nhãn công khai và báo false-positive. | 98% |
| F-13 | **Trung bình** | Phí môi giới 0,15% và lãi margin 13,5% được gắn `[S]`, nhưng đây là điều khoản theo CTCK/tài khoản và có thể đổi, không phải cấu trúc cố định toàn thị trường. [Nguồn: `VNQD-BUILD-SPEC-EN-v2-local.md`, §18] | Chuyển sang cấu hình có `effective_from`, nguồn và broker; không hardcode thành structural rule. | 99% |
| F-14 | **Cao** | C3 được mô tả có thể pullback ở SIDEWAY với giảm 50% tỷ trọng, nhưng bảng tham số lại yêu cầu `STRONG_UPTREND`, khiến nhánh SIDEWAY không thể chạy. [Nguồn: `nghien-cuu-v3-dac-trung-vn100.md`, Phần 4 C3/Phần 5; `VNQD-BUILD-SPEC-EN-v2-local.md`, §9.5/§18.1] | Baseline an toàn: C3 chỉ STRONG_UPTREND. Mọi nới lỏng phải qua change control và backtest. | 100% |
| F-15 | **Cao** | `DATR_14` chưa xác định là 14 phiên lịch gần nhất rồi lọc phiên giảm hay 14 phiên giảm gần nhất. Hai cách có horizon và giá trị khác nhau. [Nguồn: `dac-ta-module-tin-hieu.md`, §2.3; `nghien-cuu-v3-dac-trung-vn100.md`, Phần 8.1] | CRITICAL DATA MISSING: định nghĩa toán học duy nhất cho DATR và quy tắc khi số phiên giảm không đủ. Không code indicator trước khi chốt ADR. | 100% |
| F-16 | **Cao** | OHLC ngày chỉ chứng minh giá LO đã được chạm, không chứng minh toàn bộ khối lượng giả lập đã khớp do thiếu queue và volume-at-price. [Nguồn: `proposal-v2.1-cafef-eod.md`, C.4; `VNQD-BUILD-SPEC-EN-v2-local.md`, §19.3] | Backtest phải công bố policy. Đã triển khai `TOUCH_OPTIMISTIC` và `TRADE_THROUGH_CONSERVATIVE`; kết quả chính dùng conservative, optimistic chỉ để sensitivity analysis. | 100% |
| F-17 | **Cao** | Giá adjusted phù hợp tính chỉ báo nhưng không phải báo giá có thể đặt lệnh; trộn close adjusted với OHLC raw quanh ngày quyền tạo false gap/fill. [Nguồn: `proposal-v2.1-cafef-eod.md`, A.1 Bẫy 2/B.1; `VNQD-BUILD-SPEC-EN-v2-local.md`, §6.1/§7.5] | Mọi input execution bắt buộc mang `PriceBasis.RAW`; adjusted chỉ dùng analytics. Đã triển khai type và negative test. | 100% |

## 3. Điểm đúng nên giữ

1. Backtest phải mô phỏng tín hiệu cuối T và khớp trong T+1, không dùng close T làm entry.
2. Local compute, cloud read-only và privacy boundary là kiến trúc phù hợp.
3. Fail-fast khi dữ liệu không đạt QC; lưu lý do loại ở từng gate.
4. Tách tham số structural/measured/default và hiệu chuẩn pooled theo cluster.
5. Chạy placebo trước khi đầu tư thêm vào clustering.
6. Không auto-trading, không phát tín hiệu mua khi downtrend, không bình quân giá xuống.

## 4. Dữ liệu còn thiếu trước khi sinh tín hiệu

- **CRITICAL DATA MISSING: CafeF CC/NN column dictionary** - Không có trong tài liệu hoặc header file.
- **CRITICAL DATA MISSING: lịch sử thành phần VN100 theo ngày hiệu lực** - Không có trong context.
- **CRITICAL DATA MISSING: danh sách cảnh báo/kiểm soát/hạn chế giao dịch có hiệu lực theo ngày** - Không có pipeline xác minh.
- **CRITICAL DATA MISSING: nguồn free-float và owner-group có ngày hiệu lực** - Không có hợp đồng nguồn.
- **CRITICAL DATA MISSING: định nghĩa DATR duy nhất** - Hai cách hiểu hợp lệ cho kết quả khác nhau.
- **CRITICAL DATA MISSING: data dictionary và điều khoản sử dụng CafeF Indicator Pack** - Không có trong context.

## 5. Baseline triển khai sau thẩm định

- Giá nội bộ: `Decimal`, đơn vị VND; chỉ đổi định dạng ở UI.
- Parser dữ liệu: schema fail-fast, fixture thực, không tự đổi tên cột chưa xác minh.
- Settlement: lưu riêng `settlement_session` và `planned_eod_exit_session`.
- Gate phát hành: chỉ có dữ liệu/backtest sau QC; signal bị vô hiệu hóa mặc định.
- Mọi tham số chiến lược chưa hiệu chuẩn phải hiển thị nhãn `UNCALIBRATED`.

## 6. Nguồn ngoài đã đối chiếu

- CafeF, trang dữ liệu AmiBroker/MetaStock: <https://cafef.vn/du-lieu/du-lieu-download.chn>
- CafeF, dữ liệu lịch sử hiển thị rõ đơn vị “Giá (nghìn VNĐ)”: <https://cafef.vn/du-lieu.chn>
- Yuanta Việt Nam, FAQ KRX về thay đổi ưu tiên ATO/ATC:
	<https://support.yuanta.com.vn/hc/vi/articles/46824615172377-KRX-C%C3%A2u-h%E1%BB%8Fi-th%C6%B0%E1%BB%9Dng-g%E1%BA%B7p>

[ASSUME] Nguồn pháp quy sơ cấp cho quy trình T+2 và thuật toán giá trần/sàn chưa
được lưu trong repository. Trước production gate phải bổ sung quyết định/quy chế có
số hiệu, ngày hiệu lực và bản lưu kiểm toán được.
