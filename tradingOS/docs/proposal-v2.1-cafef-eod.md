# BỔ SUNG v2.1 — NGUỒN DỮ LIỆU MỞ & THIẾT KẾ CHO GIAO DỊCH EOD

**Tài liệu bổ sung cho Proposal v2.0 "VNQD Personal"**

| | |
|---|---|
| Ngày | 06/09/2026 |
| Thay thế | Mục 2 (Chiến lược dữ liệu) và một phần Mục 7 của v2.0 |
| Lý do | Phát hiện nguồn CafeF mạnh hơn dự kiến + phong cách giao dịch EOD-only |

---

## TÓM TẮT: HAI PHÁT HIỆN LÀM THAY ĐỔI THIẾT KẾ

**Phát hiện 1 — CafeF giải quyết gần trọn vẹn bài toán dữ liệu giá.**
CafeF phát hành công khai bộ dữ liệu EOD cho AmiBroker/MetaStock, **cả 3 sàn HOSE–HNX–UPCOM**, **có cả bản đã điều chỉnh và chưa điều chỉnh**, kèm file "Upto" chứa **toàn bộ lịch sử trong một lần tải**, và một file riêng chứa **số liệu cung cầu + giao dịch khối ngoại**. Đây là nguồn tốt hơn hẳn phương án tự scrape mà v2.0 đề xuất.

**Phát hiện 2 — Giao dịch EOD-only tạo ra một sai số backtest nghiêm trọng nếu không xử lý.**
Tín hiệu sinh lúc đóng cửa ngày T nhưng lệnh chỉ khớp được sáng ngày T+1. **Không được dùng giá đóng cửa ngày T làm giá vào lệnh.** Sai điều này sẽ khiến mọi chiến lược breakout trông tuyệt vời trên giấy và thua lỗ trên thực tế. Chi tiết ở Phần B.

---

# PHẦN A — NGUỒN DỮ LIỆU MỞ

## A.1. CafeF — nguồn chính ⭐⭐⭐

Trang phát hành: `https://cafef.vn/du-lieu/du-lieu-download.chn`

### Cấu trúc URL (đã xác minh ngày 06/09/2026)

```
https://cafef1.mediacdn.vn/data/ami_data/{YYYYMMDD}/CafeF.{LOẠI}.{DDMMYYYY}.zip
```

Ví dụ thực tế cho ngày 04/09/2026:

| Nhóm | Loại file | URL |
|---|---|---|
| **Giá — đã điều chỉnh** | EOD 1 ngày, 3 sàn | `…/20260904/CafeF.SolieuGD.04092026.zip` |
| | **Upto — toàn bộ lịch sử** ⭐ | `…/20260904/CafeF.SolieuGD.Upto04092026.zip` |
| **Giá — chưa điều chỉnh** | EOD 1 ngày | `…/20260904/CafeF.SolieuGD.Raw.04092026.zip` |
| | **Upto — toàn bộ lịch sử** ⭐ | `…/20260904/CafeF.SolieuGD.Raw.Upto04092026.zip` |
| **Chỉ số** | EOD / Upto | `…/CafeF.Index.04092026.zip` · `…/CafeF.Index.Upto04092026.zip` |
| | Raw Upto | `…/CafeF.Index.Raw.Upto04092026.zip` |
| **Cung cầu + khối ngoại** | EOD / Upto | `…/CafeF.CCNN.04092026.zip` · `…/CafeF.CCNN.Upto04092026.zip` |
| | Chỉ số | `…/CafeF.CCNN.Index.04092026.zip` · `…/CafeF.CCNN.Index.Upto04092026.zip` |

> **Lưu ý về định dạng ngày:** thư mục dùng `YYYYMMDD`, tên file dùng `DDMMYYYY`. Dễ nhầm — hãy viết hàm sinh URL và test kỹ.

### Vì sao đây là bước ngoặt cho dự án

| Vấn đề trong v2.0 | Cách CafeF giải quyết |
|---|---|
| "Phải tự viết toàn bộ tầng thu thập, chiếm ~40% effort MVP" | **1 request tải hết lịch sử.** Effort giảm xuống còn ~10% |
| "Điều chỉnh giá là bước bắt buộc, phải scrape VSDC" | **CafeF đã cung cấp sẵn bản điều chỉnh.** Vẫn nên đối chiếu, nhưng không còn là điểm chặn |
| "Thiếu dữ liệu vi cấu trúc, phải hoãn 8 quy tắc R3" | File CCNN có **khối lượng đặt mua/bán và số lệnh đặt mua/bán** → cứu được một phần đáng kể (xem A.3) |
| "Phải thu hẹp universe vì không lấy nổi dữ liệu" | Giá thì phủ **toàn bộ 3 sàn**. Chỉ còn BCTC cần thu hẹp |
| "Chỉ lấy được HOSE + HNX từ nguồn chính thức" | CafeF phủ **cả UPCOM** |

### Nội dung file (dự kiến — cần xác minh khi tải lần đầu)

Định dạng chuẩn AmiBroker text/CSV. Cấu trúc thường gặp của file `SolieuGD`:

```
<Ticker>,<DTYYYYMMDD>,<Open>,<High>,<Low>,<Close>,<Volume>
AAA,20260904,8.50,8.72,8.48,8.65,1234500
```

File `CCNN` (cung cầu + nước ngoài) có thêm các trường theo mô tả của CafeF Indicator Pack: **khối lượng đặt mua / đặt bán, số lệnh đặt mua / đặt bán, giao dịch nhà đầu tư nước ngoài, giá trị giao dịch**.

> ⚠️ **Việc đầu tiên phải làm:** tải 1 file, giải nén, `head -5`, và **viết ra giấy đúng thứ tự cột thực tế**. Toàn bộ pipeline phụ thuộc vào bước này. Đừng tin cấu trúc phỏng đoán ở trên.

### Ba cạm bẫy quan trọng

**Bẫy 1 — File EOD bị xoá sau vài ngày.** Quan sát trang tải: ngày 04/09 và 03/09 có đủ cả file EOD lẫn Upto, nhưng ngày 02/09 **chỉ còn file Upto**. Nghĩa là file EOD một ngày chỉ tồn tại khoảng 2–3 ngày.
→ Job hằng ngày phải chạy đáng tin cậy. Nếu nghỉ 1 tuần, bạn phải tải lại file Upto (lớn hơn nhưng luôn có).

**Bẫy 2 — Lịch sử giá điều chỉnh KHÔNG phải append-only.** ⭐ Đây là bẫy tinh vi nhất.
Mỗi lần một mã chia cổ tức bằng cổ phiếu, thưởng, hay phát hành thêm, **toàn bộ giá điều chỉnh trong quá khứ của mã đó bị viết lại**. Nếu bạn chỉ append file EOD mỗi ngày, sau 6 tháng chuỗi giá điều chỉnh của bạn sẽ sai lệch dần và âm thầm — không có thông báo lỗi nào.

Kiến trúc đúng:
```
RAW  (chưa điều chỉnh)  →  append-only, là nguồn sự thật bất biến
ADJ  (đã điều chỉnh)    →  dữ liệu dẫn xuất, LÀM MỚI TOÀN BỘ mỗi tháng
                            bằng cách tải lại file Raw.Upto + SolieuGD.Upto
```

**Bẫy 3 — Độ tin cậy nguồn.** Trên diễn đàn từng có thời điểm người dùng phản ánh dữ liệu EOD của CafeF ngưng cập nhật. Đây là dịch vụ miễn phí, không có SLA.
→ Bắt buộc có nguồn dự phòng (mục A.4) và cảnh báo Telegram khi job phát hiện số bản ghi bất thường.

### Mẹo hay: tự suy ra lịch sự kiện quyền từ chính hai file 🎁

Vì có **cả bản raw và bản adjusted**, bạn có thể tự tính hệ số điều chỉnh mà không cần scrape VSDC:

```
factor(t) = adj_close(t) / raw_close(t)

Khi factor thay đổi giữa hai phiên liên tiếp
  ⇒ đã có sự kiện quyền tại ngày đó
  ⇒ tỷ lệ điều chỉnh = factor(t) / factor(t-1)
```

Từ đây tự dựng được **bảng `corp_actions` hoàn chỉnh và miễn phí** cho toàn bộ lịch sử — điều mà v2.0 tưởng phải scrape VSDC mới có. VSDC vẫn hữu ích cho các sự kiện **sắp tới** (ngày GDKHQ tương lai), nhưng không còn là điểm chặn của MVP.

### Đạo đức sử dụng

CafeF công bố dữ liệu này **công khai, miễn phí, đúng cho mục đích phân tích kỹ thuật của nhà đầu tư** — sử dụng cá nhân hoàn toàn nằm trong ý định của nhà phát hành. CafeF ghi rõ dữ liệu có giá trị tham khảo và họ không chịu trách nhiệm về rủi ro phát sinh từ việc sử dụng.

```
✅ Tải 1 lần/ngày, đúng file mình cần
✅ Cache lại, không tải trùng
✅ Dùng cho phân tích cá nhân
❌ Không tải hàng loạt, không hammer CDN
❌ Không tái phân phối, không bán lại dữ liệu
❌ Không bóc dữ liệu ra làm sản phẩm thương mại
```

## A.2. Các trang dữ liệu miễn phí khác của CafeF (dạng HTML, parse được)

| Trang | Dữ liệu | URL |
|---|---|---|
| Dữ liệu lịch sử theo mã | OHLCV + KL khớp lệnh/thoả thuận theo từng mã | `cafef.vn/du-lieu/lich-su-giao-dich-{MÃ}-1.chn` |
| Giao dịch nước ngoài | Khối ngoại mua/bán theo sàn, theo ngày | `cafef.vn/du-lieu/tracuulichsu2/3/hose/today.chn` |
| Dữ liệu doanh nghiệp | BCTC, chỉ số cơ bản | `cafef.vn/du-lieu/du-lieu-doanh-nghiep.chn` |
| Công bố thông tin | CBTT, giao dịch nội bộ | `cafef.vn/du-lieu/cong-bo-thong-tin.chn` |
| Lãi suất – tỷ giá | Lãi suất ngân hàng, tỷ giá | `cafef.vn/du-lieu/lai-suat-ngan-hang.chn` |
| Hàng hoá | Giá hàng hoá | `cafef.vn/du-lieu/hang-hoa.chn` |
| Báo cáo phân tích | Tổng hợp báo cáo của các CTCK | `cafef.vn/du-lieu/phan-tich-bao-cao.chn` |

→ Dùng cho **BCTC và CBTT**, là hai loại dữ liệu file zip không có.

## A.3. Phần thưởng bất ngờ: file CCNN cứu một phần Module phát hiện bất thường

v2.0 kết luận rằng 8 quy tắc vi cấu trúc (nhóm R3) phải hoãn 6–12 tháng vì thiếu dữ liệu tick và sổ lệnh. File CCNN thay đổi điều đó một phần.

Với **khối lượng đặt mua/bán** và **số lệnh đặt mua/bán** ở mức ngày, tính được ngay:

| Đặc trưng mới | Công thức | Ý nghĩa phát hiện bất thường |
|---|---|---|
| **Mất cân bằng lệnh đặt** | `(KLđặtmua − KLđặtbán) / (KLđặtmua + KLđặtbán)` | Giá trị cực đoan duy trì nhiều phiên = áp lực một chiều bất thường |
| **Tỷ lệ đặt / khớp** | `KLđặtmua / KLkhớp` | Cao bất thường = nhiều lệnh treo không khớp. Proxy thô cho hành vi kiểu spoofing/layering |
| **Quy mô lệnh trung bình** | `KLđặtmua / sốlệnhđặtmua` | ⭐ Quy mô lệnh **lặp lại gần như y hệt** qua nhiều phiên là dấu hiệu giao dịch có phối hợp |
| **Số lệnh so với thanh khoản** | `sốlệnhđặt / KLkhớp` | Rất nhiều lệnh nhỏ trên nền thanh khoản thấp = dấu hiệu "vẽ" bảng giá |
| **Phân kỳ lệnh đặt vs giá** | Lệnh đặt mua tăng mạnh nhưng giá không tăng | Lực mua ảo, hoặc có bên bán lớn hấp thụ |

**Cập nhật số quy tắc khả thi:**

| | v2.0 | **v2.1** |
|---|:---:|:---:|
| Chạy được ngay từ MVP | 24/32 | **29/32** |
| Cần dữ liệu tick/sổ lệnh thật (hoãn) | 8 | **3** |

Ba quy tắc còn lại thực sự cần dữ liệu trong phiên: marking-the-close theo phiên ATC, độ dày lệnh treo biến mất trong phiên, và phân loại lệnh mua-bán chủ động theo tick rule. Vì bạn không giao dịch trong ngày, **ba quy tắc này có thể bỏ hẳn** mà không mất gì về mặt vận hành.

## A.4. Nguồn dự phòng và bổ sung (đều miễn phí)

| Nguồn | Cung cấp | Vai trò |
|---|---|---|
| **Fialda Fdata** | EOD toàn thị trường, miễn phí 100% cho dữ liệu cuối ngày (bản trả phí chỉ dành cho realtime trong phiên) | **Dự phòng chính** — phù hợp hoàn hảo với người không cần realtime |
| **FiinTA** (đăng nhập bằng tài khoản yome.vn) | EOD Việt Nam + **chỉ số thế giới và hàng hoá quốc tế**, tải và cài miễn phí | Dự phòng + dữ liệu toàn cầu |
| **BVSC** (Chứng khoán Bảo Việt) | File Excel dữ liệu chứng khoán, tải miễn phí, **cho chọn khoảng thời gian** — điểm CafeF không có | Đối chiếu, lấp khoảng trống |
| **Fireant Metakit** | Dữ liệu VN + EOD một số chỉ số quốc tế | Dự phòng |
| **HOSE / HNX** (hsx.vn, hnx.vn) | Báo cáo tổng hợp giao dịch, CBTT, danh sách cảnh báo/kiểm soát | **Nguồn gốc — trọng tài khi hai nguồn lệch nhau** |
| **VSDC** (vsd.vn) | Thông báo ngày GDKHQ **sắp tới** | Sự kiện quyền tương lai |
| **UBCKNN** (ssc.gov.vn) | Quyết định xử phạt | Nhãn kiểm định Module F |
| **VietstockFinance** | BCTC, doanh nghiệp A–Z, giao dịch nội bộ, cổ đông lớn, cổ tức, lịch sự kiện; có mục *Xuất dữ liệu* | **BCTC — nguồn chính** |
| **FRED** | Lợi suất TPCP Mỹ, DXY, giá dầu | API JSON miễn phí, rất ổn định |
| **yfinance** | S&P 500, VIX, Brent, vàng, tỷ giá | Vĩ mô toàn cầu |
| **GSO, NHNN** | CPI, GDP, PMI, tín dụng, lãi suất, tỷ giá | Vĩ mô Việt Nam |

### Nguyên tắc hai nguồn cho dữ liệu quan trọng

```
Giá EOD :  CafeF (chính)  +  Fialda Fdata (dự phòng)
           → so khớp 30 mã VN30 mỗi ngày, cảnh báo nếu lệch > 0,5%

Sự kiện quyền :  Tự suy từ adj/raw của CafeF  +  VSDC (sự kiện tương lai)

BCTC :  Vietstock (chính)  +  CafeF (đối chiếu)
        → lệch > 2% ở chỉ tiêu chính ⇒ đưa vào hàng đợi rà soát tay
```

## A.5. Đánh giá lại độ phủ dữ liệu

| Loại dữ liệu | v2.0 | **v2.1** | Nguồn |
|---|:---:|:---:|---|
| OHLCV ngày, 3 sàn, toàn bộ lịch sử | ✅ | ✅✅ **1 lần tải** | CafeF Upto |
| Giá đã điều chỉnh | ⚠️ tự tính | ✅✅ **có sẵn** | CafeF |
| Lịch sự kiện quyền lịch sử | ⚠️ scrape VSDC | ✅✅ **tự suy từ adj/raw** | CafeF |
| Giao dịch khối ngoại | ✅ | ✅ | CafeF CCNN |
| **KL & số lệnh đặt mua/bán** | ❌ | ✅ **mới có** | CafeF CCNN |
| Chỉ số (VNINDEX, HNX…) | ✅ | ✅ | CafeF Index |
| UPCOM | ⚠️ | ✅ | CafeF |
| BCTC | ⚠️ | ⚠️ **vẫn là điểm nghẽn** | Vietstock + tay |
| CBTT, giao dịch nội bộ | ✅ | ✅ | CafeF / HOSE / Vietstock |
| Free-float | ⚠️ ước lượng | ⚠️ ước lượng | Báo cáo quản trị |
| Tick, sổ lệnh trong phiên | ❌ | ❌ **không cần nữa** | — |
| Vĩ mô | ✅ | ✅ | GSO, NHNN, FRED |

**Kết luận:** điểm nghẽn duy nhất còn lại là **BCTC**. Mọi thứ khác đã được giải quyết bằng nguồn miễn phí.

## A.6. Hệ quả kiến trúc: bỏ được thêm nhiều thứ

| Thành phần trong v2.0 | Trạng thái v2.1 | Lý do |
|---|---|---|
| SSI FastConnect Data | ❌ **Không cần nữa** | Chỉ cần cho realtime/tick. CafeF đủ cho EOD, và không cần tài khoản SSI |
| WebSocket client | ❌ Bỏ | Không có realtime |
| `recorder.py` (ghi tick/quote) | ❌ Bỏ | Không giao dịch trong ngày |
| Job `record_intraday` | ❌ Bỏ | |
| Thư mục `data/ticks/` | ❌ Bỏ | Tiết kiệm 5–15 GB/năm |
| Collector VSDC | ⚠️ Hạ ưu tiên xuống P2 | Chỉ còn dùng cho sự kiện tương lai |
| Quản lý token, OTP, IP tĩnh | ❌ Bỏ hoàn toàn | CafeF không cần xác thực |
| Rate limiter phức tạp | ⚠️ Đơn giản hoá | Chỉ ~5 request/ngày |

**Số dòng code tầng thu thập giảm ước tính 70%.** Không cần tài khoản chứng khoán nào để chạy hệ thống — bạn có thể xây và kiểm chứng toàn bộ trước khi bỏ một đồng vào thị trường.

---

# PHẦN B — THIẾT KẾ CHO GIAO DỊCH EOD-ONLY

## B.1. Sai số backtest nghiêm trọng nhất — và cách sửa

### Vấn đề

```
❌ SAI  (nhưng là cách 90% người làm backtest ở Việt Nam đang làm)

    Đóng cửa ngày T:  phát hiện breakout, giá đóng cửa 31.500
    Backtest ghi   :  entry = 31.500
    → Lợi nhuận trông rất đẹp


✅ ĐÚNG  (khớp với thực tế của bạn)

    15:15 ngày T   :  hệ thống sinh tín hiệu
    Tối ngày T     :  bạn xem, quyết định
    09:00 ngày T+1 :  bạn đặt lệnh  ← ĐÂY MỚI LÀ ĐIỂM VÀO THẬT
    → entry = giá mở cửa T+1, hoặc giá khớp lệnh giới hạn trong phiên T+1
```

### Vì sao khoảng cách này lớn hơn bạn nghĩ

Đây không phải sai số nhỏ mang tính kỹ thuật. Nó **phá hoại có hệ thống và có chọn lọc** đúng những chiến lược trông hấp dẫn nhất:

| Loại setup | Cái gì xảy ra qua đêm | Tác động lên edge |
|---|---|---|
| **Breakout mạnh, KL bùng nổ** | Ai cũng nhìn thấy cùng lúc. Sáng hôm sau **gap tăng** | 🔴 **Tổn hại nặng.** Bạn mua ở giá đã cao hơn 2–5%, trong khi stop-loss vẫn ở chỗ cũ ⇒ R:R xấu đi rất nhiều |
| **Gap-and-go** | Bản chất là chiến lược trong phiên | 🔴 **Không dùng được.** Bỏ khỏi thư viện setup |
| **Trần cạn cung bán** | Sáng hôm sau thường tiếp tục trần, không có ai bán | 🔴 **Không mua được.** Backtest phải mô phỏng lệnh không khớp |
| **Pullback về MA20/MA50** | Đang mua vào lúc yếu. Gap qua đêm **có thể có lợi** cho bạn | 🟢 **Ít bị ảnh hưởng, đôi khi tốt hơn** |
| **Đảo chiều tại hỗ trợ** | Tương tự — mua khi thị trường bi quan | 🟢 **Phù hợp tốt** |
| **Trend-following chậm (MA50/MA200)** | Vào lệnh sớm/muộn 1 phiên gần như không quan trọng | 🟢 **Phù hợp rất tốt** |
| **Multi-factor trung–dài hạn** | Thời điểm vào không quan trọng | 🟢 **Phù hợp hoàn hảo** |

> ### Kết luận thiết kế quan trọng nhất của tài liệu này
>
> **Giao dịch EOD-only làm suy yếu nghiêm trọng các setup breakout, và gần như không ảnh hưởng tới các setup mua-khi-yếu và trend-following.**
>
> Thư viện setup của v2.0 xếp breakout lên đầu — điều đó **sai với phong cách của bạn**. Cần đảo lại thứ tự ưu tiên.

### Cách mô phỏng đúng trong backtest

```python
# Ba mô hình khớp lệnh, xếp từ lạc quan tới bảo thủ

# 1. ATO / mở cửa — đơn giản nhất, nhưng phải chịu toàn bộ gap
entry = open[T+1]

# 2. Lệnh giới hạn (LO) — thực tế nhất với cách bạn giao dịch
#    Đặt LO ở mức giá xác định; chỉ khớp nếu giá thực chạm tới
limit = close[T] * 1.005          # chấp nhận trả cao hơn 0,5%
if low[T+1] <= limit:
    entry = min(limit, open[T+1])  # nếu gap xuống thì được giá tốt hơn
else:
    entry = None                   # KHÔNG KHỚP — bỏ lệnh, ghi nhận miss

# 3. Bảo thủ nhất — dùng để kiểm tra biên an toàn của chiến lược
entry = max(open[T+1], close[T])   # giả định luôn bị giá xấu
```

**Bắt buộc theo dõi thêm hai chỉ số mà backtest thông thường không có:**
- **Fill rate** — bao nhiêu % tín hiệu thực sự khớp được lệnh
- **Slippage qua đêm** — trung bình `open[T+1] / close[T] − 1` cho các tín hiệu

Nếu fill rate dưới 70% hoặc slippage qua đêm trung bình vượt 1,5%, chiến lược đó **không phù hợp với phong cách EOD** — dù đường equity trông đẹp thế nào.

## B.2. Vòng đời một lệnh: EOD + T+2

Đây là phần bạn cần nắm chắc, vì nó quyết định độ rộng stop-loss và kích thước vị thế.

```
 Ngày   Thời điểm   Sự việc                              Có thể bán?
──────────────────────────────────────────────────────────────────────
  T     15:15       Hệ thống sinh tín hiệu MUA                 —
  T     tối         Bạn xem, duyệt phiếu lệnh                  —
──────────────────────────────────────────────────────────────────────
 T+1    09:00       ĐẶT LỆNH → khớp. Đây là ngày mua           ❌
 T+2    cả ngày     Nắm giữ, không làm gì được                 ❌
 T+3    13:00       Cổ phiếu về tài khoản (chậm nhất 13h)      ⚠️ chiều
 T+3    15:15       Hệ thống sinh tín hiệu BÁN (nếu có)        —
 T+4    09:00       Đặt lệnh bán → khớp                        ✅
──────────────────────────────────────────────────────────────────────
```

### Ba con số bạn phải chấp nhận

**1. Vòng quay tối thiểu: 4 phiên.** Không có cách nào ngắn hơn. Nghĩa là hệ thống nên nhắm setup nắm giữ **8–25 phiên**, không phải 3–15 như v2.0 đề xuất. Nắm 5 phiên thì chi phí và slippage ăn hết biên lợi nhuận.

**2. Ba phiên hoàn toàn không có khả năng thoát.** Từ khi khớp mua (T+1) đến khi bán được (T+4 sáng), bạn có **3 phiên bị khoá**. Với biên độ HOSE ±7%:

```
Rủi ro tối đa theo lý thuyết = 1 − (1 − 0,07)³ = −19,5%
```

Ba phiên sàn liên tiếp là chuyện thực tế đã xảy ra nhiều lần trên TTCK Việt Nam, đặc biệt ở các mã bị phát hiện có vấn đề. **Đây chính là lý do Module phát hiện bất thường không phải tính năng phụ, mà là lớp bảo vệ thiết yếu** — nó chặn đúng loại mã có thể gây ra thảm hoạ này.

**3. Stop-loss là cảnh báo, không phải lệnh.** Bạn không thể đặt stop-loss tự động (không auto-trading, và stop-loss của CTCK cũng không giúp gì trong 3 phiên bị khoá). Stop-loss trong hệ thống là **mức giá để hệ thống nhắc bạn bán vào sáng hôm sau**.

### Điều chỉnh tham số rủi ro

| Tham số | v2.0 | **v2.1 (EOD + T+2)** | Lý do |
|---|:---:|:---:|---|
| Stop-loss mặc định | 7% | **9–10%** | Cần rộng hơn để không bị quét bởi nhiễu 3 phiên |
| Hệ số ATR cho stop | 2,0–3,0 | **3,0–4,0** | Cùng lý do |
| Rủi ro / lệnh | 0,5–1,0% NAV | **0,4–0,7% NAV** | Bù cho rủi ro đuôi 3 phiên bị khoá |
| Thời gian nắm giữ mục tiêu | 3–15 phiên | **8–25 phiên** | Vòng quay tối thiểu là 4 phiên |
| R:R tối thiểu | 1,5 | **2,0** | Stop rộng hơn ⇒ target phải xa hơn |
| Số vị thế mở đồng thời | 8–15 | **6–10** | Ít mã hơn, theo dõi kỹ hơn |
| Tỷ trọng tối đa 1 mã | 15% | **10–12%** | Giảm rủi ro tập trung khi bị khoá |

## B.3. Thư viện setup — xếp lại theo độ phù hợp EOD

| Xếp hạng | Setup | Phù hợp EOD | Ghi chú |
|:---:|---|:---:|---|
| 🥇 **1** | `PB_MA20` — Pullback về MA20 trong xu hướng tăng | ⭐⭐⭐⭐⭐ | Mua khi yếu ⇒ gap qua đêm thường có lợi. **Nên là setup xương sống** |
| 🥈 **2** | `PB_MA50` — Pullback sâu hơn về MA50 | ⭐⭐⭐⭐⭐ | Dùng khi thị trường rung lắc |
| 🥉 **3** | `REV_SUP` — Đảo chiều tại hỗ trợ (Fibo, đáy cũ, RSI phân kỳ dương) | ⭐⭐⭐⭐ | Phù hợp tốt |
| 4 | `RS_LEADER` — Mã dẫn dắt, RS > 85, ngành ở góc Leading trên RRG | ⭐⭐⭐⭐ | Vào lệnh không cần chính xác từng phiên |
| 5 | `TREND_MA` — Trend-following MA50/MA200 (setup mới, nên thêm) | ⭐⭐⭐⭐⭐ | Gần như miễn nhiễm với slippage qua đêm |
| 6 | `VCP` — Thu hẹp biến động rồi bùng nổ | ⭐⭐⭐ | Chấp nhận được nếu vào bằng LO có giới hạn giá |
| 7 | `CUP_HANDLE` — Cốc tay cầm | ⭐⭐⭐ | Tương tự |
| 8 | `BO_BASE` — Breakout nền giá | ⭐⭐ | ⚠️ **Hạ từ vị trí số 1 xuống.** Chỉ dùng khi gap mở cửa < 1,5%, nếu không thì bỏ lệnh |
| ❌ | `GAP_GO` — Gap and Go | ❌ | **Bỏ khỏi thư viện.** Bản chất là chiến lược trong phiên |

### Quy tắc bổ sung riêng cho EOD: kiểm tra gap trước khi đặt lệnh

```
Sáng T+1, trước khi đặt lệnh, hệ thống tự kiểm tra:

  gap = (giá tham chiếu hoặc giá mở cửa) / close[T] − 1

  gap ≤ +1,0%   →  ĐẶT LỆNH theo phiếu, giữ nguyên stop và target
  gap 1,0–2,5%  →  ĐẶT LỆNH nhưng giảm khối lượng 30%, hoặc dùng LO
                   ở giá close[T] × 1,01 và chấp nhận có thể không khớp
  gap > +2,5%   →  ❌ BỎ LỆNH. R:R đã bị phá vỡ
  gap < −2,0%   →  ⚠️ RÀ SOÁT LẠI. Có tin xấu qua đêm? Kiểm tra CBTT
```

Đây là **quy tắc giá trị cao nhất mà một hệ thống EOD có thể có**, và không nền tảng nào ở Việt Nam đang cung cấp.

## B.4. Nhịp làm việc hằng ngày

Vì bạn giao dịch EOD, hệ thống nên chạy 2 lần/ngày thay vì streaming liên tục:

```
╔══════════════════════════════════════════════════════════════════╗
║  16:00 — PHIÊN TỐI  (job chính)                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  1. Tải file CafeF EOD (giá + CCNN + index)                       ║
║  2. Kiểm tra chất lượng, đối chiếu Fialda cho 30 mã VN30          ║
║  3. Cập nhật DuckDB, tính lại feature                             ║
║  4. Xác định trạng thái thị trường (regime)                       ║
║  5. Quét bất thường → cập nhật risk score                         ║
║  6. Sinh tín hiệu, lọc bỏ mã có risk score ≥ 55                   ║
║  7. Tính position sizing theo NAV hiện tại                        ║
║  8. → Telegram: phiếu lệnh + danh mục cần xử lý                   ║
║                                                                   ║
║  Bạn: xem trên điện thoại, duyệt / bỏ từng lệnh (5–10 phút)       ║
╚══════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════╗
║  08:45 — PHIÊN SÁNG  (job kiểm tra)                              ║
╠══════════════════════════════════════════════════════════════════╣
║  1. Kiểm tra CBTT qua đêm của các mã trong phiếu lệnh             ║
║  2. Kiểm tra tin tức bất thường                                   ║
║  3. → Telegram: "3 lệnh sẵn sàng. VIC có CBTT mới — xem lại"      ║
║                                                                   ║
║  Bạn: 09:00–09:15 đặt lệnh trên app CTCK (2–3 phút)              ║
║  Áp dụng quy tắc kiểm tra gap ở mục B.3                          ║
╚══════════════════════════════════════════════════════════════════╝

  ⚠️ Lưu ý: 09:00–09:15 là phiên ATO của HOSE. Từ khi hệ thống KRX
     vận hành (5/5/2025), lệnh ATO/ATC không còn được ưu tiên khớp
     trước lệnh LO như trước. Nên ưu tiên dùng LO thay vì ATO.

╔══════════════════════════════════════════════════════════════════╗
║  Thứ Bảy 09:00 — PHIÊN TUẦN                                      ║
╠══════════════════════════════════════════════════════════════════╣
║  • Làm mới TOÀN BỘ lịch sử giá điều chỉnh (chống Bẫy 2)           ║
║  • Cập nhật BCTC nếu vào mùa công bố                              ║
║  • Báo cáo tuần: RRG ngành, độ rộng, dòng tiền khối ngoại         ║
║  • Backtest lại các chiến lược đang dùng với dữ liệu mới          ║
╚══════════════════════════════════════════════════════════════════╝
```

**Tổng thời gian bạn bỏ ra: khoảng 10–15 phút/ngày.** Đó chính là điều một hệ thống EOD tốt nên đạt được.

## B.5. Phiếu lệnh cập nhật cho EOD

```
═══════════════════════════════════════════════════════════
  PHIẾU LỆNH · sinh 04/09 15:47 · ĐẶT SÁNG 07/09
═══════════════════════════════════════════════════════════
  Mã            : VNM
  Setup         : PB_MA20   ·  Score 79/100
  Đóng cửa 04/09: 61.200
  ───────────────────────────────────────────────────────
  ĐẶT LỆNH      : LO  MUA  61.500  ×  1.600 cp
                  (giới hạn +0,5% so với đóng cửa)
  Giá trị       : 98.400.000 đ   ·   9,8% NAV
  ───────────────────────────────────────────────────────
  Cảnh báo bán  : 55.700  (−9,4%)
  Chốt lời 1    : 68.900  (bán 1/2)
  Chốt lời 2    : 74.200
  R:R           : 2,1 / 3,4
  Rủi ro        : 9.280.000 đ  ·  0,62% NAV
  ───────────────────────────────────────────────────────
  ⏱  Mua 07/09  →  bán được sớm nhất sáng 10/09
  ⚠  3 phiên KHÔNG THỂ THOÁT. Tối đa lý thuyết −19,5%
  🟢 Cờ rủi ro bất thường: 12/100
  📊 Fill rate lịch sử của setup này: 84%
      Slippage qua đêm trung bình: +0,4%
      Hit rate ngoài mẫu: 56%  ·  Kỳ vọng +0,41R
  ───────────────────────────────────────────────────────
  KIỂM TRA GAP SÁNG 07/09 TRƯỚC KHI ĐẶT:
     gap ≤ +1,0%    → đặt bình thường
     +1,0 → +2,5%   → giảm 30% khối lượng
     gap > +2,5%    → BỎ LỆNH
═══════════════════════════════════════════════════════════
  [ Đã đặt ]   [ Không khớp ]   [ Bỏ qua ]   [ Sửa KL ]
```

Nút *Không khớp* rất quan trọng: nó cho phép hệ thống học được fill rate thực tế của từng setup, thay vì giả định lý thuyết.

---

# PHẦN C — MÃ NGUỒN MẪU

## C.1. Bộ tải và phân tích dữ liệu CafeF

```python
# vnqd/collect/cafef.py
"""Tải và phân tích bộ dữ liệu EOD miễn phí của CafeF.

Trang phát hành: https://cafef.vn/du-lieu/du-lieu-download.chn

Mẫu URL:
    https://cafef1.mediacdn.vn/data/ami_data/{YYYYMMDD}/CafeF.{LOAI}.{DDMMYYYY}.zip

⚠️ QUAN TRỌNG: thư mục dùng YYYYMMDD nhưng tên file dùng DDMMYYYY.
⚠️ Trước khi tin vào COLUMN_MAP dưới đây, hãy tải 1 file, giải nén và
   kiểm tra thứ tự cột thực tế. Toàn bộ pipeline phụ thuộc vào việc này.
"""
from __future__ import annotations

import io
import logging
import zipfile
from datetime import date
from enum import StrEnum
from pathlib import Path

import polars as pl

from vnqd.collect.http import PoliteClient

logger = logging.getLogger(__name__)

CDN_BASE = "https://cafef1.mediacdn.vn/data/ami_data"
RAW_DIR = Path("data/raw/cafef")


class Dataset(StrEnum):
    """Các bộ dữ liệu CafeF phát hành."""
    PRICE_ADJ = "SolieuGD"            # giá đã điều chỉnh
    PRICE_RAW = "SolieuGD.Raw"        # giá chưa điều chỉnh
    INDEX_ADJ = "Index"               # chỉ số
    INDEX_RAW = "Index.Raw"
    FLOW_ADJ = "CCNN"                 # cung cầu + khối ngoại
    FLOW_INDEX = "CCNN.Index"


def build_url(ds: Dataset, day: date, *, full_history: bool = False) -> str:
    """Sinh URL tải.

    full_history=True  → file 'Upto', chứa TOÀN BỘ lịch sử tới ngày đó
    full_history=False → file EOD, chỉ 1 phiên (bị xoá sau ~2-3 ngày)
    """
    folder = day.strftime("%Y%m%d")
    stamp = day.strftime("%d%m%Y")
    prefix = "Upto" if full_history else ""
    return f"{CDN_BASE}/{folder}/CafeF.{ds.value}.{prefix}{stamp}.zip"


# Thứ tự cột DỰ KIẾN cho file giá (chuẩn AmiBroker) — PHẢI XÁC MINH
PRICE_COLUMNS = ["ticker", "date_raw", "open", "high", "low", "close", "volume"]


class CafeFCollector:
    def __init__(self, client: PoliteClient) -> None:
        self._client = client

    async def download(
        self, ds: Dataset, day: date, *, full_history: bool = False
    ) -> bytes:
        url = build_url(ds, day, full_history=full_history)
        logger.info("Đang tải %s", url)
        # cache 30 ngày: file Upto không đổi nội dung sau khi phát hành
        return await self._client.get(url, use_cache=True)

    @staticmethod
    def parse_price_zip(blob: bytes) -> pl.DataFrame:
        """Giải nén và gộp tất cả file text bên trong thành 1 DataFrame."""
        frames: list[pl.DataFrame] = []

        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            for name in zf.namelist():
                if not name.lower().endswith((".txt", ".csv")):
                    continue
                with zf.open(name) as fh:
                    content = fh.read()
                try:
                    df = pl.read_csv(
                        io.BytesIO(content),
                        has_header=True,
                        infer_schema_length=0,   # đọc tất cả dạng chuỗi trước
                        truncate_ragged_lines=True,
                    )
                except Exception as exc:
                    logger.warning("Bỏ qua %s: %s", name, exc)
                    continue

                if df.height:
                    df.columns = PRICE_COLUMNS[: df.width]
                    frames.append(df)

        if not frames:
            raise ValueError("Không tìm thấy dữ liệu hợp lệ trong file zip")

        return (
            pl.concat(frames, how="vertical_relaxed")
            .with_columns(
                pl.col("ticker").str.strip_chars().str.to_uppercase(),
                pl.col("date_raw").cast(pl.Utf8).str.to_date("%Y%m%d").alias("date"),
                *[pl.col(c).cast(pl.Float64, strict=False)
                  for c in ("open", "high", "low", "close")],
                pl.col("volume").cast(pl.Int64, strict=False),
            )
            .drop("date_raw")
            .rename({"ticker": "symbol"})
            .filter(
                pl.col("close").is_not_null()
                & (pl.col("close") > 0)
                & (pl.col("high") >= pl.col("low"))
            )
            .unique(subset=["symbol", "date"], keep="last")
            .sort(["symbol", "date"])
        )

    async def bootstrap(self, day: date) -> dict[str, pl.DataFrame]:
        """Nạp toàn bộ lịch sử — chạy MỘT LẦN khi khởi tạo hệ thống.

        Chỉ 3 request là có đầy đủ dữ liệu nhiều năm cho cả 3 sàn.
        """
        out: dict[str, pl.DataFrame] = {}

        for key, ds in (
            ("price_adj", Dataset.PRICE_ADJ),
            ("price_raw", Dataset.PRICE_RAW),
            ("index_adj", Dataset.INDEX_ADJ),
        ):
            blob = await self.download(ds, day, full_history=True)
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            (RAW_DIR / f"{key}_upto_{day:%Y%m%d}.zip").write_bytes(blob)
            out[key] = self.parse_price_zip(blob)
            logger.info("%-10s → %7d dòng, %5d mã",
                        key, out[key].height, out[key]["symbol"].n_unique())

        return out
```

## C.2. Tự suy ra lịch sự kiện quyền từ cặp adjusted / raw 🎁

```python
# vnqd/transform/derive_actions.py
"""Suy ra lịch sự kiện quyền bằng cách so sánh chuỗi giá điều chỉnh và chưa điều chỉnh.

Thay thế hoàn toàn việc scrape VSDC cho dữ liệu LỊCH SỬ.
(VSDC vẫn cần cho các sự kiện quyền SẮP TỚI.)

Nguyên lý:
    factor(t) = adj_close(t) / raw_close(t)
    factor không đổi giữa hai sự kiện quyền.
    Khi factor nhảy ⇒ có sự kiện quyền tại ngày đó.
    Tỷ lệ điều chỉnh = factor(t) / factor(t-1)
"""
from __future__ import annotations

import polars as pl

# Ngưỡng lọc nhiễu làm tròn giá. Bước giá HOSE là 10/50/100 đồng
# nên tỷ số có thể lệch nhẹ mà không phải sự kiện quyền thật.
JUMP_THRESHOLD = 0.005      # 0,5%


def derive_corporate_actions(
    adj: pl.DataFrame, raw: pl.DataFrame
) -> pl.DataFrame:
    """Trả về [symbol, ex_date, adj_ratio, implied_type].

    adj_ratio < 1  ⇒ giá quá khứ bị nhân xuống ⇒ có sự kiện quyền
                     (chia cổ tức, thưởng, hoặc phát hành thêm)
    """
    merged = (
        adj.select("symbol", "date", pl.col("close").alias("adj_close"))
        .join(
            raw.select("symbol", "date", pl.col("close").alias("raw_close")),
            on=["symbol", "date"],
            how="inner",
        )
        .filter(pl.col("raw_close") > 0)
        .with_columns(
            (pl.col("adj_close") / pl.col("raw_close")).alias("factor")
        )
        .sort(["symbol", "date"])
    )

    events = (
        merged.with_columns(
            pl.col("factor").shift(1).over("symbol").alias("prev_factor")
        )
        .drop_nulls("prev_factor")
        .with_columns(
            (pl.col("factor") / pl.col("prev_factor")).alias("adj_ratio")
        )
        .filter((pl.col("adj_ratio") - 1.0).abs() > JUMP_THRESHOLD)
        .select(
            "symbol",
            pl.col("date").alias("ex_date"),
            pl.col("adj_ratio").round(6),
            pl.col("raw_close").alias("raw_close_on_ex"),
        )
    )

    # Phân loại thô dựa trên độ lớn tỷ lệ điều chỉnh
    return events.with_columns(
        pl.when(pl.col("adj_ratio") > 0.97)
        .then(pl.lit("cash_dividend"))          # điều chỉnh nhỏ → cổ tức tiền
        .when(pl.col("adj_ratio") > 0.75)
        .then(pl.lit("stock_or_rights"))        # điều chỉnh trung bình
        .otherwise(pl.lit("major_issuance"))    # điều chỉnh lớn
        .alias("implied_type")
    ).sort(["symbol", "ex_date"])


def sanity_check(events: pl.DataFrame) -> None:
    """In ra vài kiểm tra để bạn tự đối chiếu với thực tế.

    Hãy mở 2-3 mã đã biết chắc lịch sử chia cổ tức và so bằng mắt.
    Đây là bước KHÔNG ĐƯỢC BỎ QUA.
    """
    print(f"Tổng số sự kiện suy ra: {events.height}")
    print(f"Số mã có sự kiện      : {events['symbol'].n_unique()}")
    print("\nPhân bố theo loại:")
    print(events.group_by("implied_type").len().sort("len", descending=True))
    print("\n20 sự kiện điều chỉnh mạnh nhất (kiểm tra thủ công):")
    print(events.sort("adj_ratio").head(20))
```

## C.3. Đặc trưng cung cầu từ file CCNN

```python
# vnqd/features/order_flow.py
"""Đặc trưng suy ra từ số liệu cung cầu của CafeF (file CCNN).

Đây là phần bù cho việc không có dữ liệu sổ lệnh trong phiên.
Các trường gốc: khối lượng đặt mua/bán, số lệnh đặt mua/bán,
giao dịch nhà đầu tư nước ngoài, giá trị giao dịch.

⚠️ Tên cột thực tế cần xác minh khi tải file lần đầu.
"""
from __future__ import annotations

import polars as pl


def compute_order_flow_features(flow: pl.DataFrame) -> pl.DataFrame:
    """flow cần có: symbol, date, bid_volume, ask_volume,
    bid_orders, ask_orders, matched_volume, foreign_buy, foreign_sell
    """
    eps = 1.0

    return flow.sort(["symbol", "date"]).with_columns(
        # 1. Mất cân bằng lệnh đặt: [-1, 1]
        ((pl.col("bid_volume") - pl.col("ask_volume"))
         / (pl.col("bid_volume") + pl.col("ask_volume") + eps)
         ).alias("order_imbalance"),

        # 2. Tỷ lệ đặt/khớp — proxy thô cho hành vi kiểu spoofing
        ((pl.col("bid_volume") + pl.col("ask_volume"))
         / (pl.col("matched_volume") + eps)
         ).alias("order_to_trade"),

        # 3. Quy mô lệnh trung bình
        (pl.col("bid_volume") / (pl.col("bid_orders") + eps)
         ).alias("avg_bid_size"),
        (pl.col("ask_volume") / (pl.col("ask_orders") + eps)
         ).alias("avg_ask_size"),

        # 4. Khối ngoại ròng
        (pl.col("foreign_buy") - pl.col("foreign_sell")
         ).alias("foreign_net"),
    ).with_columns(
        # 5. ⭐ Độ ổn định quy mô lệnh — tín hiệu giao dịch có phối hợp.
        #    Quy mô lệnh lặp lại gần y hệt nhiều phiên là BẤT THƯỜNG.
        #    Hệ số biến thiên thấp = đáng ngờ.
        (pl.col("avg_bid_size").rolling_std(20).over("symbol")
         / (pl.col("avg_bid_size").rolling_mean(20).over("symbol") + eps)
         ).alias("bid_size_cv"),

        # 6. Khối ngoại ròng lũy kế
        pl.col("foreign_net").rolling_sum(5).over("symbol").alias("fnet_5d"),
        pl.col("foreign_net").rolling_sum(20).over("symbol").alias("fnet_20d"),

        # 7. Mất cân bằng lệnh đặt duy trì một chiều
        pl.col("order_imbalance").rolling_mean(10).over("symbol")
          .alias("imbalance_10d"),
    )


# --- Quy tắc phát hiện bất thường mới, dùng được nhờ file CCNN ---

def rule_r3a_repeated_order_size(feats: pl.DataFrame) -> bool:
    """R3a — Quy mô lệnh đặt lặp lại bất thường trong 20 phiên.

    Hệ số biến thiên < 0,08 nghĩa là quy mô lệnh gần như y hệt
    mỗi phiên — điều rất khó xảy ra với dòng lệnh tự nhiên từ
    nhiều nhà đầu tư độc lập.
    """
    cv = feats["bid_size_cv"][-1]
    return cv is not None and cv < 0.08


def rule_r3b_extreme_order_to_trade(feats: pl.DataFrame) -> bool:
    """R3b — Tỷ lệ đặt/khớp cực cao duy trì nhiều phiên.

    Rất nhiều lệnh treo nhưng ít khớp: hoặc thanh khoản quá kém,
    hoặc có hành vi đặt lệnh không nhằm mục đích khớp.
    """
    recent = feats["order_to_trade"].tail(10)
    return (recent > 8.0).sum() >= 6


def rule_r3c_one_sided_imbalance(feats: pl.DataFrame) -> bool:
    """R3c — Mất cân bằng lệnh đặt một chiều cực đoan kéo dài."""
    val = feats["imbalance_10d"][-1]
    return val is not None and abs(val) > 0.65
```

## C.4. Backtest có nhận thức về EOD — phần quan trọng nhất

```python
# vnqd/backtest/eod_execution.py
"""Mô phỏng khớp lệnh cho phong cách giao dịch EOD.

QUY TẮC BẤT DI BẤT DỊCH:
    Tín hiệu sinh lúc đóng cửa ngày T  →  khớp lệnh trong ngày T+1
    KHÔNG BAO GIỜ dùng close[T] làm giá vào lệnh.

Vi phạm quy tắc này là nguồn gốc số 1 của backtest ảo trên TTCK Việt Nam.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np
import polars as pl


class FillMode(StrEnum):
    MARKET_OPEN = "market_open"      # khớp tại giá mở cửa T+1
    LIMIT = "limit"                  # LO ở mức giá xác định, có thể không khớp
    PESSIMISTIC = "pessimistic"      # luôn giả định giá xấu — kiểm tra biên an toàn


@dataclass(frozen=True, slots=True)
class FillResult:
    filled: bool
    price: float | None
    overnight_gap: float
    reason: str


def simulate_entry(
    signal_close: float,
    next_open: float,
    next_high: float,
    next_low: float,
    *,
    mode: FillMode = FillMode.LIMIT,
    limit_premium: float = 0.005,      # chấp nhận trả cao hơn 0,5%
    max_gap: float = 0.025,            # gap > 2,5% thì bỏ lệnh
    price_band: float = 0.07,
) -> FillResult:
    """Mô phỏng việc bạn đặt lệnh sáng T+1 dựa trên tín hiệu tối T."""
    gap = next_open / signal_close - 1.0

    # Quy tắc 1: gap quá lớn ⇒ R:R đã bị phá vỡ ⇒ bỏ lệnh
    if gap > max_gap:
        return FillResult(False, None, gap,
                          f"gap +{gap:.2%} vượt ngưỡng {max_gap:.1%}")

    # Quy tắc 2: mã mở cửa ở trần thường không có ai bán
    ceiling = signal_close * (1 + price_band)
    if next_low >= ceiling * 0.995:
        return FillResult(False, None, gap,
                          "mở cửa và giữ ở giá trần — cạn cung bán")

    if mode is FillMode.MARKET_OPEN:
        return FillResult(True, next_open, gap, "khớp tại giá mở cửa")

    if mode is FillMode.PESSIMISTIC:
        return FillResult(True, max(next_open, signal_close), gap,
                          "giả định bảo thủ")

    # FillMode.LIMIT — thực tế nhất
    limit = signal_close * (1 + limit_premium)
    if next_low <= limit:
        # nếu mở cửa thấp hơn giá LO thì được giá tốt hơn
        return FillResult(True, min(limit, next_open), gap, "LO khớp")

    return FillResult(False, None, gap,
                      f"LO {limit:,.0f} không khớp, đáy phiên {next_low:,.0f}")


def earliest_exit_index(entry_idx: int) -> int:
    """Chỉ số phiên sớm nhất có thể BÁN, tính từ phiên khớp mua.

    Mua khớp ngày T+1 (entry_idx)
      → cổ phiếu về chậm nhất 13h ngày T+3  = entry_idx + 2
      → tín hiệu bán sinh lúc đóng cửa T+3  = entry_idx + 2
      → đặt lệnh bán sáng T+4               = entry_idx + 3
    """
    return entry_idx + 3


@dataclass(slots=True)
class ExecutionStats:
    """Hai chỉ số mà backtest thông thường KHÔNG có — nhưng bắt buộc với EOD."""
    total_signals: int = 0
    filled: int = 0
    rejected_gap: int = 0
    rejected_ceiling: int = 0
    rejected_limit: int = 0
    gaps: list[float] = None

    def __post_init__(self) -> None:
        if self.gaps is None:
            self.gaps = []

    @property
    def fill_rate(self) -> float:
        return self.filled / self.total_signals if self.total_signals else 0.0

    @property
    def mean_overnight_gap(self) -> float:
        return float(np.mean(self.gaps)) if self.gaps else 0.0

    def verdict(self) -> str:
        """Đánh giá xem chiến lược có phù hợp với phong cách EOD hay không."""
        if self.fill_rate < 0.70:
            return (f"❌ KHÔNG PHÙ HỢP EOD — fill rate chỉ {self.fill_rate:.0%}. "
                    "Quá nhiều tín hiệu không đặt được lệnh.")
        if self.mean_overnight_gap > 0.015:
            return (f"❌ KHÔNG PHÙ HỢP EOD — gap qua đêm trung bình "
                    f"+{self.mean_overnight_gap:.2%}. Edge bị ăn mất qua đêm.")
        if self.mean_overnight_gap > 0.008:
            return (f"⚠️ CẨN TRỌNG — gap qua đêm +{self.mean_overnight_gap:.2%}. "
                    "Cân nhắc dùng LO chặt hơn.")
        return (f"✅ PHÙ HỢP EOD — fill rate {self.fill_rate:.0%}, "
                f"gap qua đêm +{self.mean_overnight_gap:.2%}.")


def report_execution(stats: ExecutionStats) -> str:
    return f"""
╔════════════════════════════════════════════════════╗
║  CHẤT LƯỢNG KHỚP LỆNH — PHONG CÁCH EOD             ║
╠════════════════════════════════════════════════════╣
║  Tổng tín hiệu             : {stats.total_signals:>6}              ║
║  Khớp được                 : {stats.filled:>6}  ({stats.fill_rate:>5.1%})   ║
║  Bỏ vì gap quá lớn         : {stats.rejected_gap:>6}              ║
║  Bỏ vì trần cạn cung bán   : {stats.rejected_ceiling:>6}              ║
║  Bỏ vì LO không khớp       : {stats.rejected_limit:>6}              ║
║  Gap qua đêm trung bình    : {stats.mean_overnight_gap:>+6.2%}              ║
╠════════════════════════════════════════════════════╣
║  {stats.verdict()[:48]:<48}║
╚════════════════════════════════════════════════════╝
""".strip()
```

---

# PHẦN D — LỘ TRÌNH CẬP NHẬT

Nhờ CafeF và việc bỏ realtime, lộ trình ngắn lại đáng kể.

| Tuần | Nội dung | So với v2.0 |
|:---:|---|---|
| **1** | Tải CafeF Upto (3 file), **xác minh thứ tự cột thực tế**, parse, nạp vào DuckDB | v2.0 mất 3 tuần cho việc này |
| **2** | Suy ra lịch sự kiện quyền từ adj/raw, đối chiếu thủ công 5 mã đã biết; parse file CCNN; kiểm tra chất lượng | Bỏ hẳn được collector VSDC |
| **3** | 40 chỉ báo kỹ thuật + đặc trưng cung cầu; job EOD 16:00 tự động; Telegram | |
| **4** | Streamlit: Tổng quan thị trường · Bộ lọc · Chi tiết mã | ✅ **MVP** |
| **5–6** | **Engine backtest EOD-aware TRƯỚC** — mô phỏng khớp T+1, fill rate, gap qua đêm, chi phí, T+2 | ⭐ Đẩy lên sớm hơn v2.0 (tuần 7–9) |
| **7–8** | Module bất thường: 29 quy tắc + IsolationForest + evidence panel; kiểm định ngược trên PPT/CRC/AGG/PDR | |
| **9–12** | Thư viện setup theo thứ tự ưu tiên EOD (pullback trước, breakout sau); triple-barrier; meta-model; phiếu lệnh + quy tắc kiểm tra gap | |
| **13–16** | Scraper BCTC Vietstock + hàng đợi rà soát tay; multi-factor scoring; CANSLIM | |
| **17–19** | Định giá: DCF, RIM, bội số, Monte Carlo, Reverse DCF cho ~30 mã cốt lõi | |
| **20–21** | Sizing điều chỉnh cho T+2, nhật ký, báo cáo tuần, làm mới lịch sử điều chỉnh hằng tháng | ✅ **v1.0** |

**MVP: 4 tuần. Hoàn chỉnh: ~5 tháng** (v2.0 là 6 tháng).

**Chi phí: 0 đồng. Không cần tài khoản chứng khoán nào để xây và kiểm chứng hệ thống.**

---

# PHẦN E — CHECKLIST 7 NGÀY, BẢN CẬP NHẬT

```
□ Ngày 1  Mở https://cafef.vn/du-lieu/du-lieu-download.chn
          Tải THỦ CÔNG 3 file của phiên gần nhất:
            • CafeF.SolieuGD.Upto{DDMMYYYY}.zip      (giá điều chỉnh)
            • CafeF.SolieuGD.Raw.Upto{DDMMYYYY}.zip  (giá thô)
            • CafeF.CCNN.Upto{DDMMYYYY}.zip          (cung cầu + ngoại)
          Giải nén, mở bằng editor, GHI RA GIẤY đúng thứ tự cột
          ⭐ Đây là việc quan trọng nhất của cả tuần

□ Ngày 2  Repo mới, `uv init`, cài stack
          Viết parser cho file giá, test trên file đã tải tay
          Đếm: bao nhiêu mã? bao nhiêu năm lịch sử? có UPCOM không?

□ Ngày 3  DuckDB schema + nạp toàn bộ lịch sử
          Test: query tổng KL theo tháng của HPG — phải chạy < 100ms

□ Ngày 4  ⭐ derive_corporate_actions() từ cặp adj/raw
          Chạy sanity_check(), rồi ĐỐI CHIẾU THỦ CÔNG:
            chọn 3 mã bạn biết rõ lịch sử chia cổ tức bằng cổ phiếu
            → ngày và tỷ lệ suy ra có khớp thực tế không?
          Nếu khớp: bạn vừa tiết kiệm 1 tuần scrape VSDC

□ Ngày 5  Parse file CCNN, tính 7 đặc trưng cung cầu
          Vẽ order_imbalance và bid_size_cv của 1 mã đã bị UBCKNN
          xử phạt (PPT hoặc CRC) trong giai đoạn vi phạm
          → có nhìn thấy gì bất thường bằng mắt không?
          ⭐ Nếu có: module phát hiện bất thường sẽ hoạt động được

□ Ngày 6  Tính 15 chỉ báo bằng TA-Lib; job EOD 16:00 + APScheduler
          Streamlit trang đầu: bảng mã + biểu đồ nến

□ Ngày 7  ⭐ Test EOD execution CHO SỚM, đừng chờ tuần 5:
          Lấy 1 quy tắc đơn giản (giá cắt lên MA20), tính hai kết quả:
            (a) entry = close[T]        ← cách sai
            (b) entry = open[T+1]       ← cách đúng
          So sánh CAGR của (a) và (b).
          Khoảng cách đó chính là số tiền ảo mà backtest sai tạo ra.
          Nhìn thấy con số này một lần, bạn sẽ không bao giờ quên.
```

---

> ## ⚠️ TUYÊN BỐ MIỄN TRỪ TRÁCH NHIỆM
>
> Tài liệu này là đề xuất kỹ thuật cho **công cụ phần mềm cá nhân**, phục vụ nghiên cứu và học tập. Không phải khuyến nghị đầu tư, không phải tư vấn pháp lý.
>
> Dữ liệu do CafeF, Fialda và các nguồn khác phát hành công khai miễn phí có giá trị tham khảo; các đơn vị này ghi rõ không chịu trách nhiệm về rủi ro phát sinh từ việc sử dụng dữ liệu. **Chỉ sử dụng cho mục đích cá nhân; không tái phân phối, không thương mại hoá.**
>
> Việc công bố hoặc bán kết quả đầu ra dưới hình thức khuyến nghị mua/bán chứng khoán cho người khác có thể cấu thành hoạt động kinh doanh chứng khoán chưa được cấp phép, bị nghiêm cấm theo khoản 4 Điều 12 Luật Chứng khoán.
>
> **Kết quả trong quá khứ không đảm bảo kết quả trong tương lai.** Đầu tư chứng khoán luôn tiềm ẩn rủi ro mất vốn. Riêng với phong cách EOD kết hợp chu kỳ thanh toán T+2, cần đặc biệt lưu ý rủi ro **3 phiên không có khả năng thoát vị thế**.
>
> Module phát hiện bất thường chỉ đưa ra **cảnh báo thống kê về dữ liệu giá, khối lượng và cung cầu**, không phải kết luận về hành vi vi phạm pháp luật. Chỉ cơ quan quản lý nhà nước có thẩm quyền mới có thể xác định hành vi thao túng thị trường chứng khoán.
