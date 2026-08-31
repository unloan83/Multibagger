from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple, Union
from engine.market_data import quantize_price

@dataclass
class CandidateSetup:
    symbol: str
    instrument_key: str
    ltp: float
    bid: float
    ask: float
    total_buy_qty: int = 10000
    total_sell_qty: int = 10000
    tick_time: float = 0.0
    stock_return_pct: float = 0.0
    nifty500_return_pct: float = 0.0
    sector_return_pct: float = 0.0
    nifty500_15m_ret: float = 0.0
    market_regime: str = "RISK_ON"
    rvol: float = 1.5
    cum_volume: float = 100000.0
    rvol_baseline: float = 50000.0
    prior_day_delivery_pct: float = 50.0
    delivery_20d_sma: float = 45.0
    delivery_tminus1: float = 50.0
    vwap: float = 0.0
    ema20: float = 0.0
    upper_circuit: float = 1200.0
    atr_5m: float = 5.0
    atr_1m: float = 1.0
    entry_price: float = 1000.0
    target_price: float = 1030.0
    stop_loss: float = 985.0
    qty: int = 10
    current_open_risk: float = 0.0

def calculate_adaptive_buy_limit(ask: float, bid: float, atr_1m: float, max_allowed_price: Optional[float] = None) -> float:
    spread = max(0.0, ask - bid)
    aggression = min(0.5 * spread, 0.15 * atr_1m)
    raw_limit = ask + aggression

    if max_allowed_price is not None and max_allowed_price > 0:
        raw_limit = min(raw_limit, max_allowed_price)

    return quantize_price(raw_limit)

def calculate_adaptive_limit_price(candidate: CandidateSetup, max_allowed_price: Optional[float] = None) -> float:
    return calculate_adaptive_buy_limit(candidate.ask, candidate.bid, candidate.atr_1m, max_allowed_price)

def evaluate_market_sector_rs_gate(candidate: CandidateSetup) -> Tuple[bool, Optional[str]]:
    rs_market = candidate.stock_return_pct - candidate.nifty500_return_pct
    rs_sector = candidate.stock_return_pct - candidate.sector_return_pct

    if rs_market <= 0 or candidate.market_regime == "RISK_OFF":
        return False, "REGIME_FAIL"
    if rs_sector <= 0:
        return False, "SECTOR_FAIL"
    return True, None

def evaluate_rvol_delivery_gate(candidate: CandidateSetup) -> Tuple[bool, Optional[str]]:
    if candidate.rvol_baseline <= 0:
        return False, "RVOL_LOW"
    rvol = candidate.cum_volume / candidate.rvol_baseline
    if rvol < 1.30:
        return False, "RVOL_LOW"
    if candidate.prior_day_delivery_pct < candidate.delivery_20d_sma:
        return False, "DELIVERY_BASELINE_LOW"
    return True, None

def evaluate_circuit_proximity_gate(candidate: CandidateSetup) -> Tuple[bool, Optional[str]]:
    if candidate.ltp <= 0 or candidate.upper_circuit <= 0:
        return False, "CIRCUIT_PROXIMITY"
    atr_pct = (candidate.atr_5m / candidate.ltp) * 100.0 if candidate.ltp > 0 else 0.0
    dynamic_buffer_pct = max(1.0, 2.0 * atr_pct)
    circuit_dist_pct = ((candidate.upper_circuit - candidate.ltp) / candidate.ltp) * 100.0
    if circuit_dist_pct <= dynamic_buffer_pct:
        return False, "CIRCUIT_PROXIMITY"
    return True, None

def evaluate_expected_net_edge_gate(candidate: CandidateSetup) -> Tuple[bool, Optional[str]]:
    spread = max(0.0, candidate.ask - candidate.bid)
    cost = (candidate.entry_price * 0.0006) + (candidate.target_price * 0.0006) + spread + 40.0
    gross_reward = (candidate.target_price - candidate.entry_price) * candidate.qty
    gross_risk = (candidate.entry_price - candidate.stop_loss) * candidate.qty
    net_reward = gross_reward - cost
    net_risk = gross_risk + cost

    if net_reward <= 150.0:
        return False, "NET_EDGE_LOW"
    if net_risk <= 0 or (net_reward / net_risk) < 1.8:
        return False, "RR_FAIL"
    return True, None

def evaluate_candidate(
    candidate: Union[Dict[str, Any], CandidateSetup],
    active_instrument_keys: Optional[List[str]] = None,
    now_ts: Optional[float] = None,
) -> Tuple[bool, Optional[str], int]:
    if isinstance(candidate, CandidateSetup):
        c = candidate.__dict__
    else:
        c = candidate

    active_keys = active_instrument_keys or []
    if now_ts is None:
        now_ts = datetime.now(timezone.utc).timestamp()

    ltp = float(c.get("ltp", c.get("entry_price", 0.0)))
    bid = float(c.get("bid", ltp))
    ask = float(c.get("ask", ltp))
    total_buy_qty = int(c.get("total_buy_qty", 10000))
    total_sell_qty = int(c.get("total_sell_qty", 10000))
    tick_time = float(c.get("tick_time", 0.0))
    if tick_time <= 0:
        tick_time = now_ts
    instrument_key = str(c.get("instrument_key", ""))
    
    upper_circuit = float(c.get("upper_circuit", ltp * 1.10))
    atr_5m = float(c.get("atr_5m", ltp * 0.005))
    atr_1m = float(c.get("atr_1m", ltp * 0.002))
    
    entry_price = float(c.get("entry_price", ltp))
    target_price = float(c.get("target_price", ltp * 1.03))
    stop_loss = float(c.get("stop_loss", ltp * 0.985))
    qty = int(c.get("qty", 10))

    # HARD GATES PHASE
    # 1. DATA_STALE
    if (now_ts - tick_time) > 2.0:
        return False, "DATA_STALE", 0

    # 2. EXCHANGE_HALTED
    if bid <= 0 or ask <= 0 or total_buy_qty <= 0 or total_sell_qty <= 0 or ltp <= 0:
        return False, "EXCHANGE_HALTED", 0

    # 3. SPREAD_HIGH
    spread_pct = (ask - bid) / ltp
    if spread_pct > 0.003:
        return False, "SPREAD_HIGH", 0

    # 4. CIRCUIT_PROXIMITY
    circuit_dist_pct = ((upper_circuit - ltp) / ltp) * 100.0
    dynamic_buffer_pct = max(1.0, 2.0 * ((atr_5m / ltp) * 100.0))
    if circuit_dist_pct <= dynamic_buffer_pct:
        return False, "CIRCUIT_PROXIMITY", 0

    # 5. MARKET_RISK_OFF
    nifty_15m_ret = float(c.get("nifty500_15m_ret", 0.0))
    if nifty_15m_ret <= -1.5 or (-0.05 <= nifty_15m_ret <= -0.015):
        return False, "MARKET_RISK_OFF", 0

    # 6 & 7. NET_EDGE_LOW & RR_FAIL
    estimated_cost = (entry_price * 0.0006) + (target_price * 0.0006) + (ask - bid) + 40.0
    gross_reward = (target_price - entry_price) * qty
    gross_risk = (entry_price - stop_loss) * qty
    net_reward = gross_reward - estimated_cost
    net_risk = gross_risk + estimated_cost

    if net_reward <= 150.0:
        return False, "NET_EDGE_LOW", 0

    if net_risk <= 0 or (net_reward / net_risk) < 1.8:
        return False, "RR_FAIL", 0

    # 8. RISK_LIMIT_EXCEEDED
    candidate_risk = (entry_price - stop_loss) * qty
    current_open_risk = float(c.get("current_open_risk", 0.0))
    if (current_open_risk + candidate_risk) > 1000.0:
        return False, "RISK_LIMIT_EXCEEDED", 0

    # 9. DUPLICATE_POSITION
    if instrument_key in active_keys:
        return False, "DUPLICATE_POSITION", 0

    # SOFT COMPOSITE SCORING PHASE (0 to 100 pts)
    score = 0

    # 1. RVOL Score (max 30 pts)
    rvol = float(c.get("rvol", 1.5))
    if rvol >= 2.0:
        score += 30
    elif rvol >= 1.3:
        score += 20
    elif rvol >= 1.0:
        score += 10

    # 2. Relative Strength Score (max 30 pts)
    rs_market = float(c.get("rs_market", 0.0))
    rs_sector = float(c.get("rs_sector", 0.0))

    if rs_market > 0.0:
        score += 15
    elif rs_market >= -0.5:
        score += 5

    if rs_sector > 0.0:
        score += 15
    elif rs_sector >= -0.5:
        score += 5

    # 3. Delivery Accumulation Context (max 20 pts)
    delivery_tminus1 = float(c.get("delivery_tminus1", c.get("prior_day_delivery_pct", 50.0)))
    delivery_20d_sma = float(c.get("delivery_20d_sma", 45.0))
    if delivery_tminus1 >= delivery_20d_sma:
        score += 20

    # 4. Momentum / Price Action (max 20 pts)
    vwap = float(c.get("vwap", ltp - 1.0))
    ema20 = float(c.get("ema20", ltp - 2.0))
    if ltp > vwap and ltp > ema20:
        score += 20

    # DECISION RULE
    if score >= 60:
        return True, None, score
    else:
        return False, "COMPOSITE_SCORE_LOW", score

def evaluate_all_gates(candidate: Union[Dict[str, Any], CandidateSetup]) -> Tuple[bool, Optional[str]]:
    passed, code, _ = evaluate_candidate(candidate)
    return passed, code
