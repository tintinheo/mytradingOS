"""Execution-aware backtesting primitives."""

from tintradingos.backtest.runner import (
    BacktestArtifact,
    BacktestConfig,
    BrokerCosts,
    TradeResult,
    run_backtest,
)

__all__ = ["BacktestArtifact", "BacktestConfig", "BrokerCosts", "TradeResult", "run_backtest"]
