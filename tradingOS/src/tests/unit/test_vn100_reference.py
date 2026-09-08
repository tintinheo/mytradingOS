from datetime import date

import pytest

from tintradingos.reference.vn100 import VN100SnapshotError, parse_vn100_snapshot_csv
from tintradingos.signals.engine import Cluster

HEADER = "symbol,exchange,cluster,effective_from,effective_to,source\n"


def test_vn100_snapshot_selects_only_rows_active_on_scan_date():
    payload = (
        HEADER
        + "AAA,HOSE,C5_DEFENSIVE,2026-01-01,2026-06-30,https://official.example/june\n"
        + "BBB,HOSE,C2_BANK,2026-07-01,,https://official.example/september\n"
    ).encode()

    snapshot = parse_vn100_snapshot_csv(payload, as_of=date(2026, 9, 7))

    assert snapshot.symbols == frozenset({"BBB"})
    assert snapshot.cluster_by_symbol == {"BBB": Cluster.C2_BANK}
    assert snapshot.source_by_symbol["BBB"] == "https://official.example/september"


def test_vn100_snapshot_rejects_missing_source():
    payload = (HEADER + "AAA,HOSE,C5_DEFENSIVE,2026-01-01,,,\n").encode()

    with pytest.raises(VN100SnapshotError, match="source is required"):
        parse_vn100_snapshot_csv(payload, as_of=date(2026, 9, 7))


def test_vn100_snapshot_rejects_no_active_members():
    payload = (HEADER + "AAA,HOSE,C5_DEFENSIVE,2026-01-01,2026-06-30,https://official.example\n").encode()

    with pytest.raises(VN100SnapshotError, match="No VN100 members"):
        parse_vn100_snapshot_csv(payload, as_of=date(2026, 9, 7))


def test_vn100_snapshot_rejects_duplicate_active_members():
    payload = (
        HEADER
        + "AAA,HOSE,C5_DEFENSIVE,2026-01-01,,https://official.example/one\n"
        + "AAA,HOSE,C5_DEFENSIVE,2026-08-01,,https://official.example/two\n"
    ).encode()

    with pytest.raises(VN100SnapshotError, match="duplicate active VN100"):
        parse_vn100_snapshot_csv(payload, as_of=date(2026, 9, 7))
