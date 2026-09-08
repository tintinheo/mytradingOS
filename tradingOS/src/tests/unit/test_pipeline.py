import io
import sqlite3
import zipfile
from datetime import date
from pathlib import Path

import pytest

from tintradingos.domain.market_rules import PriceBasis
from tintradingos.ingest.cafef import CafeFDataset
from tintradingos.ingest.pipeline import (
    DataQualityError,
    parse_price_zip,
    persist_bars,
    run_price_pipeline,
    validate_raw_adjusted_alignment,
)

FIXTURE = Path(__file__).parents[1] / "fixtures" / "cafef_price_sample.csv"


def make_zip() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("CafeF.HSX.04.09.2026.csv", FIXTURE.read_bytes())
    return output.getvalue()


def make_raw_zip() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("CafeF.RAW_HSX.04.09.2026.csv", FIXTURE.read_bytes())
    return output.getvalue()


def test_parse_price_zip_assigns_hose_and_basis():
    bars = parse_price_zip(make_zip(), basis=PriceBasis.RAW)

    assert len(bars) == 4
    assert {bar.exchange.value for bar in bars} == {"HOSE"}
    assert {bar.basis for bar in bars} == {PriceBasis.RAW}


def test_parse_raw_price_zip_accepts_cafef_raw_exchange_names():
    bars = parse_price_zip(make_raw_zip(), basis=PriceBasis.RAW)

    assert len(bars) == 4
    assert {bar.exchange.value for bar in bars} == {"HOSE"}


def test_pipeline_persists_idempotently(tmp_path):
    db_path = tmp_path / "market.sqlite"
    first = run_price_pipeline(
        make_zip(),
        dataset=CafeFDataset.PRICE_RAW,
        basis=PriceBasis.RAW,
        db_path=db_path,
    )
    second = run_price_pipeline(
        make_zip(),
        dataset=CafeFDataset.PRICE_RAW,
        basis=PriceBasis.RAW,
        db_path=db_path,
    )

    assert first.rows == second.rows == 4
    connection = sqlite3.connect(db_path)
    try:
        assert connection.execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0] == 4
    finally:
        connection.close()


def test_pipeline_rejects_non_price_dataset(tmp_path):
    with pytest.raises(DataQualityError, match="price datasets only"):
        run_price_pipeline(
            make_zip(),
            dataset=CafeFDataset.ORDER_FLOW_AND_FOREIGN,
            basis=PriceBasis.RAW,
            db_path=tmp_path / "market.sqlite",
        )


def test_download_rejects_invalid_timeout():
    from tintradingos.ingest.pipeline import download_cafef_zip

    with pytest.raises(ValueError, match="timeout_seconds"):
        download_cafef_zip(CafeFDataset.PRICE_RAW, date(2026, 9, 4), timeout_seconds=0)


def test_download_wraps_network_error(monkeypatch):
    from tintradingos.ingest import pipeline

    def fail(*args, **kwargs):
        raise OSError("offline")

    monkeypatch.setattr(pipeline.urllib.request, "urlopen", fail)
    with pytest.raises(DataQualityError, match="download failed"):
        pipeline.download_cafef_zip(CafeFDataset.PRICE_RAW, date(2026, 9, 4))


def test_parse_price_zip_rejects_bad_zip():
    with pytest.raises(DataQualityError, match="invalid ZIP"):
        parse_price_zip(b"not-a-zip", basis=PriceBasis.RAW)


def test_raw_adjusted_alignment_rejects_missing_coverage():
    raw = parse_price_zip(make_zip(), basis=PriceBasis.RAW)
    adjusted = raw[:-1]

    with pytest.raises(DataQualityError, match="coverage mismatch"):
        validate_raw_adjusted_alignment(raw, adjusted)


def test_persist_rejects_duplicate_bars(tmp_path):
    bars = parse_price_zip(make_zip(), basis=PriceBasis.RAW)

    with pytest.raises(DataQualityError, match="duplicate bar"):
        persist_bars(tmp_path / "market.sqlite", (*bars, bars[0]))
