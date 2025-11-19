-- ============================================================================
-- Migration 004: Create Coverage & Quality Metrics
-- ============================================================================
-- Purpose: Track data coverage and quality for wallet P&L calculations
-- Database: cascadian_clean (analytics layer)
-- Author: Database Architect Agent
-- Date: 2025-11-09
-- Dependencies: Migration 001-003 (API tables, resolution views, leaderboards)
-- Expected rows: 10K-50K wallets with quality metrics
-- ============================================================================

-- ============================================================================
-- 1. WALLET COVERAGE METRICS
-- ============================================================================
-- Tracks what data we have for each wallet and quality scores
-- Used to filter leaderboards and show data quality warnings in UI

CREATE TABLE IF NOT EXISTS cascadian_clean.wallet_coverage_metrics (
    -- Identity
    wallet_address LowCardinality(String) COMMENT 'Wallet address',

    -- Position coverage
    total_positions UInt32 COMMENT 'Total positions across all markets',
    open_positions UInt32 COMMENT 'Open positions (not resolved)',
    closed_positions UInt32 COMMENT 'Closed positions (resolved)',
    redeemable_positions UInt32 COMMENT 'Positions that can be redeemed',

    -- Price coverage (can we calculate P&L?)
    positions_with_prices UInt32 COMMENT 'Positions with known entry/exit prices',
    positions_with_current_price UInt32 COMMENT 'Open positions with live quotes',
    positions_missing_prices UInt32 COMMENT 'Positions with missing price data',
    price_coverage_pct Float64 COMMENT '% positions with complete price data',

    -- Payout coverage (can we calculate redemption P&L?)
    positions_with_payouts UInt32 COMMENT 'Resolved positions with payout vectors',
    positions_missing_payouts UInt32 COMMENT 'Resolved positions without payouts',
    payout_coverage_pct Float64 COMMENT '% resolved positions with payout data',

    -- API data availability
    positions_in_api UInt32 COMMENT 'Positions found in Polymarket API',
    positions_only_calculated UInt32 COMMENT 'Positions calculated from blockchain only',
    api_coverage_pct Float64 COMMENT '% positions verified by API',

    -- Data quality gates (PASS/FAIL for leaderboards)
    price_coverage_gate Bool COMMENT 'True if price_coverage_pct >= 95%',
    payout_coverage_gate Bool COMMENT 'True if payout_coverage_pct >= 95%',
    api_coverage_gate Bool COMMENT 'True if api_coverage_pct >= 50%',
    all_gates_pass Bool COMMENT 'True if all coverage gates pass',

    -- Activity filters (minimum thresholds)
    total_trades UInt32 COMMENT 'Total number of trades',
    markets_traded UInt32 COMMENT 'Unique markets traded',
    total_volume_usd Float64 COMMENT 'Total trading volume',
    meets_activity_threshold Bool COMMENT 'True if trades>=10, markets>=3, volume>=1000',

    -- P&L summary (from different sources)
    api_total_pnl Nullable(Float64) COMMENT 'P&L from Polymarket API',
    calculated_total_pnl Nullable(Float64) COMMENT 'P&L from our calculations',
    pnl_discrepancy_abs Nullable(Float64) COMMENT 'Absolute difference API vs calculated',
    pnl_discrepancy_pct Nullable(Float64) COMMENT 'Percentage difference',

    -- Sync status
    api_last_synced Nullable(DateTime) COMMENT 'When API data was last fetched',
    blockchain_last_synced DateTime COMMENT 'When blockchain data was last updated',
    data_freshness_hours Float64 COMMENT 'Hours since last API sync',

    -- Metadata
    calculated_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY wallet_address
COMMENT 'Coverage and quality metrics per wallet for filtering leaderboards';

-- Index strategy: Single primary key (wallet_address) for fast lookups
-- Expected queries:
--   - Get wallet quality: WHERE wallet_address = '0x...'
--   - Filter high-quality wallets: WHERE all_gates_pass = true AND meets_activity_threshold = true
--   - Find wallets needing refresh: WHERE data_freshness_hours > 24

-- ============================================================================
-- 2. DATA QUALITY SUMMARY
-- ============================================================================
-- System-wide data quality metrics for monitoring
-- Materialized view that aggregates wallet_coverage_metrics

CREATE MATERIALIZED VIEW IF NOT EXISTS cascadian_clean.mv_data_quality_summary
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY calculation_date
AS
SELECT
    today() as calculation_date,

    -- Wallet counts
    count() as total_wallets,
    countIf(all_gates_pass) as wallets_pass_all_gates,
    countIf(meets_activity_threshold) as wallets_meet_activity,
    countIf(all_gates_pass AND meets_activity_threshold) as wallets_leaderboard_eligible,

    -- Coverage averages
    avg(price_coverage_pct) as avg_price_coverage,
    avg(payout_coverage_pct) as avg_payout_coverage,
    avg(api_coverage_pct) as avg_api_coverage,

    -- Gate pass rates
    countIf(price_coverage_gate) * 100.0 / count() as price_gate_pass_rate,
    countIf(payout_coverage_gate) * 100.0 / count() as payout_gate_pass_rate,
    countIf(api_coverage_gate) * 100.0 / count() as api_gate_pass_rate,

    -- Data freshness
    avg(data_freshness_hours) as avg_freshness_hours,
    countIf(data_freshness_hours > 24) as wallets_stale_data,

    -- P&L reconciliation
    countIf(pnl_discrepancy_pct < 5) as wallets_pnl_match,
    countIf(pnl_discrepancy_pct >= 5 AND pnl_discrepancy_pct < 20) as wallets_pnl_moderate_diff,
    countIf(pnl_discrepancy_pct >= 20) as wallets_pnl_major_diff,

    -- Total metrics
    sum(total_positions) as total_positions_all_wallets,
    sum(positions_with_prices) as total_positions_priced,
    sum(positions_with_payouts) as total_positions_with_payouts,
    sum(positions_in_api) as total_positions_in_api,

    -- Metadata
    now() as calculated_at,
    now() as updated_at
FROM cascadian_clean.wallet_coverage_metrics
GROUP BY calculation_date;

-- Use case: Dashboard health check widget
-- Expected queries:
--   - Latest metrics: SELECT * FROM mv_data_quality_summary ORDER BY calculation_date DESC LIMIT 1
--   - Trend over time: SELECT * FROM mv_data_quality_summary WHERE calculation_date >= today() - 30

-- ============================================================================
-- 3. MARKET COVERAGE METRICS
-- ============================================================================
-- Tracks coverage per market (how many positions have complete data)

CREATE TABLE IF NOT EXISTS cascadian_clean.market_coverage_metrics (
    -- Identity
    condition_id String COMMENT 'Condition ID (normalized)',
    market_slug LowCardinality(String) COMMENT 'Market slug',
    market_title String COMMENT 'Market title',

    -- Position counts
    total_positions UInt32 COMMENT 'Total positions in this market',
    unique_wallets UInt32 COMMENT 'Unique wallets trading this market',
    total_trades UInt32 COMMENT 'Total trades in this market',
    total_volume_usd Float64 COMMENT 'Total volume',

    -- Coverage
    positions_with_prices UInt32 COMMENT 'Positions with price data',
    positions_with_api_data UInt32 COMMENT 'Positions found in API',
    price_coverage_pct Float64 COMMENT '% positions with prices',
    api_coverage_pct Float64 COMMENT '% positions in API',

    -- Resolution status
    is_resolved Bool COMMENT 'True if market is resolved',
    has_payout_vector Bool COMMENT 'True if payout vector exists',
    winning_outcome_index Nullable(UInt8) COMMENT 'Winning outcome',
    resolved_at Nullable(DateTime) COMMENT 'Resolution timestamp',

    -- Quality gates
    price_coverage_gate Bool COMMENT 'True if price_coverage_pct >= 95%',
    high_quality Bool COMMENT 'True if all coverage gates pass',

    -- Metadata
    first_trade_at DateTime COMMENT 'First trade in this market',
    last_trade_at DateTime COMMENT 'Last trade in this market',
    calculated_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (condition_id)
COMMENT 'Coverage metrics per market for data quality monitoring';

-- Index strategy: Single primary key (condition_id)
-- Expected queries:
--   - Get market quality: WHERE condition_id = '...'
--   - Find markets with missing data: WHERE price_coverage_pct < 95 OR NOT has_payout_vector
--   - High-quality markets: WHERE high_quality = true

-- ============================================================================
-- 4. SYNC STATUS TRACKER
-- ============================================================================
-- Tracks last sync time for different data sources
-- Used by background workers to determine what needs updating

CREATE TABLE IF NOT EXISTS cascadian_clean.data_sync_status (
    -- Source identification
    source_type LowCardinality(String) COMMENT 'Type: api|blockchain|subgraph',
    source_name LowCardinality(String) COMMENT 'Name: polymarket-data-api|goldsky|polygon-rpc',
    entity_type LowCardinality(String) COMMENT 'Entity: wallet|market|resolution',
    entity_id String COMMENT 'Specific ID (wallet address, market ID, etc.)',

    -- Sync status
    last_sync_started DateTime COMMENT 'When sync started',
    last_sync_completed Nullable(DateTime) COMMENT 'When sync completed (null = in progress)',
    sync_status LowCardinality(String) COMMENT 'Status: success|error|in_progress',
    error_message String DEFAULT '' COMMENT 'Error message if status=error',

    -- Sync metrics
    records_fetched UInt32 DEFAULT 0 COMMENT 'Number of records fetched',
    records_inserted UInt32 DEFAULT 0 COMMENT 'Number of records inserted',
    records_updated UInt32 DEFAULT 0 COMMENT 'Number of records updated',
    records_skipped UInt32 DEFAULT 0 COMMENT 'Number of records skipped (duplicates)',
    api_response_time_ms UInt32 DEFAULT 0 COMMENT 'API response time',

    -- Priority and scheduling
    priority UInt8 DEFAULT 5 COMMENT 'Priority 1-10 (1=highest)',
    sync_frequency_hours UInt16 DEFAULT 24 COMMENT 'How often to sync (hours)',
    next_sync_due DateTime COMMENT 'When next sync is scheduled',

    -- Metadata
    inserted_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (source_type, entity_type, entity_id, last_sync_started)
COMMENT 'Tracks sync status for background workers';

-- Index strategy: Optimized for worker queries (find entities needing sync)
-- Expected queries:
--   - Find stale wallets: WHERE entity_type='wallet' AND next_sync_due <= now()
--   - Get sync history: WHERE entity_id = '0x...' ORDER BY last_sync_started DESC
--   - Monitor errors: WHERE sync_status = 'error' AND last_sync_started > now() - 1 DAY

-- Create index for worker queries
-- Note: ClickHouse doesn't have secondary indexes in traditional sense
-- Instead, we rely on ORDER BY clause for query optimization

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Test 1: Sample population query for wallet_coverage_metrics
/*
INSERT INTO cascadian_clean.wallet_coverage_metrics
WITH
wallet_positions AS (
    SELECT
        wallet_address,
        count() as total_positions,
        countIf(NOT is_resolved) as open_positions,
        countIf(is_resolved) as closed_positions,
        countIf(is_resolved AND has_payout_vector) as redeemable_positions,
        countIf(avg_price > 0) as positions_with_prices,
        countIf(cur_price > 0 AND NOT is_resolved) as positions_with_current_price,
        countIf(avg_price = 0) as positions_missing_prices,
        countIf(is_resolved AND has_payout_vector) as positions_with_payouts,
        countIf(is_resolved AND NOT has_payout_vector) as positions_missing_payouts,
        sum(trade_count) as total_trades,
        count(DISTINCT condition_id) as markets_traded,
        sum(volume_usd) as total_volume_usd
    FROM cascadian_clean.wallet_market_returns
    GROUP BY wallet_address
),
api_positions AS (
    SELECT
        wallet_address,
        count() as positions_in_api,
        sum(cash_pnl) as api_total_pnl,
        max(fetched_at) as api_last_synced
    FROM default.wallet_positions_api
    GROUP BY wallet_address
)
SELECT
    wp.wallet_address,
    wp.total_positions,
    wp.open_positions,
    wp.closed_positions,
    wp.redeemable_positions,
    wp.positions_with_prices,
    wp.positions_with_current_price,
    wp.positions_missing_prices,
    wp.positions_with_prices * 100.0 / wp.total_positions as price_coverage_pct,
    wp.positions_with_payouts,
    wp.positions_missing_payouts,
    CASE WHEN wp.closed_positions > 0
        THEN wp.positions_with_payouts * 100.0 / wp.closed_positions
        ELSE 100.0
    END as payout_coverage_pct,
    COALESCE(ap.positions_in_api, 0) as positions_in_api,
    wp.total_positions - COALESCE(ap.positions_in_api, 0) as positions_only_calculated,
    CASE WHEN wp.total_positions > 0
        THEN COALESCE(ap.positions_in_api, 0) * 100.0 / wp.total_positions
        ELSE 0
    END as api_coverage_pct,
    (wp.positions_with_prices * 100.0 / wp.total_positions) >= 95 as price_coverage_gate,
    CASE WHEN wp.closed_positions > 0
        THEN (wp.positions_with_payouts * 100.0 / wp.closed_positions) >= 95
        ELSE true
    END as payout_coverage_gate,
    (COALESCE(ap.positions_in_api, 0) * 100.0 / wp.total_positions) >= 50 as api_coverage_gate,
    (wp.positions_with_prices * 100.0 / wp.total_positions) >= 95
        AND CASE WHEN wp.closed_positions > 0
            THEN (wp.positions_with_payouts * 100.0 / wp.closed_positions) >= 95
            ELSE true
        END
        AND (COALESCE(ap.positions_in_api, 0) * 100.0 / wp.total_positions) >= 50
        as all_gates_pass,
    wp.total_trades,
    wp.markets_traded,
    wp.total_volume_usd,
    wp.total_trades >= 10 AND wp.markets_traded >= 3 AND wp.total_volume_usd >= 1000 as meets_activity_threshold,
    ap.api_total_pnl,
    NULL as calculated_total_pnl,  -- TODO: Join with vw_wallet_pnl
    NULL as pnl_discrepancy_abs,
    NULL as pnl_discrepancy_pct,
    ap.api_last_synced,
    now() as blockchain_last_synced,
    CASE WHEN ap.api_last_synced IS NOT NULL
        THEN date_diff('hour', ap.api_last_synced, now())
        ELSE NULL
    END as data_freshness_hours,
    now() as calculated_at,
    now() as updated_at
FROM wallet_positions wp
LEFT JOIN api_positions ap ON wp.wallet_address = ap.wallet_address;
*/

-- Test 2: Check table structures
DESCRIBE cascadian_clean.wallet_coverage_metrics;
DESCRIBE cascadian_clean.market_coverage_metrics;
DESCRIBE cascadian_clean.data_sync_status;

-- Test 3: Verify coverage gates
SELECT
    countIf(price_coverage_gate) as wallets_pass_price_gate,
    countIf(payout_coverage_gate) as wallets_pass_payout_gate,
    countIf(api_coverage_gate) as wallets_pass_api_gate,
    countIf(all_gates_pass) as wallets_pass_all_gates,
    countIf(meets_activity_threshold) as wallets_meet_activity,
    countIf(all_gates_pass AND meets_activity_threshold) as leaderboard_eligible,
    count() as total_wallets
FROM cascadian_clean.wallet_coverage_metrics;

-- Test 4: Data quality summary
SELECT * FROM cascadian_clean.mv_data_quality_summary
ORDER BY calculation_date DESC
LIMIT 1;

-- Test 5: Find wallets needing attention
SELECT
    wallet_address,
    price_coverage_pct,
    payout_coverage_pct,
    api_coverage_pct,
    data_freshness_hours,
    CASE
        WHEN NOT price_coverage_gate THEN 'MISSING_PRICES'
        WHEN NOT payout_coverage_gate THEN 'MISSING_PAYOUTS'
        WHEN NOT api_coverage_gate THEN 'MISSING_API_DATA'
        WHEN data_freshness_hours > 24 THEN 'STALE_DATA'
        ELSE 'OK'
    END as issue
FROM cascadian_clean.wallet_coverage_metrics
WHERE NOT all_gates_pass OR data_freshness_hours > 24
ORDER BY total_volume_usd DESC
LIMIT 20;

-- Test 6: Market coverage analysis
SELECT
    countIf(price_coverage_gate) as markets_pass_price_gate,
    countIf(has_payout_vector) as markets_with_payouts,
    countIf(is_resolved) as markets_resolved,
    countIf(high_quality) as high_quality_markets,
    count() as total_markets
FROM cascadian_clean.market_coverage_metrics;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- To rollback this migration:
--   DROP TABLE IF EXISTS cascadian_clean.wallet_coverage_metrics;
--   DROP VIEW IF EXISTS cascadian_clean.mv_data_quality_summary;
--   DROP TABLE IF EXISTS cascadian_clean.market_coverage_metrics;
--   DROP TABLE IF EXISTS cascadian_clean.data_sync_status;
-- ============================================================================
