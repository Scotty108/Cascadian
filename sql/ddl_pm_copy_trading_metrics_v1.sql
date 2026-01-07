-- Copy Trading Metrics Cache Table
-- Stores pre-computed metrics for copy trading leaderboard
-- Run overnight to have instant queries in the morning

CREATE TABLE IF NOT EXISTS pm_copy_trading_metrics_v1 (
  -- Identity
  wallet_address String,

  -- Core PnL metrics (from CCR-v1)
  realized_pnl Float64,
  total_pnl Float64,
  volume_usd Float64,

  -- Trade counts
  total_trades UInt32,
  positions_count UInt32,
  resolved_positions UInt32,
  unresolved_positions UInt32,

  -- Win/Loss metrics
  win_count UInt32,
  loss_count UInt32,
  win_rate Float64,

  -- Position-level percentage metrics (NEW for equal-weight analysis)
  avg_win_pct Float64,      -- Average % gain on winning positions
  avg_loss_pct Float64,     -- Average % loss on losing positions (positive number)

  -- Edge ratio (key metric for equal-weight copyability)
  breakeven_wr Float64,     -- Required win rate to break even: avg_loss / (avg_win + avg_loss)
  edge_ratio Float64,       -- actual_win_rate / breakeven_wr (>1.0 = profitable at equal weight)

  -- Phantom detection
  is_phantom UInt8,         -- 1 if wallet has external token sources (sold > bought)
  phantom_tokens Float64,   -- Number of phantom tokens detected

  -- Copyability assessment
  is_copyable UInt8,        -- 1 if suitable for equal-weight copy trading

  -- Data quality
  pnl_confidence String,    -- 'high', 'medium', 'low'
  external_sell_ratio Float64,

  -- Temporal
  first_trade DateTime,
  last_trade DateTime,
  days_active UInt32,

  -- Metadata
  computed_at DateTime DEFAULT now(),
  version UInt64 DEFAULT toUnixTimestamp(now())
)
ENGINE = ReplacingMergeTree(version)
ORDER BY wallet_address
SETTINGS index_granularity = 8192;

-- Create indexes for common queries
ALTER TABLE pm_copy_trading_metrics_v1 ADD INDEX idx_edge_ratio (edge_ratio) TYPE minmax GRANULARITY 1;
ALTER TABLE pm_copy_trading_metrics_v1 ADD INDEX idx_is_copyable (is_copyable) TYPE set(2) GRANULARITY 1;
ALTER TABLE pm_copy_trading_metrics_v1 ADD INDEX idx_realized_pnl (realized_pnl) TYPE minmax GRANULARITY 1;

-- View for easy querying of copyable wallets
CREATE OR REPLACE VIEW vw_copyable_wallets AS
SELECT
  wallet_address,
  realized_pnl,
  win_rate,
  avg_win_pct,
  avg_loss_pct,
  edge_ratio,
  resolved_positions,
  is_phantom
FROM pm_copy_trading_metrics_v1 FINAL
WHERE is_copyable = 1
  AND resolved_positions >= 10
ORDER BY edge_ratio DESC;
