-- ============================================================================
-- Migration 003: Create Leaderboard Tables
-- ============================================================================
-- Purpose: Materialized tables for wallet rankings and performance metrics
-- Database: cascadian_clean (analytics layer)
-- Author: Database Architect Agent
-- Date: 2025-11-09
-- Dependencies: Migration 001, 002 (API data + resolution views)
-- Expected rows: 10K-50K wallets with significant activity
-- ============================================================================

-- ============================================================================
-- 1. WALLET MARKET RETURNS (BASE TABLE)
-- ============================================================================
-- One row per wallet+condition with complete P&L breakdown
-- Design: Materialized table for performance (not a view)
-- Refresh: Daily or on-demand via INSERT INTO ... SELECT

CREATE TABLE IF NOT EXISTS cascadian_clean.wallet_market_returns (
    -- Identity
    wallet_address LowCardinality(String) COMMENT 'Wallet address',
    condition_id String COMMENT 'Condition ID (normalized)',
    market_slug LowCardinality(String) COMMENT 'Market slug for display',
    market_title String COMMENT 'Market title/question',

    -- Trading activity
    total_trades UInt32 COMMENT 'Number of trades in this market',
    total_volume_usd Float64 COMMENT 'Total volume traded (entry + exit)',
    shares_bought Float64 COMMENT 'Total shares bought',
    shares_sold Float64 COMMENT 'Total shares sold',
    net_shares Float64 COMMENT 'Current position (shares_bought - shares_sold)',

    -- Cost basis and returns
    cost_basis_usd Float64 COMMENT 'Total cost to enter position',
    proceeds_usd Float64 COMMENT 'Total proceeds from exits/redemptions',
    avg_entry_price Float64 COMMENT 'Average entry price',
    avg_exit_price Float64 COMMENT 'Average exit price (if sold)',

    -- P&L breakdown
    realized_pnl_usd Float64 COMMENT 'Realized P&L from closed positions',
    unrealized_pnl_usd Float64 COMMENT 'Unrealized P&L from open positions',
    redemption_pnl_usd Float64 COMMENT 'P&L from redeeming resolved positions',
    total_pnl_usd Float64 COMMENT 'Total P&L (realized + unrealized + redemption)',

    -- Resolution data
    is_resolved Bool COMMENT 'True if market is resolved',
    winning_outcome_index Nullable(UInt8) COMMENT 'Winning outcome index (if resolved)',
    payout_received_usd Nullable(Float64) COMMENT 'Payout received (if redeemed)',

    -- Performance metrics
    roi_percent Float64 COMMENT 'Return on investment (%)',
    holding_period_days Float64 COMMENT 'Days between first and last trade',

    -- Time tracking
    first_trade_at DateTime COMMENT 'Timestamp of first trade in this market',
    last_trade_at DateTime COMMENT 'Timestamp of last trade in this market',
    resolved_at Nullable(DateTime) COMMENT 'Market resolution timestamp',

    -- Metadata
    calculated_at DateTime DEFAULT now() COMMENT 'When this row was calculated',
    updated_at DateTime DEFAULT now() COMMENT 'Last update timestamp'
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, condition_id)
COMMENT 'Per-wallet, per-market returns and P&L breakdown';

-- Populate from canonical trades + resolutions
-- Run this after creating the table (or in separate migration step)
-- INSERT INTO cascadian_clean.wallet_market_returns
-- SELECT ... (see verification section for query)

-- ============================================================================
-- 2. WALLET OMEGA DAILY (RISK-ADJUSTED RETURNS)
-- ============================================================================
-- Omega ratio: Probability-weighted returns above threshold / below threshold
-- Higher Omega = better risk-adjusted returns
-- Formula: Omega(L) = E[max(R-L, 0)] / E[max(L-R, 0)]
-- Threshold L = 0 (separate gains vs losses)

CREATE TABLE IF NOT EXISTS cascadian_clean.wallet_omega_daily (
    -- Identity
    wallet_address LowCardinality(String) COMMENT 'Wallet address',
    calculation_date Date COMMENT 'Date of calculation',

    -- Returns distribution
    total_trades UInt32 COMMENT 'Total trades in period',
    winning_trades UInt32 COMMENT 'Trades with positive P&L',
    losing_trades UInt32 COMMENT 'Trades with negative P&L',
    neutral_trades UInt32 COMMENT 'Trades with zero P&L',

    -- Gain metrics
    total_gains_usd Float64 COMMENT 'Sum of all positive returns',
    avg_gain_usd Float64 COMMENT 'Average gain per winning trade',
    max_gain_usd Float64 COMMENT 'Largest single gain',

    -- Loss metrics
    total_losses_usd Float64 COMMENT 'Sum of all negative returns (absolute value)',
    avg_loss_usd Float64 COMMENT 'Average loss per losing trade',
    max_loss_usd Float64 COMMENT 'Largest single loss (absolute value)',

    -- Omega ratio components
    omega_ratio Float64 COMMENT 'Omega(0): total_gains / total_losses',
    sharpe_ratio Float64 COMMENT 'Sharpe ratio for comparison',
    sortino_ratio Float64 COMMENT 'Sortino ratio (downside deviation)',

    -- Portfolio metrics
    win_rate Float64 COMMENT 'Winning trades / total trades',
    profit_factor Float64 COMMENT 'Total gains / total losses',

    -- Metadata
    calculated_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, calculation_date)
COMMENT 'Daily Omega ratio and risk-adjusted returns by wallet';

-- Index strategy: Query by wallet_address first, then filter by date range
-- Expected queries:
--   - Get wallet Omega: WHERE wallet_address = '0x...' ORDER BY calculation_date DESC
--   - Leaderboard: WHERE calculation_date = today() ORDER BY omega_ratio DESC

-- ============================================================================
-- 3. LEADERBOARD: WHALES (BY SETTLED P&L)
-- ============================================================================
-- Ranks wallets by total settled P&L (realized + redemption)
-- Filtered by minimum coverage thresholds to ensure data quality

CREATE TABLE IF NOT EXISTS cascadian_clean.leaderboard_whales (
    -- Ranking
    rank UInt32 COMMENT 'Overall rank (1 = best performer)',
    wallet_address LowCardinality(String) COMMENT 'Wallet address',

    -- P&L metrics
    total_settled_pnl_usd Float64 COMMENT 'Total settled P&L (realized + redemption)',
    total_realized_pnl_usd Float64 COMMENT 'Realized trading P&L',
    total_redemption_pnl_usd Float64 COMMENT 'Redemption P&L from resolved markets',
    total_volume_usd Float64 COMMENT 'Total trading volume',

    -- Activity metrics
    total_trades UInt32 COMMENT 'Total number of trades',
    markets_traded UInt32 COMMENT 'Unique markets traded',
    markets_resolved UInt32 COMMENT 'Number of resolved markets traded',
    markets_won UInt32 COMMENT 'Number of markets won',

    -- Performance metrics
    roi_percent Float64 COMMENT 'Return on investment (%)',
    win_rate Float64 COMMENT 'Markets won / markets resolved',
    avg_pnl_per_market Float64 COMMENT 'Average P&L per market',

    -- Coverage quality (data quality gates)
    positions_total UInt32 COMMENT 'Total positions across all markets',
    positions_with_prices UInt32 COMMENT 'Positions with known entry prices',
    positions_with_payouts UInt32 COMMENT 'Positions with known payout vectors',
    price_coverage_pct Float64 COMMENT '% positions with prices',
    payout_coverage_pct Float64 COMMENT '% positions with payouts',

    -- Time metrics
    first_trade_at DateTime COMMENT 'First trade timestamp',
    last_trade_at DateTime COMMENT 'Last trade timestamp',
    days_active Float64 COMMENT 'Days between first and last trade',

    -- Metadata
    calculated_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (rank, wallet_address)
COMMENT 'Leaderboard ranked by total settled P&L (filtered by coverage)';

-- Coverage gates (applied during population):
--   - Global: price_coverage_pct >= 95%, payout_coverage_pct >= 95%
--   - Minimum activity: total_trades >= 10, markets_traded >= 3
--   - Minimum volume: total_volume_usd >= 1000

-- ============================================================================
-- 4. LEADERBOARD: OMEGA (BY RISK-ADJUSTED RETURNS)
-- ============================================================================
-- Ranks wallets by Omega ratio (risk-adjusted returns)
-- Filtered by same coverage thresholds as whales leaderboard

CREATE TABLE IF NOT EXISTS cascadian_clean.leaderboard_omega (
    -- Ranking
    rank UInt32 COMMENT 'Overall rank (1 = best Omega ratio)',
    wallet_address LowCardinality(String) COMMENT 'Wallet address',

    -- Risk-adjusted metrics
    omega_ratio Float64 COMMENT 'Omega(0) ratio',
    sharpe_ratio Float64 COMMENT 'Sharpe ratio',
    sortino_ratio Float64 COMMENT 'Sortino ratio',

    -- Returns distribution
    total_gains_usd Float64 COMMENT 'Sum of all gains',
    total_losses_usd Float64 COMMENT 'Sum of all losses (absolute)',
    avg_gain_usd Float64 COMMENT 'Average gain',
    avg_loss_usd Float64 COMMENT 'Average loss',
    max_gain_usd Float64 COMMENT 'Maximum single gain',
    max_loss_usd Float64 COMMENT 'Maximum single loss',

    -- Activity metrics
    total_trades UInt32 COMMENT 'Total trades',
    winning_trades UInt32 COMMENT 'Trades with gain',
    losing_trades UInt32 COMMENT 'Trades with loss',
    win_rate Float64 COMMENT 'Winning trades / total trades',

    -- P&L metrics
    total_pnl_usd Float64 COMMENT 'Total P&L',
    total_volume_usd Float64 COMMENT 'Total volume',
    roi_percent Float64 COMMENT 'ROI %',

    -- Coverage quality
    positions_total UInt32,
    positions_with_prices UInt32,
    positions_with_payouts UInt32,
    price_coverage_pct Float64,
    payout_coverage_pct Float64,

    -- Metadata
    first_trade_at DateTime,
    last_trade_at DateTime,
    days_active Float64,
    calculated_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (rank, wallet_address)
COMMENT 'Leaderboard ranked by Omega ratio (risk-adjusted returns)';

-- Coverage gates (same as whales):
--   - price_coverage_pct >= 95%
--   - payout_coverage_pct >= 95%
--   - total_trades >= 10
--   - markets_traded >= 3
--   - total_volume_usd >= 1000

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Test 1: Sample population query for wallet_market_returns
-- (Run this to populate the table)
/*
INSERT INTO cascadian_clean.wallet_market_returns
SELECT
    wallet_address,
    condition_id_normalized as condition_id,
    any(market_slug) as market_slug,
    any(market_title) as market_title,
    count() as total_trades,
    sum(abs(cashflow_usdc)) as total_volume_usd,
    sumIf(shares, side='BUY') as shares_bought,
    sumIf(shares, side='SELL') as shares_sold,
    sum(shares_net) as net_shares,
    sum(cost_basis_usd) as cost_basis_usd,
    sumIf(cashflow_usdc, cashflow_usdc > 0) as proceeds_usd,
    avgIf(price, side='BUY') as avg_entry_price,
    avgIf(price, side='SELL') as avg_exit_price,
    sum(pnl_realized) as realized_pnl_usd,
    sum(pnl_unrealized) as unrealized_pnl_usd,
    sum(pnl_redemption) as redemption_pnl_usd,
    sum(pnl_total) as total_pnl_usd,
    any(is_resolved) as is_resolved,
    any(winning_outcome_index) as winning_outcome_index,
    sumIf(pnl_redemption, pnl_redemption > 0) as payout_received_usd,
    (sum(pnl_total) / greatest(sum(cost_basis_usd), 0.01)) * 100 as roi_percent,
    dateDiff('day', min(block_timestamp), max(block_timestamp)) as holding_period_days,
    min(block_timestamp) as first_trade_at,
    max(block_timestamp) as last_trade_at,
    any(resolved_at) as resolved_at,
    now() as calculated_at,
    now() as updated_at
FROM cascadian_clean.vw_trades_canonical
LEFT JOIN cascadian_clean.vw_resolutions_truth r
    ON vw_trades_canonical.condition_id_normalized = r.condition_id_normalized
GROUP BY wallet_address, condition_id_normalized;
*/

-- Test 2: Sample Omega calculation query
-- (Simplified - real implementation needs trade-by-trade returns)
/*
INSERT INTO cascadian_clean.wallet_omega_daily
SELECT
    wallet_address,
    today() as calculation_date,
    count() as total_trades,
    countIf(total_pnl_usd > 0) as winning_trades,
    countIf(total_pnl_usd < 0) as losing_trades,
    countIf(total_pnl_usd = 0) as neutral_trades,
    sumIf(total_pnl_usd, total_pnl_usd > 0) as total_gains_usd,
    avgIf(total_pnl_usd, total_pnl_usd > 0) as avg_gain_usd,
    maxIf(total_pnl_usd, total_pnl_usd > 0) as max_gain_usd,
    abs(sumIf(total_pnl_usd, total_pnl_usd < 0)) as total_losses_usd,
    abs(avgIf(total_pnl_usd, total_pnl_usd < 0)) as avg_loss_usd,
    abs(minIf(total_pnl_usd, total_pnl_usd < 0)) as max_loss_usd,
    sumIf(total_pnl_usd, total_pnl_usd > 0) / greatest(abs(sumIf(total_pnl_usd, total_pnl_usd < 0)), 0.01) as omega_ratio,
    0 as sharpe_ratio,  -- TODO: Calculate from returns variance
    0 as sortino_ratio,  -- TODO: Calculate from downside deviation
    countIf(total_pnl_usd > 0) * 1.0 / count() as win_rate,
    sumIf(total_pnl_usd, total_pnl_usd > 0) / greatest(abs(sumIf(total_pnl_usd, total_pnl_usd < 0)), 0.01) as profit_factor,
    now() as calculated_at,
    now() as updated_at
FROM cascadian_clean.wallet_market_returns
GROUP BY wallet_address;
*/

-- Test 3: Check table structures
DESCRIBE cascadian_clean.wallet_market_returns;
DESCRIBE cascadian_clean.wallet_omega_daily;
DESCRIBE cascadian_clean.leaderboard_whales;
DESCRIBE cascadian_clean.leaderboard_omega;

-- Test 4: Verify data in leaderboard tables
SELECT
    'wallet_market_returns' as table_name,
    count() as total_rows,
    count(DISTINCT wallet_address) as unique_wallets,
    count(DISTINCT condition_id) as unique_markets,
    sum(total_pnl_usd) as aggregate_pnl
FROM cascadian_clean.wallet_market_returns;

SELECT
    'wallet_omega_daily' as table_name,
    count() as total_rows,
    count(DISTINCT wallet_address) as unique_wallets,
    avg(omega_ratio) as avg_omega,
    avg(win_rate) as avg_win_rate
FROM cascadian_clean.wallet_omega_daily;

-- Test 5: Sample leaderboard query
SELECT
    rank,
    wallet_address,
    total_settled_pnl_usd,
    total_volume_usd,
    roi_percent,
    win_rate,
    price_coverage_pct,
    payout_coverage_pct
FROM cascadian_clean.leaderboard_whales
ORDER BY rank ASC
LIMIT 10;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- To rollback this migration:
--   DROP TABLE IF EXISTS cascadian_clean.wallet_market_returns;
--   DROP TABLE IF EXISTS cascadian_clean.wallet_omega_daily;
--   DROP TABLE IF EXISTS cascadian_clean.leaderboard_whales;
--   DROP TABLE IF EXISTS cascadian_clean.leaderboard_omega;
-- ============================================================================
