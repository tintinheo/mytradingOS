# Changelog

## 2026-10-06 — P0 strict provider values and session identity

- Reject JSON arrays/objects and non-decimal numeric strings before OHLCV analysis.
- Share date/value parsing between server adapters and browser; convert offset timestamps to Vietnam sessions and reject ambiguous/malformed dates.
- Preserve duplicate-session checks, fallback quarantine, NO SIGNAL, raw hashes and old audit snapshots. Increment capture adapter version.
- Four regressions reproduced failures before changes; final suite: 107 passed, 0 failed, 0 skipped. See `docs/p0-schema-2026-10-06.md`.
- Full P0 remains incomplete; classification EXPERIMENTAL.

## 2026-10-06 — P0 failed-acquisition audit provenance

- Retain bounded primary/fallback diagnostics through typed HTTP errors, single/scan workflows, audit saves and recovery retries.
- Validate request identity and a strict diagnostic schema; preserve provider timestamps, available hashes, adapter versions and HTTP attempt codes without raw bodies, headers or URL queries.
- Persist immutable, account-scoped failed records with explicit NO SIGNAL and QUARANTINED/UNAVAILABLE states; expose primary/fallback explanations and JSON exports.
- Preserve old audit snapshots and retry hashes. Investment engine and strategy behavior are unchanged.
- Added four regressions; final suite: 103 passed, 0 failed, 0 skipped. See `docs/p0-failure-audit-2026-10-06.md` for initial environment failures and remaining gates.
- Full P0 remains incomplete; source independence and live/real-market validation are not newly established.

## 2026-10-05 — P0 reliability follow-up

- Added a distinct-provider fallback capture after primary OHLCV failure, preserving each source's declaration and hashes.
- Quarantine unverified fallback data; return no bars and NO SIGNAL. Both failed providers produce UNAVAILABLE.
- Added duplicate/OHLC/freshness and cross-source disagreement fields to frozen quality evidence; disagreement and invalid data veto recommendations.
- Exposed quality details and explicit unavailable states in the UI; retained old snapshot compatibility.
- Typed invalid history sizes as schema errors and rejected impossible date ranges.
- Added FPT upstream-HTML/fallback and data-gate regressions. Bumped engine version to `swing-2026.10.05-p0.2`.
- Readiness remains EXPERIMENTAL. See `docs/p0-reliability-2026-10-05.md` for tests and remaining gates.
