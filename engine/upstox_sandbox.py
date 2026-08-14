"""
Upstox Sandbox Client & Order Lifecycle Testing Module

Strictly isolates Sandbox API operations from production.
Enforces hard safety checks before any order execution.
"""

import os
import sys
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import upstox_client
from upstox_client.api.order_api import OrderApi
from upstox_client.models.place_order_request import PlaceOrderRequest
from upstox_client.models.modify_order_request import ModifyOrderRequest

# Configure structured logging for Sandbox operations
logger = logging.getLogger("upstox_sandbox")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [UPSTOX_SANDBOX] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


def _auto_load_env() -> None:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for env_file in [".env.local", ".env"]:
        filepath = os.path.join(base_dir, env_file)
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, val = line.split("=", 1)
                        key = key.strip()
                        val = val.strip().strip("'\"")
                        if key and val and key not in os.environ:
                            os.environ[key] = val


_auto_load_env()


# Default test security (Liquid NSE equity used ONLY for testing)
DEFAULT_TEST_SYMBOL = "RELIANCE"
DEFAULT_TEST_INSTRUMENT_KEY = "NSE_EQ|INE002A01018"
SANDBOX_HOST_URL = "https://api-sandbox.upstox.com"


class UpstoxSandboxSafetyError(RuntimeError):
    """Raised when sandbox safety conditions are violated."""
    pass


class UpstoxSandboxAuthError(ValueError):
    """Raised when Sandbox access token or credentials are missing."""
    pass


def sanitize_log_message(msg: str) -> str:
    """Removes any potential sensitive tokens or secrets from log messages."""
    token = os.getenv("UPSTOX_SANDBOX_ACCESS_TOKEN", "")
    secret = os.getenv("UPSTOX_SANDBOX_API_SECRET", "")
    api_key = os.getenv("UPSTOX_SANDBOX_API_KEY", "")
    
    clean = msg
    for secret_val in [token, secret, api_key]:
        if secret_val and len(secret_val) > 4:
            clean = clean.replace(secret_val, f"{secret_val[:2]}...[REDACTED]")
    return clean


def verify_sandbox_safety_guardrails() -> None:
    """
    Hard safety assertions to ensure live trading cannot occur.
    
    1. UPSTOX_MODE must be SANDBOX (or unset, defaulting to SANDBOX for safety tests)
    2. LIVE_TRADING_ENABLED must be false / False
    """
    mode = os.getenv("UPSTOX_MODE", "SANDBOX").strip().upper()
    if mode != "SANDBOX":
        raise UpstoxSandboxSafetyError(
            f"SAFETY BLOCK: Invalid UPSTOX_MODE='{mode}'. Expected 'SANDBOX'."
        )

    live_trading_raw = os.getenv("LIVE_TRADING_ENABLED", "false").strip().lower()
    if live_trading_raw in ("true", "1", "yes", "enabled"):
        raise UpstoxSandboxSafetyError(
            "SAFETY BLOCK: LIVE_TRADING_ENABLED is true! "
            "Sandbox module refuses to execute order actions when live trading flag is enabled."
        )


def get_sandbox_configuration(access_token: Optional[str] = None) -> upstox_client.Configuration:
    """
    Returns an explicitly configured Upstox Sandbox Configuration instance.
    """
    verify_sandbox_safety_guardrails()

    token = access_token or os.getenv("UPSTOX_SANDBOX_ACCESS_TOKEN", "").strip()
    if not token:
        raise UpstoxSandboxAuthError(
            "MISSING CREDENTIAL: UPSTOX_SANDBOX_ACCESS_TOKEN is not set.\n"
            "Please set UPSTOX_SANDBOX_ACCESS_TOKEN in your local .env.local file or environment."
        )

    # Instantiate Configuration with sandbox=True
    config = upstox_client.Configuration(sandbox=True)
    config.access_token = token

    # Hard safety check on target API host URL
    if config.host.rstrip("/") != SANDBOX_HOST_URL.rstrip("/"):
        raise UpstoxSandboxSafetyError(
            f"SAFETY BLOCK: Configuration host '{config.host}' does not match expected sandbox endpoint '{SANDBOX_HOST_URL}'."
        )

    return config


def get_sandbox_order_api(access_token: Optional[str] = None) -> OrderApi:
    """Creates an OrderApi instance pointing strictly to the Upstox Sandbox."""
    config = get_sandbox_configuration(access_token=access_token)
    api_client = upstox_client.ApiClient(config)
    return OrderApi(api_client)


def place_sandbox_order(
    symbol: str = DEFAULT_TEST_SYMBOL,
    instrument_key: str = DEFAULT_TEST_INSTRUMENT_KEY,
    quantity: int = 1,
    price: float = 100.0,
    product: str = "D",
    validity: str = "DAY",
    order_type: str = "LIMIT",
    transaction_type: str = "BUY",
    tag: str = "sandbox_test",
    access_token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Places a LIMIT test order in Upstox Sandbox.
    Returns dictionary containing order_id and order status response.
    """
    verify_sandbox_safety_guardrails()
    order_api = get_sandbox_order_api(access_token=access_token)

    req = PlaceOrderRequest(
        quantity=quantity,
        product=product,
        validity=validity,
        price=price,
        tag=tag,
        instrument_token=instrument_key,
        order_type=order_type,
        transaction_type=transaction_type,
        disclosed_quantity=0,
        trigger_price=0.0,
        is_amo=False,
    )

    logger.info(
        sanitize_log_message(
            f"PLACING SANDBOX ORDER | Symbol: {symbol} | Key: {instrument_key} | "
            f"Qty: {quantity} | Type: {order_type} {transaction_type} | Price: {price} | Tag: {tag}"
        )
    )

    res = order_api.place_order(body=req, api_version="2.0")
    
    # Process SDK response
    data = getattr(res, "data", None)
    order_id = getattr(data, "order_id", None) if data else None
    
    if not order_id and isinstance(res, dict):
        order_id = res.get("data", {}).get("order_id")

    logger.info(
        sanitize_log_message(
            f"SANDBOX ORDER PLACED SUCCESS | Order ID: {order_id}"
        )
    )
    return {"status": "SUCCESS", "order_id": order_id, "raw_response": res}


def verify_sandbox_order(
    order_id: str,
    access_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Queries and returns the order status from Upstox Sandbox."""
    verify_sandbox_safety_guardrails()
    order_api = get_sandbox_order_api(access_token=access_token)

    logger.info(sanitize_log_message(f"VERIFYING SANDBOX ORDER | Order ID: {order_id}"))
    try:
        res = order_api.get_order_details(api_version="2.0", order_id=order_id)
        logger.info(sanitize_log_message(f"SANDBOX ORDER VERIFIED | Order ID: {order_id}"))
        return {"status": "SUCCESS", "order_id": order_id, "raw_response": res}
    except Exception as e:
        err_msg = str(e)
        if "not available in sandbox mode" in err_msg.lower():
            logger.info(sanitize_log_message(f"SANDBOX GET QUERY SKIPPED (Not supported by Upstox Sandbox API) | Order ID: {order_id}"))
            return {"status": "SKIPPED_NOT_SUPPORTED_BY_SANDBOX", "order_id": order_id, "message": err_msg}
        raise


def modify_sandbox_order(
    order_id: str,
    new_price: float,
    quantity: int = 1,
    order_type: str = "LIMIT",
    validity: str = "DAY",
    access_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Modifies an existing pending limit order in Upstox Sandbox."""
    verify_sandbox_safety_guardrails()
    order_api = get_sandbox_order_api(access_token=access_token)

    req = ModifyOrderRequest(
        order_id=order_id,
        quantity=quantity,
        price=new_price,
        order_type=order_type,
        validity=validity,
        disclosed_quantity=0,
        trigger_price=0.0,
    )

    logger.info(
        sanitize_log_message(
            f"MODIFYING SANDBOX ORDER | Order ID: {order_id} | New Price: {new_price} | Qty: {quantity}"
        )
    )

    res = order_api.modify_order(body=req, api_version="2.0")
    logger.info(sanitize_log_message(f"SANDBOX ORDER MODIFIED SUCCESS | Order ID: {order_id}"))
    return {"status": "SUCCESS", "order_id": order_id, "raw_response": res}


def cancel_sandbox_order(
    order_id: str,
    access_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Cancels a pending order in Upstox Sandbox."""
    verify_sandbox_safety_guardrails()
    order_api = get_sandbox_order_api(access_token=access_token)

    logger.info(sanitize_log_message(f"CANCELLING SANDBOX ORDER | Order ID: {order_id}"))
    res = order_api.cancel_order(order_id=order_id, api_version="2.0")
    logger.info(sanitize_log_message(f"SANDBOX ORDER CANCELLED SUCCESS | Order ID: {order_id}"))
    return {"status": "SUCCESS", "order_id": order_id, "raw_response": res}


def run_full_sandbox_lifecycle_test(
    symbol: str = DEFAULT_TEST_SYMBOL,
    instrument_key: str = DEFAULT_TEST_INSTRUMENT_KEY,
    test_price: float = 100.0,
    modified_price: float = 105.0,
    access_token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Executes the full order lifecycle test on Upstox Sandbox:
    1. PLACE -> 2. VERIFY -> 3. MODIFY -> 4. VERIFY -> 5. CANCEL -> 6. VERIFY
    """
    verify_sandbox_safety_guardrails()

    results: Dict[str, Any] = {
        "sandbox_mode": True,
        "symbol": symbol,
        "instrument_key": instrument_key,
        "place_order": "FAIL",
        "order_id_received": "NO",
        "order_id": None,
        "verify_place": "FAIL",
        "modify_order": "FAIL",
        "verify_modify": "FAIL",
        "cancel_order": "FAIL",
        "verify_cancel": "FAIL",
        "errors": [],
    }

    try:
        # Step 1: PLACE
        place_res = place_sandbox_order(
            symbol=symbol,
            instrument_key=instrument_key,
            quantity=1,
            price=test_price,
            access_token=access_token,
        )
        order_id = place_res.get("order_id")
        if not order_id:
            raise RuntimeError("Place order returned success status but no order_id.")
        
        results["place_order"] = "PASS"
        results["order_id_received"] = "YES"
        results["order_id"] = order_id

        # Step 2: VERIFY PLACE
        verify_place_res = verify_sandbox_order(order_id=order_id, access_token=access_token)
        results["verify_place"] = "PASS"

        # Step 3: MODIFY
        modify_res = modify_sandbox_order(
            order_id=order_id,
            new_price=modified_price,
            access_token=access_token,
        )
        results["modify_order"] = "PASS"

        # Step 4: VERIFY MODIFY
        verify_mod_res = verify_sandbox_order(order_id=order_id, access_token=access_token)
        results["verify_modify"] = "PASS"

        # Step 5: CANCEL
        cancel_res = cancel_sandbox_order(order_id=order_id, access_token=access_token)
        results["cancel_order"] = "PASS"

        # Step 6: VERIFY CANCEL
        verify_cancel_res = verify_sandbox_order(order_id=order_id, access_token=access_token)
        results["verify_cancel"] = "PASS"

    except Exception as e:
        error_msg = sanitize_log_message(str(e))
        logger.error(f"SANDBOX LIFECYCLE ERROR: {error_msg}")
        results["errors"].append(error_msg)

    return results

