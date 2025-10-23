-- =====================================================================
-- MARKET ANALYTICS TABLE - TRADE DATA AGGREGATION
-- =====================================================================
-- Purpose: Store aggregated trade metrics from Polymarket CLOB API
--          Similar to hashdive.com analytics (trade counts, momentum, etc.)
--
-- Data Source: Polymarket CLOB Trades API
--   - Endpoint: https://data-api.polymarket.com/trades
--   - Aggregation Window: Last 24 hours
--   - Updates: Via cron job or manual API trigger
--
-- Metrics Calculated:
--   - Trade volume and counts
--   - Unique buyer/seller counts
--   - Buy/Sell ratio (market sentiment)
--   - Momentum score (price velocity)
--   - Price change percentage
--
-- Author: backend-architect agent
-- Date: 2025-10-22
-- =====================================================================

-- =====================================================================
-- TABLE: market_analytics
-- =====================================================================
-- Stores calculated metrics from CLOB trade data
-- One row per market, updated periodically
-- =====================================================================

CREATE TABLE IF NOT EXISTS market_analytics (
  -- Primary Key (references markets table)
  market_id TEXT PRIMARY KEY REFERENCES markets(market_id) ON DELETE CASCADE,
  condition_id TEXT NOT NULL,

  -- Trade Counts (24h window)
  trades_24h INTEGER DEFAULT 0 NOT NULL,
  buyers_24h INTEGER DEFAULT 0 NOT NULL,  -- unique proxy wallets (BUY side)
  sellers_24h INTEGER DEFAULT 0 NOT NULL,  -- unique proxy wallets (SELL side)

  -- Trade Volume & Ratios (24h window)
  -- NUMERIC(18,2) handles up to $999,999,999,999,999.99
  buy_volume_24h NUMERIC(18, 2) DEFAULT 0 NOT NULL,
  sell_volume_24h NUMERIC(18, 2) DEFAULT 0 NOT NULL,

  -- Buy/Sell Ratio (sentiment indicator)
  -- Ratio > 1 = more buyers than sellers (bullish)
  -- Ratio < 1 = more sellers than buyers (bearish)
  -- NUMERIC(10,4) handles ratios like 2.5000 or 0.3333
  buy_sell_ratio NUMERIC(10, 4) DEFAULT 1.0 NOT NULL,

  -- Momentum Score (price velocity)
  -- Calculated as: (price_change / time_span_hours) * 100
  -- Positive = upward momentum, Negative = downward momentum
  momentum_score NUMERIC(10, 4) DEFAULT 0 NOT NULL,

  -- Price Change (24h window)
  -- Stored as percentage: 5.25 = +5.25%, -3.50 = -3.50%
  price_change_24h NUMERIC(10, 4) DEFAULT 0 NOT NULL,

  -- Metadata
  last_aggregated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT market_analytics_trades_check
    CHECK (trades_24h >= 0),

  CONSTRAINT market_analytics_buyers_check
    CHECK (buyers_24h >= 0),

  CONSTRAINT market_analytics_sellers_check
    CHECK (sellers_24h >= 0),

  CONSTRAINT market_analytics_volumes_check
    CHECK (buy_volume_24h >= 0 AND sell_volume_24h >= 0),

  CONSTRAINT market_analytics_ratio_check
    CHECK (buy_sell_ratio > 0)
    -- Ratio must be positive (division by zero prevented in code)
);

-- =====================================================================
-- INDEXES for market_analytics table
-- =====================================================================
-- Optimize for common query patterns
-- =====================================================================

-- Index 1: Primary key lookup (auto-created, included for documentation)
-- Used for: Joining with markets table, direct market_id queries

-- Index 2: Condition ID lookup (for CLOB API queries)
CREATE INDEX idx_market_analytics_condition_id
  ON market_analytics(condition_id);

-- Index 3: Last aggregation time (for finding stale data)
CREATE INDEX idx_market_analytics_last_aggregated
  ON market_analytics(last_aggregated_at DESC);

-- Index 4: Sort by trade volume (most active markets)
CREATE INDEX idx_market_analytics_trades_24h
  ON market_analytics(trades_24h DESC NULLS LAST);

-- Index 5: Sort by momentum (trending markets)
CREATE INDEX idx_market_analytics_momentum
  ON market_analytics(momentum_score DESC NULLS LAST);

-- Index 6: Sort by buy/sell ratio (sentiment analysis)
CREATE INDEX idx_market_analytics_buy_sell_ratio
  ON market_analytics(buy_sell_ratio DESC NULLS LAST);

-- Index 7: Composite index for active markets with analytics
-- Enables efficient joins: markets JOIN market_analytics
CREATE INDEX idx_market_analytics_composite
  ON market_analytics(market_id, trades_24h DESC, momentum_score DESC);

-- =====================================================================
-- TRIGGER: Auto-update updated_at timestamp
-- =====================================================================

CREATE OR REPLACE FUNCTION update_market_analytics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER market_analytics_updated
  BEFORE UPDATE ON market_analytics
  FOR EACH ROW
  EXECUTE FUNCTION update_market_analytics_timestamp();

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- Function: Get analytics staleness
-- Returns time since last analytics update
CREATE OR REPLACE FUNCTION get_analytics_staleness()
RETURNS INTERVAL AS $$
  SELECT NOW() - MAX(last_aggregated_at) FROM market_analytics;
$$ LANGUAGE sql STABLE;

-- Function: Check if analytics are stale
-- Returns TRUE if analytics are older than threshold (default 1 hour)
CREATE OR REPLACE FUNCTION are_analytics_stale(threshold_hours INTEGER DEFAULT 1)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    EXTRACT(EPOCH FROM (NOW() - MAX(last_aggregated_at))) / 3600 > threshold_hours,
    TRUE
  )
  FROM market_analytics;
$$ LANGUAGE sql STABLE;

-- Function: Get top markets by momentum
CREATE OR REPLACE FUNCTION get_top_momentum_markets(limit_count INTEGER DEFAULT 10)
RETURNS TABLE(
  market_id TEXT,
  momentum_score NUMERIC,
  price_change_24h NUMERIC,
  trades_24h INTEGER
) AS $$
  SELECT
    market_id,
    momentum_score,
    price_change_24h,
    trades_24h
  FROM market_analytics
  WHERE trades_24h > 0
  ORDER BY momentum_score DESC
  LIMIT limit_count;
$$ LANGUAGE sql STABLE;

-- Function: Get markets with highest buy/sell ratio
CREATE OR REPLACE FUNCTION get_most_bullish_markets(limit_count INTEGER DEFAULT 10)
RETURNS TABLE(
  market_id TEXT,
  buy_sell_ratio NUMERIC,
  buyers_24h INTEGER,
  sellers_24h INTEGER,
  trades_24h INTEGER
) AS $$
  SELECT
    market_id,
    buy_sell_ratio,
    buyers_24h,
    sellers_24h,
    trades_24h
  FROM market_analytics
  WHERE trades_24h > 0
  ORDER BY buy_sell_ratio DESC
  LIMIT limit_count;
$$ LANGUAGE sql STABLE;

-- =====================================================================
-- COMMENTS (for documentation)
-- =====================================================================

COMMENT ON TABLE market_analytics IS
  'Aggregated trade metrics from Polymarket CLOB API. Updated periodically via cron job. Stores 24h trade counts, volume, momentum, and sentiment indicators.';

COMMENT ON COLUMN market_analytics.market_id IS
  'Foreign key to markets table. Primary key for this table.';

COMMENT ON COLUMN market_analytics.condition_id IS
  'Polymarket condition ID used to fetch trades from CLOB API.';

COMMENT ON COLUMN market_analytics.trades_24h IS
  'Total number of trades in last 24 hours from CLOB API.';

COMMENT ON COLUMN market_analytics.buyers_24h IS
  'Count of unique proxy wallet addresses on BUY side in last 24h.';

COMMENT ON COLUMN market_analytics.sellers_24h IS
  'Count of unique proxy wallet addresses on SELL side in last 24h.';

COMMENT ON COLUMN market_analytics.buy_sell_ratio IS
  'Ratio of buyers to sellers (buyers_24h / sellers_24h). Values > 1 indicate bullish sentiment, < 1 indicate bearish.';

COMMENT ON COLUMN market_analytics.momentum_score IS
  'Price velocity: (price_change / time_span_hours) * 100. Measures how fast price is moving. Positive = upward momentum.';

COMMENT ON COLUMN market_analytics.price_change_24h IS
  'Percentage price change over 24h window. Calculated from first to last trade in window.';

COMMENT ON COLUMN market_analytics.last_aggregated_at IS
  'Timestamp when analytics were last calculated from CLOB API. Used to determine staleness.';

COMMENT ON FUNCTION get_analytics_staleness() IS
  'Returns time since last analytics update. Used to monitor aggregation job health.';

COMMENT ON FUNCTION are_analytics_stale(INTEGER) IS
  'Returns TRUE if analytics are older than threshold hours (default 1). Used to trigger re-aggregation.';

COMMENT ON FUNCTION get_top_momentum_markets(INTEGER) IS
  'Returns top N markets by momentum score. Useful for "trending markets" features.';

COMMENT ON FUNCTION get_most_bullish_markets(INTEGER) IS
  'Returns top N markets by buy/sell ratio. Useful for "bullish sentiment" features.';

-- =====================================================================
-- VALIDATION
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'market_analytics') THEN
    RAISE EXCEPTION 'market_analytics table was not created successfully';
  END IF;

  RAISE NOTICE 'market_analytics table created successfully!';
  RAISE NOTICE 'Ready for trade data aggregation from CLOB API.';
END $$;
