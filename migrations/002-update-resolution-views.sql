-- ============================================================================
-- Migration 002: Update Resolution Views
-- ============================================================================
-- Purpose: Union resolutions from multiple sources into single source of truth
-- Database: cascadian_clean (analytics layer)
-- Author: Database Architect Agent
-- Date: 2025-11-09
-- Dependencies: Migration 001 (wallet_positions_api table)
-- Expected rows: 200K-300K total resolutions across all sources
-- ============================================================================

-- ============================================================================
-- 1. UPDATE vw_resolutions_truth
-- ============================================================================
-- Combines resolutions from:
--   1. market_resolutions_final (218K payouts - blockchain backfill)
--   2. resolutions_external_ingest (Goldsky API + manual backfills)
--   3. Future: API-specific resolution sources
--
-- Design decision: Use UNION ALL for performance (no dedup needed across sources)
-- Normalization: Always cast FixedString(64) to String before comparing
-- Filtering: Strict quality gates (payout_denominator>0, sum match, non-null resolved_at)

CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_truth AS
WITH
-- Source 1: Blockchain-derived resolutions (primary source)
blockchain_resolutions AS (
    SELECT
        toString(condition_id_norm) as condition_id_normalized,
        payout_numerators,
        payout_denominator,
        winning_index,
        resolved_at,
        'market_resolutions_final' as resolution_source,
        'blockchain' as resolution_method
    FROM default.market_resolutions_final
    WHERE 1=1
        AND payout_denominator > 0
        AND arraySum(payout_numerators) = payout_denominator
        AND resolved_at IS NOT NULL
        AND length(toString(condition_id_norm)) = 64  -- Validate 32-byte hex
),

-- Source 2: External API ingestion (Goldsky subgraph + manual backfills)
external_resolutions AS (
    SELECT
        lower(replaceAll(condition_id, '0x', '')) as condition_id_normalized,
        payout_numerators,
        payout_denominator,
        winning_index,
        resolved_at,
        COALESCE(source, 'resolutions_external_ingest') as resolution_source,
        'external_api' as resolution_method
    FROM default.resolutions_external_ingest
    WHERE 1=1
        AND payout_denominator > 0
        AND arraySum(payout_numerators) = payout_denominator
        AND resolved_at IS NOT NULL
        AND length(lower(replaceAll(condition_id, '0x', ''))) = 64
)

-- Union all sources (UNION ALL = no dedup, faster)
-- Deduplication handled by ReplacingMergeTree at source tables
SELECT * FROM blockchain_resolutions
UNION ALL
SELECT * FROM external_resolutions
ORDER BY resolved_at DESC
SETTINGS max_threads = 4;

-- Index strategy: View is not materialized - queries filter on condition_id_normalized
-- Expected queries:
--   - Join to trades: WHERE condition_id_normalized = lower(replaceAll(trades.condition_id, '0x', ''))
--   - Count resolutions: SELECT count(*) FROM vw_resolutions_truth
--   - Latest resolutions: ORDER BY resolved_at DESC LIMIT 100

-- ============================================================================
-- 2. CREATE vw_pnl_reconciliation
-- ============================================================================
-- Compares API P&L vs calculated P&L for validation and debugging
-- Shows discrepancies and helps identify systematic issues

CREATE OR REPLACE VIEW cascadian_clean.vw_pnl_reconciliation AS
WITH
-- API data (ground truth from Polymarket)
api_pnl AS (
    SELECT
        wallet_address,
        condition_id,
        outcome_index,
        cash_pnl as api_cash_pnl,
        realized_pnl as api_realized_pnl,
        size as api_size,
        avg_price as api_avg_price,
        redeemable as api_redeemable,
        fetched_at as api_last_updated
    FROM default.wallet_positions_api
),

-- Calculated data (our internal calculations)
calculated_pnl AS (
    SELECT
        wallet_address,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_normalized,
        outcome_index,
        sum(shares) as calculated_size,
        sum(cost_basis_usd) / sum(shares) as calculated_avg_price,
        sum(pnl_realized) as calculated_realized_pnl,
        sum(pnl_total) as calculated_total_pnl
    FROM cascadian_clean.vw_wallet_pnl_settled
    GROUP BY wallet_address, condition_id_normalized, outcome_index
)

SELECT
    COALESCE(api.wallet_address, calc.wallet_address) as wallet_address,
    COALESCE(api.condition_id, calc.condition_id_normalized) as condition_id,
    COALESCE(api.outcome_index, calc.outcome_index) as outcome_index,

    -- API values (ground truth)
    api.api_cash_pnl,
    api.api_realized_pnl,
    api.api_size,
    api.api_avg_price,
    api.api_redeemable,

    -- Calculated values
    calc.calculated_total_pnl,
    calc.calculated_realized_pnl,
    calc.calculated_size,
    calc.calculated_avg_price,

    -- Discrepancies
    abs(COALESCE(api.api_cash_pnl, 0) - COALESCE(calc.calculated_total_pnl, 0)) as pnl_difference_abs,
    CASE
        WHEN api.api_cash_pnl = 0 AND calc.calculated_total_pnl = 0 THEN 0
        WHEN api.api_cash_pnl IS NULL OR calc.calculated_total_pnl IS NULL THEN NULL
        ELSE abs(api.api_cash_pnl - calc.calculated_total_pnl) / greatest(abs(api.api_cash_pnl), abs(calc.calculated_total_pnl), 0.01) * 100
    END as pnl_difference_pct,

    -- Coverage flags
    api.api_cash_pnl IS NOT NULL as has_api_data,
    calc.calculated_total_pnl IS NOT NULL as has_calculated_data,
    api.api_cash_pnl IS NOT NULL AND calc.calculated_total_pnl IS NOT NULL as has_both,

    -- Quality classification
    CASE
        WHEN api.api_cash_pnl IS NULL THEN 'MISSING_API'
        WHEN calc.calculated_total_pnl IS NULL THEN 'MISSING_CALC'
        WHEN abs(api.api_cash_pnl - calc.calculated_total_pnl) < 1 THEN 'MATCH'
        WHEN abs(api.api_cash_pnl - calc.calculated_total_pnl) / greatest(abs(api.api_cash_pnl), 0.01) * 100 < 5 THEN 'MINOR_DIFF'
        WHEN abs(api.api_cash_pnl - calc.calculated_total_pnl) / greatest(abs(api.api_cash_pnl), 0.01) * 100 < 20 THEN 'MODERATE_DIFF'
        ELSE 'MAJOR_DIFF'
    END as quality_category,

    -- Metadata
    api.api_last_updated
FROM api_pnl api
FULL OUTER JOIN calculated_pnl calc
    ON api.wallet_address = calc.wallet_address
    AND api.condition_id = calc.condition_id_normalized
    AND api.outcome_index = calc.outcome_index
ORDER BY pnl_difference_abs DESC NULLS LAST;

-- Expected queries:
--   - Find major discrepancies: WHERE quality_category = 'MAJOR_DIFF'
--   - Get wallet accuracy: GROUP BY wallet_address, avg(pnl_difference_pct)
--   - Find missing data: WHERE quality_category IN ('MISSING_API', 'MISSING_CALC')

-- ============================================================================
-- 3. CREATE vw_wallet_positions_api_format
-- ============================================================================
-- Exposes wallet positions in API-compatible format
-- Use case: Serve wallet data to frontend in same format as Polymarket API

CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_positions_api_format AS
SELECT
    wallet_address,
    condition_id,
    token_id,
    asset,
    size,
    avg_price as avgPrice,
    cur_price as curPrice,
    cash_pnl as cashPnl,
    percent_pnl as percentPnl,
    realized_pnl as realizedPnl,
    percent_realized_pnl as percentRealizedPnl,
    initial_value as initialValue,
    current_value as currentValue,
    total_bought as totalBought,
    redeemable,
    mergeable,
    market_title as title,
    market_slug as slug,
    outcome,
    outcome_index as outcomeIndex,
    end_date as endDate,
    fetched_at as lastUpdated
FROM default.wallet_positions_api
ORDER BY abs(cash_pnl) DESC;

-- Use case: Frontend can query this view and get same structure as API
-- Expected queries:
--   - Get wallet positions: WHERE wallet_address = '0x...'
--   - Get redeemable: WHERE redeemable = true AND wallet_address = '0x...'
--   - Leaderboard: ORDER BY cashPnl DESC LIMIT 100

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Test 1: Count resolutions from each source
SELECT
    resolution_source,
    resolution_method,
    count() as resolution_count,
    min(resolved_at) as earliest_resolution,
    max(resolved_at) as latest_resolution
FROM cascadian_clean.vw_resolutions_truth
GROUP BY resolution_source, resolution_method
ORDER BY resolution_count DESC;

-- Test 2: Check resolution quality
SELECT
    'Quality Check' as test_name,
    count() as total_resolutions,
    countIf(payout_denominator = 0) as invalid_denominator,
    countIf(arraySum(payout_numerators) != payout_denominator) as sum_mismatch,
    countIf(resolved_at IS NULL) as null_timestamp,
    countIf(length(condition_id_normalized) != 64) as invalid_id_length
FROM cascadian_clean.vw_resolutions_truth;

-- Test 3: Sample reconciliation report
SELECT
    quality_category,
    count() as position_count,
    sum(pnl_difference_abs) as total_difference_usd,
    avg(pnl_difference_pct) as avg_difference_pct
FROM cascadian_clean.vw_pnl_reconciliation
WHERE has_both = true
GROUP BY quality_category
ORDER BY position_count DESC;

-- Test 4: Find biggest discrepancies
SELECT
    wallet_address,
    condition_id,
    api_cash_pnl,
    calculated_total_pnl,
    pnl_difference_abs,
    pnl_difference_pct,
    quality_category
FROM cascadian_clean.vw_pnl_reconciliation
WHERE quality_category IN ('MODERATE_DIFF', 'MAJOR_DIFF')
ORDER BY pnl_difference_abs DESC
LIMIT 20;

-- Test 5: Coverage metrics
SELECT
    countIf(has_api_data) as positions_with_api,
    countIf(has_calculated_data) as positions_with_calc,
    countIf(has_both) as positions_with_both,
    countIf(has_api_data) * 100.0 / count() as api_coverage_pct,
    countIf(has_calculated_data) * 100.0 / count() as calc_coverage_pct,
    countIf(has_both) * 100.0 / count() as both_coverage_pct
FROM cascadian_clean.vw_pnl_reconciliation;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- To rollback this migration:
--   DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_truth;
--   DROP VIEW IF EXISTS cascadian_clean.vw_pnl_reconciliation;
--   DROP VIEW IF EXISTS cascadian_clean.vw_wallet_positions_api_format;
--
-- Then recreate old vw_resolutions_truth (see git history)
-- ============================================================================
