-- ============================================================================
-- Enhance Polymarket Tables for Complete Data Pipeline
-- ============================================================================
-- This migration adds missing columns and creates views for enriched market data
--
-- Prerequisites:
--   - gamma_markets table exists
--   - market_resolutions_final table exists (optional)
--   - ctf_token_map table exists
--
-- Run after:
--   - flatten-erc1155.ts (populates pm_erc1155_flats)
--   - build-approval-proxies.ts (populates pm_user_proxy_wallets)
--   - decode-transfer-batch.ts (decodes batch transfers)
-- ============================================================================

-- ============================================================================
-- 1. Enhance ctf_token_map with market metadata
-- ============================================================================

-- Add market_id column to link tokens to markets
ALTER TABLE ctf_token_map
  ADD COLUMN IF NOT EXISTS market_id String DEFAULT ''
  COMMENT 'Polymarket market ID from gamma_markets';

-- Add outcome label column
ALTER TABLE ctf_token_map
  ADD COLUMN IF NOT EXISTS outcome String DEFAULT ''
  COMMENT 'Outcome label (Yes/No or specific outcome name)';

-- Add outcome index column
ALTER TABLE ctf_token_map
  ADD COLUMN IF NOT EXISTS outcome_index UInt8 DEFAULT 0
  COMMENT 'Index of outcome in market outcomes array (0-based)';

-- Add question text for easier debugging
ALTER TABLE ctf_token_map
  ADD COLUMN IF NOT EXISTS question String DEFAULT ''
  COMMENT 'Market question text from gamma_markets';

-- ============================================================================
-- 2. Create index on condition_id_norm for faster joins
-- ============================================================================

-- Note: ClickHouse doesn't support traditional indexes the same way
-- Instead, use bloom filter for condition_id lookups
CREATE INDEX IF NOT EXISTS idx_ctf_token_map_condition
  ON ctf_token_map (condition_id_norm)
  TYPE bloom_filter(0.01) GRANULARITY 1;

-- Index on market_id for reverse lookups
CREATE INDEX IF NOT EXISTS idx_ctf_token_map_market
  ON ctf_token_map (market_id)
  TYPE bloom_filter(0.01) GRANULARITY 1;

-- ============================================================================
-- 3. Create pm_trades table for CLOB fills (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pm_trades
(
  id                 String COMMENT 'Unique trade ID from CLOB API',
  market_id          String COMMENT 'Polymarket market ID',
  asset_id           String COMMENT 'Token ID (same as token_id in other tables)',
  side               LowCardinality(String) COMMENT 'BUY or SELL',
  size               String COMMENT 'Trade size in outcome tokens',
  price              Float64 COMMENT 'Price (0-1 probability)',
  fee_rate_bps       UInt16 COMMENT 'Fee rate in basis points',
  maker_address      String COMMENT 'Maker address (lowercase)',
  taker_address      String COMMENT 'Taker address (lowercase)',
  maker_orders       Array(String) COMMENT 'Array of maker order IDs',
  taker_order_id     String COMMENT 'Taker order ID',
  transaction_hash   String COMMENT 'Blockchain transaction hash',
  timestamp          DateTime COMMENT 'Trade execution timestamp',
  created_at         DateTime DEFAULT now() COMMENT 'Record insertion time',

  -- Enriched fields (can be populated later)
  outcome            String DEFAULT '' COMMENT 'Outcome label from token map',
  question           String DEFAULT '' COMMENT 'Market question',
  size_usd           Float64 DEFAULT 0.0 COMMENT 'Trade size in USD (size * price)',
  maker_fee_usd      Float64 DEFAULT 0.0 COMMENT 'Maker fee in USD',
  taker_fee_usd      Float64 DEFAULT 0.0 COMMENT 'Taker fee in USD'
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (market_id, timestamp, id)
PARTITION BY toYYYYMM(timestamp)
SETTINGS index_granularity = 8192
COMMENT 'CLOB trade fills from Polymarket API with full order matching data';

-- Index for address lookups
CREATE INDEX IF NOT EXISTS idx_pm_trades_maker
  ON pm_trades (maker_address)
  TYPE bloom_filter(0.01) GRANULARITY 1;

CREATE INDEX IF NOT EXISTS idx_pm_trades_taker
  ON pm_trades (taker_address)
  TYPE bloom_filter(0.01) GRANULARITY 1;

-- ============================================================================
-- 4. Create materialized view: markets_enriched
-- ============================================================================
-- Combines gamma_markets with resolution data for complete market view

CREATE OR REPLACE VIEW markets_enriched AS
SELECT
  m.market_id,
  m.condition_id,
  m.question,
  m.outcomes,
  m.end_date_iso,
  m.tags,
  m.category,
  m.volume,
  m.volume_num,
  m.liquidity,
  m.question_id,
  m.enable_order_book,
  m.ingested_at AS market_ingested_at,

  -- Resolution data (if available)
  r.winner,
  r.winning_outcome_index,
  r.resolution_source,
  r.resolved_at,
  r.payout_hash,
  IF(r.is_resolved = 1, 1, 0) AS is_resolved,
  r.ingested_at AS resolution_ingested_at

FROM gamma_markets m
LEFT JOIN market_resolutions_final r
  ON m.market_id = r.market_id;

-- ============================================================================
-- 5. Create materialized view: token_market_enriched
-- ============================================================================
-- Complete token metadata with market and resolution info

CREATE OR REPLACE VIEW token_market_enriched AS
SELECT
  t.token_id,
  t.condition_id_norm,
  t.market_id,
  t.outcome,
  t.outcome_index,
  t.question,

  -- Market details
  m.outcomes AS all_outcomes,
  m.end_date_iso,
  m.category,
  m.volume,
  m.liquidity,

  -- Resolution data
  m.is_resolved,
  m.winner,
  m.winning_outcome_index,

  -- Determine if this token is the winner
  IF(
    m.is_resolved = 1 AND t.outcome_index = m.winning_outcome_index,
    1,
    0
  ) AS is_winning_outcome

FROM ctf_token_map t
LEFT JOIN markets_enriched m
  ON t.market_id = m.market_id
WHERE t.market_id != '';

-- ============================================================================
-- 6. Create helper view: proxy_wallets_active
-- ============================================================================
-- Only active proxy wallet mappings for easy joins

CREATE OR REPLACE VIEW proxy_wallets_active AS
SELECT
  user_eoa,
  proxy_wallet,
  source,
  first_seen_at,
  last_seen_at
FROM pm_user_proxy_wallets
WHERE is_active = 1;

-- ============================================================================
-- 7. Create helper view: erc1155_transfers_enriched
-- ============================================================================
-- Flattened transfers with market context

CREATE OR REPLACE VIEW erc1155_transfers_enriched AS
SELECT
  f.block_number,
  f.block_time,
  f.tx_hash,
  f.log_index,
  f.operator,
  f.from_addr,
  f.to_addr,
  f.token_id,
  f.amount,
  f.event_type,

  -- Market context
  t.market_id,
  t.outcome,
  t.outcome_index,
  t.question,
  t.is_winning_outcome,
  t.category,

  -- Proxy context for from_addr
  pf.user_eoa AS from_eoa,
  IF(pf.user_eoa != '', 'proxy', 'direct') AS from_type,

  -- Proxy context for to_addr
  pt.user_eoa AS to_eoa,
  IF(pt.user_eoa != '', 'proxy', 'direct') AS to_type

FROM pm_erc1155_flats f
LEFT JOIN token_market_enriched t
  ON f.token_id = t.token_id
LEFT JOIN proxy_wallets_active pf
  ON lower(f.from_addr) = lower(pf.proxy_wallet)
LEFT JOIN proxy_wallets_active pt
  ON lower(f.to_addr) = lower(pt.proxy_wallet);

-- ============================================================================
-- 8. Create aggregated view: wallet_positions_current
-- ============================================================================
-- Current position holdings per wallet per token

CREATE OR REPLACE VIEW wallet_positions_current AS
SELECT
  to_addr AS wallet,
  token_id,
  market_id,
  outcome,
  SUM(reinterpretAsUInt256(reverse(unhex(substring(amount, 3))))) AS total_received,
  COUNT(*) AS transfer_count,
  max(block_time) AS last_updated
FROM erc1155_transfers_enriched
WHERE market_id != ''
GROUP BY wallet, token_id, market_id, outcome;

-- ============================================================================
-- Verification Queries
-- ============================================================================

SELECT '✅ Polymarket tables enhanced successfully!' AS status;

SELECT 'Run these queries to verify:' AS next_steps;
SELECT '1. SELECT COUNT(*) FROM ctf_token_map WHERE market_id != ''' AS verify_token_map;
SELECT '2. SELECT * FROM markets_enriched LIMIT 5' AS verify_markets;
SELECT '3. SELECT * FROM token_market_enriched LIMIT 5' AS verify_tokens;
SELECT '4. SELECT COUNT(*) FROM pm_erc1155_flats' AS verify_flats;
SELECT '5. SELECT COUNT(*) FROM pm_user_proxy_wallets WHERE is_active = 1' AS verify_proxies;

-- ============================================================================
-- Next Steps
-- ============================================================================
-- After running this migration:
--
-- 1. Populate ctf_token_map.market_id with this UPDATE:
--
--    UPDATE ctf_token_map
--    SET
--      market_id = m.market_id,
--      outcome = arrayElement(m.outcomes, outcome_index + 1),
--      question = m.question
--    FROM gamma_markets m
--    WHERE ctf_token_map.condition_id_norm = m.condition_id;
--
-- 2. Ingest CLOB fills using:
--    npx tsx scripts/ingest-clob-fills.ts
--
-- 3. Build position analytics using views:
--    - wallet_positions_current
--    - erc1155_transfers_enriched
--
-- ============================================================================
