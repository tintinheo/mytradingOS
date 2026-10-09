# Swing T+ research and implementation decision log

Reviewed 27 September 2026. This is a methods review and an implementation record, not evidence that any strategy generates excess returns on Vietnamese equities. Production source availability and corporate-action adjustment remain unresolved; see `source-research.md`.

## What changed

The private lab now separates three things: observed OHLCV characteristics, historical trading simulations, and exploratory future-price scenarios. No forecast creates an order or drives the strategy backtest. Every ticker is profiled from its own history; the app does not hard-code FPT, HPG, VCB or another symbol as permanently trending, defensive, cyclical or speculative.

| Question | Implemented measure | Decision supported, with limits |
| --- | --- | --- |
| Does this ticker currently trend? | EMA20/50, ADX14; up/down/range/mixed classification after 60 bars | Match a hypothesis to the observed regime. ADX measures strength, not bullishness. |
| Is volatility unusual for this ticker? | ATR14/close, percentile versus up to 252 previous ATR% observations, absolute opening-gap P90 over recent bars | Scale a planned stop and position; gap/settlement risk can exceed it. |
| Does activity confirm the move? | Volume divided by the prior 20-bar average; minimum average-volume input | Reject thin histories or require participation. Share volume alone does not establish capacity in VND. |
| Has momentum recovered? | Wilder RSI14 crossing 50 in a pre-existing up regime | Test recovery; RSI oversold alone is not a reversal signal. |
| Is price returning inside a range? | Bollinger SMA20 ± 2 population standard deviations, RSI, ADX | Test band re-entry only in a low-ADX regime. Touching a band is insufficient. |
| Can the shares be sold? | Conservative T+ lock, deferred stop/signal, holding limit, pending sale cash | Make settlement assumptions explicit. Daily OHLCV cannot establish afternoon execution. |
| Does a price model add information? | Rolling-origin evaluation against unchanged price on matched dates | Display errors, directional hit rate, interval coverage and sample size; allow an unfavorable result. |

## Vietnam-specific findings and implementation choices

VSDC's current clearing and settlement service page identifies T+2 for equities and references Decision 39/QĐ-HĐTV dated 29 April 2025 [1]. SSI's equity FAQ describes purchased shares arriving after 13:00 on T+2 [2]. The lab therefore defaults to the next complete daily opening, T+3, for selling a newly purchased position. This is a conservative modeling convention, not a statement that the legal settlement cycle is T+3. Both signals and stopped positions wait for eligibility. A stop breached while locked is executed at the first eligible modeled opening, even if the price has subsequently recovered; this sticky-stop convention is explicit.

Sale cash defaults to reuse at T+3 as a separate conservative assumption. SSI describes earlier cash availability [2]; a zero-delay option represents assumed advance financing, whose cost must be reflected by the user. Existing unused cash remains available. All holding and settlement offsets count supplied session rows; holidays are not generated, and missing/suspended sessions can overstate waiting time.

A zero-volume or one-price daily candle is excluded from hypothetical fills. This deliberately conservative, retrospective filter can also reject genuinely tradable bars. It does not verify the exchange reference price, price limit, queue, or a counterparty. HOSE/HNX/UPCoM price bands, lot/tick rules, auction mechanics, special trading restrictions, cash dividends and rights are not reconstructed. The app must not imply that a daily low guaranteed a realizable stop fill.

Ticker characteristics beyond OHLCV require additional evidence: official sector classification, free float, institutional ownership, corporate actions, reporting dates, issuer news and aligned market/sector benchmarks. None is inferred from a ticker string. Large price jumps, thin volume, flat bars and unusually high own-history ATR trigger data/risk notes. A current-membership watchlist is not a point-in-time VN100 universe.

## Strategy hypotheses implemented

All rules are fixed research hypotheses, not tuned VN100 findings. Entry filters use information through the signal close and entry is considered at the next opening.

- **Trend pullback:** up regime (ADX≥25, EMA20>EMA50 and close>EMA50), RSI crossing upward through 50, close>EMA20. Exit signal below EMA20.
- **Confirmed breakout:** same up regime, close above the previous 20 intraday highs and relative volume≥1.5. Exit signal below EMA20.
- **Range recovery:** ADX<20, previous close below its lower Bollinger band with previous RSI<35, current close back inside/above the lower band. Exit at SMA20 or when ADX≥25.
- **Comparators:** SMA crossover, close-based breakout and true full-capital buy-and-hold. The latter ignores stop/target, holding limit and entry filters; it is marked to the same final close without an invented liquidation fee.

ATR stops use the signal day's ATR, fixed on entry, with independently configurable stop/target multiples. Exposure is capped at 100% and calculated from the risk fraction of available cash divided by stop distance as a fraction of entry. Gaps, costs and a T+ lock can exceed the intended loss budget. No trailing-stop interpretation is implied.

## Forecast and validation

Horizons are 3, 5 and 10 supplied trading sessions after the final close, distinct from settlement days counted after entry. The four models are: unchanged close, 20-return log drift, fixed 0.9-decay toward SMA20, and an empirical distribution of completed returns from the same regime.

Regime samples are spaced by the horizon, taken from at most 504 prior sessions, and included only when the entire forward outcome is known at the forecast origin. At least 12 matched outcomes are required. The median return forms the center; P10/P90 form an empirical envelope. Observed up-frequency is descriptive, not an estimated guaranteed future success probability.

The other models use P10/P90 of historical log forecast errors with at least 12 completed outcomes. Intermediate shaded points scale terminal log dispersion by square root of the horizon fraction; only the terminal interval is empirically evaluated. The center can lie outside an asymmetric empirical error interval; it is not forcibly moved to improve the display.

Rolling evaluation uses up to 40 origins, at least 120 bars of history at an origin, and non-overlapping target intervals. Each origin fits only on information then available. Model-specific missing forecasts are skipped; unchanged-price errors are calculated on exactly the same valid origins as each model. The table displays mean absolute price error divided by origin price, direction accuracy (unchanged-price has no directional call), interval coverage, and observation counts. Adjacent training sets overlap, so observations are not claimed to be independent. Twelve observations are only a UI minimum, not a significance test. Repeated user tuning can still overfit these results. Strategy comparisons remain in-sample and are labeled separately from forecast evaluation.

## Methods considered for later work

MACD, stochastic and additional moving-average oscillators largely repeat price/momentum information already present; adding correlated indicators should not create artificial confidence. OBV/accumulation measures and anchored VWAP could add volume context, but need explicit anchor rules and verified volume/price units. Market-relative strength, breadth and sector context deserve priority once synchronized benchmark data are available. No such feature is claimed in this release.

ARIMA, volatility models such as GARCH, regime-switching models, gradient-boosted trees and neural networks remain candidates, not implemented recommendations. A responsible next comparison would use a stable adjusted panel, strictly chronological train/validation/test splits, purge overlapping forward labels, benchmark against unchanged price, assess transaction costs and liquidity, and preserve an untouched final period. Model complexity alone is not evidence of predictive value.

## Primary sources and scope

1. VSDC, current clearing and settlement overview: https://vsdc.vn/vi/sd/XAz40d2Q-9j569TvBgLQaQ
2. SSI, equity FAQ, settlement question: https://www.ssi.com.vn/khach-hang-ca-nhan/co-phieu-faq
3. Fidelity, ATR definition and Wilder recurrence: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr
4. Fidelity, ADX trend-strength conventions: https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX
5. Fidelity, RSI definition and behavior in strong trends: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi
6. John Bollinger, original band rules, including the limits of band touches and normal-distribution assumptions: https://www.bollingerbands.com/bollinger-band-rules
7. Hyndman and Athanasopoulos, Forecasting: Principles and Practice, rolling-origin cross-validation: https://otexts.com/fpp3/tscv.html

Sources establish definitions and market mechanics. They do not endorse the lab's combined thresholds, minimum samples, trading profitability or current ticker recommendations.

## Validation record

Automated tests cover independent indicator reference values, absence of future leakage in features/signals/equity/predictions, T+ deferred stops, settlement of cash, time exits, previous-bar ATR sizing, the buy-and-hold benchmark, hand-calculated forecast errors, price-unit invariance and invalid parameter rejection. Browser checks use an explicitly named QAONLY synthetic CSV; those results are software checks only. Live DNSE and CafeF requests failed in the managed preview on this review date. The app suppresses fresh signals on those failures and retains CSV import. No successful real-market performance validation or production feed availability is claimed.

## Tóm tắt áp dụng bằng tiếng Việt

Bản cập nhật phân loại đặc tính **hiện tại của từng mã**, không gán cố định tính chất theo tên cổ phiếu. Các nhóm tín hiệu có điều kiện rõ ràng và mô hình forecast có đối chứng giá không đổi. T+3 là giả định thận trọng cho dữ liệu ngày khi cơ chế thực tế là T+2; stop có thể vượt mức kế hoạch trước khi cổ phiếu bán được. Dải dự báo và tần suất lịch sử không bảo đảm tương lai. Chưa có kiểm chứng lợi thế giao dịch trên dữ liệu thực VN100; cần bổ sung dữ liệu điều chỉnh quyền, lịch sự kiện và ngữ cảnh ngành/thị trường trước khi nâng mức tin cậy. Công thức và giới hạn chi tiết bằng tiếng Việt nằm trong mục Method, sources & limitations của ứng dụng.
