-- Example Queries: Polymarket Global Indexer
--
-- Common query patterns for pm_positions_indexer and pm_wallet_pnl_indexer
-- Author: C1
-- Date: 2025-11-15

-- =============================================================================
-- 1. WALLET PORTFOLIO QUERIES
-- =============================================================================

-- Get all active positions for a wallet
SELECT
  condition_id,
  outcome_index,
  amount / 1e18 as shares,
  avg_price / 1e6 as entry_price,
  realized_pnl / 1e6 as realized_pnl_usd,
  total_bought / 1e18 as total_bought_shares,
  last_synced_at
FROM pm_positions_indexer FINAL
WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND ABS(amount) > 0  -- Only non-zero positions
ORDER BY last_synced_at DESC;

-- Wallet portfolio summary (aggregated)
SELECT
  condition_id,
  SUM(amount) / 1e18 as total_shares,
  SUM(amount * avg_price) / SUM(amount) / 1e6 as avg_entry_price,
  SUM(realized_pnl) / 1e6 as total_realized_pnl_usd,
  SUM(total_bought) / 1e18 as total_volume_shares,
  MAX(last_synced_at) as last_updated
FROM pm_positions_indexer FINAL
WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
GROUP BY condition_id
ORDER BY total_realized_pnl_usd DESC;

-- Wallet performance summary
SELECT
  wallet_address,
  total_realized_pnl_usd,
  win_rate,
  distinct_markets,
  total_volume_shares,
  winning_positions,
  losing_positions,
  avg_position_size_shares,
  last_updated_at
FROM pm_wallet_pnl_summary_indexer
WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

-- =============================================================================
-- 2. LEADERBOARD QUERIES
-- =============================================================================

-- Global leaderboard: Top 100 wallets by realized P&L
SELECT
  wallet_address,
  total_realized_pnl_usd,
  win_rate,
  distinct_markets,
  total_volume_shares,
  winning_positions,
  losing_positions
FROM pm_wallet_pnl_summary_indexer
WHERE distinct_markets >= 10  -- Minimum market threshold
  AND (winning_positions + losing_positions) >= 20  -- Minimum positions
ORDER BY total_realized_pnl_usd DESC
LIMIT 100;

-- Leaderboard by win rate (min 50 positions)
SELECT
  wallet_address,
  win_rate,
  winning_positions,
  losing_positions,
  total_realized_pnl_usd,
  distinct_markets
FROM pm_wallet_pnl_summary_indexer
WHERE (winning_positions + losing_positions) >= 50
ORDER BY win_rate DESC
LIMIT 100;

-- Leaderboard by volume (whales)
SELECT
  wallet_address,
  total_volume_shares,
  total_realized_pnl_usd,
  win_rate,
  distinct_markets,
  avg_position_size_shares
FROM pm_wallet_pnl_summary_indexer
WHERE total_volume_shares >= 1000  -- Minimum $1000 volume
ORDER BY total_volume_shares DESC
LIMIT 100;

-- Most active traders (by position count)
SELECT
  wallet_address,
  total_positions,
  distinct_markets,
  total_realized_pnl_usd,
  win_rate,
  last_updated_at
FROM pm_wallet_pnl_summary_indexer
ORDER BY total_positions DESC
LIMIT 100;

-- =============================================================================
-- 3. MARKET PARTICIPANT QUERIES
-- =============================================================================

-- Get all wallets trading a specific condition
SELECT
  wallet_address,
  outcome_index,
  amount / 1e18 as shares,
  avg_price / 1e6 as entry_price,
  realized_pnl / 1e6 as realized_pnl_usd,
  last_synced_at
FROM pm_positions_indexer FINAL
WHERE condition_id = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
  AND ABS(amount) > 1e15  -- Minimum 0.001 shares
ORDER BY ABS(amount) DESC;

-- Market exposure by outcome
SELECT
  outcome_index,
  COUNT(DISTINCT wallet_address) as participant_count,
  SUM(amount) / 1e18 as total_net_shares,
  SUM(ABS(amount)) / 1e18 as total_absolute_shares,
  SUM(realized_pnl) / 1e6 as total_realized_pnl_usd,
  AVG(avg_price) / 1e6 as avg_entry_price
FROM pm_positions_indexer FINAL
WHERE condition_id = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
GROUP BY outcome_index
ORDER BY outcome_index;

-- Top 10 largest positions in a market
SELECT
  wallet_address,
  outcome_index,
  amount / 1e18 as shares,
  avg_price / 1e6 as entry_price,
  realized_pnl / 1e6 as realized_pnl_usd,
  (amount * avg_price) / 1e24 as position_value_usd
FROM pm_positions_indexer FINAL
WHERE condition_id = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
ORDER BY ABS(amount) DESC
LIMIT 10;

-- =============================================================================
-- 4. DISCOVERY & ANALYTICS QUERIES
-- =============================================================================

-- Recently updated positions (last 1 hour)
SELECT
  wallet_address,
  condition_id,
  outcome_index,
  amount / 1e18 as shares,
  realized_pnl / 1e6 as realized_pnl_usd,
  last_synced_at
FROM pm_positions_indexer FINAL
WHERE last_synced_at > now() - INTERVAL 1 HOUR
ORDER BY last_synced_at DESC
LIMIT 100;

-- Wallets with largest unrealized positions (current exposure)
SELECT
  wallet_address,
  condition_id,
  outcome_index,
  amount / 1e18 as shares,
  (amount * avg_price) / 1e24 as position_value_usd,
  avg_price / 1e6 as entry_price
FROM pm_positions_indexer FINAL
WHERE ABS(amount) > 1e18  -- Minimum 1 share
ORDER BY ABS(amount * avg_price) DESC
LIMIT 100;

-- Distribution of wallet profitability
SELECT
  CASE
    WHEN total_realized_pnl_usd > 1000 THEN '> $1000'
    WHEN total_realized_pnl_usd > 100 THEN '$100-$1000'
    WHEN total_realized_pnl_usd > 0 THEN '$0-$100'
    WHEN total_realized_pnl_usd > -100 THEN '-$100-$0'
    WHEN total_realized_pnl_usd > -1000 THEN '-$1000--$100'
    ELSE '< -$1000'
  END as pnl_bucket,
  COUNT(*) as wallet_count,
  SUM(total_realized_pnl_usd) as total_pnl_usd
FROM pm_wallet_pnl_summary_indexer
GROUP BY pnl_bucket
ORDER BY
  CASE pnl_bucket
    WHEN '> $1000' THEN 1
    WHEN '$100-$1000' THEN 2
    WHEN '$0-$100' THEN 3
    WHEN '-$100-$0' THEN 4
    WHEN '-$1000--$100' THEN 5
    ELSE 6
  END;

-- Win rate distribution
SELECT
  CASE
    WHEN win_rate >= 0.9 THEN '90-100%'
    WHEN win_rate >= 0.8 THEN '80-90%'
    WHEN win_rate >= 0.7 THEN '70-80%'
    WHEN win_rate >= 0.6 THEN '60-70%'
    WHEN win_rate >= 0.5 THEN '50-60%'
    ELSE '< 50%'
  END as win_rate_bucket,
  COUNT(*) as wallet_count,
  AVG(total_realized_pnl_usd) as avg_pnl_usd
FROM pm_wallet_pnl_summary_indexer
WHERE (winning_positions + losing_positions) >= 10  -- Minimum sample size
GROUP BY win_rate_bucket
ORDER BY
  CASE win_rate_bucket
    WHEN '90-100%' THEN 1
    WHEN '80-90%' THEN 2
    WHEN '70-80%' THEN 3
    WHEN '60-70%' THEN 4
    WHEN '50-60%' THEN 5
    ELSE 6
  END;

-- =============================================================================
-- 5. RECONCILIATION & VALIDATION QUERIES
-- =============================================================================

-- Compare indexer P&L vs existing C2 Data API P&L (ghost cohort)
WITH ghost_wallets AS (
  -- Wallets we have in existing system
  SELECT DISTINCT wallet_address
  FROM pm_wallet_market_pnl_resolved
),
indexer_pnl AS (
  SELECT
    wallet_address,
    total_realized_pnl_usd as indexer_pnl
  FROM pm_wallet_pnl_summary_indexer
  WHERE wallet_address IN (SELECT wallet_address FROM ghost_wallets)
),
existing_pnl AS (
  SELECT
    wallet_address,
    SUM(pnl_net) as existing_pnl
  FROM pm_wallet_market_pnl_resolved
  GROUP BY wallet_address
)
SELECT
  COALESCE(i.wallet_address, e.wallet_address) as wallet_address,
  i.indexer_pnl,
  e.existing_pnl,
  i.indexer_pnl - e.existing_pnl as delta,
  CASE
    WHEN e.existing_pnl = 0 THEN NULL
    ELSE ABS(i.indexer_pnl - e.existing_pnl) / ABS(e.existing_pnl)
  END as delta_pct,
  CASE
    WHEN ABS(i.indexer_pnl - e.existing_pnl) > 100 THEN '⚠️ Large Delta'
    WHEN ABS((i.indexer_pnl - e.existing_pnl) / NULLIF(e.existing_pnl, 0)) > 0.1 THEN '⚠️ > 10% Diff'
    ELSE '✅ Match'
  END as status
FROM indexer_pnl i
FULL OUTER JOIN existing_pnl e ON i.wallet_address = e.wallet_address
ORDER BY ABS(delta) DESC
LIMIT 100;

-- Validate token ID decoding (check for anomalies)
SELECT
  token_id,
  condition_id,
  outcome_index,
  length(condition_id) as cid_length,
  CASE
    WHEN length(condition_id) != 64 THEN '❌ Invalid length'
    WHEN outcome_index > 10 THEN '⚠️ High outcome index'
    ELSE '✅ Valid'
  END as validation_status
FROM pm_positions_indexer
WHERE length(condition_id) != 64
   OR outcome_index > 10
LIMIT 100;

-- Data freshness check
SELECT
  toStartOfHour(last_synced_at) as hour,
  COUNT(*) as positions_synced,
  COUNT(DISTINCT wallet_address) as wallets_synced,
  COUNT(DISTINCT condition_id) as markets_synced
FROM pm_positions_indexer
WHERE last_synced_at > now() - INTERVAL 24 HOUR
GROUP BY hour
ORDER BY hour DESC;

-- =============================================================================
-- 6. MONITORING & HEALTH QUERIES
-- =============================================================================

-- Overall statistics
SELECT
  COUNT(*) as total_positions,
  COUNT(DISTINCT wallet_address) as total_wallets,
  COUNT(DISTINCT condition_id) as total_markets,
  SUM(realized_pnl) / 1e6 as total_realized_pnl_usd,
  SUM(total_bought) / 1e18 as total_volume_shares,
  MIN(last_synced_at) as oldest_sync,
  MAX(last_synced_at) as newest_sync,
  AVG(realized_pnl) / 1e6 as avg_pnl_per_position
FROM pm_positions_indexer FINAL;

-- Position size distribution
SELECT
  CASE
    WHEN amount >= 1e20 THEN '> 100 shares'
    WHEN amount >= 1e19 THEN '10-100 shares'
    WHEN amount >= 1e18 THEN '1-10 shares'
    WHEN amount >= 1e17 THEN '0.1-1 shares'
    WHEN amount >= 1e16 THEN '0.01-0.1 shares'
    ELSE '< 0.01 shares'
  END as size_bucket,
  COUNT(*) as position_count,
  SUM(realized_pnl) / 1e6 as total_pnl_usd
FROM pm_positions_indexer FINAL
WHERE amount > 0
GROUP BY size_bucket
ORDER BY
  CASE size_bucket
    WHEN '> 100 shares' THEN 1
    WHEN '10-100 shares' THEN 2
    WHEN '1-10 shares' THEN 3
    WHEN '0.1-1 shares' THEN 4
    WHEN '0.01-0.1 shares' THEN 5
    ELSE 6
  END;

-- Ingestion lag detection
SELECT
  wallet_address,
  condition_id,
  outcome_index,
  last_synced_at,
  now() - last_synced_at as lag_seconds
FROM pm_positions_indexer FINAL
WHERE last_synced_at < now() - INTERVAL 1 HOUR
ORDER BY lag_seconds DESC
LIMIT 100;

-- Duplicate detection (should be zero after FINAL)
SELECT
  composite_id,
  COUNT(*) as duplicate_count
FROM pm_positions_indexer
GROUP BY composite_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 100;
