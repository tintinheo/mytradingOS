"""Deterministic research signals, next-open backtest, and separate scenarios."""

from __future__ import annotations

import math
from dataclasses import dataclass

from feeds import Bar, DataError, validate_bars


@dataclass(frozen=True)
class Settings:
    strategy: str = "sma"
    fast: int = 10
    slow: int = 30
    lookback: int = 20
    stop_pct: float = 7.0
    target_pct: float = 18.0
    risk_pct: float = 1.0
    fee_pct: float = 0.25
    volume_multiple: float = 0.0

    def validate(self) -> None:
        bounds = (("fast", 2, 100), ("slow", 3, 250), ("lookback", 5, 100),
                  ("stop_pct", 0.5, 50), ("target_pct", 0, 100),
                  ("risk_pct", 0.1, 10), ("fee_pct", 0, 5))
        for name, low, high in bounds:
            value = getattr(self, name)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                raise DataError(f"{name} must be in [{low}, {high}]")
        if self.strategy not in {"sma", "breakout", "hold"}:
            raise DataError("Unknown strategy")
        if self.strategy == "sma" and self.fast >= self.slow:
            raise DataError("Fast MA must be shorter than slow MA")
        if self.volume_multiple not in {0.0, 1.0, 1.5}:
            raise DataError("Unknown volume filter")


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def signals(bars: list[Bar], p: Settings) -> list[dict[str, bool]]:
    p.validate()
    out = []
    for i, bar in enumerate(bars):
        buy = sell = False
        if p.strategy == "hold":
            buy = i == 0
        elif p.strategy == "sma" and i >= p.slow:
            now_fast = mean([b.close for b in bars[i - p.fast + 1:i + 1]])
            now_slow = mean([b.close for b in bars[i - p.slow + 1:i + 1]])
            prev_fast = mean([b.close for b in bars[i - p.fast:i]])
            prev_slow = mean([b.close for b in bars[i - p.slow:i]])
            buy = prev_fast <= prev_slow and now_fast > now_slow
            sell = prev_fast >= prev_slow and now_fast < now_slow
        elif p.strategy == "breakout" and i >= p.lookback:
            prior = [b.close for b in bars[i - p.lookback:i]]
            buy = bar.close > max(prior)
            sell = bar.close < min(prior)
        if buy and p.volume_multiple:
            baseline = mean([b.volume for b in bars[i - 20:i]]) if i >= 20 else 0
            buy = baseline > 0 and bar.volume >= baseline * p.volume_multiple
        out.append({"buy": buy, "sell": sell})
    return out


def backtest(bars: list[Bar], p: Settings) -> dict:
    p.validate()
    bars = validate_bars(bars)
    sig = signals(bars, p)
    fee, stop, target = p.fee_pct / 100, p.stop_pct / 100, p.target_pct / 100
    cash, shares, entry, pending = 100.0, 0.0, None, None
    peak, drawdown, equity, trades = 100.0, 0.0, [], []
    for i, bar in enumerate(bars):
        if pending == "sell" and shares > 0:
            proceeds = shares * bar.open * (1 - fee)
            cash += proceeds
            trades.append({"entry_date": entry["date"], "exit_date": bar.date,
                           "entry": entry["price"], "exit": bar.open, "reason": "Signal",
                           "net_pct": 100 * (proceeds / entry["cost"] - 1)})
            shares, entry = 0.0, None
        elif pending == "buy" and shares == 0:
            exposure = min(1.0, (p.risk_pct / 100) / stop)
            shares = cash * exposure / (1 + fee) / bar.open
            cost = shares * bar.open * (1 + fee)
            cash -= cost
            entry = {"date": bar.date, "price": bar.open, "cost": cost}
        pending = None
        if shares > 0:
            stop_price = entry["price"] * (1 - stop)
            target_price = entry["price"] * (1 + target)
            if bar.open <= stop_price:
                exit_price, reason = bar.open, "Stop gap"
            elif target and bar.open >= target_price:
                exit_price, reason = bar.open, "Target gap"
            elif bar.low <= stop_price:
                exit_price, reason = stop_price, "Stop"
            elif target and bar.high >= target_price:
                exit_price, reason = target_price, "Target"
            else:
                exit_price = reason = None
            if exit_price is not None:
                proceeds = shares * exit_price * (1 - fee)
                cash += proceeds
                trades.append({"entry_date": entry["date"], "exit_date": bar.date,
                               "entry": entry["price"], "exit": exit_price, "reason": reason,
                               "net_pct": 100 * (proceeds / entry["cost"] - 1)})
                shares, entry = 0.0, None
        value = cash + shares * bar.close
        peak = max(peak, value)
        drawdown = max(drawdown, 100 * (1 - value / peak))
        equity.append({"date": bar.date, "equity": value})
        if i < len(bars) - 1:
            if shares > 0 and sig[i]["sell"]:
                pending = "sell"
            elif shares == 0 and sig[i]["buy"]:
                pending = "buy"
    wins = [t for t in trades if t["net_pct"] > 0]
    baseline = 100 * bars[-1].close / bars[1].open * (1 - fee) ** 2
    return {"equity": equity, "trades": trades, "return_pct": equity[-1]["equity"] - 100,
            "buy_hold_pct": baseline - 100, "max_drawdown_pct": drawdown,
            "win_rate_pct": 100 * len(wins) / len(trades) if trades else None,
            "open_position": shares > 0, "signal": sig[-1], "last_close": bars[-1].close}


def forecast(bars: list[Bar], method: str, horizon: int = 10) -> list[dict]:
    if method == "none" or len(bars) < 21:
        return []
    if method not in {"momentum", "reversion"} or not 1 <= horizon <= 30:
        raise DataError("Unknown forecast configuration")
    closes = [bar.close for bar in bars[-21:]]
    returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    drift = mean(returns)
    sd = math.sqrt(mean([(ret - drift) ** 2 for ret in returns]))
    last, recent = closes[-1], mean(closes[-20:])
    points = []
    for step in range(1, horizon + 1):
        center = last * math.exp(drift * step) if method == "momentum" else recent + (last - recent) * (0.9 ** step)
        spread = sd * math.sqrt(step)
        points.append({"session": step, "scenario_close": center,
                       "illustrative_low": center * math.exp(-spread),
                       "illustrative_high": center * math.exp(spread)})
    return points
