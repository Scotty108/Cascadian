-- ============================================================================
-- ClickHouse Schema Extension for Phase 1 Metrics
-- Adds fields needed to calculate Austin's 102 metrics
-- ============================================================================

-- Add metric-related columns to trades_raw table
ALTER TABLE trades_raw
  ADD COLUMN IF NOT EXISTS close_price DECIMAL(10, 6) DEFAULT 0.0 COMMENT 'YES price at pre-resolution close (for CLV calculation)',
  ADD COLUMN IF NOT EXISTS fee_usd DECIMAL(18, 6) DEFAULT 0.0 COMMENT 'Total fees paid on this trade',
  ADD COLUMN IF NOT EXISTS slippage_usd DECIMAL(18, 6) DEFAULT 0.0 COMMENT 'Slippage cost (fill price vs mid)',
  ADD COLUMN IF NOT EXISTS hours_held DECIMAL(10, 2) DEFAULT 0.0 COMMENT 'Hours from entry to exit/resolution',
  ADD COLUMN IF NOT EXISTS bankroll_at_entry DECIMAL(18, 2) DEFAULT 0.0 COMMENT 'Account equity at trade entry (for sizing metrics)',
  ADD COLUMN IF NOT EXISTS outcome Nullable(Int8) DEFAULT NULL COMMENT 'Final outcome: 1 = YES won, 0 = NO won, NULL = unresolved',
  ADD COLUMN IF NOT EXISTS fair_price_at_entry DECIMAL(10, 6) DEFAULT 0.0 COMMENT 'Market fair price (mid) at entry',
  ADD COLUMN IF NOT EXISTS pnl_gross DECIMAL(18, 6) DEFAULT 0.0 COMMENT 'Gross P&L before fees',
  ADD COLUMN IF NOT EXISTS pnl_net DECIMAL(18, 6) DEFAULT 0.0 COMMENT 'Net P&L after all costs',
  ADD COLUMN IF NOT EXISTS return_pct DECIMAL(10, 6) DEFAULT 0.0 COMMENT 'Return as % of capital deployed';

-- Create materialized view for windowed metrics
-- This pre-aggregates data for 30d/90d/180d windows

CREATE MATERIALIZED VIEW IF NOT EXISTS wallet_metrics_30d
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(window_date)
ORDER BY (wallet_address, window_date)
AS
SELECT
  wallet_address,
  toDate(timestamp) as window_date,

  -- Basic counts
  count() as trades_count,
  countIf(side = 'YES') as yes_count,
  countIf(side = 'NO') as no_count,
  countIf(outcome IS NOT NULL) as resolved_count,

  -- Volume metrics
  sum(usd_value) as total_volume,
  avg(usd_value) as avg_trade_size,
  max(usd_value) as max_trade_size,

  -- P&L metrics
  sum(pnl_gross) as total_pnl_gross,
  sum(pnl_net) as total_pnl_net,
  sumIf(pnl_net, pnl_net > 0) as total_gains,
  sumIf(abs(pnl_net), pnl_net <= 0) as total_losses,

  -- Win/Loss metrics
  countIf(pnl_net > 0) as wins,
  countIf(pnl_net <= 0) as losses,
  avgIf(pnl_net, pnl_net > 0) as avg_gain,
  avgIf(abs(pnl_net), pnl_net <= 0) as avg_loss,

  -- Price/Execution metrics
  avg(entry_price) as avg_entry_price,
  avg(close_price) as avg_close_price,
  avg(fee_usd) as avg_fee,
  avg(slippage_usd) as avg_slippage,

  -- Time metrics
  avg(hours_held) as avg_hours_held,
  max(hours_held) as max_hours_held,
  min(hours_held) as min_hours_held,

  -- Return metrics
  avg(return_pct) as avg_return_pct,
  stddevPop(return_pct) as stddev_return_pct,

  -- Omega components (for faster calculation)
  sumIf(pnl_gross, pnl_gross > 0) as omega_gains_gross,
  sumIf(abs(pnl_gross), pnl_gross <= 0) as omega_losses_gross,
  sumIf(pnl_net, pnl_net > 0) as omega_gains_net,
  sumIf(abs(pnl_net), pnl_net <= 0) as omega_losses_net

FROM trades_raw
WHERE outcome IS NOT NULL  -- Only resolved trades
GROUP BY wallet_address, window_date;


-- Create table for historical price snapshots (for lag simulation)
CREATE TABLE IF NOT EXISTS market_price_history (
  market_id TEXT,
  timestamp DateTime64(3),
  yes_price DECIMAL(10, 6),
  no_price DECIMAL(10, 6),
  best_bid DECIMAL(10, 6),
  best_ask DECIMAL(10, 6),
  spread_bps INT,
  volume_24h DECIMAL(18, 2),
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, timestamp)
SETTINGS index_granularity = 8192
COMMENT 'Historical price snapshots for lag simulation (copy-trading metrics)';

-- Index for fast time-range queries
CREATE INDEX IF NOT EXISTS idx_market_price_history_timestamp
  ON market_price_history (timestamp)
  TYPE minmax GRANULARITY 4;


-- Comments on new columns
COMMENT ON COLUMN trades_raw.close_price IS 'YES price immediately before resolution (for CLV calculation)';
COMMENT ON COLUMN trades_raw.fee_usd IS 'Total transaction fees including maker/taker fees and gas';
COMMENT ON COLUMN trades_raw.slippage_usd IS 'Cost of slippage: (execution_price - mid_price) * shares';
COMMENT ON COLUMN trades_raw.hours_held IS 'Duration of position from entry to exit/resolution';
COMMENT ON COLUMN trades_raw.bankroll_at_entry IS 'Wallet equity at time of entry (for Kelly/sizing metrics)';
COMMENT ON COLUMN trades_raw.outcome IS 'Binary outcome: 1 = YES won, 0 = NO won';
COMMENT ON COLUMN trades_raw.fair_price_at_entry IS 'Market mid price at entry (for EV estimation)';
COMMENT ON COLUMN trades_raw.pnl_gross IS 'P&L before fees: shares * side * (outcome - entry_price)';
COMMENT ON COLUMN trades_raw.pnl_net IS 'P&L after all costs: pnl_gross - fee_usd - slippage_usd';
COMMENT ON COLUMN trades_raw.return_pct IS 'Return percentage: pnl_net / capital_deployed';


-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Check new columns exist
DESCRIBE trades_raw;

-- Check materialized view exists
SHOW TABLES LIKE 'wallet_metrics_30d';

-- Sample query for wallet metrics (30-day window)
-- SELECT
--   wallet_address,
--   SUM(trades_count) as total_trades,
--   SUM(total_pnl_net) as net_pnl,
--   SUM(omega_gains_net) / NULLIF(SUM(omega_losses_net), 0) as omega_ratio,
--   SUM(wins) / NULLIF(SUM(resolved_count), 0) as win_rate
-- FROM wallet_metrics_30d
-- WHERE window_date >= today() - INTERVAL 30 DAY
-- GROUP BY wallet_address
-- ORDER BY omega_ratio DESC
-- LIMIT 10;

SELECT '✅ ClickHouse schema extended for Phase 1 metrics!' AS status;
