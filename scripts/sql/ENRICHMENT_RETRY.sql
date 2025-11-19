-- ============================================================================
-- CONDITION ID ENRICHMENT - RETRY (Backup exists, will reuse it)
-- ============================================================================

-- STEP 1: Drop existing backup (from previous failed attempt)
-- ============================================================================
DROP TABLE IF EXISTS trades_raw_backup_enrichment;
SHOW TABLES LIKE 'trades_raw%';


-- STEP 2: Make fresh backup
-- ============================================================================
RENAME TABLE trades_raw TO trades_raw_backup_enrichment;


-- STEP 3: Create new enriched table
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


-- STEP 4: INSERT enriched data (THIS IS THE LONG OPERATION - ~15 minutes)
-- Keep your terminal OPEN and connected while this runs!
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

-- This message appears when INSERT completes:
SELECT 'INSERT COMPLETE - Checking results...' as status;


-- STEP 5: Verify results
-- ============================================================================
SELECT
  'FINAL VERIFICATION' as result,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
  COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as without_condition_id,
  ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
FROM trades_raw;

-- Expected: coverage_pct should be 98%+ (was 51.47%)
