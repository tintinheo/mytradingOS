# Recommendation audit and explanations — 28 September 2026

VN100 Strategy Lab now saves a durable, user-owned run for every single-symbol analysis, input recalculation, CSV import analysis and watchlist scan. Existing history before this release cannot be recovered. This section describes the original audit release. For current engine behavior and v10 additions, see [decision integrity and evidence](../decision-evidence-v10.md).

## User flow / Cách dùng

1. **Fetch & run analysis** or **Analyze uploaded CSV** creates an audit run before analysis. Parameter changes on a loaded result create a new run using that same loaded history. They do not fetch newer prices; the original source timestamp is retained.
2. **Vì sao có kết quả này?** shows the decision in Vietnamese, the observed indicator values, each entry condition and its pass/fail result, exit conditions, risk assumptions, forecast evidence and limitations. This is a deterministic explanation of the computed rules, without an external language-model service or invented market news.
3. **Fetch & scan list** saves each symbol as it finishes. **Vì sao?** gives an inline explanation. The audit detail contains the full explanation for every saved symbol, including errors.
4. **Lịch sử audit** filters runs by ticker, recommendation and Vietnam calendar date. **Xem chi tiết** restores the original snapshot without rerunning today's model. JSON includes input OHLCV and full results. CSV covers all symbols in the selected run, with explicit `not_processed` rows for unfinished symbols.
5. A stopped scan preserves saved symbols. Closing a tab mid-run leaves a visible unfinished run. A storage failure shows **Thử lưu lại**. Since v10, pending results have account-scoped IndexedDB recovery drafts when browser persistence succeeds. They are not server-saved audit. Export and then discard allows recovery from permanent failures; a new run remains blocked until saving or explicit draft disposal.

## Data contract and integrity

- `audit_runs`: user identity supplied by platform authentication, UUID, server timestamps, mode/origin/source, requested symbols, fixed settings, engine version and completion status.
- `audit_results`: one immutable record per `(run_id, symbol)`, input SHA-256, payload SHA-256, timestamps and the full JSON snapshot. Repeated requests for identical inputs return the existing record; conflicting payloads return 409. A deliberate new analysis gets a new UUID even with identical settings.
- Successful snapshots include input bars, source metadata, full parameters, indicators, raw signal, recommendation, risk references, complete backtest trades/equity, chosen forecast, walk-forward metrics, comparison summaries and the explanation text.
- The server validates inputs and recomputes results using the same shared engine as the browser. Results are research calculations from submitted OHLCV, not independent proof of provider data authenticity. Hashes help identify exact stored content; this is not a regulatory or tamper-proof ledger.
- Records are scoped by authenticated user on every operation. There are no update/delete endpoints for result records. CSV fields are quoted and formula prefixes escaped.
- Run status: `running` (not yet concluded), `completed` (all symbols successful), `partial` (successes and errors), `failed` (all errors), `cancelled` (user stop or interrupted persistence). Missing symbols remain explicit and are not assigned recommendations.
- D1 is the authoritative store. Browser storage is not used as audit storage. CSV input bars used for a run are now persisted in the user's private audit; the original uploaded file itself is not stored.

## API and limits

`POST /api/audit` accepts `start`, `result` and `finish` actions. `GET /api/audit` lists runs (25 per page, timestamp/UUID cursor). `GET /api/audit?id=...` returns details; `&export=json|csv` downloads that run. Writes require authenticated identity, JSON and same-site browser requests. One run supports 1–100 unique symbols; each result supports 2–5,000 bars and a 1.5 MB request. Symbols and input ranges are validated. SQL uses bound values; generated Drizzle migrations own the schema.

The latest chart, profile and decision card use the server-acknowledged snapshot when available. If saving fails, the browser clearly labels the locally computed result as pending and retains the same idempotent request for retry. The old result is never relabeled as newly saved.

## Validation

Node tests use the generated migration with an actual SQLite database through a D1-shaped adapter. They cover durability across service instances, idempotency, ownership boundaries, immutable results, cancellation, partial failures, validation, pagination, Vietnam date filters, exports and agreement between explanation predicates and the signal engine. Existing core, source parsing and swing tests remain in place. Provider availability and investment performance are not validated by these software tests.

## 2026-09-29 market-risk extension

Engine `swing-2026.09.29-market-risk.1` stores schemaVersion 2 snapshots. New decision codes distinguish risk-blocked entries, missing market data, research-only signals and residual odd-lot/pending-share constraints. Each snapshot embeds the exact imported market context plus risk thresholds/version, detected evidence, coverage and causal natural-language explanations. CSV adds risk score/level, market readiness and detector version. Old snapshots retain their archived content unchanged.

Profiles can be imported and stored separately per signed-in user. Their mutable current state never replaces the immutable copy in an existing audit. See `docs/market-risk-research.md` and the in-app market guide for execution assumptions and unsupported inputs.

## 2026-10-04 decision and evidence extension

Schema version 3 separates market signal, backtest position and personal-account plan. Snapshots include the exact portfolio, scan reservations, data-quality assessment and fixed-parameter strategy validation. A separate observation ledger measures future prices without modifying the published snapshot. The new portfolio and evidence APIs remain scoped to authenticated user identity. See [v10 documentation](../decision-evidence-v10.md) for qualification gates, limitations and compatibility.

## 2026-10-04 source reconciliation extension

Schema version 4 attaches a server-derived reconciliation binding: check ID, checked range/time, payload hash and eligibility reason. Client-supplied verification flags are rejected. The original paired captures remain in a separate immutable, account-scoped record. See [data reconciliation](data-reconciliation.md).
