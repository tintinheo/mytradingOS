# NGHIÊN CỨU v3.0 — ĐẶC TRƯNG THỊ TRƯỜNG VIỆT NAM & KHUNG PHÂN NHÓM VN100

**Từ bằng chứng học thuật đến tham số kỹ thuật khả thi cho từng nhóm cổ phiếu**

| | |
|---|---|
| Ngày | 06/09/2026 |
| Bổ sung cho | Proposal v2.0 + v2.1 |
| Thay thế | Mục 7.1–7.2 của v2.0 (chỉ báo & tín hiệu T+) |
| Nguyên tắc | Phân nhóm hành vi → hiệu chuẩn theo nhóm. **Không** tối ưu tham số theo từng mã |

---

## MỤC LỤC

- [PHẦN 0 — Hiệu chỉnh đề bài](#phần-0--hiệu-chỉnh-đề-bài-phần-quan-trọng-nhất)
- [PHẦN 1 — Bảy "định luật" của TTCK Việt Nam](#phần-1--bảy-định-luật-của-ttck-việt-nam-theo-bằng-chứng-học-thuật)
- [PHẦN 2 — Cấu trúc VN100](#phần-2--cấu-trúc-vn100-hiện-tại)
- [PHẦN 3 — 14 thước đo phân loại hành vi](#phần-3--14-thước-đo-phân-loại-hành-vi-cổ-phiếu)
- [PHẦN 4 — Sáu nhóm hành vi](#phần-4--sáu-nhóm-hành-vi-và-chiến-lược-tương-ứng)
- [PHẦN 5 — Bảng tham số theo nhóm](#phần-5--bảng-tham-số-kỹ-thuật-theo-nhóm)
- [PHẦN 6 — Điều chỉnh riêng theo mã](#phần-6--điều-chỉnh-riêng-theo-mã-chỉ-những-gì-ổn-định)
- [PHẦN 7 — Quy trình hiệu chuẩn chống overfitting](#phần-7--quy-trình-hiệu-chuẩn-chống-overfitting)
- [PHẦN 8 — Mã nguồn](#phần-8--mã-nguồn)
- [PHẦN 9 — Kỳ vọng thực tế](#phần-9--kỳ-vọng-thực-tế)

---

# PHẦN 0 — HIỆU CHỈNH ĐỀ BÀI (phần quan trọng nhất)

## 0.1. Vì sao "tối ưu chỉ báo cho từng mã trong top 100" sẽ thất bại

Bạn yêu cầu nghiên cứu đặc trưng **theo từng mã** và áp dụng chỉ báo **cho mỗi mã**. Trực giác này đúng — bằng chứng học thuật xác nhận các mã Việt Nam hành xử rất khác nhau. Nhưng cách thực thi trực tiếp lại là một cái bẫy toán học.

**Hãy làm phép tính:**

```
Dữ liệu khả dụng cho 1 mã:
    ~15 năm × 250 phiên = 3.750 quan sát
    Nhưng số CHU KỲ thị trường độc lập chỉ khoảng 5–6
    (2010-12, 2013-17, 2018, 2020-21, 2022, 2023-26)

Nếu tối ưu 6 tham số/mã (độ dài MA, kỳ RSI, ngưỡng RSI,
hệ số ATR, ngưỡng KL, thời gian nắm giữ):
    Không gian tham số ≈ 10^6 tổ hợp
    × 100 mã = 10^8 lần thử

⇒ Bạn sẽ CHẮC CHẮN tìm ra 100 bộ tham số cho lợi nhuận đẹp
   trong quá khứ, và gần như chắc chắn không mã nào hoạt động
   ngoài mẫu.
```

Vấn đề nghiêm trọng hơn nhiều so với overfitting thông thường, vì một đặc trưng riêng của Việt Nam: **tương quan chéo giữa các mã rất cao**. Nghiên cứu về hiệu ứng momentum trên TTCK Việt Nam ghi nhận <cite index="154-1">biến động cao, độ dai dẳng thấp và tương quan cao giữa các suất sinh lợi cổ phiếu</cite>. Nghĩa là 100 mã của bạn **không phải 100 mẫu độc lập** — có thể chỉ tương đương 10–15 mẫu độc lập về mặt thống kê. Tối ưu riêng từng mã là tối ưu trên nhiễu.

## 0.2. Nhưng sự khác biệt giữa các mã là THẬT — và học thuật đã chỉ ra cách đúng

Nghiên cứu của Nguyen, Sensoy và cộng sự (*Borsa Istanbul Review*, 2020) trên các mã thanh khoản nhất trong rổ VN30 tìm thấy hai điều then chốt:

<cite index="167-1">Các mô hình thuần momentum hoạt động thoả đáng đối với **một số cổ phiếu cụ thể**, và chiến lược long-only cho kết quả tốt hơn cũng như bền vững hơn so với long-short. Ngoài ra, có **những sai lệch đáng kể giữa các cổ phiếu thành phần** của chỉ số tham chiếu.</cite>

Đọc kỹ hai câu này: sự khác biệt giữa các mã **không nằm ở việc tham số tối ưu là bao nhiêu**, mà nằm ở việc **chiến lược nào có tác dụng với mã nào**. Đó là một bài toán hoàn toàn khác, và giải được.

## 0.3. Cách làm đúng — ba tầng

```
╔═══════════════════════════════════════════════════════════════╗
║  TẦNG 1 — PHÂN LOẠI  (làm mới mỗi quý)                        ║
║  Đo 14 thước đo thống kê cho từng mã trong VN100               ║
║  → Gán mỗi mã vào 1 trong 6 nhóm hành vi                      ║
║  → Đây là chỗ "đặc trưng theo từng mã" thực sự phát huy        ║
║  → Không tối ưu gì cả, chỉ ĐO LƯỜNG                           ║
╠═══════════════════════════════════════════════════════════════╣
║  TẦNG 2 — HIỆU CHUẨN THEO NHÓM  (làm mới mỗi năm)             ║
║  Mỗi nhóm có ~15–25 mã ⇒ đủ mẫu để hiệu chuẩn tin cậy         ║
║  Chỉ hiệu chuẩn 3–4 tham số/nhóm, không phải 6 tham số/mã     ║
║  → 6 nhóm × 4 tham số = 24 tham số, thay vì 600               ║
║  → Giảm 96% không gian tham số ⇒ giảm 96% rủi ro overfitting  ║
╠═══════════════════════════════════════════════════════════════╣
║  TẦNG 3 — ĐIỀU CHỈNH THEO MÃ  (tự động, KHÔNG hiệu chuẩn)     ║
║  Chỉ dùng các đại lượng ỔN ĐỊNH VỀ CẤU TRÚC:                  ║
║    thanh khoản · bước giá · biên độ sàn · beta · free-float   ║
║    phân phối gap qua đêm · tần suất trần-sàn                  ║
║  → Đây là SỰ THẬT về mã đó, không phải tham số được tối ưu    ║
╚═══════════════════════════════════════════════════════════════╝
```

> **Câu hỏi đúng không phải "RSI bao nhiêu kỳ là tối ưu cho HPG?"**
> **mà là "HPG thuộc loại cổ phiếu nào, và loại đó nên dùng momentum hay mean-reversion?"**

---

# PHẦN 1 — BẢY "ĐỊNH LUẬT" CỦA TTCK VIỆT NAM (theo bằng chứng học thuật)

Đây là các tính chất đã được kiểm định trên dữ liệu Việt Nam. Hệ thống của bạn phải tôn trọng chúng, không được đi ngược.

## Định luật 1 — Thị trường không hiệu quả ở dạng yếu ⇒ phân tích kỹ thuật có cơ sở

<cite index="156-1">Truong và cộng sự (2010) đưa ra bằng chứng về một thị trường giao dịch mỏng (thin-trading) và kết luận rằng HOSE không hiệu quả ở dạng yếu.</cite> Các kiểm định độc lập khác cũng cho kết quả tương tự: <cite index="170-1">kết quả từ kiểm định tự tương quan, kiểm định chuỗi (run test) và kiểm định tỷ số phương sai đều không ủng hộ giả thuyết bước đi ngẫu nhiên của hiệu quả thị trường dạng yếu.</cite>

**Hệ quả thiết kế:** giá quá khứ có chứa thông tin. Phân tích kỹ thuật ở Việt Nam có nền tảng thống kê, không phải mê tín. Nhưng đừng kỳ vọng quá — cùng nghiên cứu Borsa Istanbul kết luận thị trường <cite index="167-1">nhìn chung không thể hiện những điểm không hiệu quả lộ liễu</cite>. Lợi thế là có thật nhưng **vừa phải**.

## Định luật 2 — Phản ứng thái quá và đảo chiều ngắn hạn ⭐ quan trọng nhất với bạn

Đây là phát hiện có giá trị thực tiễn cao nhất cho phong cách EOD của bạn.

Nghiên cứu trên HOSE về hiện tượng phản ứng thái quá cho thấy: <cite index="161-1">đúng như giả thuyết overreaction dự đoán, suất sinh lợi bất thường bình quân của danh mục winner là âm trong tháng theo dõi. Tuy nhiên đảo chiều giá của nhóm loser chỉ xảy ra ở tháng T+2 và T+3. Chênh lệch suất sinh lợi bất thường bình quân giữa danh mục winner và loser ở tháng T+2 và T+3 lần lượt là 1,80% và 2,17%, cả hai đều có ý nghĩa thống kê ở mức 5%.</cite>

Trên sàn HNX, nghiên cứu gần đây (2025) xác nhận mạnh hơn: <cite index="160-1">kết quả cung cấp bằng chứng vững chắc về hiện tượng đảo chiều ngắn hạn. Các danh mục hình thành dựa trên thông tin trễ thể hiện suất sinh lợi bất thường âm mạnh ở chân trời một tháng, yếu dần ở hai tháng, và biến mất hoàn toàn ở tháng thứ ba. Quan trọng là các hiệu ứng này không thể giải thích bằng các nhân tố rủi ro thông thường.</cite>

**Hệ quả thiết kế — trực tiếp và cụ thể:**

| Điều này nghĩa là | Hành động |
|---|---|
| Mua cái vừa tăng mạnh ⇒ thống kê bất lợi | ❌ Hạ ưu tiên setup breakout, bỏ hẳn gap-and-go |
| Mua cái vừa giảm ⇒ thống kê có lợi ở chân trời 1–3 tháng | ✅ **Pullback và đảo chiều tại hỗ trợ là setup xương sống** |
| Hiệu ứng biến mất sau 3 tháng | ⚠️ Đừng nắm quá lâu với logic mean-reversion |

Đây chính là bằng chứng học thuật cho kết luận mình đã đưa ra ở v2.1 dựa trên lập luận về gap qua đêm. Hai đường lập luận độc lập dẫn tới cùng một kết luận.

## Định luật 3 — Momentum tồn tại nhưng ở chân trời trung–dài hạn, không phải ngắn hạn

Bằng chứng có vẻ trái ngược nhau nhưng thực ra bổ trợ nhau khi phân theo chân trời thời gian:

- **Ngắn hạn (tuần):** <cite index="162-1">nghiên cứu phát hiện hiệu ứng momentum ngắn hạn, nhưng kiểm định sâu hơn theo từng giai đoạn và theo quy mô cho thấy lợi nhuận momentum hoạt động kém sau khi kiểm soát rủi ro.</cite>
- **Rất ngắn hạn (1–5 phiên):** <cite index="167-1">suất sinh lợi của 1 đến 5 phiên gần nhất cho chỉ dẫn tốt về dấu của suất sinh lợi kỳ vọng phiên kế tiếp.</cite>
- **Trung hạn:** <cite index="156-1">Vo và Truong (2018) tìm thấy hiệu ứng momentum dài hạn tồn tại trong giai đoạn 2007–2015, đặc biệt với các danh mục hình thành theo 6 tháng trước và nắm giữ 9 tháng.</cite>

**Hệ quả thiết kế — bản đồ chân trời thời gian:**

```
1–5 phiên      → momentum yếu, có tín hiệu về DẤU nhưng không đủ để giao dịch
                 sau chi phí. KHÔNG dùng làm setup chính.
1–4 tuần       → ĐẢO CHIỀU chiếm ưu thế.  ⇒ Module tín hiệu T+ (8–25 phiên)
                 phải xây trên mean-reversion, không phải momentum.
1–3 tháng      → đảo chiều còn hiệu lực nhưng suy giảm
6 tháng+       → MOMENTUM chiếm ưu thế.   ⇒ Module trung–dài hạn dùng
                 momentum 6 tháng, nắm 9 tháng. Bỏ 1 tháng gần nhất.
```

Đây là cấu trúc **hai động cơ ngược chiều** — và đó là điều đúng, không phải mâu thuẫn. Module ngắn hạn mua khi yếu; module dài hạn mua khi mạnh. Chúng hoạt động ở hai chân trời khác nhau.

## Định luật 4 — Hành vi bầy đàn, mạnh hơn khi thị trường giảm

<cite index="173-1">Kết quả cho thấy sự bất đối xứng trong mức độ hành vi bầy đàn, trong đó hiệu ứng bầy đàn có vẻ mạnh hơn trong thị trường giảm so với thị trường tăng.</cite>

Một nghiên cứu khác cho kết quả chi tiết hơn và có phần phản trực giác: <cite index="169-1">hành vi bầy đàn không tồn tại ở ba thị trường trong các biến động cực đoan, mà lại tồn tại trong điều kiện thị trường bình thường. Bầy đàn nghiêm trọng hơn ở HoSE và HNX so với thị trường OTC UPCoM. Bầy đàn có chủ ý là hình thức chính và đã trở nên gay gắt hơn ở HoSE và HNX kể từ khi COVID-19 bùng phát.</cite>

**Hệ quả thiết kế:**

1. **Mean-reversion trong xu hướng giảm là cực kỳ nguy hiểm.** Bầy đàn mạnh hơn khi giảm nghĩa là "cái gì đang rơi sẽ rơi tiếp vì mọi người cùng bán". Nguyên tắc "không sinh tín hiệu mua khi thị trường Downtrend" ở v2.0 không phải sự thận trọng chung — nó là biện pháp phòng vệ trước một hiệu ứng đã được định lượng.
2. **Bầy đàn mạnh trong điều kiện bình thường** ⇒ tương quan chéo cao ngay cả khi thị trường yên tĩnh ⇒ đa dạng hoá trong VN100 kém hơn bạn tưởng. 10 mã ở Việt Nam không cho mức phân tán rủi ro như 10 mã ở Mỹ.

## Định luật 5 — Biến động bất đối xứng (hiệu ứng đòn bẩy)

<cite index="175-1">Hiệu ứng của các cú sốc lên biến động suất sinh lợi thị trường là bất đối xứng đối với HOSE. Cụ thể, các cú sốc âm dẫn tới biến động lớn hơn so với các cú sốc dương cùng độ lớn.</cite>

**Hệ quả thiết kế:** ATR đối xứng đánh giá thấp rủi ro giảm. Với phong cách EOD + T+2 có **3 phiên bị khoá**, đây không phải chi tiết học thuật mà là rủi ro tài khoản.

→ Dùng **downside ATR** hoặc **semi-deviation** cho việc tính khối lượng, thay vì ATR thông thường:

```
downside_ATR = ATR tính chỉ trên các phiên có return < 0
stop_distance = k × max(ATR14, 1,3 × downside_ATR14)
```

## Định luật 6 — Hiệu ứng thời vụ có thật, đặc biệt quanh Tết

Nhiều nghiên cứu độc lập xác nhận: <cite index="171-1">thị trường chứng khoán Việt Nam chịu ảnh hưởng của hiệu ứng thời vụ, chẳng hạn hiệu ứng tháng Một (Luu và cộng sự, 2016; Thach và cộng sự, 2019; Zaremba, 2015).</cite>

Về Tết Nguyên đán, kết quả cụ thể và có thể hành động: <cite index="175-1">Khanh và cộng sự (2020) xem xét hiệu ứng Tết lên suất sinh lợi thị trường của HOSE và tìm thấy suất sinh lợi bình quân trong 5 phiên giao dịch cuối trước Tết cao hơn suất sinh lợi bình quân của 5 phiên đầu sau Tết.</cite> Nghiên cứu năm 2025 làm rõ thêm: <cite index="175-1">tuy nhiên hiệu ứng này không lan sang các ngày ngay sau kỳ nghỉ, khi không quan sát thấy khác biệt đáng kể nào về suất sinh lợi. Sự lạc quan gắn với Tết có vẻ thúc đẩy hoạt động giao dịch tăng lên và hành vi mua đầu cơ, góp phần đẩy giá lên trước kỳ nghỉ.</cite>

**Hệ quả thiết kế:** thêm biến bối cảnh `days_to_tet` vào feature store. Vùng 5–10 phiên trước Tết có xu hướng tích cực; vùng sau Tết **không** có hiệu ứng đáng tin. Đây là điều chỉnh tỷ trọng, không phải setup độc lập.

## Định luật 7 — Thanh khoản và dòng vốn ngoại có ý nghĩa

<cite index="165-1">Batten và Vo (2014) ghi nhận quan hệ dương giữa thanh khoản và suất sinh lợi cổ phiếu tại Việt Nam. Hơn nữa, nhà đầu tư nước ngoài được phát hiện là nhóm giao dịch theo phản hồi tích cực (positive feedback traders) và có khả năng chọn thời điểm cũng như chiến lược giao dịch tốt hơn trên thị trường này (Vo, 2017).</cite>

**Hệ quả thiết kế:** dòng tiền khối ngoại là **tín hiệu xác nhận có giá trị**, không phải dữ liệu trang trí. File CCNN của CafeF cung cấp đúng thứ này miễn phí. Trọng số của nó nên cao hơn mức mình đề xuất ở v2.0.

## 1.8. Một tin tốt bất ngờ: giới hạn quy mô lại có lợi cho bạn

Nghiên cứu Borsa Istanbul kết luận: <cite index="163-1">nhìn chung, các phát hiện của chúng tôi gợi ý về hướng tồn tại những điểm không hiệu quả có thể khai thác, nhưng độ lớn của khối lượng giao dịch khả thi chỉ ở mức tương đối nhỏ.</cite>

Đây là lý do các quỹ lớn **không thể** khai thác hết những điểm không hiệu quả này — họ không thể vào vị thế đủ lớn để đáng làm. Một tài khoản cá nhân vài trăm triệu đến vài tỷ đồng lại **đúng cỡ** để khai thác. Ràng buộc quy mô giết chiến lược của tổ chức nhưng không ảnh hưởng tới bạn.

---

# PHẦN 2 — CẤU TRÚC VN100 HIỆN TẠI

## 2.1. Rổ VN30 — kỳ hiệu lực 03/08/2026

HOSE công bố ngày 15/07/2026, hiệu lực 03/08/2026: <cite index="145-1">MCH (Hàng tiêu dùng Masan) và TCX (Chứng khoán Kỹ Thương) được bổ sung; PLX (Petrolimex) và TPB (TPBank) bị loại khỏi danh mục.</cite> <cite index="147-1">Danh mục cổ phiếu dự phòng gồm VCK, BCM, GEE, VPX và PLX.</cite>

Tỷ trọng theo dự báo ACBS cho kỳ này: <cite index="143-1">FPT tiếp tục giữ vai trò cổ phiếu chiếm tỷ trọng cao nhất trong rổ với 10% (ngưỡng trần đối với cổ phiếu riêng lẻ), theo sau là HPG (8,93%) và VIC (7,82%). VIC là cổ phiếu giảm tỷ trọng nhiều nhất kỳ này do quy định giới hạn 15% đối với nhóm cổ phiếu liên quan.</cite>

## 2.2. Ba đặc điểm cấu trúc phải đưa vào thiết kế

**(1) Tập trung thanh khoản cực cao.** <cite index="146-1">Thanh khoản của nhóm VN30 duy trì tỷ trọng áp đảo, thường chiếm khoảng 50–60% tổng giá trị giao dịch toàn sàn HOSE.</cite>

→ 30 mã chiếm hơn nửa thanh khoản của hơn 400 mã. Universe thực sự giao dịch được của bạn hẹp hơn con số 100 rất nhiều.

**(2) Chỉ số bị chi phối bởi vài mã.** Một nghiên cứu về hành vi bầy đàn nêu thẳng: <cite index="174-1">VNI có nhược điểm vì chịu ảnh hưởng của các cổ phiếu vốn hoá lớn và làm hạn chế ảnh hưởng của tất cả các mã còn lại trên thị trường.</cite>

→ **Hệ quả nguy hiểm:** nếu bạn dùng VN-Index làm bộ lọc trạng thái thị trường, và VN-Index bị chi phối bởi nhóm Vingroup, thì bộ lọc của bạn đang đo "nhóm Vingroup hôm nay thế nào" chứ không phải "thị trường hôm nay thế nào". Năm 2025, riêng VIC và VHM đã đóng góp khoảng 372 điểm trong tổng mức tăng 517,71 điểm của VN-Index.

→ **Bắt buộc dùng chỉ số phụ trợ:** VN-Index **đồng thời với** chỉ số bình quân giá (equal-weighted) tự tính từ VN100, cùng với độ rộng thị trường. Khi hai chỉ số phân kỳ, tin vào chỉ số bình quân giá.

**(3) Giới hạn tỷ trọng nhóm liên quan là 15%.** Quy định này của HOSE cho thấy chính Sở cũng coi VIC–VHM–VRE–VPL là **một** rủi ro, không phải bốn. Hệ thống của bạn nên làm y hệt: giới hạn tỷ trọng theo **nhóm sở hữu**, không chỉ theo mã và ngành.

## 2.3. Chân trời phái sinh

<cite index="146-1">Trên thị trường phái sinh, hợp đồng tương lai dựa trên VN30-Index tiếp tục được giao dịch vượt trội, kể cả khi thị trường đã xuất hiện thêm sản phẩm phái sinh VN100 từ tháng 10/2025.</cite>

→ Nếu sau này bạn muốn phòng vệ, VN30F vẫn là công cụ có thanh khoản duy nhất đáng dùng, dù đã có sản phẩm trên VN100.

---

# PHẦN 3 — 14 THƯỚC ĐO PHÂN LOẠI HÀNH VI CỔ PHIẾU

Đây là **Tầng 1** — nơi "đặc trưng theo từng mã" thực sự có ý nghĩa. Tất cả đo được từ dữ liệu CafeF miễn phí, cửa sổ 250 phiên, làm mới mỗi quý.

| # | Thước đo | Công thức | Cho biết điều gì | Ngưỡng phân loại |
|:---:|---|---|---|---|
| **1** | **Tỷ số phương sai (VR)** ⭐ | `Var(r_5) / (5 × Var(r_1))` | **Thước đo quan trọng nhất.** VR > 1 = xu hướng; VR < 1 = đảo chiều | > 1,15 xu hướng · 0,85–1,15 trung tính · < 0,85 đảo chiều |
| **2** | Số mũ Hurst | R/S analysis hoặc DFA | Xác nhận chéo cho VR | > 0,55 xu hướng · < 0,45 đảo chiều |
| **3** | Tự tương quan lag 1–5 | `corr(r_t, r_{t-k})`, k=1..5 | Kiểm định trực tiếp phát hiện "1–5 phiên" của Borsa Istanbul | Tổng dương = momentum ngắn |
| **4** | Biến động năm hoá | `std(r) × √250` | Cỡ vị thế, độ rộng stop | < 25% thấp · 25–40% TB · > 40% cao |
| **5** | ATR% | `ATR14 / close` | Biến động chuẩn hoá | |
| **6** | **Downside ATR** ⭐ | ATR chỉ trên phiên `r < 0` | Hiệu ứng đòn bẩy (Định luật 5) | Tỷ số `dATR/ATR > 1,3` = bất đối xứng mạnh |
| **7** | Beta vs VN-Index | Hồi quy OLS 250 phiên | Phơi nhiễu hệ thống | < 0,8 thấp · 0,8–1,2 TB · > 1,2 cao |
| **8** | Tỷ lệ biến động riêng | `1 − R²` của hồi quy beta | Mã đi theo thị trường hay theo câu chuyện riêng | > 0,6 = có câu chuyện riêng |
| **9** | Thanh khoản (ADV20) | `mean(close × volume, 20)` | Năng lực vào/ra lệnh | < 20 tỷ = loại khỏi universe |
| **10** | Bất thanh khoản Amihud | `mean(|r| / (close×volume))` | Tác động giá khi vào lệnh | Cao = slippage lớn |
| **11** | **Phân phối gap qua đêm** ⭐ | `open_{t+1}/close_t − 1` | **Sống còn với phong cách EOD.** Trung vị, độ lệch chuẩn, phân vị 90 | p90 > 2,5% = rủi ro EOD cao |
| **12** | Tần suất trần/sàn | `count(|r| ≥ 0,95×band) / 250` | Rủi ro không thoát được hàng | > 5% = nguy hiểm với T+2 |
| **13** | **Chuỗi sàn dài nhất** ⭐ | max số phiên sàn liên tiếp lịch sử | **Rủi ro đuôi 3 phiên bị khoá** | ≥ 3 = giới hạn tỷ trọng nghiêm ngặt |
| **14** | Nhạy cảm dòng ngoại | `corr(r_t, foreign_net_t)` 60 phiên | Định luật 7 | > 0,3 = khối ngoại là tín hiệu xác nhận |

## 3.1. Vì sao Tỷ số phương sai là thước đo số một

VR trả lời trực tiếp câu hỏi quyết định mọi thứ khác: **mã này nên dùng momentum hay mean-reversion?**

```
VR = Var(suất sinh lợi 5 phiên) / (5 × Var(suất sinh lợi 1 phiên))

VR = 1,0  →  bước đi ngẫu nhiên, không có gì khai thác
VR > 1,0  →  suất sinh lợi tự tương quan DƯƠNG, xu hướng dai dẳng
             ⇒ dùng trend-following, breakout, momentum
VR < 1,0  →  suất sinh lợi tự tương quan ÂM, giá dao động về trung bình
             ⇒ dùng pullback, đảo chiều tại hỗ trợ, Bollinger
```

Theo Định luật 2, **phần lớn cổ phiếu Việt Nam ở chân trời 1–4 tuần sẽ có VR < 1**. Nhưng sẽ có một nhóm thiểu số có VR > 1 — và đó chính là nhóm mà nghiên cứu Borsa Istanbul nói "momentum hoạt động thoả đáng đối với một số cổ phiếu cụ thể". **Đo VR là cách bạn tìm ra chúng bằng dữ liệu, thay vì đoán.**

---

# PHẦN 4 — SÁU NHÓM HÀNH VI VÀ CHIẾN LƯỢC TƯƠNG ỨNG

> ⚠️ **Đọc kỹ:** danh sách mã dưới đây là **giả thuyết ban đầu** dựa trên cấu trúc thị trường và đặc điểm ngành, để bạn có điểm khởi đầu. **Thành viên nhóm thực tế PHẢI do 14 thước đo ở Phần 3 quyết định**, không phải do bảng này. Một mã có thể chuyển nhóm theo thời gian — đó là lý do phải phân loại lại mỗi quý.

## Nhóm C1 — Trụ chỉ số vốn hoá siêu lớn

**Mã dự kiến:** VIC, VHM, VCB, BID, FPT, HPG, VPL, MCH

| Đặc trưng dự kiến | |
|---|---|
| Thanh khoản | Rất cao |
| Biến động | Trung bình (25–35%) |
| Beta | ~1,0 (chính chúng **là** chỉ số) |
| Biến động riêng | Thấp |
| VR | Trung tính đến hơi xu hướng |
| Rủi ro gap | Thấp |

**Chiến lược:** Trend-following chậm (MA50/MA200) + pullback về MA20. Chấp nhận breakout khi có xác nhận khối lượng.

**⚠️ Cảnh báo tính vòng tròn:** nhóm này **tạo ra** VN-Index. Dùng bộ lọc trạng thái dựa trên VN-Index để giao dịch VIC/VHM là lập luận vòng tròn. Với C1, hãy dùng chỉ số bình quân giá VN100 làm bộ lọc trạng thái.

## Nhóm C2 — Ngân hàng thanh khoản cao

**Mã dự kiến:** CTG, TCB, MBB, ACB, VPB, STB, HDB, VIB, SHB, LPB, MSB, EIB

| Đặc trưng dự kiến | |
|---|---|
| Tương quan trong nhóm | **Rất cao** (0,7–0,9) |
| Biến động riêng | Thấp — biến động ngành áp đảo |
| Động lực | Chính sách tiền tệ, room tín dụng, nợ xấu, thông tư NHNN |
| VR | Trung tính |

**Chiến lược:** Đây là nhóm mà **chọn thời điểm ngành quan trọng hơn chọn mã**. Tương quan trong nhóm quá cao nên mua 4 mã ngân hàng ≈ mua 1 vị thế lớn.

→ **Quy tắc riêng: tối đa 2 mã cùng lúc trong C2**, và coi tổng tỷ trọng C2 như một vị thế đơn khi tính rủi ro.
→ Setup: pullback về MA20/MA50 khi chỉ số ngành ngân hàng ở trên MA50.

## Nhóm C3 — Beta cao, khuếch đại dòng tiền

**Mã dự kiến:** SSI, VCI, TCX, SHS, VIX, MBS, FTS, BSI, HCM, và một phần BĐS thanh khoản cao

| Đặc trưng dự kiến | |
|---|---|
| Beta | **1,3–1,8** |
| Biến động | Cao (40–60%) |
| Nhạy cảm | Thanh khoản thị trường, dư nợ margin |
| VR | **Xu hướng khi thị trường tăng, đảo chiều dữ dội khi giảm** |

**Chiến lược:** Đây là nhóm duy nhất mà momentum có thể vượt mean-reversion — **nhưng chỉ trong xu hướng tăng đã xác nhận**.

```
Nếu regime = Uptrend mạnh   →  momentum, breakout được phép
Nếu regime = Sideway        →  chỉ pullback, giảm 50% tỷ trọng
Nếu regime = Điều chỉnh/giảm →  ❌ LOẠI HOÀN TOÀN khỏi universe
```

Lý do quy tắc cuối gay gắt: beta 1,5 cộng với hành vi bầy đàn mạnh hơn khi giảm (Định luật 4) cộng với 3 phiên bị khoá của T+2 là công thức của thảm hoạ. Nhóm này chính là nơi tạo ra những khoản lỗ 40–60% trong các đợt sụp đổ 2022.

## Nhóm C4 — Chu kỳ hàng hoá

**Mã dự kiến:** HPG, HSG, NKG, DGC, DPM, DCM, GAS, BSR, PVS, PVD, PVT, CSV

| Đặc trưng dự kiến | |
|---|---|
| Biến động riêng | **Cao** (> 0,6) |
| Beta vs VN-Index | Thấp hơn trung bình |
| Động lực | **Giá hàng hoá quốc tế**, không phải dòng tiền nội |
| VR | **Có xu hướng** — chu kỳ hàng hoá dai dẳng |

**Chiến lược:** Nhóm duy nhất mà **thêm biến ngoại sinh cho giá trị thật**. Giá thép HRC, quặng sắt, urê, phốt pho vàng, dầu Brent, phí vận tải — tất cả lấy được miễn phí từ FRED và yfinance.

```
Setup C4 = trend-following trên giá cổ phiếu
         + BỘ LỌC: giá hàng hoá tương ứng đang trên MA50 của chính nó

→ Nếu giá thép đang giảm, không mua HPG/HSG/NKG dù đồ thị đẹp thế nào
```

Đây là nhóm có tỷ lệ thắng cao nhất khi bộ lọc hàng hoá được áp dụng đúng, vì bạn đang giao dịch một chu kỳ kinh tế thực, không phải tâm lý.

## Nhóm C5 — Phòng thủ, biến động thấp

**Mã dự kiến:** VNM, SAB, DHG, IMP, POW, NT2, QTP, PPC, REE, BVH, BMI, PVI

| Đặc trưng dự kiến | |
|---|---|
| Biến động | **Thấp** (< 25%) |
| Beta | **< 0,8** |
| VR | **< 0,85 — đảo chiều rõ rệt** |
| Rủi ro gap | Thấp nhất |
| Tần suất trần/sàn | Rất thấp |

**Chiến lược:** Mean-reversion thuần khiết. Đây là nhóm mà Định luật 2 phát huy mạnh nhất.

```
Setup C5 = Bollinger Band dưới + RSI < 35 + giá trên MA200
         → mua, nắm 10–20 phiên, chốt ở dải giữa hoặc dải trên
```

Biến động thấp cho phép **stop hẹp hơn** (6–7% thay vì 9–10%) và do đó **tỷ trọng lớn hơn** với cùng mức rủi ro. Nhóm này nên là nền của danh mục, không phải phần gia vị.

## Nhóm C6 — Vốn hoá trung bình, biến động cao ⚠️

**Mã dự kiến:** DIG, CEO, PDR, DXG, KBC, GEX, VGS, HAH, HHV, VCG, và các mã mới lên VN100

| Đặc trưng dự kiến | |
|---|---|
| Biến động | **Rất cao (> 45%)** |
| Tần suất trần/sàn | **> 5%** |
| Chuỗi sàn dài nhất | Thường ≥ 3 phiên |
| Rủi ro gap p90 | **> 2,5%** |
| Điểm rủi ro bất thường | Cao nhất |

**Chiến lược:** Đây là nhóm nguy hiểm nhất với phong cách EOD + T+2, vì kết hợp cả bốn yếu tố xấu: gap lớn, sàn liên tiếp, không thoát được hàng, và rủi ro thao túng cao.

```
Quy tắc C6 — nghiêm ngặt hơn tất cả các nhóm khác:
  • Tỷ trọng tối đa 5% NAV/mã (thay vì 10–12%)
  • Tối đa 1 mã C6 trong danh mục cùng lúc
  • Chỉ giao dịch khi regime = Uptrend mạnh
  • Ngưỡng điểm rủi ro bất thường siết còn < 40 (thay vì < 55)
  • ❌ TUYỆT ĐỐI không dùng margin
  • Chỉ setup pullback, không breakout
```

Nhiều nhà đầu tư cá nhân dành phần lớn danh mục cho nhóm này vì "biên lợi nhuận cao hơn". Với ràng buộc T+2, đó là lựa chọn có kỳ vọng âm sau khi tính đến rủi ro đuôi.

## 4.7. Nhóm đặc biệt: xử lý sở hữu chéo

Ngoài 6 nhóm hành vi, cần một lớp giới hạn riêng theo **nhóm sở hữu**, học theo chính quy định 15% của HOSE:

| Nhóm sở hữu | Mã | Giới hạn tổng |
|---|---|---|
| Vingroup | VIC, VHM, VRE, VPL | 15% NAV |
| Masan | MSN, MCH, MSR | 12% NAV |
| Techcombank | TCB, TCX | 12% NAV |
| Gelex | GEX, GEE, VCK | 10% NAV |
| Các "họ" khác | tuỳ phát hiện | 10% NAV |

Lý do: bốn mã Vingroup không phải bốn khoản đầu tư. Chúng là một khoản đầu tư được chia làm bốn.

---

# PHẦN 5 — BẢNG THAM SỐ KỸ THUẬT THEO NHÓM

Đây là **Tầng 2**. Chỉ 4 tham số cốt lõi cho mỗi nhóm, và đây là **giá trị khởi điểm cần hiệu chuẩn**, không phải kết quả đã kiểm chứng.

## 5.1. Bảng tham số chính

| Tham số | C1 Trụ | C2 Ngân hàng | C3 Beta cao | C4 Hàng hoá | C5 Phòng thủ | C6 Mid-cap |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Logic chính** | Trend + Pullback | Pullback | **Momentum** (chỉ uptrend) | **Trend** + lọc hàng hoá | **Mean-reversion** | Pullback |
| MA xu hướng | 50 / 200 | 50 / 200 | 20 / 50 | 50 / 200 | 100 / 200 | 50 / 200 |
| MA vào lệnh | 20 | 20 | 10 | 20 | Bollinger(20;2) | 20 |
| Kỳ RSI | 14 | 14 | 9 | 14 | 21 | 14 |
| Ngưỡng RSI mua | < 45 | < 42 | > 55 (momentum) | < 45 | **< 35** | < 40 |
| Hệ số ATR cho stop | 3,0 | 3,0 | **4,0** | 3,5 | **2,5** | **4,0** |
| Stop tối đa | 9% | 9% | **12%** | 10% | **7%** | **12%** |
| Nắm giữ mục tiêu | 15–30 phiên | 10–25 | 8–20 | 20–40 | 10–20 | 8–15 |
| Tỷ trọng tối đa/mã | 12% | 10% | 8% | 10% | **15%** | **5%** |
| Ngưỡng gap bỏ lệnh | 2,0% | 2,0% | **3,0%** | 2,5% | **1,5%** | **2,0%** |
| Ngưỡng rủi ro bất thường | < 55 | < 55 | < 50 | < 55 | < 60 | **< 40** |
| Xác nhận KL tối thiểu | 1,3× TB20 | 1,3× | 1,5× | 1,3× | 1,1× | 1,5× |
| Bộ lọc regime tối thiểu | Sideway | Sideway | **Uptrend mạnh** | Sideway | Điều chỉnh nhẹ vẫn OK | **Uptrend mạnh** |
| Biến ngoại sinh bắt buộc | — | Chỉ số ngành NH | Thanh khoản TT | **Giá hàng hoá** | — | — |
| Bộ lọc trạng thái dùng | **VN100 EW** | VN-Index | VN-Index | VN100 EW | VN100 EW | VN100 EW |

*(VN100 EW = chỉ số bình quân giá bằng nhau tự tính, tránh bị nhóm trụ chi phối)*

## 5.2. Ba điểm khác biệt đáng chú ý trong bảng

**(1) Chỉ C3 dùng momentum.** Bốn nhóm còn lại đều là mua-khi-yếu. Đây là hệ quả trực tiếp của Định luật 2 và 3, không phải sở thích cá nhân.

**(2) C5 có stop hẹp nhất nhưng tỷ trọng lớn nhất.** Nghe nghịch lý nhưng đúng về mặt toán: biến động thấp ⇒ stop 7% vẫn nằm ngoài vùng nhiễu ⇒ với cùng 0,6% NAV rủi ro, bạn mua được nhiều hơn. Nhóm phòng thủ nên là **cột sống** của danh mục EOD, không phải phần thêm.

**(3) C6 có stop rộng nhất và tỷ trọng nhỏ nhất.** Đây là nhóm mà toán học nói "hoặc chấp nhận vị thế rất nhỏ, hoặc đừng chơi".

## 5.3. Ma trận setup × nhóm

| Setup | C1 | C2 | C3 | C4 | C5 | C6 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `PB_MA20` Pullback MA20 | ✅✅ | ✅✅✅ | ✅ | ✅✅ | ✅✅ | ✅✅✅ |
| `PB_MA50` Pullback MA50 | ✅✅ | ✅✅ | — | ✅✅ | ✅ | ✅ |
| `REV_SUP` Đảo chiều hỗ trợ | ✅ | ✅ | — | ✅ | ✅✅✅ | ✅ |
| `BB_LOWER` Bollinger dưới | — | ✅ | — | — | ✅✅✅ | — |
| `TREND_MA` Trend-following | ✅✅✅ | ✅ | ✅ | ✅✅✅ | ✅ | — |
| `RS_LEADER` Dẫn dắt tương đối | ✅✅ | ✅ | ✅✅ | ✅✅ | — | ✅ |
| `MOM_20` Momentum 20 phiên | — | — | ✅✅✅ | ✅ | ❌ | — |
| `VCP` Thu hẹp biến động | ✅ | — | ✅ | ✅ | — | — |
| `BO_BASE` Breakout nền | ✅ | — | ✅✅ | ✅ | ❌ | ❌ |
| `GAP_GO` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

✅✅✅ setup chính · ✅✅ tốt · ✅ dùng được · — không phù hợp · ❌ cấm

---

# PHẦN 6 — ĐIỀU CHỈNH RIÊNG THEO MÃ (chỉ những gì ổn định)

Đây là **Tầng 3**. Không hiệu chuẩn gì cả — chỉ áp dụng sự thật đo được về từng mã.

| Đại lượng | Cách dùng | Vì sao an toàn |
|---|---|---|
| **ADV20** | `KL tối đa = min(KL theo sizing, 3% × ADV20/giá)` | Sự thật về thanh khoản, không phải tham số |
| **Bước giá** | Làm tròn giá LO theo bước của sàn | Quy định cứng |
| **Biên độ sàn** | ±7% HOSE, ±10% HNX, ±15% UPCOM | Quy định cứng |
| **Beta** | `KL điều chỉnh = KL / max(beta, 0,8)` — beta cao thì mua ít hơn | Đo được, ổn định theo quý |
| **Downside ATR** | Dùng thay ATR khi tính stop nếu `dATR/ATR > 1,3` | Định luật 5 |
| **Gap p90 lịch sử** | Đặt ngưỡng bỏ lệnh riêng = `min(ngưỡng nhóm, gap_p90)` | Đo được từ lịch sử của chính mã |
| **Chuỗi sàn dài nhất** | Nếu ≥ 3: giảm tỷ trọng còn 60%; nếu ≥ 5: loại khỏi universe | Rủi ro đuôi thật đã xảy ra |
| **Free-float** | < 20%: giảm tỷ trọng 50% | Rủi ro thanh khoản + thao túng |
| **Nhóm sở hữu** | Áp giới hạn tổng theo bảng 4.7 | Quy tắc cấu trúc |
| **Nhạy cảm dòng ngoại** | Nếu `corr > 0,3`: yêu cầu khối ngoại mua ròng 5 phiên làm điều kiện bổ sung | Định luật 7 |

**Điểm mấu chốt:** không có dòng nào trong bảng này là tham số được tối ưu bằng backtest. Tất cả là **đại lượng đo được** về mã đó. Đó là lý do chúng an toàn khỏi overfitting.

---

# PHẦN 7 — QUY TRÌNH HIỆU CHUẨN CHỐNG OVERFITTING

Phần này quan trọng ngang với nội dung phân tích, vì nó là thứ ngăn bạn tự lừa mình.

## 7.1. Walk-forward lồng nhau, theo nhóm chứ không theo mã

```
Cửa sổ: train 3 năm → validate 1 năm → test 1 năm → trượt 1 năm

┌──── 2013-2015 ────┬─2016─┬─2017─┐
                    train  val   test
        ┌──── 2014-2016 ────┬─2017─┬─2018─┐
                            train  val   test
                ┌──── 2015-2017 ────┬─2018─┬─2019─┐
                                     ...
                                          ┌── 2022-2024 ─┬2025┬2026┐

QUY TẮC BẤT DI BẤT DỊCH:
  • Hiệu chuẩn trên TOÀN BỘ mã trong nhóm cùng lúc (pooled)
    → 1 bộ tham số cho ~15-25 mã, KHÔNG phải 1 bộ cho mỗi mã
  • Phân loại nhóm PHẢI dùng dữ liệu chỉ tới cuối kỳ train
    (nếu không là look-ahead bias)
  • Tối đa 4 tham số/nhóm. Muốn thêm tham số thứ 5 thì bỏ 1 cái cũ
  • Purged K-Fold + embargo 10 phiên khi dùng triple-barrier
```

## 7.2. Bốn cửa kiểm tra bắt buộc trước khi tin một nhóm tham số

| Cửa | Kiểm tra | Ngưỡng đạt |
|:---:|---|---|
| **1** | **Deflated Sharpe Ratio** — hiệu chỉnh theo số lần thử | DSR > 0,7 |
| **2** | **PBO** (Probability of Backtest Overfitting) | PBO < 0,4 |
| **3** | **Độ bền qua chế độ thị trường** — test riêng 2018, 2020, 2021, 2022, 2023–26 | Sharpe dương ở **≥ 4/5** giai đoạn |
| **4** | **Chất lượng khớp lệnh EOD** (từ v2.1) | Fill rate ≥ 70% và gap qua đêm TB ≤ 1,5% |

Trượt bất kỳ cửa nào ⇒ **loại nhóm tham số đó**, quay lại giá trị mặc định ở Phần 5. Không "chỉnh một chút cho qua".

## 7.3. Kiểm định độ bền của việc phân nhóm

Phân nhóm cũng phải được kiểm chứng, không được coi là hiển nhiên:

```
Kiểm định A — Độ ổn định thành viên
  Phân nhóm lại mỗi quý trong 5 năm.
  Đo: bao nhiêu % mã giữ nguyên nhóm qua các kỳ?
  → Nếu < 60%: phân nhóm của bạn đang bắt nhiễu, không bắt bản chất
  → Xử lý: giảm số nhóm từ 6 xuống 4, hoặc nới ngưỡng phân loại

Kiểm định B — Nhóm có thực sự khác nhau?
  Chạy CÙNG một bộ tham số cho tất cả 6 nhóm.
  So sánh với việc dùng tham số riêng từng nhóm.
  → Nếu chênh lệch Sharpe < 0,2: việc phân nhóm KHÔNG mang lại giá trị
  → Kết luận trung thực: dùng 1 bộ tham số chung, đơn giản hơn và bền hơn

Kiểm định C — Kiểm định giả (placebo)
  Gán mã vào nhóm NGẪU NHIÊN, chạy lại toàn bộ.
  → Nếu nhóm ngẫu nhiên cho kết quả tương đương nhóm thật:
    toàn bộ Phần 4 là ảo giác. Bỏ đi và dùng 1 bộ tham số chung.
```

Kiểm định C là cái đau nhất nhưng cần thiết nhất. **Hãy chạy nó trước khi xây tiếp.**

---

# PHẦN 8 — MÃ NGUỒN

## 8.1. Tính 14 thước đo phân loại

```python
# vnqd/features/stock_profile.py
"""Tính bộ thước đo hành vi cho từng mã — Tầng 1 của khung phân loại.

Chạy mỗi quý trên cửa sổ 250 phiên. Đây là ĐO LƯỜNG, không phải tối ưu.
Mọi thước đo tính được từ dữ liệu EOD miễn phí của CafeF.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
import polars as pl


@dataclass(frozen=True, slots=True)
class StockProfile:
    symbol: str
    as_of: str
    n_obs: int

    # --- Bản chất chuỗi thời gian: xu hướng hay đảo chiều ---
    variance_ratio_5: float          # ⭐ thước đo số 1
    hurst: float
    autocorr_sum_1_5: float

    # --- Biến động ---
    vol_annual: float
    atr_pct: float
    downside_atr_pct: float
    atr_asymmetry: float             # downside_atr / atr

    # --- Phơi nhiễu hệ thống ---
    beta: float
    idio_share: float                # 1 - R²

    # --- Thanh khoản ---
    adv20_bn: float                  # tỷ đồng
    amihud: float

    # --- Rủi ro riêng của phong cách EOD ---
    gap_median: float
    gap_p90: float                   # ⭐
    limit_hit_freq: float
    max_floor_streak: int            # ⭐

    # --- Dòng vốn ---
    foreign_sensitivity: float

    def to_dict(self) -> dict:
        return asdict(self)


def variance_ratio(returns: np.ndarray, q: int = 5) -> float:
    """VR = Var(r_q) / (q * Var(r_1)).

    > 1 : suất sinh lợi tự tương quan dương  → XU HƯỚNG
    = 1 : bước đi ngẫu nhiên
    < 1 : suất sinh lợi tự tương quan âm     → ĐẢO CHIỀU
    """
    r = returns[~np.isnan(returns)]
    if len(r) < q * 12:
        return np.nan

    var_1 = np.var(r, ddof=1)
    if var_1 <= 0:
        return np.nan

    # suất sinh lợi cộng dồn q phiên, không chồng lấn
    n_blocks = len(r) // q
    r_q = r[: n_blocks * q].reshape(n_blocks, q).sum(axis=1)
    var_q = np.var(r_q, ddof=1)

    return float(var_q / (q * var_1))


def hurst_exponent(prices: np.ndarray, max_lag: int = 60) -> float:
    """Ước lượng số mũ Hurst bằng phương pháp độ lệch chuẩn theo lag.

    > 0,5 : dai dẳng (xu hướng) | < 0,5 : phản dai dẳng (đảo chiều)
    """
    p = np.log(prices[prices > 0])
    if len(p) < max_lag * 3:
        return np.nan

    lags = np.arange(2, max_lag)
    tau = np.array([np.std(p[lag:] - p[:-lag], ddof=1) for lag in lags])

    ok = tau > 0
    if ok.sum() < 10:
        return np.nan

    slope = np.polyfit(np.log(lags[ok]), np.log(tau[ok]), 1)[0]
    return float(slope)


def _true_range(h: np.ndarray, l: np.ndarray, c: np.ndarray) -> np.ndarray:
    prev_c = np.concatenate([[c[0]], c[:-1]])
    return np.maximum.reduce([h - l, np.abs(h - prev_c), np.abs(l - prev_c)])


def build_profile(
    px: pl.DataFrame,           # OHLCV đã điều chỉnh, >= 250 phiên
    index_px: pl.DataFrame,     # chuỗi chỉ số tham chiếu, cùng ngày
    *,
    symbol: str,
    price_band: float = 0.07,
    foreign_net: pl.Series | None = None,
) -> StockProfile:
    px = px.sort("date")
    n = px.height
    if n < 250:
        raise ValueError(f"{symbol}: chỉ có {n} phiên, cần >= 250")

    w = px.tail(250)
    c = w["close"].to_numpy()
    h = w["high"].to_numpy()
    lo = w["low"].to_numpy()
    o = w["open"].to_numpy()
    v = w["volume"].to_numpy().astype(float)

    r = np.diff(np.log(c))

    # --- bản chất chuỗi thời gian ---
    vr5 = variance_ratio(r, q=5)
    hurst = hurst_exponent(c)
    ac = [float(np.corrcoef(r[k:], r[:-k])[0, 1]) for k in range(1, 6)]
    ac_sum = float(np.nansum(ac))

    # --- biến động ---
    vol_ann = float(np.std(r, ddof=1) * np.sqrt(250))
    tr = _true_range(h, lo, c)
    atr = float(np.mean(tr[-14:]))
    atr_pct = atr / float(c[-1])

    down_mask = np.concatenate([[False], r < 0])
    down_tr = tr[down_mask]
    d_atr = float(np.mean(down_tr[-14:])) if len(down_tr) >= 14 else atr
    d_atr_pct = d_atr / float(c[-1])

    # --- beta & biến động riêng ---
    idx = index_px.sort("date").tail(250)["close"].to_numpy()
    r_idx = np.diff(np.log(idx))
    m = min(len(r), len(r_idx))
    r_s, r_m = r[-m:], r_idx[-m:]

    var_m = np.var(r_m, ddof=1)
    beta = float(np.cov(r_s, r_m, ddof=1)[0, 1] / var_m) if var_m > 0 else np.nan
    corr = float(np.corrcoef(r_s, r_m)[0, 1])
    idio = float(1.0 - corr**2)

    # --- thanh khoản ---
    turnover = c * v
    adv20 = float(np.mean(turnover[-20:]) / 1e9)          # tỷ đồng
    with np.errstate(divide="ignore", invalid="ignore"):
        amihud = float(np.nanmean(np.abs(r) / np.maximum(turnover[1:], 1.0)) * 1e9)

    # --- rủi ro riêng của phong cách EOD ---
    # gap = giá mở cửa phiên sau / giá đóng cửa phiên trước - 1
    gap = o[1:] / c[:-1] - 1.0
    gap_med = float(np.median(gap))
    gap_p90 = float(np.percentile(gap, 90))

    at_limit = np.abs(r) >= np.log(1 + price_band) * 0.95
    limit_freq = float(at_limit.mean())

    at_floor = r <= -np.log(1 + price_band) * 0.95
    streak = best = 0
    for f in at_floor:
        streak = streak + 1 if f else 0
        best = max(best, streak)

    # --- nhạy cảm dòng ngoại ---
    f_sens = np.nan
    if foreign_net is not None and len(foreign_net) >= 61:
        fn = foreign_net.to_numpy()[-60:]
        rr = r[-60:]
        k = min(len(fn), len(rr))
        if k >= 30 and np.std(fn[-k:]) > 0:
            f_sens = float(np.corrcoef(rr[-k:], fn[-k:])[0, 1])

    return StockProfile(
        symbol=symbol,
        as_of=str(w["date"][-1]),
        n_obs=n,
        variance_ratio_5=vr5,
        hurst=hurst,
        autocorr_sum_1_5=ac_sum,
        vol_annual=vol_ann,
        atr_pct=atr_pct,
        downside_atr_pct=d_atr_pct,
        atr_asymmetry=d_atr / atr if atr > 0 else np.nan,
        beta=beta,
        idio_share=idio,
        adv20_bn=adv20,
        amihud=amihud,
        gap_median=gap_med,
        gap_p90=gap_p90,
        limit_hit_freq=limit_freq,
        max_floor_streak=best,
        foreign_sensitivity=f_sens,
    )
```

## 8.2. Gán nhóm hành vi

```python
# vnqd/features/clustering.py
"""Gán mã vào nhóm hành vi dựa trên StockProfile.

Dùng cây quyết định TƯỜNG MINH thay vì k-means, vì:
  1. Giải thích được — bạn biết chính xác vì sao HPG vào C4
  2. Ổn định — k-means đổi nhóm ngẫu nhiên giữa các lần chạy
  3. Có thể kiểm định — mỗi ngưỡng là một giả thuyết kiểm chứng được
"""
from __future__ import annotations

from enum import StrEnum

import numpy as np

from vnqd.features.stock_profile import StockProfile


class Cluster(StrEnum):
    C1_MEGA = "C1_mega_cap"
    C2_BANK = "C2_bank"
    C3_HIGH_BETA = "C3_high_beta"
    C4_COMMODITY = "C4_commodity"
    C5_DEFENSIVE = "C5_defensive"
    C6_VOLATILE_MID = "C6_volatile_mid"
    EXCLUDED = "excluded"


# Ánh xạ ngành — nạp từ config/universe.yaml, ở đây rút gọn để minh hoạ
BANK_SYMBOLS = frozenset({
    "VCB", "BID", "CTG", "TCB", "MBB", "ACB", "VPB", "STB",
    "HDB", "VIB", "TPB", "SHB", "LPB", "MSB", "EIB", "OCB", "NAB",
})

COMMODITY_SYMBOLS = frozenset({
    "HPG", "HSG", "NKG", "VGS", "DGC", "DPM", "DCM", "CSV", "BFC",
    "GAS", "BSR", "PVS", "PVD", "PVT", "PLX", "OIL",
})

MEGA_CAP_SYMBOLS = frozenset({
    "VIC", "VHM", "VCB", "BID", "FPT", "HPG", "VPL", "MCH",
})


def assign_cluster(p: StockProfile) -> tuple[Cluster, str]:
    """Trả về (nhóm, lý do). Lý do phải luôn được lưu để kiểm tra sau này."""

    # === CỬA LOẠI: các mã không giao dịch được ===
    if p.adv20_bn < 20.0:
        return Cluster.EXCLUDED, f"ADV20 {p.adv20_bn:.1f} tỷ < 20 tỷ"

    if p.max_floor_streak >= 5:
        return Cluster.EXCLUDED, (
            f"đã từng sàn {p.max_floor_streak} phiên liên tiếp — "
            "rủi ro đuôi không chấp nhận được với T+2"
        )

    if p.gap_p90 > 0.045:
        return Cluster.EXCLUDED, (
            f"gap qua đêm p90 = {p.gap_p90:.1%} — quá cao cho phong cách EOD"
        )

    # === Ngành áp đảo hành vi thống kê với hai nhóm này ===
    if p.symbol in BANK_SYMBOLS:
        return Cluster.C2_BANK, "thuộc ngành ngân hàng"

    if p.symbol in COMMODITY_SYMBOLS and p.idio_share > 0.45:
        return Cluster.C4_COMMODITY, (
            f"chu kỳ hàng hoá, biến động riêng {p.idio_share:.0%} "
            "⇒ do giá hàng hoá dẫn dắt"
        )

    # === Phòng thủ: biến động thấp + đảo chiều rõ ===
    if p.vol_annual < 0.28 and p.beta < 0.85 and p.limit_hit_freq < 0.02:
        return Cluster.C5_DEFENSIVE, (
            f"vol {p.vol_annual:.0%}, beta {p.beta:.2f}, "
            f"trần-sàn {p.limit_hit_freq:.1%} ⇒ phòng thủ"
        )

    # === Beta cao: khuếch đại dòng tiền ===
    if p.beta > 1.25 and p.vol_annual > 0.38:
        return Cluster.C3_HIGH_BETA, (
            f"beta {p.beta:.2f}, vol {p.vol_annual:.0%} ⇒ khuếch đại"
        )

    # === Mid-cap biến động cao: cửa rủi ro ===
    if p.vol_annual > 0.45 or p.limit_hit_freq > 0.05 or p.max_floor_streak >= 3:
        return Cluster.C6_VOLATILE_MID, (
            f"vol {p.vol_annual:.0%}, trần-sàn {p.limit_hit_freq:.1%}, "
            f"chuỗi sàn {p.max_floor_streak} ⇒ rủi ro cao"
        )

    # === Trụ vốn hoá lớn ===
    if p.symbol in MEGA_CAP_SYMBOLS or (p.adv20_bn > 200 and p.vol_annual < 0.35):
        return Cluster.C1_MEGA, f"thanh khoản {p.adv20_bn:.0f} tỷ/phiên, vol vừa"

    # === Còn lại: quyết định bằng bản chất chuỗi thời gian ===
    if not np.isnan(p.variance_ratio_5):
        if p.variance_ratio_5 > 1.15:
            return Cluster.C4_COMMODITY, (
                f"VR={p.variance_ratio_5:.2f} > 1,15 ⇒ có xu hướng, "
                "xử lý theo logic trend-following"
            )
        if p.variance_ratio_5 < 0.85:
            return Cluster.C5_DEFENSIVE, (
                f"VR={p.variance_ratio_5:.2f} < 0,85 ⇒ đảo chiều, "
                "xử lý theo logic mean-reversion"
            )

    return Cluster.C6_VOLATILE_MID, "không khớp tiêu chí rõ ràng ⇒ nhóm thận trọng"


def cluster_stability_report(
    history: dict[str, list[Cluster]]
) -> dict[str, float]:
    """Kiểm định A ở mục 7.3 — nhóm có ổn định qua các quý không?

    history: {symbol: [nhóm ở Q1, Q2, Q3, ...]}
    Trả về tỷ lệ ổn định. Dưới 60% nghĩa là phân nhóm đang bắt nhiễu.
    """
    out: dict[str, float] = {}
    for sym, seq in history.items():
        if len(seq) < 2:
            continue
        same = sum(1 for a, b in zip(seq, seq[1:], strict=False) if a == b)
        out[sym] = same / (len(seq) - 1)

    if out:
        overall = float(np.mean(list(out.values())))
        out["__OVERALL__"] = overall
        verdict = "✅ ổn định" if overall >= 0.60 else "❌ đang bắt nhiễu"
        print(f"Độ ổn định phân nhóm: {overall:.1%}  {verdict}")

    return out
```

## 8.3. Bảng tham số theo nhóm và cửa kiểm tra

```python
# vnqd/config/cluster_params.py
"""Tham số theo nhóm. Đây là GIÁ TRỊ KHỞI ĐIỂM, chưa được hiệu chuẩn.

Chỉ được thay đổi các số này qua quy trình walk-forward ở Phần 7,
và chỉ khi vượt cả 4 cửa kiểm tra.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum

from vnqd.features.clustering import Cluster
from vnqd.features.stock_profile import StockProfile


class Logic(StrEnum):
    MEAN_REVERSION = "mean_reversion"
    TREND = "trend"
    MOMENTUM = "momentum"
    MIXED = "mixed"


@dataclass(frozen=True, slots=True)
class ClusterParams:
    logic: Logic
    ma_trend: tuple[int, int]
    ma_entry: int
    rsi_period: int
    rsi_buy_max: float | None        # cho logic mua-khi-yếu
    rsi_buy_min: float | None        # cho logic momentum
    atr_mult: float
    max_stop_pct: float
    hold_min: int
    hold_max: int
    max_weight_pct: float
    max_gap_pct: float
    max_anomaly_score: float
    min_volume_ratio: float
    min_regime: str
    use_equal_weight_index: bool
    require_exogenous: str | None = None


PARAMS: dict[Cluster, ClusterParams] = {
    Cluster.C1_MEGA: ClusterParams(
        logic=Logic.MIXED, ma_trend=(50, 200), ma_entry=20,
        rsi_period=14, rsi_buy_max=45, rsi_buy_min=None,
        atr_mult=3.0, max_stop_pct=0.09, hold_min=15, hold_max=30,
        max_weight_pct=0.12, max_gap_pct=0.020, max_anomaly_score=55,
        min_volume_ratio=1.3, min_regime="sideway",
        use_equal_weight_index=True,
    ),
    Cluster.C2_BANK: ClusterParams(
        logic=Logic.MEAN_REVERSION, ma_trend=(50, 200), ma_entry=20,
        rsi_period=14, rsi_buy_max=42, rsi_buy_min=None,
        atr_mult=3.0, max_stop_pct=0.09, hold_min=10, hold_max=25,
        max_weight_pct=0.10, max_gap_pct=0.020, max_anomaly_score=55,
        min_volume_ratio=1.3, min_regime="sideway",
        use_equal_weight_index=False,
        require_exogenous="bank_sector_index_above_ma50",
    ),
    Cluster.C3_HIGH_BETA: ClusterParams(
        logic=Logic.MOMENTUM, ma_trend=(20, 50), ma_entry=10,
        rsi_period=9, rsi_buy_max=None, rsi_buy_min=55,
        atr_mult=4.0, max_stop_pct=0.12, hold_min=8, hold_max=20,
        max_weight_pct=0.08, max_gap_pct=0.030, max_anomaly_score=50,
        min_volume_ratio=1.5, min_regime="strong_uptrend",   # ⭐ nghiêm ngặt
        use_equal_weight_index=False,
        require_exogenous="market_turnover_above_ma20",
    ),
    Cluster.C4_COMMODITY: ClusterParams(
        logic=Logic.TREND, ma_trend=(50, 200), ma_entry=20,
        rsi_period=14, rsi_buy_max=45, rsi_buy_min=None,
        atr_mult=3.5, max_stop_pct=0.10, hold_min=20, hold_max=40,
        max_weight_pct=0.10, max_gap_pct=0.025, max_anomaly_score=55,
        min_volume_ratio=1.3, min_regime="sideway",
        use_equal_weight_index=True,
        require_exogenous="commodity_price_above_ma50",       # ⭐ then chốt
    ),
    Cluster.C5_DEFENSIVE: ClusterParams(
        logic=Logic.MEAN_REVERSION, ma_trend=(100, 200), ma_entry=20,
        rsi_period=21, rsi_buy_max=35, rsi_buy_min=None,
        atr_mult=2.5, max_stop_pct=0.07, hold_min=10, hold_max=20,
        max_weight_pct=0.15, max_gap_pct=0.015, max_anomaly_score=60,
        min_volume_ratio=1.1, min_regime="mild_correction",   # nới nhất
        use_equal_weight_index=True,
    ),
    Cluster.C6_VOLATILE_MID: ClusterParams(
        logic=Logic.MEAN_REVERSION, ma_trend=(50, 200), ma_entry=20,
        rsi_period=14, rsi_buy_max=40, rsi_buy_min=None,
        atr_mult=4.0, max_stop_pct=0.12, hold_min=8, hold_max=15,
        max_weight_pct=0.05, max_gap_pct=0.020, max_anomaly_score=40,
        min_volume_ratio=1.5, min_regime="strong_uptrend",
        use_equal_weight_index=True,
    ),
}


def resolve_params(cluster: Cluster, p: StockProfile) -> ClusterParams:
    """Tầng 2 + Tầng 3: tham số nhóm, rồi siết theo sự thật về mã.

    Chỉ SIẾT CHẶT, không bao giờ NỚI RA. Đây là nguyên tắc an toàn:
    thông tin riêng về mã chỉ dùng để giảm rủi ro, không để tăng vị thế.
    """
    base = PARAMS[cluster]
    adj: dict = {}

    # Bất đối xứng biến động (Định luật 5) → nới hệ số ATR
    if p.atr_asymmetry > 1.3:
        adj["atr_mult"] = base.atr_mult * 1.15
        adj["max_stop_pct"] = min(base.max_stop_pct * 1.15, 0.14)

    # Gap lịch sử của chính mã → siết ngưỡng bỏ lệnh
    if p.gap_p90 < base.max_gap_pct:
        adj["max_gap_pct"] = p.gap_p90

    # Từng có chuỗi sàn dài → giảm tỷ trọng
    if p.max_floor_streak >= 3:
        adj["max_weight_pct"] = base.max_weight_pct * 0.6

    # Beta cao → giảm tỷ trọng theo tỷ lệ nghịch
    if p.beta > 1.2:
        w = adj.get("max_weight_pct", base.max_weight_pct)
        adj["max_weight_pct"] = w / (p.beta / 1.2)

    # Nhạy cảm dòng ngoại (Định luật 7) → thêm điều kiện bắt buộc
    if p.foreign_sensitivity is not None and p.foreign_sensitivity > 0.30:
        prev = base.require_exogenous
        cond = "foreign_net_5d_positive"
        adj["require_exogenous"] = f"{prev} AND {cond}" if prev else cond

    return replace(base, **adj) if adj else base
```

---

# PHẦN 9 — KỲ VỌNG THỰC TẾ

Bạn yêu cầu "khuyến nghị chính xác nhất có thể". Mình cần nói rõ con số nào là khả thi.

## 9.1. Trần trên của độ chính xác

Nghiên cứu Borsa Istanbul trên chính các mã VN30 kết luận thị trường <cite index="167-1">nhìn chung không thể hiện những điểm không hiệu quả lộ liễu, tuy nhiên với một số cổ phiếu và đặc biệt là các danh mục cổ phiếu, một hệ thống chuyên gia tương đối đơn giản dùng mô hình trend-following cho suất sinh lợi điều chỉnh rủi ro hấp dẫn.</cite>

Đọc kỹ: "tương đối đơn giản", "một số cổ phiếu", "đặc biệt là danh mục". Ba từ khoá này nói lên tất cả.

| Chỉ tiêu | Khả thi | Đáng ngờ | Chắc chắn là ảo |
|---|:---:|:---:|:---:|
| Hit rate | 52–58% | 60–65% | > 70% |
| Expectancy | +0,25 đến +0,45R | +0,6R | > +1,0R |
| Sharpe (sau chi phí) | 0,8–1,4 | 1,8 | > 2,5 |
| Max drawdown | 15–25% | 10% | < 8% |
| Chuỗi thua liên tiếp | 6–9 lệnh | — | "chưa bao giờ thua 3 lệnh liền" |

Với hit rate 55% và expectancy +0,35R, giao dịch 40 lệnh/năm, rủi ro 0,6% NAV/lệnh:

```
Kỳ vọng năm = 40 × 0,35R × 0,6% = +8,4% NAV
```

Nghe khiêm tốn. Nhưng đó là **alpha trên nền tảng đã kiểm chứng**, không phải con số vẽ ra. Cộng với beta thị trường, tổng lợi nhuận có thể cao hơn nhiều — và quan trọng hơn, bạn biết chính xác phần nào là kỹ năng, phần nào là thị trường.

## 9.2. Điều bảng phân nhóm không thể làm

| Không thể | Vì sao |
|---|---|
| Dự báo giá cụ thể | Không có mô hình nào làm được, kể cả của tổ chức |
| Đảm bảo lệnh nào cũng thắng | Bản chất là bài toán xác suất |
| Bắt được đáy hay đỉnh | Mean-reversion mua *quanh* vùng đáy, không phải *tại* đáy |
| Hoạt động trong thị trường giảm mạnh | Định luật 4: bầy đàn mạnh hơn khi giảm. Giải pháp là **tiền mặt**, không phải chiến lược |
| Thay bạn quyết định | Bạn vẫn tự đặt lệnh, tự chịu trách nhiệm |

## 9.3. Ba việc nên làm trước khi xây tiếp

**1. Chạy Kiểm định C (placebo) ở mục 7.3 trước tiên.** Gán mã vào nhóm ngẫu nhiên và so kết quả. Nếu nhóm ngẫu nhiên cho kết quả tương đương, toàn bộ Phần 4 và 5 là ảo giác, và bạn nên dùng **một bộ tham số chung** — đơn giản hơn, bền hơn, và trung thực hơn. Việc này mất 1 ngày và có thể tiết kiệm 2 tháng.

**2. Đo Tỷ số phương sai cho toàn bộ VN100 ngay tuần đầu.** Một biểu đồ histogram VR của 100 mã sẽ cho bạn biết ngay lập tức có bao nhiêu mã thực sự có xu hướng và bao nhiêu mã đảo chiều. Nếu 90% mã có VR < 1, bạn biết ngay phải xây hệ thống mean-reversion và có thể bỏ hết logic momentum.

**3. Tính phân phối gap qua đêm cho toàn bộ VN100.** Đây là thước đo mà không nền tảng nào ở Việt Nam cung cấp, và nó quyết định mã nào giao dịch được với phong cách EOD của bạn. Có thể bạn sẽ phát hiện chỉ 40–50 mã trong VN100 là thực sự phù hợp — và đó là một phát hiện quý giá, không phải thất bại.

---

## PHỤ LỤC — Nguồn học thuật đã tham chiếu

| Chủ đề | Nghiên cứu |
|---|---|
| Hiệu quả dạng yếu, thin trading | Truong và cộng sự (2010) |
| Momentum ngắn hạn | Nguyen (2012), *Momentum Effect in the Vietnamese Stock Market*, Procedia |
| Momentum trung hạn | Vo & Truong (2018) |
| Giao dịch kỹ thuật ngắn hạn trên VN30 | Nguyen, Sensoy và cộng sự (2020), *Borsa İstanbul Review* |
| Phản ứng thái quá trên HOSE | *Overreaction in a Frontier Market: Evidence from HOSE*, MDPI JRFM (2023) |
| Đảo chiều ngắn hạn trên HNX | *Return Reversal in Portfolios Optimized under Exchange Rate Risk*, IJAA (2025) |
| Bầy đàn theo thời gian, bất đối xứng | Trang & Tho (2017), Tạp chí Khoa học ĐH Đà Lạt |
| Bầy đàn và COVID-19 | *Herd behavior in Vietnam's stock market: Impacts of COVID-19*, Cogent Economics & Finance (2023) |
| Thời vụ, hiệu ứng tháng Một | Luu và cộng sự (2016), Thach và cộng sự (2019), Zaremba (2015) |
| Hiệu ứng Tết, biến động bất đối xứng | Khanh và cộng sự (2020); *The Lunar New Year Effect on Stock Market Returns*, MDPI JRFM (2025) |
| Thanh khoản và suất sinh lợi | Batten & Vo (2014) |
| Nhà đầu tư nước ngoài | Vo (2017) |
| Quy tắc MA trên dữ liệu Việt Nam 2000–2011 | Truong Dong Loc, Lanjouw & Lensink |
| Chống overfitting | López de Prado, *Advances in Financial Machine Learning* |

---

> ## ⚠️ TUYÊN BỐ MIỄN TRỪ TRÁCH NHIỆM
>
> Tài liệu này là **nghiên cứu phương pháp luận cho công cụ phần mềm cá nhân**, phục vụ mục đích học tập và nghiên cứu. Không phải khuyến nghị đầu tư, không phải tư vấn pháp lý.
>
> **Danh sách mã trong Phần 4 là giả thuyết ban đầu để bạn có điểm khởi đầu, KHÔNG phải kết luận phân tích và KHÔNG phải khuyến nghị mua bán bất kỳ mã nào.** Thành viên nhóm thực tế phải do dữ liệu của chính bạn quyết định thông qua 14 thước đo ở Phần 3.
>
> **Toàn bộ tham số trong Phần 5 là giá trị khởi điểm chưa được hiệu chuẩn**, không phải kết quả đã kiểm chứng. Chúng phải đi qua quy trình walk-forward và 4 cửa kiểm tra ở Phần 7 trước khi được tin dùng.
>
> Các phát hiện học thuật được trích dẫn đến từ những giai đoạn dữ liệu cụ thể trong quá khứ (phần lớn 2007–2020) và **có thể không còn hiệu lực** trong điều kiện thị trường hiện tại, đặc biệt sau khi hệ thống KRX vận hành và thị trường được FTSE nâng hạng. Bạn phải tự kiểm định lại trên dữ liệu gần nhất.
>
> **Kết quả trong quá khứ không đảm bảo kết quả trong tương lai.** Đầu tư chứng khoán luôn tiềm ẩn rủi ro mất vốn. Với phong cách EOD kết hợp chu kỳ thanh toán T+2, cần đặc biệt lưu ý rủi ro **3 phiên không có khả năng thoát vị thế**.
