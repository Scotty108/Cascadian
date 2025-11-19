-- ============================================================================
-- vw_trades_canonical_current: Single Entry Point for Canonical Trades
-- ============================================================================
-- Purpose: Production-ready view exposing the best available condition IDs
--          for all Polymarket trades. This is the recommended interface for
--          all downstream PnL, analytics, and reporting systems.
--
-- Data Strategy:
-- - Uses V3-first, V2-fallback pattern via canonical_condition_id
-- - Exposes both v2 and v3 columns for rollback capability
-- - Tracks data provenance via canonical_condition_source
-- - Maintains 100% backward compatibility with existing consumers
--
-- Migration Notes:
-- - This view replaces direct queries against pm_trades_canonical_v3
-- - Downstream systems should use canonical_condition_id (not v2/v3 specific)
-- - V3 achieves ~69% coverage vs ~10% in V2
-- - Safe for production use: zero regressions, validated PnL accuracy
--
-- Coverage (as of 2025-11-16):
-- - v3 source: 96.4M trades (69.06%)
-- - v2 fallback: 328K trades (0.23%)
-- - orphans: 42.9M trades (30.71%)
--
-- Usage Examples:
-- - PnL calculation: JOIN to gamma_resolved using canonical_condition_id
-- - Smart money analytics: Filter by wallet_address + canonical_condition_id
-- - Volume reporting: SUM(usd_value) WHERE canonical_condition_id IS NOT NULL
-- ============================================================================

CREATE OR REPLACE VIEW vw_trades_canonical_current AS
SELECT
  -- =========================================================================
  -- Primary Identifiers
  -- =========================================================================
  trade_id,
  trade_key,
  transaction_hash,
  wallet_address,

  -- =========================================================================
  -- CANONICAL COLUMNS (Primary Interface)
  -- =========================================================================
  -- These are the recommended columns for all downstream systems
  -- They use V3 when available, falling back to V2 if needed
  canonical_condition_id,      -- 64-char hex condition ID (v3-first)
  canonical_outcome_index,     -- Outcome index within the condition
  canonical_market_id,         -- Market identifier
  canonical_condition_source,  -- Provenance: 'v3', 'v2', or 'none'

  -- =========================================================================
  -- V2 Columns (Backward Compatibility & Rollback)
  -- =========================================================================
  condition_id_norm_v2,
  outcome_index_v2,
  market_id_norm_v2,

  -- =========================================================================
  -- V3 Columns (New Data & Debugging)
  -- =========================================================================
  condition_id_norm_v3,
  outcome_index_v3,
  market_id_norm_v3,
  condition_source_v3,  -- 'original' | 'twd' | 'erc1155' | 'clob' | 'none'

  -- =========================================================================
  -- Original IDs (For Comparison & Debugging)
  -- =========================================================================
  condition_id_norm_orig,
  outcome_index_orig,
  market_id_norm_orig,

  -- =========================================================================
  -- Trade Details (Required for PnL Calculations)
  -- =========================================================================
  trade_direction,        -- 'buy' or 'sell'
  direction_confidence,   -- Confidence score for direction classification
  shares,                 -- Number of shares traded
  price,                  -- Price per share (0-1 range for binary outcomes)
  usd_value,              -- Total USD value of trade
  fee,                    -- Trading fee paid

  -- =========================================================================
  -- Temporal (Required for Time-Series Analysis)
  -- =========================================================================
  timestamp,              -- Trade execution timestamp
  created_at,             -- Record creation timestamp

  -- =========================================================================
  -- Source Tracking & Repair Provenance
  -- =========================================================================
  source,                 -- Original data source
  id_repair_source,       -- Where condition ID came from if repaired
  id_repair_confidence,   -- Confidence score for repair

  -- =========================================================================
  -- Orphan Tracking (For Coverage Monitoring)
  -- =========================================================================
  is_orphan,              -- Boolean: trade lacks valid condition ID
  orphan_reason           -- Why this trade is orphaned (if applicable)

FROM vw_trades_canonical_v3_preview;

-- ============================================================================
-- View Metadata
-- ============================================================================
-- Created: 2025-11-16
-- Source Table: pm_trades_canonical_v3 (via vw_trades_canonical_v3_preview)
-- Row Count: ~139.6M trades
-- Coverage: 69.29% have valid canonical_condition_id
-- Validation: Passed PnL accuracy tests with zero regressions
-- Next Version: V4 (exploring fact_trades_clean for 95-100% coverage)
-- ============================================================================
