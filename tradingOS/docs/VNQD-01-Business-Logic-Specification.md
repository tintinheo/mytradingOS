# VNQD — BUSINESS LOGIC SPECIFICATION

**Vietnam Quant Desk: trading philosophy, rules, and decision logic**

| | |
|---|---|
| Document | 1 of 2 — Business Logic (pairs with *Technical Proposal & Architecture*) |
| Date | 2026-09-06 |
| Audience | Product owner, reviewers, and any developer needing the "why" before the "how" |
| Scope | What the system decides and why — no code, no infrastructure |

---

## TABLE OF CONTENTS

1. [Purpose and Non-Goals](#1-purpose-and-non-goals)
2. [Market Context Summary](#2-market-context-summary)
3. [Trading Philosophy and Hard Constraints](#3-trading-philosophy-and-hard-constraints)
4. [The Unifying Principle](#4-the-unifying-principle)
5. [Universe and Behavioral Clusters](#5-universe-and-behavioral-clusters)
6. [Market Regime](#6-market-regime)
7. [Signal Pipeline: Seven Gates](#7-signal-pipeline-seven-gates)
8. [Setup Catalog](#8-setup-catalog)
9. [Pricing, Stops, Targets, Sizing](#9-pricing-stops-targets-sizing)
10. [Scoring and Probability](#10-scoring-and-probability)
11. [Timing and Order Lifecycle](#11-timing-and-order-lifecycle)
12. [Exit Rules](#12-exit-rules)
13. [Scope Decision: VN100 and Small-Sample Statistics](#13-scope-decision-vn100-and-small-sample-statistics)
14. [Portfolio and Risk Constraints](#14-portfolio-and-risk-constraints)
15. [Compliance and Legal Constraints](#15-compliance-and-legal-constraints)
16. [Parameter Registry](#16-parameter-registry)
17. [Realistic Performance Expectations](#17-realistic-performance-expectations)

---

## 1. PURPOSE AND NON-GOALS

**Purpose.** VNQD is a personal research tool that scans the VN100 basket (Ho Chi Minh Stock Exchange), scores stocks, and generates end-of-day trade tickets with an entry price, two stops, two targets, and a position size — for one user, on their own capital.

**Non-goals.**
- Not a service for other people. Not investment advice.
- Not an auto-trading system. No order is ever placed by the software.
- Not a day-trading tool. The market's T+2 settlement makes this structurally an end-of-day, multi-session swing system.
- Not a market-wide scanner. Scope is deliberately the VN100 basket (see §13), not all ~1,600 listed names.

---

## 2. MARKET CONTEXT SUMMARY

Vietnam's stock market (HOSE, HNX, UPCOM) is a frontier/emerging market with:

- **High concentration.** Banking and real estate alone account for roughly 53% of HOSE market capitalization. The VN-Index is dominated by its largest constituents (VIC, VHM, VCB, BID, FPT, HPG).
- **High retail participation.** Individual investors drive the large majority of trading value, producing strong herding behavior, momentum-chasing, and sharp reversals.
- **Documented market inefficiencies.** Academic research on this specific market (see §16 Academic Basis) finds weak-form inefficiency, short-term price reversal (1–3 month horizon), medium-term momentum (6-month formation, 9-month holding), asymmetric volatility (down shocks larger than up shocks), and herding that intensifies in falling markets.
- **Structural features that shape execution.** T+2 settlement, daily price bands (±7% HOSE / ±10% HNX / ±15% UPCOM), no short-selling, and (as of the KRX system live since 2025-05-05) limit orders no longer receive lower priority than opening/closing auction orders.
- **A 2025–2027 upgrade cycle.** FTSE Russell's emerging-market upgrade (effective 2026-09-21) is expected to bring passive foreign inflows in phases through 2027, a macro tailwind independent of any stock-picking edge this system might have.

The system is built to exploit the *documented, market-specific* inefficiencies above — not generic textbook technical analysis.

---

## 3. TRADING PHILOSOPHY AND HARD CONSTRAINTS

| Constraint | Rule | Why |
|---|---|---|
| Execution style | **End-of-day only.** Signals generated after the close of session T; orders placed the following morning (T+1) | The person does not watch intraday screens; matches T+2 settlement reality |
| Settlement | **T+2** — shares credited by 13:00 on T+2 after the buy fill | Regulatory fact of the Vietnamese market |
| Direction | **Long only.** No short-selling | Not permitted for retail on this market |
| Automation | **No auto-trading, ever.** The system produces a ticket; a human places the order | Avoids unlicensed "securities business activity"; keeps a human in the loop for a market prone to manipulation and gaps |
| Personal use | Single user, self-hosted, own capital | Publishing outputs as recommendations to others may constitute unlicensed securities advisory activity under Vietnamese law |
| Cost basis | 0.15% brokerage per side + 0.10% sell tax + ~0.027% exchange fee + slippage | Must be netted out of every expectancy claim |

### 3.1. The three-locked-session problem

Because the buy fills on T+1 and shares only settle by T+3 13:00, **there are three consecutive sessions (T+1, T+2, T+3 morning) during which the position cannot be exited under any circumstances**, regardless of price action. On HOSE's ±7% daily band, the theoretical worst case is:

```
Maximum theoretical loss while locked = 1 − (1 − 0.07)³ ≈ −19.5%
```

Three consecutive limit-down sessions is not a hypothetical — it has occurred repeatedly on this market, especially around governance or fraud disclosures. **This single fact drives more of the system's risk design than any indicator.** It is the reason for the dual-stop system (§9.2), the wider default stop widths, the smaller position sizes, and the anomaly-risk gate that exists specifically to keep the system out of stocks prone to this failure mode.

---

## 4. THE UNIFYING PRINCIPLE

Every setup, score, and threshold in this system is a refinement of one sentence, derived from combining two separately documented effects on this market:

> ### Medium-term momentum selects WHICH stock. Short-term reversal selects WHEN to buy it.

- **Medium-term momentum** (6-month formation, held ~9 months) has been documented on this market. A stock's relative strength over the prior six months (`rs_126`) identifies genuine, persistent outperformers.
- **Short-term reversal** (1–3 month horizon) has also been documented, including on this specific exchange: after a period of relative weakness, stocks tend to bounce, and this effect fades by month three.

**The entry condition combines both:** a stock must rank **high** on 6-month relative strength (`rs_126_rank ≥ 60`, i.e., in the top 40% of the reference universe) **and** rank **low** on 1-month relative strength (`rs_20_rank ≤ 40`, i.e., in the bottom 40%). In plain language: *a fundamentally/technically strong stock that has just gone through a temporary, short-lived dip.*

Every one of the eight setups (§8), the scoring formula (§10), and the six behavioral clusters (§5) exists to refine this single condition — never to replace it. If the entire system were reduced to one rule, this is the rule to keep.

**One exception is deliberately carved out:** cluster C3 (high-beta brokerage stocks) uses a *momentum* variant instead — buying strength that is *also* strong in the short term — but only when the market regime is unambiguously bullish (§6). This is the only place in the system where "buy strength, not weakness" is permitted, and it is fenced off tightly for that reason.

---

## 5. UNIVERSE AND BEHAVIORAL CLUSTERS

### 5.1. Why VN100, and why two universes

The trading universe is the **VN100 basket** (VN30 + VNMidcap, per HOSE's official index rules) — roughly 100 of the most liquid, largest-cap names on HOSE, rebalanced twice yearly (January and July).

A key business decision: **the universe used to *compute* relative rankings is wider than the universe used to *trade*.** Cross-sectional ranking on only ~100 names has high statistical noise (see §13). The system therefore computes percentile ranks against the broader VNAllshare universe (~350 names) for statistical stability, while still restricting actual trade candidates to VN100 members. This is a deliberate design choice, not an oversight.

### 5.2. Six behavioral clusters (C1–C6)

Rather than tuning trading parameters for each of ~100 individual stocks (a statistically doomed exercise — see §13.1), stocks are grouped into six behavioral clusters based on 14 measured statistical properties (variance ratio, beta, idiosyncratic volatility, overnight-gap distribution, limit-hit frequency, liquidity, etc.), refreshed quarterly. Each cluster gets its own parameter set.

| Cluster | Character | Trading logic | Key business rule |
|---|---|---|---|
| **C1** Mega-cap anchors | High liquidity, moderate volatility, beta ≈ 1 | Trend + pullback | These stocks effectively *are* the index — regime and relative-strength calculations must use the self-computed equal-weight index (VN100_EW), not VN-Index, to avoid circular reasoning |
| **C2** High-liquidity banks | Very high intra-cluster correlation | Mean reversion | Sector-level timing matters more than individual stock-picking → **maximum 2 concurrent positions** in this cluster |
| **C3** High-beta amplifiers (brokerages) | Beta 1.3–1.8, high volatility | **Momentum** (the only cluster using this logic) | Permitted **only** when market regime is `STRONG_UPTREND` |
| **C4** Commodity cyclicals | Externally driven by global commodity prices | Trend + commodity filter | Requires the reference commodity price to be above its own 50-day trend before any signal fires |
| **C5** Low-volatility defensives | Vol < 28%, beta < 0.85 | **Mean reversion** | Tightest stop **and** largest position weight — should be the *backbone* of the portfolio, not a garnish |
| **C6** Volatile mid-caps | Vol > 45%, frequent limit-hits | Mean reversion, heavily constrained | The most dangerous cluster under the three-locked-session rule: max 5% position weight, max 1 concurrent position, **margin never permitted** |

### 5.3. Owner-group concentration limits

Several VN100 constituents are effectively one economic bet split across multiple tickers (e.g., Vingroup's VIC/VHM/VRE/VPL). The exchange itself caps related-stock groups at 15% within the VN30 basket; this system applies the same logic to the whole portfolio:

| Group | Members | Combined cap |
|---|---|:---:|
| Vingroup | VIC, VHM, VRE, VPL | 15% NAV |
| Masan | MSN, MCH, MSR | 12% NAV |
| Techcombank | TCB, TCX | 12% NAV |
| Gelex | GEX, GEE, VCK | 10% NAV |
| Other discovered groups | — | 10% NAV |

---

## 6. MARKET REGIME

No signal is generated in isolation from the state of the overall market. Regime is assessed daily using **two indices simultaneously** — VN-Index and the self-computed VN100_EW — and whenever they disagree, **the more conservative reading wins.** This matters because VN-Index can be pushed higher by two or three mega-caps while the median stock is falling; VN100_EW is immune to that distortion.

| Regime | Clusters permitted to trade | Position-size multiplier |
|---|---|:---:|
| `STRONG_UPTREND` | All (C1–C6) | 1.00 |
| `UPTREND` | C1, C2, C4, C5 | 0.85 |
| `SIDEWAY` | C1, C2, C4, C5 | 0.65 |
| `MILD_CORRECTION` | **C5 only** | 0.40 |
| `DOWNTREND` | **None — zero new signals** | 0.00 |

**The `DOWNTREND` rule is absolute, not a suggestion.** Herding behavior on this market has been documented to intensify specifically in falling markets. Buying into weakness during a genuine downtrend — which is exactly what several of this system's mean-reversion setups would otherwise do — is the classic mechanism by which retail accounts are destroyed on this market. The system must produce **zero signals**, not fewer signals, when regime is `DOWNTREND`.

---

## 7. SIGNAL PIPELINE: SEVEN GATES

Every candidate stock is evaluated against seven sequential gates. **Failing any gate is a hard rejection — there is no "close enough."** Every rejection and its gate is logged, because that log is what makes the system's silence explainable.

| Gate | Question asked | Consequence of failure |
|:---:|---|---|
| **0** | Is the overall market in a tradeable regime? | If `DOWNTREND`: abort the entire run |
| **1** | Is the stock liquid enough, long enough listed, and not flagged by the exchange (warning/control/restricted)? | Excluded from consideration entirely |
| **2** | Does the stock show abnormal price/volume/order-flow patterns (anomaly risk)? | Excluded if risk score exceeds the cluster's threshold |
| **3** | Does the stock's cluster match what the current regime permits, and is any required external condition satisfied (e.g., C4 needs its commodity above trend)? | Excluded from today's run |
| **4** | Does the stock satisfy the dual condition (§4) **and** trigger at least one recognized chart setup with adequate volume confirmation? | Excluded — this is the heart of the system |
| **5** | Does the resulting trade have an adequate technical score, statistical win probability, and risk-reward geometry? | Excluded |
| **6** | Does adding this position respect portfolio-level limits (sector cap, owner-group cap, cluster concentration cap, total open risk, available cash)? | Excluded |

Survivors are ranked by a composite of technical score and win probability, diversified across clusters and sectors, and capped at **three tickets per day.** More than three is treated as a symptom of thresholds that are too loose, not a productive day.

---

## 8. SETUP CATALOG

Eight chart-pattern setups implement the entry side of the dual condition. Each is tagged with which behavioral clusters it applies to and how well it fits end-of-day execution.

| Setup | Business description | EOD fit |
|---|---|:---:|
| **Pullback to 20-day average** ⭐ | Stock in a confirmed uptrend dips to its 20-day moving average on *falling* volume (a healthy pause, not distribution), then shows a bullish reversal candle | Excellent — the workhorse setup |
| **Pullback to 50-day average** | Deeper version of the above, used when the market is choppier | Excellent |
| **Reversal at support** | Stock touches a well-defined support level with a bullish momentum divergence and *rising* volume (the opposite volume signature from a pullback — this is buying strength returning, not a quiet dip) | Good |
| **Lower Bollinger Band** (defensives only) | Statistical extreme low-volatility mean-reversion entry | Good, defensives only |
| **Trend following** | Stock in a clean, established uptrend, bought on strength within the trend | Excellent — timing precision doesn't matter much |
| **Relative-strength leader** | Stock near its 52-week high with exceptional 6-month relative strength and a strong sector behind it | Good |
| **20-day momentum** (brokerages only) | Buying acceleration directly, permitted only in a strongly bullish market | Needs a fill, carries real gap risk |
| **Volatility contraction** | A tightening trading range followed by an expansion — a classic technical base-breakout pattern | Acceptable with a tight limit price |

**One setup is explicitly excluded by design: "gap and go" or any other intraday-triggered pattern.** These are structurally incompatible with end-of-day execution, because the entire premise requires acting *within* the session the pattern appears, which this system cannot do (see §11.4 on why overnight gaps matter so much here).

---

## 9. PRICING, STOPS, TARGETS, SIZING

### 9.1. Entry price — never the same-day close

The single most important execution rule in the whole system:

> **The entry price is never the closing price of the signal day.** Signals are generated after the close of session T; the order is only placed — and only fills — on the morning of T+1. A limit price is computed from the T close plus a small premium (0.3%–1.0%, varying by setup — tighter for setups with high overnight-gap risk, looser for setups where getting filled matters more than the exact price), then checked the next morning against the actual gap (§11.3).

Backtests or live systems that use the same-day close as the entry price invent phantom profit that cannot be realized in practice. This is treated as a correctness bug, not a modeling simplification.

### 9.2. Two stops, not one — the second most important rule

Because of the three-locked-session problem (§3.1), the system maintains **two separate stop prices for every position:**

| Stop | Purpose | Width |
|---|---|---|
| **Exit stop** | The price at which the system tells the user to sell the next morning it is possible to do so. This is a *reminder*, not a broker-side stop order (none exists here) | Narrower — based on chart structure and normal volatility |
| **Sizing stop** | Used **only** to calculate how many shares to buy. Never used to decide when to exit | Wider — deliberately incorporates the asymmetric-volatility effect (down-day volatility is measured separately and used if it exceeds normal volatility by more than 30%) |

**Why two stops matter:** if position size were calculated using the narrow exit stop, the system would buy roughly 1.7× more shares than the real three-session tail risk justifies. The wide sizing stop exists specifically so that when a position is locked and breached — which will happen — the realized loss still falls within the pre-committed risk budget.

### 9.3. Targets and risk-reward

Two profit targets are set from the exit stop's implied risk unit ("R"): the first at 2R (sell half the position), the second at 3.5R (sell the rest, or trail). A trade is only accepted if the resulting risk-reward is at least 2.0-to-1 — wider than a conventional 1.5-to-1 minimum, because the wider stop demands a farther target to remain worthwhile.

### 9.4. Position sizing

Position size is set so that the dollar risk (using the *sizing* stop) does not exceed a small, fixed fraction of total capital (0.4%–0.7%, adjusted down further by market regime and by known risk facts about the individual stock — high beta, a history of consecutive limit-downs, low free float). This raw size is then capped by four independent ceilings: maximum weight per stock, maximum share of the stock's own daily trading volume (to avoid moving the price), available cash, and remaining budget within any owner-group limit. **The smallest of these five numbers wins**, and only ever tightens — a stock's individual risk facts can shrink a position, never enlarge it beyond the cluster default.

### 9.5. Adjustments for the EOD + T+2 reality

| Parameter | Naive assumption | This system's rule | Why |
|---|:---:|:---:|---|
| Default stop width | 7% | 9–10% | Must survive three sessions of normal noise without being swept |
| Risk per trade | 0.5–1.0% of capital | 0.4–0.7% | Compensates for the locked-session tail risk |
| Target holding period | 3–15 sessions | 8–25 sessions | The minimum possible round trip is already 4 sessions |
| Minimum risk-reward | 1.5-to-1 | 2.0-to-1 | A wider stop needs a farther target |
| Concurrent positions | 8–15 | 6–10 | Fewer names, each watched more closely |

---

## 10. SCORING AND PROBABILITY

### 10.1. Technical score (0–100)

A composite score combines six weighted components: setup quality (25%), volume confirmation (20%), the dual relative-strength condition itself (20% — the direct implementation of §4), trend context (15%), sector strength (10%), and foreign-flow confirmation (10%), minus a risk penalty for anomaly flags, overnight-gap history, and proximity to nearby resistance.

**One subtlety that is easy to implement backwards:** volume confirmation flips sign depending on the setup's logic. For a pullback (mean-reversion) setup, the system *wants* to see volume *fall* during the dip — that signals a healthy pause rather than distribution. For a trend or momentum setup, it wants volume to *rise*. Using the same volume-confirmation formula for both types of setup is a business-logic error, not a stylistic choice.

A small seasonal adjustment (±5%) is applied for the pre-Tet window, based on documented above-average returns in the five sessions before the Lunar New Year holiday. **No such adjustment is applied after the holiday** — the documented effect does not extend past it, and rewarding it would be fitting a pattern that isn't there.

### 10.2. Win probability

Before a machine-learning model is trained (requires roughly 200+ historical signals to be trustworthy), win probability is simply the empirically observed hit rate for that specific (setup, cluster) combination from backtesting — and is *not used at all* if fewer than 30 historical examples exist for that combination. Once a model is trained, its probability output is calibrated (not raw model output) so that "0.60" really means roughly 60% historically, and features are limited (~35) and the model kept deliberately simple to resist overfitting on a small, highly cross-correlated universe.

A trade must show at least 55% win probability to pass Gate 5.

---

## 11. TIMING AND ORDER LIFECYCLE

### 11.1. The full timeline

```
Session T,   after close (15:45)  → Signal generated
Session T,   evening               → User reviews and approves/skips
Session T+1, market open (09:00)  → ORDER PLACED — the real entry moment
Session T+1 – T+2                 → Fully locked; nothing can be done
Session T+3, 13:00                → Shares settle
Session T+3, after close          → Exit signal generated, if any
Session T+4, market open          → Sell order placed → fills
```

**Minimum round trip: four sessions. Three of them are fully locked.**

### 11.2. Use limit orders, never market-on-open

Since the market's KRX trading system went live (2025-05-05), opening-auction orders no longer receive matching priority over standing limit orders as they once did. Placing an opening-auction order therefore means accepting whatever price the market happens to open at — precisely the risk this system exists to manage. **Limit orders only, always.**

### 11.3. The morning gap check — an eighth, informal gate

Because the entry price is fixed the evening before but the market can gap significantly overnight, the plan is re-checked the next morning before the order is actually placed:

| Overnight gap vs. signal-day close | Action |
|---|---|
| Up to +1.0% | Place the order exactly as planned |
| +1.0% to the setup's threshold (1.5%–3.0%, tighter for gap-prone setups) | Place at **reduced size** (70%) |
| Beyond the threshold | **Cancel.** The risk-reward math no longer holds — the stop hasn't moved but the entry has |
| Down more than 2.0% | **Pause and review** — check for adverse overnight news before proceeding |
| Opened locked at the daily ceiling | **Cancel** — there are no sellers to trade with |

### 11.4. Why this matters more than it looks

End-of-day execution does not damage every setup equally — it damages **exactly the setups that look most exciting on a chart:**

| Setup character | What happens overnight | Effect on the edge |
|---|---|---|
| Breakout with a volume surge | Everyone sees it at once → the stock gaps up | Severe — buying 2–5% higher while the stop stays where it was |
| A stock locked at its ceiling | Opens locked, no sellers | Cannot be filled at all |
| Buying a quiet pullback | The market's overnight move may work *in the user's favor* | Minimal, sometimes positive |
| Slow trend-following | A session early or late barely changes the outcome | Negligible |

This is exactly why §8 ranks pullback setups above breakout setups, and why "gap and go" is excluded rather than merely deprioritized — the business logic of this system is built around setups that survive a night's delay, not setups that require immediate action.

---

## 12. EXIT RULES

Run every session for every open position, in strict priority order:

1. **Anomaly spike** — if the stock's risk score jumps sharply or crosses 75, exit at the first legal opportunity, without waiting for the stop.
2. **Exit stop breached** — sell the next morning.
3. **Regime turns to `DOWNTREND`** — exit everything, high-risk clusters first.
4. **First target reached** — sell half, move the remainder to a trailing stop.
5. **Trailing stop breached** (only relevant after step 4) — exit the remainder.
6. **Time stop** — if held past the cluster's maximum holding period with negligible profit, exit; capital is being wasted.
7. **Setup thesis broken** — the technical premise that justified the trade (e.g., the moving-average alignment) no longer holds.

**Locked-breach handling is a hard rule, not a judgment call.** If a position breaches its exit stop while still within the three locked sessions, the system logs the event, alerts the user with the current unrealized loss, **blocks all new buy signals until the position is resolved, and absolutely prohibits averaging down.** The position is sold at the first legally possible session — no exceptions, no discretion.

---

## 13. SCOPE DECISION: VN100 AND SMALL-SAMPLE STATISTICS

### 13.1. Why not tune per-stock, and why not scan the whole market

Two scope decisions were deliberately rejected:

- **Per-stock parameter tuning** (one set of thresholds for each of ~100+ individual stocks) is statistically doomed: each stock has only about 5–6 independent market cycles of history, Vietnamese stock returns are documented as highly cross-correlated, and the combined search space would guarantee overfitting to noise that looks excellent in a backtest and fails immediately in practice.
- **Scanning the entire market (~1,600 names across all three exchanges)** was considered and rejected in favor of the VN100 basket, because the operational benefit (a slightly larger candidate pool) is outweighed by the added engineering burden of a much noisier, much less liquid tail of the market, most of which fails the system's own liquidity gate anyway.

### 13.2. The consequence: a 100-stock universe is a small statistical sample

With roughly 100 cross-sectional observations per day, several consequences follow directly, as *business* rules rather than implementation details:

- **A five-rank difference in a percentile ranking (e.g., rank 55 vs. rank 60) is generally not meaningful** — it is well within the noise band. The dual condition therefore should be understood, and eventually implemented, in terms of broader bins (e.g., quintiles) rather than treating every single rank point as meaningful.
- **Cross-sectional rankings are computed against the wider ~350-stock VNAllshare universe, not just VN100 itself** (§5.1), specifically to reduce this noise, while trading decisions remain confined to VN100.
- **Sector-based grouping is too thin to be useful** — with ~100 stocks spread across roughly 15 sectors, several sectors have fewer than five members. This is why the six behavioral clusters (§5.2), not sector labels, are used to make relative comparisons fair.
- **A meaningful number of trading signals per year is small** (an estimated 80–200, to be confirmed from the system's own history), meaning any claimed "hit rate" or "edge" needs several years of accumulated signals — not a good month — before it should be trusted at all.
- **The freed-up computing budget** (100 stocks require negligible processing power) should be spent on making the *existing* conclusions more trustworthy — bootstrapped confidence intervals, more validation folds, ensembles of reasonable parameter choices — rather than on adding more indicators, which would only add more ways to overfit.

---

## 14. PORTFOLIO AND RISK CONSTRAINTS

| Rule | Limit | Rationale |
|---|:---:|---|
| Maximum concurrent positions | 10 | Fewer names, each properly monitored |
| Maximum new signals per day | 3 | More is a symptom of loose thresholds |
| Maximum weight per single stock | 5–15% (cluster-dependent) | See §5.2 for cluster-specific caps |
| Maximum weight per sector | 35% | Diversification floor |
| Maximum weight per owner group | 10–15% (group-dependent) | See §5.3 |
| Maximum concurrent bank-cluster (C2) positions | 2 | Intra-cluster correlation is very high — more is one bet, not two |
| Maximum concurrent volatile mid-cap (C6) positions | 1 | Highest tail risk under the locked-session rule |
| Total open risk across all positions | 5% of NAV | Portfolio-level circuit breaker |
| Margin use on C6 (volatile mid-cap) stocks | **Never** | Combines the worst of leverage with the worst of illiquidity |

---

## 15. COMPLIANCE AND LEGAL CONSTRAINTS

These are business rules, not legal advice, and must be respected in every product decision:

- **This is a personal tool for one user's own trading decisions.** It is not licensed investment advice.
- **Publishing or selling its output as a buy/sell recommendation to other people may constitute unlicensed securities business activity** under Vietnamese securities law (Article 12(4) of the Securities Law prohibits unlicensed securities services). This risk disappears entirely as long as the system stays personal and self-hosted.
- **The underlying free data (from CafeF and similar sources) must not be redistributed, republished, or resold.** Personal analytical use is within the intent of these freely published datasets; building a service on top of them, or sharing the raw or lightly-processed data with others, is not.
- **Every user-facing surface (dashboard pages, exported reports) must carry a compliance disclaimer** stating that outputs are statistical signals for personal research, not investment advice, and that parameters are uncalibrated defaults unless explicitly validated.
- **Anomaly-detection output must never assert wrongdoing.** The system may flag "statistically unusual price/volume patterns"; it must never claim a stock "is being manipulated" — that determination belongs solely to the securities regulator.

---

## 16. PARAMETER REGISTRY

Every numeric threshold in the system belongs to exactly one of four categories. This classification is itself a business rule: it dictates which numbers are allowed to change and under what evidence.

| Tag | Meaning | Who may change it, and how |
|:---:|---|---|
| **[S] Structural** | Fixed by market regulation (price bands, tick sizes, T+2, transaction costs) | Never changed except when the regulation itself changes |
| **[M] Measured** | A computed fact about a specific stock (its beta, its gap history, its liquidity) | Never "tuned" — it is measured, not optimized, and therefore cannot be overfit |
| **[A] Academic** | Grounded in published research specific to this market (the 6-month/1-month dual window, the C3-only momentum exception, the Downtrend abort rule, the no-post-Tet-bonus rule) | Preserved unless a deliberate re-test on fresh data contradicts it |
| **[D] Default** | A reasonable starting guess (score thresholds, risk-per-trade, stop widths, position limits) | **Must be calibrated** through a rigorous validation process before being trusted with real capital |

Selected key values (full registry lives in the technical document):

| Parameter | Tag | Value |
|---|:---:|---|
| Dual condition: 6-month rank minimum | [D] | 60th percentile |
| Dual condition: 1-month rank maximum (mean-reversion) | [D] | 40th percentile |
| Minimum technical score | [D] | 60 / 100 |
| Minimum win probability | [D] | 55% |
| Minimum risk-reward | [D] | 2.0 |
| Risk per trade | [D] | 0.4%–0.7% of NAV |
| Total open risk cap | [D] | 5% of NAV |
| Maximum signals per day | [D] | 3 |
| HOSE daily price band | [S] | ±7% |
| Settlement | [S] | T+2, shares credited by 13:00 |
| 6-month momentum window | [A] | 126 sessions |
| 1-month reversal window | [A] | 20 sessions |

---

## 17. REALISTIC PERFORMANCE EXPECTATIONS

Stated plainly, because overpromising here is a business risk in itself:

| Metric | Achievable | Suspicious | Almost certainly fabricated |
|---|:---:|:---:|:---:|
| Hit rate | 52–58% | 60–65% | > 70% |
| Expectancy per trade | +0.25R to +0.45R | +0.6R | > +1.0R |
| Risk-adjusted return (net of costs) | Modest, positive | Very high | Implausibly high |
| Maximum drawdown | 15–25% | 10% | < 8% |
| Longest losing streak | 6–9 trades | — | "never three losses in a row" |

At a 55% hit rate, +0.35R expectancy, roughly 40 trades a year, and 0.6% of NAV risked per trade, the expected incremental return is on the order of **+8% of NAV per year** — modest, but the point of this system is that it is a validated edge on top of a specific, documented market inefficiency, rather than a number invented to look impressive. Academic research on this exact market's largest, most liquid names concludes it shows no glaring inefficiencies overall, but that for specific stocks — and especially for portfolios — a comparatively simple trend-following approach can deliver attractive risk-adjusted returns, with the important caveat that only relatively modest amounts of capital can exploit this before the edge disappears. That caveat is precisely why a personal account, rather than an institution, is the right size to use it.

---

> ## DISCLAIMER
>
> This document describes the intended behavior of a **personal research tool**. It is not investment advice and not legal advice. Every parameter tagged **[D]** above is an uncalibrated starting value and must be validated against historical data before being trusted with real capital. Past performance of any documented market effect does not guarantee future results. Under this system's end-of-day, T+2 execution model, **three consecutive sessions exist during which an open position cannot be exited under any circumstances**; the worst-case theoretical loss during that window on HOSE is approximately −19.5%.
