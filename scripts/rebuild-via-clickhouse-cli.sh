#!/bin/bash
set -e

echo "════════════════════════════════════════════════════════════════════════════════"
echo "REBUILD fact_trades_clean VIA CLICKHOUSE CLI"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""

echo "Executing CREATE TABLE AS SELECT (this may take 2-5 minutes for 80M rows)..."
echo ""

# Use docker exec to run clickhouse-client directly
docker compose exec clickhouse clickhouse-client --query "
CREATE TABLE IF NOT EXISTS cascadian_clean.fact_trades_clean
ENGINE = ReplacingMergeTree()
ORDER BY (tx_hash, cid_hex, wallet_address)
AS
SELECT
  transaction_hash AS tx_hash,
  toDateTime(timestamp) AS block_time,
  lower(condition_id_norm) AS cid_hex,
  outcome_index,
  wallet_address_norm AS wallet_address,
  trade_direction AS direction,
  shares,
  entry_price AS price,
  usd_value AS usdc_amount,
  'VW_CANONICAL' AS source
FROM default.vw_trades_canonical
WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
"

echo ""
echo "✅ Table created successfully!"
echo ""

echo "Checking row count..."
ROW_COUNT=$(docker compose exec clickhouse clickhouse-client --query "SELECT count() FROM cascadian_clean.fact_trades_clean FORMAT TabSeparated")
echo "Rows inserted: $(echo $ROW_COUNT | numfmt --grouping 2>/dev/null || echo $ROW_COUNT)"
echo ""

echo "════════════════════════════════════════════════════════════════════════════════"
echo "NEXT: Run npx tsx verify-join-coverage.ts to check if fix worked"
echo "════════════════════════════════════════════════════════════════════════════════"
