-- ============================================================================
-- Wallet P&L Calculation with Payout Vectors
-- ============================================================================
--
-- This query calculates accurate P&L using payout vectors from the
-- Polymarket PNL Subgraph (now stored in our payout_vectors table)
--
-- Formula: pnl = shares * (payout_numerator / payout_denominator) - cost_basis
--
-- Note: ClickHouse arrays are 1-indexed, so we use outcome_index + 1
-- ============================================================================

-- ============================================================================
-- View 1: Realized P&L per Position
-- ============================================================================

CREATE OR REPLACE VIEW polymarket.vw_wallet_realized_pnl AS
SELECT
    t.wallet_id,
    t.condition_id,
    t.outcome_index,
    m.title as market_title,
    m.outcomes[t.outcome_index + 1] as outcome_name,

    -- Position metrics
    SUM(t.shares) as total_shares,
    AVG(t.price) as avg_entry_price,
    SUM(t.shares * t.price) as cost_basis,

    -- Payout data
    p.payout_numerators[t.outcome_index + 1] as payout_numerator,
    p.payout_denominator,

    -- Settlement calculation
    (total_shares * (payout_numerator / payout_denominator)) as settlement_value,

    -- P&L calculation
    settlement_value - cost_basis as realized_pnl,

    -- Percentage return
    CASE
        WHEN cost_basis > 0 THEN (realized_pnl / cost_basis) * 100
        ELSE 0
    END as pnl_percentage,

    -- Status
    CASE
        WHEN p.payout_denominator > 0 THEN 'resolved'
        ELSE 'pending'
    END as status,

    p.resolved_at

FROM polymarket.trades t
LEFT JOIN polymarket.payout_vectors p
    ON p.condition_id = t.condition_id
LEFT JOIN polymarket.markets m
    ON m.condition_id = t.condition_id

WHERE
    -- Only include resolved markets
    p.payout_denominator > 0

GROUP BY
    t.wallet_id,
    t.condition_id,
    t.outcome_index,
    m.title,
    m.outcomes,
    p.payout_numerators,
    p.payout_denominator,
    p.resolved_at;


-- ============================================================================
-- View 2: Unrealized P&L (Open Positions)
-- ============================================================================

CREATE OR REPLACE VIEW polymarket.vw_wallet_unrealized_pnl AS
SELECT
    t.wallet_id,
    t.condition_id,
    t.outcome_index,
    m.title as market_title,
    m.outcomes[t.outcome_index + 1] as outcome_name,

    -- Position metrics
    SUM(t.shares) as total_shares,
    AVG(t.price) as avg_entry_price,
    SUM(t.shares * t.price) as cost_basis,

    -- Current market price
    mp.prices[t.outcome_index + 1] as current_price,

    -- Mark-to-market value
    total_shares * current_price as current_value,

    -- Unrealized P&L
    current_value - cost_basis as unrealized_pnl,

    -- Percentage return
    CASE
        WHEN cost_basis > 0 THEN (unrealized_pnl / cost_basis) * 100
        ELSE 0
    END as pnl_percentage,

    m.end_date,
    m.closed

FROM polymarket.trades t
LEFT JOIN polymarket.payout_vectors p
    ON p.condition_id = t.condition_id
LEFT JOIN polymarket.markets m
    ON m.condition_id = t.condition_id
LEFT JOIN polymarket.market_prices mp
    ON mp.condition_id = t.condition_id

WHERE
    -- Only open positions (not yet resolved)
    (p.payout_denominator IS NULL OR p.payout_denominator = 0)
    AND total_shares > 0.001  -- Filter out dust positions

GROUP BY
    t.wallet_id,
    t.condition_id,
    t.outcome_index,
    m.title,
    m.outcomes,
    mp.prices,
    m.end_date,
    m.closed;


-- ============================================================================
-- View 3: Total P&L Summary per Wallet
-- ============================================================================

CREATE OR REPLACE VIEW polymarket.vw_wallet_total_pnl AS
WITH realized AS (
    SELECT
        wallet_id,
        SUM(realized_pnl) as total_realized_pnl,
        COUNT(DISTINCT condition_id) as resolved_positions,
        SUM(cost_basis) as total_resolved_volume
    FROM polymarket.vw_wallet_realized_pnl
    GROUP BY wallet_id
),
unrealized AS (
    SELECT
        wallet_id,
        SUM(unrealized_pnl) as total_unrealized_pnl,
        SUM(current_value) as total_position_value,
        COUNT(DISTINCT condition_id) as open_positions,
        SUM(cost_basis) as total_open_volume
    FROM polymarket.vw_wallet_unrealized_pnl
    GROUP BY wallet_id
)
SELECT
    COALESCE(r.wallet_id, u.wallet_id) as wallet_id,

    -- Realized P&L
    COALESCE(r.total_realized_pnl, 0) as realized_pnl,
    COALESCE(r.resolved_positions, 0) as resolved_positions,
    COALESCE(r.total_resolved_volume, 0) as resolved_volume,

    -- Unrealized P&L
    COALESCE(u.total_unrealized_pnl, 0) as unrealized_pnl,
    COALESCE(u.total_position_value, 0) as position_value,
    COALESCE(u.open_positions, 0) as open_positions,
    COALESCE(u.total_open_volume, 0) as open_volume,

    -- Total P&L
    realized_pnl + unrealized_pnl as total_pnl,

    -- Total volume traded
    resolved_volume + open_volume as total_volume,

    -- ROI
    CASE
        WHEN total_volume > 0 THEN (total_pnl / total_volume) * 100
        ELSE 0
    END as roi_percentage,

    -- Position counts
    resolved_positions + open_positions as total_positions

FROM realized r
FULL OUTER JOIN unrealized u ON r.wallet_id = u.wallet_id;


-- ============================================================================
-- View 4: Top Winners/Losers by Market
-- ============================================================================

CREATE OR REPLACE VIEW polymarket.vw_top_market_pnl AS
SELECT
    condition_id,
    market_title,
    COUNT(DISTINCT wallet_id) as total_traders,
    SUM(realized_pnl) as total_pnl_paid,
    SUM(cost_basis) as total_volume,
    AVG(realized_pnl) as avg_pnl_per_trader,
    MAX(realized_pnl) as biggest_winner,
    MIN(realized_pnl) as biggest_loser
FROM polymarket.vw_wallet_realized_pnl
GROUP BY condition_id, market_title
ORDER BY total_volume DESC;


-- ============================================================================
-- Query Examples
-- ============================================================================

-- Example 1: Get P&L for specific wallet
/*
SELECT *
FROM polymarket.vw_wallet_total_pnl
WHERE wallet_id = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
*/

-- Example 2: Top 10 most profitable wallets
/*
SELECT
    wallet_id,
    total_pnl,
    roi_percentage,
    total_positions,
    total_volume
FROM polymarket.vw_wallet_total_pnl
ORDER BY total_pnl DESC
LIMIT 10;
*/

-- Example 3: Detailed position breakdown for wallet
/*
SELECT
    market_title,
    outcome_name,
    total_shares,
    avg_entry_price,
    cost_basis,
    settlement_value,
    realized_pnl,
    pnl_percentage
FROM polymarket.vw_wallet_realized_pnl
WHERE wallet_id = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
ORDER BY realized_pnl DESC;
*/

-- Example 4: Markets with most P&L action
/*
SELECT *
FROM polymarket.vw_top_market_pnl
ORDER BY total_volume DESC
LIMIT 20;
*/

-- Example 5: Verify P&L calculation accuracy
/*
-- Compare our calculation vs Polymarket's Data API
SELECT
    wallet_id,
    total_pnl as our_calculation,
    -- Import data_api_total from their /value endpoint for comparison
    data_api_total,
    ABS(total_pnl - data_api_total) as difference
FROM polymarket.vw_wallet_total_pnl
LEFT JOIN polymarket.data_api_values USING (wallet_id)
WHERE difference > 1.0  -- Flag differences > $1
ORDER BY difference DESC;
*/

-- Example 6: Smart money P&L analysis
/*
SELECT
    w.wallet_id,
    w.smart_money_rank,
    p.total_pnl,
    p.roi_percentage,
    p.total_positions,
    p.total_volume
FROM polymarket.smart_money_wallets w
JOIN polymarket.vw_wallet_total_pnl p ON p.wallet_id = w.wallet_id
ORDER BY w.smart_money_rank ASC
LIMIT 50;
*/

-- ============================================================================
-- Data Quality Checks
-- ============================================================================

-- Check 1: How many trades have payout vectors?
/*
SELECT
    COUNT(*) as total_trades,
    COUNT(p.condition_id) as trades_with_payouts,
    (trades_with_payouts / total_trades) * 100 as coverage_percentage
FROM polymarket.trades t
LEFT JOIN polymarket.payout_vectors p ON p.condition_id = t.condition_id;
*/

-- Check 2: How many resolved vs unresolved markets?
/*
SELECT
    CASE
        WHEN p.payout_denominator > 0 THEN 'resolved'
        WHEN p.payout_denominator = 0 THEN 'pending_resolution'
        ELSE 'no_payout_data'
    END as status,
    COUNT(DISTINCT t.condition_id) as market_count,
    SUM(t.shares * t.price) as total_volume
FROM polymarket.trades t
LEFT JOIN polymarket.payout_vectors p ON p.condition_id = t.condition_id
GROUP BY status;
*/

-- Check 3: Find markets with missing payout vectors
/*
SELECT DISTINCT
    t.condition_id,
    m.title,
    m.closed,
    m.end_date,
    COUNT(*) as trade_count,
    SUM(t.shares * t.price) as volume
FROM polymarket.trades t
LEFT JOIN polymarket.payout_vectors p ON p.condition_id = t.condition_id
LEFT JOIN polymarket.markets m ON m.condition_id = t.condition_id
WHERE p.condition_id IS NULL
    AND m.closed = true  -- Market is closed but no payout data
GROUP BY t.condition_id, m.title, m.closed, m.end_date
ORDER BY volume DESC
LIMIT 100;
*/

-- ============================================================================
-- Performance Optimization
-- ============================================================================

-- These indexes should already exist from the table definitions, but verify:
/*
OPTIMIZE TABLE polymarket.payout_vectors FINAL;
OPTIMIZE TABLE polymarket.trades FINAL;
OPTIMIZE TABLE polymarket.markets FINAL;
*/

-- Test query performance
/*
SELECT
    formatReadableQuantity(count()) as total_rows,
    formatReadableSize(sum(data_compressed_bytes)) as compressed_size,
    formatReadableSize(sum(data_uncompressed_bytes)) as uncompressed_size
FROM system.parts
WHERE database = 'polymarket'
    AND table IN ('payout_vectors', 'trades', 'markets')
    AND active;
*/
