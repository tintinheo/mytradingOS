import math

import pytest

from tintradingos.indicators.core import (
    atr_wilder,
    ema,
    percentile_rank,
    relative_strength,
    rsi_wilder,
    sma,
)


def test_sma_and_ema_have_nan_warmup_and_expected_last_values():
    values = [1.0, 2.0, 3.0, 4.0, 5.0]

    moving_average = sma(values, 3)
    exponential = ema(values, 3)

    assert math.isnan(moving_average[0])
    assert moving_average[-1] == pytest.approx(4.0)
    assert exponential[-1] == pytest.approx(4.0)


def test_rsi_returns_high_value_for_uninterrupted_rise():
    result = rsi_wilder([float(value) for value in range(1, 20)], 5)

    assert result[-1] == pytest.approx(100.0)


def test_rsi_seed_returns_zero_for_uninterrupted_decline():
    result = rsi_wilder([float(value) for value in range(20, 1, -1)], 5)

    assert result[5] == pytest.approx(0.0)


def test_atr_wilder_is_positive_after_warmup():
    close = [10.0, 11.0, 12.0, 11.0, 13.0, 14.0]
    high = [value + 0.5 for value in close]
    low = [value - 0.5 for value in close]

    result = atr_wilder(high, low, close, 3)

    assert math.isnan(result[0])
    assert result[-1] > 0


def test_relative_strength_and_percentile_rank():
    assert relative_strength([10, 11, 12, 13], [10, 10, 10, 10], 3) == pytest.approx(0.3)
    assert percentile_rank(3, [1, 2, 3, 4]) == pytest.approx(75.0)


def test_rsi_flat_series_is_neutral():
    result = rsi_wilder([10.0] * 10, 3)
    assert result[-1] == pytest.approx(50.0)


def test_indicator_functions_reject_short_or_invalid_series():
    with pytest.raises(ValueError):
        rsi_wilder([1.0, 2.0], 3)
    with pytest.raises(ValueError):
        atr_wilder([1.0], [1.0], [1.0], 1)
    with pytest.raises(ValueError):
        atr_wilder([1.0, 1.0], [1.0, 1.0], [1.0, 1.0], 0)
    with pytest.raises(ValueError):
        relative_strength([1.0, 2.0], [1.0], 1)
    with pytest.raises(ValueError):
        percentile_rank(float("nan"), [1.0])


@pytest.mark.parametrize("window", [0, -1, 10])
def test_sma_rejects_invalid_window(window):
    with pytest.raises(ValueError):
        sma([1.0, 2.0, 3.0], window)
