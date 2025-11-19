-- ============================================================================
-- vw_wallet_leaderboard_v2: Wallet Leaderboard View (Read-only)
-- ============================================================================
-- Purpose: Optimized view for leaderboard UI and API consumption
--          Sits directly on top of pm_wallet_summary_v2
--
-- Primary Access Patterns:
--   1. Top wallets by total_pnl_usd DESC (leaderboard)
--   2. Top wallets by total_volume_usd DESC (volume leaders)
--   3. Filtered to profitable wallets only
--
-- Performance:
--   - Target: < 200ms for top 100 queries
--   - Base table indexed by wallet_address (fast lookups)
--   - No additional materialization needed for typical queries
--
-- Note: Ranking (pnl_rank_desc) is omitted to avoid expensive window functions.
--       Compute rank on the application side using LIMIT/OFFSET for pagination.
-- ============================================================================

CREATE VIEW IF NOT EXISTS vw_wallet_leaderboard_v2 AS
SELECT
  -- Identifiers
  wallet_address,

  -- P&L metrics
  total_pnl_usd,
  realized_pnl_usd,
  unrealized_pnl_usd,
  settlement_pnl_usd,

  -- Trade volume
  total_trades,
  total_markets,
  total_volume_usd,

  -- Performance metrics
  win_rate,
  avg_pnl_per_market,
  avg_pnl_per_trade,
  max_profit_usd,
  max_loss_usd,

  -- Temporal
  days_active,
  first_trade_at,
  last_trade_at,

  -- Position counts
  open_positions,
  closed_positions,
  resolved_positions,

  -- Derived columns
  CASE WHEN total_pnl_usd > 0 THEN 1 ELSE 0 END AS is_profitable,

  -- Metadata (useful for API versioning)
  created_at,
  updated_at

FROM pm_wallet_summary_v2;

-- ============================================================================
-- Example Queries
-- ============================================================================
--
-- Top 100 by P&L (leaderboard):
-- SELECT * FROM vw_wallet_leaderboard_v2
-- ORDER BY total_pnl_usd DESC
-- LIMIT 100;
--
-- Top 100 profitable wallets only:
-- SELECT * FROM vw_wallet_leaderboard_v2
-- WHERE is_profitable = 1
-- ORDER BY total_pnl_usd DESC
-- LIMIT 100;
--
-- Top 100 by volume:
-- SELECT * FROM vw_wallet_leaderboard_v2
-- ORDER BY total_volume_usd DESC
-- LIMIT 100;
--
-- Leaderboard page 2 (offset 100):
-- SELECT * FROM vw_wallet_leaderboard_v2
-- ORDER BY total_pnl_usd DESC
-- LIMIT 100 OFFSET 100;
--
-- Get specific wallet:
-- SELECT * FROM vw_wallet_leaderboard_v2
-- WHERE wallet_address = '0x...';
