-- Migration 009: Create market_price_history table
-- Purpose: High-frequency price snapshots for lag simulation and CLV calculation
-- Priority: MEDIUM (Phase 2)

CREATE TABLE IF NOT EXISTS market_price_history (
  market_id String,
  timestamp DateTime64(3) COMMENT 'Millisecond precision',

  -- Current Prices
  yes_price Decimal(10, 6) COMMENT 'Current YES token price (0-1)',
  no_price Decimal(10, 6) COMMENT 'Current NO token price (0-1)',

  -- Bid/Ask Spread
  yes_best_bid Decimal(10, 6),
  yes_best_ask Decimal(10, 6),
  no_best_bid Decimal(10, 6),
  no_best_ask Decimal(10, 6),

  -- Spread Metrics
  yes_spread_bps UInt16 COMMENT 'YES spread in basis points',
  no_spread_bps UInt16 COMMENT 'NO spread in basis points',

  -- Volume
  volume_1min Decimal(18, 2) COMMENT 'Volume in last 1 minute',
  volume_5min Decimal(18, 2) COMMENT 'Volume in last 5 minutes',
  volume_15min Decimal(18, 2) COMMENT 'Volume in last 15 minutes',

  -- Trade Count
  trade_count_1min UInt32,
  trade_count_5min UInt32,

  -- Metadata
  snapshot_source Enum8('polymarket_api'=1, 'websocket'=2, 'computed'=3),
  data_quality_score Decimal(3, 2) COMMENT '0-1 quality indicator'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (market_id, timestamp)
SETTINGS index_granularity = 8192;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recent_prices ON market_price_history(timestamp)
  TYPE minmax GRANULARITY 4;

CREATE INDEX IF NOT EXISTS idx_market_recent ON market_price_history(market_id, timestamp)
  TYPE minmax GRANULARITY 4;

COMMENT ON TABLE market_price_history IS 'High-frequency price history for lag simulation and CLV calculation';
