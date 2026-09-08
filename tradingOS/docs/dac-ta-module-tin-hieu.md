# ĐẶC TẢ KỸ THUẬT — MODULE TÍN HIỆU & KHUYẾN NGHỊ

**VNQD Signal Engine · Bản đặc tả hoàn chỉnh v1.0**

| | |
|---|---|
| Ngày | 06/09/2026 |
| Phạm vi | Toàn bộ chuỗi: dữ liệu → chỉ báo → tín hiệu → giá → khối lượng → thời điểm → thoát lệnh |
| Gom từ | Proposal v1.0, v2.0, v2.1, Nghiên cứu v3.0 |
| Tính tự chứa | ✅ Không cần mở tài liệu khác để lập trình module này |
| Phong cách giao dịch | EOD-only · T+2 · long-only · không auto-trading · cá nhân |

---

## MỤC LỤC

| | |
|---|---|
| [§0](#0--nguyên-lý-hợp-nhất) | Nguyên lý hợp nhất — ý tưởng cốt lõi của toàn bộ module |
| [§1](#1--hợp-đồng-dữ-liệu-vào) | Hợp đồng dữ liệu vào |
| [§2](#2--tầng-chỉ-báo--công-thức-chính-xác) | Tầng chỉ báo — công thức chính xác |
| [§3](#3--pipeline-7-cửa) | Pipeline 7 cửa |
| [§4](#4--danh-mục-setup) | Danh mục setup |
| [§5](#5--tính-giá-vào-lệnh) | Tính giá vào lệnh |
| [§6](#6--tính-stop-và-mục-tiêu) | Tính stop và mục tiêu |
| [§7](#7--tính-khối-lượng) | Tính khối lượng |
| [§8](#8--tính-điểm-và-xác-suất) | Tính điểm và xác suất |
| [§9](#9--thời-điểm--vòng-đời-lệnh) | Thời điểm — vòng đời lệnh |
| [§10](#10--quy-tắc-thoát-lệnh) | Quy tắc thoát lệnh |
| [§11](#11--phiếu-lệnh-đầu-ra) | Phiếu lệnh đầu ra |
| [§12](#12--mã-nguồn-engine) | Mã nguồn engine |
| [§13](#13--sổ-đăng-ký-tham-số) | Sổ đăng ký tham số |
| [§14](#14--giao-thức-hiệu-chuẩn) | Giao thức hiệu chuẩn |

---

# §0 — NGUYÊN LÝ HỢP NHẤT

Toàn bộ module này xây trên **một câu** rút ra từ hai định luật học thuật đã kiểm định trên dữ liệu Việt Nam:

> ## Momentum trung hạn chọn **MÃ NÀO**.
> ## Đảo chiều ngắn hạn chọn **KHI NÀO**.

**Cơ sở:**

- **Định luật momentum trung hạn** — Vo & Truong (2018) tìm thấy momentum tồn tại trên TTCK Việt Nam giai đoạn 2007–2015, đặc biệt với danh mục hình thành theo 6 tháng trước và nắm giữ 9 tháng.
- **Định luật đảo chiều ngắn hạn** — Nghiên cứu overreaction trên HOSE: suất sinh lợi bất thường của danh mục winner là âm; đảo chiều nhóm loser xảy ra ở tháng T+2 và T+3 với chênh lệch 1,80% và 2,17%, có ý nghĩa ở mức 5%. Trên HNX (2025): suất sinh lợi bất thường âm mạnh ở chân trời một tháng, yếu dần ở hai tháng, biến mất ở tháng thứ ba.

**Hợp nhất thành điều kiện kép — trái tim của engine:**

```
              RS_126 CAO                    RS_20 THẤP
    (mạnh 6 tháng, momentum trung hạn)  (yếu 1 tháng, quá bán ngắn hạn)
                    │                              │
                    └──────────────┬───────────────┘
                                   ▼
                          ⭐ ĐIỀU KIỆN VÀO LỆNH
                    "Cổ phiếu tốt đang tạm thời bị bán quá"
```

Mọi setup, mọi điểm số, mọi ngưỡng trong tài liệu này là biến thể hoặc bộ lọc bổ trợ cho điều kiện kép này. Nếu phải bỏ hết chỉ giữ một thứ, giữ nó.

## 0.1. Năm quy tắc bất di bất dịch

| # | Quy tắc | Vì sao |
|:---:|---|---|
| **R1** | Giá vào lệnh **KHÔNG BAO GIỜ** là `close[T]`. Luôn là giá khớp ngày T+1 | Tín hiệu sinh sau đóng cửa, lệnh đặt sáng hôm sau |
| **R2** | Thị trường Downtrend ⇒ **không sinh tín hiệu mua nào** | Bầy đàn mạnh hơn trong thị trường giảm |
| **R3** | Khối lượng tính theo **stop rộng**, thoát lệnh theo **stop hẹp** | 3 phiên T+2 bị khoá không thể thoát |
| **R4** | Chỉ nhóm C3 (beta cao) dùng logic momentum. Còn lại mua-khi-yếu | Đảo chiều ngắn hạn chiếm ưu thế ở chân trời 1–4 tuần |
| **R5** | Mọi tham số phải nằm trong **§13 Sổ đăng ký**, không hardcode rải rác | Truy vết được, hiệu chuẩn được |

## 0.2. Trong và ngoài phạm vi

| ✅ Module này làm | ❌ Module này không làm |
|---|---|
| Sinh tín hiệu MUA kèm giá, KL, stop, mục tiêu | Đặt lệnh tự động |
| Sinh tín hiệu THOÁT | Dự báo giá cụ thể |
| Tính điểm và xác suất thắng | Định giá cơ bản (module riêng) |
| Kiểm tra gap sáng T+1 | Quét thao túng (module riêng, chỉ tiêu thụ kết quả) |
| Xuất phiếu lệnh | Backtest (module riêng, chỉ tiêu thụ kết quả) |

---

# §1 — HỢP ĐỒNG DỮ LIỆU VÀO

## 1.1. Bảng dữ liệu bắt buộc

| Bảng | Cột | Nguồn | Tần suất | Bắt buộc |
|---|---|---|---|:---:|
| `ohlcv_adj` | date, symbol, open, high, low, close, volume | CafeF `SolieuGD` (đã điều chỉnh) | EOD | ✅ |
| `ohlcv_raw` | date, symbol, open, high, low, close, volume | CafeF `SolieuGD.Raw` | EOD | ✅ |
| `index_adj` | date, index_code, open, high, low, close, volume | CafeF `Index` | EOD | ✅ |
| `order_flow` | date, symbol, bid_volume, ask_volume, bid_orders, ask_orders, matched_volume, foreign_buy, foreign_sell | CafeF `CCNN` | EOD | ✅ |
| `symbols` | symbol, exchange, sector, owner_group, shares_out, free_float_est, warning_status | HOSE/HNX + tay | Tháng | ✅ |
| `anomaly_flags` | date, symbol, risk_score, level | Module F | EOD | ✅ |
| `stock_profile` | symbol, as_of, 14 thước đo | Tự tính | Quý | ✅ |
| `cluster_map` | symbol, as_of, cluster, reason | Tự tính | Quý | ✅ |
| `commodity_px` | date, code, close | FRED / yfinance | EOD | ⚠️ chỉ cho C4 |
| `portfolio` | symbol, qty, avg_price, entry_date, stop, target_1, target_2 | Nhật ký | Realtime | ✅ |
| `nav` | date, total_nav, cash | Nhật ký | EOD | ✅ |

## 1.2. Yêu cầu tối thiểu về độ dài

```
Chỉ báo ngắn nhất  : 20 phiên   (MA20, Bollinger)
Chỉ báo dài nhất   : 250 phiên  (MA200, RS_126, beta, profile)
Đệm an toàn        : 30 phiên

⇒ Mỗi mã cần TỐI THIỂU 280 phiên liên tục để được xét tín hiệu.
⇒ Mã mới lên sàn dưới 280 phiên: LOẠI khỏi universe, không ngoại lệ.
```

## 1.3. Cửa kiểm tra chất lượng — chạy trước khi sinh tín hiệu

Nếu bất kỳ kiểm tra nào thất bại, **dừng toàn bộ job và cảnh báo Telegram**, không sinh tín hiệu với dữ liệu đáng ngờ.

```python
# Kiểm tra bắt buộc trước mỗi lần sinh tín hiệu
CHECKS = [
    "phiên gần nhất trong ohlcv_adj == phiên giao dịch mới nhất theo lịch",
    "số mã có dữ liệu phiên mới nhất >= 90% số mã phiên trước",
    "không có mã nào |return| > biên độ sàn × 1,05 mà không có sự kiện quyền",
    "low <= min(open, close) AND high >= max(open, close) cho mọi dòng",
    "volume >= 0 cho mọi dòng",
    "đối chiếu 30 mã VN30 với nguồn dự phòng, lệch < 0,5%",
    "cluster_map.as_of cách hiện tại không quá 100 ngày",
    "anomaly_flags có dữ liệu cho phiên mới nhất",
]
```

---

# §2 — TẦNG CHỈ BÁO — CÔNG THỨC CHÍNH XÁC

Mọi chỉ báo tính trên **giá đã điều chỉnh**. Ký hiệu: `C` = close, `H` = high, `L` = low, `O` = open, `V` = volume, `t` = phiên hiện tại.

## 2.1. Nhóm xu hướng

| Mã | Tên | Công thức |
|---|---|---|
| `MA_n` | Trung bình động đơn giản | `mean(C[t-n+1 : t])`, n ∈ {10, 20, 50, 100, 200} |
| `EMA_n` | Trung bình động hàm mũ | `α·C[t] + (1-α)·EMA[t-1]`, `α = 2/(n+1)` |
| `MA_SLOPE_n` | Độ dốc MA (chuẩn hoá) | `(MA_n[t] / MA_n[t-10] - 1)` |
| `DIST_MA_n` | Khoảng cách tới MA | `(C[t] - MA_n[t]) / MA_n[t]` |
| `ADX_14` | Chỉ số định hướng | Wilder chuẩn, 14 kỳ |
| `MACD` | MACD | `EMA_12 - EMA_26`; signal `= EMA_9(MACD)`; hist `= MACD - signal` |

## 2.2. Nhóm động lượng và sức mạnh tương đối ⭐

Đây là nhóm quan trọng nhất, hiện thực hoá §0.

| Mã | Tên | Công thức | Vai trò |
|---|---|---|---|
| `RS_126` ⭐ | **Sức mạnh tương đối 6 tháng** | `(C[t]/C[t-126]) / (IDX[t]/IDX[t-126]) - 1` | Định luật momentum trung hạn — **chọn MÃ** |
| `RS_126_RANK` | Xếp hạng percentile trong VN100 | `percentile_rank(RS_126)` × 100 | Chuẩn hoá 0–100 |
| `RS_20` ⭐ | **Sức mạnh tương đối 1 tháng** | `(C[t]/C[t-20]) / (IDX[t]/IDX[t-20]) - 1` | Định luật đảo chiều — **chọn KHI NÀO** |
| `RS_20_RANK` | Xếp hạng percentile | `percentile_rank(RS_20)` × 100 | |
| `MOM_252_21` | Momentum 12-1 tháng | `C[t-21]/C[t-252] - 1` | Bỏ 1 tháng gần nhất để tránh nhiễu đảo chiều |
| `RSI_n` | RSI Wilder | `100 - 100/(1+RS)`, `RS = avg_gain_n / avg_loss_n`, n ∈ {9, 14, 21} |
| `STOCH_K` | Stochastic %K | `100 × (C - min(L,14)) / (max(H,14) - min(L,14))` |
| `ROC_n` | Tốc độ thay đổi | `C[t]/C[t-n] - 1`, n ∈ {5, 20, 60} |

> **Chỉ số tham chiếu `IDX` dùng gì?**
> - Nhóm C1 (trụ), C4, C5, C6 → **VN100_EW** (bình quân giá bằng nhau, tự tính)
> - Nhóm C2, C3 → **VN-Index**
>
> Lý do: nhóm C1 *tạo ra* VN-Index. Đo RS của VIC so với VN-Index là lập luận vòng tròn, vì VNI chịu ảnh hưởng của các cổ phiếu vốn hoá lớn và làm hạn chế ảnh hưởng của các mã còn lại.

**Công thức VN100_EW (tự tính, không có sẵn):**

```
VN100_EW[t] = VN100_EW[t-1] × (1 + mean( r_i[t] for i in VN100 ))
    với r_i[t] = C_i[t]/C_i[t-1] - 1,   khởi tạo VN100_EW[0] = 1000
    → Bỏ qua mã không giao dịch phiên đó (không tính vào mean)
    → Cập nhật thành phần VN100 mỗi kỳ rà soát
```

## 2.3. Nhóm biến động — nền tảng của stop và sizing

| Mã | Tên | Công thức |
|---|---|---|
| `TR` | True Range | `max(H-L, |H-C[t-1]|, |L-C[t-1]|)` |
| `ATR_14` | ATR Wilder | `(ATR[t-1]×13 + TR[t]) / 14` |
| `ATR_PCT` | ATR chuẩn hoá | `ATR_14 / C[t]` |
| `DATR_14` ⭐ | **Downside ATR** | ATR tính **chỉ trên các phiên có `C[t] < C[t-1]`** |
| `ATR_ASYM` ⭐ | Bất đối xứng biến động | `DATR_14 / ATR_14` |
| `BB_MID` | Bollinger giữa | `MA_20` |
| `BB_UP` / `BB_LO` | Dải trên / dưới | `MA_20 ± 2 × std(C, 20)` |
| `BB_PCTB` | %B | `(C - BB_LO) / (BB_UP - BB_LO)` |
| `BB_WIDTH` | Độ rộng dải | `(BB_UP - BB_LO) / BB_MID` |
| `VOL_20` | Biến động 20 phiên | `std(ln(C[t]/C[t-1]), 20) × √250` |
| `NR7` | Nến hẹp nhất 7 phiên | `(H-L) == min(H-L, 7)` |

> ⚠️ **`DATR_14` là bắt buộc, không phải tuỳ chọn.** Các cú sốc âm dẫn tới biến động lớn hơn cú sốc dương cùng độ lớn trên HOSE. ATR đối xứng đánh giá thấp rủi ro giảm — và với 3 phiên T+2 bị khoá, đó là rủi ro tài khoản thật.

## 2.4. Nhóm khối lượng và dòng tiền

| Mã | Công thức |
|---|---|
| `VOL_MA_20` | `mean(V, 20)` |
| `VOL_RATIO` | `V[t] / VOL_MA_20[t]` |
| `VOL_RATIO_3` | `mean(V, 3) / VOL_MA_20` |
| `TURNOVER` | `C[t] × V[t]` |
| `ADV_20` | `mean(TURNOVER, 20)` — đơn vị tỷ đồng |
| `OBV` | `OBV[t-1] + sign(C[t]-C[t-1]) × V[t]` |
| `MFI_14` | Money Flow Index Wilder 14 kỳ |
| `AMIHUD` | `mean(|r| / TURNOVER, 60) × 1e9` |

## 2.5. Nhóm cung cầu — từ file CCNN của CafeF ⭐

Đây là nhóm ít nền tảng nào có. Cho phép quan sát vi cấu trúc ở mức ngày.

| Mã | Công thức | Ý nghĩa |
|---|---|---|
| `OI` | `(bid_volume - ask_volume) / (bid_volume + ask_volume)` | Mất cân bằng lệnh đặt, ∈ [-1, 1] |
| `OI_MA_10` | `mean(OI, 10)` | Áp lực một chiều duy trì |
| `OTR` | `(bid_volume + ask_volume) / matched_volume` | Tỷ lệ đặt/khớp |
| `AVG_BID_SIZE` | `bid_volume / bid_orders` | Quy mô lệnh mua trung bình |
| `BID_SIZE_CV` | `std(AVG_BID_SIZE, 20) / mean(AVG_BID_SIZE, 20)` | ⭐ CV thấp = lệnh lặp lại bất thường |
| `FNET` | `foreign_buy - foreign_sell` | Khối ngoại ròng |
| `FNET_5` / `FNET_20` | `rolling_sum(FNET, 5 / 20)` | Dòng ngoại lũy kế |
| `FNET_SENS` | `corr(r, FNET, 60)` | Nhạy cảm dòng ngoại |

> Khối ngoại **không phải dữ liệu trang trí**. Nhà đầu tư nước ngoài được phát hiện là nhóm giao dịch theo phản hồi tích cực và có khả năng chọn thời điểm cũng như chiến lược giao dịch tốt hơn trên thị trường này (Vo, 2017), và có quan hệ dương giữa thanh khoản và suất sinh lợi (Batten & Vo, 2014).

## 2.6. Nhóm độ rộng thị trường — tính trên toàn sàn

| Mã | Công thức |
|---|---|
| `PCT_ABOVE_MA20` | `count(C > MA_20) / count(all)` trên toàn HOSE |
| `PCT_ABOVE_MA50` | tương tự với MA50 |
| `PCT_ABOVE_MA200` | tương tự với MA200 |
| `AD_RATIO` | `count(r > 0) / count(r < 0)` |
| `AD_LINE` | `AD_LINE[t-1] + (advances - declines)` |
| `NEW_HIGH_52W` | số mã tạo đỉnh 52 tuần mới |
| `NEW_LOW_52W` | số mã tạo đáy 52 tuần mới |
| `CEIL_COUNT` / `FLOOR_COUNT` | số mã trần / sàn |
| `MKT_TURNOVER` | tổng giá trị giao dịch toàn sàn |

## 2.7. Nhóm bối cảnh thời vụ

| Mã | Công thức | Cơ sở |
|---|---|---|
| `DAYS_TO_TET` | số phiên tới Tết Nguyên đán | Suất sinh lợi bình quân 5 phiên cuối trước Tết cao hơn 5 phiên đầu sau Tết (Khanh và cộng sự, 2020) |
| `TET_WINDOW` | `1 if 1 <= DAYS_TO_TET <= 10 else 0` | Vùng tích cực |
| `POST_TET` | `1 if -5 <= DAYS_TO_TET <= 0 else 0` | ⚠️ Hiệu ứng **không** lan sang ngày sau Tết — không dùng làm tín hiệu |
| `MONTH` | tháng dương lịch | Hiệu ứng tháng Một được ghi nhận (Luu và cộng sự 2016, Thach 2019, Zaremba 2015) |
| `DOW` | thứ trong tuần | Hiệu ứng ngày trong tuần từng được ghi nhận |

> Các biến này chỉ dùng làm **điều chỉnh tỷ trọng ±10%**, tuyệt đối không dùng làm setup độc lập.

---

# §3 — PIPELINE 7 CỬA

Mỗi mã phải qua **7 cửa liên tiếp**. Trượt bất kỳ cửa nào là loại, không ngoại lệ, không "gần đạt".

```
┌─ CỬA 0 ─ TRẠNG THÁI THỊ TRƯỜNG ───────────────────────────────────┐
│  Nếu regime = DOWNTREND  →  DỪNG TOÀN BỘ, không sinh tín hiệu nào │
│  (Quy tắc R2 — bầy đàn mạnh hơn trong thị trường giảm)            │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
┌─ CỬA 1 ─ ĐỦ ĐIỀU KIỆN UNIVERSE ───────────────────────────────────┐
│  • Thuộc VN100 hoặc watchlist cá nhân                             │
│  • >= 280 phiên dữ liệu liên tục                                  │
│  • ADV_20 >= 20 tỷ đồng                                           │
│  • Không thuộc diện cảnh báo / kiểm soát / hạn chế giao dịch      │
│  • cluster != EXCLUDED                                            │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
┌─ CỬA 2 ─ CỜ RỦI RO BẤT THƯỜNG ────────────────────────────────────┐
│  anomaly_risk_score < ngưỡng của nhóm  (C6: <40, C3: <50, ...)     │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
┌─ CỬA 3 ─ ĐỐI CHIẾU NHÓM ↔ TRẠNG THÁI ─────────────────────────────┐
│  regime hiện tại >= min_regime của nhóm                           │
│  Ví dụ: C3 và C6 chỉ chạy khi regime = STRONG_UPTREND             │
│  Kiểm tra biến ngoại sinh bắt buộc của nhóm (C4: giá hàng hoá...) │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
┌─ CỬA 4 ─ ĐIỀU KIỆN KÉP + SETUP ⭐ ────────────────────────────────┐
│  ĐIỀU KIỆN KÉP (§0):                                              │
│     RS_126_RANK >= 60          (mạnh 6 tháng)                     │
│     AND (RS_20_RANK <= 40 nếu logic mua-khi-yếu                   │
│          RS_20_RANK >= 65 nếu logic momentum — chỉ C3)            │
│  VÀ khớp >= 1 setup trong danh mục được phép của nhóm (§4)        │
│  VÀ VOL_RATIO >= min_volume_ratio của nhóm                        │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
┌─ CỬA 5 ─ ĐIỂM VÀ XÁC SUẤT ────────────────────────────────────────┐
│  technical_score >= 60                                            │
│  win_probability >= 0,55   (từ meta-model, nếu đã huấn luyện)      │
│  risk_reward >= 2,0                                               │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
┌─ CỬA 6 ─ RÀNG BUỘC DANH MỤC ──────────────────────────────────────┐
│  • Chưa nắm mã này                                                │
│  • Số vị thế mở < 10                                              │
│  • Tỷ trọng nhóm ngành <= 35%                                     │
│  • Tỷ trọng nhóm sở hữu <= giới hạn (Vingroup 15%, Masan 12%...)  │
│  • Tối đa 2 mã cùng nhóm C2 (ngân hàng tương quan quá cao)        │
│  • Tối đa 1 mã nhóm C6                                            │
│  • Tổng rủi ro mở <= 5% NAV                                       │
│  • Còn đủ tiền                                                    │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
                    ✅ SINH PHIẾU LỆNH  (§11)
                    Xếp hạng theo score, lấy Top N
```

## 3.1. Xác định trạng thái thị trường (Cửa 0)

Đây là cửa quan trọng nhất. Dùng **cả hai chỉ số**, và khi phân kỳ thì tin vào chỉ số bình quân giá.

```python
def market_regime(vni: dict, ew: dict, breadth: dict) -> str:
    """
    vni    : VN-Index — close, ma50, ma200
    ew     : VN100_EW — close, ma50, ma200      ⭐ chống chi phối bởi nhóm trụ
    breadth: pct_above_ma50, pct_above_ma200, ad_line_slope_10
    """
    # Điểm cho từng chỉ số: trên MA50 (+1), trên MA200 (+1), MA50>MA200 (+1)
    def score(ix):
        return ((ix["close"] > ix["ma50"]) + (ix["close"] > ix["ma200"])
                + (ix["ma50"] > ix["ma200"]))

    s_vni, s_ew = score(vni), score(ew)
    b50 = breadth["pct_above_ma50"]

    # ⭐ Khi hai chỉ số phân kỳ, LẤY CÁI THẤP HƠN (nguyên tắc bảo thủ)
    s = min(s_vni, s_ew)

    if s == 3 and b50 >= 0.60 and breadth["ad_line_slope_10"] > 0:
        return "STRONG_UPTREND"
    if s >= 2 and b50 >= 0.45:
        return "UPTREND"
    if s >= 1 and b50 >= 0.35:
        return "SIDEWAY"
    if s >= 1 or b50 >= 0.25:
        return "MILD_CORRECTION"
    return "DOWNTREND"          # ⇒ Cửa 0 chặn toàn bộ
```

| Trạng thái | Nhóm được phép giao dịch | Hệ số tỷ trọng chung |
|---|---|:---:|
| `STRONG_UPTREND` | Tất cả C1–C6 | 1,00 |
| `UPTREND` | C1, C2, C4, C5 | 0,85 |
| `SIDEWAY` | C1, C2, C4, C5 | 0,65 |
| `MILD_CORRECTION` | **chỉ C5** (phòng thủ) | 0,40 |
| `DOWNTREND` | **không nhóm nào** | 0,00 |

---

# §4 — DANH MỤC SETUP

Điều kiện phát hiện chính xác. `P` = tham số của nhóm (§13).

## S1 · `PB_MA20` — Pullback về MA20 ⭐ setup xương sống

```
ĐIỀU KIỆN XU HƯỚNG (phải đúng tất cả):
    MA_20 > MA_50 > MA_200
    MA_SLOPE_50 > 0
    C[t] > MA_200 × 1,02

ĐIỀU KIỆN PULLBACK:
    -0,04 <= DIST_MA_20 <= +0,02        (giá quanh MA20, có thể xuyên nhẹ)
    min(L[t-4:t]) <= MA_20 × 1,005      (đã thực sự chạm MA20 trong 5 phiên)
    RSI_14 < P.rsi_buy_max

ĐIỀU KIỆN CHẤT LƯỢNG PULLBACK (phân biệt điều chỉnh lành mạnh vs phân phối):
    mean(V[t-4:t]) < VOL_MA_20 × 1,10   ⭐ KL GIẢM khi điều chỉnh
    max(C[t-20:t]) / C[t] - 1 <= 0,15   (không giảm quá sâu từ đỉnh gần)

ĐIỀU KIỆN NẾN KÍCH HOẠT (>= 1 trong 3):
    (a) C[t] > O[t] AND C[t] > C[t-1]                       nến tăng
    (b) (C[t]-L[t]) / max(H[t]-L[t], eps) > 0,60            đóng cửa nửa trên
    (c) C[t] > max(H[t-1], H[t-2])                          phá đỉnh 2 phiên
```

## S2 · `PB_MA50` — Pullback sâu về MA50

```
    MA_50 > MA_200  AND  MA_SLOPE_200 > 0
    -0,05 <= DIST_MA_50 <= +0,03
    min(L[t-9:t]) <= MA_50 × 1,01
    RSI_14 < P.rsi_buy_max - 3          (yêu cầu quá bán sâu hơn S1)
    mean(V[t-4:t]) < VOL_MA_20 × 1,15
    + nến kích hoạt như S1
```

## S3 · `REV_SUP` — Đảo chiều tại hỗ trợ

```
    C[t] > MA_200                        (vẫn trong xu hướng dài hạn tăng)
    C[t] <= support_level × 1,02
        với support_level = max(
            min(L[t-59:t-5]),            đáy 60 phiên (bỏ 5 phiên gần)
            fib_618(swing_high, swing_low)
        )
    RSI_14 < 40  AND  RSI phân kỳ dương:
        C[t] < C[t_prev_low]  AND  RSI_14[t] > RSI_14[t_prev_low]
    V[t] > VOL_MA_20 × 1,2               ⭐ KL TĂNG khi đảo chiều (khác S1/S2)
    C[t] > O[t]
```

## S4 · `BB_LOWER` — Bollinger dải dưới (chỉ nhóm C5)

```
    C[t] > MA_200                        (bối cảnh dài hạn tăng)
    BB_PCTB < 0,08                       (chạm/xuyên dải dưới)
    RSI_21 < 35
    BB_WIDTH > percentile(BB_WIDTH, 250, 30)   (dải không quá hẹp — cần biến động)
    C[t] > L[t-1]                        (dấu hiệu ngừng rơi)
```

## S5 · `TREND_MA` — Trend-following

```
    MA_20 > MA_50 > MA_200
    MA_SLOPE_50 > 0,01  AND  MA_SLOPE_200 > 0
    ADX_14 > 20
    0 <= DIST_MA_20 <= 0,06              (trên MA20 nhưng chưa quá xa)
    RS_126_RANK >= 70
    VOL_RATIO >= 1,0
```

## S6 · `RS_LEADER` — Dẫn dắt tương đối

```
    RS_126_RANK >= 85                    ⭐ ngưỡng cao
    C[t] >= max(C[t-251:t]) × 0,92       (trong 8% của đỉnh 52 tuần)
    MA_50 > MA_200
    sector_rs_rank >= 70                 (ngành cũng phải mạnh)
    RS_20_RANK <= 55                     (chưa quá nóng ngắn hạn)
```

## S7 · `MOM_20` — Momentum 20 phiên (**CHỈ nhóm C3**)

```
    regime == "STRONG_UPTREND"           ⭐ điều kiện cứng
    RS_20_RANK >= 65  AND  RS_126_RANK >= 60
    C[t] > MA_10 > MA_20 > MA_50
    RSI_9 > 55  AND  RSI_9 < 78          (mạnh nhưng chưa cực đoan)
    VOL_RATIO >= 1,5
    MKT_TURNOVER > mean(MKT_TURNOVER, 20)   biến ngoại sinh của C3
```

## S8 · `VCP` — Thu hẹp biến động

```
    MA_50 > MA_200
    >= 2 lần thu hẹp biên độ liên tiếp:
        range_i = max(H) - min(L) trong cửa sổ i
        range_1 > range_2 > range_3   (3 cửa sổ 10 phiên liên tiếp)
    BB_WIDTH[t] < percentile(BB_WIDTH, 250, 25)
    mean(V[t-9:t]) < VOL_MA_20 × 0,85    (KL cạn dần)
    C[t] >= max(C[t-9:t])                (bắt đầu bung ra)
    V[t] >= VOL_MA_20 × 1,5
```

## Ma trận setup × nhóm

| Setup | C1 | C2 | C3 | C4 | C5 | C6 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `PB_MA20` | ✅✅ | ✅✅✅ | ✅ | ✅✅ | ✅✅ | ✅✅✅ |
| `PB_MA50` | ✅✅ | ✅✅ | — | ✅✅ | ✅ | ✅ |
| `REV_SUP` | ✅ | ✅ | — | ✅ | ✅✅✅ | ✅ |
| `BB_LOWER` | — | ✅ | — | — | ✅✅✅ | — |
| `TREND_MA` | ✅✅✅ | ✅ | ✅ | ✅✅✅ | ✅ | — |
| `RS_LEADER` | ✅✅ | ✅ | ✅✅ | ✅✅ | — | ✅ |
| `MOM_20` | ❌ | ❌ | ✅✅✅ | ✅ | ❌ | ❌ |
| `VCP` | ✅ | — | ✅ | ✅ | — | — |

*✅✅✅ setup chính · ✅✅ tốt · ✅ dùng được · — không dùng · ❌ cấm*

**Khi nhiều setup cùng khớp:** lấy setup có ưu tiên cao nhất theo ma trận (✅✅✅ > ✅✅ > ✅), rồi cộng **+3 điểm** vào `technical_score` cho mỗi setup phụ khớp thêm (tối đa +6).

---

# §5 — TÍNH GIÁ VÀO LỆNH

## 5.1. Ba bước

```
BƯỚC 1 — Giá LO cơ sở (tính tối ngày T)
    LO_raw = C[T] × (1 + premium)

BƯỚC 2 — Làm tròn theo bước giá của sàn
    LO = round_to_tick(LO_raw, exchange)

BƯỚC 3 — Kiểm tra gap sáng T+1  (§9.3) → có thể HUỶ lệnh
```

## 5.2. Premium theo setup — không theo nhóm

Premium phụ thuộc **bản chất setup**, vì đó là thứ quyết định rủi ro gap.

| Setup | Premium | Lý do |
|---|:---:|---|
| `PB_MA20`, `PB_MA50` | **+0,5%** | Mua khi yếu, không cần tranh giá |
| `REV_SUP`, `BB_LOWER` | **+0,5%** | Tương tự |
| `TREND_MA` | **+1,0%** | Thời điểm không quan trọng, ưu tiên khớp |
| `RS_LEADER` | **+1,0%** | Tương tự |
| `MOM_20` | **+0,8%** | Cần khớp để bắt đà, nhưng có rủi ro gap |
| `VCP`, `BO_BASE` | **+0,3%** | ⭐ Rủi ro gap cao nhất — thà không khớp còn hơn mua đắt |

## 5.3. Bước giá theo sàn

```python
def round_to_tick(price: float, exchange: str) -> float:
    """Làm tròn XUỐNG để không vô tình trả cao hơn dự kiến."""
    if exchange == "HOSE":
        tick = 10 if price < 10_000 else (50 if price < 50_000 else 100)
    else:                                   # HNX, UPCOM
        tick = 100
    return (price // tick) * tick
```

## 5.4. Kiểm tra biên độ

```
ceiling = round_to_tick(ref_price × (1 + band), exchange)
floor   = round_to_tick(ref_price × (1 - band), exchange)

LO_final = min(LO, ceiling)

Nếu LO >= ceiling × 0,995:
    → HUỶ LỆNH, lý do "giá LO chạm trần, không thể khớp"
```

Biên độ: HOSE ±7% · HNX ±10% · UPCOM ±15%

---

# §6 — TÍNH STOP VÀ MỤC TIÊU

## 6.1. Hệ thống HAI STOP ⭐ điểm quan trọng nhất của phong cách EOD

Đây là hệ quả trực tiếp của việc **3 phiên bị khoá** trong chu kỳ T+2.

```
╔═══════════════════════════════════════════════════════════════════╗
║  STOP THOÁT LỆNH  (exit_stop)                                     ║
║  → Mức giá mà hệ thống NHẮC BẠN BÁN vào sáng hôm sau               ║
║  → Hẹp, dựa trên cấu trúc giá và ATR                              ║
║                                                                    ║
║  exit_stop = min(                                                  ║
║      structure_low - 0,5 × ATR_14,                                 ║
║      entry × (1 - P.max_stop_pct)                                  ║
║  )                                                                 ║
║  structure_low = min(L[t-9:t])  cho pullback                       ║
║               = support_level    cho REV_SUP / BB_LOWER            ║
╠═══════════════════════════════════════════════════════════════════╣
║  STOP TÍNH KHỐI LƯỢNG  (sizing_stop)                              ║
║  → CHỈ dùng để tính KL. KHÔNG dùng để thoát lệnh                   ║
║  → Rộng, mô phỏng rủi ro đuôi khi không thể thoát                  ║
║                                                                    ║
║  atr_eff = max(ATR_14, 1,3 × DATR_14)      ⭐ hiệu ứng đòn bẩy     ║
║  sizing_stop = min(                                                ║
║      entry - P.atr_mult × atr_eff,                                 ║
║      entry × (1 - P.max_stop_pct × 1,25)                           ║
║  )                                                                 ║
╚═══════════════════════════════════════════════════════════════════╝
```

**Vì sao phải tách hai stop?**

Từ khi khớp mua sáng T+1 tới khi bán được sáng T+4 có **3 phiên không thể thoát**. Với biên độ HOSE ±7%:

```
Rủi ro tối đa lý thuyết = 1 - (1-0,07)³ = -19,5%
```

Nếu tính KL theo `exit_stop` (ví dụ 6%), bạn sẽ mua lượng gấp ~1,7 lần so với rủi ro thực tế. Ba phiên sàn liên tiếp là chuyện đã xảy ra nhiều lần trên TTCK Việt Nam.

## 6.2. Mục tiêu chốt lời

```
R = entry - exit_stop                    (1R tính theo stop THOÁT LỆNH)

target_1 = round_to_tick(entry + 2,0 × R)   → bán 50% vị thế
target_2 = round_to_tick(entry + 3,5 × R)   → bán phần còn lại hoặc chuyển trailing

risk_reward = (target_1 - entry) / R = 2,0   (theo định nghĩa)
```

**Cửa kiểm tra R:R tại Cửa 5:**

```
Nếu exit_stop quá gần entry (R quá nhỏ so với ATR):
    R / ATR_14 < 0,8  →  HUỶ TÍN HIỆU
    Lý do: stop nằm trong vùng nhiễu, sẽ bị quét bởi biến động thường ngày

Nếu target_1 vượt kháng cự mạnh:
    resistance = max(H[t-59:t])
    Nếu target_1 > resistance × 1,02 AND resistance < entry × 1,15:
        → HUỶ TÍN HIỆU, lý do "mục tiêu bị chắn bởi kháng cự gần"
```

## 6.3. Trailing stop (sau khi qua T+2 và đạt target_1)

```
Chỉ kích hoạt khi: đã qua earliest_exit_date  VÀ  C[t] >= target_1

trailing_stop = max(
    exit_stop,
    max(H kể từ ngày vào lệnh) - 3,0 × ATR_14      Chandelier Exit
)
→ Chỉ được nâng lên, không bao giờ hạ xuống
```

---

# §7 — TÍNH KHỐI LƯỢNG

## 7.1. Công thức đầy đủ

```python
# BƯỚC 1 — Rủi ro tiền cho phép
risk_budget = NAV × P.risk_per_trade × regime_factor × seasonal_factor
    # P.risk_per_trade      : 0,4% – 0,7% NAV theo hồ sơ rủi ro
    # regime_factor         : 1,00 / 0,85 / 0,65 / 0,40 / 0,00  (§3.1)
    # seasonal_factor       : 1,10 nếu TET_WINDOW, ngược lại 1,00

# BƯỚC 2 — KL thô, dùng SIZING_STOP (không phải exit_stop)
risk_per_share = entry - sizing_stop
qty_raw = risk_budget / risk_per_share

# BƯỚC 3 — Bốn cửa hạn chế, lấy giá trị NHỎ NHẤT
qty_by_weight    = (NAV × P.max_weight_pct × weight_adj) / entry
qty_by_liquidity = (ADV_20 × 0,03) / entry           # tối đa 3% ADV
qty_by_cash      = available_cash / entry
qty_by_group     = remaining_group_budget / entry    # giới hạn nhóm sở hữu

qty = min(qty_raw, qty_by_weight, qty_by_liquidity, qty_by_cash, qty_by_group)

# BƯỚC 4 — Điều chỉnh riêng theo mã (chỉ SIẾT, không NỚI)
weight_adj = 1,0
if beta > 1,2                : weight_adj ×= 1,2 / beta
if max_floor_streak >= 3     : weight_adj ×= 0,60
if free_float_pct < 0,20     : weight_adj ×= 0,50
if cluster == C6             : weight_adj ×= 1,00   (đã nằm trong max_weight_pct 5%)

# BƯỚC 5 — Làm tròn xuống lô 100
qty = (qty // 100) × 100

# BƯỚC 6 — Cửa tối thiểu
if qty × entry < 10_000_000:            # dưới 10 triệu đồng
    → HUỶ TÍN HIỆU, lý do "vị thế quá nhỏ, chi phí ăn hết lợi nhuận"
```

## 7.2. Ví dụ đầy đủ

```
NAV                = 1.000.000.000 đ
Mã                 = VNM, sàn HOSE, nhóm C5 (phòng thủ)
regime             = UPTREND → regime_factor = 0,85
setup              = PB_MA20 → premium = +0,5%
C[T]               = 61.200
ATR_14             = 1.150      DATR_14 = 1.320   → ATR_ASYM = 1,15
structure_low      = 58.500
beta               = 0,72       max_floor_streak = 1      free_float = 45%
ADV_20             = 180 tỷ đ

── GIÁ VÀO LỆNH ──────────────────────────────────────────────
LO_raw   = 61.200 × 1,005 = 61.506
LO       = round_to_tick(61.506, HOSE) = 61.500      (bước 100)

── STOP ──────────────────────────────────────────────────────
atr_eff       = max(1.150, 1,3 × 1.320) = 1.716
exit_stop     = min(58.500 - 0,5×1.150,  61.500 × (1-0,07))
              = min(57.925, 57.195) = 57.195   → làm tròn 57.200  (-7,0%)
sizing_stop   = min(61.500 - 2,5×1.716,  61.500 × (1-0,0875))
              = min(57.210, 56.119) = 56.100                      (-8,8%)

── MỤC TIÊU ──────────────────────────────────────────────────
R        = 61.500 - 57.200 = 4.300
target_1 = 61.500 + 2,0 × 4.300 = 70.100      (+14,0%)
target_2 = 61.500 + 3,5 × 4.300 = 76.550 → 76.500   (+24,4%)
R:R      = 2,0 / 3,5
Kiểm tra R/ATR = 4.300/1.150 = 3,74 >= 0,8  ✓

── KHỐI LƯỢNG ────────────────────────────────────────────────
risk_budget      = 1.000.000.000 × 0,006 × 0,85 × 1,0 = 5.100.000
risk_per_share   = 61.500 - 56.100 = 5.400
qty_raw          = 5.100.000 / 5.400 = 944

weight_adj       = 1,0   (beta 0,72 < 1,2; floor_streak 1 < 3; float 45% > 20%)
qty_by_weight    = (1.000.000.000 × 0,15 × 1,0) / 61.500 = 2.439
qty_by_liquidity = (180.000.000.000 × 0,03) / 61.500 = 87.804
qty_by_cash      = giả định đủ tiền

qty = min(944, 2.439, 87.804) = 944  →  làm tròn lô 100  →  900 cp

── KẾT QUẢ ───────────────────────────────────────────────────
Giá trị vị thế     = 900 × 61.500 = 55.350.000 đ   = 5,5% NAV   ✓ < 15%
Rủi ro nếu exit_stop  = 900 × 4.300 = 3.870.000 đ  = 0,39% NAV
Rủi ro nếu bị khoá tới sizing_stop = 900 × 5.400 = 4.860.000 = 0,49% NAV
Rủi ro tối đa lý thuyết (3 phiên sàn) = 900 × 61.500 × 0,195 = 10.793.250 = 1,08% NAV
```

---

# §9 — THỜI ĐIỂM — VÒNG ĐỜI LỆNH

## 9.1. Timeline chuẩn

```
 Phiên  Giờ      Sự việc                                    Bán được?
──────────────────────────────────────────────────────────────────────
  T     15:15    Tải CafeF EOD, tính chỉ báo                     —
  T     15:45    Sinh tín hiệu → Telegram phiếu lệnh             —
  T     tối      BẠN duyệt / bỏ / sửa KL   (5–10 phút)           —
──────────────────────────────────────────────────────────────────────
 T+1    08:45    Job quét CBTT qua đêm + kiểm tra gap dự kiến     —
 T+1    09:00    ⭐ ĐẶT LỆNH LO — ĐÂY LÀ THỜI ĐIỂM MUA THẬT      ❌
 T+1    09:15    Phiên ATO kết thúc, biết khớp hay không          ❌
──────────────────────────────────────────────────────────────────────
 T+2    cả ngày  Nắm giữ, KHÔNG LÀM GÌ ĐƯỢC                       ❌
 T+3    13:00    Cổ phiếu về tài khoản (chậm nhất 13h)          ⚠️ chiều
 T+3    15:45    Sinh tín hiệu THOÁT (nếu có)                     —
──────────────────────────────────────────────────────────────────────
 T+4    09:00    Đặt lệnh bán → khớp                              ✅
──────────────────────────────────────────────────────────────────────

VÒNG QUAY TỐI THIỂU: 4 PHIÊN.  3 PHIÊN BỊ KHOÁ HOÀN TOÀN.
```

```python
def earliest_exit_index(entry_idx: int) -> int:
    """entry_idx = chỉ số phiên KHỚP MUA (T+1).
    Cổ phiếu về T+3 = entry_idx+2; tín hiệu thoát cuối T+3;
    đặt bán sáng T+4 = entry_idx+3.
    """
    return entry_idx + 3
```

## 9.2. Vì sao dùng LO thay vì ATO

Từ khi hệ thống KRX vận hành 5/5/2025, **lệnh ATO/ATC không còn được ưu tiên khớp trước lệnh LO** như cơ chế cũ. Đặt ATO nghĩa là nhận bất kỳ giá nào thị trường mở ra — đúng điều cần tránh khi có gap.

→ **Luôn dùng LO.** Có thể đặt lúc 09:05 sau khi thấy giá dự kiến khớp, thông tin còn tốt hơn.

## 9.3. Cửa kiểm tra gap sáng T+1 ⭐

Đây là cửa **thứ 8** — cửa duy nhất chạy vào sáng hôm sau, và là quy tắc giá trị cao nhất mà một hệ thống EOD có thể có.

```python
def gap_gate(signal, ref_price_or_open: float) -> tuple[str, float]:
    """Chạy 08:45–09:00 ngày T+1. Trả về (hành động, hệ số KL)."""
    gap = ref_price_or_open / signal.close_T - 1.0

    # Ngưỡng riêng theo mã: lấy chặt hơn giữa nhóm và lịch sử của chính mã
    max_gap = min(signal.params.max_gap_pct, signal.profile.gap_p90)

    if gap > max_gap:
        return "CANCEL", 0.0        # R:R đã bị phá vỡ, stop vẫn ở chỗ cũ
    if gap > max_gap × 0.5:
        return "REDUCE", 0.70       # giảm 30% khối lượng
    if gap < -0.020:
        return "REVIEW", 1.0        # kiểm tra CBTT qua đêm trước khi quyết
    return "PROCEED", 1.0
```

| Gap so với `C[T]` | Hành động |
|---|---|
| ≤ +1,0% | ✅ Đặt đúng phiếu lệnh |
| +1,0% → ngưỡng | ⚠️ Đặt nhưng **giảm 30% KL** |
| > ngưỡng (mặc định 2,0–3,0% theo nhóm) | ❌ **HUỶ LỆNH** |
| < −2,0% | 🔍 **RÀ SOÁT** — có tin xấu qua đêm không? |
| Mở cửa ở trần và giữ trần | ❌ **HUỶ** — không có ai bán |

---

# §10 — QUY TẮC THOÁT LỆNH

Phần thường bị bỏ qua nhưng quyết định phần lớn kết quả.

## 10.1. Bảy điều kiện thoát, xét theo thứ tự ưu tiên

```
Chạy 15:45 mỗi phiên cho mọi vị thế đang mở.
Nếu vị thế CHƯA qua earliest_exit_date → chỉ ghi nhận, không thể hành động.

Ưu tiên 1 — CỜ RỦI RO BẤT THƯỜNG TĂNG VỌT
    anomaly_risk_score >= 75  (hoặc tăng >= 25 điểm so với ngày vào lệnh)
    → THOÁT TOÀN BỘ ngay khi có thể. Không chờ stop.

Ưu tiên 2 — STOP THOÁT LỆNH BỊ XUYÊN
    C[t] <= exit_stop
    → THOÁT TOÀN BỘ sáng hôm sau

Ưu tiên 3 — TRẠNG THÁI THỊ TRƯỜNG CHUYỂN DOWNTREND
    regime == "DOWNTREND"
    → THOÁT TOÀN BỘ mọi vị thế, ưu tiên nhóm C3/C6 trước

Ưu tiên 4 — ĐẠT TARGET_1
    C[t] >= target_1  AND  chưa chốt phần nào
    → BÁN 50%, phần còn lại chuyển sang trailing stop

Ưu tiên 5 — TRAILING STOP BỊ XUYÊN  (chỉ sau khi đã chốt target_1)
    C[t] <= trailing_stop
    → THOÁT PHẦN CÒN LẠI

Ưu tiên 6 — TIME STOP
    số phiên nắm giữ >= P.hold_max  AND  lợi nhuận < 0,5R
    → THOÁT TOÀN BỘ. Vốn đang bị giam vô ích.

Ưu tiên 7 — LOGIC SETUP BỊ PHÁ VỠ
    Với setup pullback : C[t] < MA_50 × 0,97 trong 3 phiên liên tiếp
    Với setup trend    : MA_20 cắt xuống MA_50
    Với setup C3       : regime rời khỏi STRONG_UPTREND
    → THOÁT TOÀN BỘ
```

## 10.2. Xử lý trường hợp bị khoá

```
Nếu vị thế xuyên exit_stop NHƯNG chưa qua earliest_exit_date:

    → Ghi log "LOCKED_BREACH", tính mức lỗ đang chịu
    → Telegram cảnh báo: "VNM đã xuyên stop -7,2% nhưng chưa thể bán
       trước 10/09. Lỗ hiện tại 4,1 triệu (0,41% NAV)."
    → ❌ KHÔNG mua thêm bất kỳ mã nào cho tới khi giải quyết xong
    → ❌ KHÔNG bình quân giá xuống. Đây là quy tắc cứng.
    → Đặt lệnh bán ngay phiên đầu tiên có thể
```

Đây là lý do §7 tính KL theo `sizing_stop` rộng: để khi tình huống này xảy ra, lỗ vẫn nằm trong ngân sách rủi ro.

---

# §8 — TÍNH ĐIỂM VÀ XÁC SUẤT

## 8.1. Technical Score (0–100)

```
technical_score =
      25 × setup_quality
    + 20 × volume_confirmation
    + 20 × relative_strength_dual        ⭐ hiện thực hoá §0
    + 15 × trend_context
    + 10 × sector_strength
    + 10 × flow_confirmation
    -  ĐIỂM TRỪ RỦI RO
```

### Chi tiết từng thành phần (mỗi thành phần chuẩn hoá về [0, 1])

```python
# 1. setup_quality  (25 điểm)
#    Độ chuẩn của mẫu hình — mỗi setup có hàm riêng
#    PB_MA20: độ chặt của nền giá + chất lượng nến kích hoạt
setup_quality = 0.5 × tightness + 0.3 × candle_quality + 0.2 × n_extra_setups/2
    tightness      = 1 - clip((max(H,20)-min(L,20)) / MA_20 / 0.15, 0, 1)
    candle_quality = clip((C - L) / max(H - L, eps), 0, 1)

# 2. volume_confirmation  (20 điểm)
#    ⚠️ NGƯỢC DẤU giữa hai loại setup
if logic in (MEAN_REVERSION,):        # pullback: muốn KL GIẢM khi điều chỉnh
    volume_confirmation = clip(2 - VOL_RATIO_3, 0, 1)
else:                                  # trend/momentum: muốn KL TĂNG
    volume_confirmation = clip((VOL_RATIO - 1) / 1.5, 0, 1)

# 3. relative_strength_dual  (20 điểm)  ⭐ TRÁI TIM CỦA HỆ THỐNG
long_strength  = RS_126_RANK / 100                      # muốn CAO
if logic == MOMENTUM:
    short_state = RS_20_RANK / 100                      # C3: muốn CAO
else:
    short_state = 1 - RS_20_RANK / 100                  # còn lại: muốn THẤP
relative_strength_dual = 0.6 × long_strength + 0.4 × short_state

# 4. trend_context  (15 điểm)
trend_context = (
      0.35 × (1 if MA_20 > MA_50 > MA_200 else 0)
    + 0.30 × clip(MA_SLOPE_50 / 0.05, 0, 1)
    + 0.20 × clip((C/MA_200 - 1) / 0.20, 0, 1)
    + 0.15 × clip(ADX_14 / 35, 0, 1)
)

# 5. sector_strength  (10 điểm)
sector_strength = sector_rs_rank / 100

# 6. flow_confirmation  (10 điểm)  — từ file CCNN
flow_confirmation = (
      0.5 × clip(FNET_5 / (ADV_20 × 0.05), 0, 1)     # khối ngoại mua ròng
    + 0.3 × clip((OI_MA_10 + 1) / 2, 0, 1)           # mất cân bằng lệnh đặt
    + 0.2 × (1 if FNET_20 > 0 else 0)
)
# Nếu FNET_SENS < 0,2 (mã không nhạy dòng ngoại) → gán 0,5 trung tính

# ĐIỂM TRỪ RỦI RO
penalty = (
      12 × (anomaly_risk_score / 100)
    +  8 × clip((gap_p90 - 0.015) / 0.03, 0, 1)      # mã hay gap
    +  6 × (1 if max_floor_streak >= 3 else 0)
    +  6 × clip((DIST_MA_20 - 0.04) / 0.04, 0, 1)    # đã quá xa MA20
    +  5 × (1 if resistance_within(0.05) else 0)     # kháng cự quá gần
)

technical_score = clip(base_score - penalty, 0, 100)
```

## 8.2. Điều chỉnh thời vụ (áp cuối cùng)

```
if TET_WINDOW:   technical_score ×= 1.05     (5 phiên cuối trước Tết tích cực)
if POST_TET:     technical_score ×= 1.00     (⚠️ KHÔNG có hiệu ứng — không thưởng)
if MONTH == 1:   technical_score ×= 1.03     (hiệu ứng tháng Một)
```

## 8.3. Xác suất thắng (meta-model)

**Giai đoạn 1 — chưa có mô hình (tháng 1–6):** dùng hit rate thực nghiệm theo (setup × nhóm) từ backtest.

```
win_probability = hit_rate[setup][cluster]
Nếu số mẫu backtest < 30  →  win_probability = None, bỏ qua Cửa 5b
```

**Giai đoạn 2 — có meta-model:**

```
Gán nhãn : Triple-Barrier
    Rào trên  = entry + 2,0 × R
    Rào dưới  = exit_stop
    Rào ngang = P.hold_max phiên
    Nhãn = rào nào chạm trước (1 / 0 / 0)
    ⚠️ Mô phỏng ĐÚNG: vào lệnh tại open[T+1], không phải close[T]
    ⚠️ Áp ràng buộc 3 phiên bị khoá khi kiểm tra rào dưới

Đặc trưng: ~35 đặc trưng gồm toàn bộ §2 + cluster one-hot + regime one-hot
Mô hình  : LightGBM, max_depth=4, n_estimators=200, learning_rate=0,05
           (giữ đơn giản có chủ ý — chống overfitting)
Kiểm định: Purged K-Fold, embargo 10 phiên
Hiệu chuẩn: Isotonic regression để p là xác suất thật, không phải điểm số
Đầu ra   : p ∈ [0, 1]

Cửa 5b: p >= 0,55.  Dưới ngưỡng → HUỶ TÍN HIỆU
```

## 8.4. Xếp hạng và chọn lọc

```
1. Lọc: qua đủ 7 cửa
2. Xếp hạng: composite = 0,6 × (technical_score/100) + 0,4 × win_probability
3. Đa dạng hoá: tối đa 2 mã/nhóm hành vi, 2 mã/ngành trong cùng ngày
4. Lấy Top N, với N = min(3, số vị thế còn trống)
   → Tối đa 3 phiếu lệnh/ngày. Nhiều hơn là dấu hiệu ngưỡng quá lỏng.
```

---

# §11 — PHIẾU LỆNH ĐẦU RA

```
═══════════════════════════════════════════════════════════════
  PHIẾU LỆNH #1/2  ·  sinh 04/09 15:47  ·  ĐẶT SÁNG 07/09
═══════════════════════════════════════════════════════════════
  VNM  ·  Vinamilk  ·  Thực phẩm  ·  Nhóm C5 (phòng thủ)
  Setup: PB_MA20 (+ REV_SUP)     Score 79/100     p = 0,58
───────────────────────────────────────────────────────────────
  Đóng cửa 04/09 : 61.200
  ĐẶT LỆNH       : LO  MUA  61.500  ×  900 cp
  Giá trị        : 55.350.000 đ   ·   5,5% NAV
───────────────────────────────────────────────────────────────
  Cảnh báo bán   : 57.200   (−7,0%)   ← nhắc bán sáng hôm sau
  Chốt lời 1     : 70.100   (+14,0%)  ← bán 50%
  Chốt lời 2     : 76.500   (+24,4%)
  R:R            : 2,0 / 3,5
───────────────────────────────────────────────────────────────
  Rủi ro nếu stop hoạt động        : 3,87 tr  (0,39% NAV)
  Rủi ro nếu bị khoá tới 56.100    : 4,86 tr  (0,49% NAV)
  ⚠ Rủi ro đuôi 3 phiên sàn        : 10,79 tr (1,08% NAV)
───────────────────────────────────────────────────────────────
  ⏱  Mua 07/09  →  bán được sớm nhất sáng 10/09
     3 PHIÊN KHÔNG THỂ THOÁT VỊ THẾ
  🟢 Cờ rủi ro bất thường: 12/100
───────────────────────────────────────────────────────────────
  VÌ SAO MÃ NÀY:
    RS 6 tháng  : hạng 74/100  ✓ mạnh trung hạn
    RS 1 tháng  : hạng 28/100  ✓ quá bán ngắn hạn
    → Điều kiện kép ĐẠT: cổ phiếu tốt đang tạm bị bán quá
    KL 5 phiên  : 0,82× TB20   ✓ điều chỉnh lành mạnh, không phân phối
    Khối ngoại  : mua ròng 5 phiên +12,4 tỷ  ✓
    Xu hướng    : MA20 > MA50 > MA200, giá trên MA200 +8,3%  ✓
───────────────────────────────────────────────────────────────
  THỐNG KÊ LỊCH SỬ CỦA SETUP NÀY (PB_MA20 × C5):
    Fill rate         : 86%      Gap qua đêm TB : +0,3%
    Hit rate (OOS)    : 57%      Expectancy     : +0,38R
    Thua liên tiếp max: 6 lệnh   Nắm giữ TB     : 14 phiên
───────────────────────────────────────────────────────────────
  ⚠️ KIỂM TRA GAP SÁNG 07/09 TRƯỚC KHI BẤM:
     gap ≤ +1,0%        →  đặt bình thường 900 cp
     +1,0% → +1,5%      →  giảm còn 600 cp
     gap > +1,5%        →  ❌ BỎ LỆNH  (ngưỡng riêng của VNM)
     gap < −2,0%        →  🔍 kiểm tra CBTT qua đêm trước
═══════════════════════════════════════════════════════════════
  [ Đã đặt ]  [ Không khớp ]  [ Đã giảm KL ]  [ Bỏ qua ]
═══════════════════════════════════════════════════════════════
```

**Nút *Không khớp* rất quan trọng:** nó cho hệ thống học fill rate thực tế của từng setup, thay vì giả định lý thuyết.

---

# §12 — MÃ NGUỒN ENGINE

```python
# vnqd/signals/engine.py
"""Engine tín hiệu — hiện thực hoá đặc tả §3 đến §8.

Nguyên lý (§0): momentum trung hạn chọn MÃ NÀO,
                đảo chiều ngắn hạn chọn KHI NÀO.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum

import numpy as np
import polars as pl

from vnqd.config.cluster_params import ClusterParams, Logic, resolve_params
from vnqd.config.market_rules import PRICE_BAND, round_to_tick
from vnqd.features.clustering import Cluster
from vnqd.features.stock_profile import StockProfile

logger = logging.getLogger(__name__)


class Regime(StrEnum):
    STRONG_UPTREND = "STRONG_UPTREND"
    UPTREND = "UPTREND"
    SIDEWAY = "SIDEWAY"
    MILD_CORRECTION = "MILD_CORRECTION"
    DOWNTREND = "DOWNTREND"


REGIME_RANK = {
    Regime.DOWNTREND: 0, Regime.MILD_CORRECTION: 1, Regime.SIDEWAY: 2,
    Regime.UPTREND: 3, Regime.STRONG_UPTREND: 4,
}
REGIME_FACTOR = {
    Regime.STRONG_UPTREND: 1.00, Regime.UPTREND: 0.85, Regime.SIDEWAY: 0.65,
    Regime.MILD_CORRECTION: 0.40, Regime.DOWNTREND: 0.00,
}

# Premium theo setup (§5.2) — [D] cần hiệu chuẩn
SETUP_PREMIUM = {
    "PB_MA20": 0.005, "PB_MA50": 0.005, "REV_SUP": 0.005, "BB_LOWER": 0.005,
    "TREND_MA": 0.010, "RS_LEADER": 0.010, "MOM_20": 0.008, "VCP": 0.003,
}

MIN_POSITION_VND = 10_000_000
MIN_R_OVER_ATR = 0.8


@dataclass(slots=True)
class Signal:
    id: str
    generated_at: date
    symbol: str
    exchange: str
    cluster: Cluster
    setup: str
    extra_setups: list[str]

    close_T: float
    entry: float                # LO đặt sáng T+1
    exit_stop: float            # nhắc bán
    sizing_stop: float          # chỉ để tính KL
    target_1: float
    target_2: float
    qty: int

    technical_score: float
    win_probability: float | None
    risk_reward: float
    anomaly_score: float

    max_gap_pct: float
    earliest_exit_note: str
    reasons: dict = field(default_factory=dict)

    @property
    def notional(self) -> float:
        return self.qty * self.entry

    @property
    def risk_at_exit_stop(self) -> float:
        return self.qty * (self.entry - self.exit_stop)

    @property
    def risk_at_sizing_stop(self) -> float:
        return self.qty * (self.entry - self.sizing_stop)

    @property
    def tail_risk_3_floors(self) -> float:
        band = PRICE_BAND.get(self.exchange, 0.07)
        return self.notional * (1 - (1 - band) ** 3)


@dataclass(slots=True)
class Rejection:
    symbol: str
    gate: str
    reason: str


class SignalEngine:
    def __init__(
        self,
        *,
        nav: float,
        available_cash: float,
        risk_per_trade: float = 0.006,
        max_positions: int = 10,
        max_signals_per_day: int = 3,
    ) -> None:
        self.nav = nav
        self.cash = available_cash
        self.risk_per_trade = risk_per_trade
        self.max_positions = max_positions
        self.max_signals_per_day = max_signals_per_day
        self.rejections: list[Rejection] = []

    # ─────────────────────────── CỬA 0 ───────────────────────────
    @staticmethod
    def compute_regime(vni: dict, ew: dict, breadth: dict) -> Regime:
        def sc(ix: dict) -> int:
            return int((ix["close"] > ix["ma50"]) + (ix["close"] > ix["ma200"])
                       + (ix["ma50"] > ix["ma200"]))

        # Phân kỳ giữa VN-Index và VN100_EW → lấy cái thấp hơn (bảo thủ)
        s = min(sc(vni), sc(ew))
        b50 = breadth["pct_above_ma50"]

        if s == 3 and b50 >= 0.60 and breadth["ad_line_slope_10"] > 0:
            return Regime.STRONG_UPTREND
        if s >= 2 and b50 >= 0.45:
            return Regime.UPTREND
        if s >= 1 and b50 >= 0.35:
            return Regime.SIDEWAY
        if s >= 1 or b50 >= 0.25:
            return Regime.MILD_CORRECTION
        return Regime.DOWNTREND

    # ─────────────────────── PIPELINE CHÍNH ──────────────────────
    def run(
        self,
        as_of: date,
        regime: Regime,
        candidates: list[dict],      # mỗi dict: symbol, feats, profile, cluster, ...
        portfolio: dict,
    ) -> list[Signal]:
        self.rejections.clear()

        # CỬA 0 — chặn toàn bộ nếu thị trường xấu (Quy tắc R2)
        if regime is Regime.DOWNTREND:
            logger.warning("Regime = DOWNTREND → không sinh tín hiệu (Quy tắc R2)")
            return []

        signals: list[Signal] = []
        for cand in candidates:
            try:
                sig = self._evaluate(as_of, regime, cand, portfolio)
                if sig is not None:
                    signals.append(sig)
            except Exception:
                logger.exception("Lỗi khi đánh giá %s", cand.get("symbol"))

        return self._rank_and_select(signals, portfolio)

    def _reject(self, symbol: str, gate: str, reason: str) -> None:
        self.rejections.append(Rejection(symbol, gate, reason))

    def _evaluate(
        self, as_of: date, regime: Regime, c: dict, portfolio: dict
    ) -> Signal | None:
        sym: str = c["symbol"]
        f: dict = c["feats"]
        prof: StockProfile = c["profile"]
        cluster: Cluster = c["cluster"]
        P: ClusterParams = resolve_params(cluster, prof)

        # ── CỬA 1: universe ──
        if cluster is Cluster.EXCLUDED:
            return self._reject(sym, "G1", "cluster = EXCLUDED") or None
        if f["n_obs"] < 280:
            return self._reject(sym, "G1", f"chỉ {f['n_obs']} phiên < 280") or None
        if prof.adv20_bn < 20.0:
            return self._reject(sym, "G1", f"ADV {prof.adv20_bn:.0f} tỷ < 20") or None
        if c.get("warning_status"):
            return self._reject(sym, "G1", f"diện {c['warning_status']}") or None

        # ── CỬA 2: cờ rủi ro bất thường ──
        anomaly = c["anomaly_score"]
        if anomaly >= P.max_anomaly_score:
            return self._reject(
                sym, "G2", f"anomaly {anomaly:.0f} >= {P.max_anomaly_score}") or None

        # ── CỬA 3: nhóm ↔ trạng thái thị trường ──
        if REGIME_RANK[regime] < REGIME_RANK[Regime(P.min_regime.upper())]:
            return self._reject(
                sym, "G3", f"{cluster} cần >= {P.min_regime}, hiện {regime}") or None
        if P.require_exogenous and not c.get("exogenous_ok", False):
            return self._reject(sym, "G3", f"chưa thoả {P.require_exogenous}") or None

        # ── CỬA 4a: ĐIỀU KIỆN KÉP (§0) ⭐ ──
        if f["rs_126_rank"] < 60:
            return self._reject(
                sym, "G4a", f"RS_126 hạng {f['rs_126_rank']:.0f} < 60") or None

        if P.logic is Logic.MOMENTUM:
            if f["rs_20_rank"] < 65:
                return self._reject(
                    sym, "G4a", f"momentum cần RS_20 >= 65, có {f['rs_20_rank']:.0f}"
                ) or None
        else:
            if f["rs_20_rank"] > 40:
                return self._reject(
                    sym, "G4a",
                    f"mua-khi-yếu cần RS_20 <= 40, có {f['rs_20_rank']:.0f}"
                ) or None

        # ── CỬA 4b: setup ──
        from vnqd.signals.setups import detect_setups
        hits = detect_setups(f, cluster, P)
        if not hits:
            return self._reject(sym, "G4b", "không setup nào khớp") or None
        if f["vol_ratio"] < P.min_volume_ratio:
            return self._reject(
                sym, "G4b",
                f"VOL_RATIO {f['vol_ratio']:.2f} < {P.min_volume_ratio}") or None

        primary, extras = hits[0], hits[1:]

        # ── §5: giá vào lệnh ──
        exch = c["exchange"]
        premium = SETUP_PREMIUM[primary]
        entry = round_to_tick(f["close"] * (1 + premium), exch)

        band = PRICE_BAND.get(exch, 0.07)
        ceiling = round_to_tick(f["close"] * (1 + band), exch)
        if entry >= ceiling * 0.995:
            return self._reject(sym, "G5", "giá LO chạm trần") or None

        # ── §6: hai stop ──
        atr, datr = f["atr_14"], f["datr_14"]
        atr_eff = max(atr, 1.3 * datr)          # hiệu ứng đòn bẩy

        exit_stop = round_to_tick(min(
            f["structure_low"] - 0.5 * atr,
            entry * (1 - P.max_stop_pct),
        ), exch)
        sizing_stop = round_to_tick(min(
            entry - P.atr_mult * atr_eff,
            entry * (1 - P.max_stop_pct * 1.25),
        ), exch)

        R = entry - exit_stop
        if R <= 0:
            return self._reject(sym, "G5", "R <= 0, cấu trúc giá không hợp lệ") or None
        if R / atr < MIN_R_OVER_ATR:
            return self._reject(
                sym, "G5", f"R/ATR = {R/atr:.2f} < {MIN_R_OVER_ATR}") or None

        target_1 = round_to_tick(entry + 2.0 * R, exch)
        target_2 = round_to_tick(entry + 3.5 * R, exch)

        resistance = f["resistance_60"]
        if target_1 > resistance * 1.02 and resistance < entry * 1.15:
            return self._reject(sym, "G5", "mục tiêu bị chắn bởi kháng cự gần") or None

        # ── CỬA 5: điểm và xác suất ──
        from vnqd.signals.scoring import technical_score, win_probability
        score = technical_score(f, prof, P, primary, extras, anomaly)
        if score < 60:
            return self._reject(sym, "G5", f"score {score:.0f} < 60") or None

        p = win_probability(f, cluster, primary)
        if p is not None and p < 0.55:
            return self._reject(sym, "G5", f"p = {p:.2f} < 0,55") or None

        # ── §7: khối lượng ──
        qty = self._position_size(entry, sizing_stop, prof, P, regime, f, portfolio)
        if qty * entry < MIN_POSITION_VND:
            return self._reject(
                sym, "G6", f"vị thế {qty*entry/1e6:.1f} tr quá nhỏ") or None

        # ── CỬA 6: ràng buộc danh mục ──
        ok, why = self._portfolio_ok(sym, cluster, c, qty * entry, R * qty, portfolio)
        if not ok:
            return self._reject(sym, "G6", why) or None

        return Signal(
            id=str(uuid.uuid4())[:8],
            generated_at=as_of, symbol=sym, exchange=exch,
            cluster=cluster, setup=primary, extra_setups=extras,
            close_T=f["close"], entry=entry,
            exit_stop=exit_stop, sizing_stop=sizing_stop,
            target_1=target_1, target_2=target_2, qty=qty,
            technical_score=score, win_probability=p,
            risk_reward=(target_1 - entry) / R, anomaly_score=anomaly,
            max_gap_pct=min(P.max_gap_pct, prof.gap_p90),
            earliest_exit_note="Mua T+1 → bán được sớm nhất T+4 (3 phiên bị khoá)",
            reasons={
                "rs_126_rank": round(f["rs_126_rank"], 1),
                "rs_20_rank": round(f["rs_20_rank"], 1),
                "vol_ratio_3": round(f["vol_ratio_3"], 2),
                "fnet_5_bn": round(f["fnet_5"] / 1e9, 1),
                "dist_ma200": round(f["dist_ma_200"], 3),
                "atr_asym": round(datr / atr, 2) if atr > 0 else None,
            },
        )

    # ─────────────────────────── §7 ──────────────────────────────
    def _position_size(
        self, entry: float, sizing_stop: float, prof: StockProfile,
        P: ClusterParams, regime: Regime, f: dict, portfolio: dict,
    ) -> int:
        seasonal = 1.10 if f.get("tet_window") else 1.00
        risk_budget = self.nav * self.risk_per_trade * REGIME_FACTOR[regime] * seasonal

        risk_per_share = entry - sizing_stop
        if risk_per_share <= 0:
            return 0
        qty_raw = risk_budget / risk_per_share

        # Tầng 3 — chỉ SIẾT, không NỚI
        adj = 1.0
        if prof.beta > 1.2:
            adj *= 1.2 / prof.beta
        if prof.max_floor_streak >= 3:
            adj *= 0.60
        if (ff := f.get("free_float_pct")) and ff < 0.20:
            adj *= 0.50

        qty_weight = (self.nav * P.max_weight_pct * adj) / entry
        qty_liq = (prof.adv20_bn * 1e9 * 0.03) / entry
        qty_cash = self.cash / entry
        qty_group = portfolio.get("group_budget", {}).get(
            f.get("owner_group", ""), float("inf")) / entry

        qty = min(qty_raw, qty_weight, qty_liq, qty_cash, qty_group)
        return int(max(qty, 0) // 100) * 100

    # ─────────────────────────── CỬA 6 ───────────────────────────
    def _portfolio_ok(
        self, sym: str, cluster: Cluster, c: dict,
        notional: float, risk: float, pf: dict,
    ) -> tuple[bool, str]:
        if sym in pf.get("holdings", {}):
            return False, "đã nắm giữ mã này"
        if len(pf.get("holdings", {})) >= self.max_positions:
            return False, f"đã đủ {self.max_positions} vị thế"

        sector = c.get("sector", "")
        if (pf.get("sector_weight", {}).get(sector, 0) + notional / self.nav) > 0.35:
            return False, f"ngành {sector} vượt 35%"

        grp = c.get("owner_group")
        if grp:
            cap = pf.get("group_cap", {}).get(grp, 0.15)
            if (pf.get("group_weight", {}).get(grp, 0) + notional / self.nav) > cap:
                return False, f"nhóm sở hữu {grp} vượt {cap:.0%}"

        n_cluster = pf.get("cluster_count", {}).get(cluster, 0)
        if cluster is Cluster.C2_BANK and n_cluster >= 2:
            return False, "đã có 2 mã ngân hàng (tương quan trong nhóm quá cao)"
        if cluster is Cluster.C6_VOLATILE_MID and n_cluster >= 1:
            return False, "đã có 1 mã nhóm C6"

        if pf.get("total_open_risk", 0.0) + risk / self.nav > 0.05:
            return False, "tổng rủi ro mở vượt 5% NAV"
        if notional > self.cash:
            return False, "không đủ tiền"

        return True, ""

    # ─────────────────────────── §8.4 ────────────────────────────
    def _rank_and_select(
        self, signals: list[Signal], pf: dict
    ) -> list[Signal]:
        def composite(s: Signal) -> float:
            p = s.win_probability if s.win_probability is not None else 0.55
            return 0.6 * (s.technical_score / 100) + 0.4 * p

        signals.sort(key=composite, reverse=True)

        selected: list[Signal] = []
        seen_cluster: dict[Cluster, int] = {}
        seen_sector: dict[str, int] = {}
        slots = min(
            self.max_signals_per_day,
            self.max_positions - len(pf.get("holdings", {})),
        )

        for s in signals:
            if len(selected) >= slots:
                break
            if seen_cluster.get(s.cluster, 0) >= 2:
                continue
            sec = s.reasons.get("sector", "")
            if seen_sector.get(sec, 0) >= 2:
                continue
            selected.append(s)
            seen_cluster[s.cluster] = seen_cluster.get(s.cluster, 0) + 1
            seen_sector[sec] = seen_sector.get(sec, 0) + 1

        logger.info(
            "Sinh %d tín hiệu từ %d ứng viên, loại %d",
            len(selected), len(signals) + len(self.rejections), len(self.rejections),
        )
        return selected
```

---

# §13 — SỔ ĐĂNG KÝ THAM SỐ

Mọi con số trong hệ thống phải có mặt ở đây. Không hardcode rải rác (Quy tắc R5).

**Phân loại:**
- `[S]` **STRUCTURAL** — cố định bởi quy định thị trường. **Không bao giờ thay đổi.**
- `[M]` **MEASURED** — đo từ dữ liệu về mã đó. Không tối ưu ⇒ an toàn khỏi overfitting.
- `[D]` **DEFAULT** — giá trị khởi điểm, **PHẢI hiệu chuẩn** qua §14.
- `[A]` **ACADEMIC** — dựa trên bằng chứng học thuật, ưu tiên giữ nguyên.

| Loại | Tham số | Giá trị | Nguồn |
|:---:|---|---|---|
| `[S]` | Biên độ HOSE / HNX / UPCOM | 7% / 10% / 15% | Quy định HOSE, HNX |
| `[S]` | Bước giá HOSE | 10 / 50 / 100 đ | Quy định HOSE |
| `[S]` | Lô giao dịch | 100 cp | Quy định |
| `[S]` | Chu kỳ thanh toán | T+2, về chậm nhất 13h | VSDC |
| `[S]` | `earliest_exit_index` | `entry_idx + 3` | Suy ra từ T+2 + EOD |
| `[S]` | Rủi ro đuôi 3 phiên sàn | `1-(1-band)³` = 19,5% HOSE | Suy ra từ biên độ |
| `[S]` | Ưu tiên LO thay ATO | — | KRX từ 5/5/2025 bỏ ưu tiên ATO/ATC |
| `[A]` | `RS_126` — cửa sổ momentum | 126 phiên (6 tháng) | Vo & Truong (2018): hình thành 6 tháng |
| `[A]` | `RS_20` — cửa sổ đảo chiều | 20 phiên (1 tháng) | Đảo chiều mạnh nhất ở chân trời 1 tháng |
| `[A]` | `hold_max` mean-reversion | ≤ 60 phiên (3 tháng) | Hiệu ứng đảo chiều biến mất ở tháng thứ 3 |
| `[A]` | `MOM_252_21` bỏ 1 tháng cuối | 21 phiên | Tránh nhiễu đảo chiều ngắn hạn |
| `[A]` | Chỉ C3 dùng momentum | — | Momentum ngắn hạn kém sau kiểm soát rủi ro |
| `[A]` | Chặn tín hiệu khi DOWNTREND | — | Bầy đàn mạnh hơn khi thị trường giảm |
| `[A]` | `DATR` thay `ATR` khi asym > 1,3 | 1,3× | Cú sốc âm gây biến động lớn hơn cú sốc dương |
| `[A]` | `TET_WINDOW` thưởng điểm | 1,05× | 5 phiên trước Tết có suất sinh lợi cao hơn |
| `[A]` | `POST_TET` **không** thưởng | 1,00× | Hiệu ứng không lan sang ngày sau Tết |
| `[M]` | `beta`, `ATR_ASYM`, `gap_p90` | tính từ 250 phiên | Đo, không tối ưu |
| `[M]` | `max_floor_streak` | lịch sử đầy đủ | Rủi ro đuôi thật đã xảy ra |
| `[M]` | `ADV_20`, `free_float_pct` | tính / báo cáo quản trị | |
| `[M]` | `VR_5`, `hurst` | 250 phiên | Quyết định phân nhóm |
| `[D]` | `RS_126_RANK` tối thiểu | **60** | Cửa 4a |
| `[D]` | `RS_20_RANK` tối đa (mua-khi-yếu) | **40** | Cửa 4a |
| `[D]` | `RS_20_RANK` tối thiểu (momentum) | **65** | Cửa 4a |
| `[D]` | `technical_score` tối thiểu | **60** | Cửa 5 |
| `[D]` | `win_probability` tối thiểu | **0,55** | Cửa 5 |
| `[D]` | `risk_reward` tối thiểu | **2,0** | Cửa 5 |
| `[D]` | `R/ATR` tối thiểu | **0,8** | Chống stop trong vùng nhiễu |
| `[D]` | `risk_per_trade` | **0,4–0,7% NAV** | §7 |
| `[D]` | Tổng rủi ro mở tối đa | **5% NAV** | Cửa 6 |
| `[D]` | Số vị thế tối đa | **10** | Cửa 6 |
| `[D]` | Tín hiệu tối đa/ngày | **3** | §8.4 |
| `[D]` | Tỷ trọng ngành tối đa | **35%** | Cửa 6 |
| `[D]` | Tỷ trọng nhóm sở hữu | **Vingroup 15%, Masan 12%, TCB 12%** | Học theo giới hạn 15% nhóm liên quan của HOSE |
| `[D]` | Tối đa mã cùng nhóm C2 | **2** | Tương quan ngân hàng rất cao |
| `[D]` | Tối đa mã nhóm C6 | **1** | Rủi ro cao nhất |
| `[D]` | ADV tối thiểu | **20 tỷ đ** | Cửa 1 |
| `[D]` | % ADV tối đa khi vào lệnh | **3%** | §7 |
| `[D]` | Vị thế tối thiểu | **10 tr đ** | §7 |
| `[D]` | `target_1` / `target_2` | **2,0R / 3,5R** | §6.2 |
| `[D]` | Trailing Chandelier | **3,0 × ATR_22** | §6.3 |
| `[D]` | Premium theo setup | **0,3% – 1,0%** | §5.2 |
| `[D]` | `atr_mult` theo nhóm | **2,5 – 4,0** | §13 bảng nhóm |
| `[D]` | `max_stop_pct` theo nhóm | **7% – 12%** | §13 bảng nhóm |
| `[D]` | `max_gap_pct` theo nhóm | **1,5% – 3,0%** | §9.3 |
| `[D]` | `max_anomaly_score` theo nhóm | **40 – 60** | Cửa 2 |
| `[D]` | Ngưỡng regime `pct_above_ma50` | **0,60 / 0,45 / 0,35 / 0,25** | §3.1 |
| `[D]` | `regime_factor` | **1,00 / 0,85 / 0,65 / 0,40 / 0** | §7 |
| `[D]` | Trọng số `technical_score` | **25/20/20/15/10/10** | §8.1 |

## 13.1. Bảng tham số theo nhóm (trích từ Nghiên cứu v3.0)

| Tham số | C1 Trụ | C2 NH | C3 Beta cao | C4 HH | C5 PT | C6 Mid |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Logic | Mixed | Mean-rev | **Momentum** | Trend | **Mean-rev** | Mean-rev |
| MA xu hướng | 50/200 | 50/200 | 20/50 | 50/200 | 100/200 | 50/200 |
| Kỳ RSI | 14 | 14 | 9 | 14 | 21 | 14 |
| RSI mua | <45 | <42 | >55 | <45 | **<35** | <40 |
| `atr_mult` | 3,0 | 3,0 | **4,0** | 3,5 | **2,5** | **4,0** |
| `max_stop_pct` | 9% | 9% | **12%** | 10% | **7%** | **12%** |
| `hold_min–max` | 15–30 | 10–25 | 8–20 | 20–40 | 10–20 | 8–15 |
| `max_weight_pct` | 12% | 10% | 8% | 10% | **15%** | **5%** |
| `max_gap_pct` | 2,0% | 2,0% | 3,0% | 2,5% | **1,5%** | 2,0% |
| `max_anomaly` | 55 | 55 | 50 | 55 | 60 | **40** |
| `min_volume_ratio` | 1,3 | 1,3 | 1,5 | 1,3 | 1,1 | 1,5 |
| `min_regime` | SIDEWAY | SIDEWAY | **STRONG** | SIDEWAY | MILD_CORR | **STRONG** |
| Chỉ số tham chiếu | VN100_EW | VN-Index | VN-Index | VN100_EW | VN100_EW | VN100_EW |
| Biến ngoại sinh | — | Chỉ số NH | Thanh khoản TT | **Giá HH** | — | — |

---

# §14 — GIAO THỨC HIỆU CHUẨN

## 14.1. Thứ tự bắt buộc

```
❌ SAI:  viết engine tín hiệu → backtest sau
✅ ĐÚNG: viết engine backtest → rồi mới viết engine tín hiệu

Vì mọi tham số [D] trong §13 chỉ là con số đặt ra ban đầu.
Không có backtest, chúng chỉ là ý kiến.
```

## 14.2. Walk-forward theo nhóm, không theo mã

```
Cửa sổ: train 3 năm → validate 1 năm → test 1 năm → trượt 1 năm

QUY TẮC:
  • Hiệu chuẩn POOLED trên toàn bộ mã trong nhóm
    → 1 bộ tham số cho ~15-25 mã, KHÔNG phải 1 bộ mỗi mã
  • Phân nhóm chỉ dùng dữ liệu tới cuối kỳ train (chống look-ahead)
  • Tối đa 4 tham số [D]/nhóm mỗi lần hiệu chuẩn
  • Purged K-Fold + embargo 10 phiên khi dùng triple-barrier
  • Mô phỏng ĐÚNG: entry = open[T+1] hoặc LO khớp T+1, KHÔNG PHẢI close[T]
  • Áp ràng buộc 3 phiên bị khoá
```

## 14.3. Năm cửa kiểm tra trước khi tin một bộ tham số

| Cửa | Kiểm tra | Đạt |
|:---:|---|---|
| **1** | Deflated Sharpe Ratio | > 0,7 |
| **2** | Probability of Backtest Overfitting | < 0,4 |
| **3** | Độ bền qua chế độ: 2018, 2020, 2021, 2022, 2023–26 | Sharpe > 0 ở ≥ 4/5 |
| **4** | Chất lượng khớp lệnh EOD | Fill rate ≥ 70% **và** gap qua đêm TB ≤ 1,5% |
| **5** | ⭐ **Kiểm định placebo** — gán nhóm ngẫu nhiên | Nhóm thật phải hơn nhóm ngẫu nhiên ≥ 0,2 Sharpe |

**Trượt bất kỳ cửa nào ⇒ loại bộ tham số, quay về giá trị mặc định §13.** Không "chỉnh một chút cho qua".

**Cửa 5 phải chạy TRƯỚC TIÊN.** Nếu nhóm ngẫu nhiên cho kết quả tương đương nhóm thật, toàn bộ hệ thống phân nhóm là ảo giác — hãy dùng **một bộ tham số chung** cho tất cả. Đơn giản hơn, bền hơn, trung thực hơn. Mất 1 ngày, tiết kiệm 2 tháng.

## 14.4. Chỉ số theo dõi hằng tháng

| Chỉ số | Ngưỡng báo động |
|---|---|
| Fill rate thực tế vs backtest | Lệch > 15 điểm % ⇒ mô hình khớp lệnh sai |
| Gap qua đêm thực tế vs backtest | Lệch > 0,5 điểm % ⇒ xem lại premium |
| Hit rate 20 lệnh gần nhất | < 45% ⇒ tạm dừng, rà soát |
| Chuỗi thua liên tiếp | > 9 lệnh ⇒ dừng hẳn, hiệu chuẩn lại |
| Độ ổn định phân nhóm qua quý | < 60% ⇒ phân nhóm đang bắt nhiễu |
| Số tín hiệu/tháng | > 15 ⇒ ngưỡng quá lỏng · < 3 ⇒ quá chặt |
| Khoảng cách hành vi (nhật ký) | Lệch > 20% giữa hệ thống và thực tế ⇒ vấn đề kỷ luật |

## 14.5. Kỳ vọng thực tế

| Chỉ tiêu | Khả thi | Đáng ngờ | Chắc chắn ảo |
|---|:---:|:---:|:---:|
| Hit rate | 52–58% | 60–65% | > 70% |
| Expectancy | +0,25 → +0,45R | +0,6R | > +1,0R |
| Sharpe sau chi phí | 0,8–1,4 | 1,8 | > 2,5 |
| Max drawdown | 15–25% | 10% | < 8% |
| Thua liên tiếp | 6–9 lệnh | — | "chưa từng thua 3 liền" |

```
Với hit rate 55%, expectancy +0,35R, 40 lệnh/năm, rủi ro 0,6% NAV/lệnh:
    Alpha kỳ vọng = 40 × 0,35 × 0,6% = +8,4% NAV/năm
```

Khiêm tốn, nhưng là alpha trên nền tảng đã kiểm chứng. Nghiên cứu trên chính rổ VN30 kết luận thị trường không thể hiện những điểm không hiệu quả lộ liễu, nhưng với một số cổ phiếu và đặc biệt là danh mục, một hệ thống tương đối đơn giản dùng trend-following cho suất sinh lợi điều chỉnh rủi ro hấp dẫn — kèm ràng buộc rằng khối lượng giao dịch khả thi chỉ ở mức tương đối nhỏ. Ràng buộc cuối giết chiến lược của tổ chức nhưng không ảnh hưởng tới tài khoản cá nhân.

---

# PHỤ LỤC A — THỨ TỰ TRIỂN KHAI

```
Tuần 1–2   §1 Hợp đồng dữ liệu + §2 Tầng chỉ báo
           → Kiểm chứng: tính đúng 40 chỉ báo cho 30 mã VN30

Tuần 3     §3.1 Trạng thái thị trường + VN100_EW
           → Kiểm chứng: vẽ regime 2018–2026, đối chiếu bằng mắt với các
             đợt sụp đổ đã biết. Regime có bắt được 2022 không?

Tuần 4–6   ⭐ ENGINE BACKTEST TRƯỚC  (§14, mô phỏng T+1 + 3 phiên khoá)
           → Kiểm chứng: so CAGR khi entry=close[T] vs entry=open[T+1]
             Khoảng cách đó là số tiền ảo mà backtest sai tạo ra

Tuần 7     §13 Sổ đăng ký + phân nhóm + ⭐ KIỂM ĐỊNH PLACEBO (§14.3 cửa 5)
           → Nếu trượt: bỏ phân nhóm, dùng 1 bộ tham số chung, tiết kiệm 2 tháng

Tuần 8–10  §4 Setup + §5 Giá + §6 Stop + §7 Sizing
           → Kiểm chứng: 5 tín hiệu mẫu, tính tay đối chiếu với code

Tuần 11–12 §8 Điểm số + §10 Thoát lệnh + §11 Phiếu lệnh + Telegram
           → ✅ Module hoàn chỉnh, chạy song song không tiền thật 1 tháng

Tuần 13–16 §8.3 Meta-model (chỉ sau khi đã có >= 200 tín hiệu lịch sử)
```

---

> ## ⚠️ TUYÊN BỐ MIỄN TRỪ TRÁCH NHIỆM
>
> Tài liệu này là **đặc tả kỹ thuật cho một module phần mềm cá nhân**, phục vụ mục đích nghiên cứu và học tập. Đây **không phải** khuyến nghị đầu tư, **không phải** tư vấn pháp lý, và **không phải** hệ thống đã được kiểm chứng.
>
> **Toàn bộ tham số nhóm `[D]` trong §13 là giá trị khởi điểm chưa hiệu chuẩn.** Chúng phải đi qua đầy đủ 5 cửa kiểm tra ở §14.3 trước khi được tin dùng với tiền thật. Các tham số nhóm `[A]` dựa trên nghiên cứu học thuật từ những giai đoạn dữ liệu cụ thể trong quá khứ (phần lớn 2007–2020) và **có thể không còn hiệu lực** sau khi hệ thống KRX vận hành và thị trường được FTSE nâng hạng.
>
> Các mã chứng khoán xuất hiện trong tài liệu chỉ là **ví dụ minh hoạ cách tính toán**, không phải khuyến nghị mua bán.
>
> Module này được thiết kế cho **sử dụng cá nhân, tự vận hành trên thiết bị của chính người dùng**. Việc công bố hoặc bán đầu ra dưới hình thức khuyến nghị mua/bán chứng khoán cho người khác có thể cấu thành hoạt động kinh doanh chứng khoán chưa được cấp phép, bị nghiêm cấm theo khoản 4 Điều 12 Luật Chứng khoán, và có thể vi phạm điều khoản dịch vụ dữ liệu của các nhà cung cấp.
>
> **Kết quả trong quá khứ không đảm bảo kết quả trong tương lai.** Đầu tư chứng khoán luôn tiềm ẩn rủi ro mất vốn. Với phong cách EOD kết hợp chu kỳ T+2, rủi ro **3 phiên không thể thoát vị thế** là thật và có thể lên tới −19,5% trên HOSE trong trường hợp xấu nhất.
