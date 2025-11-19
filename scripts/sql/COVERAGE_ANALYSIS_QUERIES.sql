-- ========================================
-- COVERAGE ANALYSIS QUERIES
-- ========================================
-- Date: 2025-11-08
-- Purpose: Calculate true coverage for Phase 1 vs Phase 2 decision
--
-- Results Summary:
-- - Transaction coverage: 99.77% (misleading)
-- - Wallet coverage: 1.61% (the truth)
-- - Volume coverage: 2.32% (the killer)
--
-- Verdict: Phase 1 insufficient, Phase 2 required
-- ========================================

-- ========================================
-- STEP 1: Total Unique Transaction Universe
-- ========================================
-- Get the denominator: how many total unique trades exist?

SELECT uniqExact(tx_hash) as total_unique_txs
FROM (
  SELECT transaction_hash as tx_hash
  FROM vw_trades_canonical
  WHERE transaction_hash != ''

  UNION DISTINCT

  SELECT transaction_hash as tx_hash
  FROM trades_raw_enriched_final
  WHERE transaction_hash != ''

  UNION DISTINCT

  SELECT tx_hash
  FROM trade_direction_assignments
  WHERE tx_hash != ''

  UNION DISTINCT

  SELECT tx_hash
  FROM trades_with_direction
  WHERE tx_hash != ''

  UNION DISTINCT

  SELECT transaction_hash as tx_hash
  FROM trades_raw
  WHERE transaction_hash != ''
);

-- Result: 33,689,815 total unique transactions


-- ========================================
-- STEP 2: Recoverable Transactions with Valid condition_ids
-- ========================================
-- How many transactions have valid condition_ids in at least one table?

WITH valid_condition_ids AS (
  -- From vw_trades_canonical
  SELECT DISTINCT transaction_hash as tx_hash
  FROM vw_trades_canonical
  WHERE transaction_hash != ''
    AND condition_id_norm != ''
    AND condition_id_norm != concat('0x', repeat('0',64))
    AND length(replaceAll(condition_id_norm, '0x', '')) = 64

  UNION DISTINCT

  -- From trades_raw_enriched_final
  SELECT DISTINCT transaction_hash as tx_hash
  FROM trades_raw_enriched_final
  WHERE transaction_hash != ''
    AND condition_id != ''
    AND condition_id IS NOT NULL
    AND condition_id != 'null'

  UNION DISTINCT

  -- From trade_direction_assignments
  SELECT DISTINCT tx_hash
  FROM trade_direction_assignments
  WHERE tx_hash != ''
    AND condition_id_norm != ''
    AND condition_id_norm != concat('0x', repeat('0',64))
    AND length(replaceAll(condition_id_norm, '0x', '')) = 64
)
SELECT
  count() as recoverable_txs,
  33689815 as total_txs,
  round(recoverable_txs / total_txs * 100, 2) as coverage_pct
FROM valid_condition_ids;

-- Result: 33,612,817 recoverable (99.77% coverage)
-- MISLEADING: This is transaction-level, not wallet-level


-- ========================================
-- STEP 3: Per-Wallet Coverage Analysis
-- ========================================
-- What % of wallets have sufficient data quality (≥80% coverage)?

WITH wallet_coverage AS (
  SELECT
    wallet_address_norm,
    count() as total_trades,
    countIf(
      condition_id_norm != ''
      AND condition_id_norm != concat('0x', repeat('0',64))
      AND length(replaceAll(condition_id_norm, '0x', '')) = 64
    ) as valid_trades,
    round(valid_trades / total_trades * 100, 2) as coverage_pct
  FROM vw_trades_canonical
  WHERE wallet_address_norm != ''
  GROUP BY wallet_address_norm
  HAVING total_trades > 0
)
SELECT
  countIf(coverage_pct >= 80) as wallets_80pct_plus,
  countIf(coverage_pct >= 90) as wallets_90pct_plus,
  countIf(coverage_pct >= 95) as wallets_95pct_plus,
  count() as total_wallets,
  round(wallets_80pct_plus / total_wallets * 100, 2) as wallet_coverage_80_pct,
  round(wallets_90pct_plus / total_wallets * 100, 2) as wallet_coverage_90_pct,
  round(wallets_95pct_plus / total_wallets * 100, 2) as wallet_coverage_95_pct
FROM wallet_coverage;

-- Results:
-- Total wallets: 996,109
-- Wallets ≥80%: 16,045 (1.61%)
-- Wallets ≥90%: 6,656 (0.67%)
-- Wallets ≥95%: 4,796 (0.48%)
--
-- CRITICAL: Only 1.61% of wallets meet quality threshold


-- ========================================
-- STEP 4: Source Table Breakdown
-- ========================================
-- What % of rows in each source table have valid condition_ids?

-- vw_trades_canonical
SELECT
  countIf(condition_id_norm != '' AND condition_id_norm != concat('0x', repeat('0',64))) as valid,
  count() as total,
  round(valid / total * 100, 2) as pct
FROM vw_trades_canonical;
-- Result: 80,109,651 / 157,541,131 (50.85%)

-- trades_raw_enriched_final
SELECT
  countIf(condition_id != '' AND condition_id IS NOT NULL AND condition_id != 'null') as valid,
  count() as total,
  round(valid / total * 100, 2) as pct
FROM trades_raw_enriched_final;
-- Result: 86,100,149 / 166,913,053 (51.58%)

-- trade_direction_assignments
SELECT
  countIf(condition_id_norm != '' AND condition_id_norm != concat('0x', repeat('0',64))) as valid,
  count() as total,
  round(valid / total * 100, 2) as pct
FROM trade_direction_assignments;
-- Result: 65,010,262 / 129,599,951 (50.16%)

-- FINDING: All tables have ~50% row-level validity
-- High transaction coverage comes from UNION DISTINCT deduplication


-- ========================================
-- STEP 5: High-Coverage Wallet Analysis
-- ========================================
-- What % of total trading volume do high-coverage wallets represent?

WITH wallet_coverage AS (
  SELECT
    wallet_address_norm,
    count() as total_trades,
    countIf(
      condition_id_norm != ''
      AND condition_id_norm != concat('0x', repeat('0',64))
      AND length(replaceAll(condition_id_norm, '0x', '')) = 64
    ) as valid_trades,
    round(valid_trades / total_trades * 100, 2) as coverage_pct
  FROM vw_trades_canonical
  WHERE wallet_address_norm != ''
  GROUP BY wallet_address_norm
  HAVING total_trades > 0
),
high_coverage_wallets AS (
  SELECT * FROM wallet_coverage WHERE coverage_pct >= 80
)
SELECT
  -- Volume distribution
  quantile(0.5)(total_trades) as median_trades,
  quantile(0.9)(total_trades) as p90_trades,
  max(total_trades) as max_trades,

  -- Total volume captured
  sum(total_trades) as total_trades_high_coverage,
  sum(valid_trades) as total_valid_trades_high_coverage,

  -- Coverage quality
  avg(coverage_pct) as avg_coverage_pct,
  min(coverage_pct) as min_coverage_pct,

  -- Count
  count() as num_high_coverage_wallets,

  -- What % of TOTAL trade volume do these wallets represent?
  round(sum(total_trades) / (SELECT count() FROM vw_trades_canonical) * 100, 2) as pct_of_total_volume
FROM high_coverage_wallets;

-- Results:
-- Wallets: 16,045
-- Total trades: 3,651,189
-- % of platform volume: 2.32%
--
-- KILLER FINDING: High-coverage wallets are only 2.32% of volume
-- Cannot ship a limited beta targeting just these wallets


-- ========================================
-- STEP 6: Top 10 High-Coverage Wallets by Volume
-- ========================================
-- Who are the biggest traders with good data?

WITH wallet_coverage AS (
  SELECT
    wallet_address_norm,
    count() as total_trades,
    countIf(
      condition_id_norm != ''
      AND condition_id_norm != concat('0x', repeat('0',64))
      AND length(replaceAll(condition_id_norm, '0x', '')) = 64
    ) as valid_trades,
    round(valid_trades / total_trades * 100, 2) as coverage_pct
  FROM vw_trades_canonical
  WHERE wallet_address_norm != ''
  GROUP BY wallet_address_norm
  HAVING coverage_pct >= 80
)
SELECT
  wallet_address_norm,
  total_trades,
  valid_trades,
  coverage_pct
FROM wallet_coverage
ORDER BY total_trades DESC
LIMIT 10;

-- Results:
-- Top 10 whales have 879,162 trades total
-- That's only 0.56% of platform volume
-- Even the biggest traders with good data are a tiny fraction


-- ========================================
-- VERDICT CRITERIA
-- ========================================
-- From CLAUDE.md Stable Pack quality gates:
--
-- ✅ Phase 1 Sufficient:
--    - Transaction coverage ≥85% AND
--    - Wallet coverage (≥80%) ≥80% AND
--    - Volume coverage ≥70%
--
-- ⚠️ Phase 1 Acceptable:
--    - Transaction coverage 70-84% OR
--    - Wallet coverage 60-79%
--
-- ❌ Phase 1 Insufficient:
--    - Transaction coverage <70% OR
--    - Wallet coverage <60% OR
--    - Volume coverage <40%
--
-- ACTUAL RESULTS:
-- - Transaction coverage: 99.77% ✅ (but misleading)
-- - Wallet coverage: 1.61% ❌❌❌ (catastrophic)
-- - Volume coverage: 2.32% ❌❌❌ (catastrophic)
--
-- FINAL VERDICT: ❌ PHASE 1 INSUFFICIENT
--
-- Recommendation: Phase 2 blockchain backfill REQUIRED


-- ========================================
-- VALIDATION: Check for Schema Columns
-- ========================================

-- Verify vw_trades_canonical schema
DESCRIBE TABLE vw_trades_canonical;
-- Confirms: wallet_address_norm (not wallet_address)
-- Confirms: condition_id_norm exists

-- Verify trades_raw_enriched_final schema
DESCRIBE TABLE trades_raw_enriched_final;
-- Confirms: condition_id column exists

-- Verify trade_direction_assignments schema
DESCRIBE TABLE trade_direction_assignments;
-- Confirms: tx_hash and condition_id_norm exist


-- ========================================
-- NOTES ON VALID condition_id DEFINITION
-- ========================================
-- A valid condition_id must meet ALL criteria:
--
-- 1. Not empty string
-- 2. Not all zeros (0x0000...0000)
-- 3. Exactly 64 hex characters (without 0x prefix)
-- 4. Present in the row (not NULL)
--
-- This filters out:
-- - Empty/null values from API failures
-- - Zero IDs from unresolved markets
-- - Malformed IDs from data quality issues
-- - Markets that were deleted/hidden


-- ========================================
-- END OF ANALYSIS
-- ========================================
