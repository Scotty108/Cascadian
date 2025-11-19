-- ============================================================================
-- Create pm_trades_external Table for AMM and Historical Trade Data
-- ============================================================================
-- Purpose: Ingest trades from external sources (Data API, Subgraph, AMM)
--          that are NOT captured by clob_fills
--
-- Sources:
--   1. Polymarket Data API (/trades endpoint) - AMM trades
--   2. Polymarket Subgraph (GraphQL) - Historical blockchain trades
--   3. Dune Analytics - Aggregated historical data
--
-- Schema: IDENTICAL to pm_trades view for seamless UNION
-- ============================================================================

CREATE TABLE IF NOT EXISTS pm_trades_external
(
  -- Event Identification
  fill_id                String COMMENT 'Unique trade ID from external source',
  block_time             DateTime COMMENT 'Trade timestamp',
  block_number           UInt64 DEFAULT 0 COMMENT 'Block number (0 if unavailable)',
  tx_hash                String DEFAULT '' COMMENT 'Transaction hash (if available)',

  -- Asset & Market (CLOB IDs)
  asset_id_decimal       String COMMENT 'CLOB asset ID (76-78 chars decimal)',

  -- Canonical Anchors (from external source or mapped internally)
  condition_id           String COMMENT 'Normalized condition ID (64-char hex)',
  outcome_index          UInt8 COMMENT '0-based outcome index',
  outcome_label          String COMMENT 'Outcome label (Yes/No/etc)',
  question               String COMMENT 'Market question',

  -- Wallet Information
  wallet_address         String COMMENT 'Proxy wallet or direct EOA (lowercase)',
  operator_address       String DEFAULT '' COMMENT 'EOA operator (lowercase)',
  is_proxy_trade         UInt8 DEFAULT 0 COMMENT '1 if proxy != EOA, else 0',

  -- Trade Details
  side                   LowCardinality(String) COMMENT 'BUY or SELL',
  price                  Float64 COMMENT 'Price per share (0-1 probability)',
  shares                 Float64 COMMENT 'Number of shares traded',
  collateral_amount      Float64 COMMENT 'USDC notional value',
  fee_amount             Float64 DEFAULT 0.0 COMMENT 'Fee in USDC',

  -- Source Tracking
  data_source            LowCardinality(String) COMMENT 'Source: data_api, subgraph, dune, amm',

  -- Metadata
  ingested_at            DateTime DEFAULT now() COMMENT 'When inserted into our DB',
  source_metadata        String DEFAULT '' COMMENT 'JSON with source-specific fields'
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (condition_id, wallet_address, block_time, fill_id)
PARTITION BY toYYYYMM(block_time)
SETTINGS index_granularity = 8192
COMMENT 'External trade data from Data API, Subgraph, and AMM sources';

-- ============================================================================
-- Create indexes for fast lookups
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_pm_trades_external_wallet
  ON pm_trades_external (wallet_address)
  TYPE bloom_filter(0.01) GRANULARITY 1;

CREATE INDEX IF NOT EXISTS idx_pm_trades_external_condition
  ON pm_trades_external (condition_id)
  TYPE bloom_filter(0.01) GRANULARITY 1;

CREATE INDEX IF NOT EXISTS idx_pm_trades_external_source
  ON pm_trades_external (data_source)
  TYPE bloom_filter(0.01) GRANULARITY 1;

-- ============================================================================
-- Create pm_trades_complete: UNION of CLOB and External
-- ============================================================================
-- This view combines:
--   1. pm_trades (CLOB fills from clob_fills table)
--   2. pm_trades_external (AMM + historical from external APIs)
--
-- NOTE: Does NOT create duplicate-prone UNION. External sources should be
--       filtered to exclude data already in clob_fills.
-- ============================================================================

CREATE OR REPLACE VIEW pm_trades_complete AS
-- CLOB trades (existing pipeline)
SELECT
  fill_id,
  block_time,
  block_number,
  tx_hash,
  asset_id_decimal,
  condition_id,
  outcome_index,
  outcome_label,
  question,
  wallet_address,
  operator_address,
  is_proxy_trade,
  side,
  price,
  shares,
  collateral_amount,
  fee_amount,
  data_source
FROM pm_trades

UNION ALL

-- External trades (AMM, historical, etc.)
SELECT
  fill_id,
  block_time,
  block_number,
  tx_hash,
  asset_id_decimal,
  condition_id,
  outcome_index,
  outcome_label,
  question,
  wallet_address,
  operator_address,
  is_proxy_trade,
  side,
  price,
  shares,
  collateral_amount,
  fee_amount,
  data_source
FROM pm_trades_external;

-- ============================================================================
-- Verification Queries
-- ============================================================================

SELECT '✅ pm_trades_external table created successfully!' AS status;

SELECT 'Run these queries to verify:' AS next_steps;
SELECT '1. SELECT COUNT(*) FROM pm_trades_external' AS verify_table;
SELECT '2. SELECT data_source, COUNT(*) FROM pm_trades_external GROUP BY data_source' AS verify_sources;
SELECT '3. SELECT COUNT(*) FROM pm_trades_complete' AS verify_union;
SELECT '4. SELECT data_source, COUNT(*) cnt FROM pm_trades_complete GROUP BY data_source ORDER BY cnt DESC' AS verify_breakdown;

-- ============================================================================
-- Usage Notes
-- ============================================================================
--
-- 1. Ingest AMM trades for ghost markets:
--    npx tsx scripts/ingest-amm-trades-from-data-api.ts
--
-- 2. Backfill historical trades (pre-Aug 21, 2024):
--    npx tsx scripts/backfill-historical-trades-from-subgraph.ts
--
-- 3. Query unified trade data:
--    SELECT * FROM pm_trades_complete WHERE wallet_address = '0x...'
--
-- 4. Check data source distribution:
--    SELECT data_source, COUNT(*) FROM pm_trades_complete GROUP BY data_source
--
-- ============================================================================
