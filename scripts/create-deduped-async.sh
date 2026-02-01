#!/bin/bash
# Create materialized deduplicated table - runs async on ClickHouse server

CLICKHOUSE_HOST="${CLICKHOUSE_HOST}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-default}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD}"

echo "🔨 Creating materialized deduplicated table (async on server)..."
echo ""

# Drop old table
echo "1️⃣ Dropping old table..."
curl -sS "${CLICKHOUSE_HOST}" \
  --user "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data "DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_deduped"
echo "   ✅ Dropped"
echo ""

# Create table
echo "2️⃣ Creating table structure..."
curl -sS "${CLICKHOUSE_HOST}" \
  --user "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data "CREATE TABLE pm_trade_fifo_roi_v3_mat_deduped (
    tx_hash String,
    wallet LowCardinality(String),
    condition_id String,
    outcome_index UInt8,
    entry_time DateTime,
    resolved_at DateTime,
    cost_usd Float64,
    tokens Float64,
    tokens_sold_early Float64,
    tokens_held Float64,
    exit_value Float64,
    pnl_usd Float64,
    roi Float64,
    pct_sold_early Float64,
    is_maker UInt8,
    is_short UInt8
  ) ENGINE = MergeTree()
  ORDER BY (wallet, condition_id, outcome_index, tx_hash)
  SETTINGS index_granularity = 8192"
echo "   ✅ Table created"
echo ""

# Insert deduplicated data (fire and forget)
echo "3️⃣ Starting INSERT (async, will run on server)..."
curl -sS "${CLICKHOUSE_HOST}" \
  --user "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data "INSERT INTO pm_trade_fifo_roi_v3_mat_deduped
    SELECT
      tx_hash,
      any(wallet) as wallet,
      any(condition_id) as condition_id,
      any(outcome_index) as outcome_index,
      any(entry_time) as entry_time,
      any(resolved_at) as resolved_at,
      any(cost_usd) as cost_usd,
      any(tokens) as tokens,
      any(tokens_sold_early) as tokens_sold_early,
      any(tokens_held) as tokens_held,
      any(exit_value) as exit_value,
      any(pnl_usd) as pnl_usd,
      any(roi) as roi,
      any(pct_sold_early) as pct_sold_early,
      any(is_maker) as is_maker,
      any(is_short) as is_short
    FROM pm_trade_fifo_roi_v3
    GROUP BY tx_hash
    SETTINGS max_execution_time = 3600, max_memory_usage = 100000000000" &

echo "   ✅ INSERT started in background on ClickHouse server"
echo ""
echo "⏳ ETA: 15-30 minutes"
echo ""
echo "Check progress:"
echo "  watch -n 10 'curl -sS ${CLICKHOUSE_HOST} --user ${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD} --data \"SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped\"'"
