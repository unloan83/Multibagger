from datetime import datetime, timezone

import pandas as pd

from engine.config import Settings
from engine.learning_mode import learning_mode_active, prepare_learning_shortlist
from engine.strategies import Candidate, OpportunityEvaluation


def test_learning_mode_shortlists_and_preserves_execution_confirmations(tmp_path):
    now = datetime(2026, 8, 28, 6, 0, tzinfo=timezone.utc)
    settings = Settings(
        "", tmp_path / "market.duckdb", tmp_path / "signals.json", tmp_path / "universe.json",
        paper_learning_mode_date="2026-08-28",
    )
    candidate = Candidate(
        "RELIANCE", "LONG", 101.0, 99.0, 105.0, "CONTINUATION", now, now, 92.0,
        {"score": 92.0, "vwapPrice": 100.0, "expectedR": 2.0, "sessionReturnBps": 80.0,
         "momentumBps": 20.0, "relativeVolume": 2.1, "spreadBps": 3.0},
    )
    evaluation = OpportunityEvaluation(
        "RELIANCE", "LONG", "CONTINUATION", 92.0, 2.0, 101.0, 99.0, 105.0,
        "TRADE", "QUALIFIED_EXECUTABLE", candidate,
    )
    nifty = pd.DataFrame({"ts": [now], "open": [100.0], "close": [100.5]})

    shortlist, executable = prepare_learning_shortlist([evaluation], nifty, settings, now)

    assert learning_mode_active(settings, now)
    assert shortlist[0]["symbol"] == "RELIANCE"
    assert shortlist[0]["relativeStrengthVsNiftyBps"] == 30.0
    assert executable[0].confirmations["learningMode"] is True
    assert executable[0].confirmations["setupSource"] == "PRICE_VOLUME_ONLY"
    assert executable[0].confirmations["vwap"] is True
    assert executable[0].confirmations["strategyQualified"] is True
    assert executable[0].confirmations["riskReward"] is True


def test_learning_mode_expires_outside_configured_ist_date(tmp_path):
    settings = Settings(
        "", tmp_path / "market.duckdb", tmp_path / "signals.json", tmp_path / "universe.json",
        paper_learning_mode_date="2026-08-28",
    )
    assert not learning_mode_active(settings, datetime(2026, 8, 29, 6, 0, tzinfo=timezone.utc))
