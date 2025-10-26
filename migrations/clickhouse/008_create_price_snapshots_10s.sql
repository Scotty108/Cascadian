-- Migration 008: Create price_snapshots_10s table
-- Purpose: Real-time price snapshots for watchlist markets (10-second intervals)
-- Priority: HIGH (Phase 2)

CREATE TABLE IF NOT EXISTS price_snapshots_10s (
  market_id String,
  timestamp DateTime64(3),
  side Enum8('YES'=1, 'NO'=2),

  mid_price Decimal(10, 6),
  best_bid Decimal(10, 6),
  best_ask Decimal(10, 6),
  spread_bps UInt16,
  bid_volume Decimal(18, 2),
  ask_volume Decimal(18, 2),

  snapshot_source Enum8('websocket'=1, 'api'=2, 'mirror'=3) DEFAULT 'websocket',
  created_at DateTime64(3) DEFAULT now64()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, side, timestamp)
SETTINGS index_granularity = 8192;

-- Index for fast time-range queries
CREATE INDEX IF NOT EXISTS idx_market_time ON price_snapshots_10s(market_id, timestamp)
  TYPE minmax GRANULARITY 4;

COMMENT ON TABLE price_snapshots_10s IS 'Real-time price snapshots for watchlist markets only (scoped for cost management)';
