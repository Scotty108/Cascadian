#!/bin/bash
set -euo pipefail

cd /Users/scotty/Projects/Cascadian-app

mkdir -p data/backfill

echo "RELAUNCHING PARALLEL BACKFILL (8 workers + monitor + gates)"
echo ""

# Kill any existing
pkill -f "step3-streaming-backfill-parallel" || true
pkill -f "parallel-backfill-monitor" || true
pkill -f "incremental-safety-gates" || true
pkill -f "on-complete-rebuild" || true

sleep 1

# Environment
export CLICKHOUSE_HOST="https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443"
export CLICKHOUSE_USER="default"
export CLICKHOUSE_PASSWORD="8miOkWI~OhsDb"
export CLICKHOUSE_DATABASE="default"
export ETHEREUM_RPC_URL="https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO"
export SHARDS=8

# Launch 8 workers from correct directory
echo "Starting 8 workers..."
for i in {0..7}; do
  (
    cd /Users/scotty/Projects/Cascadian-app
    SHARDS=8 SHARD_ID=$i \
    CLICKHOUSE_HOST="$CLICKHOUSE_HOST" \
    CLICKHOUSE_USER="$CLICKHOUSE_USER" \
    CLICKHOUSE_PASSWORD="$CLICKHOUSE_PASSWORD" \
    CLICKHOUSE_DATABASE="$CLICKHOUSE_DATABASE" \
    ETHEREUM_RPC_URL="$ETHEREUM_RPC_URL" \
    nohup npx tsx ./scripts/step3-streaming-backfill-parallel.ts \
    >> data/backfill/worker-$i.log 2>&1 &
  )
  sleep 0.5
done

echo "Started all 8 workers"
sleep 2

# Monitor
(
  cd /Users/scotty/Projects/Cascadian-app
  SHARDS=8 \
  CLICKHOUSE_HOST="$CLICKHOUSE_HOST" \
  CLICKHOUSE_USER="$CLICKHOUSE_USER" \
  CLICKHOUSE_PASSWORD="$CLICKHOUSE_PASSWORD" \
  CLICKHOUSE_DATABASE="$CLICKHOUSE_DATABASE" \
  nohup npx tsx ./scripts/parallel-backfill-monitor.ts \
  >> data/backfill/monitor.log 2>&1 &
)

echo "Started monitor"
sleep 1

# Gates
(
  cd /Users/scotty/Projects/Cascadian-app
  INTERVAL_MINUTES=30 \
  CLICKHOUSE_HOST="$CLICKHOUSE_HOST" \
  CLICKHOUSE_USER="$CLICKHOUSE_USER" \
  CLICKHOUSE_PASSWORD="$CLICKHOUSE_PASSWORD" \
  CLICKHOUSE_DATABASE="$CLICKHOUSE_DATABASE" \
  nohup npx tsx ./scripts/incremental-safety-gates.ts \
  >> data/backfill/gates.log 2>&1 &
)

echo "Started gates"
sleep 1

# Rebuild hook
(
  cd /Users/scotty/Projects/Cascadian-app
  CLICKHOUSE_HOST="$CLICKHOUSE_HOST" \
  CLICKHOUSE_USER="$CLICKHOUSE_USER" \
  CLICKHOUSE_PASSWORD="$CLICKHOUSE_PASSWORD" \
  CLICKHOUSE_DATABASE="$CLICKHOUSE_DATABASE" \
  nohup bash ./scripts/on-complete-rebuild.sh \
  >> data/backfill/on-complete.log 2>&1 &
)

echo "Started on-complete hook"
echo ""
echo "All systems running!"
echo ""

sleep 2
ps aux | grep -E "tsx|bash" | grep -E "step3|monitor|gates|on-complete" | grep -v grep | head -20
