# ruff: noqa: E501
"""Source-backed, effective-dated market data contracts.

These records deliberately distinguish an observed ``NONE`` corporate-action
status from no record at all.  The latter is unknown and must not be treated as
safe for an execution simulation.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from pathlib import Path

from tintradingos.domain.market_rules import Exchange


class CorporateActionType(StrEnum):
    NONE = "NONE"
    CASH_DIVIDEND = "CASH_DIVIDEND"
    STOCK_DIVIDEND = "STOCK_DIVIDEND"
    RIGHTS_ISSUE = "RIGHTS_ISSUE"
    SPLIT = "SPLIT"
    OTHER = "OTHER"


@dataclass(frozen=True, slots=True)
class SourceEvidence:
    source_url: str
    retrieved_at: datetime
    published_at: datetime | None = None
    source_reference: str | None = None

    def __post_init__(self) -> None:
        if not self.source_url.strip():
            raise ValueError("source_url is required")
        if self.published_at and self.published_at > self.retrieved_at:
            raise ValueError("published_at cannot be after retrieved_at")


@dataclass(frozen=True, slots=True)
class CorporateAction:
    symbol: str
    ex_date: date
    action_type: CorporateActionType
    evidence: SourceEvidence
    effective_from: date
    effective_to: date | None = None

    def __post_init__(self) -> None:
        _symbol(self.symbol)
        _interval(self.effective_from, self.effective_to)
        if not self.effective_from <= self.ex_date and (
            self.effective_to is None or self.ex_date <= self.effective_to
        ):
            raise ValueError("ex_date must be inside the effective interval")


@dataclass(frozen=True, slots=True)
class TradingSession:
    exchange: Exchange
    session_date: date
    is_trading_session: bool
    evidence: SourceEvidence


@dataclass(frozen=True, slots=True)
class ReferencePrice:
    symbol: str
    exchange: Exchange
    session_date: date
    reference_price_vnd: Decimal
    floor_price_vnd: Decimal
    ceiling_price_vnd: Decimal
    evidence: SourceEvidence

    def __post_init__(self) -> None:
        _symbol(self.symbol)
        for name in ("reference_price_vnd", "floor_price_vnd", "ceiling_price_vnd"):
            object.__setattr__(self, name, _positive(getattr(self, name), name))
        if (
            self.floor_price_vnd > self.reference_price_vnd
            or self.ceiling_price_vnd < self.reference_price_vnd
        ):
            raise ValueError("published floor/reference/ceiling values are inconsistent")


@dataclass(frozen=True, slots=True)
class BrokerFeeSchedule:
    broker: str
    effective_from: date
    effective_to: date | None
    commission_rate: Decimal
    sell_tax_rate: Decimal
    evidence: SourceEvidence

    def __post_init__(self) -> None:
        if not self.broker.strip():
            raise ValueError("broker is required")
        _interval(self.effective_from, self.effective_to)
        for name in ("commission_rate", "sell_tax_rate"):
            value = _rate(getattr(self, name), name)
            object.__setattr__(self, name, value)


CONTRACT_SCHEMA = """
CREATE TABLE IF NOT EXISTS corporate_actions (
 symbol TEXT NOT NULL, ex_date TEXT NOT NULL, action_type TEXT NOT NULL,
 effective_from TEXT NOT NULL, effective_to TEXT, source_url TEXT NOT NULL,
 retrieved_at TEXT NOT NULL, published_at TEXT, source_reference TEXT,
 PRIMARY KEY(symbol, ex_date, effective_from)
);
CREATE TABLE IF NOT EXISTS trading_sessions (
 exchange TEXT NOT NULL, session_date TEXT NOT NULL, is_trading_session INTEGER NOT NULL,
 source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL, published_at TEXT, source_reference TEXT,
 PRIMARY KEY(exchange, session_date)
);
CREATE TABLE IF NOT EXISTS reference_prices (
 symbol TEXT NOT NULL, exchange TEXT NOT NULL, session_date TEXT NOT NULL,
 reference_price_vnd TEXT NOT NULL, floor_price_vnd TEXT NOT NULL, ceiling_price_vnd TEXT NOT NULL,
 source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL, published_at TEXT, source_reference TEXT,
 PRIMARY KEY(symbol, session_date)
);
CREATE TABLE IF NOT EXISTS broker_fee_schedules (
 broker TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
 commission_rate TEXT NOT NULL, sell_tax_rate TEXT NOT NULL,
 source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL, published_at TEXT, source_reference TEXT,
 PRIMARY KEY(broker, effective_from)
);
"""


def persist_contracts(
    db_path: str | Path,
    *,
    corporate_actions: tuple[CorporateAction, ...] = (),
    sessions: tuple[TradingSession, ...] = (),
    reference_prices: tuple[ReferencePrice, ...] = (),
    broker_fees: tuple[BrokerFeeSchedule, ...] = (),
) -> None:
    """Atomically persist only validated contracts and their provenance."""
    connection = sqlite3.connect(db_path)
    try:
        with connection:
            connection.executescript(CONTRACT_SCHEMA)
            connection.executemany(
                "INSERT OR REPLACE INTO corporate_actions VALUES (?,?,?,?,?,?,?,?,?)",
                [
                    (
                        _symbol(x.symbol),
                        x.ex_date.isoformat(),
                        x.action_type.value,
                        x.effective_from.isoformat(),
                        _iso(x.effective_to),
                        x.evidence.source_url,
                        x.evidence.retrieved_at.isoformat(),
                        _dt(x.evidence.published_at),
                        x.evidence.source_reference,
                    )
                    for x in corporate_actions
                ],
            )
            connection.executemany(
                "INSERT OR REPLACE INTO trading_sessions VALUES (?,?,?,?,?,?,?)",
                [
                    (
                        x.exchange.value,
                        x.session_date.isoformat(),
                        int(x.is_trading_session),
                        x.evidence.source_url,
                        x.evidence.retrieved_at.isoformat(),
                        _dt(x.evidence.published_at),
                        x.evidence.source_reference,
                    )
                    for x in sessions
                ],
            )
            connection.executemany(
                "INSERT OR REPLACE INTO reference_prices VALUES (?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        _symbol(x.symbol),
                        x.exchange.value,
                        x.session_date.isoformat(),
                        str(x.reference_price_vnd),
                        str(x.floor_price_vnd),
                        str(x.ceiling_price_vnd),
                        x.evidence.source_url,
                        x.evidence.retrieved_at.isoformat(),
                        _dt(x.evidence.published_at),
                        x.evidence.source_reference,
                    )
                    for x in reference_prices
                ],
            )
            connection.executemany(
                "INSERT OR REPLACE INTO broker_fee_schedules VALUES (?,?,?,?,?,?,?,?,?)",
                [
                    (
                        x.broker,
                        x.effective_from.isoformat(),
                        _iso(x.effective_to),
                        str(x.commission_rate),
                        str(x.sell_tax_rate),
                        x.evidence.source_url,
                        x.evidence.retrieved_at.isoformat(),
                        _dt(x.evidence.published_at),
                        x.evidence.source_reference,
                    )
                    for x in broker_fees
                ],
            )
    finally:
        connection.close()


def evidence_issues(
    db_path: str | Path, *, symbol: str, exchange: Exchange, session_date: date
) -> tuple[str, ...]:
    """Return explicit gaps; callers must fail closed when this is non-empty."""
    if not Path(db_path).exists():
        return ("corporate-action evidence missing", "reference-price evidence missing")
    connection = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        issues: list[str] = []
        if (
            "corporate_actions" not in tables
            or not connection.execute(
                "SELECT 1 FROM corporate_actions WHERE symbol=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) LIMIT 1",
                (_symbol(symbol), session_date.isoformat(), session_date.isoformat()),
            ).fetchone()
        ):
            issues.append("corporate-action evidence missing")
        if (
            "reference_prices" not in tables
            or not connection.execute(
                "SELECT 1 FROM reference_prices WHERE symbol=? AND exchange=? AND session_date=? LIMIT 1",
                (_symbol(symbol), exchange.value, session_date.isoformat()),
            ).fetchone()
        ):
            issues.append("reference-price evidence missing")
        return tuple(issues)
    finally:
        connection.close()


def load_reference_price(
    db_path: str | Path, *, symbol: str, exchange: Exchange, session_date: date
) -> ReferencePrice | None:
    connection = sqlite3.connect(db_path)
    try:
        row = connection.execute(
            "SELECT reference_price_vnd, floor_price_vnd, ceiling_price_vnd, source_url, retrieved_at, published_at, source_reference FROM reference_prices WHERE symbol=? AND exchange=? AND session_date=?",
            (_symbol(symbol), exchange.value, session_date.isoformat()),
        ).fetchone()
    except sqlite3.OperationalError:
        return None
    finally:
        connection.close()
    if row is None:
        return None
    return ReferencePrice(
        _symbol(symbol),
        exchange,
        session_date,
        Decimal(row[0]),
        Decimal(row[1]),
        Decimal(row[2]),
        SourceEvidence(
            row[3],
            datetime.fromisoformat(row[4]),
            datetime.fromisoformat(row[5]) if row[5] else None,
            row[6],
        ),
    )


def _symbol(value: str) -> str:
    value = value.strip().upper()
    if not value.isascii() or not value.isalnum():
        raise ValueError("symbol must be alphanumeric")
    return value


def _interval(start: date, end: date | None) -> None:
    if end is not None and end < start:
        raise ValueError("effective_to precedes effective_from")


def _positive(value: Decimal, name: str) -> Decimal:
    try:
        value = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{name} must be positive") from exc
    if not value.is_finite() or value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _rate(value: Decimal, name: str) -> Decimal:
    try:
        value = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{name} must be in [0, 1)") from exc
    if not value.is_finite() or not Decimal(0) <= value < Decimal(1):
        raise ValueError(f"{name} must be in [0, 1)")
    return value


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None
