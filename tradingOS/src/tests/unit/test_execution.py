from decimal import Decimal

import pytest

from tintradingos.backtest.execution import FillPolicy, FillReason, simulate_limit_entry
from tintradingos.domain.market_rules import Exchange, MarketPrice

BASE = {
    "signal_close": MarketPrice.raw(61_200),
    "next_open": MarketPrice.raw(61_400),
    "next_high": MarketPrice.raw(62_000),
    "next_low": MarketPrice.raw(61_300),
    "next_ceiling": MarketPrice.raw(65_400),
    "exchange": Exchange.HOSE,
    "premium": "0.005",
    "max_gap": "0.02",
    "fill_policy": FillPolicy.TRADE_THROUGH_CONSERVATIVE,
}


def test_limit_fill_uses_t_plus_one_open_when_it_is_better_than_limit():
    result = simulate_limit_entry(**BASE)

    assert result.filled is True
    assert result.limit_price_vnd == Decimal(61_500)
    assert result.price_vnd == Decimal(61_400)
    assert result.price_vnd != BASE["signal_close"].value_vnd
    assert result.reason is FillReason.FILLED


def test_limit_fill_uses_limit_after_opening_above_it_and_trading_through():
    result = simulate_limit_entry(
        **(
            BASE
            | {
                "next_open": MarketPrice.raw(61_800),
                "next_low": MarketPrice.raw(61_499),
            }
        )
    )

    assert result.filled is True
    assert result.price_vnd == Decimal(61_500)


def test_limit_does_not_fill_when_t_plus_one_low_never_reaches_it():
    result = simulate_limit_entry(
        **(
            BASE
            | {
                "next_open": MarketPrice.raw(61_800),
                "next_low": MarketPrice.raw(61_600),
            }
        )
    )

    assert result.filled is False
    assert result.price_vnd is None
    assert result.reason is FillReason.LIMIT_NOT_REACHED


def test_gap_above_threshold_cancels_before_fill_evaluation():
    result = simulate_limit_entry(
        **(
            BASE
            | {
                "next_open": MarketPrice.raw(62_500),
                "next_high": MarketPrice.raw(62_800),
                "next_low": MarketPrice.raw(61_300),
            }
        )
    )

    assert result.filled is False
    assert result.reason is FillReason.GAP_EXCEEDED
    assert result.overnight_gap > Decimal("0.02")


def test_gap_exactly_at_threshold_is_not_cancelled():
    result = simulate_limit_entry(
        **(
            BASE
            | {
                "next_open": MarketPrice.raw(62_424),
                "next_high": MarketPrice.raw(62_500),
                "next_low": MarketPrice.raw(61_499),
            }
        )
    )

    assert result.reason is FillReason.FILLED


def test_open_and_low_at_published_ceiling_is_unfillable():
    result = simulate_limit_entry(
        **(
            BASE
            | {
                "next_open": MarketPrice.raw(65_400),
                "next_high": MarketPrice.raw(65_400),
                "next_low": MarketPrice.raw(65_400),
                "max_gap": "0.10",
            }
        )
    )

    assert result.filled is False
    assert result.reason is FillReason.OPENED_AT_CEILING


def test_limit_near_published_ceiling_is_rejected():
    result = simulate_limit_entry(
        **(
            BASE
            | {
                "next_ceiling": MarketPrice.raw(61_800),
                "next_open": MarketPrice.raw(61_400),
                "next_high": MarketPrice.raw(61_800),
            }
        )
    )

    assert result.filled is False
    assert result.reason is FillReason.LIMIT_TOO_CLOSE_TO_CEILING


def test_touch_policy_is_explicitly_more_optimistic_than_trade_through():
    prices = {
        "next_open": MarketPrice.raw(61_800),
        "next_low": MarketPrice.raw(61_500),
    }

    optimistic = simulate_limit_entry(
        **(BASE | prices | {"fill_policy": FillPolicy.TOUCH_OPTIMISTIC})
    )
    conservative = simulate_limit_entry(
        **(BASE | prices | {"fill_policy": FillPolicy.TRADE_THROUGH_CONSERVATIVE})
    )

    assert optimistic.reason is FillReason.FILLED
    assert conservative.reason is FillReason.LIMIT_NOT_REACHED


def test_execution_rejects_adjusted_prices():
    with pytest.raises(ValueError, match="requires RAW prices"):
        simulate_limit_entry(**(BASE | {"signal_close": MarketPrice.adjusted(61_200)}))


def test_open_at_ceiling_can_fill_after_trading_below_ceiling():
    result = simulate_limit_entry(
        **(
            BASE
            | {
                "next_open": MarketPrice.raw(65_400),
                "next_high": MarketPrice.raw(65_400),
                "next_low": MarketPrice.raw(61_499),
                "max_gap": "0.10",
            }
        )
    )

    assert result.reason is FillReason.FILLED


@pytest.mark.parametrize(
    ("override", "exception", "message"),
    [
        ({"signal_close": 0}, TypeError, "MarketPrice"),
        ({"next_open": "NaN"}, TypeError, "MarketPrice"),
        ({"premium": -0.01}, ValueError, "premium"),
        ({"premium": "abc"}, ValueError, "premium"),
        ({"max_gap": 1}, ValueError, "max_gap"),
        (
            {"next_low": MarketPrice.raw(61_900), "next_open": MarketPrice.raw(61_800)},
            ValueError,
            "low <= open <= high",
        ),
        ({"next_ceiling": MarketPrice.raw(61_000)}, ValueError, "cannot be below"),
        ({"fill_policy": "TOUCH_OPTIMISTIC"}, TypeError, "FillPolicy"),
    ],
)
def test_execution_rejects_invalid_inputs(
    override: dict,
    exception: type[Exception],
    message: str,
):
    with pytest.raises(exception, match=message):
        simulate_limit_entry(**(BASE | override))
