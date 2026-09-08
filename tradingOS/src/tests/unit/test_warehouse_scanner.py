import sqlite3
from datetime import date, timedelta

from tintradingos.scanner.warehouse import scan_warehouse
from tintradingos.signals.engine import Cluster, Regime


def seed_db(path, count=280):
    connection = sqlite3.connect(path)
    connection.execute(
        """
        CREATE TABLE ohlcv (
            symbol TEXT, trading_date TEXT, exchange TEXT, basis TEXT,
            open_vnd TEXT, high_vnd TEXT, low_vnd TEXT, close_vnd TEXT,
            volume INTEGER, PRIMARY KEY(symbol, trading_date, basis)
        )
        """
    )
    connection.execute(
        """CREATE TABLE index_eod (
        index_code TEXT, trading_date TEXT, open TEXT, high TEXT, low TEXT,
        close TEXT, source_url TEXT, PRIMARY KEY(index_code, trading_date))"""
    )
    start = date(2025, 1, 1)
    for index in range(count):
        day = start + timedelta(days=index)
        close = 100_000 + index * 10
        connection.execute(
            "INSERT INTO ohlcv VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "AAA",
                day.isoformat(),
                "HOSE",
                "RAW",
                str(close),
                str(close + 100),
                str(close - 100),
                str(close),
                1_000_000,
            ),
        )
        index_close = 1_000 + index * 2
        connection.execute(
            "INSERT INTO index_eod VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "VNINDEX",
                day.isoformat(),
                str(index_close),
                str(index_close),
                str(index_close),
                str(index_close),
                "https://example.test/vnindex",
            ),
        )
    connection.commit()
    connection.close()


def test_scanner_rejects_missing_cluster_metadata(tmp_path):
    db = tmp_path / "market.sqlite"
    seed_db(db)

    report = scan_warehouse(
        db,
        universe={"AAA"},
        cluster_by_symbol={},
        nav=1_000_000_000,
        available_cash=500_000_000,
    )

    assert report.signals == ()
    assert report.rejections[0].gate == "DATA_MISSING"


def test_scanner_requires_minimum_history(tmp_path):
    db = tmp_path / "market.sqlite"
    seed_db(db, count=200)

    report = scan_warehouse(
        db,
        universe={"AAA"},
        cluster_by_symbol={"AAA": Cluster.C5_DEFENSIVE},
        nav=1_000_000_000,
        available_cash=500_000_000,
    )

    assert report.eligible_count == 0
    assert report.rejections[0].gate == "G1"


def test_scanner_computes_regime_and_breadth_from_separate_index_history(tmp_path):
    db = tmp_path / "market.sqlite"
    seed_db(db)

    report = scan_warehouse(
        db,
        universe={"AAA"},
        cluster_by_symbol={"AAA": Cluster.C5_DEFENSIVE},
        nav=1_000_000_000,
        available_cash=500_000_000,
    )

    assert report.regime is Regime.STRONG_UPTREND
    assert report.regime_inputs is not None
    assert report.regime_inputs.breadth["pct_above_ma50"] == 1
    assert report.regime_inputs.breadth["ad_line_slope_10"] > 0


def test_scanner_fails_closed_without_separate_index_history(tmp_path):
    db = tmp_path / "market.sqlite"
    seed_db(db, count=199)

    report = scan_warehouse(
        db,
        universe={"AAA"},
        cluster_by_symbol={"AAA": Cluster.C5_DEFENSIVE},
        nav=1_000_000_000,
        available_cash=500_000_000,
    )

    assert report.regime is None
    assert report.rejections[0].gate == "MARKET_DATA"
