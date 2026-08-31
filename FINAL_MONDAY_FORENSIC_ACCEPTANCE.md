# FINAL MONDAY FORENSIC ACCEPTANCE REPORT

**System Name**: Multibagger Quantitative Paper Trading Engine  
**Target Environment**: OCI Always-Free VM / Upstox NSE Equity  
**Execution Mode**: `--mode paper` (`ENABLE_LIVE_TRADING=false`)  
**Git Commit Hash**: `bcc98eae5ea4500879773fe5d3dfec278e795dbe`  
**Report Generated**: 2026-08-30  

---

## 1. SHA256 File Hashes of Critical Engine Modules

| Module Basename | Relative File Path | SHA256 Hash |
| :--- | :--- | :--- |
| `main.py` | [`engine/main.py`](file:///home/user/projects/Multibagger/engine/main.py) | `80281eea30ec06ebd15a6cbb83680f224e543cc27f6da3d6a4316a40c8ee8c8c` |
| `scanner.py` | [`engine/scanner.py`](file:///home/user/projects/Multibagger/engine/scanner.py) | `158cf85a7933d71ba4dfa998e6268a3bbbf50ad327931463722c471cc66c913b` |
| `paper_engine.py` | [`engine/paper_engine.py`](file:///home/user/projects/Multibagger/engine/paper_engine.py) | `a5e59a141b52c291803df1ed51f09c0630907683edde33932c363cec4aa94fe8` |
| `gates.py` | [`engine/gates.py`](file:///home/user/projects/Multibagger/engine/gates.py) | `7a9560435c3f62b58746ed81a00a3acaeafab525b137ba539c7d2e6cecd30450` |
| `paper.py` | [`engine/paper.py`](file:///home/user/projects/Multibagger/engine/paper.py) | `04fca3624d93b7185a2366851d01ea71ddb25a359834d3f4b734be5513c144af` |
| `position_manager.py` | [`engine/position_manager.py`](file:///home/user/projects/Multibagger/engine/position_manager.py) | `b005a7f50a8abe569feacaccaf5924e8b488fe0029fa1cc88f22148dd782c048` |
| `state_machine.py` | [`engine/state_machine.py`](file:///home/user/projects/Multibagger/engine/state_machine.py) | `038c4f81999d0f8089dab5e2b1ef2590726c1420ba55f7d226e3c7f12bde3601` |
| `market_data.py` | [`engine/market_data.py`](file:///home/user/projects/Multibagger/engine/market_data.py) | `423132c4e697fe54b5abecdc513e0d77ab4dedc7a3f0863b326b7f0bf51d8083` |
| `lockfile.py` | [`engine/lockfile.py`](file:///home/user/projects/Multibagger/engine/lockfile.py) | `e3ab8bb21011df3e163b259005b97075a3f272d8b3ce1bf024e3d3da1a4642af` |
| `watchdog.py` | [`engine/watchdog.py`](file:///home/user/projects/Multibagger/engine/watchdog.py) | `a6e42052eadf314f9c68407cbd4b3c85adc0cf7e5d85337f2788f9e283d6a2bb` |
| `standalone_watchdog.py` | [`engine/standalone_watchdog.py`](file:///home/user/projects/Multibagger/engine/standalone_watchdog.py) | `ee16e6544231f69313973166738140f3746f8cb89473ac85345e5c0f7929352e` |

---

## 2. Monday Active Pipeline Single Call Graph

```text
[systemd / exec] -> deploy/multibagger-paper.service
  └── engine/main.py (--mode paper)
        ├── engine/lockfile.py :: SingleInstanceLock.acquire() [OS fcntl.flock]
        ├── engine/trading_calendar.py :: get_market_session_state() [Calendar Check]
        ├── engine/preflight_sync.py :: run_premarket_checks() -> PREMARKET_READY (Stage A)
        ├── engine/market_data.py :: UpstoxMarketDataFeed.is_market_data_ready() -> MARKET_DATA_READY (Stage B)
        ├── engine/gates.py :: evaluate_candidate() -> (passed, code, score)
        ├── engine/state_machine.py :: create_trade_intent() -> TradeState.QUALIFIED -> APPROVED
        ├── engine/paper_engine.py :: execute_paper_buy() -> TradeState.ENTRY_PENDING -> OPEN
        ├── engine/position_manager.py :: PositionSupervisor.run_supervisor_loop() -> Trailing ATR SL & ₹1,000 Breaker
        ├── engine/paper_engine.py :: execute_paper_exit() -> TradeState.EXIT_PENDING -> CLOSED
        ├── engine/rejection_logger.py :: DecisionLogger.generate_eod_report() -> 24 Diagnostic Metrics
        └── engine/notifier.py :: send_telegram_alert() -> Background Queue Worker
```

---

## 3. Mandatory Audit Verdicts

```text
FULL_REGRESSION=PASS
ONE_ACTIVE_PIPELINE=YES
OCI_CODE_MATCHES_CERTIFIED_CODE=YES
PREMARKET_READY=YES
CURRENT_SESSION_DATA_READY=YES
ZERO_TICK_FALSE_PASS_BLOCKED=YES
WATCHDOG_INDEPENDENT=YES
TIMER_IST_VERIFIED=YES
LOCK_CRASH_SAFE=YES
OCI_RESOURCE_SAFE=YES
PAPER_LIVE_ISOLATION=PASS
KILL_RESTART_OPEN_POSITION=PASS
PARTIAL_FILL_RESTART=PASS
RISK_BREAKER_VERIFIED=PASS
PRODUCTION_PATH_SYNTHETIC_SESSION=PASS
OPEN_P0_BLOCKERS=NONE
READY_FOR_MONDAY=YES
```

---

## 4. OCI Systemd Installation & Startup Commands

```bash
# 1. Install service & timer
sudo cp deploy/multibagger-paper.service /etc/systemd/system/
sudo cp deploy/multibagger-paper.timer /etc/systemd/system/
sudo cp deploy/multibagger-watchdog.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable multibagger-paper.timer multibagger-watchdog.service
sudo systemctl start multibagger-paper.timer multibagger-watchdog.service

# 2. Next execution timestamp
# Next Execution: Monday 08:35:00 Asia/Kolkata (IST)
```
