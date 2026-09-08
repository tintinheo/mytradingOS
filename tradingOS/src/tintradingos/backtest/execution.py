"""Conservative T+1 fill simulation for end-of-day signals."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import StrEnum

from tintradingos.domain.market_rules import Exchange, MarketPrice, PriceBasis, round_down_to_tick

CEILING_PROXIMITY_FACTOR = Decimal("0.995")


class FillReason(StrEnum):
    FILLED = "FILLED"
    GAP_EXCEEDED = "GAP_EXCEEDED"
    OPENED_AT_CEILING = "OPENED_AT_CEILING"
    LIMIT_TOO_CLOSE_TO_CEILING = "LIMIT_TOO_CLOSE_TO_CEILING"
    LIMIT_NOT_REACHED = "LIMIT_NOT_REACHED"


class FillPolicy(StrEnum):
    TOUCH_OPTIMISTIC = "TOUCH_OPTIMISTIC"
    TRADE_THROUGH_CONSERVATIVE = "TRADE_THROUGH_CONSERVATIVE"


@dataclass(frozen=True, slots=True)
class FillResult:
    filled: bool
    price_vnd: Decimal | None
    limit_price_vnd: Decimal
    overnight_gap: Decimal
    reason: FillReason


def simulate_limit_entry(
    *,
    signal_close: MarketPrice,
    next_open: MarketPrice,
    next_high: MarketPrice,
    next_low: MarketPrice,
    next_ceiling: MarketPrice,
    exchange: Exchange,
    premium: Decimal | int | float | str,
    max_gap: Decimal | int | float | str,
    fill_policy: FillPolicy,
) -> FillResult:
    """Model a limit order using only observable prices from session T+1.

    ``next_ceiling`` is mandatory because the exchange reference price can
    differ from the previous close on corporate-action dates. The caller must
    choose the optimistic touch or conservative trade-through fill policy.
    """
    prices = (signal_close, next_open, next_high, next_low, next_ceiling)
    if any(not isinstance(price, MarketPrice) for price in prices):
        raise TypeError("execution prices must be MarketPrice values")
    if any(price.basis is not PriceBasis.RAW for price in prices):
        raise ValueError("execution requires RAW prices; adjusted prices are not tradable quotes")
    if not isinstance(fill_policy, FillPolicy):
        raise TypeError("fill_policy must be a FillPolicy value")

    close_value = signal_close.value_vnd
    open_value = next_open.value_vnd
    high_value = next_high.value_vnd
    low_value = next_low.value_vnd
    ceiling_value = next_ceiling.value_vnd
    premium_rate = _rate(premium, "premium")
    maximum_gap = _rate(max_gap, "max_gap")

    if not low_value <= open_value <= high_value:
        raise ValueError("T+1 prices must satisfy low <= open <= high")
    if ceiling_value < open_value:
        raise ValueError("next_ceiling_vnd cannot be below next_open_vnd")

    gap = open_value / close_value - Decimal(1)
    limit_price = round_down_to_tick(
        close_value * (Decimal(1) + premium_rate),
        exchange,
    )

    if gap > maximum_gap:
        return FillResult(False, None, limit_price, gap, FillReason.GAP_EXCEEDED)
    if low_value >= ceiling_value:
        return FillResult(False, None, limit_price, gap, FillReason.OPENED_AT_CEILING)
    if limit_price >= ceiling_value * CEILING_PROXIMITY_FACTOR:
        return FillResult(
            False,
            None,
            limit_price,
            gap,
            FillReason.LIMIT_TOO_CLOSE_TO_CEILING,
        )

    marketable_at_open = open_value <= limit_price
    reached_after_open = (
        low_value <= limit_price
        if fill_policy is FillPolicy.TOUCH_OPTIMISTIC
        else low_value < limit_price
    )
    if not marketable_at_open and not reached_after_open:
        return FillResult(False, None, limit_price, gap, FillReason.LIMIT_NOT_REACHED)

    return FillResult(
        True,
        min(open_value, limit_price),
        limit_price,
        gap,
        FillReason.FILLED,
    )


def _rate(value: Decimal | int | float | str, name: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{name} must be in [0, 1)") from exc
    if not parsed.is_finite() or not Decimal(0) <= parsed < Decimal(1):
        raise ValueError(f"{name} must be in [0, 1)")
    return parsed
