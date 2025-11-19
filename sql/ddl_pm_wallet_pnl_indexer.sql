-- pm_wallet_pnl_indexer: Aggregated Wallet-Level P&L from Indexer
--
-- Purpose: Wallet-level P&L summary aggregated from pm_positions_indexer
-- Use Cases: Global leaderboards, wallet discovery, performance tracking
--
-- Schema Version: 1.0
-- Created: 2025-11-15
-- Author: C1

CREATE MATERIALIZED VIEW IF NOT EXISTS pm_wallet_pnl_indexer
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(last_updated_at)
ORDER BY (wallet_address, total_realized_pnl)
SETTINGS index_granularity = 8192
AS
SELECT
    -- Grouping Key
    wallet_address,

    -- Position Counts
    countState() as total_positions,               -- Total distinct positions (condition+outcome combos)
    uniqState(condition_id) as distinct_markets,   -- Distinct markets traded

    -- P&L Metrics (all in USDC, 6 decimals)
    sumState(realized_pnl) as total_realized_pnl,  -- Sum of all realized P&L
    avgState(realized_pnl) as avg_realized_pnl,    -- Average P&L per position
    maxState(realized_pnl) as max_position_pnl,    -- Largest winning position
    minState(realized_pnl) as min_position_pnl,    -- Largest losing position

    -- Volume Metrics
    sumState(total_bought) as total_volume,        -- Total cumulative buys (18 decimals)
    avgState(total_bought) as avg_position_size,   -- Average position size

    -- Current Exposure (net shares across all positions)
    sumState(amount) as total_net_shares,          -- Sum of net shares (can be +/-)
    sumState(abs(amount)) as total_absolute_shares, -- Sum of absolute shares (size)

    -- Profitability Stats
    countIfState(realized_pnl > 0) as winning_positions,
    countIfState(realized_pnl < 0) as losing_positions,
    countIfState(realized_pnl = 0) as breakeven_positions,

    -- Metadata
    maxState(last_synced_at) as last_updated_at,   -- Most recent sync timestamp
    groupUniqArrayState(data_source) as data_sources -- All data sources

FROM pm_positions_indexer
GROUP BY wallet_address;

COMMENT ON TABLE pm_wallet_pnl_indexer IS 'Aggregated wallet-level P&L from global indexer. Uses AggregatingMergeTree for incremental updates. Query with -Merge combinators to get final values.';

-- Companion View: Human-Readable Wallet P&L Summary
CREATE VIEW IF NOT EXISTS pm_wallet_pnl_summary_indexer AS
SELECT
    wallet_address,

    -- Position Counts
    countMerge(total_positions) as total_positions,
    uniqMerge(distinct_markets) as distinct_markets,

    -- P&L Metrics (converted to Float64 for readability)
    ROUND(sumMerge(total_realized_pnl) / 1e6, 2) as total_realized_pnl_usd,
    ROUND(avgMerge(avg_realized_pnl) / 1e6, 2) as avg_realized_pnl_usd,
    ROUND(maxMerge(max_position_pnl) / 1e6, 2) as max_position_pnl_usd,
    ROUND(minMerge(min_position_pnl) / 1e6, 2) as min_position_pnl_usd,

    -- Volume Metrics (converted to standard shares)
    ROUND(sumMerge(total_volume) / 1e18, 2) as total_volume_shares,
    ROUND(avgMerge(avg_position_size) / 1e18, 2) as avg_position_size_shares,

    -- Current Exposure
    ROUND(sumMerge(total_net_shares) / 1e18, 2) as total_net_shares,
    ROUND(sumMerge(total_absolute_shares) / 1e18, 2) as total_absolute_shares,

    -- Win Rate
    countIfMerge(winning_positions) as winning_positions,
    countIfMerge(losing_positions) as losing_positions,
    countIfMerge(breakeven_positions) as breakeven_positions,

    ROUND(
        countIfMerge(winning_positions) /
        (countIfMerge(winning_positions) + countIfMerge(losing_positions) + 0.0001),
        4
    ) as win_rate,

    -- Metadata
    maxMerge(last_updated_at) as last_updated_at,
    groupUniqArrayMerge(data_sources) as data_sources

FROM pm_wallet_pnl_indexer
GROUP BY wallet_address;

COMMENT ON TABLE pm_wallet_pnl_summary_indexer IS 'Human-readable wallet P&L summary. Applies -Merge combinators and unit conversions. Use for leaderboards and analytics.';

-- Usage Notes:
--
-- 1. Querying Total P&L by Wallet:
--    SELECT
--        wallet_address,
--        total_realized_pnl_usd,
--        win_rate,
--        distinct_markets
--    FROM pm_wallet_pnl_summary_indexer
--    ORDER BY total_realized_pnl_usd DESC
--    LIMIT 100;
--
-- 2. Global Leaderboard Query:
--    SELECT
--        wallet_address,
--        total_realized_pnl_usd,
--        total_volume_shares,
--        win_rate,
--        winning_positions,
--        losing_positions,
--        distinct_markets
--    FROM pm_wallet_pnl_summary_indexer
--    WHERE distinct_markets >= 10  -- Minimum market threshold
--      AND winning_positions + losing_positions >= 20  -- Minimum positions
--    ORDER BY total_realized_pnl_usd DESC
--    LIMIT 100;
--
-- 3. Incremental Updates:
--    - AggregatingMergeTree automatically handles incremental updates
--    - When pm_positions_indexer gets new data, materialized view auto-updates
--    - No manual aggregation needed
--
-- 4. Data Freshness:
--    - last_updated_at shows most recent sync time per wallet
--    - Use WHERE last_updated_at > now() - INTERVAL 1 HOUR for fresh data
--
-- 5. Unit Conversions:
--    - Realized P&L: stored as int64 (6 decimals), displayed as USD
--    - Shares: stored as Decimal128(18), displayed as float
--    - Win rate: computed as winning / (winning + losing)
--
-- 6. Performance:
--    - ORDER BY (wallet_address, total_realized_pnl) optimizes leaderboard queries
--    - Monthly partitioning allows efficient range scans
--    - AggregatingMergeTree keeps aggregates compact
