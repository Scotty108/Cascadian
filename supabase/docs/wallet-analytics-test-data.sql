-- =====================================================================
-- WALLET ANALYTICS - SAMPLE TEST DATA
-- =====================================================================
-- Purpose: Insert sample data to test wallet analytics tables
-- Use: Run this in Supabase SQL Editor to populate test data
-- =====================================================================

-- Clear existing test data (if any)
DELETE FROM whale_activity_log;
DELETE FROM market_holders;
DELETE FROM wallet_pnl_snapshots;
DELETE FROM wallet_closed_positions;
DELETE FROM wallet_trades;
DELETE FROM wallet_positions;
DELETE FROM wallets;

-- =====================================================================
-- Insert Sample Wallets
-- =====================================================================

INSERT INTO wallets (
  wallet_address,
  wallet_alias,
  is_whale,
  whale_score,
  is_suspected_insider,
  insider_score,
  total_volume_usd,
  total_trades,
  total_markets_traded,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd,
  win_rate,
  first_seen_at,
  last_seen_at,
  active_positions_count,
  closed_positions_count,
  portfolio_value_usd
) VALUES
  -- Whale #1: High volume trader
  (
    '0x1111111111111111111111111111111111111111',
    'Crypto Whale',
    TRUE,
    92.5,
    FALSE,
    45.0,
    1250000.00,
    342,
    67,
    125000.00,
    45000.00,
    170000.00,
    0.6784,
    NOW() - INTERVAL '180 days',
    NOW() - INTERVAL '2 hours',
    12,
    330,
    380000.00
  ),

  -- Insider #1: Suspiciously good timing
  (
    '0x2222222222222222222222222222222222222222',
    'Early Bird',
    FALSE,
    58.3,
    TRUE,
    87.6,
    340000.00,
    89,
    23,
    98000.00,
    12000.00,
    110000.00,
    0.8539,
    NOW() - INTERVAL '90 days',
    NOW() - INTERVAL '4 hours',
    5,
    84,
    125000.00
  ),

  -- Regular trader
  (
    '0x3333333333333333333333333333333333333333',
    'Market Maker Mike',
    FALSE,
    42.1,
    FALSE,
    28.4,
    78000.00,
    156,
    34,
    8500.00,
    -2300.00,
    6200.00,
    0.5449,
    NOW() - INTERVAL '120 days',
    NOW() - INTERVAL '1 day',
    8,
    148,
    45000.00
  );

-- =====================================================================
-- Insert Sample Positions (Current Open)
-- =====================================================================

INSERT INTO wallet_positions (
  wallet_address,
  market_id,
  market_title,
  condition_id,
  outcome,
  shares,
  entry_price,
  current_price,
  position_value_usd,
  unrealized_pnl_usd,
  opened_at,
  last_updated
) VALUES
  -- Whale's positions
  (
    '0x1111111111111111111111111111111111111111',
    '0xmarket001',
    'Will Bitcoin reach $100k by Dec 2025?',
    '0xcond001',
    'YES',
    50000.00,
    0.65,
    0.72,
    36000.00,
    3500.00,
    NOW() - INTERVAL '45 days',
    NOW() - INTERVAL '10 minutes'
  ),
  (
    '0x1111111111111111111111111111111111111111',
    '0xmarket002',
    'Will Ethereum reach $10k in 2025?',
    '0xcond002',
    'YES',
    80000.00,
    0.45,
    0.52,
    41600.00,
    5600.00,
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '15 minutes'
  ),

  -- Insider's positions
  (
    '0x2222222222222222222222222222222222222222',
    '0xmarket001',
    'Will Bitcoin reach $100k by Dec 2025?',
    '0xcond001',
    'YES',
    25000.00,
    0.58,
    0.72,
    18000.00,
    3500.00,
    NOW() - INTERVAL '60 days',
    NOW() - INTERVAL '10 minutes'
  );

-- =====================================================================
-- Insert Sample Trades
-- =====================================================================

INSERT INTO wallet_trades (
  wallet_address,
  market_id,
  market_title,
  condition_id,
  side,
  outcome,
  shares,
  price,
  amount_usd,
  executed_at,
  market_price_before,
  market_price_after,
  timing_score
) VALUES
  -- Whale's trades
  (
    '0x1111111111111111111111111111111111111111',
    '0xmarket001',
    'Will Bitcoin reach $100k by Dec 2025?',
    '0xcond001',
    'BUY',
    'YES',
    50000.00,
    0.65,
    32500.00,
    NOW() - INTERVAL '45 days',
    0.66,
    0.68,
    62.5
  ),
  (
    '0x1111111111111111111111111111111111111111',
    '0xmarket002',
    'Will Ethereum reach $10k in 2025?',
    '0xcond002',
    'BUY',
    'YES',
    80000.00,
    0.45,
    36000.00,
    NOW() - INTERVAL '30 days',
    0.46,
    0.50,
    71.2
  ),

  -- Insider's prescient trades
  (
    '0x2222222222222222222222222222222222222222',
    '0xmarket001',
    'Will Bitcoin reach $100k by Dec 2025?',
    '0xcond001',
    'BUY',
    'YES',
    25000.00,
    0.58,
    14500.00,
    NOW() - INTERVAL '60 days',
    0.59,
    0.72,
    94.3  -- Very high timing score (suspicious!)
  ),
  (
    '0x2222222222222222222222222222222222222222',
    '0xmarket003',
    'Will Trump win the 2024 election?',
    '0xcond003',
    'BUY',
    'YES',
    100000.00,
    0.42,
    42000.00,
    NOW() - INTERVAL '75 days',
    0.43,
    0.78,
    98.7  -- Extremely high timing (insider?)
  );

-- =====================================================================
-- Insert Sample Closed Positions
-- =====================================================================

INSERT INTO wallet_closed_positions (
  wallet_address,
  market_id,
  market_title,
  outcome,
  shares,
  entry_price,
  exit_price,
  realized_pnl_usd,
  is_win,
  opened_at,
  closed_at,
  hold_duration_hours
) VALUES
  -- Whale's closed winners
  (
    '0x1111111111111111111111111111111111111111',
    '0xmarket999',
    'Will Fed cut rates in Q3 2024?',
    'YES',
    100000.00,
    0.35,
    0.95,
    60000.00,
    TRUE,
    NOW() - INTERVAL '150 days',
    NOW() - INTERVAL '90 days',
    1440  -- 60 days
  ),

  -- Insider's closed winners
  (
    '0x2222222222222222222222222222222222222222',
    '0xmarket998',
    'Will Apple announce new iPhone in Sept?',
    'YES',
    50000.00,
    0.55,
    0.98,
    21500.00,
    TRUE,
    NOW() - INTERVAL '100 days',
    NOW() - INTERVAL '70 days',
    720  -- 30 days
  );

-- =====================================================================
-- Insert Sample PnL Snapshots
-- =====================================================================

INSERT INTO wallet_pnl_snapshots (
  wallet_address,
  snapshot_at,
  portfolio_value_usd,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd,
  active_positions,
  closed_positions,
  win_rate,
  total_invested_usd,
  roi
) VALUES
  -- Whale's snapshots (last 7 days)
  (
    '0x1111111111111111111111111111111111111111',
    NOW() - INTERVAL '7 days',
    360000.00,
    118000.00,
    38000.00,
    156000.00,
    12,
    325,
    0.6692,
    250000.00,
    0.6240
  ),
  (
    '0x1111111111111111111111111111111111111111',
    NOW() - INTERVAL '6 days',
    365000.00,
    120000.00,
    40000.00,
    160000.00,
    12,
    326,
    0.6718,
    250000.00,
    0.6400
  ),
  (
    '0x1111111111111111111111111111111111111111',
    NOW() - INTERVAL '5 days',
    370000.00,
    122000.00,
    42000.00,
    164000.00,
    12,
    328,
    0.6738,
    250000.00,
    0.6560
  ),

  -- Insider's snapshots
  (
    '0x2222222222222222222222222222222222222222',
    NOW() - INTERVAL '7 days',
    118000.00,
    92000.00,
    8000.00,
    100000.00,
    5,
    82,
    0.8415,
    80000.00,
    1.2500
  ),
  (
    '0x2222222222222222222222222222222222222222',
    NOW() - INTERVAL '6 days',
    120000.00,
    94000.00,
    10000.00,
    104000.00,
    5,
    83,
    0.8494,
    80000.00,
    1.3000
  );

-- =====================================================================
-- Insert Sample Market Holders
-- =====================================================================

INSERT INTO market_holders (
  market_id,
  condition_id,
  wallet_address,
  outcome,
  shares,
  position_value_usd,
  market_share_percentage,
  rank,
  last_updated
) VALUES
  -- Bitcoin $100k market
  (
    '0xmarket001',
    '0xcond001',
    '0x1111111111111111111111111111111111111111',
    'YES',
    50000.00,
    36000.00,
    0.0875,  -- 8.75% of total supply
    1,
    NOW() - INTERVAL '10 minutes'
  ),
  (
    '0xmarket001',
    '0xcond001',
    '0x2222222222222222222222222222222222222222',
    'YES',
    25000.00,
    18000.00,
    0.0437,  -- 4.37%
    2,
    NOW() - INTERVAL '10 minutes'
  ),
  (
    '0xmarket001',
    '0xcond001',
    '0x3333333333333333333333333333333333333333',
    'YES',
    15000.00,
    10800.00,
    0.0262,  -- 2.62%
    3,
    NOW() - INTERVAL '10 minutes'
  );

-- =====================================================================
-- Insert Sample Whale Activity
-- =====================================================================

INSERT INTO whale_activity_log (
  wallet_address,
  wallet_alias,
  activity_type,
  market_id,
  market_title,
  side,
  outcome,
  shares,
  price,
  amount_usd,
  impact_score,
  occurred_at
) VALUES
  -- Recent whale trade
  (
    '0x1111111111111111111111111111111111111111',
    'Crypto Whale',
    'TRADE',
    '0xmarket002',
    'Will Ethereum reach $10k in 2025?',
    'BUY',
    'YES',
    80000.00,
    0.45,
    36000.00,
    78.5,
    NOW() - INTERVAL '30 days'
  ),

  -- Insider's suspicious early trade
  (
    '0x2222222222222222222222222222222222222222',
    'Early Bird',
    'TRADE',
    '0xmarket003',
    'Will Trump win the 2024 election?',
    'BUY',
    'YES',
    100000.00,
    0.42,
    42000.00,
    95.2,  -- Very high impact (insider signal?)
    NOW() - INTERVAL '75 days'
  ),

  -- Position flip (whale changed their mind)
  (
    '0x1111111111111111111111111111111111111111',
    'Crypto Whale',
    'POSITION_FLIP',
    '0xmarket001',
    'Will Bitcoin reach $100k by Dec 2025?',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    82.3,
    NOW() - INTERVAL '15 days'
  );

-- =====================================================================
-- Verification Queries
-- =====================================================================

-- Check inserted data
SELECT 'Wallets' as table_name, COUNT(*) as row_count FROM wallets
UNION ALL
SELECT 'Wallet Positions', COUNT(*) FROM wallet_positions
UNION ALL
SELECT 'Wallet Trades', COUNT(*) FROM wallet_trades
UNION ALL
SELECT 'Closed Positions', COUNT(*) FROM wallet_closed_positions
UNION ALL
SELECT 'PnL Snapshots', COUNT(*) FROM wallet_pnl_snapshots
UNION ALL
SELECT 'Market Holders', COUNT(*) FROM market_holders
UNION ALL
SELECT 'Whale Activity', COUNT(*) FROM whale_activity_log;

-- Test helper functions
SELECT '=== Testing Helper Functions ===' as info;

-- Test calculate_wallet_win_rate
SELECT
  'calculate_wallet_win_rate' as function_name,
  calculate_wallet_win_rate('0x1111111111111111111111111111111111111111') as whale_win_rate,
  calculate_wallet_win_rate('0x2222222222222222222222222222222222222222') as insider_win_rate;

-- Test get_top_whales
SELECT
  'get_top_whales' as function_name,
  COUNT(*) as result_count
FROM get_top_whales(10);

-- Test get_suspected_insiders
SELECT
  'get_suspected_insiders' as function_name,
  COUNT(*) as result_count
FROM get_suspected_insiders(10);

-- Test get_recent_whale_activity
SELECT
  'get_recent_whale_activity' as function_name,
  COUNT(*) as result_count
FROM get_recent_whale_activity(24, 100);

-- =====================================================================
-- Sample Queries for Testing
-- =====================================================================

-- Get whale leaderboard
SELECT
  wallet_address,
  wallet_alias,
  whale_score,
  total_volume_usd,
  total_pnl_usd,
  win_rate
FROM wallets
WHERE is_whale = TRUE
ORDER BY whale_score DESC;

-- Get insider suspects
SELECT
  wallet_address,
  wallet_alias,
  insider_score,
  win_rate,
  total_trades
FROM wallets
WHERE is_suspected_insider = TRUE
ORDER BY insider_score DESC;

-- Get wallet detail
SELECT
  w.wallet_alias,
  w.total_pnl_usd,
  w.win_rate,
  w.active_positions_count,
  COUNT(DISTINCT wp.market_id) as unique_markets,
  SUM(wp.unrealized_pnl_usd) as total_unrealized_pnl
FROM wallets w
LEFT JOIN wallet_positions wp ON w.wallet_address = wp.wallet_address
WHERE w.wallet_address = '0x1111111111111111111111111111111111111111'
GROUP BY w.wallet_address, w.wallet_alias, w.total_pnl_usd, w.win_rate, w.active_positions_count;

-- Get market whale concentration
SELECT
  market_id,
  COUNT(*) as total_holders,
  SUM(market_share_percentage) FILTER (WHERE w.is_whale = TRUE) as whale_concentration
FROM market_holders mh
JOIN wallets w ON mh.wallet_address = w.wallet_address
WHERE market_id = '0xmarket001'
GROUP BY market_id;

-- =====================================================================
-- Success Message
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Sample test data inserted successfully!';
  RAISE NOTICE 'Tables populated: wallets (3), positions (3), trades (4), closed (2)';
  RAISE NOTICE 'PnL snapshots (5), holders (3), whale activity (3)';
  RAISE NOTICE 'Ready for testing wallet analytics features!';
END $$;
