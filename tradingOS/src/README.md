# TinTradingOS

TinTradingOS is a personal, long-only, end-of-day research application for
Vietnamese equities. It does not place orders and does not provide investment
advice.

The project is being delivered incrementally. Market rules, data contracts,
and execution simulation are implemented and tested before signal generation.

## Current status

- Implemented: VND price normalization, exchange tick/band helpers, explicit
	T+2 settlement versus next-morning EOD exit, strict CafeF price parsing, and
	T+1 LO fill simulation with raw-price provenance.
- Implemented: price ZIP pipeline with OHLCV QC and idempotent SQLite storage;
  pure-Python indicators; and a paper-only PB_MA20 signal engine with regime,
  dual-RS, sizing, stop geometry, and gate rejection reasons.
- Tested: 100% line and branch coverage for the implemented Python modules.
- Blocked by evidence: CCNN column semantics, point-in-time VN100 membership,
	the exact DATR definition, and stop-loss semantics.
- Safety state: signal generation and real-money use are not enabled.

## Run the implemented pipeline and engine

The current implementation is library-first. It does not download or place
orders automatically. A caller can pass a downloaded CafeF price ZIP to
`run_price_pipeline`, then pass a validated feature snapshot to
`SignalEngine.run`.

```powershell
python -m pytest -q
python -m ruff check .
```

The signal engine currently enables `PB_MA20` for supported non-C3 clusters.
C3 momentum, CCNN order-flow semantics, DATR, and point-in-time VN100
membership remain fail-closed until their evidence contracts are completed.

## Run the Streamlit UI

```powershell
python -m pip install -e ".[ui]"
streamlit run streamlit_app.py
```

The local UI provides Overview, Data pipeline, Paper signals, and Execution lab.
It is paper-only and does not place broker orders.

### VN100 snapshot CSV

The Market scanner is VN100-only and requires a dated, sourced constituent
snapshot that is active on the warehouse's latest EOD session. Use
`config/vn100_snapshot.example.csv` as the schema template:

```csv
symbol,exchange,cluster,effective_from,effective_to,source
VNM,HOSE,C5_DEFENSIVE,2026-08-03,,https://example.org/saved-vn100-review
```

Save the official/public constituent page or document before importing it and
record its URL or archival location in `source`. Do not fill this file with
guessed membership or guessed clusters. The scanner rejects a snapshot with no
members active on the scan date or duplicate active symbols.

Read the [Vietnamese proposal audit](docs/01-bao-cao-tham-dinh-de-xuat.md) and
the [project management plan](docs/pmp/project-management-plan.md) before
expanding the implementation.

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
pytest
ruff check .
pytest --cov=tintradingos --cov-branch --cov-report=term-missing
```
