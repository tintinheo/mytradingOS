from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import streamlit as st

from tintradingos.backtest.execution import FillPolicy, simulate_limit_entry
from tintradingos.domain.market_rules import Exchange, MarketPrice, PriceBasis
from tintradingos.ingest.cafef import CafeFDataset
from tintradingos.ingest.index import IndexEODError, parse_vn_index_eod_csv, persist_index_eod
from tintradingos.ingest.pipeline import (
    DataQualityError,
    download_cafef_zip,
    persist_provider_bars,
    run_price_pipeline,
)
from tintradingos.ingest.providers import Provider, ProviderError, provider_for
from tintradingos.journal.sqlite import (
    artifact_digest,
    export_journal_csv,
    export_journal_json,
    list_proposals,
    list_scans,
    record_outcome,
    record_scan,
)
from tintradingos.reference.vn100 import VN100SnapshotError, parse_vn100_snapshot_csv
from tintradingos.scanner.warehouse import scan_warehouse

PROJECT_ROOT = Path(__file__).resolve().parent
DB_PATH = PROJECT_ROOT / "data" / "market.sqlite"

st.set_page_config(
    page_title="TinTradingOS",
    page_icon="T",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap');
    :root { --ink:#17211b; --muted:#68736b; --paper:#f4f6f1; --line:#d9e0d8; --green:#0e6b50; --lime:#c9e86b; --amber:#f4b942; --red:#c94b4b; }
    .stApp { background:var(--paper); color:var(--ink); }
    [data-testid="stSidebar"] { background:#17211b; }
    [data-testid="stSidebar"] * { color:#eaf0e9 !important; }
    h1,h2,h3,p,span,label { font-family:'Manrope', sans-serif; }
    h1 { letter-spacing:-.03em; font-weight:800; }
    .mono { font-family:'DM Mono', monospace; letter-spacing:0; }
    .eyebrow { color:var(--green); font-size:.72rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
    .hero { border-bottom:1px solid var(--line); padding:1rem 0 1.35rem; margin-bottom:1.4rem; }
    .hero h1 { margin:.25rem 0 .3rem; font-size:2.35rem; }
    .hero p { color:var(--muted); margin:0; max-width:720px; }
    .status { display:inline-block; background:var(--lime); color:var(--ink); border-radius:999px; padding:.3rem .7rem; font-size:.72rem; font-weight:800; }
    .panel { background:white; border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem; }
    .panel-title { font-weight:800; margin-bottom:.35rem; }
    .panel-subtitle { color:var(--muted); font-size:.86rem; margin-bottom:.9rem; }
    .signal-card { background:#17211b; color:#eef5ed; border-radius:10px; padding:1rem 1.1rem; margin:.4rem 0; }
    .signal-card .accent { color:var(--lime); }
    .risk-card { border-left:4px solid var(--amber); background:#fffaf0; padding:.85rem 1rem; border-radius:6px; }
    div[data-testid="stMetric"] { background:white; border:1px solid var(--line); border-radius:8px; padding:.7rem; }
    .small-note { color:var(--muted); font-size:.78rem; }
    </style>
    """,
    unsafe_allow_html=True,
)


def format_vnd(value: Decimal | int | float | str) -> str:
    return f"{Decimal(str(value)):,.0f} VND"


def query_db(query: str, params: tuple = ()) -> list[tuple]:
    if not DB_PATH.exists():
        return []
    connection = sqlite3.connect(DB_PATH)
    try:
        return connection.execute(query, params).fetchall()
    finally:
        connection.close()


def db_summary() -> dict[str, object]:
    rows = query_db(
        """
        SELECT COUNT(*), COUNT(DISTINCT symbol), MAX(trading_date), COUNT(DISTINCT exchange)
        FROM ohlcv
        """
    )
    if not rows or rows[0][0] is None:
        return {"rows": 0, "symbols": 0, "latest": "No data", "exchanges": 0}
    row = rows[0]
    return {"rows": row[0], "symbols": row[1], "latest": row[2], "exchanges": row[3]}


def sidebar() -> str:
    with st.sidebar:
        st.markdown("<div class='eyebrow'>TinTradingOS / local desk</div>", unsafe_allow_html=True)
        st.markdown("# Research cockpit")
        st.caption("EOD-only · long-only · paper mode")
        st.divider()
        view = st.radio(
            "Workspace",
            ["Overview", "Data pipeline", "Market scanner", "EOD journal", "Execution lab"],
            label_visibility="collapsed",
        )
        st.divider()
        st.markdown("<span class='status'>PAPER ONLY</span>", unsafe_allow_html=True)
        st.caption("Không đặt lệnh thật. Các tham số chiến lược chưa hiệu chuẩn.")
        st.caption("Nguồn dữ liệu: CafeF EOD · local SQLite")
    return view


def page_header(title: str, subtitle: str) -> None:
    st.markdown(
        f"<div class='hero'><div class='eyebrow'>TinTradingOS / local research</div>"
        f"<h1>{title}</h1><p>{subtitle}</p></div>",
        unsafe_allow_html=True,
    )


def overview() -> None:
    summary = db_summary()
    page_header(
        "Market desk", "Một cửa sổ gọn để biết dữ liệu đang ở đâu và paper engine đang làm gì."
    )
    cols = st.columns(4)
    cols[0].metric("Rows in warehouse", f"{summary['rows']:,}")
    cols[1].metric("Symbols", f"{summary['symbols']:,}")
    cols[2].metric("Latest session", summary["latest"])
    cols[3].metric("Exchanges", summary["exchanges"])
    st.write("")
    left, right = st.columns([1.25, 0.75])
    with left:
        st.markdown(
            "<div class='panel'><div class='panel-title'>System posture</div>"
            "<div class='panel-subtitle'>Các lớp đã bật trong phiên bản hiện tại.</div>",
            unsafe_allow_html=True,
        )
        st.dataframe(
            [
                {"Module": "CafeF OHLCV pipeline", "Status": "READY", "Mode": "Local"},
                {"Module": "Pure Python indicators", "Status": "READY", "Mode": "Local"},
                {"Module": "PB_MA20 paper signal", "Status": "READY", "Mode": "Paper"},
                {"Module": "CCNN order flow", "Status": "BLOCKED", "Mode": "Evidence missing"},
                {"Module": "C3 momentum", "Status": "BLOCKED", "Mode": "Fail-closed"},
            ],
            hide_index=True,
            use_container_width=True,
        )
        st.markdown("</div>", unsafe_allow_html=True)
    with right:
        st.markdown(
            "<div class='risk-card'><b>Safety gate</b><br>Paper-only. Không có broker integration, không auto-trading và không dùng adjusted price làm giá đặt lệnh.</div>",
            unsafe_allow_html=True,
        )
        st.write("")
        st.markdown(
            "<div class='panel'><div class='panel-title'>Next useful action</div>"
            "<div class='panel-subtitle'>Tải phiên EOD mới nhất ở Data pipeline, sau đó xem paper candidate ở Paper signals.</div></div>",
            unsafe_allow_html=True,
        )


def pipeline_page() -> None:
    page_header("Data pipeline", "Tải, kiểm tra và lưu OHLCV CafeF vào warehouse local.")
    st.markdown(
        "<div class='risk-card'><b>Readiness:</b> Scanner chỉ có thể đánh giá mã sau khi warehouse có đủ lịch sử và universe/cluster metadata theo ngày hiệu lực.</div>",
        unsafe_allow_html=True,
    )
    bootstrap_date = st.date_input(
        "Bootstrap session", value=date.today() - timedelta(days=3), key="bootstrap_date"
    )
    if st.button("Bootstrap raw + adjusted full history", use_container_width=True):
        with st.status("Bootstrapping CafeF history...", expanded=True) as status:
            try:
                for dataset, basis, label in (
                    (CafeFDataset.PRICE_RAW, PriceBasis.RAW, "raw"),
                    (CafeFDataset.PRICE_ADJUSTED, PriceBasis.ADJUSTED, "adjusted"),
                ):
                    payload = download_cafef_zip(dataset, bootstrap_date, full_history=True)
                    report = run_price_pipeline(
                        payload,
                        dataset=dataset,
                        basis=basis,
                        db_path=DB_PATH,
                        source_name=f"CafeF {label} Upto",
                    )
                    st.write(f"{label}: {report.rows:,} rows · {report.symbols:,} symbols")
                status.update(label="Bootstrap completed", state="complete")
            except Exception as exc:
                status.update(label="Bootstrap rejected", state="error")
                st.error(str(exc))
    col1, col2, col3 = st.columns([1, 1, 1.2])
    with col1:
        trading_date = st.date_input("Trading date", value=date.today() - timedelta(days=3))
    with col2:
        dataset_label = st.selectbox("Dataset", ["Raw price", "Adjusted price"])
    with col3:
        full_history = st.checkbox("Upto / full history", value=False)
    basis = PriceBasis.RAW if dataset_label == "Raw price" else PriceBasis.ADJUSTED
    dataset = CafeFDataset.PRICE_RAW if basis is PriceBasis.RAW else CafeFDataset.PRICE_ADJUSTED
    if st.button("Run CafeF pipeline", type="primary", use_container_width=True):
        with st.status("Downloading and validating...", expanded=True) as status:
            try:
                payload = download_cafef_zip(dataset, trading_date, full_history=full_history)
                st.write(f"Downloaded `{len(payload):,}` bytes")
                report = run_price_pipeline(
                    payload,
                    dataset=dataset,
                    basis=basis,
                    db_path=DB_PATH,
                    source_name=f"CafeF {dataset_label}",
                )
                status.update(label="Pipeline completed", state="complete")
                st.success(
                    f"{report.rows:,} rows · {report.symbols:,} symbols · {report.trading_dates}"
                )
            except DataQualityError as exc:
                status.update(label="Pipeline rejected", state="error")
                st.error(str(exc))
            except Exception as exc:
                status.update(label="Unexpected failure", state="error")
                st.exception(exc)
    summary = db_summary()
    st.markdown(
        "<div class='panel'><div class='panel-title'>Warehouse snapshot</div></div>",
        unsafe_allow_html=True,
    )
    st.write(f"Latest stored session: **{summary['latest']}** · Database: `{DB_PATH}`")
    rows = query_db(
        "SELECT exchange, basis, COUNT(*) FROM ohlcv GROUP BY exchange, basis ORDER BY exchange, basis"
    )
    if rows:
        st.dataframe(
            [{"Exchange": row[0], "Basis": row[1], "Rows": row[2]} for row in rows],
            hide_index=True,
            use_container_width=True,
        )
    else:
        st.info("Chưa có dữ liệu. Chạy pipeline ở trên.")

    st.divider()
    st.subheader("VN-Index EOD history")
    st.caption(
        "Import the strict source-backed CSV contract separately from equity OHLCV. "
        "Required columns: date, open, high, low, close, source_url."
    )
    index_file = st.file_uploader("VN-Index EOD CSV", type=["csv"])
    if index_file is not None and st.button("Import VN-Index EOD", key="import_vnindex"):
        try:
            bars = parse_vn_index_eod_csv(index_file.getvalue(), source_name=index_file.name)
            persist_index_eod(DB_PATH, bars)
            st.success(f"Imported {len(bars):,} VN-Index EOD bars into separate index history.")
        except IndexEODError as exc:
            st.error(str(exc))

    st.divider()
    st.subheader("Direct provider check")
    st.caption(
        "Kiểm tra nguồn trực tiếp trước khi đưa dữ liệu vào warehouse. Không trộn nguồn tự động."
    )
    provider_name = st.selectbox("Provider", list(Provider), key="provider_name")
    provider_symbol = st.text_input("Ticker", value="AAA", key="provider_symbol")
    provider_start = st.date_input(
        "Start", value=date.today() - timedelta(days=365), key="provider_start"
    )
    provider_end = st.date_input("End", value=date.today(), key="provider_end")
    if st.button("Fetch direct OHLCV", key="fetch_direct_provider"):
        try:
            provider = provider_for(Provider(provider_name))
            bars = provider.fetch(provider_symbol, provider_start, provider_end)
            st.session_state["direct_provider_bars"] = bars
            st.success(
                f"{provider.provider.value}: {len(bars)} bars · capability={provider.capability.value}"
            )
            st.dataframe(
                [
                    {
                        "Date": bar.trading_date,
                        "Open": bar.open_vnd,
                        "High": bar.high_vnd,
                        "Low": bar.low_vnd,
                        "Close": bar.close_vnd,
                        "Volume": bar.volume,
                        "Source": bar.source.value,
                    }
                    for bar in bars
                ],
                hide_index=True,
                use_container_width=True,
            )
        except ProviderError as exc:
            st.warning(str(exc))
    stored_bars = st.session_state.get("direct_provider_bars")
    if stored_bars and st.button("Import fetched bars to warehouse", key="import_direct_provider"):
        imported = persist_provider_bars(DB_PATH, stored_bars)
        st.success(f"Imported {imported:,} bars into local warehouse.")


def market_scanner_page() -> None:
    page_header(
        "VN100 market scanner",
        "Quét VN100 có nguồn theo ngày hiệu lực và ghi rõ mã bị loại ở từng gate.",
    )
    st.markdown(
        "<div class='risk-card'><b>Không phải khuyến nghị đầu tư.</b><br>Đây là paper signal để kiểm thử pipeline và hành vi engine.</div>",
        unsafe_allow_html=True,
    )
    summary = db_summary()
    latest = summary["latest"]
    if latest == "No data":
        st.warning("Chưa có dữ liệu RAW. Hãy chạy CafeF pipeline trước khi quét VN100.")
        return
    as_of = date.fromisoformat(str(latest))
    st.info(
        f"VN100 only · data session {as_of.isoformat()}. Upload snapshot VN100 có nguồn và ngày hiệu lực; "
        "không tự suy đoán thành phần hoặc cluster."
    )
    metadata_file = st.file_uploader(
        "VN100 snapshot CSV",
        type=["csv"],
        help="Columns: symbol, exchange, cluster, effective_from, effective_to, source",
    )
    snapshot = None
    snapshot_bytes = b""
    snapshot_filename = ""
    if metadata_file is not None:
        try:
            snapshot = parse_vn100_snapshot_csv(metadata_file.getvalue(), as_of=as_of)
            st.success(
                f"Loaded {len(snapshot.symbols)} active VN100 symbols from {metadata_file.name}"
            )
            st.dataframe(
                [
                    {
                        "Symbol": symbol,
                        "Cluster": snapshot.cluster_by_symbol[symbol].value,
                        "Source": snapshot.source_by_symbol[symbol],
                    }
                    for symbol in sorted(snapshot.symbols)
                ],
                hide_index=True,
                use_container_width=True,
            )
        except VN100SnapshotError as exc:
            st.error(str(exc))
    nav = st.number_input("NAV (VND)", min_value=1_000_000, value=1_000_000_000, step=10_000_000)
    cash = st.number_input(
        "Available cash (VND)", min_value=1_000_000, value=500_000_000, step=10_000_000
    )
    if st.button("Scan warehouse", type="primary"):
        if snapshot is None:
            st.error("Upload a valid, active VN100 snapshot before scanning.")
            st.stop()
        report = scan_warehouse(
            DB_PATH,
            universe=set(snapshot.symbols),
            cluster_by_symbol=snapshot.cluster_by_symbol,
            nav=nav,
            available_cash=cash,
            as_of=as_of,
        )
        if report.regime is None or report.regime_inputs is None:
            st.error(
                "Automated market regime unavailable: insufficient VN-Index or VN100 breadth history."
            )
            if report.rejections:
                st.dataframe(
                    [
                        {"Symbol": item.symbol, "Gate": item.gate, "Reason": item.reason}
                        for item in report.rejections
                    ],
                    hide_index=True,
                    use_container_width=True,
                )
            return
        inputs = report.regime_inputs
        st.subheader(f"Calculated regime: {report.regime.value}")
        st.caption(
            f"Input session: {inputs.as_of.isoformat()} · active VN100 snapshot effective on this date"
        )
        metric_columns = st.columns(5)
        metric_columns[0].metric("VN-Index close", f"{inputs.vni['close']:.2f}")
        metric_columns[1].metric(
            "VN-Index MA50 / MA200", f"{inputs.vni['ma50']:.2f} / {inputs.vni['ma200']:.2f}"
        )
        metric_columns[2].metric("Equal-weight close", f"{inputs.equal_weight['close']:.2f}")
        metric_columns[3].metric(
            "Equal-weight MA50 / MA200",
            f"{inputs.equal_weight['ma50']:.2f} / {inputs.equal_weight['ma200']:.2f}",
        )
        metric_columns[4].metric(
            "Breadth",
            f"{inputs.breadth['pct_above_ma50']:.1%} above MA50 · AD slope {inputs.breadth['ad_line_slope_10']:.2f}",
        )
        st.caption(
            f"As of: {report.as_of or 'no data'} · universe: {report.universe_size} · eligible: {report.eligible_count}"
        )
        if report.signals:
            for signal in report.signals:
                st.markdown(
                    f"<div class='signal-card'><div class='eyebrow accent'>PAPER TICKET · {signal.setup}</div>"
                    f"<h2>{signal.symbol} <span class='accent'>{signal.cluster.value}</span></h2>"
                    f"<div class='mono'>Entry {format_vnd(signal.entry)} · Qty {signal.quantity:,} · Stop {format_vnd(signal.exit_stop)}</div>"
                    f"<div class='mono'>Target 1 {format_vnd(signal.target_1)} · Target 2 {format_vnd(signal.target_2)} · R:R {signal.risk_reward}</div></div>",
                    unsafe_allow_html=True,
                )
        else:
            st.warning("Không sinh tín hiệu. Xem rejection ledger bên dưới.")
        if report.rejections:
            st.dataframe(
                [
                    {"Symbol": item.symbol, "Gate": item.gate, "Reason": item.reason}
                    for item in report.rejections
                ],
                hide_index=True,
                use_container_width=True,
            )


def journal_page() -> None:
    page_header(
        "EOD paper journal",
        "Immutable scan provenance, candidate/rejection ledger and observed paper outcomes for walk-forward analysis.",
    )
    st.markdown(
        "<div class='risk-card'><b>PAPER ONLY.</b><br>Journal entries document research observations only. "
        "They never submit or route broker orders.</div>",
        unsafe_allow_html=True,
    )
    scans = list_scans(DB_PATH)
    proposals = list_proposals(DB_PATH)
    left, right = st.columns(2)
    with left:
        st.metric("Journaled EOD scans", len(scans))
    with right:
        st.metric("Paper proposals", len(proposals))
    if scans:
        st.subheader("Scan audit trail")
        st.dataframe(scans, hide_index=True, use_container_width=True)
        st.download_button(
            "Export walk-forward CSV", export_journal_csv(DB_PATH), "eod_journal.csv", "text/csv"
        )
        st.download_button(
            "Export walk-forward JSON",
            export_journal_json(DB_PATH),
            "eod_journal.json",
            "application/json",
        )
    else:
        st.info("No journaled scans yet. Run a valid VN100 scan to create the first audit record.")
    if not proposals:
        return
    st.subheader("Observed T+1 and exit outcomes")
    st.caption(
        "Record observed market outcomes against a paper proposal; values remain linked to its original scan session and artifacts."
    )
    labels = {
        f"#{item['proposal_id']} · {item['symbol']} · session {item['data_session']}": item
        for item in proposals
    }
    selected_label = st.selectbox("Paper proposal", list(labels))
    selected = labels[selected_label]
    with st.form("outcome_form"):
        t1_status = st.selectbox(
            "T+1 status", ["NOT_RECORDED", "FILLED", "NOT_FILLED", "GAP_BLOCKED"]
        )
        col1, col2, col3 = st.columns(3)
        t1_open = col1.number_input("T+1 open (VND)", min_value=0, value=0, step=100)
        t1_high = col2.number_input("T+1 high (VND)", min_value=0, value=0, step=100)
        t1_low = col3.number_input("T+1 low (VND)", min_value=0, value=0, step=100)
        exit_date = st.date_input("Exit date (optional)", value=None)
        exit_price = st.number_input("Exit price (VND, optional)", min_value=0, value=0, step=100)
        exit_reason = st.text_input("Exit reason")
        notes = st.text_area("Research notes")
        submitted = st.form_submit_button("Save paper outcome")
    if submitted:
        record_outcome(
            DB_PATH,
            int(selected["proposal_id"]),
            t1_open_vnd=str(t1_open) if t1_open else None,
            t1_high_vnd=str(t1_high) if t1_high else None,
            t1_low_vnd=str(t1_low) if t1_low else None,
            t1_status=None if t1_status == "NOT_RECORDED" else t1_status,
            exit_date=exit_date,
            exit_price_vnd=str(exit_price) if exit_price else None,
            exit_reason=exit_reason or None,
            notes=notes,
        )
        st.success("Paper outcome saved with original scan provenance.")


def execution_page() -> None:
    page_header("Execution lab", "Mô phỏng LO T+1 với giá raw, gap gate và policy khớp minh bạch.")
    left, right = st.columns(2)
    with left:
        close = st.number_input("Close T (VND)", value=61_200, step=100)
        open_price = st.number_input("Open T+1 (VND)", value=61_400, step=100)
        high = st.number_input("High T+1 (VND)", value=62_000, step=100)
    with right:
        low = st.number_input("Low T+1 (VND)", value=61_300, step=100)
        ceiling = st.number_input("Ceiling T+1 (VND)", value=65_400, step=100)
        premium = st.number_input(
            "LO premium", value=0.005, min_value=0.0, max_value=0.99, format="%.3f"
        )
    policy = st.radio("Fill policy", list(FillPolicy), horizontal=True, index=1)
    max_gap = st.number_input(
        "Maximum overnight gap", value=0.02, min_value=0.0, max_value=0.99, format="%.3f"
    )
    if st.button("Simulate T+1 fill", type="primary", use_container_width=True):
        try:
            result = simulate_limit_entry(
                signal_close=MarketPrice.raw(close),
                next_open=MarketPrice.raw(open_price),
                next_high=MarketPrice.raw(high),
                next_low=MarketPrice.raw(low),
                next_ceiling=MarketPrice.raw(ceiling),
                exchange=Exchange.HOSE,
                premium=premium,
                max_gap=max_gap,
                fill_policy=FillPolicy(policy),
            )
            if result.filled:
                st.success(
                    f"FILLED · {format_vnd(result.price_vnd)} · gap {result.overnight_gap:.2%}"
                )
            else:
                st.warning(f"NOT FILLED · {result.reason} · gap {result.overnight_gap:.2%}")
            st.json(
                {
                    "limit_price_vnd": str(result.limit_price_vnd),
                    "reason": result.reason.value,
                    "overnight_gap": str(result.overnight_gap),
                }
            )
        except Exception as exc:
            st.error(str(exc))


view = sidebar()
if view == "Overview":
    overview()
elif view == "Data pipeline":
    pipeline_page()
elif view == "Market scanner":
    market_scanner_page()
elif view == "EOD journal":
    journal_page()
else:
    execution_page()
