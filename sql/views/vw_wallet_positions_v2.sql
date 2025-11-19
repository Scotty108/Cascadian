-- ============================================================================
-- vw_wallet_positions_v2: Wallet Positions View (Read-only)
-- ============================================================================
-- Purpose: Optimized view for wallet detail pages showing all positions
--          Sits directly on top of pm_wallet_market_pnl_v2
--
-- Primary Access Pattern:
--   WHERE wallet_address = ? ORDER BY ABS(total_pnl_usd) DESC
--
-- Performance:
--   - Target: < 50ms for single wallet queries
--   - Base table indexed by (wallet_address, condition_id_norm, outcome_index)
--   - Fast wallet lookups due to composite key
--
-- Use Cases:
--   - Wallet detail page showing all positions
--   - Position history for a specific wallet
--   - Open positions monitoring
-- ============================================================================

CREATE VIEW IF NOT EXISTS vw_wallet_positions_v2 AS
SELECT
  -- Identifiers
  wallet_address,
  condition_id_norm,
  outcome_index,

  -- Optional market metadata
  market_id_norm,

  -- Trade counts
  total_trades,
  buy_trades,
  sell_trades,

  -- Position metrics
  total_bought_shares,
  total_sold_shares,
  final_position_size,

  -- Cost basis
  total_cost_usd,
  total_proceeds_usd,
  avg_entry_price,
  avg_exit_price,

  -- P&L components
  realized_pnl_usd,
  unrealized_pnl_usd,
  settlement_pnl_usd,
  total_pnl_usd,

  -- Resolution status
  is_resolved,
  resolved_at,
  winning_outcome,
  payout_per_share,

  -- Current market price (for unrealized P&L - currently null)
  current_market_price,
  price_updated_at,

  -- Coverage tracking
  covered_volume_usd,
  orphan_volume_usd,
  coverage_pct,

  -- Temporal
  first_trade_at,
  last_trade_at,

  -- Derived columns
  CASE WHEN final_position_size != 0 THEN 1 ELSE 0 END AS is_open_position,

  -- Metadata
  created_at,
  updated_at

FROM pm_wallet_market_pnl_v2;

-- ============================================================================
-- Example Queries
-- ============================================================================
--
-- All positions for a wallet (by absolute P&L):
-- SELECT * FROM vw_wallet_positions_v2
-- WHERE wallet_address = '0x...'
-- ORDER BY abs(total_pnl_usd) DESC;
--
-- Open positions only:
-- SELECT * FROM vw_wallet_positions_v2
-- WHERE wallet_address = '0x...'
--   AND is_open_position = 1
-- ORDER BY abs(total_pnl_usd) DESC;
--
-- Profitable positions only:
-- SELECT * FROM vw_wallet_positions_v2
-- WHERE wallet_address = '0x...'
--   AND total_pnl_usd > 0
-- ORDER BY total_pnl_usd DESC;
--
-- Recent positions (last 30 days):
-- SELECT * FROM vw_wallet_positions_v2
-- WHERE wallet_address = '0x...'
--   AND last_trade_at >= now() - INTERVAL 30 DAY
-- ORDER BY last_trade_at DESC;
--
-- Specific position detail:
-- SELECT * FROM vw_wallet_positions_v2
-- WHERE wallet_address = '0x...'
--   AND condition_id_norm = '...'
--   AND outcome_index = 0;
