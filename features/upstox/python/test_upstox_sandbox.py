"""
Pytest unit tests for Upstox Sandbox Client & Safety Guardrails
"""

import os
import pytest
from unittest.mock import MagicMock, patch

from features.upstox.python.upstox_sandbox import (
    verify_sandbox_safety_guardrails,
    get_sandbox_configuration,
    get_sandbox_order_api,
    place_sandbox_order,
    modify_sandbox_order,
    cancel_sandbox_order,
    run_full_sandbox_lifecycle_test,
    sanitize_log_message,
    UpstoxSandboxSafetyError,
    UpstoxSandboxAuthError,
    SANDBOX_HOST_URL,
)


def test_sandbox_safety_guardrails_default_pass(monkeypatch):
    """Proves safety guardrails pass under default environment settings."""
    monkeypatch.setenv("UPSTOX_MODE", "SANDBOX")
    monkeypatch.setenv("LIVE_TRADING_ENABLED", "false")
    # Should not raise any exception
    verify_sandbox_safety_guardrails()


def test_sandbox_refuses_execution_if_live_trading_enabled(monkeypatch):
    """Proves execution is blocked if LIVE_TRADING_ENABLED is true."""
    monkeypatch.setenv("UPSTOX_MODE", "SANDBOX")
    monkeypatch.setenv("LIVE_TRADING_ENABLED", "true")
    
    with pytest.raises(UpstoxSandboxSafetyError, match="LIVE_TRADING_ENABLED is true"):
        verify_sandbox_safety_guardrails()


def test_sandbox_refuses_execution_if_mode_not_sandbox(monkeypatch):
    """Proves execution is blocked if UPSTOX_MODE is PRODUCTION."""
    monkeypatch.setenv("UPSTOX_MODE", "PRODUCTION")
    monkeypatch.setenv("LIVE_TRADING_ENABLED", "false")

    with pytest.raises(UpstoxSandboxSafetyError, match="Invalid UPSTOX_MODE"):
        verify_sandbox_safety_guardrails()


def test_sandbox_configuration_host(monkeypatch):
    """Proves upstox_client Configuration explicitly uses sandbox=True and correct host URL."""
    monkeypatch.setenv("UPSTOX_MODE", "SANDBOX")
    monkeypatch.setenv("LIVE_TRADING_ENABLED", "false")
    
    config = get_sandbox_configuration(access_token="test_mock_sandbox_token_123")
    assert config.host == SANDBOX_HOST_URL
    assert config.access_token == "test_mock_sandbox_token_123"


def test_sandbox_configuration_is_independent_after_live_configuration(monkeypatch):
    """Regression: the long-running collector initializes the live SDK client first."""
    monkeypatch.setenv("UPSTOX_MODE", "SANDBOX")
    monkeypatch.setenv("LIVE_TRADING_ENABLED", "false")
    configuration_class = __import__("upstox_client").Configuration
    previous_default = configuration_class._default
    try:
        configuration_class._default = None
        live = configuration_class()
        sandbox = get_sandbox_configuration(access_token="test_mock_sandbox_token_123")
        assert live.host != SANDBOX_HOST_URL
        assert sandbox.host == SANDBOX_HOST_URL
        assert sandbox.sandbox is True
    finally:
        configuration_class._default = previous_default


def test_missing_sandbox_token_raises_auth_error(monkeypatch):
    """Proves missing sandbox access token causes safe failure."""
    monkeypatch.setenv("UPSTOX_MODE", "SANDBOX")
    monkeypatch.setenv("LIVE_TRADING_ENABLED", "false")
    monkeypatch.delenv("UPSTOX_SANDBOX_ACCESS_TOKEN", raising=False)

    with pytest.raises(UpstoxSandboxAuthError, match="UPSTOX_SANDBOX_ACCESS_TOKEN is not set"):
        get_sandbox_configuration(access_token=None)


def test_log_sanitization(monkeypatch):
    """Proves secrets and tokens are redacted from log strings."""
    secret_token = "secret_access_token_xyz999"
    monkeypatch.setenv("UPSTOX_SANDBOX_ACCESS_TOKEN", secret_token)
    
    raw_msg = f"Connecting with token {secret_token} to Upstox."
    clean_msg = sanitize_log_message(raw_msg)
    
    assert secret_token not in clean_msg
    assert "[REDACTED]" in clean_msg


@patch("features.upstox.python.upstox_sandbox.OrderApi")
def test_sandbox_order_lifecycle_mocked(mock_order_api_cls, monkeypatch):
    """
    Tests complete order lifecycle (PLACE -> VERIFY -> MODIFY -> VERIFY -> CANCEL -> VERIFY)
    using mock Upstox API responses.
    """
    monkeypatch.setenv("UPSTOX_MODE", "SANDBOX")
    monkeypatch.setenv("LIVE_TRADING_ENABLED", "false")
    monkeypatch.setenv("UPSTOX_SANDBOX_ACCESS_TOKEN", "mock_token_abc")

    mock_api = MagicMock()
    mock_order_api_cls.return_value = mock_api

    # Mock place order response
    place_mock_data = MagicMock()
    place_mock_data.order_id = "260814000123"
    place_mock_response = MagicMock()
    place_mock_response.data = place_mock_data
    mock_api.place_order.return_value = place_mock_response

    # Mock order details, modify, and cancel responses
    mock_api.get_order_details.return_value = MagicMock(data={"order_id": "260814000123", "status": "open"})
    mock_api.modify_order.return_value = MagicMock(data={"order_id": "260814000123", "status": "modified"})
    mock_api.cancel_order.return_value = MagicMock(data={"order_id": "260814000123", "status": "cancelled"})

    results = run_full_sandbox_lifecycle_test(access_token="mock_token_abc")

    assert results["sandbox_mode"] is True
    assert results["place_order"] == "PASS"
    assert results["order_id_received"] == "YES"
    assert results["order_id"] == "260814000123"
    assert results["verify_place"] == "PASS"
    assert results["modify_order"] == "PASS"
    assert results["verify_modify"] == "PASS"
    assert results["cancel_order"] == "PASS"
    assert results["verify_cancel"] == "PASS"
    assert len(results["errors"]) == 0


def test_invalid_order_handling(monkeypatch):
    """Proves API exceptions are caught and reported safely without crashing."""
    monkeypatch.setenv("UPSTOX_MODE", "SANDBOX")
    monkeypatch.setenv("LIVE_TRADING_ENABLED", "false")

    with patch("features.upstox.python.upstox_sandbox.OrderApi") as mock_order_api_cls:
        mock_api = MagicMock()
        mock_order_api_cls.return_value = mock_api
        mock_api.place_order.side_effect = Exception("Upstox Sandbox API rate limit exceeded")

        results = run_full_sandbox_lifecycle_test(access_token="mock_token_abc")
        assert results["place_order"] == "FAIL"
        assert len(results["errors"]) == 1
        assert "rate limit exceeded" in results["errors"][0]
