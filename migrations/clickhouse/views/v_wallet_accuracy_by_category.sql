-- Wallet Accuracy by Category View (PLACEHOLDER - DO NOT APPLY UNTIL PHASE 2)
--
-- PURPOSE:
-- Shows wallet performance rankings within each category (Politics, Sports, Crypto, etc.).
-- Helps identify category specialists - wallets that excel in specific domains.
--
-- DEPENDENCIES:
-- - wallet_metrics table with category-specific rows
-- - Requires per-category metrics to be computed
--
-- USAGE:
-- SELECT * FROM v_wallet_accuracy_by_category
-- WHERE category = 'Politics' AND rank_in_category <= 25;

CREATE OR REPLACE VIEW v_wallet_accuracy_by_category AS
SELECT
  wallet_address,
  category,

  -- Accuracy & Performance
  accuracy_pct AS category_accuracy_pct,
  total_pnl AS category_pnl_usd,
  roi_pct AS category_roi_pct,

  -- Risk-Adjusted
  sharpe_ratio AS category_sharpe_ratio,
  omega_ratio AS category_omega_ratio,

  -- Volume & Activity
  total_volume AS category_volume_usd,
  total_trades AS category_trade_count,
  avg_trade_size AS category_avg_position_size_usd,

  -- Behavioral
  avg_hold_time_hours AS category_avg_hold_time_hours,
  markets_traded AS category_total_markets,

  -- Rankings within category
  rank() OVER (
    PARTITION BY category
    ORDER BY accuracy_pct DESC
  ) AS rank_accuracy_in_category,

  rank() OVER (
    PARTITION BY category
    ORDER BY roi_pct DESC
  ) AS rank_roi_in_category,

  rank() OVER (
    PARTITION BY category
    ORDER BY sharpe_ratio DESC
  ) AS rank_sharpe_in_category,

  rank() OVER (
    PARTITION BY category
    ORDER BY total_volume DESC
  ) AS rank_volume_in_category,

  -- Computed timestamp
  computed_at

FROM wallet_metrics
WHERE
  time_window = 'lifetime'
  AND category != 'all'  -- Only category-specific rows
  AND total_trades >= 10  -- Minimum trades for significance
ORDER BY category, accuracy_pct DESC;
