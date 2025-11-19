-- ============================================================================
-- pm_trades_canonical_v3_sandbox: Sandbox table for testing twd integration
-- ============================================================================
-- Purpose: Test trades_with_direction integration before global backfill
-- Test Scope: August-October 2024 (or xcnstrategy wallet only)
-- Expected Improvement: 12% → 68% coverage
-- ============================================================================

CREATE TABLE IF NOT EXISTS pm_trades_canonical_v3_sandbox (
  -- Primary identifiers
  trade_id                  String,
  trade_key                 String,
  transaction_hash          String,
  wallet_address            String,

  -- Repaired IDs (v2 - with twd integration)
  condition_id_norm_v2      String,           -- Now includes twd repair
  outcome_index_v2          Int8,             -- Now includes twd repair
  market_id_norm_v2         String,

  -- Original IDs (for comparison)
  condition_id_norm_orig    String,
  outcome_index_orig        Int16,
  market_id_norm_orig       String,

  -- Trade details
  trade_direction           Enum8('BUY'=1, 'SELL'=2, 'UNKNOWN'=3),
  direction_confidence      Enum8('HIGH'=1, 'MEDIUM'=2, 'LOW'=3),
  shares                    Decimal(18,8),
  price                     Decimal(18,8),
  usd_value                 Decimal(18,2),
  fee                       Decimal(18,2),

  -- Temporal
  timestamp                 DateTime,
  created_at                DateTime DEFAULT now(),

  -- Source tracking
  source                    Enum8('clob'=0, 'erc1155'=1, 'canonical'=2),

  -- Repair provenance (UPDATED to include twd_join)
  id_repair_source          Enum8(
                              'original'=0,
                              'erc1155_decode'=1,
                              'clob_decode'=2,
                              'unknown'=3,
                              'twd_join'=4              -- NEW: trades_with_direction
                            ),
  id_repair_confidence      Enum8('HIGH'=1, 'MEDIUM'=2, 'LOW'=3),

  -- Orphan tracking
  is_orphan                 UInt8 DEFAULT 0,
  orphan_reason             Nullable(String),

  -- Version for ReplacingMergeTree
  version                   DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, condition_id_norm_v2, timestamp, trade_id)
SETTINGS index_granularity = 8192;
