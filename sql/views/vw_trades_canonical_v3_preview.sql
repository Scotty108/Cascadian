-- ============================================================================
-- vw_trades_canonical_v3_preview: Preview View for V3 Migration
-- ============================================================================
-- Purpose: Safe preview view for downstream systems to test V3 condition IDs
--          before full production rollout
--
-- Migration Strategy:
-- - Exposes BOTH v2 and v3 columns for side-by-side comparison
-- - canonical_condition_id uses v3 when available, falls back to v2
-- - canonical_condition_source tracks provenance ('v3', 'v2', or 'none')
-- - Maintains backward compatibility with existing consumers
--
-- Usage:
-- - PnL systems can query this view to compare v2 vs v3 results
-- - Downstream systems can gradually migrate from v2 → canonical columns
-- - Production switch: point vw_trades_canonical at this logic when ready
-- ============================================================================

CREATE OR REPLACE VIEW vw_trades_canonical_v3_preview AS
SELECT
  -- =========================================================================
  -- Primary Identifiers
  -- =========================================================================
  trade_id,
  trade_key,
  transaction_hash,
  wallet_address,

  -- =========================================================================
  -- V2 Columns (Backward Compatibility)
  -- =========================================================================
  condition_id_norm_v2,
  outcome_index_v2,
  market_id_norm_v2,

  -- =========================================================================
  -- V3 Columns (New Data)
  -- =========================================================================
  condition_id_norm_v3,
  outcome_index_v3,
  market_id_norm_v3,
  condition_source_v3,  -- 'original' | 'twd' | 'erc1155' | 'clob' | 'none'

  -- =========================================================================
  -- Canonical Columns (V3-First Overlay)
  -- =========================================================================
  -- These columns use V3 when available, falling back to V2
  -- This is the recommended migration path for downstream consumers
  CASE
    WHEN condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
      AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
    THEN condition_id_norm_v3
    WHEN condition_id_norm_v2 IS NOT NULL
      AND condition_id_norm_v2 != ''
      AND condition_id_norm_v2 != '0000000000000000000000000000000000000000000000000000000000000000'
    THEN condition_id_norm_v2
    ELSE NULL
  END AS canonical_condition_id,

  CASE
    WHEN condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
      AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
    THEN outcome_index_v3
    WHEN condition_id_norm_v2 IS NOT NULL
      AND condition_id_norm_v2 != ''
      AND condition_id_norm_v2 != '0000000000000000000000000000000000000000000000000000000000000000'
    THEN outcome_index_v2
    ELSE NULL
  END AS canonical_outcome_index,

  CASE
    WHEN condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
      AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
    THEN market_id_norm_v3
    WHEN condition_id_norm_v2 IS NOT NULL
      AND condition_id_norm_v2 != ''
      AND condition_id_norm_v2 != '0000000000000000000000000000000000000000000000000000000000000000'
    THEN market_id_norm_v2
    ELSE NULL
  END AS canonical_market_id,

  -- Provenance tracking: where did canonical_condition_id come from?
  CASE
    WHEN condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
      AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
    THEN 'v3'
    WHEN condition_id_norm_v2 IS NOT NULL
      AND condition_id_norm_v2 != ''
      AND condition_id_norm_v2 != '0000000000000000000000000000000000000000000000000000000000000000'
    THEN 'v2'
    ELSE 'none'
  END AS canonical_condition_source,

  -- =========================================================================
  -- Original IDs (for debugging and comparison)
  -- =========================================================================
  condition_id_norm_orig,
  outcome_index_orig,
  market_id_norm_orig,

  -- =========================================================================
  -- Trade Details
  -- =========================================================================
  trade_direction,
  direction_confidence,
  shares,
  price,
  usd_value,
  fee,

  -- =========================================================================
  -- Temporal
  -- =========================================================================
  timestamp,
  created_at,

  -- =========================================================================
  -- Source Tracking & Repair Provenance
  -- =========================================================================
  source,
  id_repair_source,
  id_repair_confidence,

  -- =========================================================================
  -- Orphan Tracking
  -- =========================================================================
  is_orphan,
  orphan_reason

FROM pm_trades_canonical_v3;
