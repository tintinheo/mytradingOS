# VN100 Credibility Release 1 — 5 October 2026

P0 follow-up: see [the incremental reliability report](p0-reliability-2026-10-05.md), which supersedes the no-fallback implementation note below.

Classification: **EXPERIMENTAL**. Implemented software controls do not establish an investment edge. Baseline source: `cd36c3d3ef56b66f73d376cefe0e950da6bf7fea` (live v11); this supersedes the assessment based on `3dee5821...`.

## Priority status

| Priority / proposal | Current implementation | Remaining acceptance evidence |
|---|---|---|
| P0 HTML/JSON FPT failure | Shared HTTP/content-type/body/schema boundary; audit-start regression; no direct browser hostname fallback | Live authenticated FPT end-to-end run not verified in this environment |
| P0 independent OHLCV validation | Existing separately captured DNSE/CafeF comparison retained; final gate now requires verified upstream lineage | No documented independent upstream lineage. Agreement alone never sets VERIFIED. No licensed third independent provider was added |
| P0 data-quality gate | VERIFIED/WARNING/QUARANTINED/UNAVAILABLE; completeness checklist, freshness, reconciliation and final NO SIGNAL | Checklist score is not probability; provider independence remains unknown |
| P0 exchange calendar | Sourced 2026 holiday schedule; conflict detection in quality, reconciliation and forecast dates; explicit unknown-year behavior | Historical years and future special closures require reviewed records; imported omissions still require reconciliation |
| P0 corporate actions | Existing forward adjustment, raw preservation, cash/share entitlements and publication dates; strengthened factor validation | Rights/other events without modeled cash flow remain blocked; no fabricated event history or subscription assumptions |
| P0 point-in-time universe | Existing account-scoped market profile repository retains effective/announcement dates and removals; regression verified | Official historical VN100 constituent snapshots are not loaded. Watchlist remains user supplied |
| P0 walk-forward | Existing fixed-parameter chronological folds, warmup, costs and stress retained; added hit rate, gain/loss, fold Sharpe/Sortino and asset-regime daily performance | No real-market OOS result established; parameter search/optimization intentionally not added |
| P0 probability calibration | Equal-log-weight ensemble; past residual distribution; first 60 matured predictions calibrate 5 bins; later observations test Brier, ECE and interval coverage | At least 30 scored test observations and adequate bins required; preliminary metrics are not prospective validation |
| P1 regimes/profiles | Index BULL/BEAR/SIDEWAYS and volatility state; sector, turnover, beta, gaps, drawdown, return autocorrelation | Sector/index provenance remains supplied by user; no sector-specific fitted models claimed |
| P1 ensemble/uncertainty | Momentum, mean reversion, optional same-regime forecast; empirical residual P10/P50/P90 | No complex ML or externally trained model; optional unavailable component omitted, at least two required |
| P1 trap/liquidity | Existing anomaly timeline, capacity, lots, band/settlement/cost controls retained; high trap risk vetoes final decision even if exploratory filter disabled | No order book, spread, auction queue or ownership concentration feed; execution remains daily approximation |
| P1 audit/explanation | Frozen final decision and evidence saved; scan/history consistent; replay CLI checks hashes and same-version result; prospective ensemble scoring | Real prospective outcomes must mature; old-version replay requires its historical source checkout |
| P2 portfolio | Existing account-scoped balances, holdings, reservations and risk/correlation proxy retained; incomplete credibility demotes conditional plans to paper-only | No brokerage synchronization or order placement |
| P2 fundamentals/events | Supplied corporate actions remain available | Automated earnings/news/fundamental ingestion is NOT implemented; needs an authorized, reliable event source |

## Architecture and data contract

`browser → /api/audit + /api/ohlcv → captureSource → HTTP status → Content-Type → bounded body → JSON → normalizer → future-date check → source capture → reconciliation → frozen server-computed snapshot`.

`http-json.mjs` is shared across all application API clients and provider ingestion. Trusted same-origin APIs may return bounded typed JSON errors; upstream HTML is never rendered or included in messages. The FPT message “Chưa bắt đầu phân tích” originated from the audit-start catch before OHLCV fetching, so correcting only the data endpoint would have missed that path. No live incident root cause is claimed without its response capture.

The provider adapter reuses DNSE's legacy host only for transport failure or documented availability statuses already permitted by the adapter. It does not rotate hostnames on 403/429. The UI's direct-browser provider retry was removed. Cross-provider reconciliation captures both providers independently; failure suppresses verification. Automatic swapping of the analysis source is deliberately not done because undeclared price units/adjustment conventions and audit source identity cannot be safely interchanged. Select the alternate provider explicitly and reconcile its basis. Responses are capped at 4 MB, captures at 1,000 bars, and capture attempts at 10 seconds each. There is no unbounded 429 retry loop.

## Decision pipeline

Existing technical conditions and simulated/actual positions remain separate. The added final recommendation is:

1. Data integrity/freshness/calendar/history.
2. Matching reconciliation AND verified independent origin.
3. Chronological OOS strategy evidence.
4. Empirically evaluated forecast calibration.
5. Trap, uncertainty, liquidity and market-index regime checks.
6. Signal conflict, portfolio/execution feasibility and net reward/risk.
7. Final `NO SIGNAL`, `WATCH`, `HOLD`, `BUY` or `SELL`.

`STRONG BUY` and `REDUCE` are reserved supported states; no arbitrary rule emits them. Missing evidence produces NO SIGNAL, not a numerical confidence. Technical levels and paper plans can still be inspected and are labeled separately. Model confidence is an upward-close probability, not a probability that a trade earns money. Final confidence is currently the same directional probability only when all gates pass; it is not a separately calibrated trade-success measure.

## Ensemble and calibration method

At origin t, each available component forecasts close at t+h. Combine component log prices equally; no weights are fitted to test returns. Form historical residuals `log(actual / ensemble point)` from forecasts whose targets have matured at t, with horizon-spaced origins in the preceding 504 rows. Apply those residuals to the current forecast return. Distribution quantiles give P10/P50/P90; the smoothed fraction of simulated returns above zero gives a raw upward probability. The forecast is a terminal distribution; no ensemble intrahorizon path is invented.

Chronological origin indices start at 119 and advance by h. First 60 matured forecasts calibrate five fixed probability bins with Laplace smoothing. A bin needs 12 calibration observations before its test predictions can be scored. Subsequent nonoverlapping target intervals are evaluation-only; their labels never refit the calibration bins. There is no random time-series split.

Brier = mean((p−y)^2). ECE = sum(bucket fraction × |mean probability−observed frequency|). Baseline probability is the smoothed upward frequency in calibration. Preliminary eligibility requires ≥30 scored test observations, lower Brier than baseline, ECE ≤0.1, observed P10–P90 coverage in [0.7,0.9], and enough current-bin support. These are explicit lab policy thresholds, not universal statistical guarantees. Results are grouped by asset regime. User parameter selection and repeated inspection of test results can still overfit.

The tagged feature-availability guard rejects declared future features; it is not a general detector for an untagged arbitrary future-derived feature. Prefix-shock tests exercise the actual ensemble and existing backtests. The shuffled-label negative control is synthetic; it does not establish that the real ensemble has predictive power.

## Backtest and risk methodology

Existing next-session execution, conservative stop-before-target collisions, T+ locks, delayed cash, fees/slippage, prior-volume capacity, lots and special-session restrictions remain. No forecast is injected into historical strategy decisions. Corporate actions use the original raw execution prices and a separate forward-normalized technical series. Unsupported rights accounting fails closed. VWAP, spread, intraday path and auction queues cannot be reconstructed from daily OHLCV.

Added fold Sharpe and Sortino use daily marked-equity returns, 252-session annualization and zero risk-free rate. Zero denominators return null. Fold drawdowns are not represented as a stitched portfolio drawdown. Asset-regime daily performance assigns the preceding session's regime; descriptive beta uses matching stock/index intervals. These are diagnostics, not optimized trading parameters.

## Audit and reproducibility

The existing immutable D1 snapshot now includes `recommendation`, `assetProfile`, `ensembleEvidence`, enhanced validation and calendar review. Existing schema version 4 gains additive fields; old snapshots remain readable. Engine version changes to `swing-2026.10.05-credibility.1`. No database schema migration is needed.

The audit's searchable recommendation column records the final state, while the original technical `decision` stays inside the snapshot. New and legacy states are accepted by history filters. Prospective outcome records carry the frozen ensemble probability and score it only after exact maturity with matching source/basis, unchanged origin data and reconciled actions. Ensemble observations deduplicate across UI forecast selections at the same ticker/origin/horizon/engine/source.

Replay a full JSON audit export using the matching source version:

```sh
node scripts/replay-audit.mjs /absolute/path/to/vn100-audit.json
```

The command checks the original payload hash, rejects mismatched engines, rebuilds from frozen inputs/time/reconciliation, and compares canonical snapshot hashes. Compact history responses cannot substitute for full exports.

## Verification

Baseline after dependency restoration: **68 passed / 0 failed / 0 skipped**. The initial pre-install attempt could not load four suites because zod was absent; that was an environment prerequisite, not converted to a pass.

Final regression: **89 passed / 0 failed / 0 skipped** using:

```sh
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

New tests cover typed JSON/HTML failures, 403/429/500, invalid/future OHLCV, response-body timeout, actual audit-start HTML recovery for FPT, gate abstention, holiday/T+ dates, split preservation, membership join/removal, hand-computed Brier/ECE, chronological calibration isolation, future shocks, synthetic shuffled labels, scale invariance, index regimes, asset metrics, and snapshot reproduction. Existing tests cover ownership, immutable audit/reconciliation, costs, settlement, capacity, stop/target collisions, raw/adjusted actions, and prospective maturity/revisions.

Not executed: authenticated browser/live FPT provider end-to-end validation, real-provider historical OOS performance, a licensed independent-source comparison, or a prospective paper-trading period. Browser control support required by the preview workflow was unavailable. Test fixtures are synthetic and are not investment-performance evidence.

## Operational next gates

1. Acquire documented independent OHLCV provenance and explicit units/basis/volume semantics. Add an authenticated provider adapter and validate actual overlapping historical bars; do not flip the lineage flag without evidence.
2. Load official corporate-action and historical VN100 constituent records, plus reviewed calendars beyond 2026. Resolve unsupported rights cash-flow elections before extending execution support.
3. Run chronological evaluation on the target tickers with revisions/costs/regimes tracked. Report actual metrics and failed gates, never a fabricated universal win rate.
4. Accumulate prospective observations and evaluate calibration/drift. Promotion to paper-trading or personal decision support requires this evidence.
5. Add licensed fundamental/event ingestion and intraday execution inputs if the intended decisions require them.

## Primary methodology and calendar references

- https://otexts.com/fpp3/tscv.html
- https://otexts.com/fpp3/prediction-intervals.html
- https://scikit-learn.org/stable/modules/calibration.html
- HNX 2026 schedule: https://www.gov.hnx.vn/vi-vn/chi-tiet-lich-nghi-gd-60021971.html?_page=1
- HNX Jan 2 amendment: https://www.hnx.vn/vi-vn/chi-tiet-lich-nghi-gd-60022084.html?_page=1
- HOSE notices (exchange originals mirrored by CafeF): https://cafef1.mediacdn.vn/download/240426/hose-thong-bao-lich-nghi-giao-dich-nam-2026-0.pdf and https://cafef1.mediacdn.vn/download/240426/hose-thong-bao-lich-nghi-giao-dich-nam-2026-1.pdf
