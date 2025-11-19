-- =====================================================
-- PHASE 2: GLOBAL DEDUPLICATION (ALL WALLETS)
-- =====================================================
-- Target: pm_trades_raw (16.5M rows → ~1.3M rows)
-- Expected Reduction: ~91% (12,761x → 1x)
-- Execution Time: 60-90 minutes
-- Strategy: Create clean table + atomic swap
-- =====================================================

-- =====================================================
-- STEP 2A: CREATE GLOBAL CLEAN TABLE
-- =====================================================

CREATE TABLE polymarket_canonical.pm_trades_raw_v2
ENGINE = ReplacingMergeTree()
ORDER BY (wallet, transaction_hash, log_index)
SETTINGS index_granularity = 8192
AS
SELECT *
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY transaction_hash, log_index
      ORDER BY
        timestamp DESC,           -- Prefer latest timestamp
        wallet ASC                -- Tiebreaker (rare edge case)
    ) AS rn
  FROM polymarket_canonical.pm_trades_raw
)
WHERE rn = 1;

-- Execution note: This will take 60-90 minutes on 16.5M rows
-- Monitor with: SELECT count(*) FROM polymarket_canonical.pm_trades_raw_v2;

-- =====================================================
-- STEP 2B: VALIDATION QUERIES (RUN BEFORE SWAP!)
-- =====================================================

-- 1. Check total rowcount
SELECT 'Total Rows After Dedup' AS metric, count(*) AS value
FROM polymarket_canonical.pm_trades_raw_v2;
-- Expected: ~1.3M (down from 16.5M)

-- 2. Verify duplication factor is 1.0
SELECT
  'Duplication Check' AS metric,
  count(*) AS total_rows,
  count(DISTINCT (transaction_hash, log_index)) AS unique_keys,
  count() / count(DISTINCT (transaction_hash, log_index)) AS duplication_factor
FROM polymarket_canonical.pm_trades_raw_v2;
-- Expected duplication_factor: 1.0

-- 3. Verify NO duplicate keys remain
SELECT
  'Duplicate Keys Check' AS metric,
  count(*) AS duplicate_count
FROM (
  SELECT
    transaction_hash,
    log_index,
    count(*) AS dup_count
  FROM polymarket_canonical.pm_trades_raw_v2
  GROUP BY transaction_hash, log_index
  HAVING dup_count > 1
);
-- Expected: 0

-- 4. Compare unique keys (old vs new)
SELECT
  'Old Table' AS source,
  count(*) AS total_rows,
  count(DISTINCT (transaction_hash, log_index)) AS unique_keys
FROM polymarket_canonical.pm_trades_raw

UNION ALL

SELECT
  'New Table' AS source,
  count(*) AS total_rows,
  count(DISTINCT (transaction_hash, log_index)) AS unique_keys
FROM polymarket_canonical.pm_trades_raw_v2;
-- Unique keys should be IDENTICAL

-- 5. Verify wallet coverage unchanged
SELECT
  'Old Table' AS source,
  count(DISTINCT wallet) AS unique_wallets
FROM polymarket_canonical.pm_trades_raw

UNION ALL

SELECT
  'New Table' AS source,
  count(DISTINCT wallet) AS unique_wallets
FROM polymarket_canonical.pm_trades_raw_v2;
-- Wallet count should be IDENTICAL

-- 6. Verify date coverage unchanged
SELECT
  'Old Table' AS source,
  min(timestamp) AS earliest,
  max(timestamp) AS latest,
  max(timestamp) - min(timestamp) AS date_range_days
FROM polymarket_canonical.pm_trades_raw

UNION ALL

SELECT
  'New Table' AS source,
  min(timestamp) AS earliest,
  max(timestamp) AS latest,
  max(timestamp) - min(timestamp) AS date_range_days
FROM polymarket_canonical.pm_trades_raw_v2;
-- Date range should be IDENTICAL

-- 7. Top 10 wallets comparison
SELECT
  'Old Table' AS source,
  wallet,
  count(*) AS row_count
FROM polymarket_canonical.pm_trades_raw
GROUP BY wallet
ORDER BY row_count DESC
LIMIT 10

UNION ALL

SELECT
  'New Table' AS source,
  wallet,
  count(*) AS row_count
FROM polymarket_canonical.pm_trades_raw_v2
GROUP BY wallet
ORDER BY row_count DESC
LIMIT 10
ORDER BY source, row_count DESC;
-- Manually verify rowcounts make sense (should be ~12,761x less for new table)

-- 8. XCN wallet verification (from Phase 1)
SELECT
  'Old Table' AS source,
  count(*) AS row_count
FROM polymarket_canonical.pm_trades_raw
WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'

UNION ALL

SELECT
  'New Table' AS source,
  count(*) AS row_count
FROM polymarket_canonical.pm_trades_raw_v2
WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'

UNION ALL

SELECT
  'Phase 1 Clean' AS source,
  count(*) AS row_count
FROM polymarket_canonical.pm_trades_xcn_clean;
-- All three should match (~1,299 rows)

-- =====================================================
-- STEP 2C: ATOMIC TABLE SWAP (ZERO DOWNTIME)
-- =====================================================

-- CRITICAL: Only run this AFTER all validations pass!

RENAME TABLE
  polymarket_canonical.pm_trades_raw TO polymarket_canonical.pm_trades_raw_backup,
  polymarket_canonical.pm_trades_raw_v2 TO polymarket_canonical.pm_trades_raw;

-- This is atomic and instant (<1 second)
-- Old table is preserved as pm_trades_raw_backup for rollback

-- =====================================================
-- STEP 2D: VERIFY SWAP COMPLETED
-- =====================================================

-- 1. Verify new table is active
SELECT 'Active Table Check' AS metric, count(*) AS value
FROM polymarket_canonical.pm_trades_raw;
-- Expected: ~1.3M (deduplicated)

-- 2. Verify backup exists
SELECT 'Backup Table Check' AS metric, count(*) AS value
FROM polymarket_canonical.pm_trades_raw_backup;
-- Expected: ~16.5M (original with duplicates)

-- 3. Verify no duplicates in active table
SELECT
  'Final Duplication Check' AS metric,
  count() / count(DISTINCT (transaction_hash, log_index)) AS duplication_factor
FROM polymarket_canonical.pm_trades_raw;
-- Expected: 1.0

-- =====================================================
-- STEP 2E: UPDATE DEPENDENT VIEWS (IF ANY)
-- =====================================================

-- Check for dependent views
SELECT
  database,
  name,
  engine,
  create_table_query
FROM system.tables
WHERE database = 'polymarket_canonical'
  AND engine LIKE '%View%'
  AND create_table_query LIKE '%pm_trades_raw%';

-- If any views exist, they will automatically use the new table
-- (views reference by name, not physical table)

-- However, MATERIALIZED VIEWS may need to be rebuilt:
-- DROP VIEW IF EXISTS polymarket_canonical.materialized_view_name;
-- CREATE MATERIALIZED VIEW polymarket_canonical.materialized_view_name AS ...;

-- =====================================================
-- ROLLBACK PLAN (IF NEEDED)
-- =====================================================

-- If something goes wrong, rollback instantly:
-- RENAME TABLE
--   polymarket_canonical.pm_trades_raw TO polymarket_canonical.pm_trades_raw_failed,
--   polymarket_canonical.pm_trades_raw_backup TO polymarket_canonical.pm_trades_raw;

-- =====================================================
-- CLEANUP (AFTER 7 DAYS OF SUCCESSFUL OPERATION)
-- =====================================================

-- Once you're confident everything works:
-- DROP TABLE polymarket_canonical.pm_trades_raw_backup;
-- DROP TABLE polymarket_canonical.pm_trades_xcn_clean;

-- This frees up disk space (backup is ~16.5M rows)

-- =====================================================
-- SUCCESS CRITERIA
-- =====================================================
-- ✅ Duplication factor = 1.0
-- ✅ All unique (tx_hash, log_index) pairs preserved
-- ✅ All wallets preserved
-- ✅ Date range unchanged
-- ✅ P&L calculations match
-- ✅ API endpoints still work
-- =====================================================
