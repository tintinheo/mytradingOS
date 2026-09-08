# VNQD — BUILD SPECIFICATION FOR AI AGENT

**Vietnam Quant Desk: a personal, zero-cost EOD signal & recommendation system**

**Compute plane: local Windows 11 · View plane: Streamlit Community Cloud**

| | |
|---|---|
| Spec version | 2.0 (English, agent-ready, local-compute) |
| Date | 2026-09-06 |
| Audience | AI coding agent building this from scratch |
| Language | Python 3.12 |
| Budget | $0/month |
| Market | Vietnam equities (HOSE, HNX, UPCOM) |
| Trading style | End-of-day only · T+2 settlement · long-only · **no auto-trading** |
| Users | One (the owner). Not a service. |

---

## HOW TO USE THIS DOCUMENT

This is a complete, self-contained build specification. You need no other document.

- **§1–§3 are non-negotiable.** They describe platform realities that dictate the entire architecture and the Windows-specific pitfalls that will otherwise waste days.
- **§18 is the single source of truth for every numeric constant.** Never hardcode a number anywhere else.
- **§20 is the definition of done.**
- **§21 lists things that will break the system.** Do not do them.
- Build in the order given in **§22**. The order matters: the backtest engine must exist before the signal engine.

Tags used throughout:

| Tag | Meaning |
|---|---|
| `[S]` | **Structural** — fixed by Vietnamese market regulation. Never change. |
| `[M]` | **Measured** — computed from data about a symbol. Not optimised, therefore safe from overfitting. |
| `[A]` | **Academic** — grounded in published research on this specific market. Preserve unless re-tested. |
| `[D]` | **Default** — a starting guess that **must be calibrated** before real money. |

---

## TABLE OF CONTENTS

| § | Section |
|---|---|
| [1](#1-deployment-reality) | Deployment reality |
| [2](#2-architecture-local-compute--cloud-view) | Architecture: local compute + cloud view |
| [3](#3-windows-11-environment--read-this-carefully) | Windows 11 environment — read this carefully |
| [4](#4-repository-layout) | Repository layout |
| [5](#5-dependencies) | Dependencies |
| [6](#6-data-contracts-and-the-publish-boundary) | Data contracts and the publish boundary |
| [7](#7-data-ingestion-cafef) | Data ingestion (CafeF) |
| [8](#8-indicator-formulas) | Indicator formulas |
| [9](#9-stock-profiling-and-clustering) | Stock profiling and clustering |
| [10](#10-signal-pipeline-seven-gates) | Signal pipeline: seven gates |
| [11](#11-setup-catalog) | Setup catalog |
| [12](#12-pricing-stops-and-sizing) | Pricing, stops, and sizing |
| [13](#13-scoring-and-probability) | Scoring and probability |
| [14](#14-timing-and-order-lifecycle) | Timing and order lifecycle |
| [15](#15-exit-rules) | Exit rules |
| [16](#16-streamlit-ui-dual-mode) | Streamlit UI (dual mode) |
| [17](#17-scheduling-on-windows-11) | Scheduling on Windows 11 |
| [18](#18-parameter-registry) | Parameter registry |
| [19](#19-testing-requirements) | Testing requirements |
| [20](#20-acceptance-criteria) | Acceptance criteria |
| [21](#21-do-not-do-this) | Do NOT do this |
| [22](#22-build-order) | Build order |

---

# 1. DEPLOYMENT REALITY

## 1.1. What Streamlit Community Cloud free tier can and cannot do (2026)

| Constraint | Value | Consequence |
|---|---|---|
| **Memory** | ~1 GB RAM | Cannot compute indicators for 1,000+ symbols. Load pre-computed data only. |
| **CPU** | Limited, shared | No model training, no backtests, no heavy loops. |
| **Filesystem** | **Ephemeral** — wiped on reboot and redeploy | **Cannot be the datastore.** Anything written at runtime is lost. |
| **Sleep** | Sleeps after ~12 hours without traffic | **No reliable in-process scheduler.** |
| **Cron** | Not available | Scheduling must be external. |
| **Session timeout** | Long scripts time out | Every page must render in < 10 s. |
| **Private apps** | 1 on the free tier | Deploy this as that one private app. |
| **System packages** | `packages.txt` (apt) | **Unreliable.** TA-Lib's C library frequently fails to build. |

**Conclusion: Streamlit Cloud is a viewer, not a compute environment.** This is not a limitation to work around; it is the correct division of labour.

## 1.2. Why local Windows 11 is a better compute plane than cloud CI

| Property | Local Windows 11 | GitHub Actions | Streamlit Cloud |
|---|---|---|---|
| Scheduled at a fixed **ICT** time | ✅ Task Scheduler, local timezone | ⚠️ UTC cron, delays 5–30 min | ❌ none |
| RAM | Whatever the machine has | ~7–16 GB | ~1 GB |
| Job duration | Unlimited | 6 h cap | seconds |
| **Durable storage** | ✅ Full DuckDB, all history, no file-size limits | ⚠️ repo file limits | ❌ ephemeral |
| Backtest runtime | Hours if needed | 6 h cap | impossible |
| Interactive debugging | ✅ | ❌ | ❌ |
| Secrets (NAV, cash) stay private | ✅ never leave the machine | ⚠️ in repo secrets | ⚠️ in cloud |
| Disabled after inactivity | ✅ never | ⚠️ after 60 days | n/a |
| Requires machine powered on | ⚠️ **yes, ~15:10–16:00 ICT** | ✅ no | n/a |

The single tradeoff is the last row. §17.4 covers missed-run recovery, which makes it a non-issue in practice.

## 1.3. The three decisions these constraints force

**Decision 1 — Split compute from view.** All ingestion, indicators, profiling, clustering, anomaly scoring, signal generation, and backtesting run on the local Windows machine. Streamlit renders pre-computed artifacts and nothing more.

**Decision 2 — Publish a small artifact set to a GitHub `data` branch.** The local machine keeps the full DuckDB warehouse; it pushes roughly 30 MB of derived artifacts that the cloud app reads over HTTPS with `@st.cache_data`. Free, versioned, durable, no infrastructure.

**Decision 3 — One codebase, two modes.** ⭐

```
VNQD_MODE=local   → reads DuckDB directly · journal WRITES to SQLite
                    · can trigger the pipeline from the UI
                    · sees NAV, quantities, positions
VNQD_MODE=cloud   → reads published Parquet from GitHub · journal READ-ONLY
                    · quantities derived from a NAV in st.secrets
```

Same pages, same components. `vnqd/io/` abstracts the difference. This solves the ephemeral-journal problem elegantly: you record fills on the local instance, and the cloud deployment is your read-only mobile view.

## 1.4. Choose a deployment tier

| Tier | Setup | Use when |
|:---:|---|---|
| **0** | Local only. `streamlit run streamlit_app.py` on the same PC. **No GitHub, no cloud.** | You only ever check signals at your desk. Simplest possible. Start here. |
| **1** ⭐ | Local compute + publish to GitHub + Streamlit Cloud view. | You want to check signals on your phone. **Recommended.** |
| **2** | Tier 1 + a GitHub Actions fallback pipeline. | The PC is often off during the 15:15–16:00 window. |

Build Tier 0 first. It is fully functional and needs no accounts. Tier 1 adds one `git push` step. Do not build Tier 2 unless Tier 1 proves insufficient.

## 1.5. Implement indicators in pure NumPy. No TA-Lib.

§8 gives every formula explicitly. Direct implementation is roughly 250 lines and eliminates the largest deployment failure mode. Do not add `TA-Lib`, `pandas-ta`, or anything requiring compilation.

---

# 2. ARCHITECTURE: LOCAL COMPUTE + CLOUD VIEW

```
╔══════════════════════════════════════════════════════════════════════════╗
║  COMPUTE PLANE — Local Windows 11                                        ║
║  Windows Task Scheduler, local time (ICT), durable storage               ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  15:15 ICT  Mon–Fri   run_eod.bat                                        ║
║  ┌────────────────────────────────────────────────────────────────────┐  ║
║  │  1. Download 4 CafeF zips (price adj, price raw, index, CCNN)      │  ║
║  │  2. Parse → normalise → validate (QC gate: abort on failure)      │  ║
║  │  3. Upsert into DuckDB warehouse                                   │  ║
║  │  4. Derive corporate actions from adj/raw ratio                    │  ║
║  │  5. Compute all indicators (§8) + VN100_EW + breadth               │  ║
║  │  6. Anomaly rules → risk score per symbol                          │  ║
║  │  7. Market regime (dual index, conservative reading)               │  ║
║  │  8. Signal engine, 7 gates (§10) → order tickets                   │  ║
║  │  9. Exit engine (§15) → exit alerts, locked-breach warnings        │  ║
║  │ 10. Write publish/ artifacts (§6.4)                                │  ║
║  │ 11. Telegram summary                                               │  ║
║  │ 12. [Tier 1] git commit + push to branch `data`                    │  ║
║  └────────────────────────────────────────────────────────────────────┘  ║
║                                                                          ║
║  08:45 ICT  Mon–Fri   run_premarket.bat                                  ║
║      Gap-gate reminder for pending tickets + overnight disclosure check  ║
║                                                                          ║
║  Sat 09:00 weekly     run_weekly.bat                                     ║
║      Weekly report · backtest refresh · setup statistics                 ║
║                                                                          ║
║  Quarterly            run_quarterly.bat                                  ║
║      ⭐ FULL adjusted-history refresh (§7.4 Trap 2) — mandatory          ║
║      Recompute 14 profile metrics · reassign clusters · stability report ║
║                                                                          ║
║  ┌─ DURABLE LOCAL STORAGE  C:\vnqd\data\ ───────────────────────────┐   ║
║  │  market.duckdb        full multi-year warehouse, all symbols      │   ║
║  │  journal.sqlite       fills, skips, notes — YOUR data, stays here  │   ║
║  │  archive\*.parquet    raw landing zone, by year                    │   ║
║  │  cache\               HTTP cache                                   │   ║
║  │  backtests\           equity curves, metrics, calibration runs     │   ║
║  │  publish\             ⭐ the ONLY folder that leaves this machine  │   ║
║  └───────────────────────────────────────────────────────────────────┘   ║
╚═══════════════════════════════════════╤══════════════════════════════════╝
                                        │  [Tier 1] git push  (~30 MB)
                                        ▼
╔══════════════════════════════════════════════════════════════════════════╗
║  STORAGE — GitHub branch `data`  (versioned, free)                       ║
║  Contains NO personal financial data. See §6.5.                          ║
╚═══════════════════════════════════════╤══════════════════════════════════╝
                                        │  HTTPS raw.githubusercontent.com
                                        ▼
╔══════════════════════════════════════════════════════════════════════════╗
║  VIEW PLANE — Streamlit Community Cloud (VNQD_MODE=cloud)                ║
║  Read-only. Loads Parquet with @st.cache_data(ttl=1800). Renders.        ║
╚══════════════════════════════════════════════════════════════════════════╝

     ┌─ SAME CODEBASE, LOCAL MODE (VNQD_MODE=local) ────────────────┐
     │  streamlit run streamlit_app.py  →  http://localhost:8501     │
     │  Reads DuckDB directly · writes journal · can run pipeline    │
     └───────────────────────────────────────────────────────────────┘
```

## 2.1. Hard rules

> **Rule A.** In cloud mode the app must never download from CafeF, compute an indicator, run a model, or write a file. If a page needs a number, that number must already be in a published artifact.
>
> **Rule B.** `publish/` is the only folder that leaves the machine. `journal.sqlite` and every NAV/cash value stay local, always.
>
> **Rule C.** Both modes share identical page code. Mode-specific behaviour lives only in `vnqd/io/` and is selected by one environment variable.

---

# 3. WINDOWS 11 ENVIRONMENT — READ THIS CAREFULLY

These are the issues that will otherwise consume days of debugging. All of them are specific to running Python data pipelines on Windows.

## 3.1. UTF-8 is mandatory ⭐ the single biggest Windows pitfall

Vietnamese company names and CafeF file contents contain diacritics. On Windows, Python 3.12's default encoding for `open()` is the **locale code page** (typically cp1252/cp1258), not UTF-8. This produces silent corruption or `UnicodeDecodeError` deep in the pipeline.

**Three defences, apply all three:**

```python
# 1. Every file operation names its encoding explicitly. No exceptions.
with open(path, "r", encoding="utf-8") as fh: ...
pl.read_csv(path, encoding="utf8")
df.to_csv(path, index=False, encoding="utf-8")
json.dump(obj, fh, ensure_ascii=False)      # keep Vietnamese readable
```

```bat
REM 2. Every .bat entry point sets UTF-8 mode before invoking Python
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
chcp 65001 > nul
```

```python
# 3. A startup assertion in vnqd/__init__.py that fails loudly
import sys
if sys.flags.utf8_mode != 1:
    raise RuntimeError(
        "UTF-8 mode is off. Set PYTHONUTF8=1 before running. "
        "Vietnamese text will corrupt without it."
    )
```

## 3.2. Paths

```python
from pathlib import Path

# ✅ correct — works on Windows and Linux (CI, and cloud mode)
DATA_DIR = Path(r"C:\vnqd\data")
db_path = DATA_DIR / "market.duckdb"

# ❌ never
db_path = DATA_DIR + "/market.duckdb"       # TypeError
db_path = "C:\vnqd\data\new.parquet"        # \n and \d are escapes!
```

- Install the repo at **`C:\vnqd`**, not under `Documents` or `OneDrive`. Deep paths hit the 260-character limit; OneDrive sync corrupts DuckDB files mid-write.
- Enable long-path support anyway: `git config --global core.longpaths true`.
- All configuration paths come from `vnqd/constants.py`, resolved via `Path`.

## 3.3. Windows Defender exclusion

Real-time scanning inspects every Parquet and DuckDB write. On a 400k-row daily job this can triple runtime.

```powershell
# Run once, as Administrator
Add-MpPreference -ExclusionPath "C:\vnqd\data"
Add-MpPreference -ExclusionProcess "python.exe"
```

## 3.4. DuckDB single-writer constraint

DuckDB permits one writer. If you have the database open in a notebook, DBeaver, or a local Streamlit session, the scheduled job **will fail to acquire the lock**.

```python
# Required pattern
def connect(read_only: bool = False):
    return duckdb.connect(str(DB_PATH), read_only=read_only)

# Local-mode Streamlit MUST open read-only
@st.cache_resource
def get_conn():
    return duckdb.connect(str(DB_PATH), read_only=True)
```

The scheduled job must retry on lock failure and notify:

```python
for attempt in range(3):
    try:
        con = connect(read_only=False); break
    except duckdb.IOException:
        if attempt == 2:
            notify("DuckDB is locked. Close notebooks/DBeaver and re-run.")
            raise
        time.sleep(30)
```

## 3.5. Line endings and Git

Parquet and DuckDB are binary. Without a `.gitattributes`, Git's autocrlf will corrupt them or create enormous spurious diffs.

```gitattributes
# .gitattributes  — commit this before the first data push
* text=auto eol=lf
*.parquet binary
*.duckdb  binary
*.zip     binary
*.sqlite  binary
*.bat     text eol=crlf
*.ps1     text eol=crlf
```

## 3.6. Environment setup, start to finish

```powershell
# 1. Python 3.12 from python.org (NOT the Microsoft Store build — it
#    sandboxes the filesystem and breaks writes to C:\vnqd)
#    Check "Add python.exe to PATH" during installation.

# 2. Fast package manager
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# 3. Project
cd C:\
git clone https://github.com/<owner>/vnqd.git
cd C:\vnqd
uv venv
.\.venv\Scripts\Activate.ps1
uv pip install -r requirements-local.txt

# 4. Local secrets — NEVER committed
#    Create C:\vnqd\.env   (add .env to .gitignore)
#      TELEGRAM_TOKEN=...
#      TELEGRAM_CHAT_ID=...
#      NAV=1000000000
#      AVAILABLE_CASH=300000000
#      VNQD_MODE=local

# 5. Bootstrap the warehouse — one time, ~4 HTTP requests
python -m jobs.bootstrap

# 6. Verify
python -m jobs.run_eod --dry-run
pytest -q

# 7. Local UI
streamlit run streamlit_app.py
```

## 3.7. Automated `git push` from a scheduled task

Task Scheduler runs non-interactively, so Git cannot prompt for credentials.

```powershell
# Recommended: fine-grained Personal Access Token, scoped to this ONE repo,
# permission "Contents: read and write", stored in Windows Credential Manager.
git config --global credential.helper manager
# Then push once manually and enter the PAT when prompted; it is cached.

# Alternative: SSH key with no passphrase
#   ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\vnqd_deploy
#   Add the public key as a repo Deploy Key with write access.
```

Never store a token in the repository or in a `.bat` file.

## 3.8. Encoding-safe Telegram and logging

```python
# Logging must not crash on Vietnamese characters
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "vnqd.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
# Also set PYTHONIOENCODING=utf-8 so StreamHandler survives cmd.exe.
```

---

# 4. REPOSITORY LAYOUT

```
C:\vnqd\
├── streamlit_app.py                # ⭐ Streamlit entry (repo root — Cloud needs this)
├── requirements.txt                # ⭐ CLOUD dependencies only, minimal
├── requirements-local.txt           # LOCAL dependencies (superset)
├── .gitattributes                  # ⭐ §3.5 — commit before first data push
├── .gitignore                      # .env, data/ (except publish/), .venv, logs
├── .env                            # LOCAL ONLY, never committed
├── .streamlit/
│   ├── config.toml                 # theme
│   └── secrets.toml                # LOCAL ONLY, never committed
│
├── scripts/                        # Windows entry points
│   ├── run_eod.bat
│   ├── run_premarket.bat
│   ├── run_weekly.bat
│   ├── run_quarterly.bat
│   ├── run_ui.bat
│   ├── register_tasks.ps1          # creates all Task Scheduler entries
│   └── setup_defender.ps1
│
├── pages/                          # Streamlit multipage (mode-agnostic)
│   ├── 1_Market.py
│   ├── 2_Signals.py
│   ├── 3_Portfolio.py
│   ├── 4_Screener.py
│   ├── 5_Stock_Detail.py
│   ├── 6_Risk_Radar.py
│   ├── 7_Clusters.py
│   ├── 8_Journal.py
│   └── 9_Backtest.py               # local mode only; hidden in cloud
│
├── vnqd/
│   ├── __init__.py                 # UTF-8 assertion (§3.1)
│   ├── constants.py                # ⭐ §18 — the ONLY place for numbers
│   ├── market_rules.py             # bands, ticks, lots, T+2, costs, calendar
│   ├── mode.py                     # ⭐ resolves VNQD_MODE, exposes IS_LOCAL
│   │
│   ├── io/
│   │   ├── base.py                 # DataAccess protocol — both modes implement it
│   │   ├── local_store.py          # DuckDB reader/writer (local)
│   │   ├── cloud_store.py          # raw.githubusercontent Parquet reader (cloud)
│   │   ├── publish.py              # write publish/ artifacts + git push
│   │   ├── journal_store.py        # SQLite (local rw) / Parquet (cloud ro)
│   │   └── http.py                 # polite HTTP client with disk cache
│   │
│   ├── ingest/                     # LOCAL ONLY
│   │   ├── cafef.py
│   │   ├── corp_actions.py
│   │   └── quality.py
│   │
│   ├── indicators/                 # pure NumPy
│   │   ├── trend.py  momentum.py  volatility.py  volume.py
│   │   ├── order_flow.py  breadth.py  seasonal.py
│   │   └── compute.py
│   │
│   ├── profile/
│   │   ├── metrics.py              # 14 profiling metrics
│   │   └── clustering.py           # explicit decision tree
│   │
│   ├── anomaly/
│   │   ├── rules.py                # 29 daily-data rules
│   │   └── scorer.py
│   │
│   ├── signals/
│   │   ├── regime.py  setups.py  scoring.py
│   │   ├── pricing.py  sizing.py  engine.py  exits.py
│   │
│   ├── backtest/                   # LOCAL ONLY
│   │   ├── engine.py  execution.py  costs.py
│   │   ├── metrics.py  validation.py
│   │
│   └── notify/telegram.py
│
├── jobs/                           # LOCAL ONLY entry points
│   ├── bootstrap.py  run_eod.py  run_premarket.py
│   ├── run_weekly.py  run_quarterly.py  run_backtest.py
│
├── config/
│   ├── universe.yaml               # VN100 members, sectors, owner groups
│   ├── commodity_map.yaml           # symbol → commodity ticker (cluster C4)
│   └── trading_calendar.yaml        # holidays, Tet dates
│
├── data/                           # gitignored EXCEPT publish/
│   ├── market.duckdb
│   ├── journal.sqlite
│   ├── archive/  cache/  backtests/
│   └── publish/                    # ⭐ the only tracked subfolder
│
├── tests/
└── logs/
```

## 4.1. Mode resolution and import discipline

```python
# vnqd/mode.py
import os
from enum import StrEnum

class Mode(StrEnum):
    LOCAL = "local"
    CLOUD = "cloud"

def current_mode() -> Mode:
    """Streamlit Cloud has no VNQD_MODE env var, so CLOUD is the safe default:
    a misconfigured cloud deployment must never try to touch DuckDB."""
    return Mode(os.environ.get("VNQD_MODE", "cloud"))

IS_LOCAL = current_mode() is Mode.LOCAL
```

```python
# Pages may import ONLY:
#   vnqd.constants, vnqd.market_rules, vnqd.mode, vnqd.io (facade)
# Never: ingest, backtest, jobs  (guard with test_import_discipline)
```

## 4.2. `.gitignore` essentials

```gitignore
.env
.streamlit/secrets.toml
.venv/
logs/
data/*
!data/publish/
!data/publish/**
__pycache__/
.pytest_cache/
```

---

# 5. DEPENDENCIES

## 5.1. `requirements.txt` — cloud only, keep minimal

Every package here increases cold-start time and memory on a 1 GB instance.

```
streamlit==1.41.0
pandas==2.2.3
numpy==2.1.3
pyarrow==18.1.0
plotly==5.24.1
requests==2.32.3
PyYAML==6.0.2
```

## 5.2. `requirements-local.txt`

```
-r requirements.txt
polars==1.17.1
duckdb==1.1.3
httpx==0.28.1
scikit-learn==1.6.0
lightgbm==4.5.0
pyod==2.0.2
scipy==1.14.1
statsmodels==0.14.4
python-dotenv==1.0.1
pytest==8.3.4
ruff==0.8.4
mypy==1.13.0
```

## 5.3. Forbidden

| Package | Why not |
|---|---|
| `TA-Lib` | C library; fails on Streamlit Cloud, painful on Windows. §8 gives every formula. |
| `pandas-ta` | Fragile against NumPy 2.x; unnecessary. |
| `vnstock` | Excluded by requirement; third-party dependency risk. |
| `apscheduler` | Use Windows Task Scheduler — more reliable, survives reboots. |
| `vectorbt` | Apache 2.0 + Commons Clause. Fine personally but heavy; keep backtest in-house. |
| Any DB server driver | DuckDB locally, Parquet in Git. No server. |

**Do not create `packages.txt`.** If you think you need it, you added a forbidden dependency.

---

# 6. DATA CONTRACTS AND THE PUBLISH BOUNDARY

## 6.1. Local warehouse tables (DuckDB)

| Table | Key | Notes |
|---|---|---|
| `ohlcv_adj` | (date, symbol) | Adjusted OHLCV. **Rebuilt in full each quarter** (§7.4 Trap 2) |
| `ohlcv_raw` | (date, symbol) | Unadjusted. **Append-only, immutable source of truth** |
| `index_px` | (date, index_code) | VNINDEX, HNXINDEX, UPCOM, VN30, plus computed `VN100_EW` |
| `order_flow` | (date, symbol) | From CafeF CCNN: bid/ask volume, bid/ask order counts, foreign buy/sell, value |
| `corp_actions` | (ex_date, symbol) | Derived (§7.5): `adj_ratio`, `implied_type` |
| `features` | (date, symbol) | All indicators from §8 |
| `breadth` | (date) | Market-wide breadth |
| `profiles` | (symbol, as_of) | 14 metrics |
| `clusters` | (symbol, as_of) | cluster + human-readable reason |
| `anomaly_flags` | (date, symbol) | risk_score, level, rule_hits (JSON) |
| `signals` | (id) | Full ticket including qty and NAV — **local only** |
| `regime_history` | (date) | regime, both index scores, breadth inputs |
| `backtest_runs` | (id) | config, metrics, equity-curve path |

## 6.2. `journal.sqlite` — stays local, always

| Table | Columns |
|---|---|
| `fills` | id, signal_id, symbol, action, date, price, qty, fee, note |
| `skips` | signal_id, symbol, date, reason (`gap_cancel` / `not_filled` / `manual_skip` / `reduced`) |
| `positions` | symbol, qty, avg_price, entry_date, exit_stop, target_1, target_2, partial_taken |
| `nav_history` | date, total_nav, cash |
| `notes` | date, symbol, text |

## 6.3. `features` schema (essential columns)

```
date, symbol, exchange, sector, owner_group, cluster, n_obs,
close, open, high, low, volume, raw_close,
ma_10, ma_20, ma_50, ma_100, ma_200,
ma_slope_50, ma_slope_200, dist_ma_20, dist_ma_50, dist_ma_200,
adx_14, macd, macd_signal, macd_hist,
rs_126, rs_126_rank, rs_20, rs_20_rank, mom_252_21,
rsi_9, rsi_14, rsi_21, stoch_k, roc_5, roc_20, roc_60,
atr_14, atr_pct, datr_14, atr_asym,
bb_mid, bb_up, bb_lo, bb_pctb, bb_width, vol_20, nr7,
vol_ma_20, vol_ratio, vol_ratio_3, turnover, adv_20_bn, obv, mfi_14, amihud,
oi, oi_ma_10, otr, avg_bid_size, bid_size_cv, fnet, fnet_5, fnet_20, fnet_sens,
structure_low, support_level, resistance_60,
sector_rs_rank, free_float_pct,
days_to_tet, tet_window, post_tet, month, dow,
anomaly_score
```

## 6.4. `data/publish/` — the artifacts that leave the machine

| File | Contents | Size |
|---|---|---|
| `ohlcv_recent.parquet` | Last 400 sessions, all symbols, adjusted | ~20 MB |
| `features_latest.parquet` | Latest session, one row per symbol | ~2 MB |
| `index_recent.parquet` | VNINDEX + VN100_EW + breadth, 3 years | ~1 MB |
| `flow_recent.parquet` | Order-flow features, last 250 sessions | ~5 MB |
| `profiles.parquet` | 14 metrics per symbol | ~200 KB |
| `clusters.parquet` | symbol → cluster + reason | ~100 KB |
| `corp_actions.parquet` | Derived ex-dates and ratios | ~500 KB |
| `anomaly_latest.parquet` | Risk score per symbol | ~200 KB |
| `regime_history.parquet` | Regime per session, 3 years | ~100 KB |
| `signals_latest.json` | **Percentage-based tickets** (§6.5) | ~20 KB |
| `exits_latest.json` | Exit alerts, percentage-based | ~10 KB |
| `rejections_latest.json` | Why each symbol failed, by gate | ~200 KB |
| `setup_stats.json` | Fill rate, hit rate, expectancy per (setup, cluster) | ~10 KB |
| `journal_summary.parquet` | Anonymised: outcomes in **R multiples**, no VND | ~50 KB |
| `run_meta.json` | Status, dates, row counts, QC results | ~2 KB |

Total ≈ 30 MB. Well under GitHub's per-file limits.

## 6.5. Privacy boundary ⭐

**Published tickets contain no VND amounts and no NAV.** They express size as a percentage of NAV; the cloud app multiplies by a NAV held in `st.secrets`. The `data` branch therefore holds no personal financial information even if the repository is public.

```json
{
  "generated_at": "2026-09-04T15:47:00+07:00",
  "trading_date": "2026-09-04",
  "place_orders_on": "2026-09-07",
  "regime": "UPTREND",
  "regime_factor": 0.85,
  "signals": [
    {
      "id": "a3f9c1d2",
      "symbol": "VNM",
      "exchange": "HOSE",
      "sector": "Food & Beverage",
      "owner_group": null,
      "cluster": "C5_defensive",
      "setup": "PB_MA20",
      "extra_setups": ["REV_SUP"],
      "close_T": 61200,
      "entry": 61500,
      "entry_order_type": "LO",
      "exit_stop": 57100,
      "sizing_stop": 56100,
      "target_1": 70300,
      "target_2": 76900,

      "weight_pct": 0.0554,
      "risk_pct_at_exit_stop": 0.0040,
      "risk_pct_at_sizing_stop": 0.0049,
      "tail_risk_pct_3_floors": 0.0108,

      "technical_score": 79.0,
      "win_probability": 0.58,
      "risk_reward": 2.0,
      "anomaly_score": 12.0,
      "max_gap_pct": 0.015,
      "earliest_exit_date": "2026-09-10",
      "locked_sessions": 3,
      "reasons": {
        "rs_126_rank": 74.0, "rs_20_rank": 28.0, "vol_ratio_3": 0.82,
        "fnet_5_bn": 12.4, "dist_ma_200": 0.083, "atr_asym": 1.15
      },
      "setup_stats": {
        "fill_rate": 0.86, "mean_overnight_gap": 0.003,
        "hit_rate_oos": 0.57, "expectancy_r": 0.38,
        "max_consecutive_losses": 6, "sample_size": 184
      }
    }
  ]
}
```

Local mode reads `qty` and VND figures from DuckDB. Cloud mode computes `qty = floor(weight_pct * NAV / entry / 100) * 100`.

## 6.6. `run_meta.json`

```json
{
  "run_id": "2026-09-04T15:47:12+07:00",
  "trading_date": "2026-09-04",
  "status": "OK",
  "qc": {"all_passed": true, "failures": []},
  "row_counts": {"ohlcv": 401234, "features": 1018, "flow": 998},
  "sources": {"cafef_price_adj": "OK", "cafef_ccnn": "OK", "fallback_used": false},
  "duration_seconds": 187,
  "profiles_as_of": "2026-07-01",
  "cluster_stability": 0.71,
  "host": "local-windows",
  "warnings": []
}
```

Streamlit must display `status` and `trading_date` prominently and warn loudly if `trading_date` is not the latest expected trading day.

---

# 7. DATA INGESTION (CAFEF)

## 7.1. URL pattern (verified 2026-09-06)

```
https://cafef1.mediacdn.vn/data/ami_data/{YYYYMMDD}/CafeF.{KIND}.{DDMMYYYY}.zip
```

⚠️ **The directory uses `YYYYMMDD`; the filename uses `DDMMYYYY`.** This is the most common implementation bug. Write `test_build_url` first.

| Purpose | KIND | Daily | Full history |
|---|---|---|---|
| Adjusted prices, 3 exchanges | `SolieuGD` | `CafeF.SolieuGD.04092026.zip` | `CafeF.SolieuGD.Upto04092026.zip` |
| Raw prices | `SolieuGD.Raw` | `CafeF.SolieuGD.Raw.04092026.zip` | `CafeF.SolieuGD.Raw.Upto04092026.zip` |
| Indices | `Index` | `CafeF.Index.04092026.zip` | `CafeF.Index.Upto04092026.zip` |
| Order flow + foreign | `CCNN` | `CafeF.CCNN.04092026.zip` | `CafeF.CCNN.Upto04092026.zip` |

Insert `Upto` immediately before the date.

## 7.2. Bootstrap versus daily

- **Bootstrap (once):** download the four `Upto` files → entire multi-year history for all three exchanges in **four HTTP requests**.
- **Daily:** download the four dated files, append.

## 7.3. Expected contents

AmiBroker text format inside the zip:

```
<Ticker>,<DTYYYYMMDD>,<Open>,<High>,<Low>,<Close>,<Volume>
AAA,20260904,8500,8720,8480,8650,1234500
```

`CCNN` adds bid/ask volume, bid/ask order counts, foreign trading, and traded value.

> ### FIRST TASK, BEFORE ANY OTHER CODE
> Download one file by hand, unzip it, print the first five lines, and **write the real column order into `tests/fixtures/cafef_price_sample.csv`**. Do not trust the layout above. Everything downstream depends on it.

## 7.4. Three traps

**Trap 1 — Daily files are pruned.** Dated daily files vanish after roughly 2–3 days; `Upto` files persist. Implement `recover_from_upto()` and call it whenever a gap is detected.

**Trap 2 — Adjusted price history is NOT append-only.** ⭐

Every stock dividend, bonus issue, or rights issue **rewrites that symbol's entire adjusted history**. Appending daily files causes silent drift over months with no error raised.

```
ohlcv_raw  → append-only, immutable truth
ohlcv_adj  → derived; FULL REBUILD from SolieuGD.Upto every quarter
             (run_quarterly.bat — mandatory, not optional)
```

**Trap 3 — Free service, no SLA.** CafeF has previously had periods where EOD data stopped updating. Fail loudly:

```python
if rows_today < 0.90 * rows_previous_session:
    raise DataQualityError(
        "Row count fell >10% versus the previous session. "
        "Refusing to generate signals on suspect data."
    )
```

## 7.5. Derive corporate actions for free ⭐

Because both adjusted and raw series exist, the whole historical ex-date calendar can be reverse-engineered. No scraping required.

```python
factor(t)    = adj_close(t) / raw_close(t)     # constant between actions
adj_ratio(t) = factor(t) / factor(t-1)         # a jump means an action
```

Filter jumps below 0.5% as tick-rounding noise. Rough classification: ratio > 0.97 → cash dividend; 0.75–0.97 → stock dividend or rights; < 0.75 → major issuance.

**Mandatory validation:** pick three symbols with known stock-dividend history, print the derived ex-dates and ratios, and confirm by eye. Do not skip this.

## 7.6. Quality gate — runs before any signal is generated

Abort the run and notify on any failure.

```python
CHECKS = [
    "latest date in ohlcv_adj equals the latest date in the trading calendar",
    "row count >= 90% of the previous session",
    "no |return| > band * 1.05 without a corporate action on that date",
    "low <= min(open, close) and high >= max(open, close) for every row",
    "volume >= 0 for every row",
    "no duplicate (date, symbol)",
    "clusters.as_of is within 100 days",
    "anomaly_flags has rows for the latest date",
    "VN100_EW computed for the latest date",
]
```

## 7.7. Polite fetching

```
User-Agent: VNQD-Personal/2.0 (personal research)
Max 1 request/second per host, with jitter
Exponential backoff on 429/5xx; give up after 3 attempts
Cache every response to data/cache/; never re-download
Roughly 4–5 requests per day total
```

Personal use falls within the intent of a freely published dataset. **Do not redistribute, republish, or build a service on this data.**

---

# 8. INDICATOR FORMULAS

Implement all of these in pure NumPy under `vnqd/indicators/`. All on **adjusted** prices. Notation: `C`=close, `H`=high, `L`=low, `O`=open, `V`=volume, `t`=current session.

## 8.1. Trend

| Name | Formula |
|---|---|
| `ma_{n}` | `mean(C[t-n+1 : t+1])`, n ∈ {10, 20, 50, 100, 200} |
| `ema_{n}` | `α·C[t] + (1-α)·ema[t-1]`, `α = 2/(n+1)`, seeded with SMA |
| `ma_slope_{n}` | `ma_n[t] / ma_n[t-10] - 1` |
| `dist_ma_{n}` | `(C[t] - ma_n[t]) / ma_n[t]` |
| `adx_14` | Wilder ADX, 14 periods |
| `macd`, `macd_signal`, `macd_hist` | `ema_12 - ema_26`; `ema_9(macd)`; difference |

## 8.2. Momentum and relative strength ⭐ the core

> ### UNIFYING PRINCIPLE
> **Medium-term momentum selects WHICH stock. Short-term reversal selects WHEN to buy it.**
>
> Basis: research on this market documents medium-term momentum (portfolios formed on the prior 6 months, held 9 months) alongside short-term reversal (loser-portfolio reversals at 1–3 month horizons on HOSE, with abnormal-return spreads of 1.80% and 2.17% significant at 5%; on HNX, strongly negative abnormal returns at one month, fading by two, gone by three). The two coexist at different horizons.
>
> **Entry condition = high `rs_126_rank` AND low `rs_20_rank`** → *"a strong stock that is temporarily oversold."*
>
> Every setup, score, and threshold in this spec is a filter refining that condition. If you had to delete everything but one rule, keep this one.

| Name | Formula | Role |
|---|---|---|
| `rs_126` `[A]` | `(C[t]/C[t-126]) / (IDX[t]/IDX[t-126]) - 1` | 6-month RS — picks the stock |
| `rs_126_rank` | cross-sectional percentile within VN100 × 100 | |
| `rs_20` `[A]` | `(C[t]/C[t-20]) / (IDX[t]/IDX[t-20]) - 1` | 1-month RS — picks the timing |
| `rs_20_rank` | percentile × 100 | |
| `mom_252_21` `[A]` | `C[t-21]/C[t-252] - 1` | 12-1 momentum; skip last month to avoid reversal noise |
| `rsi_{n}` | Wilder RSI, n ∈ {9, 14, 21} | |
| `stoch_k` | `100 × (C - min(L,14)) / (max(H,14) - min(L,14))` | |
| `roc_{n}` | `C[t]/C[t-n] - 1`, n ∈ {5, 20, 60} | |

### Reference index by cluster

| Cluster | `IDX` |
|---|---|
| C1, C4, C5, C6 | **`VN100_EW`** (self-computed, equal weight) |
| C2, C3 | `VNINDEX` |

**Why:** VN-Index is dominated by its largest constituents, which limits the influence of every other stock. In 2025, VIC and VHM alone contributed roughly 372 of the index's 517.71-point gain. Measuring VIC's relative strength against an index that VIC largely *is* is circular.

```python
# VN100_EW
VN100_EW[0] = 1000.0
VN100_EW[t] = VN100_EW[t-1] * (1 + mean(r_i[t] for i in VN100 if traded_today))
#   r_i[t] = C_i[t]/C_i[t-1] - 1 ;  skip non-trading symbols
#   refresh membership each index review period
```

## 8.3. Volatility

| Name | Formula |
|---|---|
| `tr` | `max(H-L, abs(H-C[t-1]), abs(L-C[t-1]))` |
| `atr_14` | Wilder: `(atr[t-1]*13 + tr[t]) / 14` |
| `atr_pct` | `atr_14 / C[t]` |
| `datr_14` `[A]` ⭐ | ATR computed **only over sessions where `C[t] < C[t-1]`** |
| `atr_asym` | `datr_14 / atr_14` |
| `bb_mid`, `bb_up`, `bb_lo` | `ma_20`; `ma_20 ± 2·std(C,20)` |
| `bb_pctb` | `(C - bb_lo) / (bb_up - bb_lo)` |
| `bb_width` | `(bb_up - bb_lo) / bb_mid` |
| `vol_20` | `std(ln(C[t]/C[t-1]), 20) · sqrt(250)` |
| `nr7` | `1` if `(H-L)` is the smallest of the last 7 sessions |

> ⭐ **`datr_14` is mandatory.** Research on HOSE finds negative shocks produce larger volatility than positive shocks of equal magnitude. Symmetric ATR therefore understates downside risk — and with three locked sessions under T+2 (§14), that is real account risk, not an academic footnote.

## 8.4. Volume and liquidity

| Name | Formula |
|---|---|
| `vol_ma_20` | `mean(V, 20)` |
| `vol_ratio` | `V[t] / vol_ma_20[t]` |
| `vol_ratio_3` | `mean(V, 3) / vol_ma_20` |
| `turnover` | `C[t] · V[t]` |
| `adv_20_bn` | `mean(turnover, 20) / 1e9` — **VND billions** |
| `obv` | `obv[t-1] + sign(C[t]-C[t-1]) · V[t]` |
| `mfi_14` | Wilder Money Flow Index |
| `amihud` | `mean(abs(r) / turnover, 60) · 1e9` |

## 8.5. Order flow (from CafeF CCNN) ⭐

Daily-resolution microstructure. Few Vietnamese platforms expose this.

| Name | Formula | Meaning |
|---|---|---|
| `oi` | `(bid_vol - ask_vol) / (bid_vol + ask_vol)` | Order imbalance ∈ [-1,1] |
| `oi_ma_10` | `mean(oi, 10)` | Sustained one-sided pressure |
| `otr` | `(bid_vol + ask_vol) / matched_vol` | Order-to-trade ratio |
| `avg_bid_size` | `bid_vol / bid_orders` | Mean buy order size |
| `bid_size_cv` ⭐ | `std(avg_bid_size,20) / mean(avg_bid_size,20)` | **Low CV = suspiciously repetitive order sizes** |
| `fnet` | `foreign_buy - foreign_sell` | Foreign net |
| `fnet_5`, `fnet_20` | rolling sums | Cumulative foreign flow |
| `fnet_sens` | `corr(r, fnet, 60)` | Foreign-flow sensitivity |

> Foreign flow is a genuine confirming signal: foreign investors on this market have been found to be positive-feedback traders with better timing ability, and liquidity relates positively to returns.

## 8.6. Market breadth (across all listed symbols, not just VN100)

| Name | Formula |
|---|---|
| `pct_above_ma20/50/200` | `count(C > ma_n) / count(all)` |
| `ad_ratio` | `count(r>0) / max(count(r<0), 1)` |
| `ad_line` | `ad_line[t-1] + (advances - declines)` |
| `ad_line_slope_10` | `ad_line[t] - ad_line[t-10]` |
| `new_high_52w`, `new_low_52w` | counts |
| `ceil_count`, `floor_count` | limit-up / limit-down counts |
| `mkt_turnover` | sum of `turnover` |

## 8.7. Seasonality context

| Name | Formula | Basis |
|---|---|---|
| `days_to_tet` | sessions until Lunar New Year | Mean returns in the 5 sessions **before** Tet exceed those in the 5 after |
| `tet_window` | `1 if 1 <= days_to_tet <= 10` | Positive window |
| `post_tet` | `1 if -5 <= days_to_tet <= 0` | ⚠️ **No reliable post-holiday effect — must NOT be rewarded** |
| `month`, `dow` | calendar | January effect documented |

Use only as a ±10% score adjustment. **Never as a standalone setup.**

---

# 9. STOCK PROFILING AND CLUSTERING

Quarterly, on a 250-session window. This is **measurement, not optimisation** — which is exactly why it is safe from overfitting.

## 9.1. Why not optimise indicators per symbol

The instinct to tune each of 100 symbols individually is understandable but mathematically doomed:

```
Per symbol : ~3,750 sessions BUT only ~5–6 independent market cycles
6 tuned parameters → ~10^6 combinations × 100 symbols = 10^8 trials
Worse: Vietnamese stock returns are documented as highly correlated
       with high volatility and low persistence
⇒ 100 symbols are NOT 100 independent samples — closer to 10–15
⇒ You would be optimising noise, and it would look excellent in-sample
```

But the differences between symbols **are** real. Research on VN30 constituents found that purely momentum-based models work satisfactorily **for specific stocks**, that long-only outperforms long-short, and that there are significant deviations among individual index components. The difference lies in **which strategy suits which stock**, not in what the optimal parameter is. That question is answerable.

**Three tiers:**

```
TIER 1  CLASSIFY   quarterly · measure 14 metrics · assign 1 of 6 clusters
                   → no optimisation at all, pure measurement
TIER 2  CALIBRATE  yearly · pooled per cluster (15–25 symbols each)
                   → 6 clusters × 4 parameters = 24, not 600
                   → 96% smaller parameter space, 96% less overfit risk
TIER 3  ADJUST     automatic · structurally stable facts only
                   → liquidity, tick, band, beta, gap_p90, floor streak
                   → these are TRUTHS about the symbol, not tuned values
```

## 9.2. The 14 profiling metrics

| # | Metric | Formula | Purpose |
|:---:|---|---|---|
| 1 | `variance_ratio_5` ⭐ | `Var(r_5) / (5·Var(r_1))`, non-overlapping 5-day blocks | **Most important.** >1 trending, <1 mean-reverting |
| 2 | `hurst` | slope of `log(std(p[lag:]-p[:-lag]))` vs `log(lag)`, lags 2–60, log prices | Cross-check for #1 |
| 3 | `autocorr_sum_1_5` | `sum(corr(r_t, r_{t-k}))`, k=1..5 | Tests the "past 1–5 day returns predict next-day sign" finding |
| 4 | `vol_annual` | `std(r)·sqrt(250)` | Sizing, stop width |
| 5 | `atr_pct` | `atr_14 / C` | Normalised volatility |
| 6 | `downside_atr_pct` | `datr_14 / C` | Leverage effect |
| 7 | `atr_asymmetry` | `datr_14 / atr_14` | >1.3 = strongly asymmetric |
| 8 | `beta` | OLS vs reference index, 250 sessions | Systematic exposure |
| 9 | `idio_share` | `1 - corr(r, r_idx)²` | >0.6 = own story, not index-driven |
| 10 | `adv20_bn` | `mean(turnover,20)/1e9` | Capacity |
| 11 | `amihud` | see §8.4 | Price impact |
| 12 | `gap_p90` ⭐ | 90th percentile of `open[t+1]/close[t] - 1` | **Critical for EOD style** |
| 13 | `limit_hit_freq` | `count(abs(r) >= 0.95·ln(1+band)) / 250` | Exit-ability risk |
| 14 | `max_floor_streak` ⭐ | longest run of consecutive limit-downs, full history | **Tail risk under 3 locked sessions** |

Plus `gap_median` and `foreign_sensitivity`.

## 9.3. Why variance ratio is the key metric

It directly answers the question that determines everything else: *momentum or mean reversion for this stock?*

```
VR > 1.15  → positive autocorrelation, persistent trends → trend / momentum
0.85–1.15  → near random walk                            → neutral
VR < 0.85  → negative autocorrelation, oscillation        → pullback / reversal
```

Given the reversal evidence, **expect most Vietnamese stocks to show VR < 1 at the 1–4 week horizon.** A minority will show VR > 1 — precisely the stocks where momentum "works satisfactorily for specific stocks." Measuring VR is how you find them from data rather than guessing.

## 9.4. Clustering — explicit decision tree, not k-means

Reasons: explainable (you know exactly why HPG landed in C4), stable across runs (k-means reshuffles labels), and each threshold is a testable hypothesis.

```python
def assign_cluster(p: StockProfile) -> tuple[Cluster, str]:
    # --- EXCLUSION GATES, checked first ---
    if p.adv20_bn < 20.0:
        return EXCLUDED, f"ADV {p.adv20_bn:.1f}bn < 20bn"
    if p.max_floor_streak >= 5:
        return EXCLUDED, f"had {p.max_floor_streak} consecutive limit-downs"
    if p.gap_p90 > 0.045:
        return EXCLUDED, f"overnight gap p90 {p.gap_p90:.1%} too high for EOD"

    # --- SECTOR DOMINATES BEHAVIOUR for these two ---
    if p.symbol in BANK_SYMBOLS:
        return C2_BANK, "banking sector"
    if p.symbol in COMMODITY_SYMBOLS and p.idio_share > 0.45:
        return C4_COMMODITY, f"commodity cycle, idio {p.idio_share:.0%}"

    # --- STATISTICAL CLASSIFICATION ---
    if p.vol_annual < 0.28 and p.beta < 0.85 and p.limit_hit_freq < 0.02:
        return C5_DEFENSIVE, "low vol, low beta, rare limit hits"
    if p.beta > 1.25 and p.vol_annual > 0.38:
        return C3_HIGH_BETA, f"beta {p.beta:.2f}, vol {p.vol_annual:.0%}"
    if p.vol_annual > 0.45 or p.limit_hit_freq > 0.05 or p.max_floor_streak >= 3:
        return C6_VOLATILE_MID, "high volatility / limit-hit risk"
    if p.symbol in MEGA_CAP_SYMBOLS or (p.adv20_bn > 200 and p.vol_annual < 0.35):
        return C1_MEGA, f"ADV {p.adv20_bn:.0f}bn, moderate vol"

    # --- FALL BACK TO TIME-SERIES CHARACTER ---
    if p.variance_ratio_5 > 1.15:
        return C4_COMMODITY, f"VR={p.variance_ratio_5:.2f} → trending"
    if p.variance_ratio_5 < 0.85:
        return C5_DEFENSIVE, f"VR={p.variance_ratio_5:.2f} → mean-reverting"

    return C6_VOLATILE_MID, "no clear match → conservative bucket"
```

## 9.5. The six clusters

> ⚠️ Membership must be **decided by the metrics**, never hardcoded. Symbol lists exist only for sector/owner tagging in `config/universe.yaml`.

| Cluster | Character | Primary logic | Key notes |
|---|---|---|---|
| **C1** Mega-cap anchors | High liquidity, moderate vol, beta ≈ 1 | Trend + pullback | ⚠️ These stocks *are* the index → must use `VN100_EW` for RS and regime |
| **C2** High-liquidity banks | Very high intra-cluster correlation, low idio vol | Mean reversion | Sector timing beats stock picking → **max 2 positions** |
| **C3** High-beta amplifiers (brokers) | Beta 1.3–1.8, vol 40–60% | **Momentum** | The **only** momentum cluster, and **only** in `STRONG_UPTREND` |
| **C4** Commodity cyclicals | High idio vol, externally driven | Trend + commodity gate | Requires commodity price above its own MA50 |
| **C5** Low-vol defensives | Vol < 28%, beta < 0.85, VR < 0.85 | **Mean reversion** | Tightest stop **and** largest weight — the portfolio backbone |
| **C6** Volatile mid-caps | Vol > 45%, frequent limit hits | Mean reversion | Most dangerous under T+2: max 5% weight, max 1 position, **no margin** |

## 9.6. Owner-group limits (separate from sector limits)

HOSE itself caps related-stock groups at 15% of the VN30 basket — the exchange treats a corporate group as one risk. Do the same.

| Group | Members | Combined cap `[D]` |
|---|---|:---:|
| Vingroup | VIC, VHM, VRE, VPL | 15% NAV |
| Masan | MSN, MCH, MSR | 12% NAV |
| Techcombank | TCB, TCX | 12% NAV |
| Gelex | GEX, GEE, VCK | 10% NAV |
| Others | as discovered | 10% NAV |

Four Vingroup tickers are not four investments. They are one investment split four ways.

## 9.7. Cluster stability check — required

```python
def cluster_stability(history: dict[str, list[Cluster]]) -> float:
    """Fraction of quarter-over-quarter assignments unchanged.
    < 0.60 means the clustering is fitting noise, not structure.
    Remedy: reduce to 4 clusters, or widen thresholds.
    Record the value in run_meta.json.
    """
```

---

# 10. SIGNAL PIPELINE: SEVEN GATES

Every symbol must pass **all seven gates in order**. Failing any gate is immediate rejection — no "close enough". Record every rejection with gate and reason into `rejections_latest.json`; that file is what makes the system debuggable.

```
GATE 0  MARKET REGIME
        regime == DOWNTREND  →  ABORT THE RUN, emit zero signals
        └─ Herding on this market is documented as stronger in falling
           markets than rising ones. Mean-reverting into a downtrend is
           the classic account-killer.
                              ▼
GATE 1  UNIVERSE ELIGIBILITY
        in VN100 or watchlist · n_obs >= 280 · adv_20_bn >= 20
        · not on warning/control/restricted list · cluster != EXCLUDED
                              ▼
GATE 2  ANOMALY RISK
        anomaly_score < params.max_anomaly_score    (C6:40 · C3:50 · else 55–60)
                              ▼
GATE 3  CLUSTER × REGIME MATCH
        regime_rank >= regime_rank(params.min_regime)
        AND exogenous gate satisfied (C4 commodity · C3 turnover · C2 sector)
                              ▼
GATE 4  DUAL CONDITION + SETUP  ⭐
        4a  rs_126_rank >= 60
            AND (rs_20_rank <= 40  if logic != MOMENTUM
                 rs_20_rank >= 65  if logic == MOMENTUM)
        4b  at least one setup from the cluster's allowed list fires
            AND vol_ratio >= params.min_volume_ratio
                              ▼
GATE 5  SCORE, PROBABILITY, GEOMETRY
        technical_score >= 60 · win_probability >= 0.55 (skip if n<30)
        · risk_reward >= 2.0 · R/atr_14 >= 0.8
        · target_1 not blocked by nearby resistance · entry < ceiling·0.995
                              ▼
GATE 6  PORTFOLIO CONSTRAINTS
        not already held · open positions < 10 · sector weight <= 35%
        · owner-group weight <= cap · max 2 in C2 · max 1 in C6
        · total open risk <= 5% NAV · sufficient cash · notional >= 10m VND
                              ▼
RANK AND SELECT
        composite = 0.6·(score/100) + 0.4·win_probability
        diversify: max 2 per cluster, max 2 per sector, per day
        take top N, N = min(3, free_position_slots)
```

## 10.1. Market regime (Gate 0)

Use **both** indices; take the more conservative reading when they disagree.

```python
def compute_regime(vni: dict, ew: dict, breadth: dict) -> Regime:
    """vni/ew: {close, ma50, ma200}
    breadth: {pct_above_ma50, ad_line_slope_10}
    """
    def sc(ix):
        return int((ix["close"] > ix["ma50"])
                   + (ix["close"] > ix["ma200"])
                   + (ix["ma50"] > ix["ma200"]))

    s = min(sc(vni), sc(ew))          # ⭐ divergence → take the lower score
    b50 = breadth["pct_above_ma50"]

    if s == 3 and b50 >= 0.60 and breadth["ad_line_slope_10"] > 0:
        return Regime.STRONG_UPTREND
    if s >= 2 and b50 >= 0.45:
        return Regime.UPTREND
    if s >= 1 and b50 >= 0.35:
        return Regime.SIDEWAY
    if s >= 1 or b50 >= 0.25:
        return Regime.MILD_CORRECTION
    return Regime.DOWNTREND
```

| Regime | Clusters allowed | `regime_factor` |
|---|---|:---:|
| `STRONG_UPTREND` | all C1–C6 | 1.00 |
| `UPTREND` | C1, C2, C4, C5 | 0.85 |
| `SIDEWAY` | C1, C2, C4, C5 | 0.65 |
| `MILD_CORRECTION` | **C5 only** | 0.40 |
| `DOWNTREND` | **none** | 0.00 |

---

# 11. SETUP CATALOG

`P` denotes the cluster parameter set. Implement each as a pure function returning `bool`.

### S1 · `PB_MA20` — pullback to MA20 ⭐ the workhorse

```
TREND CONTEXT (all must hold)
    ma_20 > ma_50 > ma_200
    ma_slope_50 > 0
    C > ma_200 * 1.02

PULLBACK
    -0.04 <= dist_ma_20 <= 0.02
    min(L[t-4:t+1]) <= ma_20 * 1.005          # actually touched MA20
    rsi_14 < P.rsi_buy_max

PULLBACK QUALITY (separates a healthy dip from distribution)
    mean(V[t-4:t+1]) < vol_ma_20 * 1.10       ⭐ volume must FALL on the dip
    max(C[t-20:t+1]) / C - 1 <= 0.15          # not a collapse

TRIGGER CANDLE (any one)
    (a) C > O and C > C[t-1]
    (b) (C - L) / max(H - L, eps) > 0.60
    (c) C > max(H[t-1], H[t-2])
```

### S2 · `PB_MA50` — deeper pullback

```
    ma_50 > ma_200 and ma_slope_200 > 0
    -0.05 <= dist_ma_50 <= 0.03
    min(L[t-9:t+1]) <= ma_50 * 1.01
    rsi_14 < P.rsi_buy_max - 3
    mean(V[t-4:t+1]) < vol_ma_20 * 1.15
    + trigger candle as S1
```

### S3 · `REV_SUP` — reversal at support

```
    C > ma_200
    C <= support_level * 1.02
        support_level = max(min(L[t-59:t-4]), fib_618(swing_high, swing_low))
    rsi_14 < 40
    bullish RSI divergence: C < C[prev_low] and rsi_14[t] > rsi_14[prev_low]
    V > vol_ma_20 * 1.2        ⭐ volume must RISE here — opposite of S1/S2
    C > O
```

### S4 · `BB_LOWER` — lower Bollinger band (cluster C5 only)

```
    C > ma_200
    bb_pctb < 0.08
    rsi_21 < 35
    bb_width > percentile(bb_width, 250, 30)     # some volatility must exist
    C > L[t-1]
```

### S5 · `TREND_MA` — trend following

```
    ma_20 > ma_50 > ma_200
    ma_slope_50 > 0.01 and ma_slope_200 > 0
    adx_14 > 20
    0 <= dist_ma_20 <= 0.06
    rs_126_rank >= 70
    vol_ratio >= 1.0
```

### S6 · `RS_LEADER` — relative-strength leader

```
    rs_126_rank >= 85
    C >= max(C[t-251:t+1]) * 0.92
    ma_50 > ma_200
    sector_rs_rank >= 70
    rs_20_rank <= 55                    # strong but not yet overheated
```

### S7 · `MOM_20` — 20-day momentum (**cluster C3 ONLY**)

```
    regime == STRONG_UPTREND             ⭐ hard requirement
    rs_20_rank >= 65 and rs_126_rank >= 60
    C > ma_10 > ma_20 > ma_50
    55 < rsi_9 < 78
    vol_ratio >= 1.5
    mkt_turnover > mean(mkt_turnover, 20)
```

### S8 · `VCP` — volatility contraction

```
    ma_50 > ma_200
    three consecutive 10-session windows with shrinking range:
        range_1 > range_2 > range_3
    bb_width < percentile(bb_width, 250, 25)
    mean(V[t-9:t+1]) < vol_ma_20 * 0.85
    C >= max(C[t-9:t+1])
    V >= vol_ma_20 * 1.5
```

### Setup × cluster matrix

| Setup | C1 | C2 | C3 | C4 | C5 | C6 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `PB_MA20` | ●● | ●●● | ● | ●● | ●● | ●●● |
| `PB_MA50` | ●● | ●● | – | ●● | ● | ● |
| `REV_SUP` | ● | ● | – | ● | ●●● | ● |
| `BB_LOWER` | – | ● | – | – | ●●● | – |
| `TREND_MA` | ●●● | ● | ● | ●●● | ● | – |
| `RS_LEADER` | ●● | ● | ●● | ●● | – | ● |
| `MOM_20` | ✗ | ✗ | ●●● | ● | ✗ | ✗ |
| `VCP` | ● | – | ● | ● | – | – |

`●●●` primary · `●●` good · `●` allowed · `–` unused · `✗` forbidden

**Multiple setups firing:** take the highest-priority as primary; add **+3** to `technical_score` per additional setup, capped at **+6**.

**`GAP_GO` and every intraday setup: do not implement.** They are structurally impossible under EOD execution (§14.4).

---

# 12. PRICING, STOPS, AND SIZING

## 12.1. Entry price

```python
# Step 1 — base limit price, computed on the evening of session T
lo_raw = close_T * (1 + premium)

# Step 2 — round DOWN to the exchange tick (never accidentally pay more)
entry = round_to_tick(lo_raw, exchange)

# Step 3 — the gap gate next morning may still cancel this (§14.3)
```

### Premium by setup, not by cluster `[D]`

Premium depends on the setup's overnight-gap exposure.

| Setup | Premium | Rationale |
|---|:---:|---|
| `PB_MA20`, `PB_MA50`, `REV_SUP`, `BB_LOWER` | +0.5% | Buying weakness; no need to chase |
| `TREND_MA`, `RS_LEADER` | +1.0% | Timing not critical; prioritise the fill |
| `MOM_20` | +0.8% | Needs a fill but carries gap risk |
| `VCP` | +0.3% | Highest gap risk — prefer no fill over a bad price |

### Tick rounding `[S]`

```python
def round_to_tick(price: float, exchange: str) -> float:
    if exchange == "HOSE":
        tick = 10 if price < 10_000 else (50 if price < 50_000 else 100)
    else:                                    # HNX, UPCOM
        tick = 100
    return (price // tick) * tick
```

### Price bands `[S]`

`HOSE ±7%` · `HNX ±10%` · `UPCOM ±15%`

Reject if `entry >= ceiling * 0.995` — a limit order at the ceiling cannot fill.

## 12.2. The dual-stop system ⭐ the most important design element

This follows directly from having **three sessions during which you cannot exit** (§14).

```python
# ═══ EXIT STOP — narrow. The price at which the system tells you to sell.
exit_stop = round_to_tick(min(
    structure_low - 0.5 * atr_14,
    entry * (1 - P.max_stop_pct),
), exchange)
# structure_low = min(L[t-9:t+1])   for pullback setups
#               = support_level      for REV_SUP / BB_LOWER

# ═══ SIZING STOP — wide. Used ONLY to compute quantity. Never to exit.
atr_eff = max(atr_14, 1.3 * datr_14)          # ⭐ leverage effect
sizing_stop = round_to_tick(min(
    entry - P.atr_mult * atr_eff,
    entry * (1 - P.max_stop_pct * 1.25),
), exchange)
```

**Why two stops.** From the fill on T+1 to the first possible sell on T+4 there are three locked sessions. On HOSE with a ±7% band, the theoretical worst case is `1 - 0.93³ = -19.5%`. Sizing on a 6% exit stop would buy roughly **1.7× more shares** than the real tail risk justifies. Three consecutive limit-down sessions has happened repeatedly on this market.

## 12.3. Targets

```python
R = entry - exit_stop                        # 1R uses the EXIT stop
target_1 = round_to_tick(entry + 2.0 * R)    # sell 50%
target_2 = round_to_tick(entry + 3.5 * R)    # remainder, or trail
risk_reward = (target_1 - entry) / R         # = 2.0 by construction
```

Reject if:
- `R <= 0` — invalid price structure
- `R / atr_14 < 0.8` — the stop sits inside the daily noise band and will be swept
- `target_1 > resistance_60 * 1.02 and resistance_60 < entry * 1.15` — blocked by nearby resistance

## 12.4. Trailing stop

Activate only after the earliest exit date **and** `C >= target_1`.

```python
trailing_stop = max(exit_stop, highest_high_since_entry - 3.0 * atr_22)
# Ratchets up only. Never lowers.
```

## 12.5. Position sizing

```python
# 1 — risk budget
risk_budget = nav * P.risk_per_trade * regime_factor * seasonal_factor
#   risk_per_trade  : 0.004–0.007 of NAV  [D]
#   regime_factor   : 1.00 / 0.85 / 0.65 / 0.40 / 0.00
#   seasonal_factor : 1.10 if tet_window else 1.00

# 2 — raw quantity, using the SIZING stop
risk_per_share = entry - sizing_stop
qty_raw = risk_budget / risk_per_share

# 3 — Tier-3 tightening: only ever TIGHTEN, never loosen
weight_adj = 1.0
if beta > 1.2:                weight_adj *= 1.2 / beta
if max_floor_streak >= 3:     weight_adj *= 0.60
if free_float_pct < 0.20:     weight_adj *= 0.50

# 4 — four caps, take the minimum
qty_weight    = (nav * P.max_weight_pct * weight_adj) / entry
qty_liquidity = (adv_20_bn * 1e9 * 0.03) / entry      # max 3% of ADV
qty_cash      = available_cash / entry
qty_group     = remaining_owner_group_budget / entry

qty = min(qty_raw, qty_weight, qty_liquidity, qty_cash, qty_group)

# 5 — round DOWN to a 100-share lot
qty = int(max(qty, 0) // 100) * 100

# 6 — minimum viable position
if qty * entry < 10_000_000:
    reject("position too small; costs would consume the edge")
```

## 12.6. Worked example — `test_sizing_worked_example` must reproduce this exactly

```
INPUTS
  nav = 1_000_000_000        symbol = VNM (HOSE, cluster C5)
  regime = UPTREND → regime_factor = 0.85      risk_per_trade = 0.006
  setup = PB_MA20 → premium = 0.005            close_T = 61_200
  atr_14 = 1_150             datr_14 = 1_320   structure_low = 58_500
  beta = 0.72                max_floor_streak = 1     free_float = 0.45
  adv_20_bn = 180
  P: max_stop_pct = 0.07, atr_mult = 2.5, max_weight_pct = 0.15

ENTRY
  lo_raw = 61_200 * 1.005 = 61_506
  entry  = round_to_tick(61_506, HOSE) = 61_500          # tick 100, round down

STOPS
  atr_eff     = max(1_150, 1.3 * 1_320) = 1_716
  exit_stop   = min(58_500 - 575, 61_500 * 0.93)
              = min(57_925, 57_195) = 57_195 → 57_100
  sizing_stop = min(61_500 - 2.5 * 1_716, 61_500 * (1 - 0.0875))
              = min(57_210, 56_119) = 56_119 → 56_100

TARGETS
  R        = 61_500 - 57_100 = 4_400
  target_1 = 61_500 + 8_800  = 70_300
  target_2 = 61_500 + 15_400 = 76_900
  R / atr  = 4_400 / 1_150 = 3.83  >= 0.8   ✓

SIZE
  risk_budget    = 1e9 * 0.006 * 0.85 * 1.0 = 5_100_000
  risk_per_share = 61_500 - 56_100 = 5_400
  qty_raw        = 944.4
  weight_adj     = 1.0            (beta<1.2 · streak<3 · float>0.20)
  qty_weight     = (1e9 * 0.15) / 61_500 = 2_439
  qty_liquidity  = (180e9 * 0.03) / 61_500 = 87_804
  qty            = min(944.4, 2_439, 87_804) = 944 → 900 shares

RESULT
  notional             = 55_350_000  = 5.54% NAV        ✓ under 15%
  risk @ exit_stop     =  3_960_000  = 0.40% NAV
  risk @ sizing_stop   =  4_860_000  = 0.49% NAV
  tail risk, 3 floors  = 55_350_000 * (1 - 0.93³) = 10_793_250 = 1.08% NAV
```

---

# 13. SCORING AND PROBABILITY

## 13.1. Technical score (0–100)

```
score = 25·setup_quality + 20·volume_confirmation + 20·relative_strength_dual
      + 15·trend_context + 10·sector_strength + 10·flow_confirmation
      - risk_penalty
```

Each component normalised to `[0, 1]`.

```python
# 1. setup_quality (25)
tightness      = 1 - clip((max(H,20)-min(L,20)) / ma_20 / 0.15, 0, 1)
candle_quality = clip((C - L) / max(H - L, eps), 0, 1)
setup_quality  = 0.5*tightness + 0.3*candle_quality + 0.2*min(n_extra/2, 1)

# 2. volume_confirmation (20)  ⚠️ SIGN FLIPS BY LOGIC — easy to get wrong
if P.logic == MEAN_REVERSION:
    volume_confirmation = clip(2 - vol_ratio_3, 0, 1)   # want volume to FALL
else:
    volume_confirmation = clip((vol_ratio - 1) / 1.5, 0, 1)  # want it to RISE

# 3. relative_strength_dual (20)  ⭐ THE CORE
long_strength = rs_126_rank / 100                        # always want HIGH
short_state   = (rs_20_rank / 100) if P.logic == MOMENTUM \
                else (1 - rs_20_rank / 100)              # C3 high, others low
relative_strength_dual = 0.6*long_strength + 0.4*short_state

# 4. trend_context (15)
trend_context = (0.35*(1 if ma_20 > ma_50 > ma_200 else 0)
               + 0.30*clip(ma_slope_50 / 0.05, 0, 1)
               + 0.20*clip((C/ma_200 - 1) / 0.20, 0, 1)
               + 0.15*clip(adx_14 / 35, 0, 1))

# 5. sector_strength (10)
sector_strength = sector_rs_rank / 100

# 6. flow_confirmation (10)
if fnet_sens is None or fnet_sens < 0.20:
    flow_confirmation = 0.5                              # neutral if insensitive
else:
    flow_confirmation = (0.5*clip(fnet_5 / (adv_20_bn*1e9 * 0.05), 0, 1)
                       + 0.3*clip((oi_ma_10 + 1) / 2, 0, 1)
                       + 0.2*(1 if fnet_20 > 0 else 0))

# RISK PENALTY (subtracted)
risk_penalty = (12*(anomaly_score / 100)
              +  8*clip((gap_p90 - 0.015) / 0.03, 0, 1)
              +  6*(1 if max_floor_streak >= 3 else 0)
              +  6*clip((dist_ma_20 - 0.04) / 0.04, 0, 1)
              +  5*(1 if resistance_within_pct(0.05) else 0))

score = clip(base - risk_penalty, 0, 100)

# SEASONAL ADJUSTMENT, applied last
if tet_window: score *= 1.05
if post_tet:   score *= 1.00     # ⚠️ NO bonus — no reliable post-Tet effect
if month == 1: score *= 1.03
```

## 13.2. Win probability

**Phase 1 — no model yet (months 1–6).** Use the empirical hit rate per `(setup, cluster)` from the backtest.

```python
p = hit_rate.get((setup, cluster))
if sample_size < 30:
    p = None            # skip the probability gate entirely
```

**Phase 2 — trained meta-model.**

```
LABELLING  triple barrier
    upper = entry + 2.0·R  ·  lower = exit_stop  ·  time = P.hold_max
    label = whichever barrier is hit first
    ⚠️ MUST simulate entry at T+1, never close[T]
    ⚠️ MUST enforce the three locked sessions when testing the lower barrier

FEATURES   all of §8 + one-hot cluster + one-hot regime  (~35)
MODEL      LightGBM · max_depth=4 · n_estimators=200 · learning_rate=0.05
           (deliberately simple — this is overfitting defence, not modesty)
VALIDATION purged K-fold, 10-session embargo
CALIBRATION isotonic regression, so p is a real probability not a score
GATE       p >= 0.55
```

## 13.3. Ranking and selection

```python
composite = 0.6*(technical_score/100) + 0.4*(win_probability or 0.55)
# sort descending, then apply diversity caps:
#   max 2 per cluster, max 2 per sector, per day
# take top N where N = min(3, max_positions - len(holdings))
```

More than three signals per day is a symptom of thresholds that are too loose, not a good day.

---

# 14. TIMING AND ORDER LIFECYCLE

## 14.1. The timeline

```
 Session  Time      Event                                        Can sell?
──────────────────────────────────────────────────────────────────────────
   T      15:15     Local job: download, compute, score               —
   T      15:45     Signals generated → publish → Telegram            —
   T      evening   YOU review / approve / skip  (5–10 min)           —
──────────────────────────────────────────────────────────────────────────
  T+1     08:45     Local job: gap reminder + overnight disclosures   —
  T+1     09:00     ⭐ YOU PLACE THE ORDER — the real entry moment    ✗
  T+1     09:15     Opening auction ends; fill known                  ✗
──────────────────────────────────────────────────────────────────────────
  T+2     all day   Holding. Nothing can be done.                     ✗
  T+3     13:00     Shares settle (by 13:00 at the latest)         ⚠️ pm only
  T+3     15:45     Exit signal generated, if any                     —
──────────────────────────────────────────────────────────────────────────
  T+4     09:00     Place sell order → fills                          ✓
──────────────────────────────────────────────────────────────────────────

MINIMUM ROUND TRIP: 4 SESSIONS.   THREE SESSIONS FULLY LOCKED.
```

```python
def earliest_exit_index(entry_idx: int) -> int:
    """entry_idx = index of the session where the BUY filled (T+1).
    Settles T+3 = entry_idx+2; exit signal at T+3 close; sell T+4 = entry_idx+3.
    """
    return entry_idx + 3
```

## 14.2. Use LO, not ATO `[S]`

Since the KRX trading system went live on 2025-05-05, **ATO/ATC orders no longer receive matching priority over limit orders** as they did under the previous mechanism. An ATO order means accepting whatever price the market opens at — precisely what you must avoid when there is a gap.

Always LO. Placing at 09:05, once the indicative matching price is visible, is better informed than 09:00.

## 14.3. The gap gate — the eighth gate ⭐

Runs the next morning and can cancel an already-approved order. It is the highest-value rule an EOD system can have, and no Vietnamese platform provides it.

```python
def gap_gate(signal, ref_or_open_price: float) -> tuple[str, float]:
    """Returns (action, qty_multiplier)."""
    gap = ref_or_open_price / signal.close_T - 1.0
    # per-symbol threshold: the tighter of cluster default and own history
    max_gap = min(signal.params.max_gap_pct, signal.profile.gap_p90)

    if gap > max_gap:
        return "CANCEL", 0.0          # R:R destroyed; the stop hasn't moved
    if gap > max_gap * 0.5:
        return "REDUCE", 0.70
    if gap < -0.020:
        return "REVIEW", 1.0          # check overnight disclosures first
    return "PROCEED", 1.0
```

| Gap vs `close_T` | Action |
|---|---|
| ≤ +1.0% | ✅ Place as specified |
| +1.0% → threshold | ⚠️ Place at **70% quantity** |
| > threshold (1.5–3.0% by cluster) | ❌ **CANCEL** |
| < −2.0% | 🔍 **REVIEW** — bad news overnight? |
| Opens at ceiling and stays | ❌ **CANCEL** — no sellers |

## 14.4. Why the gap gate matters more than it sounds

EOD-only execution does not damage all setups equally. It damages **exactly the ones that look most attractive**:

| Setup type | Overnight behaviour | Impact on edge |
|---|---|---|
| Strong breakout, volume surge | Everyone sees it at once → **gaps up** | 🔴 Severe. You buy 2–5% higher while the stop stays put |
| Gap-and-go | Intraday by nature | 🔴 Unusable |
| Ceiling with no sellers | Opens locked at the ceiling | 🔴 Cannot fill |
| Pullback to MA20/MA50 | Buying weakness; the gap may **favour** you | 🟢 Minimal, sometimes positive |
| Reversal at support | Buying pessimism | 🟢 Good fit |
| Slow trend following | A session early or late barely matters | 🟢 Excellent fit |

This is why §11 ranks pullback above breakout, and why `GAP_GO` is deleted rather than deprioritised.

## 14.5. Risk parameter adjustments for EOD + T+2 `[D]`

| Parameter | Naive | **EOD + T+2** | Reason |
|---|:---:|:---:|---|
| Default stop | 7% | **9–10%** | Must survive three sessions of noise |
| ATR multiplier | 2.0–3.0 | **3.0–4.0** | Same |
| Risk per trade | 0.5–1.0% NAV | **0.4–0.7% NAV** | Compensates the locked-session tail |
| Target hold | 3–15 sessions | **8–25 sessions** | Minimum round trip is 4 sessions |
| Minimum R:R | 1.5 | **2.0** | A wider stop needs a farther target |
| Concurrent positions | 8–15 | **6–10** | Fewer names, watched more closely |
| Max weight per symbol | 15% | **10–12%** | Concentration risk while locked |

---

# 15. EXIT RULES

Often neglected; drives most of the realised result. Runs at 15:45 for every open position.

## 15.1. Seven exit conditions, in priority order

```
If the position has NOT passed earliest_exit_date, log only — no action possible.

P1  ANOMALY SPIKE
    anomaly_score >= 75  OR  (anomaly_score - score_at_entry) >= 25
    → EXIT ALL as soon as legally possible. Do not wait for the stop.

P2  EXIT STOP BREACHED
    C <= exit_stop  →  EXIT ALL next morning

P3  REGIME TURNED DOWNTREND
    → EXIT ALL positions; prioritise C3 and C6 first

P4  TARGET_1 REACHED
    C >= target_1 and nothing sold yet
    → SELL 50%; move the remainder to the trailing stop

P5  TRAILING STOP BREACHED  (only after target_1 was taken)
    C <= trailing_stop  →  EXIT REMAINDER

P6  TIME STOP
    sessions_held >= P.hold_max AND unrealised < 0.5R
    → EXIT ALL. Capital is being held hostage.

P7  SETUP THESIS BROKEN
    pullback : C < ma_50 * 0.97 for 3 consecutive sessions
    trend    : ma_20 crosses below ma_50
    C3       : regime leaves STRONG_UPTREND
    → EXIT ALL
```

## 15.2. Locked-breach handling

```
If a position breaches exit_stop but has NOT passed earliest_exit_date:

  → Log "LOCKED_BREACH" with the current unrealised loss
  → Telegram: "VNM breached its stop at -7.2% but cannot be sold before
               2026-09-10. Current loss 0.41% NAV."
  → ❌ BLOCK all new buy signals until resolved
  → ❌ NEVER average down. Hard rule, not a guideline.
  → Queue the sell order for the first possible session
```

This is exactly why §12.5 sizes on the wide `sizing_stop`: so that when this happens, the loss is still inside budget.

---

# 16. STREAMLIT UI (DUAL MODE)

## 16.1. The data-access facade

```python
# vnqd/io/base.py
from typing import Protocol
import pandas as pd

class DataAccess(Protocol):
    def features_latest(self) -> pd.DataFrame: ...
    def ohlcv(self, symbol: str, sessions: int = 400) -> pd.DataFrame: ...
    def index_recent(self) -> pd.DataFrame: ...
    def signals_latest(self) -> dict: ...
    def exits_latest(self) -> dict: ...
    def rejections_latest(self) -> pd.DataFrame: ...
    def profiles(self) -> pd.DataFrame: ...
    def clusters(self) -> pd.DataFrame: ...
    def run_meta(self) -> dict: ...
    def journal(self) -> pd.DataFrame: ...
    @property
    def can_write(self) -> bool: ...
```

```python
# vnqd/io/__init__.py
import streamlit as st
from vnqd.mode import IS_LOCAL

@st.cache_resource
def get_store() -> "DataAccess":
    if IS_LOCAL:
        from vnqd.io.local_store import LocalStore
        return LocalStore()          # DuckDB read-only + SQLite journal rw
    from vnqd.io.cloud_store import CloudStore
    return CloudStore()              # raw.githubusercontent Parquet, read-only
```

```python
# vnqd/io/cloud_store.py — the cloud caching pattern
DATA_BASE = "https://raw.githubusercontent.com/{owner}/{repo}/data"

@st.cache_data(ttl=1800, show_spinner="Loading market data…")
def _parquet(name: str) -> pd.DataFrame:
    return pd.read_parquet(f"{DATA_BASE}/{name}")

@st.cache_data(ttl=1800)
def _json(name: str) -> dict:
    return requests.get(f"{DATA_BASE}/{name}", timeout=20).json()
```

## 16.2. Global UI rules

- Use `pandas` in the view plane, never `polars` (smaller memory, already a cloud dependency).
- Every page renders in **under 10 seconds**.
- Cloud mode must never load `archive/` or any full-history file.
- Show a **staleness banner** on every page when `run_meta.trading_date` is not the latest expected trading day.
- Show the compliance footer (§16.9) on every page.
- In cloud mode, hide `9_Backtest.py` and every write control.

## 16.3. `streamlit_app.py` — Home / Today

```
┌─ MODE BADGE ─────────────────────────────────────────────────┐
│  🖥 LOCAL (read-write)     or     ☁ CLOUD (read-only)        │
└──────────────────────────────────────────────────────────────┘

┌─ STALENESS BANNER (only when data is old) ───────────────────┐
│ ⚠️ Data as of 2026-09-02, expected 2026-09-04. The pipeline  │
│    may have failed. Check logs\vnqd.log on the local machine.│
└──────────────────────────────────────────────────────────────┘

Header:  Data date · Place orders on · Pipeline status · Profiles as-of

Metric row:
  VN-Index (Δ%) | VN100_EW (Δ%) | REGIME badge |
  % above MA50  | Foreign net 5d | Turnover vs MA20

⚠️ DIVERGENCE ALERT (whenever the two indices disagree):
  "VN-Index is above its MA50 but VN100_EW is below. Regime downgraded
   to the more conservative reading. The index is being carried by a
   few large caps."

TODAY'S ORDER TICKETS      (0–3 cards, §16.4)
EXIT ALERTS                (if any)
LOCKED-BREACH WARNINGS     (if any — render in red, top priority)

[LOCAL MODE ONLY]  [ ▶ Run pipeline now ]  [ 📊 Refresh backtest ]
```

If `regime == DOWNTREND`, replace the ticket section with:

```
🛑 NO SIGNALS TODAY — MARKET REGIME IS DOWNTREND

Herding behaviour on this market is documented to be stronger in
falling markets than in rising ones. Buying dips into a downtrend is
how accounts get destroyed. The correct position is cash.
```

## 16.4. Order ticket card

```
═══════════════════════════════════════════════════════════════
  TICKET 1/2  ·  generated 2026-09-04 15:47  ·  PLACE 2026-09-07
═══════════════════════════════════════════════════════════════
  VNM · Vinamilk · Food & Beverage · Cluster C5 (defensive)
  Setup: PB_MA20 (+REV_SUP)      Score 79/100      p = 0.58
───────────────────────────────────────────────────────────────
  Close 2026-09-04 : 61,200
  PLACE ORDER      : LO  BUY  61,500  ×  900 shares
  Notional         : 55,350,000 VND  ·  5.5% NAV
───────────────────────────────────────────────────────────────
  Sell alert       : 57,100   (−7.2%)   ← reminder, NOT a stop order
  Take profit 1    : 70,300   (+14.3%)  ← sell 50%
  Take profit 2    : 76,900   (+25.0%)
  R:R              : 2.0 / 3.5
───────────────────────────────────────────────────────────────
  Risk if stop hit          :  0.40% NAV
  Risk if locked to 56,100  :  0.49% NAV
  ⚠ Tail risk, 3 limit-downs:  1.08% NAV
───────────────────────────────────────────────────────────────
  ⏱  Buy 09-07 → earliest sell 09-10.   3 SESSIONS LOCKED.
  🟢 Anomaly risk: 12/100
───────────────────────────────────────────────────────────────
  WHY THIS STOCK
    6-month RS : rank 74/100  ✓ medium-term strength
    1-month RS : rank 28/100  ✓ short-term oversold
    → DUAL CONDITION MET: a strong stock, temporarily oversold
    Volume 5d  : 0.82× MA20   ✓ healthy dip, not distribution
    Foreign    : net buy 5d +12.4bn VND  ✓
    Trend      : MA20>MA50>MA200, price 8.3% above MA200  ✓
───────────────────────────────────────────────────────────────
  SETUP HISTORY (PB_MA20 × C5, n=184)
    Fill rate 86%  ·  Mean overnight gap +0.3%
    OOS hit rate 57%  ·  Expectancy +0.38R
    Max consecutive losses 6  ·  Mean hold 14 sessions
───────────────────────────────────────────────────────────────
  ⚠️ CHECK THE GAP ON 09-07 BEFORE PLACING
     gap ≤ +1.0%     → place 900 shares as specified
     +1.0% → +1.5%   → reduce to 600 shares
     gap > +1.5%     → ❌ CANCEL  (VNM-specific threshold)
     gap < −2.0%     → 🔍 check overnight disclosures first
═══════════════════════════════════════════════════════════════
  [ Placed ]  [ Not filled ]  [ Reduced qty ]  [ Skipped ]
      ↑ LOCAL MODE: writes to journal.sqlite
        CLOUD MODE: shows "Record this on the local instance"
═══════════════════════════════════════════════════════════════
```

The **`Not filled`** button matters: it teaches the system the real fill rate per setup instead of relying on a theoretical assumption.

## 16.5. Pages 1–7

**`1_Market.py`** — dual index chart (VN-Index and VN100_EW normalised to 100, with MA50/MA200); regime timeline as a coloured band over 3 years; breadth panel; foreign flow daily and 20-day cumulative; sector heatmap (1w/1m/3m); sector rotation scatter of `rs_126` vs `rs_20` with quadrant labels.

**`2_Signals.py`** — today's tickets in full; ⭐ **rejection explorer** (a filterable table from `rejections_latest.json` — the most useful debugging page in the app, because it shows *why* nothing was recommended); gate funnel chart showing survivors at each of the seven gates; signal history with outcomes once the journal has data.

**`3_Portfolio.py`** — open positions with days held, days until sellable, distance to `exit_stop`, distance to `target_1`; sector, cluster and owner-group exposure bars against their caps; total open risk versus the 5% cap; locked-breach alerts.

**`4_Screener.py`** — interactive filters on `features_latest.parquet`: cluster, sector, `rs_126_rank`, `rs_20_rank`, `rsi_14`, `dist_ma_20`, `vol_ratio`, `adv_20_bn`, `anomaly_score`, `gap_p90`, `atr_pct`, `beta`. Include a one-click preset **"Dual condition"** → `rs_126_rank >= 60 AND rs_20_rank <= 40`. That is the screen that matters most.

**`5_Stock_Detail.py`** — candlestick with MA20/50/200 and Bollinger; volume with MA20; RSI; dual-RS panel over time; full profile table (all 14 metrics with cluster percentile context); anomaly rule hits with evidence; overnight-gap histogram.

**`6_Risk_Radar.py`** — symbols ranked by `anomaly_score` with rule hits and evidence; explicit disclaimer that these are statistical anomaly flags, not conclusions about unlawful conduct.

**`7_Clusters.py`** — membership tables with assignment reasons; ⭐ **variance-ratio histogram across VN100** (the single most informative chart in the app — it shows at a glance how much of the market trends versus mean-reverts); cluster stability across quarters; the per-cluster parameter table.

## 16.6. `8_Journal.py`

```
LOCAL MODE   full read-write against journal.sqlite
             record fills, skips, notes; edit positions; update NAV
CLOUD MODE   read-only view of journal_summary.parquet
             outcomes shown in R multiples, no VND amounts
             banner: "Record fills on the local instance."
```

Analytics in both modes: system-versus-actual behaviour gap, realised hit rate, average hold, fill rate by setup, and detection of averaging-down or premature profit-taking.

## 16.7. `9_Backtest.py` — local mode only

Configure and launch backtests; view equity curves; walk-forward results; DSR and PBO; per-cluster metrics; ⭐ the placebo-test result. **Hide this page entirely in cloud mode** — the compute would exceed the memory limit.

## 16.8. Local-mode pipeline trigger

```python
if store.can_write and st.button("▶ Run pipeline now"):
    with st.status("Running EOD pipeline…", expanded=True) as status:
        proc = subprocess.Popen(
            [sys.executable, "-m", "jobs.run_eod"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8",          # ⭐ §3.1
            cwd=str(PROJECT_ROOT),
        )
        for line in proc.stdout:
            st.write(line.rstrip())
        status.update(
            label="Done" if proc.wait() == 0 else "Failed",
            state="complete" if proc.returncode == 0 else "error",
        )
    st.cache_data.clear()
    st.rerun()
```

## 16.9. Mandatory compliance footer — every page

```
This tool produces statistical signals for personal research only. It is
not investment advice and not a recommendation to buy or sell any security.
All parameters are uncalibrated defaults unless stated otherwise. Past
performance does not indicate future results.

Publishing or selling these outputs as buy/sell recommendations to others
may constitute unlicensed securities business activity, prohibited under
Article 12(4) of Vietnam's Securities Law, and may breach the data
providers' terms of service.

⚠️ Under T+2 settlement with EOD-only execution, three sessions exist
during which a position cannot be exited. Worst-case exposure on HOSE is
approximately −19.5%.
```

---

# 17. SCHEDULING ON WINDOWS 11

## 17.1. Batch entry point

```bat
@echo off
REM scripts\run_eod.bat
setlocal

REM ⭐ UTF-8 before anything else — see §3.1
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
chcp 65001 > nul

cd /d C:\vnqd
call .venv\Scripts\activate.bat

python -m jobs.run_eod >> logs\eod_%date:~-4%%date:~3,2%%date:~0,2%.log 2>&1
set RC=%ERRORLEVEL%

if %RC% NEQ 0 (
    python -m jobs.notify_failure --job eod --code %RC%
)

endlocal
exit /b %RC%
```

## 17.2. Register the tasks

```powershell
# scripts\register_tasks.ps1  — run once, as Administrator
$root = "C:\vnqd\scripts"

function New-VnqdTask {
    param($Name, $Script, $Trigger)
    $action  = New-ScheduledTaskAction -Execute "$root\$Script"
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `                    # ⭐ run if the start was missed
        -WakeToRun `                             # ⭐ wake the PC from sleep
        -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName $Name -Action $action `
        -Trigger $Trigger -Settings $settings -Force `
        -Description "VNQD $Name" -RunLevel Limited
}

# 15:15 local time (ICT) — market closes 14:45/15:00, CafeF publishes after
New-VnqdTask "VNQD-EOD" "run_eod.bat" `
    (New-ScheduledTaskTrigger -Weekly `
        -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 15:15)

New-VnqdTask "VNQD-Premarket" "run_premarket.bat" `
    (New-ScheduledTaskTrigger -Weekly `
        -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 08:45)

New-VnqdTask "VNQD-Weekly" "run_weekly.bat" `
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At 09:00)

New-VnqdTask "VNQD-Quarterly" "run_quarterly.bat" `
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 10:00)
    # the job itself no-ops unless the quarter has changed
```

> **Timezone advantage over cloud CI:** Task Scheduler uses **local time**. If the machine is set to Indochina Time, 15:15 means 15:15 — no UTC arithmetic, no daylight-saving edge cases, no cron delay of 5–30 minutes.

## 17.3. Retry the CafeF download politely

CafeF may publish slightly after 15:15. Rather than scheduling four tasks, retry inside the job:

```python
# jobs/run_eod.py
for attempt, wait_min in enumerate([0, 10, 20, 30], start=1):
    if wait_min:
        logger.info("Data not ready; waiting %d minutes (attempt %d)", wait_min, attempt)
        time.sleep(wait_min * 60)
    try:
        payload = collector.download_today()
        break
    except DataNotYetPublished:
        continue
else:
    notify("CafeF data still unavailable after 4 attempts. Will retry tomorrow.")
    sys.exit(2)
```

## 17.4. Missed-run recovery ⭐ removes the "PC must be on" objection

```python
# Every run starts here.
def catch_up() -> None:
    """Compare stored history against the trading calendar; backfill gaps."""
    last_stored = store.max_date("ohlcv_adj")
    expected    = calendar.last_trading_day(today())
    missing     = calendar.sessions_between(last_stored, expected)

    if not missing:
        return

    logger.warning("Missing %d sessions: %s … %s",
                   len(missing), missing[0], missing[-1])

    if len(missing) <= 2:
        for d in missing:                  # dated daily files still exist
            ingest_daily(d)
    else:
        logger.info("Gap too large — rebuilding from the Upto file")
        ingest_from_upto(expected)         # ⭐ §7.4 Trap 1
```

Consequence: leaving the PC off for a week costs nothing. The next run detects the gap and rebuilds from the `Upto` file automatically.

## 17.5. Publishing to GitHub (Tier 1 only)

```python
# vnqd/io/publish.py
def publish(publish_dir: Path, trading_date: date) -> None:
    """Commit and push data/publish/ to the `data` branch.
    Uses a git worktree so the working tree is never disturbed.
    """
    run(["git", "add", "-A", str(publish_dir)])
    if run(["git", "diff", "--staged", "--quiet"]).returncode != 0:
        run(["git", "commit", "-m", f"EOD {trading_date:%Y-%m-%d}"])
        run(["git", "push", "origin", "data"])
```

Streamlit Cloud must track the **`main`** branch, not `data`. Otherwise every data push triggers a redeploy and the app restarts daily.

## 17.6. Monitoring

```
Telegram on success: one-line summary
    "EOD 2026-09-04 OK · regime UPTREND · 2 tickets · 0 exits · 187s"

Telegram on failure: job name, exit code, log path, first traceback line

Weekly health message:
    runs completed / expected · QC failures · cluster stability ·
    fill rate versus backtest · consecutive losses
```

---

# 18. PARAMETER REGISTRY

> **Every numeric constant lives in `vnqd/constants.py`. Nowhere else.**
> `test_no_magic_numbers` must fail if a numeric literal appears in `signals/`, `indicators/`, or `pages/`.

| Tag | Parameter | Value |
|:---:|---|---|
| `[S]` | Price bands HOSE / HNX / UPCOM | 7% / 10% / 15% |
| `[S]` | HOSE tick sizes | 10 / 50 / 100 VND |
| `[S]` | Lot size | 100 shares |
| `[S]` | Settlement | T+2, shares by 13:00 |
| `[S]` | `earliest_exit_index` | `entry_idx + 3` |
| `[S]` | Tail risk, 3 limit-downs | `1-(1-band)³` = 19.5% on HOSE |
| `[S]` | Prefer LO over ATO | KRX since 2025-05-05 removed ATO/ATC priority |
| `[S]` | Brokerage / exchange fee / sell tax | 0.15% / 0.027% / 0.1% |
| `[S]` | Margin rate (backtest) | 13.5% p.a. |
| `[A]` | `rs_126` window | 126 sessions (6 months) |
| `[A]` | `rs_20` window | 20 sessions (1 month) |
| `[A]` | `mom_252_21` skip | 21 sessions |
| `[A]` | Max hold, mean reversion | ≤ 60 sessions (reversal fades by month 3) |
| `[A]` | Momentum logic | cluster C3 only |
| `[A]` | Abort on `DOWNTREND` | yes |
| `[A]` | `datr` substitution trigger | `atr_asym > 1.3` |
| `[A]` | `tet_window` multiplier | 1.05 |
| `[A]` | `post_tet` multiplier | **1.00 — no bonus** |
| `[M]` | `beta`, `atr_asym`, `gap_p90`, `max_floor_streak`, `adv_20_bn`, `free_float_pct`, `variance_ratio_5`, `hurst` | computed |
| `[D]` | `rs_126_rank` minimum | **60** |
| `[D]` | `rs_20_rank` max (mean-rev) | **40** |
| `[D]` | `rs_20_rank` min (momentum) | **65** |
| `[D]` | `technical_score` minimum | **60** |
| `[D]` | `win_probability` minimum | **0.55** |
| `[D]` | `risk_reward` minimum | **2.0** |
| `[D]` | `R / atr_14` minimum | **0.8** |
| `[D]` | `risk_per_trade` | **0.004 – 0.007 NAV** |
| `[D]` | Total open risk cap | **5% NAV** |
| `[D]` | Max positions | **10** |
| `[D]` | Max signals per day | **3** |
| `[D]` | Sector weight cap | **35%** |
| `[D]` | Owner-group caps | **Vingroup 15% · Masan 12% · TCB 12% · Gelex 10%** |
| `[D]` | Max in C2 / C6 | **2 / 1** |
| `[D]` | Minimum ADV | **20bn VND** |
| `[D]` | Max % of ADV per order | **3%** |
| `[D]` | Minimum notional | **10m VND** |
| `[D]` | `target_1` / `target_2` | **2.0R / 3.5R** |
| `[D]` | Trailing multiplier | **3.0 × atr_22** |
| `[D]` | Setup premiums | **0.3% – 1.0%** |
| `[D]` | Regime breadth thresholds | **0.60 / 0.45 / 0.35 / 0.25** |
| `[D]` | `regime_factor` | **1.00 / 0.85 / 0.65 / 0.40 / 0.00** |
| `[D]` | Score weights | **25 / 20 / 20 / 15 / 10 / 10** |
| `[D]` | Backtest slippage | **15 bps** |
| `[D]` | QC row-count floor | **90% of previous session** |
| `[D]` | Publish artifact window | **400 sessions** |

## 18.1. Cluster parameter table `[D]`

| Parameter | C1 mega | C2 bank | C3 high-beta | C4 commodity | C5 defensive | C6 volatile mid |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `logic` | mixed | mean-rev | **momentum** | trend | **mean-rev** | mean-rev |
| `ma_trend` | 50/200 | 50/200 | 20/50 | 50/200 | 100/200 | 50/200 |
| `ma_entry` | 20 | 20 | 10 | 20 | BB(20,2) | 20 |
| `rsi_period` | 14 | 14 | 9 | 14 | 21 | 14 |
| `rsi_buy_max` | 45 | 42 | — | 45 | **35** | 40 |
| `rsi_buy_min` | — | — | 55 | — | — | — |
| `atr_mult` | 3.0 | 3.0 | **4.0** | 3.5 | **2.5** | **4.0** |
| `max_stop_pct` | 9% | 9% | **12%** | 10% | **7%** | **12%** |
| `hold_min–max` | 15–30 | 10–25 | 8–20 | 20–40 | 10–20 | 8–15 |
| `max_weight_pct` | 12% | 10% | 8% | 10% | **15%** | **5%** |
| `max_gap_pct` | 2.0% | 2.0% | 3.0% | 2.5% | **1.5%** | 2.0% |
| `max_anomaly_score` | 55 | 55 | 50 | 55 | 60 | **40** |
| `min_volume_ratio` | 1.3 | 1.3 | 1.5 | 1.3 | 1.1 | 1.5 |
| `min_regime` | SIDEWAY | SIDEWAY | **STRONG** | SIDEWAY | MILD_CORR | **STRONG** |
| `reference_index` | VN100_EW | VNINDEX | VNINDEX | VN100_EW | VN100_EW | VN100_EW |
| `require_exogenous` | — | bank sector > MA50 | turnover > MA20 | **commodity > MA50** | — | — |

### Two counterintuitive entries, both correct

**C5 has the tightest stop and the largest weight.** Low volatility means a 7% stop still sits outside the noise band, so the same 0.6% NAV risk budget buys more shares. Defensives should be the **backbone** of an EOD portfolio, not a garnish. Most retail investors do the opposite.

**C6 has the widest stop and the smallest weight.** The arithmetic says: accept a very small position, or do not trade it.

## 18.2. Tier-3 per-symbol adjustments — tighten only

```python
def resolve_params(cluster, profile) -> ClusterParams:
    """Cluster defaults, then tighten using measured facts about the symbol.
    NEVER loosen. Symbol-specific information may only reduce risk.
    """
    if profile.atr_asymmetry > 1.3:
        atr_mult     *= 1.15
        max_stop_pct  = min(max_stop_pct * 1.15, 0.14)
    if profile.gap_p90 < max_gap_pct:
        max_gap_pct   = profile.gap_p90            # own history is tighter
    if profile.max_floor_streak >= 3:
        max_weight_pct *= 0.60
    if profile.beta > 1.2:
        max_weight_pct /= (profile.beta / 1.2)
    if profile.foreign_sensitivity and profile.foreign_sensitivity > 0.30:
        require_exogenous += " AND fnet_5 > 0"
```

---

# 19. TESTING REQUIREMENTS

## 19.1. Required tests

| Test | Asserts |
|---|---|
| `test_utf8_mode` | ⭐ Fails if `PYTHONUTF8` is not set; round-trips Vietnamese text through file IO |
| `test_paths_are_pathlib` | No string concatenation for paths; works on Windows and POSIX |
| `test_build_url` | Directory `YYYYMMDD`, filename `DDMMYYYY`, `Upto` inserted correctly |
| `test_parse_cafef` | Parses the real fixture (§7.3) into the exact schema |
| `test_indicators_golden` | Every indicator matches hand-computed values on a 30-row fixture |
| `test_variance_ratio` | VR ≈ 1.0 on a synthetic random walk; > 1 trending; < 1 oscillating |
| `test_datr` | `datr` uses only down sessions; `atr_asym` > 1 on an asymmetric fixture |
| `test_corp_action_derivation` | Recovers a known 2-for-1 stock dividend from a synthetic adj/raw pair |
| `test_round_to_tick` | HOSE 10/50/100 boundaries; always rounds **down** |
| `test_dual_stop` | `sizing_stop < exit_stop < entry`, always |
| `test_sizing_worked_example` | ⭐ Reproduces §12.6 exactly, including the 900-share result |
| `test_execution_not_close_T` | ⭐ **Fails if any code path sets entry = `close[T]`** |
| `test_earliest_exit` | `earliest_exit_index(i) == i + 3` |
| `test_gap_gate` | CANCEL / REDUCE / REVIEW / PROCEED at the right boundaries |
| `test_gate_order` | Gates evaluate in order; each rejection records the correct gate |
| `test_regime_divergence` | When indices disagree, the lower score wins |
| `test_downtrend_abort` | `DOWNTREND` yields exactly zero signals |
| `test_volume_sign_flip` | `volume_confirmation` inverts for mean-reversion versus trend |
| `test_no_magic_numbers` | ⭐ No numeric literal outside `constants.py` in `signals/`, `indicators/`, `pages/` |
| `test_import_discipline` | ⭐ No page imports `ingest`, `backtest`, or `jobs` |
| `test_mode_default_is_cloud` | ⭐ Missing `VNQD_MODE` resolves to CLOUD, never LOCAL |
| `test_publish_no_pii` | ⭐ No file in `publish/` contains a VND amount, NAV, or share quantity |
| `test_idempotent_eod` | Running the pipeline twice for one date yields identical artifacts |
| `test_catch_up` | A 1-session gap backfills daily; a 5-session gap rebuilds from `Upto` |
| `test_duckdb_lock_retry` | A locked database retries then notifies rather than crashing silently |

## 19.2. The four tests that matter most

**`test_execution_not_close_T`.** Using `close[T]` as the entry price is the number-one source of fake backtest results on this market. Make it structurally impossible: have the backtest engine accept only `(close_T, next_open, next_high, next_low)` and derive the fill internally, so no caller can pass a same-day close as an entry.

**`test_no_magic_numbers`.** Without it, thresholds multiply silently across the codebase and calibration becomes impossible.

**`test_publish_no_pii`.** Protects the privacy boundary in §6.5. Scan every published JSON and Parquet for keys like `qty`, `nav`, `notional`, `cash`, and for integers above 1,000,000.

**`test_mode_default_is_cloud`.** A cloud deployment that defaults to LOCAL would attempt to open a nonexistent DuckDB file and crash on startup.

## 19.3. Fill-simulation model

```python
def simulate_entry(close_T, next_open, next_high, next_low,
                   *, premium, max_gap, band) -> FillResult:
    gap = next_open / close_T - 1.0
    if gap > max_gap:
        return FillResult(False, None, gap, "gap exceeded threshold")
    ceiling = close_T * (1 + band)
    if next_low >= ceiling * 0.995:
        return FillResult(False, None, gap, "opened and held at ceiling")
    limit = close_T * (1 + premium)
    if next_low <= limit:
        return FillResult(True, min(limit, next_open), gap, "limit filled")
    return FillResult(False, None, gap, "limit not reached")
```

Report two metrics conventional backtests omit:

```
fill_rate          = filled / total_signals
mean_overnight_gap = mean(next_open / close_T - 1)

VERDICT
  fill_rate < 0.70           → strategy UNSUITABLE for EOD
  mean_overnight_gap > 1.5%  → strategy UNSUITABLE for EOD
  mean_overnight_gap > 0.8%  → CAUTION, tighten the limit premium
```

## 19.4. Calibration protocol — the five gates

```
Walk-forward: train 3 years → validate 1 year → test 1 year → roll 1 year

RULES
  • Calibrate POOLED across all symbols in a cluster
    → one parameter set per 15–25 symbols, never one per symbol
  • Cluster assignment may use data only up to the end of the training
    window (otherwise: look-ahead bias)
  • At most 4 [D] parameters per cluster per calibration
  • Purged K-fold + 10-session embargo when using triple-barrier labels
  • Simulate entry at T+1 and enforce the three locked sessions
```

| Gate | Check | Pass |
|:---:|---|---|
| 1 | Deflated Sharpe Ratio | > 0.7 |
| 2 | Probability of Backtest Overfitting | < 0.4 |
| 3 | Regime robustness: 2018, 2020, 2021, 2022, 2023–26 | Sharpe > 0 in ≥ 4/5 |
| 4 | EOD execution quality | fill rate ≥ 70% **and** mean gap ≤ 1.5% |
| 5 | ⭐ **Placebo test** — random cluster assignment | real clusters must beat random by ≥ 0.2 Sharpe |

Failing any gate ⇒ discard that parameter set and revert to the §18 defaults. No "adjust it a little to get through."

**Run gate 5 first.** If random clusters match real clusters, the entire clustering scheme is an illusion — use one shared parameter set instead. Simpler, more robust, more honest. One day of work, potentially two months saved.

---

# 20. ACCEPTANCE CRITERIA

## 20.1. Environment

- [ ] `PYTHONUTF8=1` set in every `.bat`; startup assertion present; Vietnamese text round-trips through file IO
- [ ] All paths via `pathlib.Path`; repo at `C:\vnqd`
- [ ] `.gitattributes` marks Parquet, DuckDB, SQLite and ZIP as binary
- [ ] Defender exclusions applied
- [ ] DuckDB opened read-only by the UI; write-lock retry implemented
- [ ] `.env` and `secrets.toml` gitignored and absent from history

## 20.2. Data plane

- [ ] `jobs.run_eod` completes in under 10 minutes
- [ ] Bootstrap loads full multi-year history for all three exchanges in ≤ 4 HTTP requests
- [ ] Corporate actions derived from the adj/raw ratio; **three known stock-dividend symbols manually verified**
- [ ] `run_quarterly` performs the **full adjusted-history rebuild** (Trap 2)
- [ ] Every QC check in §7.6 runs; the pipeline **refuses to emit signals** on failure
- [ ] `catch_up()` backfills small gaps daily and large gaps from `Upto`
- [ ] All artifacts in §6.4 written with correct schemas
- [ ] `test_publish_no_pii` passes

## 20.3. Signal plane

- [ ] Seven gates implemented, evaluated in order, with recorded rejection reasons
- [ ] Dual condition (`rs_126_rank >= 60` AND `rs_20_rank <= 40`) enforced at Gate 4a
- [ ] All eight setups implemented; `GAP_GO` absent from the codebase
- [ ] Dual-stop system implemented; `sizing_stop` used **only** for quantity
- [ ] `datr_14` used wherever §8.3 and §12.2 specify
- [ ] `DOWNTREND` produces zero signals
- [ ] Regime uses both indices and takes the conservative reading on divergence
- [ ] Maximum three signals per day
- [ ] Every threshold sourced from `constants.py`
- [ ] All seven exit rules implemented, including locked-breach handling

## 20.4. View plane

- [ ] Deploys on Streamlit Community Cloud free tier without errors
- [ ] Peak cloud-mode memory under 400 MB with every page visited
- [ ] Every page renders in under 10 seconds
- [ ] Zero network calls to CafeF from the app in either mode
- [ ] Zero indicator computation in the app in either mode
- [ ] Local mode reads DuckDB and writes the journal; cloud mode is fully read-only
- [ ] Mode badge visible; `9_Backtest.py` hidden in cloud mode
- [ ] Staleness banner and index-divergence alert both work
- [ ] Order tickets show every field in §16.4 including gap-check instructions
- [ ] Rejection explorer present and filterable by gate
- [ ] Variance-ratio histogram present on the Clusters page
- [ ] Compliance footer on every page

## 20.5. Quality

- [ ] `ruff check` and `mypy --strict` pass
- [ ] All §19.1 tests pass
- [ ] Backtest reports `fill_rate` and `mean_overnight_gap` for every strategy
- [ ] Cluster stability computed and recorded in `run_meta.json`

## 20.6. First-week validations the user must be able to run

- [ ] **A.** Plot a stock-dividend symbol over 5 years — confirm no false gaps at ex-dates
- [ ] **B.** ⭐ Run one simple rule (price crosses above MA20) twice: `entry = close[T]` versus `entry = open[T+1]`. Report both CAGRs side by side. **The difference is the phantom profit a naive backtest invents.**
- [ ] **C.** ⭐ **Placebo test** — assign symbols to random clusters, rerun, compare Sharpe. If random matches real within 0.2 Sharpe, the clustering is an illusion; fall back to a single shared parameter set. **Run this before building anything on top of clustering.**
- [ ] **D.** ⭐ Variance-ratio histogram across VN100. If ~90% show VR < 1, drop momentum logic entirely and build a purely mean-reverting system.
- [ ] **E.** Overnight-gap distribution across VN100. Expect only 40–60 symbols to be genuinely tradeable EOD. That is a valuable finding, not a failure.

---

# 21. DO NOT DO THIS

| ❌ | Why it breaks |
|---|---|
| Open a file without `encoding="utf-8"` on Windows | Silent corruption of Vietnamese text, or `UnicodeDecodeError` deep in the pipeline |
| Concatenate paths with `+` or use `"C:\vnqd\new"` | `TypeError`, or `\n`/`\d` interpreted as escapes |
| Install the repo under OneDrive or Documents | OneDrive corrupts DuckDB mid-write; deep paths hit the 260-char limit |
| Use the Microsoft Store build of Python | Filesystem sandboxing breaks writes to `C:\vnqd` |
| Leave DuckDB open in a notebook during the scheduled run | Write-lock failure; the job dies |
| Compute indicators inside Streamlit | 1 GB RAM; guaranteed OOM |
| Write to the filesystem in cloud mode | Ephemeral; the data vanishes on restart |
| Default `VNQD_MODE` to `local` | Cloud deployment crashes trying to open DuckDB |
| Publish quantities, NAV, or VND amounts | Leaks personal financial data into the repo |
| Add `TA-Lib` or create `packages.txt` | C build fails on Streamlit Cloud |
| Run APScheduler instead of Task Scheduler | The Streamlit app sleeps; the scheduler dies with it |
| Point Streamlit Cloud at the `data` branch | Every data push triggers a redeploy; the app restarts daily |
| Use `entry = close[T]` anywhere | Physically impossible; invents phantom profit |
| Append adjusted prices without a quarterly full rebuild | Silent drift as corporate actions rewrite history |
| Optimise indicator parameters per symbol | ~10⁸ trials on highly cross-correlated data; guaranteed overfit |
| Treat VIC, VHM, VRE, VPL as four independent positions | One investment split four ways |
| Use VN-Index alone as the regime filter | The index is dominated by its largest constituents |
| Implement `GAP_GO` or any intraday setup | Structurally impossible under EOD execution |
| Emit signals during `DOWNTREND` | Herding intensifies in falling markets |
| Size positions on the narrow exit stop | Understates the three-session locked risk by ~1.7× |
| Reward `post_tet` | The pre-holiday effect does not extend past the holiday |
| Use symmetric ATR for sizing | Negative shocks produce larger volatility on HOSE |
| Emit more than 3 signals/day | Thresholds are too loose |
| Average down on a locked breach | Hard prohibition |
| Hardcode a number outside `constants.py` | Makes calibration impossible |
| Redistribute or resell CafeF data | Breaches the provider's terms |
| Present output as investment advice to others | May constitute unlicensed securities business activity |
| Build the signal engine before the backtest engine | You would produce signals nobody can evaluate |

---

# 22. BUILD ORDER

Order matters. Do not reorder.

| Phase | Days | Deliverable | Validation |
|---|:---:|---|---|
| **P0 Windows foundation** | 1–3 | `C:\vnqd`, venv, UTF-8 assertion, `.gitattributes`, Defender exclusions, `constants.py`, `market_rules.py`, `mode.py`, polite HTTP client | `test_utf8_mode` and `test_paths_are_pathlib` pass |
| **P1 Ingestion** | 4–8 | CafeF downloader, **real column fixture**, parser, DuckDB schema, bootstrap | Parse one real file; full history loaded |
| **P2 Corporate actions + QC** | 9–12 | Derivation from adj/raw, QC gate, `catch_up()`, artifact writers | **Validation A** — no false gaps at ex-dates |
| **P3 Indicators** | 13–20 | All of §8 in pure NumPy, `VN100_EW`, breadth, CCNN order flow | Golden-value tests pass |
| **P4 Backtest engine** ⭐ | 21–35 | Backtest **first**: T+1 fill simulation, three-session lock, costs, walk-forward, DSR, PBO | **Validation B** — the phantom-profit number |
| **P5 Profiling + clustering** | 36–42 | 14 metrics, decision tree, stability report | **Validation C (placebo)** and **D (VR histogram)** — either may collapse the design |
| **P6 Anomaly** | 43–49 | 29 daily rules, IsolationForest, risk score, evidence panel | Back-test against publicly sanctioned symbols |
| **P7 Signal engine** | 50–70 | Regime, 8 setups, scoring, pricing, dual stops, sizing, 7 gates, exits | `test_sizing_worked_example` reproduces §12.6 |
| **P8 Local UI (Tier 0)** | 71–82 | All pages in local mode, journal SQLite, pipeline trigger | Fully usable at the desk with no cloud account |
| **P9 Scheduling** | 83–86 | `.bat` scripts, `register_tasks.ps1`, Telegram, monitoring | Runs unattended for one full week |
| **P10 Cloud view (Tier 1)** | 87–95 | `publish.py`, `data` branch, `CloudStore`, deploy to Streamlit Cloud | Memory < 400 MB, pages < 10 s, `test_publish_no_pii` |
| **P11 Meta-model** | 96+ | Triple-barrier labelling, LightGBM, isotonic calibration | Only once ≥ 200 historical signals exist |

## 22.1. Why the backtest comes before the signal engine

Every `[D]` parameter in §18 is a starting guess. Without a backtest, the signal engine produces confident-looking recommendations that nobody — including its author — can evaluate. That is precisely the failure mode of the retail tip-sharing culture this tool exists to replace.

## 22.2. Why Tier 0 comes before Tier 1

The local UI is fully functional and needs no GitHub account, no Streamlit account, and no publish step. Ship it, use it for two weeks, then add the cloud view once you know which pages you actually open on your phone.

## 22.3. Realistic expectations — state these in `README.md`

| Metric | Achievable | Suspicious | Certainly fake |
|---|:---:|:---:|:---:|
| Hit rate | 52–58% | 60–65% | > 70% |
| Expectancy | +0.25 to +0.45R | +0.6R | > +1.0R |
| Sharpe (net) | 0.8–1.4 | 1.8 | > 2.5 |
| Max drawdown | 15–25% | 10% | < 8% |
| Consecutive losses | 6–9 | — | "never 3 in a row" |

```
At 55% hit rate, +0.35R expectancy, 40 trades/year, 0.6% NAV risk per trade:
    expected alpha = 40 × 0.35 × 0.6% = +8.4% NAV per year
```

Modest — but it is alpha on a validated foundation rather than a number pulled from a chart. Research on VN30 constituents concluded the market shows no glaring inefficiencies overall, yet that for some stocks and especially for portfolios, a comparatively simple trend-following expert system delivers attractive risk-adjusted returns, with the caveat that only relatively small amounts can be traded.

That last caveat is why institutions cannot arbitrage these effects away — and why a personal account is exactly the right size to use them.

---

## APPENDIX — ACADEMIC BASIS

Findings tagged `[A]` in §18 derive from these sources. Most cover 2007–2020; **they may no longer hold** after the KRX system went live and after Vietnam's FTSE upgrade. Re-test on recent data.

| Topic | Source |
|---|---|
| Weak-form inefficiency, thin trading | Truong et al. (2010) |
| Short-term momentum (fades after risk control) | Nguyen (2012), *Procedia Economics and Finance* |
| Medium-term momentum, 6m formation / 9m holding | Vo & Truong (2018) |
| Short-term technical trading on VN30 | Nguyen, Şensoy et al. (2020), *Borsa İstanbul Review* |
| Overreaction on HOSE, T+2/T+3 loser reversal | *Overreaction in a Frontier Market: Evidence from HOSE*, MDPI JRFM (2023) |
| Short-term reversal on HNX | *Return Reversal in Portfolios Optimized under Exchange Rate Risk*, IJAA (2025) |
| Herding, asymmetric by market direction | Trang & Tho (2017) |
| Herding and COVID-19 | *Herd behavior in Vietnam's stock market*, Cogent Economics & Finance (2023) |
| January effect, seasonality | Luu et al. (2016); Thach et al. (2019); Zaremba (2015) |
| Tet effect, asymmetric volatility | Khanh et al. (2020); *The Lunar New Year Effect*, MDPI JRFM (2025) |
| Liquidity and returns | Batten & Vo (2014) |
| Foreign investors as positive-feedback traders | Vo (2017) |
| Overfitting defence: triple barrier, purged K-fold, DSR, PBO | López de Prado, *Advances in Financial Machine Learning* |

---

> ## ⚠️ DISCLAIMER — INCLUDE IN README.md
>
> This is a **specification for personal research software**. It is not investment advice and not legal advice.
>
> **Every parameter tagged `[D]` is an uncalibrated starting value.** Each must pass walk-forward validation, Deflated Sharpe, PBO, the EOD execution-quality gate, and the placebo test before being trusted with real money. Parameters tagged `[A]` rest on studies of specific historical periods and may no longer hold.
>
> Ticker symbols appear only to illustrate calculations. **None is a recommendation.**
>
> This tool is designed for **personal use by a single user, self-hosted**. Publishing or selling its output as buy/sell recommendations to others may constitute unlicensed securities business activity, prohibited under Article 12(4) of Vietnam's Securities Law, and may breach the data providers' terms of service. Do not redistribute the underlying data.
>
> **Past performance does not indicate future results.** Equity investing risks loss of capital. Under T+2 settlement with EOD-only execution, **three sessions exist during which a position cannot be exited**; worst-case exposure on HOSE is approximately **−19.5%**.
