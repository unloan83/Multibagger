import json

import pytest

from engine.config import Settings


def test_universe_is_hard_capped_to_nifty_500(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text(json.dumps([
        {"symbol": "IN500", "sources": ["NIFTY 500"]},
        {"symbol": "ONLY200", "sources": ["NIFTY 200"]},
    ]))
    settings = Settings("", tmp_path / "market.duckdb", tmp_path / "signals.json", universe)
    assert settings.symbols() == ["IN500"]


def test_environment_rejects_more_than_500_symbols(monkeypatch):
    monkeypatch.setenv("NSE_UNIVERSE_SIZE", "501")
    with pytest.raises(RuntimeError, match="between 1 and 500"):
        Settings.from_env()


def test_environment_rejects_invalid_price_range(monkeypatch):
    monkeypatch.setenv("MIN_PRICE_INR", "750")
    monkeypatch.setenv("MAX_PRICE_INR", "150")
    with pytest.raises(RuntimeError, match="positive increasing range"):
        Settings.from_env()


def test_daily_breakers_are_fixed(monkeypatch):
    monkeypatch.setenv("PAPER_PORTFOLIO_CAPITAL_INR", "500000")
    monkeypatch.setenv("PAPER_DAILY_PROFIT_TARGET_INR", "2999")
    monkeypatch.setenv("PAPER_DAILY_LOSS_LIMIT_INR", "1000")
    with pytest.raises(RuntimeError, match="must remain INR 3,000 profit / 1,000 loss"):
        Settings.from_env()


def test_enabled_agents_accepts_a_safe_subset(monkeypatch):
    monkeypatch.setenv("ENABLED_AGENTS", "alpha,gamma")
    assert Settings.from_env().enabled_agents == ("ALPHA", "GAMMA")


@pytest.mark.parametrize("value", ["", "ALPHA,OPTIONS"])
def test_enabled_agents_rejects_empty_or_unknown_values(monkeypatch, value):
    monkeypatch.setenv("ENABLED_AGENTS", value)
    with pytest.raises(RuntimeError, match="ENABLED_AGENTS"):
        Settings.from_env()
