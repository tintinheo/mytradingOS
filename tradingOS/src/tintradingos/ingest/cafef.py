"""Strict parser for the verified CafeF AmiBroker price export."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from io import StringIO

from tintradingos.domain.market_rules import Exchange, PriceBasis, cafef_price_to_vnd

CAFEF_CDN_BASE = "https://cafef1.mediacdn.vn/data/ami_data"
PRICE_HEADERS = (
    "<Ticker>",
    "<DTYYYYMMDD>",
    "<Open>",
    "<High>",
    "<Low>",
    "<Close>",
    "<Volume>",
)


class CafeFDataset(StrEnum):
    PRICE_ADJUSTED = "SolieuGD"
    PRICE_RAW = "SolieuGD.Raw"
    INDEX = "Index"
    ORDER_FLOW_AND_FOREIGN = "CCNN"


class CafeFFormatError(ValueError):
    """Raised when a CafeF payload does not satisfy its verified contract."""


@dataclass(frozen=True, slots=True)
class PriceBar:
    symbol: str
    trading_date: date
    exchange: Exchange
    basis: PriceBasis
    open_vnd: Decimal
    high_vnd: Decimal
    low_vnd: Decimal
    close_vnd: Decimal
    volume: int


def build_url(dataset: CafeFDataset, trading_date: date, *, full_history: bool = False) -> str:
    """Build a CafeF URL with its two distinct date formats."""
    folder = trading_date.strftime("%Y%m%d")
    stamp = trading_date.strftime("%d%m%Y")
    upto = "Upto" if full_history else ""
    return f"{CAFEF_CDN_BASE}/{folder}/CafeF.{dataset.value}.{upto}{stamp}.zip"


def parse_price_csv(
    payload: bytes | str,
    *,
    exchange: Exchange,
    basis: PriceBasis,
    source_name: str = "<memory>",
) -> tuple[PriceBar, ...]:
    """Parse one exchange price file and normalize all prices to VND."""
    try:
        text = (
            payload.decode("utf-8-sig") if isinstance(payload, bytes) else payload.lstrip("\ufeff")
        )
    except UnicodeDecodeError as exc:
        raise CafeFFormatError(f"{source_name}: payload is not valid UTF-8") from exc
    reader = csv.DictReader(StringIO(text))
    if tuple(reader.fieldnames or ()) != PRICE_HEADERS:
        raise CafeFFormatError(
            f"{source_name}: unexpected headers {reader.fieldnames!r}; expected {PRICE_HEADERS!r}"
        )

    bars: list[PriceBar] = []
    seen: set[tuple[str, date]] = set()
    for line_number, row in enumerate(reader, start=2):
        try:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("column count does not match the header")
            symbol = row["<Ticker>"].strip().upper()
            if not symbol or not symbol.isascii() or not symbol.isalnum():
                raise ValueError("invalid ticker")
            raw_date = row["<DTYYYYMMDD>"]
            if re.fullmatch(r"\d{8}", raw_date) is None:
                raise ValueError("date must contain exactly 8 digits in YYYYMMDD format")
            trading_date = datetime.strptime(raw_date, "%Y%m%d").date()
            open_vnd = cafef_price_to_vnd(row["<Open>"])
            high_vnd = cafef_price_to_vnd(row["<High>"])
            low_vnd = cafef_price_to_vnd(row["<Low>"])
            close_vnd = cafef_price_to_vnd(row["<Close>"])
            volume = int(row["<Volume>"])
            if volume < 0:
                raise ValueError("volume cannot be negative")
            if low_vnd > min(open_vnd, close_vnd) or high_vnd < max(open_vnd, close_vnd):
                raise ValueError("OHLC invariants failed")
            key = (symbol, trading_date)
            if key in seen:
                raise ValueError("duplicate symbol and date")
            seen.add(key)
        except (InvalidOperation, ValueError) as exc:
            raise CafeFFormatError(f"{source_name}:{line_number}: {exc}") from exc

        bars.append(
            PriceBar(
                symbol=symbol,
                trading_date=trading_date,
                exchange=exchange,
                basis=basis,
                open_vnd=open_vnd,
                high_vnd=high_vnd,
                low_vnd=low_vnd,
                close_vnd=close_vnd,
                volume=volume,
            )
        )

    if not bars:
        raise CafeFFormatError(f"{source_name}: price file contains no data rows")
    return tuple(bars)
