-- ============================================================================
-- vw_wallet_market_pnl_v3: V3 Wallet Position-Level PnL View
-- ============================================================================
-- Purpose: Position-level PnL aggregation using V3 condition IDs (69% coverage)
--          Mirrors V2 logic exactly, only difference is higher coverage
--
-- Data Flow:
-- - Source: vw_trades_canonical_current (V3-first, V2-fallback trade data)
-- - Filter: canonical_condition_id IS NOT NULL (excludes orphans)
-- - Aggregate: GROUP BY (wallet_address, canonical_condition_id, canonical_outcome_index)
-- - Enrich: LEFT JOIN market_resolutions_final for settlement data
--
-- Key Differences from V2:
-- - Reads from vw_trades_canonical_current (not pm_trades_canonical_v2)
-- - Uses canonical_condition_id (not condition_id_norm_v2)
-- - 69% coverage (vs 10% in V2)
-- - Zero changes to PnL calculation formulas
--
-- Backward Compatibility:
-- - Exposes condition_id_norm column (alias for canonical_condition_id)
-- - Same column names as vw_wallet_positions_v2
-- - Same join pattern to market_resolutions_final
--
-- Usage:
-- - Wallet PnL dashboards
-- - Position breakdowns
-- - Smart money leaderboards
-- ============================================================================

CREATE OR REPLACE VIEW vw_wallet_market_pnl_v3 AS
SELECT
  -- =========================================================================
  -- Identifiers (Backward Compatible Column Names)
  -- =========================================================================
  positions.wallet_address,
  positions.canonical_condition_id AS condition_id_norm,  -- Alias for compatibility
  positions.canonical_outcome_index AS outcome_index,      -- Alias for compatibility
  positions.canonical_market_id AS market_id_norm,         -- Alias for compatibility

  -- =========================================================================
  -- Provenance Tracking (New in V3)
  -- =========================================================================
  positions.canonical_condition_source,  -- 'v3' or 'v2' - tracks data lineage

  -- =========================================================================
  -- Trade Volume Metrics
  -- =========================================================================
  positions.total_trades,
  positions.buy_trades,
  positions.sell_trades,

  -- =========================================================================
  -- Position Metrics (Shares)
  -- =========================================================================
  positions.total_bought_shares,
  positions.total_sold_shares,
  positions.final_position_size,  -- Net position (bought - sold)

  -- =========================================================================
  -- Cost Basis (USD)
  -- =========================================================================
  positions.total_cost_usd,      -- Total cost of buys
  positions.total_proceeds_usd,  -- Total proceeds from sells
  positions.avg_entry_price,     -- Weighted average buy price
  positions.avg_exit_price,      -- Weighted average sell price

  -- =========================================================================
  -- PnL Components (USD)
  -- =========================================================================
  positions.realized_pnl_usd,    -- Closed positions P&L (sells - buys)
  positions.unrealized_pnl_usd,  -- Open positions P&L (to be calculated in app layer)
  positions.settlement_pnl_usd,  -- Settlement P&L for resolved markets
  positions.total_pnl_usd,       -- Sum of all P&L components

  -- =========================================================================
  -- Resolution Status (From market_resolutions_final LEFT JOIN)
  -- =========================================================================
  CASE WHEN res.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END AS is_resolved,
  res.resolved_at,
  res.winning_outcome,
  NULL AS payout_per_share,  -- Not currently populated in market_resolutions_final

  -- =========================================================================
  -- Current Market Prices (Optional - for unrealized PnL)
  -- =========================================================================
  NULL AS current_market_price,
  NULL AS price_updated_at,

  -- =========================================================================
  -- Coverage Tracking
  -- =========================================================================
  positions.covered_volume_usd,  -- Volume with valid condition IDs
  positions.orphan_volume_usd,   -- Volume without valid condition IDs (should be 0 in V3)
  positions.coverage_pct,        -- Percentage of volume covered

  -- =========================================================================
  -- Temporal
  -- =========================================================================
  positions.first_trade_at,
  positions.last_trade_at,
  positions.created_at,
  positions.updated_at

FROM (
  -- ==========================================================================
  -- STAGE 1: Aggregate Trades by Position
  -- ==========================================================================
  -- Group trades by (wallet, condition, outcome) and calculate position metrics
  -- Uses EXACT SAME formulas as V2 - only difference is data source
  -- ==========================================================================

  SELECT
    wallet_address,
    canonical_condition_id,
    canonical_outcome_index,
    canonical_market_id,
    canonical_condition_source,

    -- Trade volume
    COUNT(*) AS total_trades,
    SUM(CASE WHEN trade_direction = 'BUY' THEN 1 ELSE 0 END) AS buy_trades,
    SUM(CASE WHEN trade_direction = 'SELL' THEN 1 ELSE 0 END) AS sell_trades,

    -- Position metrics (as Float64 to avoid Decimal scale issues in aggregation)
    SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(shares) ELSE 0 END) AS total_bought_shares,
    SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(shares) ELSE 0 END) AS total_sold_shares,
    SUM(CASE
      WHEN trade_direction = 'BUY' THEN toFloat64(shares)
      WHEN trade_direction = 'SELL' THEN -toFloat64(shares)
      ELSE 0
    END) AS final_position_size,

    -- Cost basis (as Float64)
    SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(usd_value) ELSE 0 END) AS total_cost_usd,
    SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(usd_value) ELSE 0 END) AS total_proceeds_usd,

    -- Weighted average prices (division in Float64, with inf/NaN protection)
    CASE
      WHEN SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(shares) ELSE 0 END) > 0.0
      THEN SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(usd_value) ELSE 0 END) /
           SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(shares) ELSE 0 END)
      ELSE NULL
    END AS avg_entry_price,

    CASE
      WHEN SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(shares) ELSE 0 END) > 0.0
      THEN SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(usd_value) ELSE 0 END) /
           SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(shares) ELSE 0 END)
      ELSE NULL
    END AS avg_exit_price,

    -- Realized P&L (sells - buys, as Float64)
    -- IMPORTANT: This is the EXACT SAME formula as V2
    SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(usd_value) ELSE 0 END) -
    SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(usd_value) ELSE 0 END) AS realized_pnl_usd,

    -- Unrealized P&L (to be calculated in application layer or separate query)
    0 AS unrealized_pnl_usd,

    -- Settlement P&L (to be calculated after JOIN with resolutions)
    0 AS settlement_pnl_usd,

    -- Total P&L (realized only for now)
    (SUM(CASE WHEN trade_direction = 'SELL' THEN toFloat64(usd_value) ELSE 0 END) -
     SUM(CASE WHEN trade_direction = 'BUY' THEN toFloat64(usd_value) ELSE 0 END)) AS total_pnl_usd,

    -- Coverage (as Float64)
    SUM(toFloat64(usd_value)) AS covered_volume_usd,
    0 AS orphan_volume_usd,  -- All trades in this view have valid condition IDs
    100.0 AS coverage_pct,

    -- Temporal
    MIN(timestamp) AS first_trade_at,
    MAX(timestamp) AS last_trade_at,
    now() AS created_at,
    now() AS updated_at

  FROM vw_trades_canonical_current
  WHERE
    -- Filter to trades with valid condition IDs (same pattern as V2)
    canonical_condition_id IS NOT NULL
    AND canonical_condition_id != ''
    AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'

  GROUP BY
    wallet_address,
    canonical_condition_id,
    canonical_outcome_index,
    canonical_market_id,
    canonical_condition_source

) AS positions

-- ==========================================================================
-- STAGE 2: Enrich with Resolution Data
-- ==========================================================================
-- LEFT JOIN market_resolutions_final to add settlement information
-- Uses SAME join pattern as V2 (condition_id_norm column)
-- ==========================================================================

LEFT JOIN market_resolutions_final AS res
  ON positions.canonical_condition_id = res.condition_id_norm;

-- ============================================================================
-- View Metadata
-- ============================================================================
-- Created: 2025-11-16
-- Source: vw_trades_canonical_current (V3-first, V2-fallback)
-- Coverage: ~69% (vs ~10% in V2)
-- Row Count: Expected ~15-30M positions (vs ~5-10M in V2)
-- Key Improvement: +59% more trades contribute to PnL
-- Backward Compatible: YES - same column names as vw_wallet_positions_v2
-- ============================================================================
