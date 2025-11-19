-- ============================================================================
-- CONDITION ID ENRICHMENT - ASYNC INSERT (No timeout issues)
-- ============================================================================

-- STEP 1: Check what we have
-- ============================================================================
SELECT 'Checking current state...' as status;
SHOW TABLES LIKE 'trades_raw%';


-- STEP 2: Drop backup from failed attempt
-- ============================================================================
DROP TABLE IF EXISTS trades_raw_backup_enrichment;


-- STEP 3: Backup current table
-- ============================================================================
RENAME TABLE trades_raw TO trades_raw_backup_enrichment;
SELECT 'Backup created: trades_raw_backup_enrichment' as status;


-- STEP 4: Create new empty table
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

SELECT 'New empty table created' as status;


-- STEP 5: ASYNC INSERT (returns immediately, runs in background)
-- ============================================================================
-- This will submit the query and return instantly
-- The server processes it in the background
-- You can disconnect and reconnect to check progress
-- ============================================================================
INSERT INTO trades_raw SETTINGS insert_quorum_parallel=2, async_insert=1, async_insert_busy_timeout_ms=200
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

SELECT 'ASYNC INSERT SUBMITTED - Running in background. You can disconnect now.' as status;


-- ============================================================================
-- STEP 6: Monitor progress (run this in a new connection after a few minutes)
-- ============================================================================
-- After waiting 5-10 minutes, disconnect and reconnect, then run:
-- SELECT COUNT(*) FROM trades_raw;
--
-- Progress indicators:
--   0 rows = still initializing
--   ~80M rows = halfway through
--   159.6M rows = COMPLETE!
--
-- Once row count reaches 159.6M, run verification:
-- SELECT
--   COUNT(*) as total,
--   COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_condition_id,
--   ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
-- FROM trades_raw;
--
-- Expected: coverage_pct = 98%+
-- ============================================================================
