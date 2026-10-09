# Fetch regression, 5 October 2026

## Evidence

- v9 (`dfb4eb1`) was the last published version before Friday 2 October. The older OHLCV route used the default redirect mode.
- v11 added `captureSource` with `redirect: 'error'` for reconciliation; v12 moved the main OHLCV route onto that adapter too.
- Production on 5 October at 07:34:32 UTC returned `/api/ohlcv` HTTP 502 in 2 ms. Audit startup and persistence returned HTTP 200.
- A read-only request to the deployed v12 OHLCV endpoint reproduced the exact runtime error: `Invalid redirect value, must be one of "follow" or "manual"`. Both DNSE attempts failed before receiving an HTTP response.
- The same failure was reproduced using the native Workers Request implementation in Miniflare. Node-only mocked fetch tests had missed the runtime incompatibility.
- A direct request to DNSE for FPT, 2024-10-05 through 2026-10-05, returned JSON with 495 daily bars during diagnosis.

## Fix

Use Workers-supported `redirect: 'manual'` and explicitly reject HTTP redirects. Keep JSON/schema validation, audit requirements and the existing no-signal behavior on failed data acquisition. Do not reintroduce broad browser retries that could hide authentication or provider errors.

Separate application API HTML/authentication errors from provider HTML errors. Include the failing API path; provide top-level reopen/sign-in recovery links. The original reported “Chưa bắt đầu phân tích” message indicates an audit-start response, whereas the reproduced live 502 is in OHLCV after audit startup. The initial HTML response's cause is not established by current logs; it must not be labeled as a proven DNSE or session failure.

The runtime regression test exercises the complete source adapter with native Workers Request validation and a controlled JSON upstream response. Production OHLCV verification after deployment is recorded separately.
