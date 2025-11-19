-- ============================================================================
-- pm_trades_canonical_v2: Canonical trade table with repaired IDs
-- ============================================================================
-- Purpose: Replace vw_trades_canonical with globally repaired condition_id
--          and outcome_index using token decode from clob_fills and erc1155_transfers
--
-- Repair Strategy:
-- 1. Keep original if valid (not null, not 0x0000...)
-- 2. Decode from clob_fills.asset_id (39M fills)
-- 3. Decode from erc1155_transfers.token_id (61M transfers)
-- 4. Mark remaining as orphans (separate table)
--
-- Expected Coverage: 70-90% valid condition_id (vs 51% currently)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pm_trades_canonical_v2 (
  -- Primary identifiers
  trade_id                  String,
  trade_key                 String,           -- Original composite key
  transaction_hash          String,
  wallet_address            String,           -- Normalized (lowercase, no 0x)

  -- Repaired IDs (v2)
  condition_id_norm_v2      String,           -- 64-char hex, repaired
  outcome_index_v2          Int8,             -- 0 or 1 for binary markets
  market_id_norm_v2         String,           -- Optional (mostly null for now)

  -- Original IDs (for comparison)
  condition_id_norm_orig    String,
  outcome_index_orig        Int16,
  market_id_norm_orig       String,

  -- Trade details
  trade_direction           Enum8('BUY'=1, 'SELL'=2, 'UNKNOWN'=3),
  direction_confidence      Enum8('HIGH'=1, 'MEDIUM'=2, 'LOW'=3),
  shares                    Decimal(18,8),
  price                     Decimal(18,8),    -- Entry price
  usd_value                 Decimal(18,2),
  fee                       Decimal(18,2),    -- TODO: Calculate from fee_rate_bps

  -- Temporal
  timestamp                 DateTime,
  created_at                DateTime DEFAULT now(),

  -- Source tracking
  source                    Enum8('clob'=0, 'erc1155'=1, 'canonical'=2),

  -- Repair provenance (critical for debugging)
  id_repair_source          Enum8(
                              'original'=0,           -- Original was valid
                              'erc1155_decode'=1,     -- Decoded from ERC1155 token_id
                              'clob_decode'=2,        -- Decoded from CLOB asset_id
                              'unknown'=3             -- Could not repair (orphan)
                            ),
  id_repair_confidence      Enum8('HIGH'=1, 'MEDIUM'=2, 'LOW'=3),

  -- Orphan tracking
  is_orphan                 UInt8 DEFAULT 0,  -- 1 if condition_id_norm_v2 is null after all repairs
  orphan_reason             Nullable(String), -- Why repair failed

  -- Version for ReplacingMergeTree
  version                   DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, condition_id_norm_v2, timestamp, trade_id)
SETTINGS index_granularity = 8192;

-- ============================================================================
-- Population Query (DO NOT RUN YET - PILOT FIRST)
-- ============================================================================
-- This query will be executed AFTER decode tests and pilot validation.
-- Expected runtime: 10-30 minutes for 157M trades.
--
-- INSERT INTO pm_trades_canonical_v2
-- SELECT
--   vt.trade_id,
--   vt.trade_key,
--   vt.transaction_hash,
--   vt.wallet_address_norm AS wallet_address,
--
--   -- Repair condition_id (Priority: original > erc1155 > clob > NULL)
--   COALESCE(
--     -- Priority 1: Use original if valid
--     CASE
--       WHEN vt.condition_id_norm IS NOT NULL
--         AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
--         AND vt.condition_id_norm != ''
--         THEN vt.condition_id_norm
--       ELSE NULL
--     END,
--     -- Priority 2: Decode from ERC1155 token_id (higher confidence)
--     erc.condition_id_decoded,
--     -- Priority 3: Decode from CLOB asset_id
--     clob.condition_id_decoded
--   ) AS condition_id_norm_v2,
--
--   -- Repair outcome_index
--   COALESCE(
--     CASE WHEN vt.outcome_index >= 0 THEN vt.outcome_index ELSE NULL END,
--     erc.outcome_index_decoded,
--     clob.outcome_index_decoded,
--     -1  -- Invalid marker
--   ) AS outcome_index_v2,
--
--   -- market_id: Keep original (mostly null, external API needed later)
--   CASE
--     WHEN vt.market_id_norm IS NOT NULL
--       AND vt.market_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
--       AND vt.market_id_norm != ''
--       THEN vt.market_id_norm
--     ELSE NULL
--   END AS market_id_norm_v2,
--
--   -- Store originals for comparison
--   vt.condition_id_norm AS condition_id_norm_orig,
--   vt.outcome_index AS outcome_index_orig,
--   vt.market_id_norm AS market_id_norm_orig,
--
--   -- Trade details
--   vt.trade_direction,
--   vt.direction_confidence,
--   vt.shares,
--   vt.entry_price AS price,
--   vt.usd_value,
--   0 AS fee,  -- TODO: Calculate from fee_rate_bps when available
--
--   vt.timestamp,
--   now() AS created_at,
--
--   -- Determine source
--   CASE
--     WHEN clob.tx_hash IS NOT NULL THEN 'clob'
--     WHEN erc.tx_hash IS NOT NULL THEN 'erc1155'
--     ELSE 'canonical'
--   END AS source,
--
--   -- Track repair source
--   CASE
--     WHEN vt.condition_id_norm IS NOT NULL
--       AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
--       AND vt.condition_id_norm != ''
--       THEN 'original'
--     WHEN erc.condition_id_decoded IS NOT NULL THEN 'erc1155_decode'
--     WHEN clob.condition_id_decoded IS NOT NULL THEN 'clob_decode'
--     ELSE 'unknown'
--   END AS id_repair_source,
--
--   -- Repair confidence
--   CASE
--     WHEN vt.condition_id_norm IS NOT NULL
--       AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
--       THEN 'HIGH'  -- Original data
--     WHEN erc.condition_id_decoded IS NOT NULL THEN 'HIGH'    -- ERC1155 decode (100% coverage)
--     WHEN clob.condition_id_decoded IS NOT NULL THEN 'MEDIUM' -- CLOB decode (may have mismatches)
--     ELSE 'LOW'
--   END AS id_repair_confidence,
--
--   -- Mark as orphan if condition_id still null after all repairs
--   CASE
--     WHEN COALESCE(
--       CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' THEN vt.condition_id_norm ELSE NULL END,
--       erc.condition_id_decoded,
--       clob.condition_id_decoded
--     ) IS NULL THEN 1
--     ELSE 0
--   END AS is_orphan,
--
--   -- Orphan reason
--   CASE
--     WHEN COALESCE(
--       CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' THEN vt.condition_id_norm ELSE NULL END,
--       erc.condition_id_decoded,
--       clob.condition_id_decoded
--     ) IS NULL THEN 'no_matching_decode_source'
--     ELSE NULL
--   END AS orphan_reason,
--
--   now() AS version
--
-- FROM vw_trades_canonical vt
--
-- -- LEFT JOIN to CLOB repairs (match on tx_hash + wallet)
-- LEFT JOIN (
--   SELECT
--     tx_hash,
--     user_eoa AS wallet_address,
--     lpad(hex(bitShiftRight(CAST(asset_id AS UInt256), 2)), 64, '0') AS condition_id_decoded,
--     multiIf(
--       bitAnd(CAST(asset_id AS UInt256), 3) = 1, 0,
--       bitAnd(CAST(asset_id AS UInt256), 3) = 2, 1,
--       -1
--     ) AS outcome_index_decoded
--   FROM clob_fills
--   WHERE asset_id IS NOT NULL AND asset_id != ''
-- ) clob
--   ON vt.transaction_hash = clob.tx_hash
--   AND vt.wallet_address_norm = clob.wallet_address
--
-- -- LEFT JOIN to ERC1155 repairs (match on tx_hash + wallet)
-- LEFT JOIN (
--   SELECT
--     tx_hash,
--     to_address AS wallet_address,
--     lpad(hex(bitShiftRight(reinterpretAsUInt256(unhex(substring(token_id, 3))), 2)), 64, '0') AS condition_id_decoded,
--     multiIf(
--       bitAnd(reinterpretAsUInt256(unhex(substring(token_id, 3))), 3) = 1, 0,
--       bitAnd(reinterpretAsUInt256(unhex(substring(token_id, 3))), 3) = 2, 1,
--       -1
--     ) AS outcome_index_decoded
--   FROM erc1155_transfers
--   WHERE token_id IS NOT NULL AND token_id != ''
-- ) erc
--   ON vt.transaction_hash = erc.tx_hash
--   AND vt.wallet_address_norm = erc.wallet_address;
--
-- ============================================================================
-- Validation Queries
-- ============================================================================
--
-- Check repair coverage:
-- SELECT
--   id_repair_source,
--   COUNT(*) as trades,
--   COUNT(*) / (SELECT COUNT(*) FROM pm_trades_canonical_v2) * 100 as pct
-- FROM pm_trades_canonical_v2
-- GROUP BY id_repair_source
-- ORDER BY trades DESC;
--
-- Check orphan rate:
-- SELECT
--   is_orphan,
--   COUNT(*) as trades,
--   COUNT(*) / (SELECT COUNT(*) FROM pm_trades_canonical_v2) * 100 as pct
-- FROM pm_trades_canonical_v2
-- GROUP BY is_orphan;
--
-- Check condition_id improvements:
-- SELECT
--   'Original' AS source,
--   COUNT(CASE WHEN condition_id_norm_orig IS NULL OR condition_id_norm_orig = '' THEN 1 END) as nulls,
--   COUNT(*) as total,
--   COUNT(CASE WHEN condition_id_norm_orig IS NULL OR condition_id_norm_orig = '' THEN 1 END) / COUNT(*) * 100 as null_pct
-- FROM pm_trades_canonical_v2
-- UNION ALL
-- SELECT
--   'V2' AS source,
--   COUNT(CASE WHEN condition_id_norm_v2 IS NULL OR condition_id_norm_v2 = '' THEN 1 END) as nulls,
--   COUNT(*) as total,
--   COUNT(CASE WHEN condition_id_norm_v2 IS NULL OR condition_id_norm_v2 = '' THEN 1 END) / COUNT(*) * 100 as null_pct
-- FROM pm_trades_canonical_v2;
