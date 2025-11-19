-- ============================================================================
-- pm_trades_orphaned_v2: Trades that could not be repaired
-- ============================================================================
-- Purpose: Separate and track trades where condition_id repair failed
--          after attempting all available decode sources
--
-- Orphan Definition:
-- A trade is an orphan if condition_id_norm_v2 is NULL after:
-- 1. Original condition_id_norm check (not null, not 0x0000...)
-- 2. ERC1155 token_id decode attempt
-- 3. CLOB asset_id decode attempt
--
-- Expected Orphan Rate: 10-30% of 157M trades (15M - 47M trades)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pm_trades_orphaned_v2 (
  -- Primary identifiers
  trade_id                  String,
  trade_key                 String,
  transaction_hash          String,
  wallet_address            String,

  -- Original IDs (all null or invalid)
  condition_id_norm_orig    String,
  outcome_index_orig        Int16,
  market_id_norm_orig       String,

  -- Trade details (for analysis)
  trade_direction           Enum8('BUY'=1, 'SELL'=2, 'UNKNOWN'=3),
  shares                    Decimal(18,8),
  usd_value                 Decimal(18,2),

  -- Temporal
  timestamp                 DateTime,

  -- Source tracking
  source                    Enum8('clob'=0, 'erc1155'=1, 'canonical'=2),

  -- Repair attempt tracking
  repair_attempts           String,           -- Comma-separated list: 'erc1155,clob' or 'none'
  orphan_reason             String,           -- Why repair failed
  orphan_category           Enum8(
                              'no_decode_source'=0,      -- No matching CLOB/ERC1155 record
                              'decode_failed'=1,         -- Decode returned invalid result
                              'original_invalid'=2,      -- Original ID invalid format
                              'unknown'=3
                            ),

  -- Metadata
  created_at                DateTime DEFAULT now(),
  version                   DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp, trade_id)
SETTINGS index_granularity = 8192;

-- ============================================================================
-- Population Query (Extract from pm_trades_canonical_v2)
-- ============================================================================
-- This runs AFTER pm_trades_canonical_v2 is populated
--
-- INSERT INTO pm_trades_orphaned_v2
-- SELECT
--   trade_id,
--   trade_key,
--   transaction_hash,
--   wallet_address,
--
--   condition_id_norm_orig,
--   outcome_index_orig,
--   market_id_norm_orig,
--
--   trade_direction,
--   shares,
--   usd_value,
--
--   timestamp,
--   source,
--
--   -- Build repair attempts list
--   CASE
--     WHEN id_repair_source = 'unknown' THEN 'none_successful'
--     ELSE CAST(id_repair_source AS String)
--   END AS repair_attempts,
--
--   orphan_reason,
--
--   -- Categorize orphan
--   CASE
--     WHEN orphan_reason LIKE '%no_matching_decode%' THEN 'no_decode_source'
--     WHEN orphan_reason LIKE '%decode_failed%' THEN 'decode_failed'
--     WHEN orphan_reason LIKE '%invalid_format%' THEN 'original_invalid'
--     ELSE 'unknown'
--   END AS orphan_category,
--
--   now() AS created_at,
--   now() AS version
--
-- FROM pm_trades_canonical_v2
-- WHERE is_orphan = 1;
--
-- ============================================================================
-- Analysis Queries
-- ============================================================================
--
-- Orphan rate by wallet:
-- SELECT
--   wallet_address,
--   COUNT(*) as total_trades,
--   SUM(CASE WHEN is_orphan = 1 THEN 1 ELSE 0 END) as orphan_trades,
--   SUM(CASE WHEN is_orphan = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100 as orphan_pct
-- FROM pm_trades_canonical_v2
-- WHERE wallet_address IN (
--   '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',  -- xcnstrategy
--   -- Add other test wallets
-- )
-- GROUP BY wallet_address;
--
-- Orphan rate by time period:
-- SELECT
--   toYYYYMM(timestamp) as month,
--   COUNT(*) as orphan_trades,
--   SUM(usd_value) as orphan_volume_usd
-- FROM pm_trades_orphaned_v2
-- GROUP BY month
-- ORDER BY month DESC
-- LIMIT 24;
--
-- Orphan rate by category:
-- SELECT
--   orphan_category,
--   COUNT(*) as orphan_trades,
--   COUNT(*) / (SELECT COUNT(*) FROM pm_trades_orphaned_v2) * 100 as pct
-- FROM pm_trades_orphaned_v2
-- GROUP BY orphan_category
-- ORDER BY orphan_trades DESC;
--
-- Top wallets by orphan count:
-- SELECT
--   wallet_address,
--   COUNT(*) as orphan_trades,
--   SUM(usd_value) as orphan_volume_usd
-- FROM pm_trades_orphaned_v2
-- GROUP BY wallet_address
-- ORDER BY orphan_trades DESC
-- LIMIT 100;
