from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from tintradingos.domain.market_rules import Exchange, PriceBasis
from tintradingos.ingest.cafef import (
    CafeFDataset,
    CafeFFormatError,
    build_url,
    parse_price_csv,
)

FIXTURE = Path(__file__).parents[1] / "fixtures" / "cafef_price_sample.csv"


def test_build_daily_url_uses_both_date_formats():
    assert build_url(CafeFDataset.PRICE_ADJUSTED, date(2026, 9, 4)) == (
        "https://cafef1.mediacdn.vn/data/ami_data/20260904/CafeF.SolieuGD.04092026.zip"
    )


def test_build_upto_url_inserts_marker_before_filename_date():
    assert build_url(CafeFDataset.PRICE_RAW, date(2026, 9, 4), full_history=True) == (
        "https://cafef1.mediacdn.vn/data/ami_data/20260904/CafeF.SolieuGD.Raw.Upto04092026.zip"
    )


def test_parse_real_cafef_fixture_normalizes_price_to_vnd():
    bars = parse_price_csv(
        FIXTURE.read_bytes(),
        exchange=Exchange.HOSE,
        basis=PriceBasis.ADJUSTED,
        source_name=FIXTURE.name,
    )

    assert len(bars) == 4
    assert bars[0].symbol == "AAA"
    assert bars[0].trading_date == date(2026, 9, 4)
    assert bars[0].basis is PriceBasis.ADJUSTED
    assert bars[0].open_vnd == Decimal("7090.00")
    assert bars[0].close_vnd == Decimal("7130.00")
    assert bars[0].volume == 1_072_600


@pytest.mark.parametrize(
    ("row", "message"),
    [
        ("AAA,20260904,7.09,7.00,7.08,7.13,100", "OHLC invariants"),
        ("AAA,20260904,7.09,7.19,7.08,7.13,-1", "volume cannot be negative"),
        ("AAA,2026-09-04,7.09,7.19,7.08,7.13,100", "exactly 8 digits"),
    ],
)
def test_parse_rejects_invalid_rows(row: str, message: str):
    payload = (
        ",".join(["<Ticker>", "<DTYYYYMMDD>", "<Open>", "<High>", "<Low>", "<Close>", "<Volume>"])
        + f"\n{row}\n"
    )

    with pytest.raises(CafeFFormatError, match=message):
        parse_price_csv(payload, exchange=Exchange.HOSE, basis=PriceBasis.ADJUSTED)


def test_parse_rejects_unverified_schema_instead_of_guessing_column_meaning():
    payload = "<Ticker>,<Date>,<BuyVolume>\nAAA,20260904,100\n"

    with pytest.raises(CafeFFormatError, match="unexpected headers"):
        parse_price_csv(payload, exchange=Exchange.HOSE, basis=PriceBasis.ADJUSTED)


def test_parse_rejects_dates_without_exactly_eight_digits():
    payload = FIXTURE.read_text(encoding="utf-8").replace("20260904", "202694", 1)

    with pytest.raises(CafeFFormatError, match="exactly 8 digits"):
        parse_price_csv(payload, exchange=Exchange.HOSE, basis=PriceBasis.RAW)


@pytest.mark.parametrize(
    "payload",
    [
        b"\xef\xbb\xbf" + FIXTURE.read_bytes(),
        "\ufeff" + FIXTURE.read_text(encoding="utf-8"),
    ],
)
def test_parse_accepts_utf8_bom(payload: bytes | str):
    bars = parse_price_csv(payload, exchange=Exchange.HOSE, basis=PriceBasis.RAW)
    assert bars[0].symbol == "AAA"


def test_parse_wraps_invalid_utf8():
    with pytest.raises(CafeFFormatError, match="not valid UTF-8"):
        parse_price_csv(b"\xff\xfe", exchange=Exchange.HOSE, basis=PriceBasis.RAW)


def test_parse_rejects_header_only_payload():
    header = FIXTURE.read_text(encoding="utf-8").splitlines()[0] + "\n"

    with pytest.raises(CafeFFormatError, match="contains no data rows"):
        parse_price_csv(header, exchange=Exchange.HOSE, basis=PriceBasis.RAW)


def test_parse_detects_duplicate_after_ticker_normalization():
    lines = FIXTURE.read_text(encoding="utf-8").splitlines()
    payload = "\n".join([lines[0], lines[1].replace("AAA", " aaa "), lines[1]])

    with pytest.raises(CafeFFormatError, match="duplicate symbol and date"):
        parse_price_csv(payload, exchange=Exchange.HOSE, basis=PriceBasis.RAW)


@pytest.mark.parametrize(
    ("row", "message"),
    [
        ("AAA,20260904,7.09,7.19,7.08,7.13", "column count"),
        ("AA-A,20260904,7.09,7.19,7.08,7.13,100", "invalid ticker"),
    ],
)
def test_parse_rejects_invalid_row_shape_and_ticker(row: str, message: str):
    header = FIXTURE.read_text(encoding="utf-8").splitlines()[0]

    with pytest.raises(CafeFFormatError, match=message):
        parse_price_csv(f"{header}\n{row}\n", exchange=Exchange.HOSE, basis=PriceBasis.RAW)
