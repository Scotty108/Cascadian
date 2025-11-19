#!/bin/bash
set -e

export CLICKHOUSE_HOST="https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443"
export CLICKHOUSE_USER="default"
export CLICKHOUSE_PASSWORD="8miOkWI~OhsDb"
export CLICKHOUSE_DATABASE="default"
export CLICKHOUSE_REQUEST_TIMEOUT_MS=180000
export BATCH_ROWS=3000
export SHARDS=8

echo "🔄 Launching 8 workers with BATCH_ROWS=3000..."

for i in {0..7}; do
  SHARD_ID=$i npx tsx scripts/step3-streaming-backfill-parallel.ts >> data/backfill/worker-$i.log 2>&1 &
  echo "  ✅ Worker $i launched (shard $i/8)"
done

sleep 2

echo ""
echo "📊 Active workers:"
ps aux | grep -E "step3-streaming-backfill-parallel" | grep -v grep | wc -l | xargs echo "  Count:"

echo ""
echo "⏱️  Starting backfill with reduced batch size..."
