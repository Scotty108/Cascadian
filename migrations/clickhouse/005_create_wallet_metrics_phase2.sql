-- Migration: Create wallet_metrics materialized table
-- Purpose: Store per-wallet performance metrics across multiple time windows
-- Engine: ReplacingMergeTree with version field for idempotent updates
-- Created: 2025-11-11

CREATE TABLE IF NOT EXISTS default.wallet_metrics (
  -- Wallet identification
  wallet_address String NOT NULL,

  -- Time window for aggregation
  time_window Enum8(
    '30d' = 1,
    '90d' = 2,
    '180d' = 3,
    'lifetime' = 4
  ) NOT NULL,

  -- Core performance metrics
  realized_pnl Float64 DEFAULT 0,           -- Sum of cashflows from executed trades
  unrealized_payout Float64 DEFAULT 0,      -- Current value from unresolved positions
  roi_pct Float64 DEFAULT 0,                -- Return on investment percentage
  win_rate Float64 DEFAULT 0,               -- Fraction of profitable markets [0, 1]

  -- Risk-adjusted metrics
  sharpe_ratio Float64 DEFAULT 0,           -- Annualized return / volatility
  omega_ratio Float64 DEFAULT 0,            -- Sum(gains) / Sum(losses)
  max_drawdown Float64 DEFAULT 0,           -- Peak-to-trough decline
  volatility Float64 DEFAULT 0,             -- Daily P&L standard deviation

  -- Activity metrics
  total_trades UInt32 DEFAULT 0,            -- Total number of trades
  markets_traded UInt32 DEFAULT 0,          -- Unique markets traded in
  avg_trade_size Float64 DEFAULT 0,         -- Average USDC per trade

  -- Metadata
  calculated_at DateTime DEFAULT now(),     -- When metrics were calculated
  updated_at DateTime DEFAULT now()         -- Version timestamp for ReplacingMergeTree
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, time_window)
PARTITION BY time_window
PRIMARY KEY (wallet_address, time_window)
SETTINGS
  index_granularity = 8192,
  index_granularity_bytes = 10485760,  -- 10 MB
  min_rows_to_keep = 1000000,
  min_bytes_to_keep = 1073741824        -- 1 GB
;

-- Create comment describing table purpose
ALTER TABLE default.wallet_metrics COMMENT = 'Per-wallet performance metrics across time windows (30d, 90d, 180d, lifetime) for leaderboard ranking and wallet analytics';

-- Create comment for each metric column
ALTER TABLE default.wallet_metrics MODIFY COLUMN realized_pnl COMMENT 'Sum of cashflows from trades (positive = net profit)';
ALTER TABLE default.wallet_metrics MODIFY COLUMN unrealized_payout COMMENT 'Current position value from market resolutions';
ALTER TABLE default.wallet_metrics MODIFY COLUMN roi_pct COMMENT 'Return on investment percentage, range [-100%, ∞)';
ALTER TABLE default.wallet_metrics MODIFY COLUMN win_rate COMMENT 'Fraction of resolved markets with positive P&L, range [0, 1]';
ALTER TABLE default.wallet_metrics MODIFY COLUMN sharpe_ratio COMMENT 'Risk-adjusted return: (mean daily P&L) / (volatility) × sqrt(252)';
ALTER TABLE default.wallet_metrics MODIFY COLUMN omega_ratio COMMENT 'Upside/downside ratio: sum(gains) / sum(losses), NULL if no losses';
ALTER TABLE default.wallet_metrics MODIFY COLUMN max_drawdown COMMENT 'Maximum percentage decline from peak to trough';
ALTER TABLE default.wallet_metrics MODIFY COLUMN volatility COMMENT 'Standard deviation of daily P&L changes';
ALTER TABLE default.wallet_metrics MODIFY COLUMN total_trades COMMENT 'Total trade count in period (buy/sell actions)';
ALTER TABLE default.wallet_metrics MODIFY COLUMN markets_traded COMMENT 'Count of unique condition_ids traded';
ALTER TABLE default.wallet_metrics MODIFY COLUMN avg_trade_size COMMENT 'Average USDC amount per trade';
ALTER TABLE default.wallet_metrics MODIFY COLUMN wallet_address COMMENT 'Wallet address (checksummed Ethereum address)';
ALTER TABLE default.wallet_metrics MODIFY COLUMN time_window COMMENT 'Aggregation window: 30d (30 days), 90d (90 days), 180d (180 days), lifetime (all-time)';
