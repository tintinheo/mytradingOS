# VN100 Strategy Lab v10 — decision integrity and evidence

Source baseline: v9 (`dfb4eb1f92eb8bb91b6846247f531c45b2bd2a06`). Review and implementation: 2026-10-04.

## Implemented

- Explicit freshness states against the imported calendar. A missing calendar is not treated as fresh merely because the last bar is under seven days old. Future/incomplete daily bars cannot authorize new personal plans.
- Shared entry geometry across recommendation and simulation, including exchange tick rounding. Market signal, historical simulated position, and actual-account plan are separate snapshot fields.
- Announced supported corporate actions adjust forecast points on their ex-date. Unsupported rights or missing future calendar suppress the numerical forecast; actions not yet known at origin are excluded.
- Partial target exits retain their limit target for the residual, rather than converting it to a next-open market exit.
- Outcome descriptions for risk alerts use the combined blocking score, with horizon spacing.
- Account-scoped portfolio persistence with optimistic concurrency. Import/export JSON and editable holdings, available/pending shares, opening date, average cost, mark, stop, target and risk limits. No fabricated user holdings or brokerage connection.
- VND order plans consider round lots, maximum entry price, bid capacity proxy, fees and sell surcharge, cash, per-stock/sector/gross/risk limits, and conservative correlated concentration. Unknown correlations are treated as a single group, not estimated or claimed. Scans reserve hypothetical money and risk in input priority order, saving those reservations in the audit.
- Fixed-parameter rolling-origin strategy evaluation: 120+ bar warmup, 60-bar folds, up to five folds, matched buy-and-hold benchmark, filter on/off comparison, doubled cost plus 0.1 percentage point per side stress, closed-round expectancy and deterministic block-resampling interval. Initial entries are disabled during warmup. End-fold open holdings remain marked to close.
- Prospective observation ledger alongside immutable recommendation snapshots, automatic assessment with new input data and explicit bounded refresh (six symbol/source groups at a time). Exact target dates, feed/basis consistency, unchanged origin history, and corporate-action reconciliation are required. Historical/CSV runs are excluded from prospective performance. Same-origin forecast retries are deduplicated in the displayed population; groups separate model, horizon, engine and source. The list is bounded at the newest 1,000 records and discloses that scope.
- Audit recovery drafts in account-scoped IndexedDB, clearly distinct from server-saved audit. Export then discard allows recovery from permanent errors; server history remains immutable. Draft persistence failure is explicit.

## Evidence policy

`PRELIMINARY_SUPPORT` is a lab policy threshold, not a promise or a p-value: reviewed data, at least three folds and 20 closed rounds, mean fold return above matched buy-and-hold, positive cost stress, at least 60% positive folds, positive lower descriptive expectancy bound, and two regimes with 15+ sessions each. Personal plans remain paper-only unless the VN execution validation meets this threshold. Changing parameters after observing evaluation results can still overfit. No efficacy score has been invented and no positive market edge is asserted by this release.

Forecast errors and post-signal close returns are observational metrics, not realized brokerage P&L. Maturity requires future sessions; software delivery cannot manufacture prospective observations. Monitoring is on demand or when new analysis input arrives, without an unattended schedule.

## Storage / compatibility

Adds `personal_portfolios` and `evidence_observations` through generated schema-only migration `0002_lyrical_the_stranger.sql`. Existing audit and profile migrations remain unchanged. Version 1/2 archived snapshots remain readable; version 3 includes quality, market signal, simulation, personal plan, portfolio/reservations and OOS validation. Evidence registration is idempotent and repairable from saved v3 audits. Completed evaluations do not rewrite themselves when subsequent provider revisions occur.

All service operations are scoped to the authenticated user. New APIs preserve existing Sites authentication and ownership boundaries. Source and input content are escaped before HTML rendering. The app remains a private research tool with no broker order execution.

## Verification

Meaningful regression coverage includes the review's stale-feed/invalid-stop/action-adjustment/partial-target/combined-risk cases; budget and lot constraints; shared allocation; actual unsettled shares; warmup isolation and future-prefix stability; portfolio ownership/concurrency; prospective maturity/data revisions/deduplication/immutability; and export-discard recovery after permanent audit failure. Existing tests continue covering fees, settlement, corporate claims and source normalization.

Real-market quality depends on complete, licensed and reconciled input history, action data and calendars. User-entered metadata has not become independently authenticated market data. Browser-based visual/authenticated end-to-end QA is not claimed when the managed browser skill is unavailable.

## Primary references

- VSDC, clearing and settlement: https://vsdc.vn/vi/sd/XAz40d2Q-9j569TvBgLQaQ
- SSI, exchange trading rules: https://www.ssi.com.vn/khach-hang-ca-nhan/quy-dinh-giao-dich/quy-dinh-giao-dich-co-phieu
- Hyndman & Athanasopoulos, time-series cross-validation: https://otexts.com/fpp3/tscv.html

The app's T+3 opening convention is a conservative daily-bar approximation of T+2 settlement, not a claim that actual settlement is T+3. Daily OHLCV does not reconstruct auction queues, order cancellations, participant intent or manipulation.
