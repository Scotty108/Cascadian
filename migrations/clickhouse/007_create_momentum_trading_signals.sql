-- Migration 007: Create momentum_trading_signals table
-- Purpose: Store TSI-based trading signals (ENTRY/EXIT/HOLD) with directional conviction
-- Priority: HIGH (Phase 2 - Austin's Strategy)

CREATE TABLE IF NOT EXISTS momentum_trading_signals (
  -- Identity
  signal_id String DEFAULT generateUUIDv4() COMMENT 'Unique signal identifier',
  market_id String NOT NULL COMMENT 'Market this signal is for',
  signal_timestamp DateTime64(3) DEFAULT now64() COMMENT 'When signal was generated',

  -- Signal Type (Austin's Strategy: ENTRY/EXIT/HOLD)
  signal_type Enum8('ENTRY'=1, 'EXIT'=2, 'HOLD'=3) NOT NULL COMMENT 'Entry, exit, or hold',
  signal_direction Enum8('YES'=1, 'NO'=2) DEFAULT NULL COMMENT 'Direction for entry signals',

  -- TSI Context
  tsi_fast Decimal(12, 8) NOT NULL COMMENT 'TSI fast line value at signal',
  tsi_slow Decimal(12, 8) NOT NULL COMMENT 'TSI slow line value at signal',
  crossover_type Enum8('BULLISH'=1, 'BEARISH'=2) DEFAULT NULL COMMENT 'Type of crossover that triggered',
  tsi_fast_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) NOT NULL COMMENT 'Smoothing method used',
  tsi_slow_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) NOT NULL COMMENT 'Smoothing method used',

  -- Directional Conviction (Austin's "90% confident")
  directional_conviction Decimal(5, 4) NOT NULL COMMENT 'Conviction score (0-1)',
  elite_consensus_pct Decimal(5, 4) NOT NULL COMMENT 'Elite wallet agreement %',
  category_specialist_pct Decimal(5, 4) DEFAULT NULL COMMENT 'Category specialist agreement %',
  omega_weighted_consensus Decimal(5, 4) DEFAULT NULL COMMENT 'Omega-weighted agreement',

  -- Elite Attribution
  elite_wallets_yes UInt16 DEFAULT 0 COMMENT 'Count of elite wallets on YES',
  elite_wallets_no UInt16 DEFAULT 0 COMMENT 'Count of elite wallets on NO',
  elite_wallets_total UInt16 DEFAULT 0 COMMENT 'Total elite wallets in market',

  -- Market Context
  mid_price Decimal(10, 6) NOT NULL COMMENT 'Mid price at signal time',
  volume_24h Decimal(18, 2) DEFAULT NULL COMMENT '24h volume at signal',
  liquidity_depth Decimal(18, 2) DEFAULT NULL COMMENT 'Total order book depth',

  -- Signal Metadata
  signal_strength Enum8('WEAK'=1, 'MODERATE'=2, 'STRONG'=3, 'VERY_STRONG'=4) NOT NULL COMMENT 'Signal quality',
  confidence_score Decimal(5, 4) NOT NULL COMMENT 'Overall confidence (0-1)',
  meets_entry_threshold Boolean DEFAULT 0 COMMENT 'conviction >= 0.9',

  -- Version Tracking (for A/B testing different smoothing methods)
  calculation_version String DEFAULT 'v1_tsi_austin' COMMENT 'Algorithm version',
  created_at DateTime64(3) DEFAULT now64() COMMENT 'Record creation time'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(signal_timestamp)
ORDER BY (market_id, signal_timestamp, signal_type)
SETTINGS index_granularity = 8192;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_entry_signals ON momentum_trading_signals(signal_type, meets_entry_threshold, signal_timestamp)
  TYPE minmax GRANULARITY 1;

CREATE INDEX IF NOT EXISTS idx_market_signals ON momentum_trading_signals(market_id, signal_timestamp)
  TYPE minmax GRANULARITY 1;

COMMENT ON TABLE momentum_trading_signals IS 'TSI-based trading signals with directional conviction - Austin''s momentum strategy';
