"""Direct Vietnam-market data providers with explicit capability contracts.

The provider layer is intentionally separate from the CafeF ZIP pipeline. A
provider result carries its source so downstream QC can reject mixed or
unverified datasets. SSI's public endpoint currently exposed by the reference
implementation is a snapshot endpoint, not a verified historical OHLCV API;
DNSE has no verified contract in this repository and remains fail-closed.
"""

from __future__ import annotations

import json
import re
from calendar import timegm
from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum
from html.parser import HTMLParser
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from tintradingos.domain.market_rules import Exchange, PriceBasis


class Provider(StrEnum):
    CAFEF = "CAFEF"
    SSI = "SSI"
    DNSE = "DNSE"
    TCBS = "TCBS"
    VCI = "VCI"


class ProviderCapability(StrEnum):
    HISTORICAL_OHLCV = "HISTORICAL_OHLCV"
    SNAPSHOT_ONLY = "SNAPSHOT_ONLY"
    UNVERIFIED = "UNVERIFIED"


class ProviderError(RuntimeError):
    """Raised when a provider cannot return a verified data contract."""


@dataclass(frozen=True, slots=True)
class ProviderBar:
    symbol: str
    trading_date: date
    exchange: Exchange
    open_vnd: float
    high_vnd: float
    low_vnd: float
    close_vnd: float
    volume: int
    source: Provider
    source_url: str
    basis: PriceBasis = PriceBasis.RAW


class HtmlTableParser(HTMLParser):
    """Small parser for the public CafeF history table."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row:
            self.rows.append(self._row)
            self._row = None


class HistoricalProvider(Protocol):
    provider: Provider
    capability: ProviderCapability

    def fetch(
        self, symbol: str, start: date, end: date | None = None
    ) -> tuple[ProviderBar, ...]: ...


class CafeFHistoryProvider:
    provider = Provider.CAFEF
    capability = ProviderCapability.HISTORICAL_OHLCV
    BASE_URL = "https://s.cafef.vn/Lich-su-giao-dich-{symbol}-1.chn"

    def __init__(self, timeout_seconds: float = 20.0) -> None:
        self.timeout_seconds = timeout_seconds

    def fetch(self, symbol: str, start: date, end: date | None = None) -> tuple[ProviderBar, ...]:
        symbol = symbol.strip().upper()
        url = self.BASE_URL.format(symbol=symbol)
        request = Request(url, headers={"User-Agent": "TinTradingOS-Personal/0.1 (research)"})
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = response.read().decode("utf-8", errors="strict")
        except (HTTPError, URLError, TimeoutError, OSError, UnicodeDecodeError) as exc:
            raise ProviderError(f"CafeF history request failed for {symbol}: {url}") from exc

        parser = HtmlTableParser()
        parser.feed(payload)
        bars: list[ProviderBar] = []
        for row in parser.rows:
            parsed = self._parse_row(row, symbol, url)
            if (
                parsed is not None
                and parsed.trading_date >= start
                and (end is None or parsed.trading_date <= end)
            ):
                bars.append(parsed)
        if not bars:
            raise ProviderError(f"CafeF history returned no verified OHLCV rows for {symbol}")
        return tuple(sorted(bars, key=lambda item: item.trading_date))

    @staticmethod
    def _parse_row(row: list[str], symbol: str, url: str) -> ProviderBar | None:
        if len(row) < 8 or not re.fullmatch(r"\d{2}/\d{2}/\d{4}", row[0]):
            return None
        try:
            trading_date = datetime.strptime(row[0], "%d/%m/%Y").date()
            values = [float(item.replace(",", "")) for item in row[1:]]
            close, open_price, high, low = values[0], values[4], values[5], values[6]
            volume = int(values[2])
            prices = [open_price, high, low, close]
            if min(prices) <= 0 or low > min(open_price, close) or high < max(open_price, close):
                return None
        except (ValueError, IndexError):
            return None
        return ProviderBar(
            symbol,
            trading_date,
            Exchange.HOSE,
            open_price * 1000,
            high * 1000,
            low * 1000,
            close * 1000,
            volume,
            Provider.CAFEF,
            url,
        )


class SsiSnapshotProvider:
    provider = Provider.SSI
    capability = ProviderCapability.SNAPSHOT_ONLY

    def fetch(self, symbol: str, start: date, end: date | None = None) -> tuple[ProviderBar, ...]:
        raise ProviderError(
            "SSI public iBoard contract available in TradingOSOpus is snapshot-only; "
            "no historical OHLCV endpoint has been verified"
        )


class DnseProvider:
    provider = Provider.DNSE
    capability = ProviderCapability.UNVERIFIED

    def fetch(self, symbol: str, start: date, end: date | None = None) -> tuple[ProviderBar, ...]:
        raise ProviderError(
            "DNSE OHLCV endpoint/schema is not verified in this repository; "
            "refusing guessed requests"
        )


class TcbsHistoryProvider:
    """TCBS long-term bars endpoint, adapted from TradingOSOpus."""

    provider = Provider.TCBS
    capability = ProviderCapability.HISTORICAL_OHLCV
    BASE_URL = "https://apipubaws.tcbs.com.vn/stock-insight/v2/stock/bars-long-term"

    def __init__(self, timeout_seconds: float = 20.0) -> None:
        self.timeout_seconds = timeout_seconds

    def fetch(self, symbol: str, start: date, end: date | None = None) -> tuple[ProviderBar, ...]:
        end = end or date.today()
        query = (
            f"?ticker={symbol.strip().upper()}&type=stock&resolution=D"
            f"&from={_unix_timestamp(start)}&to={_unix_timestamp(end)}"
        )
        url = self.BASE_URL + query
        payload = _get_json(url, self.timeout_seconds, {"Accept": "application/json"})
        bars = payload.get("data", []) if isinstance(payload, dict) else []
        return self._parse_bars(symbol, url, bars)

    @staticmethod
    def _parse_bars(symbol: str, url: str, bars: object) -> tuple[ProviderBar, ...]:
        if not isinstance(bars, list) or not bars:
            raise ProviderError(f"TCBS returned no historical bars for {symbol}")
        numeric_rows = [item for item in bars if isinstance(item, dict)]
        required = {"tradingDate", "open", "high", "low", "close", "volume"}
        if not numeric_rows or not required.issubset(numeric_rows[0]):
            raise ProviderError("TCBS response does not match verified OHLCV schema")
        median = sorted(float(row["close"]) for row in numeric_rows)[len(numeric_rows) // 2]
        scale = 1000.0 if median < 500 else 1.0
        result: list[ProviderBar] = []
        for row in numeric_rows:
            trading_date = _parse_provider_date(row["tradingDate"])
            result.append(
                ProviderBar(
                    symbol.strip().upper(),
                    trading_date,
                    Exchange.HOSE,
                    float(row["open"]) * scale,
                    float(row["high"]) * scale,
                    float(row["low"]) * scale,
                    float(row["close"]) * scale,
                    int(row["volume"]),
                    Provider.TCBS,
                    url,
                )
            )
        return tuple(sorted(result, key=lambda item: item.trading_date))


class VciHistoryProvider:
    """Vietcap/VCI bars endpoint, adapted from TradingOSOpus."""

    provider = Provider.VCI
    capability = ProviderCapability.HISTORICAL_OHLCV
    BASE_URL = "https://mt.vietcap.com.vn/api/price/symbols/{symbol}/bars"

    def __init__(self, timeout_seconds: float = 20.0) -> None:
        self.timeout_seconds = timeout_seconds

    def fetch(self, symbol: str, start: date, end: date | None = None) -> tuple[ProviderBar, ...]:
        end = end or date.today()
        ticker = symbol.strip().upper()
        url = (
            f"{self.BASE_URL.format(symbol=ticker)}?from={start.isoformat()}"
            f"&to={end.isoformat()}&resolution=D"
        )
        payload = _get_json(url, self.timeout_seconds, {"Accept": "application/json"})
        bars = (
            payload
            if isinstance(payload, list)
            else payload.get("data", payload.get("bars", []))
            if isinstance(payload, dict)
            else []
        )
        return self._parse_bars(ticker, url, bars)

    @staticmethod
    def _parse_bars(symbol: str, url: str, bars: object) -> tuple[ProviderBar, ...]:
        if not isinstance(bars, list) or not bars:
            raise ProviderError(f"VCI returned no historical bars for {symbol}")
        result: list[ProviderBar] = []
        for row in bars:
            if not isinstance(row, dict):
                continue
            date_value = row.get("date", row.get("time", row.get("tradingDate", row.get("t"))))
            values = (
                row.get("open", row.get("o")),
                row.get("high", row.get("h")),
                row.get("low", row.get("l")),
                row.get("close", row.get("c")),
                row.get("volume", row.get("v")),
            )
            if date_value is None or any(value is None for value in values):
                continue
            result.append(
                ProviderBar(
                    symbol,
                    _parse_provider_date(date_value),
                    Exchange.HOSE,
                    *[float(value) for value in values[:4]],
                    int(values[4]),
                    Provider.VCI,
                    url,
                )
            )
        if not result:
            raise ProviderError("VCI response contains no verified OHLCV rows")
        median = sorted(item.close_vnd for item in result)[len(result) // 2]
        if median < 100:
            result = [_scale_bar(item, 1000.0) for item in result]
        if median > 1_000_000:
            result = [_scale_bar(item, 0.001) for item in result]
        return tuple(sorted(result, key=lambda item: item.trading_date))


def _unix_timestamp(value: date) -> int:
    return timegm((value.year, value.month, value.day, 0, 0, 0))


def _parse_provider_date(value: object) -> date:
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000
        return datetime.fromtimestamp(timestamp).date()
    text = str(value).replace("Z", "+00:00")
    return datetime.fromisoformat(text[:19]).date()


def _get_json(url: str, timeout_seconds: float, headers: dict[str, str]) -> object:
    request = Request(
        url, headers={"User-Agent": "TinTradingOS-Personal/0.1 (research)", **headers}
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except (
        HTTPError,
        URLError,
        TimeoutError,
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ) as exc:
        raise ProviderError(f"Historical provider request failed: {url}") from exc


def _scale_bar(bar: ProviderBar, factor: float) -> ProviderBar:
    return ProviderBar(
        bar.symbol,
        bar.trading_date,
        bar.exchange,
        bar.open_vnd * factor,
        bar.high_vnd * factor,
        bar.low_vnd * factor,
        bar.close_vnd * factor,
        bar.volume,
        bar.source,
        bar.source_url,
        bar.basis,
    )


def provider_for(provider: Provider) -> HistoricalProvider:
    if provider is Provider.CAFEF:
        return CafeFHistoryProvider()
    if provider is Provider.SSI:
        return SsiSnapshotProvider()
    if provider is Provider.TCBS:
        return TcbsHistoryProvider()
    if provider is Provider.VCI:
        return VciHistoryProvider()
    return DnseProvider()
