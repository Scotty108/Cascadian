-- ============================================================================
-- ClickHouse Ingestion Spine Tables
-- Creates dimension tables and cache for complete data enrichment
-- ============================================================================

-- ============================================================================
-- 1. ALTER trades_raw to ensure all required columns exist
-- ============================================================================

-- Add missing columns if they don't exist
ALTER TABLE trades_raw
  ADD COLUMN IF NOT EXISTS tx_timestamp DateTime DEFAULT timestamp
  COMMENT 'Transaction timestamp (alias for timestamp)';

ALTER TABLE trades_raw
  ADD COLUMN IF NOT EXISTS realized_pnl_usd Float64 DEFAULT 0.0
  COMMENT 'Realized P&L in USD (calculated after resolution)';

ALTER TABLE trades_raw
  ADD COLUMN IF NOT EXISTS is_resolved UInt8 DEFAULT 0
  COMMENT 'Whether this trade is on a resolved market (0=no, 1=yes)';

-- Ensure market_id can handle empty/unknown values
-- (Already exists from 001_create_trades_table.sql, but verify it's not nullable)
-- ALTER TABLE trades_raw MODIFY COLUMN market_id String DEFAULT '';

-- ============================================================================
-- 2. condition_market_map - Cache table for condition → market lookups
-- ============================================================================

CREATE TABLE IF NOT EXISTS condition_market_map (
  condition_id String COMMENT 'Blockchain condition ID from CTF Exchange',
  market_id String COMMENT 'Polymarket market ID',
  event_id String COMMENT 'Polymarket event ID (nullable if not associated)',
  canonical_category String COMMENT 'Canonical category from tag mapping',
  raw_tags Array(String) COMMENT 'Raw Polymarket tags array',
  ingested_at DateTime DEFAULT now() COMMENT 'When this mapping was cached'
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (condition_id)
SETTINGS index_granularity = 8192
COMMENT 'Cache of condition_id → market metadata. Prevents external API calls.';

-- Index for fast condition lookups
CREATE INDEX IF NOT EXISTS idx_condition_market_map_condition
  ON condition_market_map (condition_id)
  TYPE bloom_filter(0.01) GRANULARITY 1;

-- Index for market_id reverse lookups
CREATE INDEX IF NOT EXISTS idx_condition_market_map_market
  ON condition_market_map (market_id)
  TYPE bloom_filter(0.01) GRANULARITY 1;

-- ============================================================================
-- 3. markets_dim - Market dimension table
-- ============================================================================

CREATE TABLE IF NOT EXISTS markets_dim (
  market_id String COMMENT 'Polymarket market ID',
  question String COMMENT 'Market question text',
  event_id String COMMENT 'Associated event ID',
  ingested_at DateTime DEFAULT now() COMMENT 'When this record was inserted'
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (market_id)
SETTINGS index_granularity = 8192
COMMENT 'Market dimension table with questions and event associations';

-- ============================================================================
-- 4. events_dim - Event dimension table
-- ============================================================================

CREATE TABLE IF NOT EXISTS events_dim (
  event_id String COMMENT 'Polymarket event ID',
  canonical_category String COMMENT 'Canonical category from tag mapping',
  raw_tags Array(String) COMMENT 'Raw Polymarket tags array',
  title String COMMENT 'Event title',
  ingested_at DateTime DEFAULT now() COMMENT 'When this record was inserted'
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (event_id)
SETTINGS index_granularity = 8192
COMMENT 'Event dimension table with categories and tags';

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_events_dim_category
  ON events_dim (canonical_category)
  TYPE bloom_filter(0.01) GRANULARITY 1;

-- ============================================================================
-- Verification
-- ============================================================================

SELECT '✅ Ingestion spine tables created successfully!' AS status;
SELECT '✅ Tables: trades_raw (enriched), condition_market_map, markets_dim, events_dim' AS info;
