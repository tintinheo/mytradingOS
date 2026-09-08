import sqlite3

import pytest

from tintradingos.ingest.index import IndexEODError, parse_vn_index_eod_csv, persist_index_eod

CSV = b"""date,open,high,low,close,source_url
2026-09-04,1300,1310,1295,1305,https://example.test/vnindex/2026-09-04
2026-09-07,1305,1315,1300,1312,https://example.test/vnindex/2026-09-07
"""


def test_index_contract_persists_history_separate_from_equity_ohlcv(tmp_path):
    db = tmp_path / "market.sqlite"

    bars = parse_vn_index_eod_csv(CSV)
    persist_index_eod(db, bars)

    connection = sqlite3.connect(db)
    try:
        assert connection.execute("SELECT COUNT(*) FROM index_eod").fetchone()[0] == 2
        assert (
            connection.execute("SELECT source_url FROM index_eod LIMIT 1")
            .fetchone()[0]
            .startswith("https://")
        )
        assert (
            connection.execute(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'ohlcv'"
            ).fetchone()[0]
            == 0
        )
    finally:
        connection.close()


def test_index_contract_rejects_missing_source_provenance():
    payload = CSV.replace(b"https://example.test/vnindex/2026-09-04", b"")

    with pytest.raises(IndexEODError, match="source_url"):
        parse_vn_index_eod_csv(payload)
