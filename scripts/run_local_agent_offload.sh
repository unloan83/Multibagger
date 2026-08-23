#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
credentials_file="${LOCAL_PAPER_ENV_FILE:-$repo_dir/.env.local}"
ssh_config="${LOCAL_PAPER_SSH_CONFIG:-/home/user/projects/oracle-breeze-ssh-config}"
remote_host="${LOCAL_PAPER_REMOTE_HOST:-oracle-breeze}"
state_dir="${LOCAL_PAPER_STATE_DIR:-$repo_dir/.local-paper-fallback}"
remote_export="/tmp/multibagger-agent-offload.duckdb"
remote_return="/tmp/multibagger-agent-return.duckdb"
dropin_dir="/run/systemd/system/multibagger-paper.service.d"
dropin_file="$dropin_dir/agent-offload.conf"
release_unit="multibagger-agent-offload-release"

usage() {
  cat <<'EOF'
Usage: scripts/run_local_agent_offload.sh ALPHA|BETA|GAMMA|AUTO|RECOVER

Runs exactly one intraday agent on this laptop. OCI keeps its collector and the
other two agents. Offload is refused while OCI has any open paper position.
AUTO selects the agent that owns the current IST window.
RECOVER uploads retained laptop state after a prior restoration network failure.
EOF
}

requested="${1:-}"
if [[ "$requested" == "--help" || "$requested" == "-h" ]]; then usage; exit 0; fi
[[ -n "$requested" ]] || { usage; exit 2; }
agent="${requested^^}"
recover_requested=false
if [[ "$agent" == "RECOVER" ]]; then
  recover_requested=true
  agent=""
fi
if [[ "$agent" == "AUTO" ]]; then
  ist_hhmm="$(TZ=Asia/Kolkata date +%H%M)"
  if ((10#$ist_hhmm >= 930 && 10#$ist_hhmm < 1100)); then agent=ALPHA
  elif ((10#$ist_hhmm >= 1100 && 10#$ist_hhmm < 1330)); then agent=BETA
  elif ((10#$ist_hhmm >= 1330 && 10#$ist_hhmm < 1500)); then agent=GAMMA
  else echo "No agent owns the current IST window." >&2; exit 1
  fi
fi

case "$agent" in
  ALPHA) oci_agents="BETA,GAMMA" ;;
  BETA)  oci_agents="ALPHA,GAMMA" ;;
  GAMMA) oci_agents="ALPHA,BETA" ;;
  "") [[ "$recover_requested" == true ]] || { usage; exit 2; }; oci_agents="" ;;
  *) usage; exit 2 ;;
esac

for command in ssh scp flock python3; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
[[ -f "$credentials_file" ]] || { echo "Missing credentials file: $credentials_file" >&2; exit 1; }
[[ -f "$ssh_config" ]] || { echo "Missing SSH config: $ssh_config" >&2; exit 1; }

mkdir -p "$state_dir"
chmod 700 "$state_dir"
exec 9>"$state_dir/offload.lock"
flock -n 9 || { echo "A laptop agent is already running; at most one is allowed." >&2; exit 1; }

prepared=false
restore_oci() {
  [[ "$prepared" == true ]] || return 0
  prepared=false
  echo "Returning the laptop paper state to OCI and restoring all three agents..."
  if [[ -s "$state_dir/upstox_market_data.duckdb" ]]; then
    if ! scp -F "$ssh_config" -q "$state_dir/upstox_market_data.duckdb" "$remote_host:$remote_return"; then
      echo "WARNING: state upload failed. OCI remains on two agents until its safety release." >&2
      return 1
    fi
  fi
  ssh -F "$ssh_config" "$remote_host" \
    "sudo systemctl stop multibagger-paper.service; \
     if test -s '$remote_return'; then \
       sudo /opt/breeze/venv/bin/python -c \"import duckdb; c=duckdb.connect('$remote_return',read_only=True); c.execute('select count(*) from minute_bars').fetchone(); c.close()\"; \
       sudo cp --reflink=auto /var/lib/multibagger/upstox_market_data.duckdb /var/lib/multibagger/agent-offload-backup.duckdb; \
       sudo install -o breeze -g breeze -m 0600 '$remote_return' /var/lib/multibagger/upstox_market_data.duckdb; \
     fi; \
     rm -f '$remote_return' '$remote_export'; \
     sudo rm -f '$dropin_file'; sudo systemctl daemon-reload; \
     sudo systemctl stop '$release_unit.timer' '$release_unit.service' 2>/dev/null || true; \
     if test \"\$(TZ=Asia/Kolkata date +%u)\" -le 5 && test \"\$(TZ=Asia/Kolkata date +%H%M)\" -ge 0900 && test \"\$(TZ=Asia/Kolkata date +%H%M)\" -le 1520; then sudo systemctl restart multibagger-paper.service; fi" \
    >/dev/null || echo "WARNING: automatic OCI restoration failed; run the documented recovery command." >&2
}
trap restore_oci EXIT INT TERM

if [[ "$recover_requested" == true ]]; then
  [[ -s "$state_dir/upstox_market_data.duckdb" ]] || { echo "No retained laptop database to recover." >&2; exit 1; }
  prepared=true
  restore_oci
  exit 0
fi

echo "Preparing OCI to retain only $oci_agents while $agent runs locally..."
ssh -F "$ssh_config" "$remote_host" \
  "test \"\$(sudo systemctl is-active multibagger-paper.service)\" = active || { echo 'OCI paper worker is not active; there is no load to offload.' >&2; exit 1; }; \
   set -e; restore_on_error() { status=\$?; if test \"\$status\" -ne 0; then sudo rm -f '$dropin_file' '$remote_export'; sudo systemctl daemon-reload; sudo systemctl start multibagger-paper.service; fi; exit \"\$status\"; }; trap restore_on_error EXIT; \
   sudo systemctl stop multibagger-paper.service; \
   if ! sudo /opt/breeze/venv/bin/python -c \"import duckdb,sys; c=duckdb.connect('/var/lib/multibagger/upstox_market_data.duckdb'); n=c.execute(\\\"select count(*) from paper_trades where status='OPEN'\\\").fetchone()[0]; c.execute('checkpoint'); c.close(); print('open_trades='+str(n)); sys.exit(1 if n else 0)\"; then sudo systemctl start multibagger-paper.service; exit 1; fi; \
   sudo install -d -o root -g root -m 0755 '$dropin_dir'; \
   printf '[Service]\\nEnvironment=ENABLED_AGENTS=$oci_agents\\nEnvironment=SIGNAL_INGEST_URL=\\n' | sudo tee '$dropin_file' >/dev/null; \
   sudo cp --reflink=auto /var/lib/multibagger/upstox_market_data.duckdb '$remote_export'; \
   sudo chown ubuntu:ubuntu '$remote_export'; chmod 600 '$remote_export'; \
   sudo systemctl daemon-reload; sudo systemctl start multibagger-paper.service; \
   sudo systemctl stop '$release_unit.timer' '$release_unit.service' 2>/dev/null || true; \
   sudo systemd-run --unit='$release_unit' --on-active=10h /bin/bash -c \"rm -f '$dropin_file'; systemctl daemon-reload; systemctl try-restart multibagger-paper.service\" >/dev/null; trap - EXIT"
prepared=true

echo "Copying the synchronized paper state for $agent..."
scp -F "$ssh_config" -q "$remote_host:$remote_export" "$state_dir/upstox_market_data.duckdb.next"
mv "$state_dir/upstox_market_data.duckdb.next" "$state_dir/upstox_market_data.duckdb"
chmod 600 "$state_dir/upstox_market_data.duckdb"
ssh -F "$ssh_config" "$remote_host" "rm -f '$remote_export'"

set -a
# shellcheck disable=SC1090
. "$credentials_file"
set +a
[[ -n "${UPSTOX_ACCESS_TOKEN:-}" ]] || { echo "UPSTOX_ACCESS_TOKEN is empty." >&2; exit 1; }

export ENABLED_AGENTS="$agent"
export ENABLE_LIVE_TRADING=false LIVE_TRADING_ENABLED=false TRADING_EXECUTION_PAUSED=false
export PAPER_SUBMIT_UPSTOX_SANDBOX_ORDERS=false OPTIONS_ENABLED=false OPTIONS_QUANT_ENABLED=false
export MARKET_DATA_PROVIDER=upstox
export MARKET_DATA_DB="$state_dir/upstox_market_data.duckdb"
export SIGNAL_SNAPSHOT_PATH="$state_dir/paper_signals.json"
export ACTIVE_INTRADAY_UNIVERSE_PATH="$state_dir/active-intraday-universe.json"
export PAPER_JOB_LOCK_PATH="$state_dir/paper_jobs.lock"
export NSE_UNIVERSE_PATH="$repo_dir/data/market-universe.json"
export NO_TRADE_EVENTS_PATH="$repo_dir/data/no-trade-events.json"
export NSE_UNIVERSE_SIZE=500 INTRADAY_TRADING_UNIVERSE_SIZE=250
export PAPER_DAILY_PROFIT_TARGET_INR=4000 PAPER_DAILY_LOSS_LIMIT_INR=1000
export PAPER_MAX_RISK_PER_TRADE_INR=500 PAPER_MAX_AGGREGATE_OPEN_RISK_INR=750
export PYTHONPATH="$repo_dir:$repo_dir/.python-packages"

echo "$agent is local; $oci_agents remain on OCI. Press Ctrl-C to return the state to OCI."
cd "$state_dir"
python3 -m scripts.market_engine worker \
  --scan-interval 900 --monitor-interval 30 \
  --scan-max-runtime 240 --monitor-max-runtime 45 \
  --job-lock-path "$state_dir/paper_jobs.lock"
