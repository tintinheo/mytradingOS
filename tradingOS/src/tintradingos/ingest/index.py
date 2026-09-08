"""Strict, source-backed VN-Index EOD contract.

Index bars are intentionally stored independently of equity OHLCV: an index
level is not a tradable equity price and must never be mistaken for one.
"""

from __future__ import annotations

import csv
import io
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

VN_INDEX_HEADERS = ("date", "open", "high", "low", "close", "source_url")


class IndexEODError(ValueError):
    """Raised when an index EOD payload cannot be proven safe to store."""


@dataclass(frozen=True, slots=True)
class IndexEODBar:
    index_code: str
    trading_date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    source_url: str


INDEX_SCHEMA = """
CREATE TABLE IF NOT EXISTS index_eod (
    index_code TEXT NOT NULL,
    trading_date TEXT NOT NULL,
    open TEXT NOT NULL,
    high TEXT NOT NULL,
    low TEXT NOT NULL,
    close TEXT NOT NULL,
    source_url TEXT NOT NULL,
    PRIMARY KEY (index_code, trading_date)
);
"""


def parse_vn_index_eod_csv(
    payload: bytes, *, source_name: str = "<memory>"
) -> tuple[IndexEODBar, ...]:
    """Parse a UTF-8 VN-Index EOD CSV with per-row provenance.

    The importer accepts only the documented six-column contract.  Requiring a
    source URL on every row keeps locally supplied history auditable without
    guessing an undocumented provider endpoint.
    """
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise IndexEODError(f"{source_name}: index CSV must be UTF-8") from exc
    reader = csv.DictReader(io.StringIO(text))
    if tuple(reader.fieldnames or ()) != VN_INDEX_HEADERS:
        raise IndexEODError(
            f"{source_name}: unexpected headers {reader.fieldnames!r}; "
            f"expected {VN_INDEX_HEADERS!r}"
        )
    bars: list[IndexEODBar] = []
    seen: set[date] = set()
    for line_number, row in enumerate(reader, start=2):
        try:
            trading_date = datetime.strptime((row["date"] or "").strip(), "%Y-%m-%d").date()
            values = [
                Decimal((row[field] or "").strip()) for field in ("open", "high", "low", "close")
            ]
            open_, high, low, close = values
            source_url = (row["source_url"] or "").strip()
            if not source_url.startswith(("https://", "http://")):
                raise ValueError("source_url must be an HTTP(S) URL")
            if min(values) <= 0:
                raise ValueError("index OHLC values must be positive")
            if low > min(open_, close) or high < max(open_, close):
                raise ValueError("index OHLC invariants failed")
            if trading_date in seen:
                raise ValueError("duplicate date")
        except (InvalidOperation, ValueError) as exc:
            raise IndexEODError(f"{source_name}:{line_number}: {exc}") from exc
        seen.add(trading_date)
        bars.append(IndexEODBar("VNINDEX", trading_date, open_, high, low, close, source_url))
    if not bars:
        raise IndexEODError(f"{source_name}: index CSV contains no data rows")
    return tuple(bars)


def persist_index_eod(db_path: str | Path, bars: tuple[IndexEODBar, ...]) -> None:
    """Idempotently persist validated VN-Index history apart from ``ohlcv``."""
    if not bars:
        raise IndexEODError("cannot persist an empty index batch")
    dates = [bar.trading_date for bar in bars]
    if len(dates) != len(set(dates)):
        raise IndexEODError("duplicate index date")
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        with connection:
            connection.executescript(INDEX_SCHEMA)
            connection.executemany(
                """INSERT INTO index_eod
                (index_code, trading_date, open, high, low, close, source_url)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(index_code, trading_date) DO UPDATE SET
                    open=excluded.open, high=excluded.high, low=excluded.low,
                    close=excluded.close, source_url=excluded.source_url""",
                [
                    (
                        bar.index_code,
                        bar.trading_date.isoformat(),
                        str(bar.open),
                        str(bar.high),
                        str(bar.low),
                        str(bar.close),
                        bar.source_url,
                    )
                    for bar in bars
                ],
            )
    finally:
        connection.close()
