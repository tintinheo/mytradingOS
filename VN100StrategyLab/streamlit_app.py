"""Private research lab for daily Vietnamese equity histories. No order execution."""

from __future__ import annotations

import csv
import io
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from datetime import datetime, timedelta

import pandas as pd
import streamlit as st

from engine import Settings, backtest, forecast
from feeds import Bar, DataError, FetchResult, VN_TZ, as_records, fetch_history, parse_csv_files


st.set_page_config(page_title="VN100 Strategy Lab", page_icon="📈", layout="wide")
st.title("VN100 Strategy Lab")
st.caption("Historical evidence, modeled backtests and separate forecast scenarios · No order execution / Không đặt lệnh")


def download_csv(records: list[dict]) -> str:
    if not records:
        return ""
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(records[0]))
    writer.writeheader()
    writer.writerows(records)
    return out.getvalue()


def is_stale(last_bar: str) -> bool:
    return (datetime.now(VN_TZ).date() - datetime.fromisoformat(last_bar).date()).days > 7


def validate_watchlist(text: str) -> list[str]:
    symbols = list(dict.fromkeys(re.split(r"[\s,;]+", text.upper().strip())))
    if not symbols or len(symbols) > 100 or any(not re.fullmatch(r"[A-Z0-9]{2,10}", s) for s in symbols):
        raise DataError("Enter 1–100 tickers separated by commas or spaces")
    return symbols


def summarize(bars: list[Bar], p: Settings) -> dict:
    result = backtest(bars, p)
    stale = is_stale(bars[-1].date)
    state = ("Stale — no current signal" if stale else
             "Exit condition after close" if result["open_position"] and result["signal"]["sell"] else
             "Modeled position open" if result["open_position"] else
             "Entry condition after close" if result["signal"]["buy"] else
             "No new entry condition")
    return {"last_bar": bars[-1].date, "close": bars[-1].close,
            "signal": state, "backtest_pct": result["return_pct"], "stale": stale}


with st.sidebar:
    st.header("Inputs / Thiết lập")
    source = st.selectbox("Data source", ["DNSE", "CafeF", "Uploaded CSV"])
    symbol = st.text_input("Ticker", value="FPT").strip().upper()
    today = datetime.now(VN_TZ).date()
    start = st.date_input("From", value=today - timedelta(days=730), max_value=today)
    end = st.date_input("To", value=today, max_value=today)
    uploads = st.file_uploader("OHLCV CSV (optional offline source)", type="csv", accept_multiple_files=True)
    strategy = st.selectbox("Historical signal", ["sma", "breakout", "hold"],
                            format_func=lambda name: {"sma": "Moving average cross", "breakout": "Close breakout", "hold": "Buy and hold"}[name])
    fast = st.number_input("Fast MA sessions", min_value=2, max_value=100, value=10)
    slow = st.number_input("Slow MA sessions", min_value=3, max_value=250, value=30)
    lookback = st.number_input("Breakout lookback", min_value=5, max_value=100, value=20)
    volume_multiple = st.selectbox("Entry volume vs prior 20 sessions", [0.0, 1.0, 1.5],
                                    format_func=lambda x: "Off" if not x else f"At least {x:g}×")
    method = st.selectbox("Illustrative forecast", ["none", "momentum", "reversion"],
                          format_func=lambda x: {"none": "Off", "momentum": "20 day drift", "reversion": "20 day mean reversion"}[x])
    stop = st.number_input("Stop loss %", min_value=0.5, max_value=50.0, value=7.0, step=0.5)
    target = st.number_input("Take profit % (0 = off)", min_value=0.0, max_value=100.0, value=18.0, step=0.5)
    risk = st.number_input("Capital risk per trade %", min_value=0.1, max_value=10.0, value=1.0, step=0.1)
    fee = st.number_input("Fee and slippage per side %", min_value=0.0, max_value=5.0, value=0.25, step=0.05)
    run = st.button("Fetch and run / Tải và phân tích", type="primary", use_container_width=True)

params = Settings(strategy, fast, slow, lookback, stop, target, risk, fee, volume_multiple)
request_key = (source, symbol, str(start), str(end))
if run:
    st.session_state.pop("single_result", None)
    try:
        params.validate()
        if source == "Uploaded CSV":
            if not uploads:
                raise DataError("Upload CSV files before analysis")
            data = parse_csv_files([(file.name, file.getvalue()) for file in uploads])
            if symbol not in data:
                raise DataError(f"{symbol} was not present in uploaded files")
            bars = [bar for bar in data[symbol] if start.isoformat() <= bar.date <= end.isoformat()]
            if len(bars) < 2:
                raise DataError("Selected date range contains fewer than two imported bars")
            result = FetchResult(symbol, "Uploaded CSV", bars, datetime.now(VN_TZ).isoformat(),
                                 bars[-1].date, "User supplied; browser session")
        else:
            with st.spinner(f"Fetching fresh {symbol} daily OHLCV from {source}…"):
                result = fetch_history(source, symbol, start, end)
        st.session_state["single_result"] = (request_key, result)
    except (DataError, ValueError) as exc:
        st.error(f"No new signal calculated: {exc}")

selected = st.session_state.get("single_result")
if selected and selected[0] == request_key:
    result = selected[1]
    try:
        test = backtest(result.bars, params)
    except DataError as exc:
        st.error(f"Cannot calculate this strategy: {exc}")
    else:
        st.success(f"{result.symbol} · {len(result.bars)} daily bars · {result.source} · last session {result.last_bar}")
        st.caption(f"Fetched {result.fetched_at} · {result.transport} · adjustment and official VN100 membership unverified")
        stale = source != "Uploaded CSV" and is_stale(result.last_bar)
        if stale:
            st.warning("Last provider session is more than seven calendar days old. Current signal withheld; historical test remains visible.")
        cols = st.columns(4)
        cols[0].metric("Historical strategy test", f"{test['return_pct']:+.1f}%")
        cols[1].metric("Historical buy and hold", f"{test['buy_hold_pct']:+.1f}%")
        cols[2].metric("Max modeled drawdown", f"{test['max_drawdown_pct']:.1f}%")
        cols[3].metric("Completed trades", str(len(test["trades"])))
        if stale:
            st.info("No current entry or exit recommendation from stale provider bars.")
        elif test["open_position"]:
            st.info("Historical model holds a position. Exit after close is pending for next open." if test["signal"]["sell"]
                    else "Historical model holds a position; no new exit condition at the last close.")
        else:
            st.info("Entry condition after the last close. Next session open is unknown." if test["signal"]["buy"]
                    else "No new entry condition at the last close.")

        history, comparison, audit, methods = st.tabs(["Observed price and volume", "Approach comparison and scenarios", "Trades and bars", "Method and data rights"])
        with history:
            frame = pd.DataFrame(as_records(result.bars)).set_index("date")
            st.subheader("Observed daily closes")
            st.line_chart(frame[["close"]], height=280)
            st.subheader("Observed matched volume")
            st.bar_chart(frame[["volume"]], height=160)
            st.subheader("Modeled historical equity · starts at 100")
            st.line_chart(pd.DataFrame(test["equity"]).set_index("date"), height=180)
        with comparison:
            variants = []
            for name in ("sma", "breakout", "hold"):
                try:
                    trial = backtest(result.bars, replace(params, strategy=name))
                    variants.append({"approach": name, "historical_return_pct": round(trial["return_pct"], 2),
                                     "completed_trades": len(trial["trades"])})
                except DataError:
                    variants.append({"approach": name, "historical_return_pct": None, "completed_trades": None})
            st.dataframe(variants, hide_index=True, use_container_width=True)
            st.caption("Same bars and modeled costs. These are in sample results, not expected future returns.")
            scenarios = forecast(result.bars, method)
            if scenarios:
                st.subheader("Model scenario · future session number")
                st.line_chart(pd.DataFrame(scenarios).set_index("session"), height=230)
                st.dataframe(scenarios, hide_index=True, use_container_width=True)
                st.caption("Illustrative ±1 volatility band, not a calibrated probability interval. Forecast does not affect signals or backtest.")
            elif method != "none":
                st.info("At least 21 completed sessions are needed for this scenario.")
        with audit:
            st.subheader("Completed modeled trades")
            st.dataframe(list(reversed(test["trades"])), hide_index=True, use_container_width=True)
            st.subheader("Daily OHLCV input")
            st.dataframe(list(reversed(as_records(result.bars))), hide_index=True, use_container_width=True)
            export_rows = [{"ticker": result.symbol, **row} for row in as_records(result.bars)]
            st.download_button("Download observed OHLCV CSV", download_csv(export_rows),
                               file_name=f"{symbol}-{source.lower().replace(' ', '-')}-ohlcv.csv", mime="text/csv")
        with methods:
            st.write("Long only; one position; entry or signal exit on the next open; stop wins if stop and target touch the same bar; opening gaps fill at the open. Risk limits exposure; fee and slippage apply to both sides. No taxes, corporate action cash flows, T+2 settlement, price limits, liquidity impact, or partial fills. No live quote or executable order.")
            st.write("DNSE and CafeF use experimental website history requests. A failed fetch never triggers a synthetic or silently substituted series. VNSignal explicitly prohibits automated bulk extraction; Vietstock restricts some data by account; a reusable public SSI series was not verified. CSV imports are local to this session.")
            st.write("Watchlist membership is user supplied and not an official or historical VN100 constituent record. Survivorship bias and unadjusted prices may materially change backtests.")
else:
    st.info("Choose inputs and press Fetch and run. No current recommendation is displayed without matching validated data.")

st.divider()
st.subheader("Watchlist scan / Quét danh sách")
watchlist = st.text_area("Tickers · up to 100, user supplied", value="FPT, HPG, VCB, VNM, MWG, MSN, GAS, VIC, VHM, ACB", height=80)
scan = st.button("Fetch and scan list", disabled=(source == "Uploaded CSV"))
scan_key = (source, str(start), str(end), watchlist, params)
if scan:
    st.session_state.pop("scan_result", None)
    try:
        params.validate()
        symbols = validate_watchlist(watchlist)
        rows = []
        progress = st.progress(0, text="Requesting fresh history")
        # Maximum two concurrent requests and no per-symbol caching.
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(fetch_history, source, sym, start, end): sym for sym in symbols}
            for completed, future in enumerate(as_completed(futures), 1):
                sym = futures[future]
                try:
                    feed = future.result()
                    item = summarize(feed.bars, params)
                    rows.append({"ticker": sym, "source": feed.source, **item, "error": ""})
                except (DataError, ValueError) as exc:
                    rows.append({"ticker": sym, "source": source, "last_bar": "", "close": None,
                                 "signal": "No recommendation", "backtest_pct": None,
                                 "stale": None, "error": str(exc)[:180]})
                progress.progress(completed / len(symbols), text=f"{completed}/{len(symbols)} checked")
        st.session_state["scan_result"] = (scan_key, sorted(rows, key=lambda row: row["ticker"]))
    except DataError as exc:
        st.error(exc)

existing_scan = st.session_state.get("scan_result")
if existing_scan and existing_scan[0] == scan_key:
    rows = existing_scan[1]
    st.caption(f"{len(rows)} checked · {sum(bool(x['error']) for x in rows)} source or validation errors · one new request per symbol")
    st.dataframe(rows, hide_index=True, use_container_width=True)
    st.download_button("Download scan results CSV", download_csv(rows), file_name="vn100-watchlist-scan.csv", mime="text/csv")
else:
    st.caption("Run a new scan to see per-symbol provenance and errors. No official VN100 membership check is included.")

st.caption("Research only. Historical backtests and model scenarios are not guaranteed returns. / Chỉ phục vụ nghiên cứu; kết quả quá khứ và dự báo không đảm bảo lợi nhuận.")
