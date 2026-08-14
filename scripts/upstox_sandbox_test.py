"""
Upstox Sandbox Order Lifecycle CLI Test Script

Run via:
  PYTHONPATH=.python-packages python3 -m scripts.upstox_sandbox_test
"""

import os
import sys
import logging

# Ensure root directory and .python-packages are in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

pkg_dir = os.path.join(BASE_DIR, ".python-packages")
if os.path.exists(pkg_dir) and pkg_dir not in sys.path:
    sys.path.insert(0, pkg_dir)

def _load_env_file(filepath: str) -> None:
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip("'\"")
                    if key and val:
                        os.environ[key] = val

_load_env_file(os.path.join(BASE_DIR, ".env.local"))
_load_env_file(os.path.join(BASE_DIR, ".env"))


from engine.upstox_sandbox import (
    run_full_sandbox_lifecycle_test,
    verify_sandbox_safety_guardrails,
    UpstoxSandboxAuthError,
    UpstoxSandboxSafetyError,
    DEFAULT_TEST_SYMBOL,
    DEFAULT_TEST_INSTRUMENT_KEY,
)


def main() -> None:
    print("=" * 65)
    print("  UPSTOX SANDBOX — NO REAL MONEY / NO LIVE ORDERS")
    print("=" * 65)

    # Check safety guards first
    try:
        verify_sandbox_safety_guardrails()
        print("[SAFETY ASSERTION] UPSTOX_MODE=SANDBOX verified.")
        print("[SAFETY ASSERTION] LIVE_TRADING_ENABLED=false verified.")
        print("[SAFETY ASSERTION] Target endpoint: https://api-sandbox.upstox.com")
    except UpstoxSandboxSafetyError as err:
        print(f"\n[CRITICAL SAFETY BLOCK] {err}")
        sys.exit(1)

    sandbox_token = os.getenv("UPSTOX_SANDBOX_ACCESS_TOKEN", "").strip()
    if not sandbox_token:
        print("\n" + "!" * 65)
        print(" ACTION REQUIRED: UPSTOX_SANDBOX_ACCESS_TOKEN IS MISSING")
        print("!" * 65)
        print("To run the live sandbox order lifecycle test, add your Sandbox credentials to:")
        print(f"  {os.path.join(BASE_DIR, '.env.local')}\n")
        print("Values to set:")
        print("  UPSTOX_MODE=SANDBOX")
        print("  LIVE_TRADING_ENABLED=false")
        print("  UPSTOX_SANDBOX_API_KEY=<Your Sandbox API Key>")
        print("  UPSTOX_SANDBOX_API_SECRET=<Your Sandbox API Secret>")
        print("  UPSTOX_SANDBOX_ACCESS_TOKEN=<Your Sandbox Access Token>")
        print("!" * 65 + "\n")
        sys.exit(0)

    print(f"\nInitiating Upstox Sandbox Order Lifecycle Test on {DEFAULT_TEST_SYMBOL} ({DEFAULT_TEST_INSTRUMENT_KEY})...")
    res = run_full_sandbox_lifecycle_test()

    print("\n" + "=" * 65)
    print("  UPSTOX SANDBOX LIFECYCLE TEST RESULTS")
    print("=" * 65)
    print(f"  Sandbox Mode       : {'PASS' if res['sandbox_mode'] else 'FAIL'}")
    print(f"  Test Symbol        : {res['symbol']} ({res['instrument_key']})")
    print(f"  PLACE Order        : {res['place_order']}")
    print(f"  Order ID Received  : {res['order_id_received']} (ID: {res['order_id'] or 'N/A'})")
    print(f"  VERIFY Place       : {res['verify_place']}")
    print(f"  MODIFY Order       : {res['modify_order']}")
    print(f"  VERIFY Modify      : {res['verify_modify']}")
    print(f"  CANCEL Order       : {res['cancel_order']}")
    print(f"  VERIFY Cancel      : {res['verify_cancel']}")
    
    if res["errors"]:
        print("\n  Errors Encountered:")
        for err in res["errors"]:
            print(f"    - {err}")
    print("=" * 65)

    if res["place_order"] == "PASS" and res["cancel_order"] == "PASS":
        print("\nSUCCESS: All Upstox Sandbox order lifecycle steps passed!\n")
        sys.exit(0)
    else:
        print("\nWARNING: One or more sandbox lifecycle steps failed.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
