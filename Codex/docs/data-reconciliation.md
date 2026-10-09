# Data reconciliation — v11, 4 October 2026

## Research and source choice

CafeF's own history table distinguishes unadjusted closing price from adjusted closing price, matched trades from negotiated trades, and labels prices in thousands of VND. The adapter deliberately uses GiaDongCua and KhoiLuongKhopLenh. Mixing adjusted close with raw open/high/low would create inconsistent candles.

DNSE documents a separate OHLC Market Data API at /price/ohlc. This does not document or certify the legacy public chart endpoint already used by this app. Its price unit, adjustment basis and volume definition must therefore be explicitly declared; unknown metadata remains unknown. The legacy Entrade hostname is a fallback for DNSE, not a second independent provider.

SSI documents daily OHLC and historical pagination, but its service requires registration and credentials. This release does not claim to integrate SSI or any official exchange data service. Two authorized source exports can be compared as CSV, retaining the distinction between server acquisition and user-supplied evidence.

Primary sources read on 2026-10-04:

- CafeF history columns and units: https://cafef.vn/du-lieu/lich-su-giao-dich/hose/vds-1.chn
- DNSE OHLC documentation: https://developers.dnse.com.vn/docs/dnse/get-ohlc-history/
- SSI OHLC workflow: https://developers.ssi.com.vn/docs/tutorials/ohlc
- SSI access conditions: https://developers.ssi.com.vn/docs/getting-started/terms-and-environments

These references support the source semantics and access distinctions, not a guarantee about the experimental public endpoints' uptime, full coverage or upstream independence.

## Product workflow

Select a symbol and range, then use **Đối chiếu**. The live mode separately fetches DNSE and CafeF on the server, at most two providers concurrently. It records even a failed provider attempt. The two-CSV mode accepts one selected ticker in each file, along with source labels, provenance and explicit units/basis/volume kind.

The comparator converts known units to VND, compares open/high/low/close and volume by exact Vietnam trading date, and uses the saved calendar to detect dates missing from both sources. An unfinished daily bar is excluded until 15:15 Vietnam time, consistently with the app's daily-bar convention. Suspended dates may be absent from both feeds; rows on a suspended or unexpected calendar date are flagged.

Unknown or different price basis prevents price agreement. Unknown or different volume definitions prevent volume agreement. A close ratio near 1,000 is a diagnostic hint, never an automatic correction. No averaging, silently chosen winner, forward fill or mechanical corporate-action correction is performed by reconciliation.

Only numerical noise of at most 0.01 VND / 0.001 share is ignored. A difference within one exchange tick, or within max(100 shares, 0.5% of the larger volume), receives lower investigation priority but remains a discrepancy. A matching report requires both sources, comparable fields, sufficient overlapping completed sessions, calendar coverage, reviewed action metadata and no detected differences or missing required sessions. “Matched” describes agreement within the checked scope, not truth or independent provenance.

## Immutable evidence and recommendation binding

Generated migration 0003 adds data_reconciliations. Each record stores the account, request ID/range, server timestamps, source URLs and attempt statuses, native normalized OHLCV, adapter version, raw-response/file hash, series hash, declarations, copied market profile, field differences, previous-capture revisions and payload hash. The original full provider response/file bytes are not retained; native parsed bars and hashes are retained. The hashes establish content identity, not a regulatory tamper-proof ledger.

No update/delete endpoint exists. Retrying the same request ID with identical input returns the existing record. A different payload cannot overwrite it. Reads, exports and selection for recommendations use authenticated ownership. History shows the latest 30 records per selected symbol; detail/export retains the full record.

Audit schema 4 links a compact, server-derived binding to the newest live reconciliation for that user and ticker. The browser cannot submit an eligible flag. Binding requires:

1. The same normalized market profile.
2. A check no older than 24 hours.
3. The same source unit and price basis as the analysis profile.
4. Coverage of every analysis bar, with exactly matching native OHLCV and no omitted captured bars.
5. A MATCHED comparison.

Changing source history, profile or range invalidates the relevant binding. A later failed or discrepant check cannot silently fall back to an older green check. Opening an old history record does not select it for future recommendations. Uploaded-file comparisons never authorize the live data gate.

Data discrepancies suppress personal plan quantities and add a market entry blocker. Missing or incomplete verification keeps otherwise feasible plans paper-only. OOS validation cannot qualify as preliminary support without both its existing structural-data criteria and the cross-source gate. Existing archived audits retain their original engine and results.

## Bounds and verification

Requests cover no more than 1,098 calendar days and 1,000 bars per source; live requests are spaced at least 20 seconds per account. Provider requests have 10-second per-attempt timeouts, fixed hosts, a 4 MB response bound and no redirects. HTTP 429/403 and malformed successful responses do not trigger hostname fallback. CSVs are at most 350 KB each; the request is bounded at 800 KB and stored evidence at 1.8 MB.

Regression tests cover unit/basis/volume comparability, minor and major discrepancies, gaps present in both sources, suspension, Vietnam dates and unfinished bars, source revisions, stale/profile/input binding, fallback provenance, rate-limit behavior, malformed and oversized responses, ownership/idempotency, upload trust boundaries, audit anti-forgery, personal-plan gating and output escaping.

On this implementation run, direct upstream probes from the execution environment timed out for both public providers. Live capture availability and actual cross-source agreement have not been established by the synthetic tests. Managed browser end-to-end QA was unavailable because the required browser skill was not exposed.

## Remaining limits

This module reconciles daily OHLCV and exposes declared-metadata gaps. It does not independently fetch/verify exchange calendars, corporate actions, historical VN100 membership, order-book data or source licensing. User declarations and market profiles remain user-supplied. Two vendors may share upstream data and agree on an error. Existing prospective outcome scores still use the original price source at maturity; this module does not independently certify those future target prices. No claim about investment performance follows from a matching reconciliation.
