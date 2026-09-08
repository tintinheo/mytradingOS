# VNQD — TECHNICAL PROPOSAL & ARCHITECTURE

**Vietnam Quant Desk: how to build it**

| | |
|---|---|
| Document | 2 of 2 — Technical Proposal (pairs with *Business Logic Specification*) |
| Date | 2026-09-06 |
| Audience | The developer or AI coding agent implementing the system |
| Companion doc | `VNQD-01-Business-Logic-Specification.md` — read it first; this document assumes it |
| Budget | $0/month |
| Language | Python 3.12 |

---

## TABLE OF CONTENTS

1. [Deployment Reality and Architectural Consequences](#1-deployment-reality-and-architectural-consequences)
2. [Two-Plane Architecture](#2-two-plane-architecture)
3. [Windows 11 Environment Notes](#3-windows-11-environment-notes)
4. [Repository Layout](#4-repository-layout)
5. [Dependencies](#5-dependencies)
6. [Data Sourcing: CafeF](#6-data-sourcing-cafef)
7. [Data Contracts and the Publish Boundary](#7-data-contracts-and-the-publish-boundary)
8. [Indicator Computation Engine](#8-indicator-computation-engine)
9. [VN100 Scanner: Statistical Design](#9-vn100-scanner-statistical-design)
10. [Storage Schema](#10-storage-schema)
11. [Streamlit UI (Dual Mode)](#11-streamlit-ui-dual-mode)
12. [Scheduling on Windows 11](#12-scheduling-on-windows-11)
13. [Testing Strategy](#13-testing-strategy)
14. [Build Order](#14-build-order)
15. [Acceptance Criteria](#15-acceptance-criteria)
16. [Do Not Do This](#16-do-not-do-this)

---

## 1. DEPLOYMENT REALITY AND ARCHITECTURAL CONSEQUENCES

### 1.1. Streamlit Community Cloud free tier (2026)

| Constraint | Value | Architectural consequence |
|---|---|---|
| Memory | ~1 GB RAM | Cannot compute indicators for ~100 stocks in-app at meaningful scale with headroom to spare — but more importantly, must never attempt heavier workloads (backtests, model training) |
| Filesystem | **Ephemeral** — wiped on restart/redeploy | Cannot be the datastore. Anything written at runtime is lost |
| Sleep | App sleeps after ~12 hours without traffic | No reliable in-process scheduler |
| Cron | Not available | Scheduling must happen elsewhere |
| Private apps | 1 on the free tier | Deploy this as that one private app |
| System packages | Unreliable (`packages.txt` / apt) | Avoid any dependency requiring C compilation on this platform |

**Conclusion: Streamlit Cloud is a viewer, not a compute environment.** This is the correct division of labor, not a limitation to route around.

### 1.2. Why local Windows 11 is the compute plane

| Property | Local Windows 11 | GitHub Actions (rejected alternative) | Streamlit Cloud |
|---|---|---|---|
| Scheduled at a fixed local (ICT) time | ✅ Task Scheduler | ⚠️ UTC cron, 5–30 min delays | ❌ |
| RAM / job duration | Unbounded | ~7–16 GB / 6h cap | ~1 GB / seconds |
| Durable full-history storage | ✅ Local DuckDB | ⚠️ repo size limits | ❌ ephemeral |
| Secrets (capital, cash) never leave the machine | ✅ | ⚠️ in repo secrets | ⚠️ in cloud secrets |
| Disabled after inactivity | Never | After 60 days | n/a |
| Requires the machine to be powered on | ⚠️ Yes, ~15:10–16:00 ICT | No | n/a |

The one real tradeoff (last row) is fully mitigated by a missed-run recovery routine (§12.4) that detects gaps and backfills automatically — leaving the machine off for a week costs nothing.

### 1.3. Three architectural decisions that follow

1. **Split compute from view.** All data ingestion, indicator computation, scanning, scoring, and signal generation run locally. Streamlit renders pre-computed artifacts and does nothing else.
2. **Publish a small artifact set, not the full warehouse.** The local machine keeps a full multi-year DuckDB warehouse; it pushes roughly 30 MB of derived, privacy-scrubbed artifacts to a GitHub `data` branch that the cloud app reads over HTTPS.
3. **One codebase, two modes**, selected by a single environment variable (`VNQD_MODE=local|cloud`), sharing all page code and differing only in the data-access layer.
4. **No compiled dependencies.** All indicators — including recursive ones like Wilder RSI/ATR — are implemented in pure NumPy/SciPy/Numba rather than `TA-Lib`, removing the single largest historical cause of deployment failure on Streamlit Cloud.

### 1.4. Deployment tiers

| Tier | Setup | When |
|:---:|---|---|
| **0** | Local only — `streamlit run` on the same PC, no GitHub/cloud account | Build and validate this first |
| **1** ⭐ | Tier 0 + publish to GitHub + Streamlit Cloud view | Recommended target — enables checking signals on a phone |
| **2** | Tier 1 + a GitHub Actions fallback pipeline | Only if the PC is frequently off during the 15:15–16:00 ICT window |

---

## 2. TWO-PLANE ARCHITECTURE

```
╔══════════════════════════════════════════════════════════════════╗
║  COMPUTE PLANE — Local Windows 11 (Task Scheduler, local time)   ║
╠══════════════════════════════════════════════════════════════════╣
║  15:15 ICT Mon–Fri  run_eod.bat                                   ║
║   1. Download 4 CafeF zips (price adj, price raw, index, CCNN)   ║
║   2. Parse → normalize → quality-check (abort on failure)        ║
║   3. Upsert into DuckDB warehouse                                 ║
║   4. Derive corporate actions from adj/raw price ratio            ║
║   5. Compute indicators (§8) + VN100_EW + market breadth          ║
║   6. Anomaly rules → risk score per stock                         ║
║   7. Regime detection (dual index, conservative reading)          ║
║   8. Cross-sectional ranking + scoring (§9)                       ║
║   9. Signal engine: seven gates → order tickets                  ║
║  10. Exit engine → exit alerts, locked-breach warnings            ║
║  11. Write privacy-scrubbed publish/ artifacts                    ║
║  12. Telegram summary; [Tier 1] git commit + push to `data`      ║
║                                                                    ║
║  08:45 ICT Mon–Fri  run_premarket.bat  — gap-check reminder       ║
║  Sat 09:00          run_weekly.bat     — reports, backtest refresh║
║  Quarterly          run_quarterly.bat  — FULL price history       ║
║                       rebuild (mandatory), re-cluster, VN100      ║
║                       membership refresh                          ║
║                                                                    ║
║  Durable local storage: C:\vnqd\data\                             ║
║    market.duckdb, journal.sqlite, archive/, cache/, publish/     ║
╚═══════════════════════════════╤════════════════════════════════════╝
                                │ [Tier 1] git push (~30 MB, no PII)
                                ▼
╔══════════════════════════════════════════════════════════════════╗
║  STORAGE — GitHub branch `data` (versioned, free, no PII)         ║
╚═══════════════════════════════╤════════════════════════════════════╝
                                │ HTTPS raw.githubusercontent.com
                                ▼
╔══════════════════════════════════════════════════════════════════╗
║  VIEW PLANE — Streamlit Community Cloud (VNQD_MODE=cloud)         ║
║  Read-only. Loads Parquet via @st.cache_data. Renders. Nothing   ║
║  else.                                                             ║
╚══════════════════════════════════════════════════════════════════╝

  Same codebase, local mode: streamlit run streamlit_app.py
  (VNQD_MODE=local) → reads DuckDB directly, writes the journal,
  can trigger the pipeline from the UI.
```

### 2.1. Hard rules

- **Rule A.** In cloud mode, the app must never download from CafeF, compute an indicator, run a model, or write a file.
- **Rule B.** `publish/` is the only folder that ever leaves the machine. The trading journal and every capital/cash figure stay local, always.
- **Rule C.** Both modes render identical page code. Mode-specific behavior lives only in the data-access layer.

---

## 3. WINDOWS 11 ENVIRONMENT NOTES

These are the specific pitfalls that will otherwise consume real debugging time.

### 3.1. UTF-8 is mandatory

Vietnamese company names and CafeF file contents contain diacritics. Python's default file encoding on Windows is the locale code page, not UTF-8, which silently corrupts Vietnamese text or throws `UnicodeDecodeError` deep in the pipeline. Apply three defenses together: name `encoding="utf-8"` explicitly on every file operation; set `PYTHONUTF8=1` and `chcp 65001` in every `.bat` entry point; and add a startup assertion that fails loudly if UTF-8 mode is off.

### 3.2. Paths, antivirus, and file locking

- Install the project at `C:\vnqd`, not under `Documents` or a OneDrive-synced folder — OneDrive can corrupt a DuckDB file mid-write, and deep paths risk the 260-character limit.
- Use the standard python.org installer, not the Microsoft Store build (which sandboxes filesystem writes).
- Exclude `C:\vnqd\data` and `python.exe` from Windows Defender's real-time scanning to avoid tripling job runtime on Parquet/DuckDB writes.
- DuckDB allows exactly one writer at a time. The scheduled job must open read-write and retry with a delay if the file is locked (e.g., left open in a notebook); the Streamlit UI in local mode must always open **read-only**.

### 3.3. Git and line endings

Parquet, DuckDB, and ZIP files are binary. Commit a `.gitattributes` marking them as such *before* the first data push, or Git's line-ending normalization will corrupt them or produce enormous spurious diffs.

### 3.4. Automated `git push` from a non-interactive scheduled task

Task Scheduler runs without a terminal, so Git cannot prompt for credentials. Use a fine-grained GitHub Personal Access Token scoped to this one repository, cached once via the Windows Credential Manager — never stored in the repository or in a batch file.

---

## 4. REPOSITORY LAYOUT

```
C:\vnqd\
├── streamlit_app.py             # entry point (repo root — required by Streamlit Cloud)
├── requirements.txt             # CLOUD dependencies only — kept minimal
├── requirements-local.txt        # LOCAL dependencies (superset)
├── .gitattributes                # binary file markers — commit first
├── .env                          # LOCAL ONLY, gitignored
│
├── scripts/                      # Windows entry points (.bat) + Task Scheduler registration (.ps1)
├── pages/                        # Streamlit multipage — mode-agnostic
│
├── vnqd/
│   ├── constants.py               # ⭐ the ONLY place numeric parameters may live
│   ├── market_rules.py            # price bands, tick sizes, lots, T+2, trading calendar
│   ├── mode.py                    # resolves VNQD_MODE; defaults to "cloud" for safety
│   ├── io/                        # data-access facade: local_store.py vs cloud_store.py
│   ├── ingest/                    # LOCAL ONLY — CafeF download, corporate actions, QC
│   ├── indicators/                # pure NumPy/SciPy/Numba
│   ├── profile/                   # 14-metric profiling + cluster assignment
│   ├── anomaly/                   # rule-based + IsolationForest risk scoring
│   ├── signals/                   # regime, setups, scoring, pricing, sizing, 7-gate engine, exits
│   ├── scanner/                   # cross-sectional ranking, IC calculation, FDR control
│   ├── backtest/                  # LOCAL ONLY — execution simulation, validation, DSR/PBO
│   └── notify/                    # Telegram
│
├── jobs/                          # LOCAL ONLY entry points invoked by the .bat scripts
├── config/                        # universe.yaml, commodity map, trading calendar
├── data/                          # gitignored EXCEPT data/publish/
│   ├── market.duckdb  journal.sqlite  archive/  cache/  publish/
├── tests/
└── logs/
```

**Import discipline (enforced by a test):** Streamlit pages may import only from `vnqd.constants`, `vnqd.market_rules`, `vnqd.mode`, and the `vnqd.io` facade. Never `ingest`, `backtest`, or `jobs`.

---

## 5. DEPENDENCIES

| File | Contents | Notes |
|---|---|---|
| `requirements.txt` (cloud) | `streamlit`, `pandas`, `numpy`, `pyarrow`, `plotly`, `requests`, `PyYAML` | Every added package increases cold-start time and memory on a 1 GB instance |
| `requirements-local.txt` | Adds `polars`, `duckdb`, `httpx`, `scikit-learn`, `lightgbm`, `pyod`, `scipy`, `statsmodels`, `numba`, `pytest`, `ruff`, `mypy` | Never installed on the cloud side |

**Forbidden:** `TA-Lib` and `pandas-ta` (C-library / fragile-dependency risk — every formula needed is specified in §8 and implementable directly); `vnstock` (excluded by requirement, third-party risk); `apscheduler` (Windows Task Scheduler is more reliable and survives reboots); `vectorbt` (heavy, licensing caveats — keep the backtest engine in-house); any database server driver (DuckDB locally, Parquet in Git, nothing else). **Never create a `packages.txt` file** — if one seems necessary, a forbidden dependency has been added.

---

## 6. DATA SOURCING: CAFEF

### 6.1. URL pattern (verified)

```
https://cafef1.mediacdn.vn/data/ami_data/{YYYYMMDD}/CafeF.{KIND}.{DDMMYYYY}.zip
```

⚠️ The directory segment uses `YYYYMMDD`; the filename uses `DDMMYYYY`. This is the most common implementation bug — write a unit test for the URL builder before anything else.

| Purpose | KIND | Full-history variant |
|---|---|---|
| Adjusted prices (all 3 exchanges) | `SolieuGD` | `CafeF.SolieuGD.Upto{DDMMYYYY}.zip` |
| Raw (unadjusted) prices | `SolieuGD.Raw` | `CafeF.SolieuGD.Raw.Upto{DDMMYYYY}.zip` |
| Indices | `Index` | `CafeF.Index.Upto{DDMMYYYY}.zip` |
| Order flow + foreign trading | `CCNN` | `CafeF.CCNN.Upto{DDMMYYYY}.zip` |

A one-time bootstrap downloads the four `Upto` files, yielding the entire multi-year history in four HTTP requests; daily runs download the four dated files and append.

### 6.2. Three data traps

1. **Daily dated files are pruned** after roughly 2–3 days; only `Upto` files persist. A missed run must recover via the `Upto` file, not by hunting for a stale dated file.
2. **Adjusted price history is not append-only.** ⭐ Every stock dividend, bonus issue, or rights issue rewrites that stock's *entire* historical adjusted series. Appending daily files without a periodic full rebuild causes the adjusted series to silently drift wrong over months, with no error raised. **The raw series is the append-only source of truth; the adjusted series must be fully rebuilt from the `Upto` file every quarter** — this is mandatory, not optional.
3. **No SLA.** This is a free service that has previously stopped updating for periods. The pipeline must refuse to generate signals (and alert) if the row count drops more than 10% versus the previous session.

### 6.3. Deriving corporate actions for free

Because both adjusted and raw series exist, the entire historical ex-dividend/rights calendar can be reverse-engineered without any web scraping: the ratio of adjusted to raw closing price is constant between corporate actions and jumps exactly when one occurs. Filter jumps below 0.5% as tick-rounding noise. **Validate this by hand** on three symbols with known stock-dividend history before trusting it.

### 6.4. Quality gate (runs before any signal is generated)

The pipeline aborts and alerts if: the latest stored date doesn't match the trading calendar's expected latest session; row count falls more than 10% versus the prior session; any daily return exceeds the price band without a corresponding corporate action; OHLC values are internally inconsistent; or duplicate (date, symbol) rows exist.

---

## 7. DATA CONTRACTS AND THE PUBLISH BOUNDARY

### 7.1. Published artifacts (what leaves the machine)

| File | Contents | Size |
|---|---|---|
| `ohlcv_recent.parquet` | Last ~400 sessions, adjusted prices | ~5 MB (100 stocks) |
| `features_latest.parquet` | Latest session, one row per stock, all indicators | < 1 MB |
| `index_recent.parquet` | VN-Index + VN100_EW + breadth history | ~1 MB |
| `signals_latest.json` | Today's order tickets | ~20 KB |
| `exits_latest.json` | Exit alerts | ~10 KB |
| `rejections_latest.json` | Why each stock failed, by gate | ~50 KB |
| `run_meta.json` | Status, dates, row counts, QC results | ~2 KB |

Total ≈ 10–15 MB (smaller than the market-wide design, since only VN100 is in scope).

### 7.2. The privacy boundary ⭐

**Published tickets carry no VND amounts and no capital figures.** Position size is expressed as a percentage of NAV; the cloud app multiplies by a NAV value stored only in that deployment's own secrets. This means the public `data` branch contains no personal financial information even if the GitHub repository itself is public. A dedicated test scans every published file for keys like `qty`, `nav`, `notional`, or any large VND-scale integer and fails the build if found.

### 7.3. `run_meta.json` staleness contract

Every page must display `run_meta.trading_date` prominently and show a loud staleness banner if it is not the most recent expected trading session — this is the primary signal to the user that the local pipeline may have failed to run.

---

## 8. INDICATOR COMPUTATION ENGINE

### 8.1. Engine choice

At VN100 scale (~100 stocks × ~15 years ≈ 375,000 rows), **the performance question is moot** — pandas, Polars, NumPy, and DuckDB window functions all complete any rolling/groupby computation in well under a second. Polars is used because it is already the chosen stack and its lazy API and consistent null handling are valuable for correctness, not because it is required for speed. No complex vectorization tricks are needed for non-recursive indicators (moving averages, RSI inputs, Bollinger Bands, breadth).

### 8.2. Recursive indicators (Wilder RSI/ATR, EMA, ADX)

Wilder-smoothed indicators are first-order IIR filters (`y[t] = α·x[t] + (1-α)·y[t-1]`), which can be computed either via `scipy.signal.lfilter` (fully vectorized, no compilation) or via an explicit Numba `@njit`-compiled loop (easier to golden-value test, and the better choice for ADX's nested recursive steps). Numba's JIT compilation works reliably on Windows 11/Python 3.12 without requiring a C++ build toolchain — it depends only on `llvmlite`, which ships with the pip package. Use `cache=True` to avoid repeated compilation cost on every run.

```python
from numba import njit
import numpy as np

@njit(cache=True)
def wilder_rma(x: np.ndarray, n: int) -> np.ndarray:
    """Wilder smoothing (RMA), alpha = 1/n, SMA-seeded warm-up."""
    out = np.full(x.shape[0], np.nan)
    if x.shape[0] < n:
        return out
    seed = x[:n].sum()
    out[n - 1] = seed / n
    for t in range(n, x.shape[0]):
        out[t] = (out[t - 1] * (n - 1) + x[t]) / n
    return out
```

Apply per-symbol (never across a symbol boundary) via a Polars group-by, or via a simple Python loop over ~100 symbols — at this scale, loop overhead is irrelevant.

### 8.3. Incremental vs. full recomputation

Because a full recompute of the entire indicator set completes in a couple of seconds at this scale, **incremental (state-based) computation is not required for performance** and is deliberately not built initially — full recomputation every session is simpler, easier to make idempotent, and easier to test. Revisit only if a future full-market expansion makes recomputation too slow.

### 8.4. Handling non-trading sessions and newly added stocks

A stock that does not trade on a given session should have its price forward-filled (so rolling windows don't break) but its volume left at zero, and should be flagged `is_stale` and excluded from that day's cross-sectional ranking. A stock newly added to VN100 without the minimum ~280 sessions of history simply fails to compute its 6-month relative-strength window and is automatically excluded from signal generation by that fact — no special-casing required, and no history should ever be synthetically backfilled.

---

## 9. VN100 SCANNER: STATISTICAL DESIGN

This section implements the business rules in §13 of the companion document. It is the most statistically delicate part of the system, precisely because the trading universe is small.

### 9.1. Two universes: computation vs. trading

Cross-sectional ranks used for scoring are computed against the wider **VNAllshare** universe (~350 stocks) to reduce ranking noise, while the **VN100** membership list restricts which stocks can actually receive a signal. Both a `rank_in_vnallshare` and a `rank_in_vn100` column are stored, and Gate 4's dual-condition thresholds are evaluated primarily on the wider-universe rank.

### 9.2. Cross-sectional normalization

Given the fat-tailed, outlier-prone nature of this market's return distributions, raw z-scores are avoided. The default normalization is a **rank-based inverse normal transform (Blom's method)**, applied after 2.5%-per-tail winsorization:

```python
from scipy import stats
import polars as pl

def blom_transform(s: pl.Series) -> pl.Series:
    r, n = s.rank(method="average"), s.len()
    return pl.Series(stats.norm.ppf((r.to_numpy() - 0.375) / (n + 0.25)))
```

Percentile rank is retained separately, purely for the human-readable dual-condition thresholds (60th / 40th percentile) described in the business logic document.

### 9.3. Cluster-based neutralization, not sector-based

With ~100 stocks spread across ~15 sectors, several sectors have too few members (2–7) for meaningful within-sector standardization. Normalization is instead performed within each of the six behavioral clusters (C1–C6, §5 of the companion document), each of which typically contains 15–25 members — a defensible sample size — and which better captures true behavioral co-movement than a sector label does.

### 9.4. Information Coefficient and its confidence interval

A single day's cross-sectional correlation between a factor score and forward returns is essentially meaningless noise at N≈100 — its standard error is approximately `1/√(N-3) ≈ 0.10`. A factor's IC must therefore always be reported with its rolling mean, standard deviation, an information ratio (mean IC / std IC), and a confidence interval built from several hundred sessions of history, never as a single number:

```python
def compute_ic(daily_ic: np.ndarray) -> dict:
    T, mean_ic, std_ic = daily_ic.size, daily_ic.mean(), daily_ic.std(ddof=1)
    se = std_ic / np.sqrt(T)
    return {
        "mean_ic": mean_ic, "icir": mean_ic / std_ic if std_ic else np.nan,
        "t_stat": mean_ic * np.sqrt(T) / std_ic if std_ic else np.nan,
        "ci95": (mean_ic - 1.96 * se, mean_ic + 1.96 * se),
    }
```

As a rule of thumb, distinguishing a genuine IC of 0.03–0.05 from zero at conventional confidence requires on the order of **125–250 trading sessions** (roughly six months to a year) of accumulated history — this is a statistical floor, not something that can be shortened by better engineering.

### 9.5. Combining factors into one score

Multiple factors are combined with **IC-weighting shrunk heavily toward equal weighting** (shrinkage factor λ ≈ 0.2–0.4, itself a [D]-tagged parameter requiring calibration), because with only ~100 cross-sectional observations, IC estimates are too noisy to trust at full weight — published evidence on combining forecasts consistently favors this kind of conservative blending over naively trusting the estimated weights. Factors are **not** orthogonalized against each other; forcing independence tends to remove real information rather than noise.

### 9.6. Controlling false positives

Because the trading universe is fixed at ~100 names (a *smaller* multiple-testing burden than a market-wide scan would carry), a **Benjamini–Hochberg false-discovery-rate procedure** is used for day-to-day signal screening rather than a stricter Bonferroni correction, which would be needlessly conservative at this scale:

```python
def bh_fdr(pvals: np.ndarray, alpha: float = 0.10) -> np.ndarray:
    n = pvals.size
    order = np.argsort(pvals)
    thresh = alpha * np.arange(1, n + 1) / n
    passed = pvals[order] <= thresh
    keep = np.zeros(n, dtype=bool)
    if passed.any():
        keep[order[: int(np.max(np.where(passed))) + 1]] = True
    return keep
```

Separately, when *accepting a new factor or parameter set* into the system (a much rarer, higher-stakes decision than daily screening), a much higher bar applies — the number of parameter combinations ever tried must be counted honestly and fed into a **Deflated Sharpe Ratio** calculation, which corrects a strategy's apparent Sharpe ratio for the selection bias inherent in having tried multiple variations:

```python
def deflated_sharpe(sr: float, T: int, skew: float, kurt: float,
                    n_trials: int, var_sr: float) -> float:
    gamma = 0.5772156649
    sr_star = np.sqrt(var_sr) * (
        (1 - gamma) * stats.norm.ppf(1 - 1 / n_trials)
        + gamma * stats.norm.ppf(1 - 1 / (n_trials * np.e))
    )
    denom = np.sqrt(1 - skew * sr + (kurt - 1) / 4 * sr ** 2)
    return stats.norm.cdf((sr - sr_star) * np.sqrt(T - 1) / denom)
```

### 9.7. Point-in-time universe membership

VN100 membership changes twice yearly and **no free source publishes a downloadable history of past membership.** Two complementary steps are required: (1) starting immediately, snapshot and store the officially published membership list at every semi-annual review date — this is a data asset that cannot be reconstructed retroactively once missed; (2) for backtesting periods before that snapshot began, approximate historical membership by re-running the exchange's own published selection rule (rank by adjusted market capitalization among stocks meeting the minimum listing-age and turnover criteria) against historical price data, and measure the reconstruction's agreement against any officially confirmed snapshot that can be found. **Any backtest result that is sensitive to universe membership must report this reconstruction accuracy alongside the result** — below roughly 85% agreement, membership-sensitive conclusions should not be trusted.

---

## 10. STORAGE SCHEMA

| Table (DuckDB, local) | Key | Notes |
|---|---|---|
| `prices_adj` / `prices_raw` | (symbol, date) | Raw is append-only truth; adjusted is fully rebuilt quarterly |
| `foreign_flow` | (symbol, date) | From CafeF CCNN |
| `index_eod` | (index_code, date) | VN-Index, VN100 official index, self-computed VN100_EW |
| `vn100_membership` | (symbol, effective_date) | ⭐ Point-in-time table, populated per §9.7 |
| `features` | (symbol, date) | All computed indicators |
| `ranks` | (symbol, date) | Both `rank_in_vn100` and `rank_in_vnallshare` |
| `clusters` | (symbol, as_of) | Cluster assignment + human-readable reason |
| `anomaly_flags` | (symbol, date) | Risk score, contributing rule hits |
| `signals` | (id) | Full ticket, including quantity and NAV — **local only, never published raw** |
| `journal` (SQLite) | (id) | Fills, skips, notes — **stays local, always** |
| `scanner_kpi` | (date) | Gate survival counts, rolling IC, hit rate, drift indicators |

Parquet files under `data/publish/` mirror a privacy-scrubbed, recent-history slice of `features`, `ranks`, `signals` (percentage-based, no absolute amounts), and `scanner_kpi` for the cloud view.

---

## 11. STREAMLIT UI (DUAL MODE)

### 11.1. Data-access facade

A single `DataAccess` interface is implemented twice — once reading DuckDB directly with write access to the journal (`local_store.py`), once reading published Parquet/JSON over HTTPS with `@st.cache_data` and no write capability at all (`cloud_store.py`). Every page imports only the facade and is unaware of which implementation is active. `vnqd.mode.current_mode()` defaults to `cloud` when the `VNQD_MODE` environment variable is absent — a cloud deployment must never accidentally attempt to open a local DuckDB file.

### 11.2. Pages

| Page | Purpose |
|---|---|
| Home / Today | Regime badge, index divergence alert, today's order tickets, exit alerts, locked-breach warnings |
| Market | Dual-index chart (VN-Index vs. VN100_EW), regime timeline, breadth panel, sector heatmap |
| Signals | Today's tickets in full detail; **rejection explorer** — a filterable table showing exactly why each stock failed and at which gate; gate-survival funnel chart |
| Portfolio | Open positions, days until sellable, distance to stop/target, exposure vs. every concentration cap |
| Screener | Interactive filter over the latest cross-sectional scores; a one-click "dual condition" preset |
| Stock Detail | Candlestick + moving averages, dual relative-strength panel over time, full profile, anomaly evidence |
| Risk Radar | Stocks ranked by anomaly score with supporting evidence and an explicit "statistical flag, not an accusation" disclaimer |
| Clusters | Cluster membership and rationale; a **variance-ratio histogram across VN100** — the single most informative chart in the app, showing at a glance how much of the market is trending versus mean-reverting |
| Journal | Local mode: full read/write. Cloud mode: read-only summary in risk-multiple terms, no currency amounts |
| Backtest | **Local mode only** — hidden entirely in cloud mode, since the computation would exceed the memory budget |

### 11.3. Mandatory footer

Every page renders the compliance disclaimer from §15 of the companion document, along with a visible mode badge (local/read-write vs. cloud/read-only) and the staleness banner whenever published data is not current.

---

## 12. SCHEDULING ON WINDOWS 11

### 12.1. Task registration

Four scheduled tasks, registered via a PowerShell script run once as Administrator: the main EOD pipeline (weekdays 15:15 local time), a pre-market gap-check reminder (weekdays 08:45), a weekly report/backtest refresh (Saturdays), and the mandatory quarterly full-history rebuild. Tasks are configured with `-StartWhenAvailable` and `-WakeToRun` so a missed or sleeping window does not silently skip the job.

### 12.2. Retry logic for late data

Because CafeF may publish slightly after 15:15, the job itself retries internally (a few attempts with increasing delay) before giving up and notifying — rather than relying on multiple scheduled trigger times.

### 12.3. Publishing without triggering redeploys

Streamlit Cloud must track the `main` branch, never the `data` branch — otherwise every daily data push would trigger an app redeploy and restart. The publish step uses a Git worktree so the main working tree is never disturbed by the commit.

### 12.4. Missed-run recovery ⭐

Every run begins by comparing the latest stored trading date against the expected latest session on the trading calendar. A gap of one or two sessions is backfilled from the (still-available) dated daily files; a larger gap triggers a full rebuild from the `Upto` file. **This is what makes "the machine must be on" a non-issue in practice** — leaving the PC off for a week costs nothing, because the next run simply detects and closes the gap.

### 12.5. Monitoring

A one-line Telegram message on every successful run (date, regime, ticket count, duration); a detailed alert with the log path on any failure; and a weekly health digest summarizing completed vs. expected runs, quality-check failures, cluster stability, and rolling hit rate.

---

## 13. TESTING STRATEGY

| Test | Verifies |
|---|---|
| UTF-8 round-trip | Vietnamese text survives file I/O; the startup assertion fires if UTF-8 mode is off |
| URL builder | Directory uses `YYYYMMDD`, filename uses `DDMMYYYY`, `Upto` insertion is correct |
| Golden-value indicators | RSI/ATR/EMA/ADX match hand-computed values on a fixed fixture |
| Corporate-action derivation | Recovers a known stock-dividend event from a synthetic adjusted/raw price pair |
| **No look-ahead in ranking** ⭐ | A rank computed using data truncated at date T is bit-identical to the same rank computed later using the full dataset, sliced back to T |
| **Point-in-time membership** ⭐ | On any historical date, the reconstructed universe matches the officially confirmed snapshot for that period, above the 85% threshold |
| **Entry price is never same-day close** ⭐ | The backtest execution engine structurally cannot accept a same-session close as an entry price |
| Dual-stop ordering | `sizing_stop < exit_stop < entry`, always |
| Gap-gate boundaries | Cancel / reduce / review / proceed trigger at the correct thresholds |
| Gate evaluation order | Rejections are recorded against the correct gate, in the correct sequence |
| Downtrend abort | Regime `DOWNTREND` yields exactly zero signals |
| No published PII | Every file under `data/publish/` is scanned for currency amounts, share quantities, or NAV values and must contain none |
| Idempotency | Running the full pipeline twice for the same date produces byte-identical artifacts |
| FDR sanity | On synthetic data with a true IC of zero, the Benjamini–Hochberg procedure retains almost nothing |

The two tests marked ⭐ that matter most: **no look-ahead in ranking** (the single most common source of an invisible but fatal bug in any cross-sectional system) and **entry price is never same-day close** (the single most common source of a backtest that looks excellent and fails immediately in live use).

---

## 14. BUILD ORDER

Order matters — in particular, the backtest engine must exist before the signal engine, so that every default parameter can be evaluated before it is ever relied upon.

| Phase | Focus | Exit criterion |
|---|---|---|
| **0. Windows foundation** | Environment setup, UTF-8 assertion, `.gitattributes`, Defender exclusions, constants module | UTF-8 and path tests pass |
| **1. Ingestion** | CafeF downloader against a verified real-file fixture, DuckDB schema, bootstrap | Full multi-year history loads from 4 requests |
| **2. Corporate actions + QC** | Adjusted/raw derivation, quality gate, missed-run recovery | No false gaps at ex-dividend dates on manually checked stocks |
| **3. Indicators** | All formulas in §8, VN100_EW, breadth | Golden-value tests pass |
| **4. Backtest engine** ⭐ | T+1 fill simulation, three-locked-session enforcement, transaction costs, walk-forward validation, Deflated Sharpe, PBO | The same-close-vs-next-open CAGR gap is measured and reported |
| **5. Profiling + clustering** | 14-metric profile, cluster assignment, stability tracking | A **placebo test** (random cluster assignment) is run and shown not to match real clusters — otherwise the clustering is discarded in favor of one shared parameter set |
| **6. Anomaly scoring** | Rule-based + IsolationForest risk score | Back-tested against publicly disclosed enforcement cases |
| **7. Signal engine** | Regime, setups, scoring, pricing, dual stops, sizing, seven gates, exits | Manually worked sizing example reproduces exactly |
| **8. Local UI (Tier 0)** | All pages in local mode | Fully usable without any cloud account |
| **9. Scheduling** | `.bat` scripts, task registration, Telegram, monitoring | Runs unattended for one full week |
| **10. Cloud view (Tier 1)** | Publish pipeline, `data` branch, cloud store, deploy | Under 400 MB peak memory, every page under 10 seconds, no PII leak |

---

## 15. ACCEPTANCE CRITERIA

- [ ] The EOD pipeline completes in well under its time budget on ordinary desktop hardware
- [ ] Corporate actions are derived and manually verified on at least three known cases
- [ ] The quarterly job performs a full adjusted-price rebuild, not an incremental append
- [ ] All seven gates are implemented, evaluated in order, with every rejection logged and explained
- [ ] The dual relative-strength condition is enforced using the wider computation universe
- [ ] Regime detection uses both indices and takes the more conservative reading on disagreement
- [ ] `DOWNTREND` produces exactly zero signals
- [ ] The dual-stop system is implemented and the sizing stop is never used for exit decisions
- [ ] No numeric threshold exists outside the constants module
- [ ] The cloud deployment never computes, downloads, or writes anything
- [ ] No published artifact contains a currency amount, share quantity, or NAV figure
- [ ] A placebo test has been run on the cluster design and its result recorded
- [ ] A same-close-vs-next-open backtest comparison has been run and the phantom-profit gap reported
- [ ] Point-in-time universe reconstruction accuracy has been measured against any available official snapshot

---

## 16. DO NOT DO THIS

| ❌ | Why it breaks |
|---|---|
| Open a file without `encoding="utf-8"` on Windows | Silent corruption of Vietnamese text |
| Install under OneDrive or the Microsoft Store Python build | Sync corruption; filesystem sandboxing |
| Add `TA-Lib` or create `packages.txt` | C build fails on Streamlit Cloud |
| Default `VNQD_MODE` to `local` | A cloud deployment would crash trying to open a nonexistent local database |
| Publish quantities, NAV, or currency amounts | Leaks personal financial data into a versioned, possibly public branch |
| Point Streamlit Cloud at the `data` branch | Every data push would trigger a redeploy and restart the app daily |
| Use the same-session close as an entry price anywhere | Physically impossible to execute; invents phantom profit |
| Append adjusted prices without a periodic full rebuild | Silent, undetected drift as corporate actions rewrite history |
| Tune indicator parameters per individual stock | Guaranteed overfitting on a small, highly cross-correlated universe |
| Use VN-Index alone as the regime filter | The index is dominated by a handful of its largest constituents |
| Emit signals while regime is `DOWNTREND` | Herding behavior on this market intensifies in falling markets |
| Size positions using the narrow exit stop | Understates the three-locked-session tail risk by roughly 1.7× |
| Build the signal engine before the backtest engine | Produces confident-looking recommendations nobody can evaluate |

---

> ## DISCLAIMER
>
> This document is a technical build specification for **personal research software**. It is not investment advice and not legal advice. Every default parameter referenced here must be calibrated against historical data — following the validation steps in §14 — before being trusted with real capital. This tool is designed for personal use by a single user, self-hosted; publishing or selling its output as investment recommendations to others may carry legal consequences under Vietnamese securities law, and redistributing the underlying free data may breach its provider's terms of use.
