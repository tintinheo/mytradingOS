"""Best-effort public website data requests; no broker/trading APIs or vnstock."""

from __future__ import annotations

import csv
import io
import json
import math
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


VN_TZ = timezone(timedelta(hours=7))
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,10}$")
MAX_BYTES = 4_000_000


class DataError(ValueError):
    """A provider or input failed validation; no signal should be calculated."""


@dataclass(frozen=True)
class Bar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class FetchResult:
    symbol: str
    source: str
    bars: list[Bar]
    fetched_at: str
    last_bar: str
    transport: str
    adjustment: str = "unverified"
    membership: str = "unverified"


def parse_date(value: object) -> str:
    if isinstance(value, (int, float)) and math.isfinite(value):
        stamp = value / 1000 if value >= 1e12 else value
        try:
            return datetime.fromtimestamp(stamp, VN_TZ).date().isoformat()
        except (ValueError, OverflowError, OSError) as exc:
            raise DataError("Invalid provider timestamp") from exc
    if not isinstance(value, str):
        raise DataError("Invalid bar date")
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:T.*)?", value):
            return date.fromisoformat(value[:10]).isoformat()
        return datetime.strptime(value, "%d/%m/%Y").date().isoformat()
    except ValueError as exc:
        raise DataError(f"Invalid bar date: {value[:30]}") from exc


def number(value: object) -> float:
    if isinstance(value, bool) or value is None or isinstance(value, (list, dict)):
        raise DataError("Missing or nonnumeric OHLCV field")
    try:
        # Provider numeric strings sometimes include English grouping commas.
        val = float(value.replace(",", "") if isinstance(value, str) else value)
    except (ValueError, TypeError) as exc:
        raise DataError("Missing or nonnumeric OHLCV field") from exc
    if not math.isfinite(val):
        raise DataError("Nonfinite OHLCV field")
    return val


def validate_bars(bars: list[Bar]) -> list[Bar]:
    if len(bars) < 2:
        raise DataError("At least two valid daily bars are required. Broaden the range.")
    bars = sorted(bars, key=lambda bar: bar.date)
    previous = None
    for bar in bars:
        parse_date(bar.date)
        if previous == bar.date:
            raise DataError(f"Duplicate daily bar {bar.date}")
        previous = bar.date
        values = (bar.open, bar.high, bar.low, bar.close, bar.volume)
        if not all(math.isfinite(x) for x in values):
            raise DataError(f"Nonfinite OHLCV on {bar.date}")
        if min(values[:4]) <= 0 or bar.volume < 0:
            raise DataError(f"Nonpositive price or negative volume on {bar.date}")
        if bar.high < max(bar.open, bar.low, bar.close) or bar.low > min(bar.open, bar.high, bar.close):
            raise DataError(f"Inconsistent OHLC range on {bar.date}")
    return bars


def normalize_dnse(payload: object) -> list[Bar]:
    if not isinstance(payload, dict):
        raise DataError("Unexpected DNSE response")
    raw = payload.get("data", payload)
    if not isinstance(raw, dict):
        raise DataError("Unexpected DNSE data")
    dates = raw.get("t", raw.get("time", raw.get("timestamps")))
    if isinstance(dates, list):
        arrays = [raw.get(short, raw.get(full)) for short, full in
                  (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close"), ("v", "volume"))]
        if any(not isinstance(x, list) or len(x) != len(dates) for x in arrays):
            raise DataError("DNSE response has incomplete OHLCV arrays")
        bars = [Bar(parse_date(stamp), *(number(array[i]) for array in arrays))
                for i, stamp in enumerate(dates)]
    elif isinstance(raw.get("bars"), list):
        bars = []
        for item in raw["bars"]:
            if not isinstance(item, dict):
                raise DataError("Invalid DNSE bar record")
            bars.append(Bar(parse_date(item.get("t", item.get("date"))),
                            *(number(item.get(short, item.get(full))) for short, full in
                              (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close"), ("v", "volume")))))
    else:
        raise DataError("Unrecognized DNSE bar shape")
    return validate_bars(bars)


def normalize_cafef(payload: object) -> list[Bar]:
    if not isinstance(payload, dict) or not isinstance(payload.get("Data"), dict):
        raise DataError("Unexpected CafeF response")
    items = payload["Data"].get("Data")
    if not isinstance(items, list):
        raise DataError("Unexpected CafeF history rows")
    bars = []
    for item in items:
        if not isinstance(item, dict):
            raise DataError("Invalid CafeF row")
        bars.append(Bar(parse_date(item.get("Ngay")), *(number(item.get(key)) for key in
                         ("GiaMoCua", "GiaCaoNhat", "GiaThapNhat", "GiaDongCua", "KhoiLuongKhopLenh"))))
    return validate_bars(bars)


def validate_request(symbol: str, start: date, end: date) -> str:
    symbol = symbol.strip().upper()
    if not SYMBOL_RE.fullmatch(symbol):
        raise DataError("Ticker must contain 2–10 Latin letters or digits")
    if not isinstance(start, date) or not isinstance(end, date) or start > end:
        raise DataError("Choose a valid start and end date")
    if (end - start).days > 10 * 366 or end > datetime.now(VN_TZ).date() + timedelta(days=1):
        raise DataError("Choose at most ten years ending today")
    return symbol


def provider_url(source: str, symbol: str, start: date, end: date, legacy: bool = False) -> str:
    if source == "DNSE":
        host = "services.entrade.com.vn" if legacy else "api.dnse.com.vn"
        begin = int(datetime.combine(start, time.min, VN_TZ).timestamp())
        finish = int(datetime.combine(end, time(23, 59, 59), VN_TZ).timestamp())
        return f"https://{host}/chart-api/v2/ohlcs/stock?" + urlencode(
            {"from": begin, "to": finish, "symbol": symbol, "resolution": "1D"})
    if source == "CafeF":
        return "https://s.cafef.vn/Ajax/PageNew/DataHistory/PriceHistory.ashx?" + urlencode(
            {"Symbol": symbol, "StartDate": start.isoformat(), "EndDate": end.isoformat(),
             "PageIndex": 1, "PageSize": (end - start).days + 1})
    raise DataError("Only DNSE and CafeF have experimental website-data adapters")


def _get_json(url: str) -> object:
    request = Request(url, headers={"Accept": "application/json", "Cache-Control": "no-cache",
                                    "User-Agent": "VN100-Strategy-Lab/1.0 (personal research)"})
    try:
        with urlopen(request, timeout=12) as response:
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise DataError("Provider response is too large")
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise DataError(f"Website data request failed: {type(exc).__name__}") from exc
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise DataError("Provider returned a non-JSON response") from exc


def fetch_history(source: str, symbol: str, start: date, end: date) -> FetchResult:
    """Fetch on every call. No cache, synthetic fallback or cross-provider switch."""
    symbol = validate_request(symbol, start, end)
    if source not in {"DNSE", "CafeF"}:
        raise DataError("Choose DNSE or CafeF, or import a CSV")
    if source == "DNSE":
        try:
            bars = normalize_dnse(_get_json(provider_url(source, symbol, start, end)))
            transport = "DNSE chart host"
        except DataError as first:
            try:
                bars = normalize_dnse(_get_json(provider_url(source, symbol, start, end, legacy=True)))
                transport = "DNSE legacy chart host"
            except DataError as second:
                raise DataError(f"DNSE chart hosts failed ({first}; {second}). No signal calculated.") from second
    else:
        bars = normalize_cafef(_get_json(provider_url(source, symbol, start, end)))
        transport = "CafeF website history"
    bars = [bar for bar in bars if start.isoformat() <= bar.date <= end.isoformat()]
    bars = validate_bars(bars)
    return FetchResult(symbol, source, bars, datetime.now(timezone.utc).isoformat(),
                       bars[-1].date, transport)


CSV_COLUMNS = {"symbol": "ticker", "stock": "ticker", "tradingdate": "date",
               "openprice": "open", "highprice": "high", "lowprice": "low",
               "closeprice": "close", "totalvolume": "volume"}


def parse_csv_files(files: list[tuple[str, bytes]]) -> dict[str, list[Bar]]:
    output: dict[str, list[Bar]] = {}
    for filename, content in files:
        if len(content) > MAX_BYTES:
            raise DataError(f"{filename}: file exceeds 4 MB")
        try:
            reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig"), newline=""))
            if not reader.fieldnames:
                raise DataError(f"{filename}: add a CSV header")
            names = {name: CSV_COLUMNS.get(re.sub(r"[\s_-]", "", name.lower()),
                                           re.sub(r"[\s_-]", "", name.lower())) for name in reader.fieldnames}
            if not set(("date", "open", "high", "low", "close", "volume")).issubset(names.values()):
                raise DataError(f"{filename}: need date,open,high,low,close,volume")
            fallback = Path(filename).stem.upper()
            if "ticker" not in names.values() and not SYMBOL_RE.fullmatch(fallback):
                raise DataError(f"{filename}: add a ticker column")
            for line, original in enumerate(reader, 2):
                if None in original:
                    raise DataError(f"{filename}:{line}: extra CSV fields")
                item = {names[k]: v for k, v in original.items()}
                symbol = (item.get("ticker") or fallback).strip().upper()
                if not SYMBOL_RE.fullmatch(symbol):
                    raise DataError(f"{filename}:{line}: invalid ticker")
                bar = Bar(parse_date(item.get("date")), *(number(item.get(key)) for key in
                            ("open", "high", "low", "close", "volume")))
                output.setdefault(symbol, []).append(bar)
        except UnicodeDecodeError as exc:
            raise DataError(f"{filename}: use UTF-8 CSV") from exc
    if not output:
        raise DataError("Import at least one OHLCV row")
    return {symbol: validate_bars(bars) for symbol, bars in output.items()}


def as_records(bars: list[Bar]) -> list[dict]:
    return [asdict(bar) for bar in bars]
