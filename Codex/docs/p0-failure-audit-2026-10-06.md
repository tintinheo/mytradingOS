# P0 continuation — failure provenance, 6 October 2026 (Vietnam)

Classification: **EXPERIMENTAL**. This release closes the failed-provider audit gap identified in the preceding P0 report. It does not complete the broader proposal or certify independent data sources.

Baseline: Site v14, source `685e17ac4ddb1ebe6be1a364f076f51ea5e4edf0`.

## Assessment and implementation

The current application was opened from its Sites repository before editing. Existing provider adapters, reconciliation, calendar, corporate actions, historical membership, backtests, ensemble, calibration, final recommendation gate and immutable audit storage were inspected through source and release documentation. All existing tests were retained. No strategy, forecast, execution or financial threshold was changed.

The previous release returned fallback diagnostics from `/api/ohlcv`, but the shared HTTP parser discarded the structured response when throwing. Both the single-ticker and scan flows then passed only `error.message` into the audit. Consequently, provider identity, attempt times, HTTP codes and candidate hashes disappeared from durable history.

New path:

`captureSource → loadHistory → typed API error + request identity → bounded diagnostic projection → DataError.acquisitionFailure → single/scan saveAuditResult → validated immutable audit snapshot → history/export`.

Stored diagnostics include request symbol/source/date range, primary code, fallback attempt, each provider's status/capture time/adapter version, available raw/normalized hashes, declared price/volume conventions, last date/count, and each attempt's hostname/time/status/code. Missing hashes remain null; an HTML response rejected before body acquisition has no invented hash. Full raw bodies, URL queries, credentials and headers are not copied into structured diagnostics.

The server accepts only a strict bounded schema and binds diagnostics to the audit's symbol, source and requested date range. Evidence is accepted only for error records, not successful analysis rows. An available but unverified fallback produces **QUARANTINED**; two failed captures produce **UNAVAILABLE**. Both remain **NO SIGNAL**, with no forecast, entry, stop or target generated from the failed acquisition.

Failed records with diagnostics use snapshot schema 2 and diagnostic version `acquisition-failure-1`. Model engine version is unchanged because investment calculations are unchanged. Legacy snapshots and legacy idempotency hashes remain readable and retryable. The failure evidence participates in the new input hash; changing it cannot overwrite a saved result. No database migration or new storage binding is required.

Browser retries and recovery drafts retain the same evidence. A draft is still not represented as a saved audit until the server accepts it. History shows primary/fallback explanations and full evidence in the existing snapshot export.

## Files changed

| File | Purpose |
|---|---|
| `public/lab/acquisition-failure.mjs` | Bounded diagnostic projection and audit error payload |
| `lib/acquisition-failure-schema.mjs` | Strict server-side diagnostic contract |
| `lib/history-service.mjs` | Preserve adapter version in capture summaries |
| `app/api/ohlcv/route.ts` | Include requested symbol/date range in the typed failure |
| `public/lab/http-json.mjs` | Retain safe diagnostics only for the OHLCV API error path |
| `public/lab/app.mjs` | Carry structured failures from both single and scan workflows |
| `public/lab/audit-ui.mjs` | Preserve evidence during save/retry and explain provider attempts |
| `lib/audit-service.mjs` | Validate, bind, hash and persist failed acquisitions; explicit NO SIGNAL |
| `tests/audit.test.mjs` | End-to-end mocked provider→HTTP→SQLite-backed audit→reload/export tests |
| `tests/audit-recovery.test.mjs` | Browser save failure/retry retains the exact evidence payload |
| README, CHANGELOG, report and in-app report links | Current status and limitations |

## Tests

Initial pre-install `node --test tests/*.test.mjs`: **68 passed, 5 suite-load failures, 0 skipped** because restored checkout dependencies (including zod) were absent. Dependencies were restored with the Sites installer without dependency or lockfile changes.

Baseline after installation, before source changes: `node --test tests/*.test.mjs` — **99 passed, 0 failed, 0 skipped**.

Focused final command:

```sh
node --test tests/audit-recovery.test.mjs tests/audit.test.mjs tests/p0-reliability.test.mjs tests/provider-safety.test.mjs
```

**26 passed, 0 failed, 0 skipped.**

Final complete command: `node --test tests/*.test.mjs` — **103 passed, 0 failed, 0 skipped**. This includes the native Cloudflare Request regression.

Also executed successfully:

```sh
node node_modules/typescript/bin/tsc --noEmit
node --check public/lab/acquisition-failure.mjs
node --check public/lab/audit-ui.mjs
node --check public/lab/app.mjs
git diff --check
```

An intermediate full run had 103 passing tests plus one failed suite due to a new browser test removing its document mock while a background history refresh was still running. The test now waits for that refresh before teardown; product behavior and financial assertions were not weakened.

New checks cover HTML primary + 429 fallback persistence; account isolation; immutable evidence/revision conflict; exact hashes after JSON export; explicit NO SIGNAL history filtering; mismatched request identities; oversized attempts; forbidden fields; diagnostic attachment to successful rows; URL credential/query removal; unverified fallback quarantine; safe explanation rendering; and retry preservation.

## Limitations and remaining P0 gates

- These diagnostics are **client-relayed API evidence**, explicitly labeled in the stored snapshot. They are schema checked and bound to the run, but not server-signed proof of upstream responses. A server-owned acquisition repository would be needed for stronger attestation.
- Replaying the saved snapshot verifies integrity, not reproducibility of a transient external outage. Candidate raw bodies/bars are not archived by this failure path, only available hashes and summaries.
- If audit startup fails, there is no run in which to persist a provider result. If the request itself is interrupted or never yields a typed response, full capture diagnostics are unavailable. Generic error records remain compatible.
- Independent upstream lineage for DNSE/CafeF remains unverified. No automatic trust promotion or bypass of 403/429 was introduced.
- Reviewed historical exchange calendars, corporate-action records and point-in-time VN100 membership are still required for the intended historical ranges. The existing 2026 calendar and fail-closed abstractions are preserved.
- Authenticated live FPT fetch and browser end-to-end verification were not performed. Provider tests use deterministic mocks; this background run did not open a browser-only preview.
- A later release still needs real historical OOS and prospective paper-trading evidence. No new dataset or financial performance study was acquired in this release.

## Quant validation and readiness

Trade count, hit rate, expectancy, profit factor, Sharpe/Sortino, maximum drawdown, average gain/loss, calibration performance and per-regime returns: **not measured in this run**. Existing methodology and limits remain documented in `docs/credibility-release-2026-10-05.md` and `docs/p0-reliability-2026-10-05.md`. Synthetic tests do not establish investment performance.

Recommendation: retain **EXPERIMENTAL**. The audit gap is addressed within the existing client-relayed workflow; full P0 acceptance remains open for independent-source provenance, reviewed historical inputs and live validation.
