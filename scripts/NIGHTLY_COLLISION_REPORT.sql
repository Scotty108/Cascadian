-- ============================================================================
-- NIGHTLY COLLISION REPORT
-- Purpose: Monitor data quality in pm_trades_canonical_v3
-- Run: Daily at 1:00 AM PST via cron
-- ============================================================================

-- SECTION 1: ETL DUPLICATES (same trade_id appearing multiple times)
-- ============================================================================
WITH daily_duplicates AS (
  SELECT
    trade_id,
    count() AS duplicate_count,
    sum(usd_value) AS total_value,
    groupArray(transaction_hash) AS tx_hashes,
    min(created_at) AS first_seen,
    max(created_at) AS last_seen
  FROM pm_trades_canonical_v3
  WHERE created_at >= now() - INTERVAL 1 DAY
  GROUP BY trade_id
  HAVING duplicate_count > 1
),
duplicate_summary AS (
  SELECT
    count() AS new_duplicates,
    sum(total_value) AS affected_volume,
    max(duplicate_count) AS max_duplicates_per_trade,
    groupArray((trade_id, duplicate_count, total_value)) AS top_duplicates
  FROM daily_duplicates
)
SELECT
  'ETL_DUPLICATES' AS check_type,
  new_duplicates,
  round(affected_volume, 2) AS affected_volume_usd,
  max_duplicates_per_trade,
  top_duplicates
FROM duplicate_summary;

-- SECTION 2: ATTRIBUTION CONFLICTS (tx_hash with multiple wallets)
-- ============================================================================
WITH daily_collisions AS (
  SELECT
    transaction_hash,
    groupArray(wallet_address) AS wallets,
    groupArray(wallet_canonical) AS canonical_wallets,
    count() AS wallet_count,
    sum(usd_value) AS total_value
  FROM pm_trades_canonical_v3
  WHERE created_at >= now() - INTERVAL 1 DAY
  GROUP BY transaction_hash
  HAVING wallet_count > 1
),
collision_summary AS (
  SELECT
    count() AS new_conflicts,
    sum(total_value) AS affected_volume,
    groupArray((transaction_hash, wallets, total_value)) AS conflict_details
  FROM daily_collisions
)
SELECT
  'ATTRIBUTION_CONFLICTS' AS check_type,
  new_conflicts,
  round(affected_volume, 2) AS affected_volume_usd,
  conflict_details
FROM collision_summary;

-- SECTION 3: ORPHAN TRADES (empty or invalid condition_id)
-- ============================================================================
WITH orphan_stats AS (
  SELECT
    countIf(
      condition_id_norm_v3 IS NULL OR
      condition_id_norm_v3 = '' OR
      length(condition_id_norm_v3) != 64
    ) AS daily_orphans,
    count() AS daily_total,
    sumIf(
      usd_value,
      condition_id_norm_v3 IS NULL OR
      condition_id_norm_v3 = '' OR
      length(condition_id_norm_v3) != 64
    ) AS orphan_volume
  FROM pm_trades_canonical_v3
  WHERE created_at >= now() - INTERVAL 1 DAY
)
SELECT
  'ORPHAN_TRADES' AS check_type,
  daily_orphans,
  daily_total,
  round(100.0 * daily_orphans / daily_total, 2) AS orphan_pct,
  round(orphan_volume, 2) AS orphan_volume_usd,
  CASE
    WHEN orphan_pct > 35 THEN '🚨 HIGH'
    WHEN orphan_pct > 25 THEN '⚠️  ELEVATED'
    ELSE '✅ NORMAL'
  END AS severity
FROM orphan_stats;

-- SECTION 4: EMPTY WALLET_CANONICAL (identity mapping failures)
-- ============================================================================
WITH empty_canonical AS (
  SELECT
    countIf(wallet_canonical IS NULL OR wallet_canonical = '') AS empty_canonical,
    count() AS daily_total,
    sumIf(
      usd_value,
      wallet_canonical IS NULL OR wallet_canonical = ''
    ) AS affected_volume
  FROM pm_trades_canonical_v3
  WHERE created_at >= now() - INTERVAL 1 DAY
)
SELECT
  'EMPTY_WALLET_CANONICAL' AS check_type,
  empty_canonical,
  daily_total,
  round(100.0 * empty_canonical / daily_total, 2) AS empty_pct,
  round(affected_volume, 2) AS affected_volume_usd
FROM empty_canonical;

-- SECTION 5: DAILY INGESTION SUMMARY
-- ============================================================================
SELECT
  'DAILY_INGESTION_SUMMARY' AS check_type,
  count() AS total_trades,
  count(DISTINCT transaction_hash) AS unique_transactions,
  count(DISTINCT wallet_address) AS unique_wallets,
  round(sum(usd_value), 2) AS total_volume_usd,
  round(avg(usd_value), 2) AS avg_trade_size_usd,
  min(timestamp) AS earliest_trade,
  max(timestamp) AS latest_trade
FROM pm_trades_canonical_v3
WHERE created_at >= now() - INTERVAL 1 DAY;

-- SECTION 6: HISTORICAL TREND (30-day moving average)
-- ============================================================================
WITH daily_metrics AS (
  SELECT
    toDate(created_at) AS date,
    count() AS total_trades,
    countIf(
      condition_id_norm_v3 IS NULL OR
      condition_id_norm_v3 = '' OR
      length(condition_id_norm_v3) != 64
    ) AS orphan_trades,
    round(100.0 * orphan_trades / total_trades, 2) AS orphan_pct
  FROM pm_trades_canonical_v3
  WHERE created_at >= now() - INTERVAL 30 DAY
  GROUP BY date
  ORDER BY date DESC
)
SELECT
  'ORPHAN_TREND_30_DAY' AS check_type,
  round(avg(orphan_pct), 2) AS avg_orphan_pct,
  min(orphan_pct) AS min_orphan_pct,
  max(orphan_pct) AS max_orphan_pct,
  round(stddevPop(orphan_pct), 2) AS stddev_orphan_pct
FROM daily_metrics;

-- ============================================================================
-- ALERT THRESHOLDS:
-- - ETL Duplicates: Any new duplicates → Alert
-- - Attribution Conflicts: Any conflicts → Alert
-- - Orphan Rate: >35% → High severity alert
-- - Orphan Rate: >25% → Elevated alert
-- - Empty wallet_canonical: >5% → Alert
-- ============================================================================
