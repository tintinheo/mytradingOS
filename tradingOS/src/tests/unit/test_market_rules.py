from decimal import Decimal

import pytest

from tintradingos.domain.market_rules import (
    Exchange,
    MarketPrice,
    PriceBasis,
    cafef_price_to_vnd,
    daily_price_limits,
    next_morning_eod_exit_index,
    round_down_to_tick,
    round_up_to_tick,
    settlement_session_index,
    tick_size,
)


@pytest.mark.parametrize(
    ("cafef_price", "expected_vnd"),
    [("7.13", Decimal("7130.00")), (16, Decimal("16000")), ("61.2", Decimal("61200.0"))],
)
def test_cafef_prices_are_normalized_to_vnd(cafef_price: str | int, expected_vnd: Decimal):
    assert cafef_price_to_vnd(cafef_price) == expected_vnd


@pytest.mark.parametrize("invalid", [0, -1, "NaN", "Infinity"])
def test_cafef_price_rejects_invalid_values(invalid: int | str):
    with pytest.raises(ValueError, match="positive finite"):
        cafef_price_to_vnd(invalid)


@pytest.mark.parametrize(
    ("price", "exchange", "expected"),
    [
        (9_990, Exchange.HOSE, Decimal(10)),
        (10_000, Exchange.HOSE, Decimal(50)),
        (49_950, Exchange.HOSE, Decimal(50)),
        (50_000, Exchange.HOSE, Decimal(100)),
        (7_130, Exchange.HNX, Decimal(100)),
        (7_130, Exchange.UPCOM, Decimal(100)),
    ],
)
def test_tick_size_boundaries(price: int, exchange: Exchange, expected: Decimal):
    assert tick_size(price, exchange) == expected


def test_directional_tick_rounding():
    assert round_down_to_tick(61_506, Exchange.HOSE) == Decimal(61_500)
    assert round_up_to_tick(57_195, Exchange.HOSE) == Decimal(57_200)


def test_price_limits_round_inward_to_valid_ticks():
    floor, ceiling = daily_price_limits(19_150, Exchange.HOSE)
    assert floor == Decimal(17_850)
    assert ceiling == Decimal(20_450)


@pytest.mark.parametrize(
    ("exchange", "expected"),
    [
        (Exchange.HNX, (Decimal(17_300), Decimal(21_000))),
        (Exchange.UPCOM, (Decimal(16_300), Decimal(22_000))),
    ],
)
def test_non_hose_price_limit_bands(exchange: Exchange, expected: tuple[Decimal, Decimal]):
    assert daily_price_limits(19_150, exchange) == expected


def test_market_price_preserves_basis():
    assert MarketPrice.raw(7_130).basis is PriceBasis.RAW
    assert MarketPrice.adjusted(7_130).basis is PriceBasis.ADJUSTED


def test_market_price_rejects_untyped_basis():
    with pytest.raises(TypeError, match="PriceBasis"):
        MarketPrice(Decimal(7_130), "RAW")  # type: ignore[arg-type]


@pytest.mark.parametrize("invalid", [0, -1, "NaN", "Infinity", "abc"])
@pytest.mark.parametrize(
    "function",
    [
        lambda value: tick_size(value, Exchange.HOSE),
        lambda value: round_down_to_tick(value, Exchange.HOSE),
        lambda value: round_up_to_tick(value, Exchange.HOSE),
        lambda value: daily_price_limits(value, Exchange.HOSE),
    ],
)
def test_price_rule_functions_reject_invalid_values(function, invalid):
    with pytest.raises(ValueError, match="positive finite"):
        function(invalid)


def test_price_rules_reject_untyped_exchange():
    with pytest.raises(TypeError, match="Exchange"):
        tick_size(7_130, "HOSE")  # type: ignore[arg-type]


def test_settlement_and_eod_exit_are_distinct_events():
    assert settlement_session_index(10) == 12
    assert next_morning_eod_exit_index(10) == 13


@pytest.mark.parametrize("function", [settlement_session_index, next_morning_eod_exit_index])
def test_session_indices_reject_negative_entry(function):
    with pytest.raises(ValueError, match="cannot be negative"):
        function(-1)
