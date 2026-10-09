# VN market execution and price-risk research — 2026-09-29

This release extends the existing long-only EOD research lab. The live guide is `public/lab/market-guide.html`; it documents the input contract, formulas, model assumptions and source links. Its numerical examples are synthetic, never loaded as market data automatically.

## Source evidence and epistemic boundary

Checked primary sources on 2026-09-29:
- SSI, stock trading rules: https://www.ssi.com.vn/khach-hang-ca-nhan/quy-dinh-giao-dich/quy-dinh-giao-dich-co-phieu
- SSI, stock FAQ: https://www.ssi.com.vn/khach-hang-ca-nhan/co-phieu-faq
- SEC Investor.gov, pump-and-dump: https://www.investor.gov/protect-your-investments/fraud/types-fraud/pump-and-dump-schemes

SSI's current rules describe venue-specific price bands, tick sizes and standard lots, special sessions and settlement. We implement a conservative daily model from 2025-05-05 onward. Using T+3 open is a model convention, not a claim that official settlement is T+3. ATO/ATC priority and counterpart availability cannot be reconstructed from OHLCV. Explicit daily reference/ceiling/floor inputs are required, including for UPCOM.

SEC's description contains misleading promotion and disposal by actors. Daily price/volume patterns cannot establish these elements. Consequently the application never labels a security as manipulated or assigns a probability of manipulation. Risk scores rank further review; thresholds are lab hypotheses, not parameters validated by those sources.

## Implemented risk model

Eight observable types: upthrust, spring, failed breakout, failed breakdown, runup/distribution, volume shock, large opening gap and zero-volume/flat bars. Lookback windows exclude the current bar. Failed breaks are dated at observed failure, never retroactively at breakout. Cooldown is 3 observed bars inclusive. Correlated repeated events use maxima within groups; highest group plus capped half of second group determines review score. A high score (60+) blocks new entries when enabled. Existing stops/sells remain executable only under the trading model; no automatic forced liquidation by risk score.

Event-outcome summaries require completed targets and spaced origins. They describe selected historical samples, not classifier accuracy, investment advantage, or independent out-of-sample validation. No labeled enforcement dataset was available. News, dividends, index rebalancing and illiquidity can produce similar patterns.

## Execution and data contract

`vn-market.mjs` validates versioned per-symbol contexts. Prices in session reference/limits are VND; OHLCV unit is explicitly VND or thousand-VND. A single context assumes no exchange migration; split the backtest interval when the venue changes. Coverage assertions are user supplied and not authenticated source certifications.

`vn-execution.mjs` maintains cash, unsettled sale proceeds, cash dividend claims, available shares and pending share entitlements. Trades are rounded to 100 shares, planned capacity uses only prior 20-bar volume; observed same-day volume can only reduce the realized fill under the participation cap, entry/exit prices use daily raw OHLCV and tick rounding. Restricted/suspended/special sessions and one-price/zero-volume bars are excluded. Limit-open queues are conservatively rejected. Partial exits carry remaining inventory; odd lots stay marked without inventing sale liquidity. All equity is normalized to initial capital for chart compatibility.

Supported corporate events require a supplied reconciliation factor and dates: net cash dividends, share bonuses and splits with ratio >=1. Entitlements are recognized on ex-date; cash/shares become usable only on supplied payment/tradable dates. Forward-normalized technical bars incorporate events only from ex-date. Adjusted input is never mixed with raw execution plus a second rights ledger. Rights subscriptions, multiple simultaneous events, reverse splits and fractional entitlement policies remain explicitly unsupported and block relevant performance calculations.

Calendars count market sessions independently of missing security bars. Missing regular bars block execution; declared suspensions can explain an absent bar. Current-data freshness uses a calendar covering today when available, otherwise the existing 7-calendar-day fallback. Point-in-time membership checks effective ranges and knownAt; an optional entry gate requires membership. Benchmarks align exact dates and report 20-common-session excess returns without inferring missing sector fundamentals.

## Persistence and security

New D1 `market_profiles` rows have `(user_id,symbol)` keys. GET/POST/DELETE require platform identity and scope SQL by user. Imports validate before an atomic batch upsert. Audit embeds each input profile, so later profile updates/deletion cannot rewrite prior recommendations. JSON exports retain original inputs; list/detail strip bulky series. Snapshots cap stored detector events at 200 with a total count and retain original inputs, thresholds and version for deterministic reproduction. Per-profile and snapshot size limits protect D1 storage constraints.

## Limitations to keep visible

No automatic authoritative feeds for daily rules/calendar/rights/constituents/benchmarks; use documented JSON imports. No order book, actor attribution, hidden orders, order cancellation, foreign room, real portfolio, news sentiment or accounting analysis. Fees are user assumptions rather than synchronized brokerage schedules. Theoretical research mode keeps its fractional-share model and cannot be read as executable performance. Strategy parameters have not been optimized or validated on an untouched market dataset. Software tests do not prove predictive power.
