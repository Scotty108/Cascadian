-- ============================================================================
-- API Schema Verification Queries
-- ============================================================================
-- Purpose: Validate that API integration schema is correctly implemented
-- Run these queries after applying migrations 001-004
-- Author: Database Architect Agent
-- Date: 2025-11-09
-- ============================================================================

-- ============================================================================
-- SECTION 1: TABLE EXISTENCE & STRUCTURE
-- ============================================================================

-- 1.1: Verify all tables exist
SELECT
    database,
    name as table_name,
    engine,
    total_rows,
    formatReadableSize(total_bytes) as size
FROM system.tables
WHERE (database = 'default' AND name IN (
    'wallet_positions_api',
    'wallet_metadata_api',
    'wallet_api_backfill_log',
    'resolutions_external_ingest'
)) OR (database = 'cascadian_clean' AND name IN (
    'wallet_market_returns',
    'wallet_omega_daily',
    'leaderboard_whales',
    'leaderboard_omega',
    'wallet_coverage_metrics',
    'market_coverage_metrics',
    'data_sync_status'
))
ORDER BY database, name;

-- Expected: 11 tables total
-- 4 in default: wallet_positions_api, wallet_metadata_api, wallet_api_backfill_log, resolutions_external_ingest
-- 7 in cascadian_clean: wallet_market_returns, wallet_omega_daily, leaderboard_whales, leaderboard_omega, wallet_coverage_metrics, market_coverage_metrics, data_sync_status

-- 1.2: Verify all views exist
SELECT
    database,
    name as view_name,
    engine,
    as_select
FROM system.tables
WHERE (database = 'cascadian_clean' AND name IN (
    'vw_resolutions_truth',
    'vw_pnl_reconciliation',
    'vw_wallet_positions_api_format',
    'mv_data_quality_summary'
))
ORDER BY database, name
FORMAT Vertical;

-- Expected: 4 views total

-- 1.3: Check table schemas match specification
DESCRIBE default.wallet_positions_api FORMAT Vertical;
DESCRIBE cascadian_clean.wallet_market_returns FORMAT Vertical;
DESCRIBE cascadian_clean.wallet_coverage_metrics FORMAT Vertical;

-- ============================================================================
-- SECTION 2: DATA INTEGRITY CHECKS
-- ============================================================================

-- 2.1: Check for duplicate keys in ReplacingMergeTree tables
-- (Should be 0 after OPTIMIZE TABLE)

-- wallet_positions_api duplicates
SELECT
    'wallet_positions_api' as table_name,
    wallet_address,
    condition_id,
    outcome_index,
    count() as duplicate_count
FROM default.wallet_positions_api
GROUP BY wallet_address, condition_id, outcome_index
HAVING count() > 1
LIMIT 10;

-- wallet_market_returns duplicates
SELECT
    'wallet_market_returns' as table_name,
    wallet_address,
    condition_id,
    count() as duplicate_count
FROM cascadian_clean.wallet_market_returns
GROUP BY wallet_address, condition_id
HAVING count() > 1
LIMIT 10;

-- wallet_coverage_metrics duplicates
SELECT
    'wallet_coverage_metrics' as table_name,
    wallet_address,
    count() as duplicate_count
FROM cascadian_clean.wallet_coverage_metrics
GROUP BY wallet_address
HAVING count() > 1
LIMIT 10;

-- 2.2: Verify data normalization (condition_id format)
SELECT
    'wallet_positions_api' as table_name,
    count() as total_rows,
    countIf(length(condition_id) = 64) as correct_length,
    countIf(condition_id = lower(condition_id)) as lowercase,
    countIf(condition_id NOT LIKE '0x%') as no_prefix,
    countIf(
        length(condition_id) = 64
        AND condition_id = lower(condition_id)
        AND condition_id NOT LIKE '0x%'
    ) as fully_normalized
FROM default.wallet_positions_api;

-- Expected: fully_normalized = total_rows (100%)

-- 2.3: Check for NULL values in critical columns
SELECT
    'wallet_positions_api' as table_name,
    countIf(wallet_address IS NULL) as null_wallet,
    countIf(condition_id IS NULL) as null_condition,
    countIf(cash_pnl IS NULL) as null_pnl,
    countIf(fetched_at IS NULL) as null_timestamp
FROM default.wallet_positions_api;

-- Expected: All 0

-- ============================================================================
-- SECTION 3: VIEW VALIDATION
-- ============================================================================

-- 3.1: Verify vw_resolutions_truth unions multiple sources
SELECT
    resolution_source,
    resolution_method,
    count() as resolution_count,
    min(resolved_at) as earliest,
    max(resolved_at) as latest
FROM cascadian_clean.vw_resolutions_truth
GROUP BY resolution_source, resolution_method
ORDER BY resolution_count DESC;

-- Expected: At least 2 sources (market_resolutions_final, resolutions_external_ingest)

-- 3.2: Verify resolution data quality
SELECT
    'vw_resolutions_truth' as view_name,
    count() as total_resolutions,
    countIf(payout_denominator > 0) as valid_denominator,
    countIf(arraySum(payout_numerators) = payout_denominator) as sum_matches,
    countIf(resolved_at IS NOT NULL) as has_timestamp,
    countIf(length(condition_id_normalized) = 64) as correct_id_length,
    countIf(
        payout_denominator > 0
        AND arraySum(payout_numerators) = payout_denominator
        AND resolved_at IS NOT NULL
        AND length(condition_id_normalized) = 64
    ) as fully_valid
FROM cascadian_clean.vw_resolutions_truth;

-- Expected: fully_valid = total_resolutions (100%)

-- 3.3: Test vw_pnl_reconciliation
SELECT
    quality_category,
    count() as position_count,
    avg(pnl_difference_pct) as avg_diff_pct,
    sum(pnl_difference_abs) as total_diff_usd
FROM cascadian_clean.vw_pnl_reconciliation
WHERE has_both = true
GROUP BY quality_category
ORDER BY position_count DESC;

-- Expected: Majority in 'MATCH' or 'MINOR_DIFF'

-- 3.4: Verify vw_wallet_positions_api_format matches API structure
SELECT
    wallet_address,
    condition_id,
    cashPnl,
    realizedPnl,
    size,
    avgPrice,
    title,
    outcome,
    redeemable
FROM cascadian_clean.vw_wallet_positions_api_format
LIMIT 5
FORMAT Vertical;

-- Expected: Column names in camelCase matching API

-- ============================================================================
-- SECTION 4: COVERAGE METRICS VALIDATION
-- ============================================================================

-- 4.1: Overall coverage summary
SELECT
    count() as total_wallets,
    avg(price_coverage_pct) as avg_price_coverage,
    avg(payout_coverage_pct) as avg_payout_coverage,
    avg(api_coverage_pct) as avg_api_coverage,
    countIf(all_gates_pass) as wallets_pass_all_gates,
    countIf(meets_activity_threshold) as wallets_meet_activity,
    countIf(all_gates_pass AND meets_activity_threshold) as leaderboard_eligible,
    countIf(all_gates_pass AND meets_activity_threshold) * 100.0 / count() as eligible_pct
FROM cascadian_clean.wallet_coverage_metrics;

-- Expected: eligible_pct > 50% (at least half of wallets have high-quality data)

-- 4.2: Coverage distribution
SELECT
    CASE
        WHEN price_coverage_pct >= 95 THEN '95-100%'
        WHEN price_coverage_pct >= 90 THEN '90-95%'
        WHEN price_coverage_pct >= 80 THEN '80-90%'
        WHEN price_coverage_pct >= 50 THEN '50-80%'
        ELSE '<50%'
    END as coverage_bucket,
    count() as wallet_count,
    count() * 100.0 / (SELECT count() FROM cascadian_clean.wallet_coverage_metrics) as pct_of_total
FROM cascadian_clean.wallet_coverage_metrics
GROUP BY coverage_bucket
ORDER BY coverage_bucket DESC;

-- Expected: Most wallets in 95-100% bucket

-- 4.3: Data freshness check
SELECT
    CASE
        WHEN data_freshness_hours IS NULL THEN 'Never Synced'
        WHEN data_freshness_hours < 1 THEN '<1 hour'
        WHEN data_freshness_hours < 6 THEN '1-6 hours'
        WHEN data_freshness_hours < 24 THEN '6-24 hours'
        WHEN data_freshness_hours < 72 THEN '1-3 days'
        ELSE '>3 days'
    END as freshness_bucket,
    count() as wallet_count
FROM cascadian_clean.wallet_coverage_metrics
GROUP BY freshness_bucket
ORDER BY freshness_bucket;

-- Expected: Majority in <24 hours

-- ============================================================================
-- SECTION 5: LEADERBOARD VALIDATION
-- ============================================================================

-- 5.1: Check leaderboard_whales population
SELECT
    count() as total_entries,
    count(DISTINCT wallet_address) as unique_wallets,
    min(rank) as min_rank,
    max(rank) as max_rank,
    avg(price_coverage_pct) as avg_price_coverage,
    avg(payout_coverage_pct) as avg_payout_coverage,
    min(total_settled_pnl_usd) as worst_pnl,
    max(total_settled_pnl_usd) as best_pnl
FROM cascadian_clean.leaderboard_whales;

-- Expected: All wallets pass coverage gates

-- 5.2: Verify ranking consistency
SELECT
    rank,
    wallet_address,
    total_settled_pnl_usd,
    LAG(total_settled_pnl_usd) OVER (ORDER BY rank) as prev_pnl,
    total_settled_pnl_usd <= LAG(total_settled_pnl_usd) OVER (ORDER BY rank) as correct_order
FROM cascadian_clean.leaderboard_whales
ORDER BY rank
LIMIT 20;

-- Expected: All correct_order = true (descending P&L)

-- 5.3: Check Omega leaderboard
SELECT
    count() as total_entries,
    avg(omega_ratio) as avg_omega,
    avg(win_rate) as avg_win_rate,
    min(omega_ratio) as min_omega,
    max(omega_ratio) as max_omega
FROM cascadian_clean.leaderboard_omega;

-- Expected: avg_omega > 1.0 (more gains than losses)

-- 5.4: Compare top 10 whales vs top 10 omega
SELECT
    'Top 10 Whales' as category,
    arrayStringConcat(groupArray(wallet_address), ', ') as wallets
FROM (
    SELECT wallet_address FROM cascadian_clean.leaderboard_whales ORDER BY rank LIMIT 10
)
UNION ALL
SELECT
    'Top 10 Omega' as category,
    arrayStringConcat(groupArray(wallet_address), ', ') as wallets
FROM (
    SELECT wallet_address FROM cascadian_clean.leaderboard_omega ORDER BY rank LIMIT 10
);

-- Expected: Different wallets (whales = volume, omega = risk-adjusted)

-- ============================================================================
-- SECTION 6: PERFORMANCE CHECKS
-- ============================================================================

-- 6.1: Query response time test (should be <1 second)
SET max_execution_time = 1;

SELECT
    wallet_address,
    count() as positions,
    sum(cash_pnl) as total_pnl
FROM default.wallet_positions_api
GROUP BY wallet_address
ORDER BY total_pnl DESC
LIMIT 100;

-- 6.2: Join performance test (should be <2 seconds)
SET max_execution_time = 2;

SELECT
    api.wallet_address,
    api.cash_pnl as api_pnl,
    calc.calculated_total_pnl,
    abs(api.cash_pnl - calc.calculated_total_pnl) as difference
FROM (
    SELECT wallet_address, sum(cash_pnl) as cash_pnl
    FROM default.wallet_positions_api
    GROUP BY wallet_address
) api
LEFT JOIN (
    SELECT wallet_address, sum(total_pnl_usd) as calculated_total_pnl
    FROM cascadian_clean.wallet_market_returns
    GROUP BY wallet_address
) calc ON api.wallet_address = calc.wallet_address
ORDER BY difference DESC
LIMIT 100;

-- 6.3: Check index usage
SELECT
    table,
    sum(rows_read) as total_rows_read,
    sum(bytes_read) as total_bytes_read,
    formatReadableSize(sum(bytes_read)) as size_readable
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time > now() - INTERVAL 1 HOUR
  AND query LIKE '%wallet_positions_api%'
GROUP BY table
ORDER BY total_rows_read DESC;

-- Expected: Efficient row scans (not reading entire table)

-- ============================================================================
-- SECTION 7: FINAL VALIDATION SUMMARY
-- ============================================================================

-- 7.1: Comprehensive system health check
WITH
table_counts AS (
    SELECT
        'Tables Exist' as check_name,
        countIf(database = 'default' AND name IN ('wallet_positions_api', 'wallet_metadata_api', 'wallet_api_backfill_log')) +
        countIf(database = 'cascadian_clean' AND name IN ('wallet_market_returns', 'wallet_omega_daily', 'leaderboard_whales', 'leaderboard_omega', 'wallet_coverage_metrics', 'market_coverage_metrics', 'data_sync_status')) as actual,
        11 as expected
    FROM system.tables
),
view_counts AS (
    SELECT
        'Views Exist' as check_name,
        countIf(database = 'cascadian_clean' AND name IN ('vw_resolutions_truth', 'vw_pnl_reconciliation', 'vw_wallet_positions_api_format', 'mv_data_quality_summary')) as actual,
        4 as expected
    FROM system.tables
),
data_quality AS (
    SELECT
        'High Quality Wallets' as check_name,
        countIf(all_gates_pass AND meets_activity_threshold) as actual,
        count() / 2 as expected  -- At least 50% should be high quality
    FROM cascadian_clean.wallet_coverage_metrics
),
resolution_quality AS (
    SELECT
        'Valid Resolutions' as check_name,
        countIf(payout_denominator > 0 AND arraySum(payout_numerators) = payout_denominator) as actual,
        count() as expected
    FROM cascadian_clean.vw_resolutions_truth
)
SELECT
    check_name,
    actual,
    expected,
    CASE
        WHEN actual >= expected THEN '✅ PASS'
        ELSE '❌ FAIL'
    END as status
FROM table_counts
UNION ALL SELECT * FROM view_counts
UNION ALL SELECT * FROM data_quality
UNION ALL SELECT * FROM resolution_quality;

-- Expected: All checks PASS

-- 7.2: Data pipeline completeness
SELECT
    'API Staging' as pipeline_stage,
    (SELECT count() FROM default.wallet_positions_api) as row_count,
    (SELECT count(DISTINCT wallet_address) FROM default.wallet_positions_api) as unique_entities
UNION ALL
SELECT
    'Market Returns',
    (SELECT count() FROM cascadian_clean.wallet_market_returns),
    (SELECT count(DISTINCT wallet_address) FROM cascadian_clean.wallet_market_returns)
UNION ALL
SELECT
    'Coverage Metrics',
    (SELECT count() FROM cascadian_clean.wallet_coverage_metrics),
    (SELECT count() FROM cascadian_clean.wallet_coverage_metrics)
UNION ALL
SELECT
    'Leaderboard Whales',
    (SELECT count() FROM cascadian_clean.leaderboard_whales),
    (SELECT count() FROM cascadian_clean.leaderboard_whales)
UNION ALL
SELECT
    'Leaderboard Omega',
    (SELECT count() FROM cascadian_clean.leaderboard_omega),
    (SELECT count() FROM cascadian_clean.leaderboard_omega);

-- Expected: Non-zero counts at each stage

-- ============================================================================
-- SECTION 8: EXAMPLE QUERIES FOR APPLICATION
-- ============================================================================

-- 8.1: Get wallet P&L summary (for dashboard)
SELECT
    wallet_address,
    api_total_pnl,
    calculated_total_pnl,
    total_positions,
    price_coverage_pct,
    payout_coverage_pct,
    all_gates_pass,
    api_last_synced,
    data_freshness_hours
FROM cascadian_clean.wallet_coverage_metrics
WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

-- 8.2: Get top 100 leaderboard (for UI)
SELECT
    rank,
    wallet_address,
    total_settled_pnl_usd,
    total_volume_usd,
    roi_percent,
    win_rate,
    markets_traded,
    price_coverage_pct
FROM cascadian_clean.leaderboard_whales
ORDER BY rank
LIMIT 100;

-- 8.3: Get wallet positions (for detail page)
SELECT
    market_title,
    outcome,
    size,
    avgPrice as avg_price,
    cashPnl as cash_pnl,
    realizedPnl as realized_pnl,
    redeemable,
    lastUpdated as last_updated
FROM cascadian_clean.vw_wallet_positions_api_format
WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
ORDER BY abs(cashPnl) DESC
LIMIT 20;

-- 8.4: Get data quality dashboard
SELECT * FROM cascadian_clean.mv_data_quality_summary
ORDER BY calculation_date DESC
LIMIT 1;

-- ============================================================================
-- VERIFICATION COMPLETE
-- ============================================================================
-- If all queries above return expected results, schema is correctly implemented
-- Next steps:
--   1. Run backfill scripts to populate tables
--   2. Create materialized view refresh jobs
--   3. Set up monitoring alerts for data quality metrics
--   4. Implement API endpoints using these queries
-- ============================================================================
