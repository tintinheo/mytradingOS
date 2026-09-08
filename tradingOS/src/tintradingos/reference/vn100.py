"""Strict, effective-dated VN100 membership snapshots.

The application intentionally does not scrape or infer index membership.  An
operator must save an official/public VN100 constituent snapshot, record its
source URL, then import it through this contract.  This keeps a real EOD scan
usable without inventing point-in-time membership for a backtest.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date

from tintradingos.domain.market_rules import Exchange
from tintradingos.signals.engine import Cluster

VN100_HEADERS = {
    "symbol",
    "exchange",
    "cluster",
    "effective_from",
    "effective_to",
    "source",
}


class VN100SnapshotError(ValueError):
    """Raised when a VN100 snapshot is incomplete, ambiguous, or stale."""


@dataclass(frozen=True, slots=True)
class VN100Snapshot:
    """A source-backed constituent set applicable on one EOD session."""

    as_of: date
    symbols: frozenset[str]
    cluster_by_symbol: dict[str, Cluster]
    source_by_symbol: dict[str, str]
    effective_from: date
    effective_to: date | None


def parse_vn100_snapshot_csv(payload: bytes, *, as_of: date) -> VN100Snapshot:
    """Validate a dated VN100 snapshot and select rows active on ``as_of``.

    The file may contain multiple historical constituent intervals, but each
    symbol can be active only once for the requested session.  The required
    source column must identify where the public/official snapshot was saved
    from; it is intentionally not fetched from a guessed website endpoint.
    """
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise VN100SnapshotError("VN100 snapshot must be UTF-8 CSV") from exc
    reader = csv.DictReader(io.StringIO(text))
    headers = set(reader.fieldnames or [])
    missing = VN100_HEADERS - headers
    if missing:
        raise VN100SnapshotError(f"Missing VN100 columns: {', '.join(sorted(missing))}")

    symbols: set[str] = set()
    clusters: dict[str, Cluster] = {}
    sources: dict[str, str] = {}
    starts: list[date] = []
    ends: list[date] = []
    for line_number, row in enumerate(reader, start=2):
        symbol = (row.get("symbol") or "").strip().upper()
        exchange = (row.get("exchange") or "").strip().upper()
        cluster_value = (row.get("cluster") or "").strip().upper()
        source = (row.get("source") or "").strip()
        try:
            start = date.fromisoformat((row.get("effective_from") or "").strip())
            end_value = (row.get("effective_to") or "").strip()
            end = date.fromisoformat(end_value) if end_value else None
            Exchange(exchange)
            cluster = Cluster(cluster_value)
        except ValueError as exc:
            raise VN100SnapshotError(
                f"Line {line_number}: invalid exchange, cluster, or effective date"
            ) from exc
        if not symbol.isascii() or not symbol.isalnum():
            raise VN100SnapshotError(f"Line {line_number}: invalid symbol")
        if cluster is Cluster.EXCLUDED:
            raise VN100SnapshotError(f"Line {line_number}: EXCLUDED cannot be a VN100 member")
        if not source:
            raise VN100SnapshotError(f"Line {line_number}: source is required")
        if end is not None and end < start:
            raise VN100SnapshotError(f"Line {line_number}: effective_to precedes effective_from")
        if start <= as_of and (end is None or as_of <= end):
            if symbol in symbols:
                raise VN100SnapshotError(
                    f"Line {line_number}: duplicate active VN100 symbol {symbol}"
                )
            symbols.add(symbol)
            clusters[symbol] = cluster
            sources[symbol] = source
            starts.append(start)
            if end is not None:
                ends.append(end)

    if not symbols:
        raise VN100SnapshotError(f"No VN100 members are effective on {as_of.isoformat()}")
    return VN100Snapshot(
        as_of=as_of,
        symbols=frozenset(symbols),
        cluster_by_symbol=clusters,
        source_by_symbol=sources,
        effective_from=min(starts),
        effective_to=min(ends) if ends and len(ends) == len(symbols) else None,
    )
