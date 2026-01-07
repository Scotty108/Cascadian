-- Find Best Wallets for Equal-Weight $1 Copy Trading
-- Based on the Platinum 12 selection criteria
--
-- Core insight: For equal-weight copy trading to profit:
--   Asymmetry > (1 - WinRate) / WinRate
-- Using Asymmetry > 4 gives safety margin across all win rates (11% to 94%)

SELECT
  wallet_address,

  -- Core metrics
  win_rate,
  avg_win_pct,
  avg_loss_pct,

  -- ASYMMETRY: The key metric (avg_win / avg_loss)
  -- Higher = bigger wins relative to losses
  avg_win_pct / nullIf(avg_loss_pct, 0) AS asymmetry,

  -- EV per $1 trade (what you'd make per trade at equal weight)
  (win_rate * avg_win_pct) - ((1 - win_rate) * avg_loss_pct) AS ev_per_trade,

  -- Activity
  days_active,
  total_trades,
  total_trades / nullIf(days_active, 0) AS trades_per_day,

  -- Edge ratio (>1.0 means profitable at equal weight)
  edge_ratio,

  -- Quality flags
  is_copyable,
  is_phantom,
  realized_pnl

FROM pm_copy_trading_metrics_v1 FINAL

WHERE
  -- FILTER 1: Asymmetry > 4 (safety margin for all win rates)
  avg_win_pct / nullIf(avg_loss_pct, 0) > 4

  -- FILTER 2: Positive expected value at equal weight
  AND (win_rate * avg_win_pct) > ((1 - win_rate) * avg_loss_pct)

  -- FILTER 3: Active for 30+ days (not a lucky streak)
  AND days_active >= 30

  -- FILTER 4: Copyable frequency (not too slow, not arb/MM)
  AND total_trades / nullIf(days_active, 0) BETWEEN 0.1 AND 50

  -- FILTER 5: Not a phantom wallet (no external token sources)
  AND is_phantom = 0

  -- FILTER 6: Enough resolved positions for statistical significance
  AND resolved_positions >= 50

ORDER BY ev_per_trade DESC
LIMIT 100;


-- =============================================================================
-- SIMPLER VERSION: Just find asymmetry > 4 wallets with activity
-- =============================================================================

-- SELECT
--   wallet_address,
--   win_rate,
--   avg_win_pct / nullIf(avg_loss_pct, 0) AS asymmetry,
--   (win_rate * avg_win_pct) - ((1 - win_rate) * avg_loss_pct) AS ev_per_trade,
--   days_active,
--   total_trades / nullIf(days_active, 0) AS trades_per_day,
--   realized_pnl
-- FROM pm_copy_trading_metrics_v1 FINAL
-- WHERE avg_win_pct / nullIf(avg_loss_pct, 0) > 4
--   AND days_active >= 30
--   AND is_phantom = 0
-- ORDER BY ev_per_trade DESC
-- LIMIT 50;
