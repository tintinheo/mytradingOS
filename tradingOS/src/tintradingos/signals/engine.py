"""Feature-driven, paper-only signal engine for Vietnam equities.

The engine deliberately consumes precomputed features. It does not infer
unverified CCNN semantics, DATR, corporate-action types, or VN100 membership.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Any

from tintradingos.domain.market_rules import (
    PRICE_BANDS,
    ROUND_LOT_SHARES,
    Exchange,
    round_down_to_tick,
)


class Regime(StrEnum):
    STRONG_UPTREND = "STRONG_UPTREND"
    UPTREND = "UPTREND"
    SIDEWAY = "SIDEWAY"
    MILD_CORRECTION = "MILD_CORRECTION"
    DOWNTREND = "DOWNTREND"


class Cluster(StrEnum):
    C1_MEGA = "C1_MEGA"
    C2_BANK = "C2_BANK"
    C3_HIGH_BETA = "C3_HIGH_BETA"
    C4_COMMODITY = "C4_COMMODITY"
    C5_DEFENSIVE = "C5_DEFENSIVE"
    C6_VOLATILE = "C6_VOLATILE"
    EXCLUDED = "EXCLUDED"


REGIME_RANK = {
    Regime.DOWNTREND: 0,
    Regime.MILD_CORRECTION: 1,
    Regime.SIDEWAY: 2,
    Regime.UPTREND: 3,
    Regime.STRONG_UPTREND: 4,
}

REGIME_FACTOR = {
    Regime.DOWNTREND: Decimal("0"),
    Regime.MILD_CORRECTION: Decimal("0.40"),
    Regime.SIDEWAY: Decimal("0.65"),
    Regime.UPTREND: Decimal("0.85"),
    Regime.STRONG_UPTREND: Decimal("1.00"),
}


@dataclass(frozen=True, slots=True)
class ClusterParams:
    max_anomaly_score: Decimal
    max_gap_pct: Decimal
    max_stop_pct: Decimal
    atr_mult: Decimal
    max_weight_pct: Decimal
    min_volume_ratio: Decimal
    min_regime: Regime
    premium: Decimal


PARAMS: dict[Cluster, ClusterParams] = {
    Cluster.C1_MEGA: ClusterParams(
        Decimal("55"),
        Decimal("0.020"),
        Decimal("0.09"),
        Decimal("3.0"),
        Decimal("0.12"),
        Decimal("1.3"),
        Regime.SIDEWAY,
        Decimal("0.005"),
    ),
    Cluster.C2_BANK: ClusterParams(
        Decimal("55"),
        Decimal("0.020"),
        Decimal("0.09"),
        Decimal("3.0"),
        Decimal("0.10"),
        Decimal("1.3"),
        Regime.SIDEWAY,
        Decimal("0.005"),
    ),
    Cluster.C3_HIGH_BETA: ClusterParams(
        Decimal("50"),
        Decimal("0.030"),
        Decimal("0.12"),
        Decimal("4.0"),
        Decimal("0.08"),
        Decimal("1.5"),
        Regime.STRONG_UPTREND,
        Decimal("0.008"),
    ),
    Cluster.C4_COMMODITY: ClusterParams(
        Decimal("55"),
        Decimal("0.025"),
        Decimal("0.10"),
        Decimal("3.5"),
        Decimal("0.10"),
        Decimal("1.3"),
        Regime.SIDEWAY,
        Decimal("0.005"),
    ),
    Cluster.C5_DEFENSIVE: ClusterParams(
        Decimal("60"),
        Decimal("0.015"),
        Decimal("0.07"),
        Decimal("2.5"),
        Decimal("0.15"),
        Decimal("1.1"),
        Regime.MILD_CORRECTION,
        Decimal("0.005"),
    ),
    Cluster.C6_VOLATILE: ClusterParams(
        Decimal("40"),
        Decimal("0.020"),
        Decimal("0.12"),
        Decimal("4.0"),
        Decimal("0.05"),
        Decimal("1.5"),
        Regime.STRONG_UPTREND,
        Decimal("0.005"),
    ),
}


@dataclass(frozen=True, slots=True)
class Rejection:
    symbol: str
    gate: str
    reason: str


@dataclass(frozen=True, slots=True)
class Signal:
    generated_at: date
    symbol: str
    exchange: Exchange
    cluster: Cluster
    setup: str
    close_t: Decimal
    entry: Decimal
    exit_stop: Decimal
    sizing_stop: Decimal
    target_1: Decimal
    target_2: Decimal
    quantity: int
    technical_score: Decimal
    win_probability: Decimal | None
    risk_reward: Decimal
    uncalibrated: bool = True
    reasons: dict[str, Any] = field(default_factory=dict)

    @property
    def notional(self) -> Decimal:
        return self.entry * self.quantity

    @property
    def risk_at_sizing_stop(self) -> Decimal:
        return (self.entry - self.sizing_stop) * self.quantity


def compute_regime(
    vni: dict[str, float], equal_weight: dict[str, float], breadth: dict[str, float]
) -> Regime:
    """Use the lower index score when VN-Index and equal-weight index diverge."""

    def score(index: dict[str, float]) -> int:
        return (
            int(index["close"] > index["ma50"])
            + int(index["close"] > index["ma200"])
            + int(index["ma50"] > index["ma200"])
        )

    index_score = min(score(vni), score(equal_weight))
    pct_above_ma50 = breadth["pct_above_ma50"]
    ad_slope = breadth["ad_line_slope_10"]
    if index_score == 3 and pct_above_ma50 >= 0.60 and ad_slope > 0:
        return Regime.STRONG_UPTREND
    if index_score >= 2 and pct_above_ma50 >= 0.45:
        return Regime.UPTREND
    if index_score >= 1 and pct_above_ma50 >= 0.35:
        return Regime.SIDEWAY
    if index_score >= 1 or pct_above_ma50 >= 0.25:
        return Regime.MILD_CORRECTION
    return Regime.DOWNTREND


class SignalEngine:
    """Generate paper-only signals from a validated feature snapshot."""

    def __init__(
        self, *, nav: Decimal | int | float | str, available_cash: Decimal | int | float | str
    ) -> None:
        self.nav = _positive_decimal(nav, "nav")
        self.available_cash = _positive_decimal(available_cash, "available_cash")
        self.rejections: list[Rejection] = []

    def run(
        self,
        as_of: date,
        regime: Regime,
        candidates: list[dict[str, Any]],
        portfolio: dict[str, Any],
    ) -> list[Signal]:
        self.rejections.clear()
        if regime is Regime.DOWNTREND:
            for candidate in candidates:
                self._reject(candidate.get("symbol", "?"), "G0", "DOWNTREND blocks all buys")
            return []
        signals = [
            signal
            for candidate in candidates
            if (signal := self._evaluate(as_of, regime, candidate, portfolio))
        ]
        signals.sort(
            key=lambda signal: (signal.technical_score, signal.win_probability or Decimal("0")),
            reverse=True,
        )
        return signals[: int(portfolio.get("max_signals", 3))]

    def _evaluate(
        self, as_of: date, regime: Regime, candidate: dict[str, Any], portfolio: dict[str, Any]
    ) -> Signal | None:
        symbol = str(candidate.get("symbol", "?"))
        try:
            features = candidate["features"]
            cluster = Cluster(candidate["cluster"])
            exchange = Exchange(candidate["exchange"])
        except (KeyError, ValueError, TypeError) as exc:
            self._reject(symbol, "DATA", f"invalid candidate contract: {exc}")
            return None
        params = PARAMS.get(cluster)
        if params is None or cluster is Cluster.EXCLUDED:
            self._reject(symbol, "G1", "cluster is excluded or unsupported")
            return None
        if features.get("n_obs", 0) < 280 or features.get("adv20_bn", 0) < 20:
            self._reject(symbol, "G1", "insufficient history or liquidity")
            return None
        if _decimal(features.get("anomaly_score", 100)) >= params.max_anomaly_score:
            self._reject(symbol, "G2", "anomaly score exceeds cluster limit")
            return None
        if REGIME_RANK[regime] < REGIME_RANK[params.min_regime]:
            self._reject(symbol, "G3", f"regime {regime} below {params.min_regime}")
            return None
        if cluster is Cluster.C3_HIGH_BETA:
            self._reject(symbol, "G3", "C3 momentum setup is not enabled in this phase")
            return None
        if (
            _decimal(features.get("rs126_rank", 0)) < 60
            or _decimal(features.get("rs20_rank", 100)) > 40
        ):
            self._reject(symbol, "G4", "dual relative-strength condition failed")
            return None
        if not self._pullback_ma20(features, params):
            self._reject(symbol, "G4", "PB_MA20 setup failed")
            return None
        if symbol in portfolio.get("held_symbols", set()):
            self._reject(symbol, "G6", "symbol already held")
            return None
        if len(portfolio.get("positions", [])) >= portfolio.get("max_positions", 10):
            self._reject(symbol, "G6", "maximum open positions reached")
            return None
        return self._build_signal(as_of, regime, symbol, exchange, cluster, params, features)

    @staticmethod
    def _pullback_ma20(features: dict[str, Any], params: ClusterParams) -> bool:
        return (
            _decimal(features["ma20"]) > _decimal(features["ma50"]) > _decimal(features["ma200"])
            and _decimal(features["ma_slope50"]) > 0
            and _decimal(features["close"]) > _decimal(features["ma200"]) * Decimal("1.02")
            and Decimal("-0.04") <= _decimal(features["dist_ma20"]) <= Decimal("0.02")
            and _decimal(features["rsi14"]) < Decimal("45")
            and _decimal(features["vol_ratio_3"]) < Decimal("1.10")
            and _decimal(features["vol_ratio"]) >= params.min_volume_ratio
            and bool(features.get("trigger_candle", False))
        )

    def _build_signal(
        self,
        as_of: date,
        regime: Regime,
        symbol: str,
        exchange: Exchange,
        cluster: Cluster,
        params: ClusterParams,
        features: dict[str, Any],
    ) -> Signal | None:
        close = _decimal(features["close"])
        atr = _positive_decimal(features["atr14"], "atr14")
        structure_low = _positive_decimal(features["structure_low"], "structure_low")
        entry = round_down_to_tick(close * (Decimal(1) + params.premium), exchange)
        ceiling = round_down_to_tick(close * (Decimal(1) + PRICE_BANDS[exchange]), exchange)
        if entry >= ceiling * Decimal("0.995"):
            self._reject(symbol, "G5", "entry is too close to daily ceiling")
            return None
        exit_stop = round_down_to_tick(
            max(structure_low - Decimal("0.5") * atr, entry * (Decimal(1) - params.max_stop_pct)),
            exchange,
        )
        sizing_stop = round_down_to_tick(
            min(
                entry - params.atr_mult * atr,
                entry * (Decimal(1) - params.max_stop_pct * Decimal("1.25")),
            ),
            exchange,
        )
        risk = entry - exit_stop
        sizing_risk = entry - sizing_stop
        if risk <= 0 or sizing_risk <= 0 or risk / atr < Decimal("0.8"):
            self._reject(symbol, "G5", "invalid stop geometry")
            return None
        target_1 = round_down_to_tick(entry + Decimal("2.0") * risk, exchange)
        target_2 = round_down_to_tick(entry + Decimal("3.5") * risk, exchange)
        if "technical_score" not in features:
            self._reject(symbol, "G5", "technical_score is missing")
            return None
        score = _decimal(features["technical_score"])
        probability = _optional_decimal(features.get("win_probability"))
        if score < 60 or (probability is not None and probability < Decimal("0.55")):
            self._reject(symbol, "G5", "score or probability below threshold")
            return None
        risk_budget = self.nav * Decimal("0.006") * REGIME_FACTOR[regime]
        qty_by_risk = risk_budget / sizing_risk
        qty_by_weight = self.nav * params.max_weight_pct / entry
        qty_by_liquidity = (
            _decimal(features["adv20_bn"]) * Decimal("1000000000") * Decimal("0.03") / entry
        )
        qty_by_cash = self.available_cash / entry
        quantity = int(
            min(qty_by_risk, qty_by_weight, qty_by_liquidity, qty_by_cash)
            // ROUND_LOT_SHARES
            * ROUND_LOT_SHARES
        )
        if quantity <= 0 or entry * quantity < Decimal("10000000"):
            self._reject(symbol, "G6", "position is below minimum viable size")
            return None
        risk_reward = (target_1 - entry) / risk
        if risk_reward < Decimal("2.0"):
            self._reject(symbol, "G5", "risk-reward below 2.0 after tick rounding")
            return None
        return Signal(
            as_of,
            symbol,
            exchange,
            cluster,
            "PB_MA20",
            close,
            entry,
            exit_stop,
            sizing_stop,
            target_1,
            target_2,
            quantity,
            score,
            probability,
            risk_reward,
            True,
            {"regime": regime.value, "dual_rs": True},
        )

    def _reject(self, symbol: str, gate: str, reason: str) -> None:
        self.rejections.append(Rejection(symbol, gate, reason))


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"invalid numeric feature: {value!r}") from exc


def _positive_decimal(value: Any, name: str) -> Decimal:
    result = _decimal(value)
    if not result.is_finite() or result <= 0:
        raise ValueError(f"{name} must be positive")
    return result


def _optional_decimal(value: Any) -> Decimal | None:
    return None if value is None else _decimal(value)
