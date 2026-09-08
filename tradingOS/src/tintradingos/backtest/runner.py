"""Point-in-time, execution-aware runner for EOD research backtests.

The runner deliberately keeps signal generation (close of T) separate from
execution (the following market session).  It reads only RAW OHLCV for orders;
adjusted prices may coexist in the warehouse but are never tradable quotes.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

from tintradingos.backtest.execution import FillPolicy, FillReason, simulate_limit_entry
from tintradingos.domain.market_rules import (
    SETTLEMENT_SESSION_OFFSET,
    MarketPrice,
    settlement_session_index,
)
from tintradingos.reference.vn100 import VN100Snapshot
from tintradingos.scanner.warehouse import ScanReport, scan_warehouse
from tintradingos.signals.engine import PARAMS, Regime, Signal


@dataclass(frozen=True, slots=True)
class BrokerCosts:
    """Broker charges effective from a session, expressed as fractions of notional."""

    effective_from: date
    buy_commission: Decimal
    sell_commission: Decimal
    sell_tax: Decimal = Decimal("0")

    def __post_init__(self) -> None:
        for name in ("buy_commission", "sell_commission", "sell_tax"):
            value = Decimal(str(getattr(self, name)))
            if not Decimal("0") <= value < Decimal("1"):
                raise ValueError(f"{name} must be in [0, 1)")
            object.__setattr__(self, name, value)


@dataclass(frozen=True, slots=True)
class BacktestConfig:
    nav: Decimal
    available_cash: Decimal
    regime: Regime
    premium_override: Decimal | None = None
    max_gap: Decimal = Decimal("0.02")
    fill_policy: FillPolicy = FillPolicy.TRADE_THROUGH_CONSERVATIVE
    exit_after_sessions: int = SETTLEMENT_SESSION_OFFSET

    def __post_init__(self) -> None:
        object.__setattr__(self, "nav", Decimal(str(self.nav)))
        object.__setattr__(self, "available_cash", Decimal(str(self.available_cash)))
        object.__setattr__(self, "max_gap", Decimal(str(self.max_gap)))
        if self.premium_override is not None:
            object.__setattr__(self, "premium_override", Decimal(str(self.premium_override)))
        if self.nav <= 0 or self.available_cash <= 0:
            raise ValueError("nav and available_cash must be positive")
        if not Decimal("0") <= self.max_gap < Decimal("1"):
            raise ValueError("max_gap must be in [0, 1)")
        if self.exit_after_sessions < SETTLEMENT_SESSION_OFFSET:
            raise ValueError("exit_after_sessions cannot precede T+2 settlement")


@dataclass(frozen=True, slots=True)
class TradeResult:
    symbol: str
    signal_date: date
    entry_date: date
    quantity: int
    status: str
    fill_reason: FillReason
    entry_price_vnd: Decimal | None
    entry_fee_vnd: Decimal
    settlement_date: date | None
    exit_date: date | None = None
    exit_price_vnd: Decimal | None = None
    exit_fee_vnd: Decimal = Decimal("0")
    realized_pnl_vnd: Decimal | None = None


@dataclass(frozen=True, slots=True)
class BacktestArtifact:
    assumptions: dict[str, object]
    source_dates: tuple[date, ...]
    trades: tuple[TradeResult, ...]

    def to_dict(self) -> dict[str, object]:
        """Return JSON-safe, structured research output."""

        def convert(value: object) -> object:
            if isinstance(value, (date, Decimal)):
                return str(value)
            if isinstance(value, tuple):
                return [convert(item) for item in value]
            if isinstance(value, dict):
                return {key: convert(item) for key, item in value.items()}
            return value

        return convert(asdict(self))  # type: ignore[return-value]

    def write_json(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True) + "\n")


def run_backtest(
    db_path: str | Path,
    *,
    snapshots: Iterable[VN100Snapshot],
    costs: Iterable[BrokerCosts],
    config: BacktestConfig,
    scanner: Callable[..., ScanReport] = scan_warehouse,
) -> BacktestArtifact:
    """Run dated snapshots without future membership or price look-ahead.

    One scan is made for each supplied membership session.  Scanner history is
    capped at that same date and an order from a signal may only inspect the
    next actual RAW trading session.
    """
    by_date = {snapshot.as_of: snapshot for snapshot in snapshots}
    cost_schedule = sorted(costs, key=lambda item: item.effective_from)
    if not cost_schedule:
        raise ValueError("at least one effective-dated BrokerCosts entry is required")
    sessions = _raw_sessions(db_path)
    source_dates = tuple(sorted(by_date))
    results: list[TradeResult] = []
    open_positions: list[tuple[TradeResult, int]] = []

    for session_index, session in enumerate(sessions):
        # Close only after settlement; this prevents impossible same-day/T+1 exits.
        survivors: list[tuple[TradeResult, int]] = []
        for trade, due_index in open_positions:
            if session_index < due_index:
                survivors.append((trade, due_index))
                continue
            bar = _raw_bar(db_path, trade.symbol, session)
            if bar is None:
                survivors.append((trade, due_index))
                continue
            sell_cost = _cost_for(cost_schedule, session)
            gross = bar["open"] * trade.quantity
            fee = gross * (sell_cost.sell_commission + sell_cost.sell_tax)
            basis = trade.entry_price_vnd * trade.quantity + trade.entry_fee_vnd  # type: ignore[operator]
            results[results.index(trade)] = TradeResult(
                **(
                    asdict(trade)
                    | {
                        "status": "CLOSED",
                        "exit_date": session,
                        "exit_price_vnd": bar["open"],
                        "exit_fee_vnd": fee,
                        "realized_pnl_vnd": gross - fee - basis,
                    }
                )
            )
        open_positions = survivors

        snapshot = by_date.get(session)
        if snapshot is None or session_index + 1 >= len(sessions):
            continue
        # Membership from this dated snapshot is the *only* scanner universe.
        report = scanner(
            db_path,
            universe=set(snapshot.symbols),
            cluster_by_symbol=snapshot.cluster_by_symbol,
            nav=config.nav,
            available_cash=config.available_cash,
            regime=config.regime,
            as_of=session,
        )
        next_session = sessions[session_index + 1]
        for signal in report.signals:
            already_open = any(t.symbol == signal.symbol for t, _ in open_positions)
            if signal.symbol not in snapshot.symbols or already_open:
                continue
            bar = _raw_bar(db_path, signal.symbol, next_session)
            if bar is None:
                results.append(_no_fill(signal, next_session, FillReason.LIMIT_NOT_REACHED))
                continue
            premium = (
                config.premium_override
                if config.premium_override is not None
                else PARAMS[signal.cluster].premium
            )
            # No next-day close/reference field is available in this warehouse.
            # Use a T-known band estimate, rather than leaking T+1 close data.
            from tintradingos.domain.market_rules import daily_price_limits

            ceiling = daily_price_limits(signal.close_t, signal.exchange)[1]
            fill = simulate_limit_entry(
                signal_close=MarketPrice.raw(signal.close_t),
                next_open=MarketPrice.raw(bar["open"]),
                next_high=MarketPrice.raw(bar["high"]),
                next_low=MarketPrice.raw(bar["low"]),
                next_ceiling=MarketPrice.raw(ceiling),
                exchange=signal.exchange,
                premium=premium,
                max_gap=config.max_gap,
                fill_policy=config.fill_policy,
            )
            if not fill.filled:
                results.append(_no_fill(signal, next_session, fill.reason))
                continue
            buy_cost = _cost_for(cost_schedule, next_session)
            fee = fill.price_vnd * signal.quantity * buy_cost.buy_commission  # type: ignore[operator]
            settlement_index = settlement_session_index(session_index + 1)
            settlement = sessions[settlement_index] if settlement_index < len(sessions) else None
            trade = TradeResult(
                signal.symbol,
                session,
                next_session,
                signal.quantity,
                "OPEN",
                fill.reason,
                fill.price_vnd,
                fee,
                settlement,
            )
            results.append(trade)
            open_positions.append((trade, session_index + 1 + config.exit_after_sessions))

    return BacktestArtifact(
        {
            "fill_policy": config.fill_policy.value,
            "signal_timing": "close T",
            "entry_timing": "T+1",
            "price_basis": "RAW",
            "settlement": "T+2",
            "broker_cost_schedule": [asdict(item) for item in cost_schedule],
            "next_ceiling": "derived from T raw close; no T+1 close used",
        },
        source_dates,
        tuple(results),
    )


def _no_fill(signal: Signal, entry_date: date, reason: FillReason) -> TradeResult:
    return TradeResult(
        signal.symbol,
        signal.generated_at,
        entry_date,
        signal.quantity,
        "NO_FILL",
        reason,
        None,
        Decimal("0"),
        None,
    )


def _cost_for(schedule: list[BrokerCosts], on_date: date) -> BrokerCosts:
    eligible = [item for item in schedule if item.effective_from <= on_date]
    if not eligible:
        raise ValueError(f"no broker cost configuration effective on {on_date.isoformat()}")
    return eligible[-1]


def _raw_sessions(db_path: str | Path) -> list[date]:
    with sqlite3.connect(db_path) as connection:
        return [
            date.fromisoformat(row[0])
            for row in connection.execute(
                "SELECT DISTINCT trading_date FROM ohlcv WHERE basis = 'RAW' ORDER BY trading_date"
            )
        ]


def _raw_bar(db_path: str | Path, symbol: str, session: date) -> dict[str, Decimal] | None:
    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT open_vnd, high_vnd, low_vnd, close_vnd FROM ohlcv "
            "WHERE symbol = ? AND trading_date = ? AND basis = 'RAW'",
            (symbol, session.isoformat()),
        ).fetchone()
    if row is None:
        return None
    open_, high, low, close = map(Decimal, row[:4])
    return {"open": open_, "high": high, "low": low, "close": close}
