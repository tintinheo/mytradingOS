"""SQLite-backed audit journal for EOD paper scans and later observations."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Any

from tintradingos.scanner.warehouse import ScanReport
from tintradingos.signals.engine import Regime

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS journal_scans (
    scan_id INTEGER PRIMARY KEY,
    recorded_at TEXT NOT NULL,
    data_session TEXT NOT NULL,
    data_freshness_days INTEGER NOT NULL,
    regime TEXT NOT NULL,
    regime_inputs_json TEXT NOT NULL,
    vn100_snapshot_source TEXT NOT NULL,
    source_artifacts_json TEXT NOT NULL,
    universe_size INTEGER NOT NULL,
    eligible_count INTEGER NOT NULL,
    paper_only INTEGER NOT NULL CHECK (paper_only = 1)
);
CREATE TABLE IF NOT EXISTS journal_ledger (
    ledger_id INTEGER PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES journal_scans(scan_id),
    data_session TEXT NOT NULL,
    source_artifacts_json TEXT NOT NULL,
    symbol TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('CANDIDATE', 'REJECTED')),
    gate TEXT,
    reason TEXT
);
CREATE TABLE IF NOT EXISTS journal_proposals (
    proposal_id INTEGER PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES journal_scans(scan_id),
    data_session TEXT NOT NULL,
    source_artifacts_json TEXT NOT NULL,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    cluster TEXT NOT NULL,
    setup TEXT NOT NULL,
    close_t TEXT NOT NULL,
    entry_vnd TEXT NOT NULL,
    stop_vnd TEXT NOT NULL,
    target_1_vnd TEXT NOT NULL,
    target_2_vnd TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    risk_reward TEXT NOT NULL,
    UNIQUE(scan_id, symbol)
);
CREATE TABLE IF NOT EXISTS journal_outcomes (
    outcome_id INTEGER PRIMARY KEY,
    proposal_id INTEGER NOT NULL REFERENCES journal_proposals(proposal_id),
    scan_id INTEGER NOT NULL REFERENCES journal_scans(scan_id),
    data_session TEXT NOT NULL,
    source_artifacts_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    t1_open_vnd TEXT,
    t1_high_vnd TEXT,
    t1_low_vnd TEXT,
    t1_status TEXT,
    exit_date TEXT,
    exit_price_vnd TEXT,
    exit_reason TEXT,
    notes TEXT,
    UNIQUE(proposal_id)
);
CREATE INDEX IF NOT EXISTS idx_journal_scans_session ON journal_scans(data_session);
CREATE INDEX IF NOT EXISTS idx_journal_ledger_scan ON journal_ledger(scan_id);
CREATE INDEX IF NOT EXISTS idx_journal_proposals_scan ON journal_proposals(scan_id);
"""


def _connection(db_path: str | Path) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.executescript(SCHEMA)
    return connection


def record_scan(
    db_path: str | Path,
    report: ScanReport,
    *,
    regime: Regime,
    regime_inputs: dict[str, Any],
    vn100_snapshot_source: str,
    source_artifacts: dict[str, Any],
    recorded_on: datetime | None = None,
) -> int:
    """Persist an immutable paper scan, including provenance on every child row."""
    if report.as_of is None:
        raise ValueError("cannot journal a scan without a data session")
    artifacts_json = _canonical_json(source_artifacts)
    session = report.as_of.isoformat()
    freshness = max(0, (date.today() - report.as_of).days)
    timestamp = (recorded_on or datetime.now()).isoformat(timespec="seconds")
    connection = _connection(db_path)
    try:
        with connection:
            cursor = connection.execute(
                """INSERT INTO journal_scans
                (recorded_at, data_session, data_freshness_days, regime, regime_inputs_json,
                 vn100_snapshot_source, source_artifacts_json, universe_size,
                 eligible_count, paper_only)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
                (
                    timestamp,
                    session,
                    freshness,
                    regime.value,
                    _canonical_json(regime_inputs),
                    vn100_snapshot_source,
                    artifacts_json,
                    report.universe_size,
                    report.eligible_count,
                ),
            )
            scan_id = int(cursor.lastrowid)
            connection.executemany(
                """INSERT INTO journal_ledger
                (scan_id, data_session, source_artifacts_json, symbol, status, gate, reason)
                VALUES (?, ?, ?, ?, 'CANDIDATE', NULL, NULL)""",
                [(scan_id, session, artifacts_json, signal.symbol) for signal in report.signals],
            )
            connection.executemany(
                """INSERT INTO journal_ledger
                (scan_id, data_session, source_artifacts_json, symbol, status, gate, reason)
                VALUES (?, ?, ?, ?, 'REJECTED', ?, ?)""",
                [
                    (scan_id, session, artifacts_json, item.symbol, item.gate, item.reason)
                    for item in report.rejections
                ],
            )
            connection.executemany(
                """INSERT INTO journal_proposals
                (scan_id, data_session, source_artifacts_json, symbol, exchange, cluster, setup,
                 close_t,
                 entry_vnd, stop_vnd, target_1_vnd, target_2_vnd, quantity, risk_reward)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        scan_id,
                        session,
                        artifacts_json,
                        signal.symbol,
                        signal.exchange.value,
                        signal.cluster.value,
                        signal.setup,
                        str(signal.close_t),
                        str(signal.entry),
                        str(signal.exit_stop),
                        str(signal.target_1),
                        str(signal.target_2),
                        signal.quantity,
                        str(signal.risk_reward),
                    )
                    for signal in report.signals
                ],
            )
        return scan_id
    finally:
        connection.close()


def record_outcome(
    db_path: str | Path,
    proposal_id: int,
    *,
    t1_open_vnd: str | None = None,
    t1_high_vnd: str | None = None,
    t1_low_vnd: str | None = None,
    t1_status: str | None = None,
    exit_date: date | None = None,
    exit_price_vnd: str | None = None,
    exit_reason: str | None = None,
    notes: str = "",
    observed_on: datetime | None = None,
) -> None:
    """Upsert manually observed T+1 and eventual paper exit outcomes; never places orders."""
    connection = _connection(db_path)
    try:
        proposal = connection.execute(
            "SELECT scan_id, data_session, source_artifacts_json "
            "FROM journal_proposals WHERE proposal_id = ?",
            (proposal_id,),
        ).fetchone()
        if proposal is None:
            raise ValueError(f"unknown proposal_id: {proposal_id}")
        with connection:
            connection.execute(
                """INSERT INTO journal_outcomes
                (proposal_id, scan_id, data_session, source_artifacts_json, observed_at,
                 t1_open_vnd,
                 t1_high_vnd, t1_low_vnd, t1_status, exit_date, exit_price_vnd, exit_reason, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(proposal_id) DO UPDATE SET
                  observed_at=excluded.observed_at, t1_open_vnd=excluded.t1_open_vnd,
                  t1_high_vnd=excluded.t1_high_vnd, t1_low_vnd=excluded.t1_low_vnd,
                  t1_status=excluded.t1_status, exit_date=excluded.exit_date,
                  exit_price_vnd=excluded.exit_price_vnd, exit_reason=excluded.exit_reason,
                  notes=excluded.notes""",
                (
                    proposal_id,
                    proposal["scan_id"],
                    proposal["data_session"],
                    proposal["source_artifacts_json"],
                    (observed_on or datetime.now()).isoformat(timespec="seconds"),
                    t1_open_vnd,
                    t1_high_vnd,
                    t1_low_vnd,
                    t1_status,
                    exit_date.isoformat() if exit_date else None,
                    exit_price_vnd,
                    exit_reason,
                    notes,
                ),
            )
    finally:
        connection.close()


def list_scans(db_path: str | Path) -> list[dict[str, Any]]:
    return _rows(db_path, "SELECT * FROM journal_scans ORDER BY scan_id DESC")


def list_proposals(db_path: str | Path) -> list[dict[str, Any]]:
    return _rows(
        db_path,
        """SELECT p.*, o.t1_open_vnd, o.t1_high_vnd, o.t1_low_vnd, o.t1_status,
        o.exit_date, o.exit_price_vnd, o.exit_reason, o.notes FROM journal_proposals p
        LEFT JOIN journal_outcomes o ON o.proposal_id = p.proposal_id
        ORDER BY p.proposal_id DESC""",
    )


def export_journal_json(db_path: str | Path) -> bytes:
    return json.dumps(_export_rows(db_path), ensure_ascii=False, indent=2, sort_keys=True).encode()


def export_journal_csv(db_path: str | Path) -> bytes:
    rows = _export_rows(db_path)
    fields = sorted({field for row in rows for field in row})
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode()


def artifact_digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _export_rows(db_path: str | Path) -> list[dict[str, Any]]:
    return _rows(
        db_path,
        """SELECT s.scan_id, s.recorded_at, s.data_session, s.data_freshness_days,
        s.regime, s.regime_inputs_json, s.vn100_snapshot_source, s.source_artifacts_json,
        l.symbol AS ledger_symbol, l.status AS ledger_status, l.gate, l.reason,
        p.proposal_id, p.symbol AS proposal_symbol, p.entry_vnd, p.stop_vnd, p.target_1_vnd,
        p.target_2_vnd, p.quantity, o.t1_open_vnd, o.t1_high_vnd, o.t1_low_vnd, o.t1_status,
        o.exit_date, o.exit_price_vnd, o.exit_reason, o.notes
        FROM journal_scans s LEFT JOIN journal_ledger l ON l.scan_id = s.scan_id
        LEFT JOIN journal_proposals p ON p.scan_id = s.scan_id AND p.symbol = l.symbol
        LEFT JOIN journal_outcomes o ON o.proposal_id = p.proposal_id
        ORDER BY s.scan_id, l.ledger_id""",
    )


def _rows(db_path: str | Path, query: str) -> list[dict[str, Any]]:
    connection = _connection(db_path)
    try:
        return [dict(row) for row in connection.execute(query).fetchall()]
    finally:
        connection.close()


def _canonical_json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
