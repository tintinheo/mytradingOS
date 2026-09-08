"""Deterministic indicators without TA-Lib or compiled dependencies."""

from __future__ import annotations

from math import isnan


def _validate_window(values: list[float], window: int) -> None:
    if window <= 0:
        raise ValueError("window must be positive")
    if len(values) < window:
        raise ValueError("values shorter than window")


def sma(values: list[float], window: int) -> list[float]:
    """Return a same-length SMA series with NaN warmup values."""
    _validate_window(values, window)
    output = [float("nan")] * len(values)
    rolling = sum(values[:window])
    output[window - 1] = rolling / window
    for index in range(window, len(values)):
        rolling += values[index] - values[index - window]
        output[index] = rolling / window
    return output


def ema(values: list[float], window: int) -> list[float]:
    """Return EMA seeded with the first SMA window."""
    _validate_window(values, window)
    output = [float("nan")] * len(values)
    current = sum(values[:window]) / window
    output[window - 1] = current
    alpha = 2.0 / (window + 1)
    for index in range(window, len(values)):
        current = alpha * values[index] + (1 - alpha) * current
        output[index] = current
    return output


def rsi_wilder(values: list[float], window: int = 14) -> list[float]:
    """Return Wilder RSI with neutral 50 only for a flat seed/window."""
    if window <= 0 or len(values) <= window:
        raise ValueError("values must contain more than window observations")
    gains = [max(values[index] - values[index - 1], 0.0) for index in range(1, len(values))]
    losses = [max(values[index - 1] - values[index], 0.0) for index in range(1, len(values))]
    output = [float("nan")] * len(values)
    average_gain = sum(gains[:window]) / window
    average_loss = sum(losses[:window]) / window
    output[window] = (
        100.0
        if average_loss == 0 and average_gain > 0
        else (50.0 if average_loss == 0 else 100 - 100 / (1 + average_gain / average_loss))
    )
    for index in range(window + 1, len(values)):
        gain = gains[index - 1]
        loss = losses[index - 1]
        average_gain = (average_gain * (window - 1) + gain) / window
        average_loss = (average_loss * (window - 1) + loss) / window
        output[index] = (
            100.0
            if average_loss == 0 and average_gain > 0
            else (50.0 if average_loss == 0 else 100 - 100 / (1 + average_gain / average_loss))
        )
    return output


def atr_wilder(
    high: list[float], low: list[float], close: list[float], window: int = 14
) -> list[float]:
    """Return Wilder ATR with NaN warmup values."""
    if window <= 0 or not len(high) == len(low) == len(close) or len(close) <= window:
        raise ValueError("OHLC series must have equal length greater than window")
    true_ranges = [high[0] - low[0]]
    for index in range(1, len(close)):
        true_ranges.append(
            max(
                high[index] - low[index],
                abs(high[index] - close[index - 1]),
                abs(low[index] - close[index - 1]),
            )
        )
    output = [float("nan")] * len(close)
    current = sum(true_ranges[:window]) / window
    output[window - 1] = current
    for index in range(window, len(close)):
        current = (current * (window - 1) + true_ranges[index]) / window
        output[index] = current
    return output


def relative_strength(close: list[float], index: list[float], window: int) -> float:
    """Return stock return relative to the reference index."""
    if window <= 0 or len(close) <= window or len(index) != len(close):
        raise ValueError("close and index need equal length greater than window")
    if close[-1] <= 0 or close[-window - 1] <= 0 or index[-1] <= 0 or index[-window - 1] <= 0:
        raise ValueError("prices must be positive")
    return (close[-1] / close[-window - 1]) / (index[-1] / index[-window - 1]) - 1


def percentile_rank(value: float, population: list[float]) -> float:
    """Return inclusive percentile rank on a 0-100 scale."""
    if not population or isnan(value):
        raise ValueError("population and value must be valid")
    return 100.0 * sum(item <= value for item in population) / len(population)
