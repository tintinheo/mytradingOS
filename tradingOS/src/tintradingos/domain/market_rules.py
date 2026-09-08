"""Exchange and settlement rules used by execution-sensitive code."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal, InvalidOperation
from enum import StrEnum


class Exchange(StrEnum):
    HOSE = "HOSE"
    HNX = "HNX"
    UPCOM = "UPCOM"


class PriceBasis(StrEnum):
    RAW = "RAW"
    ADJUSTED = "ADJUSTED"


@dataclass(frozen=True, slots=True)
class MarketPrice:
    value_vnd: Decimal
    basis: PriceBasis

    def __post_init__(self) -> None:
        object.__setattr__(self, "value_vnd", _positive_decimal(self.value_vnd, "value_vnd"))
        if not isinstance(self.basis, PriceBasis):
            raise TypeError("basis must be a PriceBasis value")

    @classmethod
    def raw(cls, value_vnd: Decimal | int | float | str) -> MarketPrice:
        return cls(_positive_decimal(value_vnd, "value_vnd"), PriceBasis.RAW)

    @classmethod
    def adjusted(cls, value_vnd: Decimal | int | float | str) -> MarketPrice:
        return cls(_positive_decimal(value_vnd, "value_vnd"), PriceBasis.ADJUSTED)


PRICE_BANDS: dict[Exchange, Decimal] = {
    Exchange.HOSE: Decimal("0.07"),
    Exchange.HNX: Decimal("0.10"),
    Exchange.UPCOM: Decimal("0.15"),
}

ROUND_LOT_SHARES = 100
CAFEF_PRICE_SCALE_TO_VND = Decimal("1000")
SETTLEMENT_SESSION_OFFSET = 2
NEXT_MORNING_EOD_EXIT_OFFSET = 3


def cafef_price_to_vnd(price_in_thousands: Decimal | int | float | str) -> Decimal:
    """Convert CafeF AmiBroker price values, quoted in thousand VND, to VND."""
    price = _positive_decimal(price_in_thousands, "CafeF price")
    return price * CAFEF_PRICE_SCALE_TO_VND


def tick_size(price_vnd: Decimal | int | float | str, exchange: Exchange) -> Decimal:
    """Return the regular-lot tick size for a normalized VND price."""
    price = _positive_decimal(price_vnd, "Price")
    market = _require_exchange(exchange)
    if market is not Exchange.HOSE:
        return Decimal(100)
    if price < Decimal(10_000):
        return Decimal(10)
    if price < Decimal(50_000):
        return Decimal(50)
    return Decimal(100)


def round_down_to_tick(
    price_vnd: Decimal | int | float | str,
    exchange: Exchange,
) -> Decimal:
    """Round a buy limit or target down to a valid exchange tick."""
    price = _positive_decimal(price_vnd, "Price")
    tick = tick_size(price, exchange)
    return (price / tick).to_integral_value(rounding=ROUND_FLOOR) * tick


def round_up_to_tick(
    price_vnd: Decimal | int | float | str,
    exchange: Exchange,
) -> Decimal:
    """Round a lower price boundary up to a valid exchange tick."""
    price = _positive_decimal(price_vnd, "Price")
    tick = tick_size(price, exchange)
    return (price / tick).to_integral_value(rounding=ROUND_CEILING) * tick


def daily_price_limits(
    reference_price_vnd: Decimal | int | float | str,
    exchange: Exchange,
) -> tuple[Decimal, Decimal]:
    """Return conservative regular-lot (floor, ceiling) price boundaries."""
    reference = _positive_decimal(reference_price_vnd, "Reference price")
    market = _require_exchange(exchange)
    band = PRICE_BANDS[market]
    floor = round_up_to_tick(reference * (Decimal(1) - band), market)
    ceiling = round_down_to_tick(reference * (Decimal(1) + band), market)
    return floor, ceiling


def settlement_session_index(entry_session_index: int) -> int:
    """Session when shares bought at entry are expected to settle (T+2)."""
    if entry_session_index < 0:
        raise ValueError("Entry session index cannot be negative")
    return entry_session_index + SETTLEMENT_SESSION_OFFSET


def next_morning_eod_exit_index(entry_session_index: int) -> int:
    """Next-morning exit for a system that only decides after the T+2 close."""
    if entry_session_index < 0:
        raise ValueError("Entry session index cannot be negative")
    return entry_session_index + NEXT_MORNING_EOD_EXIT_OFFSET


def _positive_decimal(value: Decimal | int | float | str, name: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{name} must be a positive finite number") from exc
    if not parsed.is_finite() or parsed <= 0:
        raise ValueError(f"{name} must be a positive finite number")
    return parsed


def _require_exchange(exchange: Exchange) -> Exchange:
    if not isinstance(exchange, Exchange):
        raise TypeError("exchange must be an Exchange value")
    return exchange
