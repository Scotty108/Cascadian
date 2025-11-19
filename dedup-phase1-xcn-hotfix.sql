-- =====================================================
-- PHASE 1: XCN WALLET IMMEDIATE HOTFIX
-- =====================================================
-- Target: 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e
-- Expected: ~1,299 rows (down from 16M+ duplicates)
-- Execution Time: ~10 seconds
-- =====================================================

-- STEP 1A: CREATE DEDUPLICATED XCN TABLE
-- This removes 12,761x duplication using (transaction_hash, log_index) as natural key

CREATE TABLE polymarket_canonical.pm_trades_xcn_clean
ENGINE = ReplacingMergeTree()
ORDER BY (wallet, transaction_hash, log_index)
AS
SELECT *
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY transaction_hash, log_index
      ORDER BY timestamp DESC  -- Keep most recent version
    ) AS rn
  FROM polymarket_canonical.pm_trades_raw
  WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
)
WHERE rn = 1;

-- =====================================================
-- STEP 1B: VALIDATION QUERIES
-- =====================================================

-- 1. Check total rowcount
SELECT 'Total Rows' AS metric, count(*) AS value
FROM polymarket_canonical.pm_trades_xcn_clean;
-- Expected: ~1,299

-- 2. Verify NO duplicates remain
SELECT 'Duplicate Check' AS metric, count(*) AS value
FROM (
  SELECT
    transaction_hash,
    log_index,
    count(*) AS dup_count
  FROM polymarket_canonical.pm_trades_xcn_clean
  GROUP BY transaction_hash, log_index
  HAVING dup_count > 1
);
-- Expected: 0

-- 3. Compare unique keys
SELECT
  'Before Dedup' AS state,
  count(*) AS total_rows,
  count(DISTINCT (transaction_hash, log_index)) AS unique_keys,
  count() / count(DISTINCT (transaction_hash, log_index)) AS duplication_factor
FROM polymarket_canonical.pm_trades_raw
WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'

UNION ALL

SELECT
  'After Dedup' AS state,
  count(*) AS total_rows,
  count(DISTINCT (transaction_hash, log_index)) AS unique_keys,
  count() / count(DISTINCT (transaction_hash, log_index)) AS duplication_factor
FROM polymarket_canonical.pm_trades_xcn_clean;

-- 4. Sample trades for manual verification
SELECT
  timestamp,
  transaction_hash,
  log_index,
  side,
  size,
  price
FROM polymarket_canonical.pm_trades_xcn_clean
ORDER BY timestamp DESC
LIMIT 10;

-- 5. Calculate P&L for comparison to Polymarket API
SELECT
  'XCN Wallet P&L' AS metric,
  sum(CASE
    WHEN side = 'BUY' THEN -price * size
    ELSE price * size
  END) AS net_pnl,
  count(*) AS total_trades,
  count(DISTINCT transaction_hash) AS unique_transactions,
  min(timestamp) AS earliest_trade,
  max(timestamp) AS latest_trade
FROM polymarket_canonical.pm_trades_xcn_clean;

-- =====================================================
-- NEXT STEPS
-- =====================================================
-- 1. Compare rowcount to Polymarket API
-- 2. Compare P&L to Polymarket API
-- 3. If validation passes, proceed to Phase 2 (global dedup)
-- 4. If validation fails, investigate discrepancies before proceeding
-- =====================================================
