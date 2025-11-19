-- ============================================================================
-- CONDITION ID ENRICHMENT - Atomic Rebuild
-- ============================================================================
-- This script populates 77.4M missing condition_ids via market_id JOIN
-- Expected result: 51.47% → ~98% coverage
-- Time: ~5-10 minutes on direct ClickHouse CLI
-- ============================================================================

-- STEP 1: Backup current table
-- ============================================================================
RENAME TABLE trades_raw TO trades_raw_backup_enrichment;
SHOW TABLES LIKE 'trades_raw_backup_enrichment';


-- STEP 2: Create new enriched table (empty shell with schema)
-- ============================================================================
CREATE TABLE trades_raw (
  trade_id String,
  wallet_address String,
  market_id String,
  timestamp DateTime,
  side Enum8('YES' = 1, 'NO' = 2),
  entry_price Decimal(18, 8),
  exit_price Nullable(Decimal(18, 8)),
  shares Decimal(18, 8),
  usd_value Decimal(18, 2),
  pnl Nullable(Decimal(18, 2)),
  is_closed Bool,
  transaction_hash String,
  created_at DateTime,
  close_price Decimal(10, 6),
  fee_usd Decimal(18, 6),
  slippage_usd Decimal(18, 6),
  hours_held Decimal(10, 2),
  bankroll_at_entry Decimal(18, 2),
  outcome Nullable(Int8),
  fair_price_at_entry Decimal(10, 6),
  pnl_gross Decimal(18, 6),
  pnl_net Decimal(18, 6),
  return_pct Decimal(10, 6),
  condition_id String,
  was_win Nullable(UInt8),
  tx_timestamp DateTime,
  canonical_category String,
  raw_tags Array(String),
  realized_pnl_usd Float64,
  is_resolved UInt8,
  resolved_outcome Nullable(String)
)
ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
ORDER BY (wallet_address, timestamp)
SETTINGS index_granularity = 8192;

SHOW CREATE TABLE trades_raw;


-- STEP 3: Insert enriched data (JOIN to populate missing condition_ids)
-- ============================================================================
INSERT INTO trades_raw
SELECT
  t.trade_id,
  t.wallet_address,
  t.market_id,
  t.timestamp,
  t.side,
  t.entry_price,
  t.exit_price,
  t.shares,
  t.usd_value,
  t.pnl,
  t.is_closed,
  t.transaction_hash,
  t.created_at,
  t.close_price,
  t.fee_usd,
  t.slippage_usd,
  t.hours_held,
  t.bankroll_at_entry,
  t.outcome,
  t.fair_price_at_entry,
  t.pnl_gross,
  t.pnl_net,
  t.return_pct,
  COALESCE(t.condition_id, m.condition_id) as condition_id,
  t.was_win,
  t.tx_timestamp,
  t.canonical_category,
  t.raw_tags,
  t.realized_pnl_usd,
  t.is_resolved,
  t.resolved_outcome
FROM trades_raw_backup_enrichment t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id;

SELECT 'Insert complete' as status;


-- STEP 4: Verify enrichment results
-- ============================================================================
SELECT
  'VERIFICATION RESULTS' as phase,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
  COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as without_condition_id,
  ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
FROM trades_raw;


-- STEP 5: Check improvement
-- ============================================================================
SELECT
  'COMPARISON' as metric,
  (SELECT COUNT(*) FROM trades_raw_backup_enrichment) as backup_total,
  (SELECT COUNT(CASE WHEN condition_id != '' THEN 1 END) FROM trades_raw_backup_enrichment) as backup_with_id,
  (SELECT COUNT(*) FROM trades_raw) as new_total,
  (SELECT COUNT(CASE WHEN condition_id != '' THEN 1 END) FROM trades_raw) as new_with_id;


-- STEP 6: Sample comparison (show some enriched rows)
-- ============================================================================
SELECT
  'Sample enriched trades' as note,
  t.trade_id,
  t.wallet_address,
  t.market_id,
  t.condition_id,
  t.timestamp,
  t.side
FROM trades_raw t
WHERE t.condition_id != '' AND t.condition_id IS NOT NULL
LIMIT 5;


-- STEP 7: Cleanup (optional - delete backup after verification)
-- ============================================================================
-- Uncomment the line below ONLY after verifying enrichment was successful:
-- RENAME TABLE trades_raw_backup_enrichment TO trades_raw_old;
-- Or keep it as is for safety


-- ============================================================================
-- NOTES:
-- ============================================================================
-- If INSERT fails or seems slow:
--   1. Check ClickHouse server logs for errors
--   2. The LEFT JOIN may take 5-10 minutes to scan 159M rows
--   3. If needed, you can KILL the query and retry, or run step by step
--
-- If you want to rollback:
--   RENAME TABLE trades_raw TO trades_raw_enriched_v1;
--   RENAME TABLE trades_raw_backup_enrichment TO trades_raw;
--
-- ============================================================================
