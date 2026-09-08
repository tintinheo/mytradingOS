"""Build a small, auditable feature snapshot from the local SQLite warehouse.

This is deliberately not a VN100 classifier. Membership and cluster assignment
must be supplied by a dated external contract; missing metadata is reported as
DATA_MISSING rather than inferred from ticker names.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

from tintradingos.indicators.core import atr_wilder, relative_strength, rsi_wilder, sma
from tintradingos.signals.engine import Cluster, Regime, Rejection, Signal, SignalEngine

MIN_OBSERVATIONS = 280


@dataclass(frozen=True, slots=True)
class ScanReport:
    as_of: date | None
    universe_size: int
    eligible_count: int
    signals: tuple[Signal, ...]
    rejections: tuple[Rejection, ...]


def scan_warehouse(
    db_path: str | Path,
    *,
    universe: set[str],
    cluster_by_symbol: dict[str, Cluster],
    nav: Decimal | int | float | str,
    available_cash: Decimal | int | float | str,
    regime: Regime,
    as_of: date | None = None,
) -> ScanReport:
    """Scan an explicitly supplied universe using persisted raw OHLCV."""
    if not universe:
        return ScanReport(None, 0, 0, (), ())
    rows = _load_rows(db_path, universe, as_of)
    latest = max((row[1] for row in rows), default=None)
    grouped = _group_rows(rows)
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
        latest or date.today(),
        regime,
        candidates,
        {"held_symbols": set(), "positions": [], "max_positions": 10, "max_signals": 3},
    )
    return ScanReport(
        latest, len(universe), eligible_count, tuple(signals), tuple(rejections + engine.rejections)
    )


def _load_rows(db_path: str | Path, universe: set[str], as_of: date | None) -> list[tuple]:
    if not Path(db_path).exists():
        return []
    placeholders = ",".join("?" for _ in universe)
    query = (
        "SELECT symbol, trading_date, exchange, close_vnd, high_vnd, low_vnd, volume "
        f"FROM ohlcv WHERE basis = 'RAW' AND symbol IN ({placeholders})"
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
    close = [bar[2] for bar in bars]
    high = [bar[3] for bar in bars]
    low = [bar[4] for bar in bars]
    volume = [bar[5] for bar in bars]
    ma20 = sma(close, 20)[-1]
    ma50 = sma(close, 50)[-1]
    ma200 = sma(close, 200)[-1]
    rsi14 = rsi_wilder(close, 14)[-1]
    atr14 = atr_wilder(high, low, close, 14)[-1]
    rs126 = relative_strength(close, reference, 126) if len(reference) == len(close) else 0.0
    turnover = [price * qty for price, qty in zip(close[-20:], volume[-20:], strict=True)]
    return {
        "n_obs": len(close),
        "adv20_bn": sum(turnover) / len(turnover) / 1_000_000_000,
        "anomaly_score": 0,
        "rs126": rs126,
        "rs20": relative_strength(close, reference, 20) if len(reference) == len(close) else 0.0,
        "ma20": ma20,
        "ma50": ma50,
        "ma200": ma200,
        "ma_slope50": (ma50 / sma(close, 50)[-11] - 1) if len(close) >= 60 else 0,
        "close": close[-1],
        "dist_ma20": close[-1] / ma20 - 1,
        "rsi14": rsi14,
        "vol_ratio_3": sum(volume[-3:]) / 3 / (sum(volume[-20:]) / 20),
        "vol_ratio": volume[-1] / (sum(volume[-20:]) / 20),
        "trigger_candle": close[-1] > close[-2],
        "atr14": atr14,
        "structure_low": min(low[-10:]),
        "technical_score": 60,
        "win_probability": None,
    }


def _percentile_rank(value: float, population: list[float]) -> float:
    return 100.0 * sum(item <= value for item in population) / len(population)
