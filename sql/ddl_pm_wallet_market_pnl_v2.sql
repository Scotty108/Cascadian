-- ============================================================================
-- pm_wallet_market_pnl_v2: Per-wallet, per-market P&L calculation
-- ============================================================================
-- Purpose: Calculate realized and unrealized P&L for each wallet's position
--          in each unique market (identified by condition_id_norm_v2)
--
-- Calculation Method: FIFO cost basis
-- - Realized P&L: Closed positions (sells - buys + settlements)
-- - Unrealized P&L: Open positions (current_value - remaining_cost_basis)
-- - Total P&L: Realized + Unrealized
--
-- Dependencies:
-- - pm_trades_canonical_v2 (repaired trades)
-- - market_resolutions_final (for settlement values)
--
-- Expected Coverage: 70-90% of wallets with valid condition_id
-- ============================================================================

CREATE TABLE IF NOT EXISTS pm_wallet_market_pnl_v2 (
  -- Identifiers
  wallet_address            String,
  condition_id_norm         String,           -- 64-char hex
  outcome_index             Int8,             -- 0 or 1 for binary markets

  -- Optional market metadata (if available)
  market_id_norm            Nullable(String),

  -- Trade volume metrics
  total_trades              UInt32,
  buy_trades                UInt32,
  sell_trades               UInt32,

  -- Position metrics
  total_bought_shares       Decimal(18,8),
  total_sold_shares         Decimal(18,8),
  final_position_size       Decimal(18,8),    -- Net shares (bought - sold)

  -- Cost basis (FIFO)
  total_cost_usd            Decimal(18,2),    -- Total buy cost
  total_proceeds_usd        Decimal(18,2),    -- Total sell proceeds
  avg_entry_price           Nullable(Float64),    -- Weighted avg buy price (NULL if no buys, Float64 to avoid inf/NaN cast issues)
  avg_exit_price            Nullable(Float64),        -- Weighted avg sell price (NULL if no sells, Float64 to avoid inf/NaN cast issues)

  -- P&L components
  realized_pnl_usd          Decimal(18,2),    -- Closed positions P&L
  unrealized_pnl_usd        Decimal(18,2),    -- Open positions P&L
  settlement_pnl_usd        Decimal(18,2),    -- Settled positions P&L
  total_pnl_usd             Decimal(18,2),    -- Sum of all P&L components

  -- Resolution status
  is_resolved               UInt8,            -- 1 if market resolved
  resolved_at               Nullable(DateTime),
  winning_outcome           Nullable(String), -- 'Yes' / 'No'
  payout_per_share          Nullable(Decimal(18,8)),  -- Settlement value

  -- Current market price (for unrealized P&L)
  current_market_price      Nullable(Decimal(18,8)),  -- Latest price from CLOB
  price_updated_at          Nullable(DateTime),

  -- Coverage tracking
  covered_volume_usd        Decimal(18,2),    -- Volume with valid condition_id
  orphan_volume_usd         Decimal(18,2),    -- Volume without valid condition_id
  coverage_pct              Decimal(5,2),     -- covered / (covered + orphan) * 100

  -- Metadata
  first_trade_at            DateTime,
  last_trade_at             DateTime,
  created_at                DateTime DEFAULT now(),
  updated_at                DateTime DEFAULT now(),
  version                   DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(version)
PARTITION BY substring(condition_id_norm, 1, 2)  -- Partition by first 2 hex chars
ORDER BY (wallet_address, condition_id_norm, outcome_index)
SETTINGS index_granularity = 8192;

-- ============================================================================
-- Population Query (DO NOT RUN YET - PILOT FIRST)
-- ============================================================================
-- This aggregates pm_trades_canonical_v2 into per-wallet per-market P&L
--
-- Expected runtime: 20-60 minutes for 157M trades -> ~10M positions
--
-- INSERT INTO pm_wallet_market_pnl_v2
-- SELECT
--   wallet_address,
--   condition_id_norm_v2 AS condition_id_norm,
--   outcome_index_v2 AS outcome_index,
--
--   -- Optional market ID (mostly null for now)
--   anyLast(market_id_norm_v2) AS market_id_norm,
--
--   -- Trade volume
--   COUNT(*) AS total_trades,
--   SUM(CASE WHEN trade_direction = 'BUY' THEN 1 ELSE 0 END) AS buy_trades,
--   SUM(CASE WHEN trade_direction = 'SELL' THEN 1 ELSE 0 END) AS sell_trades,
--
--   -- Position metrics
--   SUM(CASE WHEN trade_direction = 'BUY' THEN shares ELSE 0 END) AS total_bought_shares,
--   SUM(CASE WHEN trade_direction = 'SELL' THEN shares ELSE 0 END) AS total_sold_shares,
--   SUM(CASE
--     WHEN trade_direction = 'BUY' THEN shares
--     WHEN trade_direction = 'SELL' THEN -shares
--     ELSE 0
--   END) AS final_position_size,
--
--   -- Cost basis
--   SUM(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE 0 END) AS total_cost_usd,
--   SUM(CASE WHEN trade_direction = 'SELL' THEN usd_value ELSE 0 END) AS total_proceeds_usd,
--
--   -- Weighted average prices
--   SUM(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE 0 END) /
--   NULLIF(SUM(CASE WHEN trade_direction = 'BUY' THEN shares ELSE 0 END), 0) AS avg_entry_price,
--
--   SUM(CASE WHEN trade_direction = 'SELL' THEN usd_value ELSE 0 END) /
--   NULLIF(SUM(CASE WHEN trade_direction = 'SELL' THEN shares ELSE 0 END), 0) AS avg_exit_price,
--
--   -- Realized P&L (sells - buys)
--   SUM(CASE WHEN trade_direction = 'SELL' THEN usd_value ELSE 0 END) -
--   SUM(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE 0 END) AS realized_pnl_usd,
--
--   -- Unrealized P&L (calculated later with current prices)
--   0 AS unrealized_pnl_usd,  -- TODO: Calculate from current market prices
--
--   -- Settlement P&L (calculated later with resolution data)
--   0 AS settlement_pnl_usd,  -- TODO: Calculate from market_resolutions_final
--
--   -- Total P&L
--   (
--     SUM(CASE WHEN trade_direction = 'SELL' THEN usd_value ELSE 0 END) -
--     SUM(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE 0 END)
--   ) AS total_pnl_usd,
--
--   -- Resolution status (join with market_resolutions_final)
--   0 AS is_resolved,           -- TODO: Join with resolutions
--   NULL AS resolved_at,
--   NULL AS winning_outcome,
--   NULL AS payout_per_share,
--
--   -- Current market price (from latest CLOB fill)
--   NULL AS current_market_price,  -- TODO: Get from clob_fills
--   NULL AS price_updated_at,
--
--   -- Coverage tracking
--   SUM(usd_value) AS covered_volume_usd,
--   0 AS orphan_volume_usd,  -- TODO: Calculate from orphan trades
--   100.0 AS coverage_pct,   -- Will be updated with orphan data
--
--   -- Temporal
--   MIN(timestamp) AS first_trade_at,
--   MAX(timestamp) AS last_trade_at,
--   now() AS created_at,
--   now() AS updated_at,
--   now() AS version
--
-- FROM pm_trades_canonical_v2
-- WHERE
--   is_orphan = 0  -- Exclude orphan trades
--   AND condition_id_norm_v2 IS NOT NULL
--   AND condition_id_norm_v2 != ''
-- GROUP BY
--   wallet_address,
--   condition_id_norm_v2,
--   outcome_index_v2;
--
-- ============================================================================
-- Settlement P&L Update (Run after main population)
-- ============================================================================
-- Update settlement P&L for resolved markets
--
-- UPDATE pm_wallet_market_pnl_v2 AS p
-- SET
--   is_resolved = 1,
--   resolved_at = r.resolved_at,
--   winning_outcome = r.winning_outcome,
--   winning_index = r.winning_index,
--   payout_per_share = arrayElement(r.payout_numerators, outcome_index + 1) / r.payout_denominator,
--   settlement_pnl_usd = (
--     final_position_size *
--     (arrayElement(r.payout_numerators, outcome_index + 1) / r.payout_denominator)
--   ),
--   total_pnl_usd = realized_pnl_usd + settlement_pnl_usd,
--   updated_at = now(),
--   version = now()
-- FROM market_resolutions_final r
-- WHERE
--   p.condition_id_norm = r.condition_id_norm
--   AND r.resolved_at IS NOT NULL;
--
-- ============================================================================
-- Validation Queries
-- ============================================================================
--
-- Check P&L distribution:
-- SELECT
--   CASE
--     WHEN total_pnl_usd > 1000 THEN 'whale_profit'
--     WHEN total_pnl_usd > 100 THEN 'profit'
--     WHEN total_pnl_usd > -100 THEN 'neutral'
--     WHEN total_pnl_usd > -1000 THEN 'loss'
--     ELSE 'whale_loss'
--   END AS pnl_bucket,
--   COUNT(*) AS positions,
--   SUM(total_pnl_usd) AS total_pnl
-- FROM pm_wallet_market_pnl_v2
-- GROUP BY pnl_bucket
-- ORDER BY pnl_bucket;
--
-- Check xcnstrategy P&L:
-- SELECT
--   condition_id_norm,
--   outcome_index,
--   total_trades,
--   final_position_size,
--   realized_pnl_usd,
--   settlement_pnl_usd,
--   total_pnl_usd,
--   is_resolved
-- FROM pm_wallet_market_pnl_v2
-- WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
-- ORDER BY abs(total_pnl_usd) DESC
-- LIMIT 20;
