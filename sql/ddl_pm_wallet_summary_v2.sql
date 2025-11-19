-- ============================================================================
-- pm_wallet_summary_v2: Per-wallet aggregated P&L and metrics
-- ============================================================================
-- Purpose: Wallet-level summary of all P&L and trading activity
--          Aggregates pm_wallet_market_pnl_v2 into single row per wallet
--
-- Usage: Leaderboards, wallet analytics, portfolio dashboards
--
-- Dependencies:
-- - pm_wallet_market_pnl_v2 (per-market P&L)
-- - pm_trades_canonical_v2 (for trade counts)
-- - pm_trades_orphaned_v2 (for coverage metrics)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pm_wallet_summary_v2 (
  -- Identifier
  wallet_address            String,

  -- P&L totals (across all markets)
  total_pnl_usd             Decimal(18,2),
  realized_pnl_usd          Decimal(18,2),
  unrealized_pnl_usd        Decimal(18,2),
  settlement_pnl_usd        Decimal(18,2),

  -- Trade volume
  total_trades              UInt32,
  total_markets             UInt32,           -- Distinct markets traded
  total_volume_usd          Decimal(18,2),

  -- Position metrics
  open_positions            UInt32,           -- Markets with final_position_size != 0
  closed_positions          UInt32,           -- Markets with final_position_size == 0
  resolved_positions        UInt32,           -- Markets that are resolved

  -- Performance metrics
  win_rate                  Decimal(5,2),     -- % of profitable markets
  avg_pnl_per_market        Decimal(18,2),
  avg_pnl_per_trade         Decimal(18,2),
  max_profit_usd            Decimal(18,2),    -- Largest single market profit
  max_loss_usd              Decimal(18,2),    -- Largest single market loss

  -- Risk metrics
  sharpe_ratio              Nullable(Decimal(10,4)),  -- (avg_pnl - 0) / stddev_pnl
  max_drawdown_usd          Nullable(Decimal(18,2)),
  win_loss_ratio            Nullable(Float64),        -- avg_win / avg_loss (Float64 to avoid inf/NaN cast issues)

  -- Coverage metrics
  covered_trades            UInt32,           -- Trades with valid condition_id
  orphan_trades             UInt32,           -- Trades without valid condition_id
  covered_volume_usd        Decimal(18,2),
  orphan_volume_usd         Decimal(18,2),
  coverage_pct              Decimal(5,2),     -- covered / (covered + orphan) * 100

  -- Temporal
  first_trade_at            DateTime,
  last_trade_at             DateTime,
  days_active               UInt32,

  -- Metadata
  created_at                DateTime DEFAULT now(),
  updated_at                DateTime DEFAULT now(),
  version                   DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(version)
ORDER BY wallet_address
SETTINGS index_granularity = 8192;

-- ============================================================================
-- Population Query (DO NOT RUN YET - PILOT FIRST)
-- ============================================================================
-- Aggregates pm_wallet_market_pnl_v2 into wallet-level summary
--
-- Expected runtime: 5-15 minutes for ~1M wallets
--
-- INSERT INTO pm_wallet_summary_v2
-- SELECT
--   wallet_address,
--
--   -- P&L totals
--   SUM(total_pnl_usd) AS total_pnl_usd,
--   SUM(realized_pnl_usd) AS realized_pnl_usd,
--   SUM(unrealized_pnl_usd) AS unrealized_pnl_usd,
--   SUM(settlement_pnl_usd) AS settlement_pnl_usd,
--
--   -- Trade volume
--   SUM(total_trades) AS total_trades,
--   COUNT(DISTINCT condition_id_norm) AS total_markets,
--   SUM(covered_volume_usd) AS total_volume_usd,
--
--   -- Position metrics
--   SUM(CASE WHEN final_position_size != 0 THEN 1 ELSE 0 END) AS open_positions,
--   SUM(CASE WHEN final_position_size = 0 THEN 1 ELSE 0 END) AS closed_positions,
--   SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) AS resolved_positions,
--
--   -- Performance metrics
--   SUM(CASE WHEN total_pnl_usd > 0 THEN 1 ELSE 0 END) /
--   NULLIF(COUNT(*), 0) * 100 AS win_rate,
--
--   AVG(total_pnl_usd) AS avg_pnl_per_market,
--
--   SUM(total_pnl_usd) /
--   NULLIF(SUM(total_trades), 0) AS avg_pnl_per_trade,
--
--   MAX(total_pnl_usd) AS max_profit_usd,
--   MIN(total_pnl_usd) AS max_loss_usd,
--
--   -- Risk metrics (TODO: Calculate properly with time-series data)
--   NULL AS sharpe_ratio,
--   NULL AS max_drawdown_usd,
--
--   -- Win/loss ratio
--   AVG(CASE WHEN total_pnl_usd > 0 THEN total_pnl_usd ELSE NULL END) /
--   NULLIF(ABS(AVG(CASE WHEN total_pnl_usd < 0 THEN total_pnl_usd ELSE NULL END)), 0) AS win_loss_ratio,
--
--   -- Coverage metrics
--   SUM(total_trades) AS covered_trades,
--   0 AS orphan_trades,  -- TODO: Join with pm_trades_orphaned_v2
--   SUM(covered_volume_usd) AS covered_volume_usd,
--   0 AS orphan_volume_usd,  -- TODO: Join with pm_trades_orphaned_v2
--   100.0 AS coverage_pct,   -- Will be updated with orphan data
--
--   -- Temporal
--   MIN(first_trade_at) AS first_trade_at,
--   MAX(last_trade_at) AS last_trade_at,
--   dateDiff('day', MIN(first_trade_at), MAX(last_trade_at)) AS days_active,
--
--   -- Metadata
--   now() AS created_at,
--   now() AS updated_at,
--   now() AS version
--
-- FROM pm_wallet_market_pnl_v2
-- GROUP BY wallet_address;
--
-- ============================================================================
-- Orphan Coverage Update (Run after main population)
-- ============================================================================
-- Update orphan metrics from pm_trades_orphaned_v2
--
-- WITH orphan_stats AS (
--   SELECT
--     wallet_address,
--     COUNT(*) AS orphan_trades,
--     SUM(usd_value) AS orphan_volume_usd
--   FROM pm_trades_orphaned_v2
--   GROUP BY wallet_address
-- )
-- UPDATE pm_wallet_summary_v2 AS s
-- SET
--   orphan_trades = o.orphan_trades,
--   orphan_volume_usd = o.orphan_volume_usd,
--   coverage_pct = (
--     covered_volume_usd /
--     NULLIF(covered_volume_usd + o.orphan_volume_usd, 0) * 100
--   ),
--   updated_at = now(),
--   version = now()
-- FROM orphan_stats o
-- WHERE s.wallet_address = o.wallet_address;
--
-- ============================================================================
-- Validation Queries
-- ============================================================================
--
-- Top 100 by P&L:
-- SELECT
--   wallet_address,
--   total_pnl_usd,
--   total_trades,
--   total_markets,
--   win_rate,
--   coverage_pct
-- FROM pm_wallet_summary_v2
-- ORDER BY total_pnl_usd DESC
-- LIMIT 100;
--
-- P&L distribution (sanity check):
-- SELECT
--   CASE
--     WHEN total_pnl_usd > 10000 THEN '>$10k profit'
--     WHEN total_pnl_usd > 1000 THEN '$1k-$10k profit'
--     WHEN total_pnl_usd > 0 THEN '$0-$1k profit'
--     WHEN total_pnl_usd > -1000 THEN '$0-$1k loss'
--     WHEN total_pnl_usd > -10000 THEN '$1k-$10k loss'
--     ELSE '>$10k loss'
--   END AS pnl_bucket,
--   COUNT(*) AS wallets,
--   SUM(total_pnl_usd) AS total_pnl
-- FROM pm_wallet_summary_v2
-- GROUP BY pnl_bucket
-- ORDER BY pnl_bucket;
--
-- xcnstrategy validation:
-- SELECT
--   wallet_address,
--   total_pnl_usd,
--   realized_pnl_usd,
--   settlement_pnl_usd,
--   total_trades,
--   total_markets,
--   win_rate,
--   coverage_pct
-- FROM pm_wallet_summary_v2
-- WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
--
-- Coverage metrics across all wallets:
-- SELECT
--   AVG(coverage_pct) AS avg_coverage_pct,
--   MEDIAN(coverage_pct) AS median_coverage_pct,
--   MIN(coverage_pct) AS min_coverage_pct,
--   MAX(coverage_pct) AS max_coverage_pct,
--   SUM(covered_trades) AS total_covered_trades,
--   SUM(orphan_trades) AS total_orphan_trades
-- FROM pm_wallet_summary_v2;
