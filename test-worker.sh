#!/bin/bash
set -e

export CLICKHOUSE_HOST="https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443"
export CLICKHOUSE_USER="default"
export CLICKHOUSE_PASSWORD="8miOkWI~OhsDb"
export CLICKHOUSE_DATABASE="default"
export ETHEREUM_RPC_URL="https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO"
export SHARDS=8
export SHARD_ID=0

echo "Test Worker: SHARD_ID=0"
echo ""

npx tsx scripts/step3-streaming-backfill-parallel.ts
