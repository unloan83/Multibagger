from __future__ import annotations

import unittest
from engine.gates import (
    CandidateSetup,
    evaluate_market_sector_rs_gate,
    evaluate_rvol_delivery_gate,
    evaluate_circuit_proximity_gate,
    evaluate_expected_net_edge_gate,
    calculate_adaptive_limit_price,
    evaluate_all_gates,
)

class TestGates2026(unittest.TestCase):
    def setUp(self):
        self.valid_candidate = CandidateSetup(
            symbol="RELIANCE",
            instrument_key="NSE_EQ|INE002A01018",
            ltp=2500.0,
            bid=2499.80,
            ask=2500.20,
            stock_return_pct=2.5,
            nifty500_return_pct=1.0,
            sector_return_pct=1.2,
            market_regime="RISK_ON",
            cum_volume=100000.0,
            rvol_baseline=50000.0,
            prior_day_delivery_pct=55.0,
            delivery_20d_sma=45.0,
            upper_circuit=2750.0,
            atr_5m=10.0,
            atr_1m=3.0,
            entry_price=2500.0,
            target_price=2570.0,
            stop_loss=2470.0,
            qty=10,
        )

    def test_rs_market_and_sector_gate_pass(self):
        ok, code = evaluate_market_sector_rs_gate(self.valid_candidate)
        self.assertTrue(ok)
        self.assertIsNone(code)

    def test_rs_market_fail_due_to_negative_rs(self):
        cand = CandidateSetup(**{**self.valid_candidate.__dict__, "stock_return_pct": 0.5, "nifty500_return_pct": 1.0})
        ok, code = evaluate_market_sector_rs_gate(cand)
        self.assertFalse(ok)
        self.assertEqual(code, "REGIME_FAIL")

    def test_rs_market_fail_due_to_risk_off_regime(self):
        cand = CandidateSetup(**{**self.valid_candidate.__dict__, "market_regime": "RISK_OFF"})
        ok, code = evaluate_market_sector_rs_gate(cand)
        self.assertFalse(ok)
        self.assertEqual(code, "REGIME_FAIL")

    def test_rs_sector_fail(self):
        cand = CandidateSetup(**{**self.valid_candidate.__dict__, "stock_return_pct": 1.5, "nifty500_return_pct": 1.0, "sector_return_pct": 2.0})
        ok, code = evaluate_market_sector_rs_gate(cand)
        self.assertFalse(ok)
        self.assertEqual(code, "SECTOR_FAIL")

    def test_rvol_pass_and_fail(self):
        # Pass
        ok, code = evaluate_rvol_delivery_gate(self.valid_candidate)
        self.assertTrue(ok)

        # RVOL Low Fail
        cand_low_rvol = CandidateSetup(**{**self.valid_candidate.__dict__, "cum_volume": 55000.0, "rvol_baseline": 50000.0}) # 1.10 < 1.30
        ok, code = evaluate_rvol_delivery_gate(cand_low_rvol)
        self.assertFalse(ok)
        self.assertEqual(code, "RVOL_LOW")

    def test_prior_day_delivery_baseline_low_fail(self):
        # Delivery T-1 < 20d SMA -> DELIVERY_BASELINE_LOW
        cand_low_delivery = CandidateSetup(**{**self.valid_candidate.__dict__, "prior_day_delivery_pct": 35.0, "delivery_20d_sma": 45.0})
        ok, code = evaluate_rvol_delivery_gate(cand_low_delivery)
        self.assertFalse(ok)
        self.assertEqual(code, "DELIVERY_BASELINE_LOW")

    def test_circuit_proximity_gate(self):
        # Pass
        ok, code = evaluate_circuit_proximity_gate(self.valid_candidate)
        self.assertTrue(ok)

        # Fail: LTP too close to upper circuit
        cand_circuit = CandidateSetup(**{**self.valid_candidate.__dict__, "ltp": 2740.0, "upper_circuit": 2750.0})
        ok, code = evaluate_circuit_proximity_gate(cand_circuit)
        self.assertFalse(ok)
        self.assertEqual(code, "CIRCUIT_PROXIMITY")

    def test_net_edge_and_rr_gate(self):
        # Pass
        ok, code = evaluate_expected_net_edge_gate(self.valid_candidate)
        self.assertTrue(ok)

        # Net Edge Low Fail
        cand_low_reward = CandidateSetup(**{**self.valid_candidate.__dict__, "target_price": 2505.0, "qty": 1})
        ok, code = evaluate_expected_net_edge_gate(cand_low_reward)
        self.assertFalse(ok)
        self.assertEqual(code, "NET_EDGE_LOW")

    def test_adaptive_limit_pricing(self):
        buy_limit = calculate_adaptive_limit_price(self.valid_candidate)
        self.assertGreaterEqual(buy_limit, self.valid_candidate.ask)
        self.assertEqual(buy_limit, round(buy_limit / 0.05) * 0.05)

    def test_evaluate_all_gates(self):
        ok, code = evaluate_all_gates(self.valid_candidate)
        self.assertTrue(ok)
        self.assertIsNone(code)

if __name__ == "__main__":
    unittest.main()
