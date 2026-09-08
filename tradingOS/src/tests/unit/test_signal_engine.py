from datetime import date

from tintradingos.signals.engine import Regime, SignalEngine, compute_regime


def candidate(symbol="AAA"):
    return {
        "symbol": symbol,
        "exchange": "HOSE",
        "cluster": "C5_DEFENSIVE",
        "features": {
            "n_obs": 400,
            "adv20_bn": 100,
            "anomaly_score": 10,
            "rs126_rank": 75,
            "rs20_rank": 25,
            "ma20": 100_000,
            "ma50": 95_000,
            "ma200": 80_000,
            "ma_slope50": 0.01,
            "close": 99_000,
            "dist_ma20": -0.01,
            "rsi14": 40,
            "vol_ratio_3": 0.8,
            "vol_ratio": 1.2,
            "trigger_candle": True,
            "atr14": 3_000,
            "structure_low": 94_000,
            "technical_score": 75,
            "win_probability": None,
            "regime": "UPTREND",
        },
    }


def portfolio():
    return {"held_symbols": set(), "positions": [], "max_positions": 10, "max_signals": 3}


def test_compute_regime_uses_conservative_lower_index_score():
    result = compute_regime(
        {"close": 110, "ma50": 100, "ma200": 90},
        {"close": 90, "ma50": 100, "ma200": 95},
        {"pct_above_ma50": 0.50, "ad_line_slope_10": 1},
    )

    assert result is Regime.SIDEWAY


def test_engine_generates_paper_signal_with_dual_stops():
    signals = SignalEngine(nav=1_000_000_000, available_cash=500_000_000).run(
        date(2026, 9, 7), Regime.UPTREND, [candidate()], portfolio()
    )

    assert len(signals) == 1
    signal = signals[0]
    assert signal.setup == "PB_MA20"
    assert signal.entry > signal.exit_stop > signal.sizing_stop
    assert signal.quantity % 100 == 0
    assert signal.uncalibrated is True


def test_downtrend_aborts_all_candidates_with_rejections():
    engine = SignalEngine(nav=1_000_000_000, available_cash=500_000_000)

    assert engine.run(date(2026, 9, 7), Regime.DOWNTREND, [candidate()], portfolio()) == []
    assert engine.rejections[0].gate == "G0"


def test_failed_dual_rs_is_recorded_at_gate_four():
    bad = candidate()
    bad["features"] = bad["features"] | {"rs20_rank": 70}
    engine = SignalEngine(nav=1_000_000_000, available_cash=500_000_000)

    assert engine.run(date(2026, 9, 7), Regime.UPTREND, [bad], portfolio()) == []
    assert engine.rejections[0].gate == "G4"


def test_c3_is_rejected_until_momentum_setup_is_implemented():
    high_beta = candidate() | {"cluster": "C3_HIGH_BETA"}
    engine = SignalEngine(nav=1_000_000_000, available_cash=500_000_000)

    assert engine.run(date(2026, 9, 7), Regime.STRONG_UPTREND, [high_beta], portfolio()) == []
    assert engine.rejections[0].gate == "G3"


def test_signal_engine_records_data_and_universe_rejections():
    engine = SignalEngine(nav=1_000_000_000, available_cash=500_000_000)
    malformed = {"symbol": "BAD"}
    illiquid = candidate("ILLQ")
    illiquid["features"] = illiquid["features"] | {"n_obs": 10}

    assert engine.run(date(2026, 9, 7), Regime.UPTREND, [malformed, illiquid], portfolio()) == []
    assert [item.gate for item in engine.rejections] == ["DATA", "G1"]


def test_signal_engine_records_anomaly_regime_and_portfolio_rejections():
    anomalous = candidate("ANOM")
    anomalous["features"] = anomalous["features"] | {"anomaly_score": 70}
    engine = SignalEngine(nav=1_000_000_000, available_cash=500_000_000)
    assert engine.run(date(2026, 9, 7), Regime.UPTREND, [anomalous], portfolio()) == []
    assert engine.rejections[0].gate == "G2"

    weak_regime = SignalEngine(nav=1_000_000_000, available_cash=500_000_000)
    weak_candidate = candidate() | {"cluster": "C6_VOLATILE"}
    assert (
        weak_regime.run(date(2026, 9, 7), Regime.MILD_CORRECTION, [weak_candidate], portfolio())
        == []
    )
    assert weak_regime.rejections[0].gate == "G3"

    held = SignalEngine(nav=1_000_000_000, available_cash=500_000_000)
    held_portfolio = portfolio() | {"held_symbols": {"AAA"}}
    assert held.run(date(2026, 9, 7), Regime.UPTREND, [candidate()], held_portfolio) == []
    assert held.rejections[0].gate == "G6"


def test_signal_engine_rejects_missing_score_instead_of_defaulting_to_pass():
    incomplete = candidate()
    del incomplete["features"]["technical_score"]
    engine = SignalEngine(nav=1_000_000_000, available_cash=500_000_000)

    assert engine.run(date(2026, 9, 7), Regime.UPTREND, [incomplete], portfolio()) == []
    assert engine.rejections[0].reason == "technical_score is missing"
