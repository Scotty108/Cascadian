-- ============================================================================
-- Migration 001: Create API Staging Tables
-- ============================================================================
-- Purpose: Staging tables for Polymarket Data API and Goldsky Subgraph ingestion
-- Database: default (raw warehouse layer)
-- Author: Database Architect Agent
-- Date: 2025-11-09
-- Expected rows: 50K-500K positions, 200K-300K resolutions
-- ============================================================================

-- ============================================================================
-- 1. WALLET POSITIONS FROM POLYMARKET DATA API
-- ============================================================================
-- Sources wallet positions with P&L directly from Polymarket's API
-- Uses ReplacingMergeTree for idempotent upserts (refetch same wallet = replace old data)
-- ORDER BY optimized for common queries: wallet → condition → outcome

CREATE TABLE IF NOT EXISTS default.wallet_positions_api (
    -- Primary identifiers (matches Position interface from API)
    wallet_address LowCardinality(String) COMMENT 'Wallet address (lowercase, 0x-prefixed)',
    condition_id String COMMENT 'Condition ID (normalized: lowercase, no 0x, 64 chars)',
    token_id String COMMENT 'ERC1155 token ID from API (may differ from blockchain)',
    outcome LowCardinality(String) COMMENT 'Outcome name (Yes/No/candidate name)',
    outcome_index UInt8 COMMENT 'Outcome index (0-based)',

    -- Position details
    asset LowCardinality(String) COMMENT 'Asset ticker (e.g., USDC)',
    size Float64 COMMENT 'Current position size (shares)',
    avg_price Float64 COMMENT 'Average entry price',
    cur_price Float64 COMMENT 'Current market price',

    -- P&L metrics (from API - source of truth)
    cash_pnl Float64 COMMENT 'Total cash P&L (realized + unrealized) in USD',
    percent_pnl Float64 COMMENT 'Percentage P&L',
    realized_pnl Float64 COMMENT 'Realized P&L from closed positions in USD',
    percent_realized_pnl Float64 COMMENT 'Percentage realized P&L',

    -- Valuation
    initial_value Float64 COMMENT 'Initial position value (cost basis)',
    current_value Float64 COMMENT 'Current position value',
    total_bought Float64 COMMENT 'Total shares bought over time',

    -- Status flags
    redeemable Bool COMMENT 'True if market resolved and shares can be redeemed',
    mergeable Bool COMMENT 'True if position can be merged (neg-risk markets)',

    -- Market metadata (denormalized for convenience)
    market_title String COMMENT 'Market title/question',
    market_slug LowCardinality(String) COMMENT 'Market slug (URL-friendly)',
    end_date DateTime COMMENT 'Market end date',

    -- Audit columns
    fetched_at DateTime DEFAULT now() COMMENT 'When this row was fetched from API',
    inserted_at DateTime DEFAULT now() COMMENT 'When this row was inserted into ClickHouse',
    updated_at DateTime DEFAULT now() COMMENT 'When this row was last updated',

    -- Raw payload for debugging
    raw_payload String COMMENT 'Full JSON response from API (for debugging)'
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, condition_id, outcome_index)
COMMENT 'Wallet positions from Polymarket Data API - idempotent staging table';

-- Index strategy:
-- 1. PRIMARY KEY (wallet_address, condition_id, outcome_index) - Fast wallet lookups
-- 2. No additional indexes needed - queries filter on ORDER BY columns
-- 3. ReplacingMergeTree automatically handles refetches (same wallet = replace)

-- Row count estimate: 50K-500K positions
-- Expected queries:
--   - Get all positions for wallet (filter: wallet_address)
--   - Get wallet P&L summary (filter: wallet_address, aggregate: sum(cash_pnl))
--   - Get redeemable positions (filter: redeemable=true)
--   - Compare API vs calculated P&L (join with vw_wallet_pnl)

-- ============================================================================
-- 2. RESOLUTIONS FROM GOLDSKY SUBGRAPH
-- ============================================================================
-- Updates existing resolutions_external_ingest table to include Goldsky source
-- Table already exists - just add documentation here

-- ALTER existing table to add source value (no schema change needed)
-- INSERT with source='goldsky-api' to distinguish from other sources

-- Verify table exists and has correct structure
SELECT
    name,
    engine,
    create_table_query
FROM system.tables
WHERE database = 'default'
  AND name = 'resolutions_external_ingest'
FORMAT Vertical;

-- Expected structure:
-- CREATE TABLE default.resolutions_external_ingest (
--     condition_id String,
--     payout_numerators Array(UInt8),  -- Note: API returns strings, must convert
--     payout_denominator UInt8,
--     winning_index Int32,
--     resolved_at DateTime,
--     source LowCardinality(String),
--     fetched_at DateTime DEFAULT now()
-- )
-- ENGINE = ReplacingMergeTree(fetched_at)
-- ORDER BY condition_id;

-- ============================================================================
-- 3. WALLET METADATA FROM API (OPTIONAL - FUTURE)
-- ============================================================================
-- Stores wallet-level metadata for smart money tracking
-- Not implemented in Phase 1 but reserved for future use

CREATE TABLE IF NOT EXISTS default.wallet_metadata_api (
    -- Identity
    wallet_address LowCardinality(String) COMMENT 'Wallet address (lowercase, 0x-prefixed)',
    proxy_wallet String COMMENT 'Proxy wallet address if using Polymarket proxy',

    -- Profile metadata (if available from API)
    username String DEFAULT '' COMMENT 'Username/ENS name',
    bio String DEFAULT '' COMMENT 'User bio',
    profile_image_url String DEFAULT '' COMMENT 'Profile image URL',

    -- Activity metrics (computed from positions)
    total_markets_traded UInt32 COMMENT 'Total unique markets traded',
    total_volume_usd Float64 COMMENT 'Total trading volume in USD',
    first_trade_date DateTime COMMENT 'Date of first trade',
    last_trade_date DateTime COMMENT 'Date of last trade',

    -- Performance metrics
    total_realized_pnl Float64 COMMENT 'Total realized P&L',
    total_cash_pnl Float64 COMMENT 'Total cash P&L (realized + unrealized)',
    win_rate Float64 COMMENT 'Win rate (resolved markets won / total resolved)',

    -- Smart money classification (computed by our system)
    smart_money_score Float64 DEFAULT 0 COMMENT 'Smart money score (0-100)',
    smart_money_rank UInt32 DEFAULT 0 COMMENT 'Rank among all wallets',

    -- Audit columns
    fetched_at DateTime DEFAULT now(),
    inserted_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY wallet_address
COMMENT 'Wallet metadata from Polymarket API (future use)';

-- ============================================================================
-- 4. COVERAGE METRICS (STAGING)
-- ============================================================================
-- Tracks which wallets have been backfilled and data quality metrics

CREATE TABLE IF NOT EXISTS default.wallet_api_backfill_log (
    wallet_address LowCardinality(String) COMMENT 'Wallet address',
    backfill_type LowCardinality(String) COMMENT 'Type: full|incremental|redeemable',
    positions_fetched UInt32 COMMENT 'Number of positions fetched',
    positions_inserted UInt32 COMMENT 'Number of positions successfully inserted',
    api_response_time_ms UInt32 COMMENT 'API response time in milliseconds',
    status LowCardinality(String) COMMENT 'Status: success|error|partial',
    error_message String DEFAULT '' COMMENT 'Error message if status=error',
    started_at DateTime COMMENT 'Backfill start time',
    completed_at DateTime COMMENT 'Backfill completion time',
    inserted_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (wallet_address, started_at)
COMMENT 'Audit log for API backfill operations';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Test 1: Verify wallet_positions_api table exists
SELECT
    'wallet_positions_api' as table_name,
    engine,
    total_rows,
    total_bytes,
    formatReadableSize(total_bytes) as size_readable
FROM system.tables
WHERE database = 'default' AND name = 'wallet_positions_api';

-- Test 2: Check for duplicate keys (should be 0 after OPTIMIZE)
SELECT
    wallet_address,
    condition_id,
    outcome_index,
    count() as row_count
FROM default.wallet_positions_api
GROUP BY wallet_address, condition_id, outcome_index
HAVING count() > 1
LIMIT 10;

-- Test 3: Verify data types
DESCRIBE default.wallet_positions_api;

-- Test 4: Check backfill log
SELECT
    backfill_type,
    status,
    count() as operations,
    sum(positions_fetched) as total_positions,
    avg(api_response_time_ms) as avg_response_ms
FROM default.wallet_api_backfill_log
GROUP BY backfill_type, status;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- To rollback this migration:
--   DROP TABLE IF EXISTS default.wallet_positions_api;
--   DROP TABLE IF EXISTS default.wallet_metadata_api;
--   DROP TABLE IF EXISTS default.wallet_api_backfill_log;
-- ============================================================================
