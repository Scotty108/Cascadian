-- =====================================================================
-- POLYMARKET INTEGRATION SCHEMA (PHASE 1)
-- =====================================================================
-- Purpose: Store Polymarket market data with efficient querying for the
--          CASCADIAN platform's Market Screener and Event Detail pages.
--
-- Design Goals:
--   1. Support UPSERT pattern for batch syncing 500+ markets
--   2. Optimize for screener query patterns (filters, sorts, search)
--   3. Store both raw JSON (debugging) + parsed fields (performance)
--   4. Future-proof with Phase 2 signal columns (momentum, SII, etc.)
--   5. Enable full-text search on market titles
--
-- Query Patterns Optimized:
--   - Filter by active status + category
--   - Sort by volume_24h DESC (default screener sort)
--   - Sort by end_date ASC (markets closing soon)
--   - Search by title (fuzzy matching with pg_trgm)
--   - Get single market by market_id
--
-- Author: database-architect agent
-- Date: 2025-10-22
-- =====================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- For fuzzy text search

-- =====================================================================
-- TABLE: markets
-- =====================================================================
-- Stores current state of all Polymarket markets
-- UPSERT-friendly with market_id as PRIMARY KEY
-- =====================================================================

CREATE TABLE IF NOT EXISTS markets (
  -- Primary Key
  market_id TEXT PRIMARY KEY,

  -- Market Identity
  title TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL, -- URL-friendly slug from Polymarket
  condition_id TEXT, -- Polymarket condition ID

  -- Market Metadata
  category TEXT, -- 'Politics', 'Sports', 'Crypto', etc.
  tags TEXT[], -- Array of tag strings
  image_url TEXT,

  -- Market Outcomes
  outcomes TEXT[] NOT NULL DEFAULT ARRAY['Yes', 'No'], -- Binary outcomes

  -- Current Pricing (from Polymarket API)
  -- NUMERIC(18,8) provides 8 decimals for prices (0.00000001 to 0.99999999)
  current_price NUMERIC(18, 8), -- YES outcome price (0-1)
  outcome_prices NUMERIC(18, 8)[], -- Array: [yes_price, no_price]

  -- Volume & Liquidity (USD)
  -- NUMERIC(18,2) handles up to $999,999,999,999,999.99
  volume_24h NUMERIC(18, 2) DEFAULT 0,
  volume_total NUMERIC(18, 2) DEFAULT 0,
  liquidity NUMERIC(18, 2) DEFAULT 0,

  -- Market Status
  active BOOLEAN DEFAULT TRUE NOT NULL,
  closed BOOLEAN DEFAULT FALSE NOT NULL,
  end_date TIMESTAMPTZ,

  -- Phase 2 Signals (NULL in Phase 1, populated later)
  -- These columns exist now to avoid ALTER TABLE in Phase 2
  momentum_score NUMERIC(5, 2), -- Range: -100.00 to +100.00
  sii_score NUMERIC(5, 2), -- Smart Imbalance Index: -100.00 to +100.00
  smart_money_delta NUMERIC(5, 4), -- Range: -1.0000 to +1.0000
  last_trade_timestamp TIMESTAMPTZ, -- When last trade occurred

  -- Raw API Response (for debugging and audit)
  -- JSONB provides indexing + efficient storage
  raw_polymarket_data JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT markets_status_check
    CHECK (NOT (active = TRUE AND closed = TRUE)),
    -- Cannot be both active and closed

  CONSTRAINT markets_volume_24h_check
    CHECK (volume_24h <= volume_total OR volume_total = 0),
    -- 24h volume cannot exceed total volume

  CONSTRAINT markets_price_range_check
    CHECK (current_price IS NULL OR (current_price >= 0 AND current_price <= 1)),
    -- Price must be between 0 and 1

  CONSTRAINT markets_end_date_check
    CHECK (
      closed = TRUE OR
      end_date IS NULL OR
      end_date > created_at
    )
    -- Active markets must have end_date in future (or NULL)
);

-- =====================================================================
-- INDEXES for markets table
-- =====================================================================
-- Index strategy: Cover all screener query patterns
-- =====================================================================

-- Index 1: Active markets filter (used on every screener query)
CREATE INDEX idx_markets_active
  ON markets(active)
  WHERE active = TRUE;

-- Index 2: Category filter (frequently used for filtering)
CREATE INDEX idx_markets_category
  ON markets(category)
  WHERE active = TRUE; -- Partial index for active markets only

-- Index 3: Volume sorting (default screener sort)
CREATE INDEX idx_markets_volume_24h
  ON markets(volume_24h DESC NULLS LAST)
  WHERE active = TRUE;

-- Index 4: End date sorting (markets closing soon)
CREATE INDEX idx_markets_end_date
  ON markets(end_date ASC NULLS LAST)
  WHERE active = TRUE AND closed = FALSE;

-- Index 5: Full-text search on title (fuzzy matching)
-- Uses pg_trgm extension for "ILIKE '%bitcoin%'" type queries
CREATE INDEX idx_markets_title_trgm
  ON markets
  USING gin(title gin_trgm_ops);

-- Index 6: Composite index for category + volume sort (covering index)
-- Speeds up: WHERE category = 'Sports' ORDER BY volume_24h DESC
CREATE INDEX idx_markets_category_volume
  ON markets(category, volume_24h DESC)
  WHERE active = TRUE;

-- Index 7: JSONB index for raw_polymarket_data queries (if needed)
CREATE INDEX idx_markets_raw_data_gin
  ON markets
  USING gin(raw_polymarket_data);

-- Index 8: Phase 2 signal indexes (for future queries)
CREATE INDEX idx_markets_momentum_score
  ON markets(momentum_score DESC NULLS LAST)
  WHERE active = TRUE AND momentum_score IS NOT NULL;

CREATE INDEX idx_markets_sii_score
  ON markets(sii_score DESC NULLS LAST)
  WHERE active = TRUE AND sii_score IS NOT NULL;

-- =====================================================================
-- TRIGGER: Auto-update updated_at timestamp
-- =====================================================================

CREATE OR REPLACE FUNCTION update_markets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW
  EXECUTE FUNCTION update_markets_updated_at();

-- =====================================================================
-- TABLE: sync_logs
-- =====================================================================
-- Tracks every sync operation for monitoring and debugging
-- =====================================================================

CREATE TABLE IF NOT EXISTS sync_logs (
  -- Primary Key
  id BIGSERIAL PRIMARY KEY,

  -- Sync Timing
  sync_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_completed_at TIMESTAMPTZ,
  duration_ms INTEGER, -- Calculated duration in milliseconds

  -- Sync Results
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  markets_fetched INTEGER DEFAULT 0, -- How many markets from API
  markets_synced INTEGER DEFAULT 0, -- How many successfully upserted
  markets_failed INTEGER DEFAULT 0, -- How many failed to upsert

  -- Error Tracking
  error_message TEXT,
  error_stack TEXT,

  -- API Performance
  api_response_time_ms INTEGER, -- Polymarket API response time
  api_rate_limited BOOLEAN DEFAULT FALSE, -- Did we hit 429?

  -- Metadata
  triggered_by TEXT, -- 'cron', 'manual', 'api_request'
  sync_config JSONB, -- Capture sync configuration

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for querying recent sync logs
CREATE INDEX idx_sync_logs_started_at
  ON sync_logs(sync_started_at DESC);

-- Index for finding failures
CREATE INDEX idx_sync_logs_status
  ON sync_logs(status)
  WHERE status IN ('failed', 'partial');

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- Function: Get staleness of market data
CREATE OR REPLACE FUNCTION get_market_data_staleness()
RETURNS INTERVAL AS $$
  SELECT NOW() - MAX(updated_at) FROM markets;
$$ LANGUAGE sql STABLE;

-- Function: Get last successful sync info
CREATE OR REPLACE FUNCTION get_last_successful_sync()
RETURNS TABLE(
  sync_id BIGINT,
  completed_at TIMESTAMPTZ,
  markets_synced INTEGER,
  duration_ms INTEGER
) AS $$
  SELECT
    id,
    sync_completed_at,
    markets_synced,
    duration_ms
  FROM sync_logs
  WHERE status = 'success'
  ORDER BY sync_completed_at DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Function: Calculate market staleness status
CREATE OR REPLACE FUNCTION is_market_data_stale(threshold_minutes INTEGER DEFAULT 5)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    EXTRACT(EPOCH FROM (NOW() - MAX(updated_at))) / 60 > threshold_minutes,
    TRUE
  )
  FROM markets;
$$ LANGUAGE sql STABLE;

-- =====================================================================
-- COMMENTS (for documentation)
-- =====================================================================

COMMENT ON TABLE markets IS
  'Stores current state of all Polymarket markets. Optimized for UPSERT pattern (batch syncs) and screener queries (filters, sorts, search).';

COMMENT ON COLUMN markets.market_id IS
  'Unique market identifier from Polymarket API. Used as PRIMARY KEY for UPSERT operations.';

COMMENT ON COLUMN markets.raw_polymarket_data IS
  'Complete JSON response from Polymarket API. Useful for debugging mismatches and audit trail.';

COMMENT ON COLUMN markets.momentum_score IS
  'Phase 2 signal: Momentum score (-100 to +100). NULL in Phase 1, populated by signal generation job in Phase 2.';

COMMENT ON COLUMN markets.sii_score IS
  'Phase 2 signal: Smart Imbalance Index (-100 to +100). NULL in Phase 1, measures smart money positioning.';

COMMENT ON COLUMN markets.smart_money_delta IS
  'Phase 2 signal: Net smart money flow (-1 to +1). NULL in Phase 1, calculated from high-WIS wallet positions.';

COMMENT ON COLUMN markets.volume_24h IS
  'Trading volume in USD over last 24 hours. Updated on every sync. Used for default screener sort.';

COMMENT ON INDEX idx_markets_title_trgm IS
  'GIN index using pg_trgm for fuzzy text search. Enables fast "WHERE title ILIKE ''%search%''" queries.';

COMMENT ON INDEX idx_markets_category_volume IS
  'Covering index for common query: filter by category + sort by volume. Avoids table scan.';

COMMENT ON TABLE sync_logs IS
  'Audit log of all market sync operations. Tracks success/failure, performance, and errors for monitoring.';

COMMENT ON FUNCTION get_market_data_staleness() IS
  'Returns time since last market update. Used to determine if sync is needed.';

COMMENT ON FUNCTION is_market_data_stale(INTEGER) IS
  'Returns TRUE if market data is older than threshold (default 5 minutes). Used by sync orchestrator.';

-- =====================================================================
-- INITIAL DATA VALIDATION
-- =====================================================================

-- Verify tables were created successfully
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'markets') THEN
    RAISE EXCEPTION 'markets table was not created successfully';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_logs') THEN
    RAISE EXCEPTION 'sync_logs table was not created successfully';
  END IF;

  RAISE NOTICE 'Polymarket tables created successfully!';
  RAISE NOTICE 'Run the seed script to insert test data.';
END $$;
