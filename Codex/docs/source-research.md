# Daily OHLCV acquisition research (27 September 2026)

The lab requires dated, complete daily open/high/low/close/volume bars for an individual symbol and date range. A current quote or a chart image alone cannot support a backtest. “No auto trading” removes the need for order access, but does not establish permission to copy or bulk-extract a third party's historical data.

| Source | Public website evidence | Suitable for automated historical input now? |
| --- | --- | --- |
| DNSE | Its chart displays OHLCV; the lab requests the chart's JSON data route directly without a trading login. DNSE also offers a separately documented registered market-data service. | Experimental. Parser exists; current managed preview could not reach its upstream, and production access is unverified. |
| CafeF | Its public history screen describes open, high, low, close and matched volume. The independent vnquant CafeF loader uses its history-table JSON request. | Experimental. Parser exists; managed preview could not reach its upstream. This endpoint is undocumented and subject to change. |
| Vietstock | Its transaction-history screen has a history and Excel control, but the page also displays an account-level restriction on some figures. | No. Do not bypass the restriction or treat hidden values as public OHLCV. A user-authorized export can be imported as CSV after conversion. |
| SSI | iBoard provides a stock chart and related market views. Its separate FastConnect market-data product describes authenticated historical OHLCV. | No public history feed verified for the lab; no scraping integration. User-authorized exports can be imported. |
| VNSignal | The public stock page contains a recent OHLCV session, but a complete daily series is not present in the observed HTML. Its terms explicitly disallow automated bulk extraction by scraping/crawling. | No automated watchlist crawling. Seek written permission for this use before integrating as a feed. |

## Implementation constraints

- On each live run, select one source and fetch again with `Cache-Control: no-store`; never substitute another source silently. A failed or malformed response suppresses new recommendations.
- Validate symbol/date input, bar count, field finiteness, OHLC consistency, duplicate dates and freshness. Show source and last available session; current signals are withheld when stale.
- Corporate-action adjustment, unit scale, official VN100 membership, source rights and the complete production-network path remain unverified. Avoid backtesting across splits before adjustments are understood.
- Scan at a modest rate; the current interface uses two concurrent requests and a maximum of 100 user-selected symbols. Reduce this limit or disable a source if the provider imposes restrictions.
- The Kaggle dataset suggested by the user is a historical archive for seven stocks, not a way to refresh VN100 on each run. No `vnstock` dependency is used.

## Evidence

- [CafeF public history screen](https://cafef.vn/du-lieu/Lich-su-giao-dich-vhm-1.chn)
- [vnquant CafeF loader implementation](https://github.com/phamdinhkhanh/vnquant/blob/master/vnquant/data/loader/cafe.py)
- [Vietstock transaction-history screen](https://finance.vietstock.vn/fpt/thong-ke-giao-dich.htm)
- [SSI iBoard description](https://www.ssi.com.vn/khach-hang-ca-nhan/giao-dich-chung-khoan-ib-web)
- [SSI developer overview](https://developers.ssi.com.vn/docs/getting-started/overview)
- [VNSignal history page](https://vnsignal.vn/co-phieu/fpt/lich-su-gia) and [terms of use, §3](https://vnsignal.vn/terms)
