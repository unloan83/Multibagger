# IDE prompt: install the daily market-intelligence model on the Breeze VM

Paste everything below the line into the IDE agent on your computer.

---

Install the Multibagger daily market-intelligence model (paper only) on the Breeze VM. Work step by step, stop at
the first failure, and report each step as: command, then its real output. Never print, copy, or read secret values.
Do not open other projects' `.env` files. Do not stop, edit, or remove any existing service, timer, or repo
(Opportunity, daybagger, dualengine, trading_contracts stay untouched).

Connect with: `ssh -F /home/user/projects/oracle-breeze-ssh-config oracle-breeze`. Run every command below on the VM.

1. Check the host: `hostname; id -un; python3 --version; df -h ~ | tail -1; free -h | head -2`.
   Expect `breeze-trading`, user `ubuntu`, Python 3.10 or later. If the user is not `ubuntu`, stop and report.
2. Get the code: if `~/multibagger` does not exist, run
   `git clone https://github.com/unloan83/multibagger.git ~/multibagger`; otherwise
   `git -C ~/multibagger fetch origin main && git -C ~/multibagger checkout main && git -C ~/multibagger pull --ff-only origin main`.
   Then `git -C ~/multibagger log --oneline -1` and `git -C ~/multibagger status --porcelain | wc -l` (expect 0).
3. Check that the model loads: `cd ~/multibagger && python3 -c "import intel.run; print('import ok')"`.
4. Optional Upstox token, needed for options only. Ask me (the owner) whether to add one. If yes, I create
   `~/multibagger/.env` myself with one line, `UPSTOX_ANALYTICS_TOKEN=<token>`, and then you run `chmod 600 ~/multibagger/.env`.
   Report only `ls -l ~/multibagger/.env` and `cut -d= -f1 ~/multibagger/.env` (key names, never values).
   If no token, skip: options will record `NOT_FILLED` and the other categories still run.
5. Probe every data source once:
   `cd ~/multibagger && set -a && [ -f .env ] && . ./.env; set +a; MB_INTEL_HOME=~/multibagger-data/intel python3 -m intel.run probe; echo "exit $?"`.
   Paste the full output. It contains no secrets. Exit 0 means all sources answered; exit 10 means some failed (keep going and report which).
   If `nifty_last_bar` or `vix_last_bar` shows FAIL, stop here and report: without index data every category is NO TRADE.
6. Install the two timers:
   ```
   sudo cp ~/multibagger/deploy/multibagger-intel-morning.service ~/multibagger/deploy/multibagger-intel-morning.timer \
           ~/multibagger/deploy/multibagger-intel-options.service ~/multibagger/deploy/multibagger-intel-options.timer \
           /etc/systemd/system/
   mkdir -p ~/multibagger-data/intel
   sudo systemctl daemon-reload
   sudo systemctl enable --now multibagger-intel-morning.timer multibagger-intel-options.timer
   systemctl list-timers --all --no-pager | grep -E "multibagger-intel|NEXT"
   ```
7. Run the morning job once by hand: `sudo systemctl start multibagger-intel-morning.service; echo "exit $?"`, then
   `systemctl status multibagger-intel-morning.service --no-pager | head -15` and
   `journalctl -u multibagger-intel-morning.service --no-pager -n 60`.
   Before 09:15 IST it logs today's picks or NO TRADE. After 09:15 it only scores and records `AFTER_OPEN_SCORING_ONLY`,
   which is expected. On a weekend or NSE holiday it records `NOT_A_SESSION`.
8. Show the scorecard: `cd ~/multibagger && MB_INTEL_HOME=~/multibagger-data/intel python3 -m intel.run report | head -80`.
9. Final report, in this order: commit from step 2; probe result per source (OK or FAIL plus reason); token present yes or no;
   the two timers with their next run time; the morning run's exit status and picks or NO TRADE reasons; anything that failed.
   Do not call the model ready or operational. It is in paper (SHADOW) evidence collection.
