"""Build auditable equity features and an automated VN100 market regime."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from itertools import pairwise
from pathlib import Path
from typing import Any

from tintradingos.indicators.core import atr_wilder, relative_strength, rsi_wilder, sma
from tintradingos.signals.engine import (
    Cluster,
    Regime,
    Rejection,
    Signal,
    SignalEngine,
    compute_regime,
)

MIN_OBSERVATIONS = 280
MARKET_MIN_OBSERVATIONS = 200


@dataclass(frozen=True, slots=True)
class RegimeInputs:
    """The dated inputs passed, unchanged, to ``compute_regime``."""

    as_of: date
    vni: dict[str, float]
    equal_weight: dict[str, float]
    breadth: dict[str, float]


@dataclass(frozen=True, slots=True)
class ScanReport:
    as_of: date | None
    universe_size: int
    eligible_count: int
    regime: Regime | None
    regime_inputs: RegimeInputs | None
    signals: tuple[Signal, ...]
    rejections: tuple[Rejection, ...]


def scan_warehouse(
    db_path: str | Path,
    *,
    universe: set[str],
    cluster_by_symbol: dict[str, Cluster],
    nav: Decimal | int | float | str,
    available_cash: Decimal | int | float | str,
    as_of: date | None = None,
) -> ScanReport:
    """Scan one effective-dated VN100 snapshot; market data fails closed."""
    if not universe:
        return ScanReport(None, 0, 0, None, None, (), ())
    rows = _load_rows(db_path, universe, as_of)
    latest = max((date.fromisoformat(row[1]) for row in rows), default=None)
    grouped = _group_rows(rows)
    market, market_error = _market_inputs(db_path, grouped, universe, as_of or latest)
    if market is None:
        rejection = Rejection("VNINDEX", "MARKET_DATA", market_error or "market data is missing")
        return ScanReport(latest, len(universe), 0, None, None, (), (rejection,))
    regime = compute_regime(market.vni, market.equal_weight, market.breadth)
    reference = _equal_weight_reference(grouped, universe)
    candidates: list[dict[str, Any]] = []
    rejections: list[Rejection] = []
    eligible_count = 0
    pending: list[tuple[str, str, dict[str, Any]]] = []
    for symbol in sorted(universe):
        if symbol not in cluster_by_symbol:
            rejections.append(Rejection(symbol, "DATA_MISSING", "cluster assignment is missing"))
            continue
        bars = grouped.get(symbol, [])
        if len(bars) < MIN_OBSERVATIONS:
            rejections.append(
                Rejection(symbol, "G1", f"only {len(bars)} observations; need {MIN_OBSERVATIONS}")
            )
            continue
        features = _features(bars, reference)
        eligible_count += 1
        pending.append((symbol, bars[-1][1], features))
    rs126_values = [features["rs126"] for _, _, features in pending]
    rs20_values = [features["rs20"] for _, _, features in pending]
    for symbol, exchange, features in pending:
        features["rs126_rank"] = _percentile_rank(features["rs126"], rs126_values)
        features["rs20_rank"] = _percentile_rank(features["rs20"], rs20_values)
        features.pop("rs126")
        features.pop("rs20")
        candidates.append(
            {
                "symbol": symbol,
                "exchange": exchange,
                "cluster": cluster_by_symbol[symbol].value,
                "features": features,
            }
        )
    engine = SignalEngine(nav=nav, available_cash=available_cash)
    signals = engine.run(
        market.as_of,
        regime,
        candidates,
        {"held_symbols": set(), "positions": [], "max_positions": 10, "max_signals": 3},
    )
    return ScanReport(
        market.as_of,
        len(universe),
        eligible_count,
        regime,
        market,
        tuple(signals),
        tuple(rejections + engine.rejections),
    )


def _market_inputs(
    db_path: str | Path, grouped: dict[str, list[tuple]], universe: set[str], as_of: date | None
) -> tuple[RegimeInputs | None, str | None]:
    if as_of is None:
        return None, "no equity session is available"
    if set(grouped) != universe:
        return None, "active VN100 snapshot has missing RAW equity history"
    histories = [grouped[symbol] for symbol in universe]
    common_dates = sorted(set.intersection(*(set(bar[0] for bar in bars) for bars in histories)))
    if len(common_dates) < MARKET_MIN_OBSERVATIONS or common_dates[-1] != as_of:
        return None, "active VN100 history lacks 200 common sessions through the requested date"
    closes_by_symbol = {
        symbol: {bar[0]: bar[2] for bar in bars} for symbol, bars in grouped.items()
    }
    common_dates = common_dates[-MARKET_MIN_OBSERVATIONS:]
    equal_close = _equal_weight_index(closes_by_symbol, sorted(universe), common_dates)
    vni_rows = _load_vni_rows(db_path, as_of)
    if len(vni_rows) < MARKET_MIN_OBSERVATIONS or vni_rows[-1][0] != as_of:
        return None, "VN-Index EOD history lacks 200 sessions through the requested date"
    vni_close = [row[1] for row in vni_rows[-MARKET_MIN_OBSERVATIONS:]]
    breadth = _breadth(closes_by_symbol, sorted(universe), common_dates)
    return RegimeInputs(
        as_of, _index_metrics(vni_close), _index_metrics(equal_close), breadth
    ), None


def _load_vni_rows(db_path: str | Path, as_of: date) -> list[tuple[date, float]]:
    if not Path(db_path).exists():
        return []
    connection = sqlite3.connect(db_path)
    try:
        try:
            rows = connection.execute(
                "SELECT trading_date, close FROM index_eod "
                "WHERE index_code = 'VNINDEX' AND trading_date <= ? "
                "ORDER BY trading_date",
                (as_of.isoformat(),),
            ).fetchall()
        except sqlite3.OperationalError:
            return []
    finally:
        connection.close()
    return [(date.fromisoformat(day), float(close)) for day, close in rows]


def _index_metrics(closes: list[float]) -> dict[str, float]:
    return {"close": closes[-1], "ma50": sma(closes, 50)[-1], "ma200": sma(closes, 200)[-1]}


def _equal_weight_index(
    closes: dict[str, dict[date, float]], symbols: list[str], days: list[date]
) -> list[float]:
    levels = [1000.0]
    for previous, current in pairwise(days):
        daily_return = sum(
            closes[symbol][current] / closes[symbol][previous] - 1 for symbol in symbols
        ) / len(symbols)
        levels.append(levels[-1] * (1 + daily_return))
    return levels


def _breadth(
    closes: dict[str, dict[date, float]], symbols: list[str], days: list[date]
) -> dict[str, float]:
    advances_minus_declines = []
    for previous, current in pairwise(days):
        advances_minus_declines.append(
            sum(
                (closes[symbol][current] > closes[symbol][previous])
                - (closes[symbol][current] < closes[symbol][previous])
                for symbol in symbols
            )
        )
    ad_line = [0]
    for value in advances_minus_declines:
        ad_line.append(ad_line[-1] + value)
    above = sum(
        closes[symbol][days[-1]] > sma([closes[symbol][day] for day in days], 50)[-1]
        for symbol in symbols
    )
    return {
        "pct_above_ma50": above / len(symbols),
        "ad_line_slope_10": _linear_slope(ad_line[-10:]),
    }


def _linear_slope(values: list[int]) -> float:
    mean_x = (len(values) - 1) / 2
    mean_y = sum(values) / len(values)
    return sum((index - mean_x) * (value - mean_y) for index, value in enumerate(values)) / sum(
        (index - mean_x) ** 2 for index in range(len(values))
    )


def _load_rows(db_path: str | Path, universe: set[str], as_of: date | None) -> list[tuple]:
    if not Path(db_path).exists():
        return []
    placeholders = ",".join("?" for _ in universe)
    query = (
        "SELECT symbol, trading_date, exchange, close_vnd, high_vnd, low_vnd, volume "
        "FROM ohlcv WHERE basis = 'RAW' AND symbol IN (" + placeholders + ")"
    )
    parameters: list[Any] = list(sorted(universe))
    if as_of is not None:
        query += " AND trading_date <= ?"
        parameters.append(as_of.isoformat())
    query += " ORDER BY symbol, trading_date"
    connection = sqlite3.connect(db_path)
    try:
        return connection.execute(query, parameters).fetchall()
    finally:
        connection.close()


def _group_rows(rows: list[tuple]) -> dict[str, list[tuple]]:
    grouped: dict[str, list[tuple]] = {}
    for symbol, trading_date, exchange, close, high, low, volume in rows:
        grouped.setdefault(symbol, []).append(
            (
                date.fromisoformat(trading_date),
                exchange,
                float(close),
                float(high),
                float(low),
                int(volume),
            )
        )
    return grouped


def _equal_weight_reference(grouped: dict[str, list[tuple]], universe: set[str]) -> list[float]:
    histories = [bars for symbol, bars in grouped.items() if symbol in universe]
    if not histories:
        return []
    common_dates = sorted(set.intersection(*(set(bar[0] for bar in bars) for bars in histories)))
    return [
        sum(next(bar[2] for bar in bars if bar[0] == day) for bars in histories) / len(histories)
        for day in common_dates
    ]


def _features(bars: list[tuple], reference: list[float]) -> dict[str, Any]:
    close, high, low, volume = ([bar[index] for bar in bars] for index in (2, 3, 4, 5))
    ma20, ma50, ma200 = sma(close, 20)[-1], sma(close, 50)[-1], sma(close, 200)[-1]
    turnover = [price * qty for price, qty in zip(close[-20:], volume[-20:], strict=True)]
    return {
        "n_obs": len(close),
        "adv20_bn": sum(turnover) / len(turnover) / 1_000_000_000,
        "anomaly_score": 0,
        "rs126": relative_strength(close, reference, 126) if len(reference) == len(close) else 0.0,
        "rs20": relative_strength(close, reference, 20) if len(reference) == len(close) else 0.0,
        "ma20": ma20,
        "ma50": ma50,
        "ma200": ma200,
        "ma_slope50": ma50 / sma(close, 50)[-11] - 1,
        "close": close[-1],
        "dist_ma20": close[-1] / ma20 - 1,
        "rsi14": rsi_wilder(close, 14)[-1],
        "vol_ratio_3": sum(volume[-3:]) / 3 / (sum(volume[-20:]) / 20),
        "vol_ratio": volume[-1] / (sum(volume[-20:]) / 20),
        "trigger_candle": close[-1] > close[-2],
        "atr14": atr_wilder(high, low, close, 14)[-1],
        "structure_low": min(low[-10:]),
        "technical_score": 60,
        "win_probability": None,
    }


def _percentile_rank(value: float, population: list[float]) -> float:
    return 100.0 * sum(item <= value for item in population) / len(population)
