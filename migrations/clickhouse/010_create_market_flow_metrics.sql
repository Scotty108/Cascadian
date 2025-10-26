-- Migration 010: Create market_flow_metrics table
-- Purpose: Track "smart money" vs "crowd money" divergence for real-time signals
-- Priority: HIGH (Phase 2)

CREATE TABLE IF NOT EXISTS market_flow_metrics (
  market_id String,
  timestamp DateTime,

  -- Price Momentum
  current_yes_price Decimal(10, 6),
  price_change_1h Decimal(10, 6),
  price_change_24h Decimal(10, 6),
  price_momentum_7d Decimal(10, 4) COMMENT '% change over 7 days',

  -- Volume Distribution (Last 24h)
  total_volume_24h Decimal(18, 2),
  yes_volume_24h Decimal(18, 2),
  no_volume_24h Decimal(18, 2),

  -- Crowd Flow (ALL wallets)
  crowd_yes_volume Decimal(18, 2) COMMENT 'Non-elite wallet $ on YES',
  crowd_no_volume Decimal(18, 2) COMMENT 'Non-elite wallet $ on NO',
  crowd_flow_ratio Decimal(10, 4) COMMENT 'crowd_yes / crowd_no',
  crowd_yes_pct Decimal(5, 4) COMMENT '% of crowd $ on YES',

  -- Elite Flow (Omega>2.0 wallets only)
  elite_yes_volume Decimal(18, 2) COMMENT 'Elite wallet $ on YES',
  elite_no_volume Decimal(18, 2) COMMENT 'Elite wallet $ on NO',
  elite_flow_ratio Decimal(10, 4) COMMENT 'elite_yes / elite_no - KEY METRIC',
  elite_yes_pct Decimal(5, 4) COMMENT '% of elite $ on YES',

  -- THE GOLDEN SIGNAL
  crowd_elite_divergence Decimal(10, 4) COMMENT 'elite_flow_ratio - crowd_flow_ratio',
  divergence_z_score Decimal(10, 4) COMMENT 'Z-score of divergence (normalized)',
  signal_strength Enum8('weak'=1, 'moderate'=2, 'strong'=3, 'extreme'=4),

  -- Context
  elite_wallet_count UInt16 COMMENT 'How many elite wallets are betting',
  crowd_wallet_count UInt32 COMMENT 'How many crowd wallets',

  -- Metadata
  category String,
  market_close_time DateTime,
  calculated_at DateTime
)
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, timestamp)
SETTINGS index_granularity = 8192;

-- Index for real-time signal queries
CREATE INDEX IF NOT EXISTS idx_high_divergence ON market_flow_metrics(divergence_z_score)
  TYPE minmax GRANULARITY 4;

CREATE INDEX IF NOT EXISTS idx_recent_signals ON market_flow_metrics(timestamp)
  TYPE minmax GRANULARITY 4;

COMMENT ON TABLE market_flow_metrics IS 'Smart money vs crowd divergence - the golden signal for elite vs crowd bets';
