from datetime import UTC, date, datetime
from decimal import Decimal

from tintradingos.backtest.execution import FillPolicy, FillReason, simulate_contract_limit_entry
from tintradingos.domain.market_rules import Exchange, MarketPrice
from tintradingos.reference.market_data import (
    CorporateAction,
    CorporateActionType,
    ReferencePrice,
    SourceEvidence,
    TradingSession,
    evidence_issues,
    persist_contracts,
)


def evidence() -> SourceEvidence:
    return SourceEvidence("https://exchange.example/published", datetime(2026, 9, 8, tzinfo=UTC))


def test_contract_execution_uses_published_ceiling_and_requires_evidence(tmp_path):
    db = tmp_path / "market.sqlite"
    session = date(2026, 9, 8)
    missing = simulate_contract_limit_entry(
        db_path=db,
        symbol="AAA",
        next_session=session,
        signal_close=MarketPrice.raw(10_000),
        next_open=MarketPrice.raw(10_100),
        next_high=MarketPrice.raw(10_100),
        next_low=MarketPrice.raw(10_000),
        exchange=Exchange.HOSE,
        premium="0.01",
        max_gap="0.05",
        fill_policy=FillPolicy.TOUCH_OPTIMISTIC,
    )
    assert missing.reason is FillReason.MISSING_CORPORATE_ACTION_EVIDENCE
    persist_contracts(
        db,
        corporate_actions=(
            CorporateAction("AAA", session, CorporateActionType.NONE, evidence(), session),
        ),
        sessions=(TradingSession(Exchange.HOSE, session, True, evidence()),),
        reference_prices=(
            ReferencePrice(
                "AAA",
                Exchange.HOSE,
                session,
                Decimal("10000"),
                Decimal("9300"),
                Decimal("10500"),
                evidence(),
            ),
        ),
    )
    result = simulate_contract_limit_entry(
        db_path=db,
        symbol="AAA",
        next_session=session,
        signal_close=MarketPrice.raw(10_000),
        next_open=MarketPrice.raw(10_100),
        next_high=MarketPrice.raw(10_100),
        next_low=MarketPrice.raw(10_000),
        exchange=Exchange.HOSE,
        premium="0.01",
        max_gap="0.05",
        fill_policy=FillPolicy.TOUCH_OPTIMISTIC,
    )
    assert result.reason is FillReason.FILLED
    assert evidence_issues(db, symbol="AAA", exchange=Exchange.HOSE, session_date=session) == ()
