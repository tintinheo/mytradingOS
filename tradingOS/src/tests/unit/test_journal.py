import json
from datetime import date
from decimal import Decimal

from tintradingos.domain.market_rules import Exchange
from tintradingos.journal.sqlite import (
    export_journal_csv,
    export_journal_json,
    list_proposals,
    list_scans,
    record_outcome,
    record_scan,
)
from tintradingos.scanner.warehouse import ScanReport
from tintradingos.signals.engine import Cluster, Regime, Rejection, Signal


def test_journal_records_provenance_ledger_proposals_outcomes_and_exports(tmp_path):
    report = ScanReport(
        as_of=date(2025, 2, 3),
        universe_size=2,
        eligible_count=1,
        signals=(
            Signal(
                generated_at=date(2025, 2, 3),
                symbol="AAA",
                exchange=Exchange.HOSE,
                cluster=Cluster.C1_MEGA,
                setup="PB_MA20",
                close_t=Decimal("10000"),
                entry=Decimal("10100"),
                exit_stop=Decimal("9500"),
                sizing_stop=Decimal("9400"),
                target_1=Decimal("11300"),
                target_2=Decimal("12200"),
                quantity=100,
                technical_score=Decimal("70"),
                win_probability=None,
                risk_reward=Decimal("2"),
            ),
        ),
        rejections=(Rejection("BBB", "G4", "setup failed"),),
    )
    db = tmp_path / "market.sqlite"
    scan_id = record_scan(
        db,
        report,
        regime=Regime.UPTREND,
        regime_inputs={"selected_regime": "UPTREND"},
        vn100_snapshot_source="official-vn100.csv",
        source_artifacts={"snapshot": {"sha256": "abc", "session": "2025-02-03"}},
    )

    scans = list_scans(db)
    assert scan_id == scans[0]["scan_id"]
    assert scans[0]["data_session"] == "2025-02-03"
    assert scans[0]["paper_only"] == 1
    proposal = list_proposals(db)[0]
    assert proposal["source_artifacts_json"] == scans[0]["source_artifacts_json"]

    record_outcome(
        db,
        proposal["proposal_id"],
        t1_open_vnd="10200",
        t1_status="FILLED",
        exit_date=date(2025, 2, 10),
        exit_price_vnd="11300",
        exit_reason="TARGET_1",
    )
    exported = json.loads(export_journal_json(db))
    assert any(row["ledger_status"] == "REJECTED" and row["gate"] == "G4" for row in exported)
    candidate = next(row for row in exported if row["proposal_symbol"] == "AAA")
    assert candidate["t1_status"] == "FILLED"
    assert candidate["exit_reason"] == "TARGET_1"
    assert b"source_artifacts_json" in export_journal_csv(db)
