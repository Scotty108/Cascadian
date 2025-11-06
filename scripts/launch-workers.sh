#!/bin/bash
set -euo pipefail

# Preflight checks
mkdir -p data/backfill
ulimit -n 65536

echo "====================================================================="
echo "LAUNCHING PARALLEL BACKFILL SYSTEM (8 workers + monitor + gates)"
echo "====================================================================="
echo ""

# Kill any existing sessions
echo "Cleaning up old tmux sessions..."
for i in {0..7}; do
  tmux kill-session -t bf$i 2>/dev/null || true
done
tmux kill-session -t monitor 2>/dev/null || true
tmux kill-session -t gates 2>/dev/null || true
tmux kill-session -t oncomplete 2>/dev/null || true

sleep 1

# Export env vars for tmux sessions
export CLICKHOUSE_HOST="https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443"
export CLICKHOUSE_USER="default"
export CLICKHOUSE_PASSWORD="8miOkWI~OhsDb"
export CLICKHOUSE_DATABASE="default"
export ETHEREUM_RPC_URL="https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO"
export SHARDS=8

# Launch 8 parallel workers (day-sharded)
echo "Starting 8 parallel backfill workers..."
for i in {0..7}; do
  echo "  Worker $i: day_idx % 8 == $i"
  tmux new-session -d -s "bf$i" \
    "cd /Users/scotty/Projects/Cascadian-app && SHARDS=8 SHARD_ID=$i CLICKHOUSE_HOST='$CLICKHOUSE_HOST' CLICKHOUSE_USER='$CLICKHOUSE_USER' CLICKHOUSE_PASSWORD='$CLICKHOUSE_PASSWORD' CLICKHOUSE_DATABASE='$CLICKHOUSE_DATABASE' ETHEREUM_RPC_URL='$ETHEREUM_RPC_URL' npx tsx scripts/step3-streaming-backfill-parallel.ts >> data/backfill/worker-$i.log 2>&1"
done

echo "All 8 workers launched"
echo ""

# Monitor with auto-restart
echo "Starting monitor (auto-restart on stall)..."
tmux new-session -d -s monitor \
  "cd /Users/scotty/Projects/Cascadian-app && SHARDS=8 CLICKHOUSE_HOST='$CLICKHOUSE_HOST' CLICKHOUSE_USER='$CLICKHOUSE_USER' CLICKHOUSE_PASSWORD='$CLICKHOUSE_PASSWORD' CLICKHOUSE_DATABASE='$CLICKHOUSE_DATABASE' npx tsx scripts/parallel-backfill-monitor.ts >> data/backfill/monitor.log 2>&1"
echo "Monitor started"
echo ""

# Incremental safety gates
echo "Starting incremental safety gates (every 30 min)..."
tmux new-session -d -s gates \
  "cd /Users/scotty/Projects/Cascadian-app && INTERVAL_MINUTES=30 CLICKHOUSE_HOST='$CLICKHOUSE_HOST' CLICKHOUSE_USER='$CLICKHOUSE_USER' CLICKHOUSE_PASSWORD='$CLICKHOUSE_PASSWORD' CLICKHOUSE_DATABASE='$CLICKHOUSE_DATABASE' npx tsx scripts/incremental-safety-gates.ts >> data/backfill/gates.log 2>&1"
echo "Gates started"
echo ""

# On-complete rebuild hook
echo "Starting on-complete rebuild hook..."
tmux new-session -d -s oncomplete \
  "cd /Users/scotty/Projects/Cascadian-app && CLICKHOUSE_HOST='$CLICKHOUSE_HOST' CLICKHOUSE_USER='$CLICKHOUSE_USER' CLICKHOUSE_PASSWORD='$CLICKHOUSE_PASSWORD' CLICKHOUSE_DATABASE='$CLICKHOUSE_DATABASE' ./scripts/on-complete-rebuild.sh >> data/backfill/on-complete.log 2>&1"
echo "On-complete hook started"
echo ""

echo "====================================================================="
echo "ALL SYSTEMS RUNNING - HANDS OFF EXECUTION"
echo "====================================================================="
echo ""

echo "Monitor progress:"
echo "  tmux attach-session -t monitor"
echo ""

echo "Check logs:"
echo "  tail -f data/backfill/worker-0.log    (Worker 0)"
echo "  tail -f data/backfill/monitor.log    (Monitor)"
echo "  tail -f data/backfill/gates.log      (Gates)"
echo "  tail -f data/backfill/on-complete.log (Rebuild)"
echo ""

echo "Progress check:"
echo "  Days complete: SELECT countIf(status='COMPLETE') FROM backfill_checkpoint;"
echo "  Worker health: SELECT worker_id, last_batch FROM worker_heartbeats ORDER BY worker_id;"
echo ""

echo "Expected completion: 2-5 hours (8 workers, 1048 days)"
echo ""

echo "Active tmux sessions:"
tmux list-sessions
