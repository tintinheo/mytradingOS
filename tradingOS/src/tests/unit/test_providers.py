import sqlite3
from datetime import date
from pathlib import Path

import pytest

from tintradingos.domain.market_rules import Exchange, PriceBasis
from tintradingos.ingest.pipeline import persist_provider_bars
from tintradingos.ingest.providers import (
    CafeFHistoryProvider,
    DnseProvider,
    Provider,
    ProviderBar,
    ProviderCapability,
    ProviderError,
    SsiSnapshotProvider,
    TcbsHistoryProvider,
    VciHistoryProvider,
    provider_for,
)


@pytest.mark.parametrize("provider", [Provider.SSI, Provider.DNSE])
def test_unverified_non_historical_providers_fail_closed(provider):
    with pytest.raises(ProviderError):
        provider_for(provider).fetch("AAA", date(2025, 1, 1))


def test_provider_capabilities_are_explicit():
    assert SsiSnapshotProvider.capability is ProviderCapability.SNAPSHOT_ONLY
    assert DnseProvider.capability is ProviderCapability.UNVERIFIED
    assert TcbsHistoryProvider.capability is ProviderCapability.HISTORICAL_OHLCV
    assert VciHistoryProvider.capability is ProviderCapability.HISTORICAL_OHLCV


def test_cafef_history_parser_normalizes_thousand_vnd_row():
    row = ["07/09/2026", "61.2", "+0.2", "1,000", "61,200", "61.0", "62.0", "60.5"]

    parsed = CafeFHistoryProvider._parse_row(row, "AAA", "https://cafef.example")

    assert parsed is not None
    assert parsed.close_vnd == 61_200
    assert parsed.open_vnd == 61_000
    assert parsed.high_vnd == 62_000
    assert parsed.low_vnd == 60_500
    assert parsed.volume == 1000


def test_tcbs_parser_scales_x1000_payload():
    bars = TcbsHistoryProvider._parse_bars(
        "FPT",
        "https://tcbs.example",
        [
            {
                "tradingDate": "2026-09-07",
                "open": 100.0,
                "high": 102.0,
                "low": 99.0,
                "close": 101.0,
                "volume": 1000,
            }
        ],
    )

    assert bars[0].close_vnd == 101_000


def test_vci_parser_accepts_short_columns_and_scales_x1000_payload():
    bars = VciHistoryProvider._parse_bars(
        "FPT",
        "https://vci.example",
        [{"t": "2026-09-07", "o": 10.0, "h": 10.2, "l": 9.9, "c": 10.1, "v": 1000}],
    )

    assert bars[0].close_vnd == 10_100


def test_provider_bars_import_into_warehouse_with_provenance(tmp_path: Path):
    db_path = tmp_path / "market.sqlite"
    bars = (
        ProviderBar(
            "AAA",
            date(2026, 9, 7),
            Exchange.HOSE,
            100_000,
            101_000,
            99_000,
            100_500,
            1000,
            Provider.TCBS,
            "https://tcbs.example",
            PriceBasis.RAW,
        ),
    )

    assert persist_provider_bars(db_path, bars) == 1
    connection = sqlite3.connect(db_path)
    try:
        assert connection.execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0] == 1
        assert connection.execute("SELECT provider FROM provider_runs").fetchone()[0] == "TCBS"
    finally:
        connection.close()
