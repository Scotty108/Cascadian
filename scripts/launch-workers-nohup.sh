#!/bin/bash
set -euo pipefail

mkdir -p data/backfill

echo "====================================================================="
echo "LAUNCHING PARALLEL BACKFILL SYSTEM (8 workers + monitor + gates)"
echo "====================================================================="
echo ""

# Environment
export CLICKHOUSE_HOST="https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443"
export CLICKHOUSE_USER="default"
export CLICKHOUSE_PASSWORD="8miOkWI~OhsDb"
export CLICKHOUSE_DATABASE="default"
export ETHEREUM_RPC_URL="https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO"
export SHARDS=8

# Kill any existing workers
pkill -f "step3-streaming-backfill-parallel" || true
pkill -f "parallel-backfill-monitor" || true
pkill -f "incremental-safety-gates" || true
pkill -f "on-complete-rebuild" || true

sleep 1

# Launch 8 parallel workers
echo "Starting 8 parallel backfill workers..."
for i in {0..7}; do
  echo "  Worker $i: day_idx % 8 == $i"
  nohup env \
    SHARDS=8 \
    SHARD_ID=$i \
    CLICKHOUSE_HOST="$CLICKHOUSE_HOST" \
    CLICKHOUSE_USER="$CLICKHOUSE_USER" \
    CLICKHOUSE_PASSWORD="$CLICKHOUSE_PASSWORD" \
    CLICKHOUSE_DATABASE="$CLICKHOUSE_DATABASE" \
    ETHEREUM_RPC_URL="$ETHEREUM_RPC_URL" \
    npx tsx scripts/step3-streaming-backfill-parallel.ts \
    >> data/backfill/worker-$i.log 2>&1 &
  sleep 0.5
done

echo "All 8 workers launched in background"
echo ""

# Monitor with auto-restart
echo "Starting monitor (auto-restart on stall)..."
nohup env \
  SHARDS=8 \
  CLICKHOUSE_HOST="$CLICKHOUSE_HOST" \
  CLICKHOUSE_USER="$CLICKHOUSE_USER" \
  CLICKHOUSE_PASSWORD="$CLICKHOUSE_PASSWORD" \
  CLICKHOUSE_DATABASE="$CLICKHOUSE_DATABASE" \
  npx tsx scripts/parallel-backfill-monitor.ts \
  >> data/backfill/monitor.log 2>&1 &
echo "Monitor started (PID $!)"
echo ""

# Incremental safety gates
echo "Starting incremental safety gates (every 30 min)..."
nohup env \
  INTERVAL_MINUTES=30 \
  CLICKHOUSE_HOST="$CLICKHOUSE_HOST" \
  CLICKHOUSE_USER="$CLICKHOUSE_USER" \
  CLICKHOUSE_PASSWORD="$CLICKHOUSE_PASSWORD" \
  CLICKHOUSE_DATABASE="$CLICKHOUSE_DATABASE" \
  npx tsx scripts/incremental-safety-gates.ts \
  >> data/backfill/gates.log 2>&1 &
echo "Gates started (PID $!)"
echo ""

# On-complete rebuild hook
echo "Starting on-complete rebuild hook..."
nohup env \
  CLICKHOUSE_HOST="$CLICKHOUSE_HOST" \
  CLICKHOUSE_USER="$CLICKHOUSE_USER" \
  CLICKHOUSE_PASSWORD="$CLICKHOUSE_PASSWORD" \
  CLICKHOUSE_DATABASE="$CLICKHOUSE_DATABASE" \
  ./scripts/on-complete-rebuild.sh \
  >> data/backfill/on-complete.log 2>&1 &
echo "On-complete hook started (PID $!)"
echo ""

echo "====================================================================="
echo "ALL SYSTEMS RUNNING - HANDS OFF EXECUTION"
echo "====================================================================="
echo ""

echo "Monitor progress:"
echo "  tail -f data/backfill/monitor.log"
echo ""

echo "Check worker logs:"
echo "  tail -f data/backfill/worker-0.log    (Worker 0)"
echo "  ls -lh data/backfill/worker-*.log"
echo ""

echo "Expected completion: 2-5 hours (8 workers, 1048 days)"
echo ""

sleep 2

echo "Background processes:"
ps aux | grep -E "step3|monitor|gates|on-complete" | grep -v grep || echo "Processes starting..."
