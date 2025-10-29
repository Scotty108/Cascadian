-- Top Wallets View (PLACEHOLDER - DO NOT APPLY UNTIL PHASE 2)
--
-- PURPOSE:
-- Leaderboard view showing top wallets ranked by various metrics.
-- Includes rankings by ROI, Sharpe, total P&L, accuracy, and volume.
--
-- DEPENDENCIES:
-- - wallet_metrics table (from Phase 2 compute scripts)
-- - Requires metrics to be computed first
--
-- USAGE:
-- SELECT * FROM v_top_wallets WHERE rank_roi <= 100;

CREATE OR REPLACE VIEW v_top_wallets AS
SELECT
  wallet_address,

  -- P&L Metrics
  total_pnl AS total_pnl_usd,
  roi_pct,
  profit_factor,

  -- Risk-Adjusted Returns
  sharpe_ratio,
  sortino_ratio,
  omega_ratio,

  -- Accuracy
  accuracy_pct AS resolution_accuracy_pct,

  -- Volume & Activity
  total_volume AS total_volume_usd,
  total_trades,
  avg_trade_size AS avg_trade_size_usd,

  -- Risk
  max_drawdown_pct,
  volatility AS volatility_annualized,

  -- Rankings (ordered by each metric)
  rank() OVER (ORDER BY roi_pct DESC) AS rank_roi,
  rank() OVER (ORDER BY sharpe_ratio DESC) AS rank_sharpe,
  rank() OVER (ORDER BY total_pnl DESC) AS rank_pnl,
  rank() OVER (ORDER BY accuracy_pct DESC) AS rank_accuracy,
  rank() OVER (ORDER BY total_volume DESC) AS rank_volume,

  -- Computed timestamp
  computed_at

FROM wallet_metrics
WHERE
  time_window = 'lifetime'
  AND category = 'all'
  AND total_trades >= 10  -- Minimum significance threshold
ORDER BY roi_pct DESC
LIMIT 1000;
