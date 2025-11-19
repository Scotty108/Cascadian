#!/bin/bash

echo "=== TASK 2: REPAIR CONDITION IDs (via ClickHouse CLI) ==="
echo ""

# Extract connection details from env
source .env.local

echo "Creating repaired table..."
echo "(This will take 3-7 minutes)"
echo ""

clickhouse-client \
  --host="${CLICKHOUSE_HOST}" \
  --port=9440 \
  --secure \
  --user="${CLICKHOUSE_USER}" \
  --password="${CLICKHOUSE_PASSWORD}" \
  --query="
    CREATE TABLE IF NOT EXISTS default.trades_with_direction_repaired
    ENGINE = ReplacingMergeTree()
    ORDER BY (tx_hash, wallet_address, outcome_index)
    AS
    SELECT
      twd.tx_hash,
      twd.wallet_address,
      lower(replaceAll(tr.condition_id, '0x', '')) as condition_id_norm,
      twd.market_id,
      twd.outcome_index,
      twd.side_token,
      twd.direction_from_transfers,
      twd.shares,
      twd.price,
      twd.usd_value,
      twd.usdc_delta,
      twd.token_delta,
      twd.confidence,
      twd.reason,
      twd.recovery_status,
      twd.data_source,
      now() as computed_at
    FROM default.trades_with_direction twd
    INNER JOIN default.trades_raw tr
      ON twd.tx_hash = tr.tx_hash
    WHERE length(replaceAll(tr.condition_id, '0x', '')) = 64
    SETTINGS max_execution_time = 600
  "

echo ""
echo "✓ Table created"
echo ""

# Verify
echo "Verifying repair..."
clickhouse-client \
  --host="${CLICKHOUSE_HOST}" \
  --port=9440 \
  --secure \
  --user="${CLICKHOUSE_USER}" \
  --password="${CLICKHOUSE_PASSWORD}" \
  --query="
    SELECT
      countIf(length(condition_id_norm) = 64) as valid_64char,
      countIf(length(condition_id_norm) != 64) as invalid,
      countIf(condition_id_norm LIKE '0x%') as has_prefix,
      count() as total
    FROM default.trades_with_direction_repaired
    FORMAT Vertical
  "

echo ""
echo "Task 2 complete!"
