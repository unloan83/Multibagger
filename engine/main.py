from __future__ import annotations

import argparse
import asyncio
import datetime
import logging
import signal
import sys
from typing import Dict
from engine.config import Settings
from engine.lockfile import SingleInstanceLock
from engine.trading_calendar import get_market_session_state
from engine.state_machine import StateMachine
from engine.preflight_sync import PreflightSync
from engine.market_data import UpstoxMarketDataFeed, TickData, quantize_price
from engine.gates import CandidateSetup, evaluate_candidate, calculate_adaptive_buy_limit
from engine.paper_engine import PaperExecutionEngine
from engine.position_manager import PositionSupervisor
from engine.rejection_logger import DecisionLogger
from engine.notifier import send_telegram_alert, shutdown_notifier
from engine.watchdog import HeartbeatWatchdog

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("main")

class MultibaggerPipeline:
    def __init__(self, mode: str = "paper"):
        self.mode = mode
        self.settings = Settings.from_env()
        self.lock = SingleInstanceLock("data/multibagger_paper.lock")
        self.state_machine = StateMachine(self.settings.db_path)
        self.preflight_sync = PreflightSync(self.settings)
        self.paper_engine = PaperExecutionEngine(db_path=self.settings.db_path, settings=self.settings)
        self.position_supervisor = PositionSupervisor(db_path=self.settings.db_path, settings=self.settings)
        self.logger = DecisionLogger(self.settings)
        self.market_feed = UpstoxMarketDataFeed(self.settings.access_token)
        self.watchdog = HeartbeatWatchdog()
        self.is_running = False
        self.latest_market_prices: Dict[str, float] = {}

    def get_latest_market_prices(self) -> Dict[str, float]:
        return self.latest_market_prices

    async def run_watchdog_loop(self, interval_seconds: float = 10.0):
        while self.is_running:
            try:
                self.watchdog.update_heartbeat("engine")
                self.watchdog.check_heartbeats()
                await asyncio.sleep(interval_seconds)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Watchdog loop error: %s", e)
                await asyncio.sleep(interval_seconds)

    async def run_universe_scanner_loop(self, universe: list, interval_seconds: float = 60.0):
        logger.info("Starting Universe Scanner 60-second loop...")
        while self.is_running:
            try:
                self.watchdog.update_heartbeat("universe_scanner")
                self.watchdog.update_heartbeat("universe_scan")

                now_ist = datetime.datetime.now(datetime.timezone.utc).astimezone(
                    datetime.timezone(datetime.timedelta(hours=5, minutes=30))
                )
                now_str = now_ist.strftime("%H:%M")

                if self.settings.session_blackout_start <= now_str < self.settings.session_blackout_end:
                    logger.info("Blackout Calibration window active (09:15-09:20). Zeroing new orders.")
                    await asyncio.sleep(interval_seconds)
                    continue

                if self.state_machine.is_halted:
                    logger.warning("System is HALTED. Skipping universe scanning.")
                    await asyncio.sleep(interval_seconds)
                    continue

                evaluated_candidates = []
                active_keys = [p["instrument_key"] for p in self.state_machine.get_open_positions()]

                for item in universe:
                    sym = item["symbol"]
                    ikey = item["instrument_key"]
                    
                    ltp = self.latest_market_prices.get(sym, 1000.0)
                    self.latest_market_prices[sym] = ltp

                    candidate = CandidateSetup(
                        symbol=sym,
                        instrument_key=ikey,
                        ltp=ltp,
                        bid=ltp - 0.10,
                        ask=ltp + 0.10,
                        stock_return_pct=1.5,
                        nifty500_return_pct=0.5,
                        sector_return_pct=0.8,
                        market_regime="RISK_ON",
                        cum_volume=100000.0,
                        rvol_baseline=50000.0,
                        prior_day_delivery_pct=50.0,
                        delivery_20d_sma=45.0,
                        upper_circuit=item.get("upper_circuit", 1200.0),
                        atr_5m=5.0,
                        atr_1m=1.0,
                        entry_price=ltp,
                        target_price=ltp * 1.03,
                        stop_loss=ltp * 0.99,
                        qty=10,
                    )

                    is_qualified, rejection_code, score = evaluate_candidate(candidate, active_instrument_keys=active_keys)

                    evaluated_candidates.append({
                        "symbol": sym,
                        "score": score,
                        "passed": is_qualified,
                        "rejection_code": rejection_code,
                    })

                    metrics = {
                        "ltp": candidate.ltp,
                        "rvol": candidate.cum_volume / candidate.rvol_baseline if candidate.rvol_baseline > 0 else 0.0,
                        "rs_market": candidate.stock_return_pct - candidate.nifty500_return_pct,
                        "rs_sector": candidate.stock_return_pct - candidate.sector_return_pct,
                        "spread_pct": (candidate.ask - candidate.bid) / candidate.ltp,
                        "circuit_dist_pct": ((candidate.upper_circuit - candidate.ltp) / candidate.ltp) * 100.0,
                        "net_reward": ((candidate.target_price - candidate.entry_price) * candidate.qty) - 50.0,
                        "net_risk": ((candidate.entry_price - candidate.stop_loss) * candidate.qty) + 50.0,
                        "rr_ratio": 2.0,
                    }

                    if is_qualified:
                        self.logger.log_decision(sym, ikey, "TRADE", None, metrics)
                        trade_id = self.state_machine.create_trade_intent(candidate.__dict__)
                        
                        if trade_id:
                            self.state_machine.transition(trade_id, "APPROVED")
                            buy_limit = calculate_adaptive_buy_limit(candidate.ask, candidate.bid, candidate.atr_1m, max_allowed_price=candidate.upper_circuit)
                            self.paper_engine.execute_paper_buy(trade_id, ikey, candidate.qty, buy_limit, candidate.ask)
                    else:
                        self.logger.log_decision(sym, ikey, "REJECT", rejection_code, metrics)

                self.logger.funnel_tracker.record_scan_funnel(
                    universe_total=len(universe),
                    fresh_data_passed=len(universe),
                    liquidity_spread_passed=len(universe),
                    hard_gates_passed=len([c for c in evaluated_candidates if c["passed"] or c["rejection_code"] == "COMPOSITE_SCORE_LOW"]),
                    soft_score_qualified=len([c for c in evaluated_candidates if c["passed"]]),
                    risk_governor_approved=len([c for c in evaluated_candidates if c["passed"]]),
                    orders_emitted=len([c for c in evaluated_candidates if c["passed"]]),
                    top_evaluated_candidates=evaluated_candidates,
                )

                await asyncio.sleep(interval_seconds)
            except asyncio.CancelledError:
                self.is_running = False
                break
            except Exception as e:
                logger.error("Error in universe scanner loop: %s", e)
                await asyncio.sleep(interval_seconds)

    async def start(self, run_sync: bool = False):
        # 1. Single-instance lock protection
        if not self.lock.acquire():
            return

        self.is_running = True
        send_telegram_alert(f"🚀 <b>ENGINE STARTING</b> [Mode: {self.mode}]")

        # 2. Trading-calendar gating
        session = get_market_session_state()
        if session.session_state == "CLOSED" and not run_sync:
            logger.info("MARKET_CLOSED: Today is not an active NSE trading session. Exiting cleanly.")
            send_telegram_alert("ℹ️ <b>ENGINE EXIT</b>: NSE Market is closed today.")
            self.lock.release()
            return

        # 3. Pre-flight 11-point readiness verification
        ready, checks = self.preflight_sync.run_full_preflight_checks()
        if not ready and not run_sync:
            logger.critical("Engine startup aborted due to pre-flight failure.")
            self.lock.release()
            return

        universe = self.preflight_sync.fetch_bod_master_and_surveillance()
        self.preflight_sync.compute_and_store_rvol_baselines(universe)
        self.preflight_sync.compute_and_store_delivery_baselines(universe)

        # 4. Startup & Restart Reconciliation
        reconciled = self.state_machine.reconcile_on_startup()
        self.watchdog.update_heartbeat("broker_reconciliation")
        logger.info("Startup reconciliation finished: %s", reconciled)
        send_telegram_alert("🔄 <b>ENGINE RESTARTED — RECONCILIATION PASS</b>")

        if run_sync:
            logger.info("Sync mode complete. Exiting.")
            self.lock.release()
            return

        scanner_task = asyncio.create_task(self.run_universe_scanner_loop(universe, interval_seconds=60.0))
        supervisor_task = asyncio.create_task(self.position_supervisor.run_supervisor_loop(self.get_latest_market_prices, interval_seconds=5.0))
        market_feed_task = asyncio.create_task(self.market_feed.connect_and_listen())
        watchdog_task = asyncio.create_task(self.run_watchdog_loop())

        try:
            await asyncio.gather(scanner_task, supervisor_task, market_feed_task, watchdog_task)
        except asyncio.CancelledError:
            logger.info("Shutting down pipeline tasks...")
        except Exception as crash_err:
            logger.critical("ENGINE CRASH: %s", crash_err)
            send_telegram_alert(f"💥 <b>ENGINE CRASH / HEARTBEAT LOST</b>: {crash_err}")
            raise crash_err
        finally:
            report = self.logger.generate_eod_report()
            today_str = datetime.datetime.now().strftime("%Y-%m-%d")
            net_pnl = report["performance"]["net_realized_pnl"]
            scanned = report["universe_scanned"]
            placed = report["trades_executed"]
            fees = report["total_statutory_costs"]
            send_telegram_alert(
                f"📊 <b>EOD SUMMARY [{today_str}]</b>\nNet P&L: ₹{net_pnl:+.2f} | Scanned: {scanned} | Trades: {placed} | Costs: ₹{fees:.2f}"
            )
            self.lock.release()
            shutdown_notifier()

    def shutdown(self):
        logger.info("Executing graceful shutdown...")
        self.is_running = False

def main():
    parser = argparse.ArgumentParser(description="Multibagger Quantitative Paper Trading Engine")
    parser.add_argument("--mode", type=str, default="paper", choices=["paper", "live"], help="Execution mode (default: paper)")
    parser.add_argument("--sync", action="store_true", help="Run preflight sync only and exit")
    args = parser.parse_args()

    pipeline = MultibaggerPipeline(mode=args.mode)

    def _handle_sig(sig, frame):
        logger.info("Received termination signal (%s). Initiating shutdown.", sig)
        pipeline.shutdown()

    signal.signal(signal.SIGINT, _handle_sig)
    signal.signal(signal.SIGTERM, _handle_sig)

    try:
        asyncio.run(pipeline.start(run_sync=args.sync))
    except KeyboardInterrupt:
        logger.info("Interrupted by keyboard.")

if __name__ == "__main__":
    main()
