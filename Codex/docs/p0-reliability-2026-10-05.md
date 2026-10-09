# P0 data reliability follow-up — 5 October 2026

Follow-up: [6 October failure-provenance release](p0-failure-audit-2026-10-06.md) closes the client-relayed failed-capture audit gap described below. Other acceptance gates remain open.

Status: **EXPERIMENTAL**. This is an incremental P0 hardening release, not completion of every item in the broader upgrade proposal. Baseline source: `e682398f3aa17792f3292ad3b8c90ed3f50913ed` (Site v13). Engine: `swing-2026.10.05-p0.2`.

## Implementation summary

The existing implementation already contained safe JSON parsing, typed HTTP/HTML/JSON/schema errors, raw hashes, source reconciliation, calendar and corporate-action abstractions, point-in-time membership, chronological backtesting/calibration, immutable audit snapshots, and a final recommendation gate. Those systems were preserved.

This release adds a distinct-provider fallback attempt after primary capture failure. It never treats DNSE's two hosts as independent providers. It never rotates the DNSE hostname to get around 403/429. The alternate is acquired separately, with its own unit/basis/volume declaration; a primary's declaration cannot transfer to it.

**Trust limitation:** Neither configured adapter has verified independent upstream lineage. Therefore, a successful fallback is a quarantined candidate, not automatically substituted into the failed source's analysis/audit profile. The API returns no bars and `NO SIGNAL`. The user can select the alternate explicitly for research and reconcile its profile. If both fail, the state is `UNAVAILABLE`. This is deliberately not a claim that an independently verified automatic failover feed has been provisioned.

The data-quality contract now carries freshness, duplicate sessions, OHLC consistency, price disagreement, volume disagreement, comparison details and typed `DATA_STALE` / `DATA_SOURCE_MISMATCH` errors. An absent comparison is null, not zero disagreements. Duplicate/invalid OHLCV and either nonzero disagreement independently quarantine the dataset. UI details show these fields, including a missing-field label for older snapshots.

## Architecture and pipeline

`GET /api/ohlcv → loadHistory → captureSource → status → Content-Type → bounded JSON body → OHLCV schema/normalization → future-date check`.

On success, the existing downstream flow remains: completed sessions → market profile/calendar/actions → source reconciliation → chronological strategy/forecast evidence → liquidity/trap/risk checks → final recommendation → server-computed immutable audit snapshot.

On failure: capture the alternate once (its adapter may use its existing bounded availability fallback) → retain individual acquisition summaries → quarantine or unavailable → no analysis bars → clear UI results → `NO SIGNAL`.

The API error contains provider names, capture times, hashes, units, basis, last bar, bar count and attempts, without upstream HTML bodies. Existing failed-run audit records retain the error message. Full failed capture summaries are currently returned by the API but are **not durably archived** by the error-only audit path; this remains an audit-provenance limitation.

## Files changed

| File | Purpose |
|---|---|
| `lib/history-service.mjs` | Bounded alternate-provider capture and safe quarantine policy |
| `lib/source-capture.mjs` | Type empty/undersized/oversized histories as schema failures |
| `app/api/ohlcv/route.ts` | Wire fallback diagnostics; reject impossible ISO dates before provider requests |
| `public/lab/credibility.mjs` | Complete data-quality fields and independent vetoes |
| `public/lab/reconciliation.mjs` | Carry comparison counts/details into frozen decision evidence |
| `public/lab/recommendation.mjs` | New engine version for reproducible changed snapshots |
| `public/lab/app.mjs` | Explicit DATA UNAVAILABLE / NO SIGNAL empty state |
| `public/lab/research-ui.mjs` | Quality details with legacy-snapshot handling |
| `tests/p0-reliability.test.mjs` | FPT HTML/fallback, all-provider failure, declaration isolation, normalization and veto tests |
| Existing credibility, reconciliation and market-risk tests | Realistic OHLCV fixture, preserved comparison diagnostics and new version assertion |
| README, CHANGELOG, this report and its in-app copy | Release documentation |

## Bugs and gaps found

1. Primary provider failure did not attempt a distinct provider.
2. Quality summaries discarded price/volume comparison counts after binding the reconciliation record.
3. Duplicate-session and OHLC integrity fields were absent from the final quality contract.
4. Empty history produced a generic unavailable error rather than a schema error.
5. ISO date-shaped but impossible request dates could normalize silently (for example February 30).
6. The unavailable UI used generic prose instead of the explicit NO SIGNAL state.

The historical FPT incident's live root cause is not newly established. Existing tests cover the earlier Workers redirect-mode bug and audit-start HTML response. This release additionally reproduces an upstream HTML response for FPT and verifies alternate-provider capture and abstention.

## Tests and verification

Baseline, before changes: `node --test tests/*.test.mjs` — **92 passed, 0 failed, 0 skipped**.

Focused stage: `node --test tests/p0-reliability.test.mjs tests/provider-safety.test.mjs tests/reconciliation.test.mjs tests/credibility.test.mjs` — **31 passed, 0 failed, 0 skipped** at that stage.

An intermediate full run had 97 passed and 1 failed: a test pinned the previous engine-version literal. The version expectation was updated for the intentional audit version change; its financial/risk assertions were retained. An intermediate TypeScript check found missing fields in the success/error result union; the result shape was corrected.

Final verification:

- `node --test tests/*.test.mjs` — **99 passed, 0 failed, 0 skipped**.
- `node node_modules/typescript/bin/tsc --noEmit` — passed, exit 0.
- `node --check public/lab/research-ui.mjs` — passed, exit 0.
- `git diff --check` — passed, exit 0.

No synthetic fixture result is represented as live market performance.

## Methodology preserved

Forecasts remain distinct from technical signals and final recommendations. The existing ensemble, empirical uncertainty intervals, chronological calibration, next-session execution, costs, slippage, settlement locks, conservative stop/target handling, point-in-time actions and walk-forward isolation are unchanged. Trap outputs remain risk indicators, not allegations of illegal manipulation. See `docs/credibility-release-2026-10-05.md` for the detailed methods and limitations.

## Remaining acceptance gates

- Provision and document genuinely independent upstream data, explicit units/adjustment basis and volume semantics. Candidate fallback availability does not establish trust.
- Load reviewed official historical constituent, corporate-action and exchange-calendar records. The existing calendar release covers 2026; unsupported years require reviewed input. Unsupported rights cash flows remain blocked.
- Validate authenticated live FPT fetching and all error states in a real user session; this run's provider fixtures are deterministic mocks.
- Persist full failed-attempt evidence if reproducing provider-outage diagnostics is required.
- Run real historical out-of-sample and prospective paper-trading evaluation before promoting readiness.

## Quant validation and classification

No new real-market OOS dataset was acquired or evaluated. Trade count, hit rate, expectancy, profit factor, Sharpe/Sortino, drawdown, average gain/loss, probability calibration and per-regime investment results are **not available from this run**. Existing algorithm tests validate behavior, not profitability.

Classification remains **EXPERIMENTAL**. The full P0 acceptance criteria are not complete while independent data provenance, official historical inputs and live validation remain outstanding.
