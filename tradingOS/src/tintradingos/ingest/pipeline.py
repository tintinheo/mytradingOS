"""CafeF price pipeline with fail-closed quality gates.

CCNN is intentionally not handled here because its published columns have not
been semantically verified. This module only persists OHLCV price datasets.
"""

from __future__ import annotations

import sqlite3
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from io import BytesIO
from pathlib import Path

from tintradingos.domain.market_rules import Exchange, PriceBasis
from tintradingos.ingest.cafef import CafeFDataset, PriceBar, build_url, parse_price_csv
from tintradingos.ingest.providers import ProviderBar
from tintradingos.reference.market_data import CONTRACT_SCHEMA


class PipelineStatus(StrEnum):
    OK = "OK"
    REJECTED = "REJECTED"


class DataQualityError(ValueError):
    """Raised when source data cannot safely enter the warehouse."""


@dataclass(frozen=True, slots=True)
class PipelineReport:
    status: PipelineStatus
    dataset: CafeFDataset
    basis: PriceBasis
    rows: int
    symbols: int
    trading_dates: tuple[date, ...]


def download_cafef_zip(
    dataset: CafeFDataset,
    trading_date: date,
    *,
    full_history: bool = False,
    timeout_seconds: float = 30.0,
) -> bytes:
    """Download one CafeF ZIP politely; parsing remains fail-closed."""
    if timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be positive")
    url = build_url(dataset, trading_date, full_history=full_history)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "TinTradingOS-Personal/0.1 (research)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            payload = response.read()
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        raise DataQualityError(f"CafeF download failed: {url}") from exc
    if not payload:
        raise DataQualityError(f"CafeF returned an empty payload: {url}")
    return payload


SCHEMA = """
CREATE TABLE IF NOT EXISTS ohlcv (
    symbol TEXT NOT NULL,
    trading_date TEXT NOT NULL,
    exchange TEXT NOT NULL,
    basis TEXT NOT NULL,
    open_vnd TEXT NOT NULL,
    high_vnd TEXT NOT NULL,
    low_vnd TEXT NOT NULL,
    close_vnd TEXT NOT NULL,
    volume INTEGER NOT NULL,
    PRIMARY KEY (symbol, trading_date, basis)
);
CREATE TABLE IF NOT EXISTS provider_runs (
    fetched_at TEXT NOT NULL,
    provider TEXT NOT NULL,
    source_url TEXT NOT NULL,
    symbol_count INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    first_date TEXT NOT NULL,
    last_date TEXT NOT NULL
);
"""


def parse_price_zip(
    payload: bytes,
    *,
    basis: PriceBasis,
    source_name: str = "<zip>",
) -> tuple[PriceBar, ...]:
    """Parse all exchange CSVs in a CafeF price ZIP."""
    bars: list[PriceBar] = []
    exchange_by_marker = {
        ".HSX.": Exchange.HOSE,
        ".HNX.": Exchange.HNX,
        ".UPCOM.": Exchange.UPCOM,
        "_HSX.": Exchange.HOSE,
        "_HNX.": Exchange.HNX,
        "_UPCOM.": Exchange.UPCOM,
    }
    try:
        archive = zipfile.ZipFile(BytesIO(payload))
    except zipfile.BadZipFile as exc:
        raise DataQualityError(f"{source_name}: invalid ZIP payload") from exc

    with archive:
        for member in archive.namelist():
            marker = next((key for key in exchange_by_marker if key in member), None)
            if marker is None or not member.lower().endswith((".csv", ".txt")):
                continue
            bars.extend(
                parse_price_csv(
                    archive.read(member),
                    exchange=exchange_by_marker[marker],
                    basis=basis,
                    source_name=f"{source_name}:{member}",
                )
            )

    if not bars:
        raise DataQualityError(f"{source_name}: no exchange price files found")
    return tuple(bars)


def validate_bars(bars: tuple[PriceBar, ...]) -> None:
    """Run duplicate, date and OHLCV checks before persistence."""
    keys: set[tuple[str, date, PriceBasis]] = set()
    for bar in bars:
        key = (bar.symbol, bar.trading_date, bar.basis)
        if key in keys:
            raise DataQualityError(f"duplicate bar: {key}")
        keys.add(key)
        if bar.volume < 0:
            raise DataQualityError(f"negative volume: {key}")
        if bar.low_vnd > min(bar.open_vnd, bar.close_vnd):
            raise DataQualityError(f"low violates OHLC invariant: {key}")
        if bar.high_vnd < max(bar.open_vnd, bar.close_vnd):
            raise DataQualityError(f"high violates OHLC invariant: {key}")


def validate_raw_adjusted_alignment(
    raw_bars: tuple[PriceBar, ...],
    adjusted_bars: tuple[PriceBar, ...],
) -> None:
    """Require identical symbol/date/exchange coverage for raw and adjusted data."""
    raw_keys = {(bar.symbol, bar.trading_date, bar.exchange) for bar in raw_bars}
    adjusted_keys = {(bar.symbol, bar.trading_date, bar.exchange) for bar in adjusted_bars}
    if raw_keys != adjusted_keys:
        missing_raw = len(adjusted_keys - raw_keys)
        missing_adjusted = len(raw_keys - adjusted_keys)
        raise DataQualityError(
            f"raw/adjusted coverage mismatch: missing_raw={missing_raw}, "
            f"missing_adjusted={missing_adjusted}"
        )


def persist_bars(db_path: str | Path, bars: tuple[PriceBar, ...]) -> None:
    """Idempotently upsert validated bars into a local SQLite warehouse."""
    validate_bars(bars)
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        with connection:
            connection.executescript(SCHEMA)
            connection.executescript(CONTRACT_SCHEMA)
            connection.executemany(
                """
            INSERT INTO ohlcv
              (symbol, trading_date, exchange, basis, open_vnd, high_vnd,
               low_vnd, close_vnd, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol, trading_date, basis) DO UPDATE SET
              exchange=excluded.exchange, open_vnd=excluded.open_vnd,
              high_vnd=excluded.high_vnd, low_vnd=excluded.low_vnd,
              close_vnd=excluded.close_vnd, volume=excluded.volume
            """,
                [
                    (
                        bar.symbol,
                        bar.trading_date.isoformat(),
                        bar.exchange.value,
                        bar.basis.value,
                        str(bar.open_vnd),
                        str(bar.high_vnd),
                        str(bar.low_vnd),
                        str(bar.close_vnd),
                        bar.volume,
                    )
                    for bar in bars
                ],
            )
    finally:
        connection.close()


def persist_provider_bars(db_path: str | Path, bars: tuple[ProviderBar, ...]) -> int:
    """Normalize provider bars into the warehouse and record source provenance."""
    if not bars:
        raise DataQualityError("provider returned no bars")
    if any(bar.source is not bars[0].source for bar in bars):
        raise DataQualityError("provider batch contains mixed sources")
    price_bars = tuple(
        PriceBar(
            symbol=bar.symbol,
            trading_date=bar.trading_date,
            exchange=bar.exchange,
            basis=bar.basis,
            open_vnd=Decimal(str(bar.open_vnd)),
            high_vnd=Decimal(str(bar.high_vnd)),
            low_vnd=Decimal(str(bar.low_vnd)),
            close_vnd=Decimal(str(bar.close_vnd)),
            volume=bar.volume,
        )
        for bar in bars
    )
    persist_bars(db_path, price_bars)
    connection = sqlite3.connect(db_path)
    try:
        with connection:
            connection.executescript(SCHEMA)
            connection.executescript(CONTRACT_SCHEMA)
            connection.execute(
                "INSERT INTO provider_runs VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    datetime.now().isoformat(timespec="seconds"),
                    bars[0].source.value,
                    bars[0].source_url,
                    len({bar.symbol for bar in bars}),
                    len(bars),
                    min(bar.trading_date for bar in bars).isoformat(),
                    max(bar.trading_date for bar in bars).isoformat(),
                ),
            )
    finally:
        connection.close()
    return len(price_bars)


def run_price_pipeline(
    payload: bytes,
    *,
    dataset: CafeFDataset,
    basis: PriceBasis,
    db_path: str | Path,
    source_name: str = "<zip>",
) -> PipelineReport:
    """Parse, validate, persist and summarize one price ZIP."""
    if dataset not in (CafeFDataset.PRICE_ADJUSTED, CafeFDataset.PRICE_RAW):
        raise DataQualityError("pipeline currently accepts price datasets only")
    bars = parse_price_zip(payload, basis=basis, source_name=source_name)
    validate_bars(bars)
    persist_bars(db_path, bars)
    dates = tuple(sorted({bar.trading_date for bar in bars}))
    return PipelineReport(
        status=PipelineStatus.OK,
        dataset=dataset,
        basis=basis,
        rows=len(bars),
        symbols=len({bar.symbol for bar in bars}),
        trading_dates=dates,
    )
