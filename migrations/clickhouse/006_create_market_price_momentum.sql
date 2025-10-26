-- Migration 006: Create market_price_momentum table with TSI indicators
-- Purpose: Pre-calculate momentum derivatives + TSI for instant threshold detection
-- Priority: HIGH (Phase 2 - Austin's TSI Strategy)

CREATE TABLE IF NOT EXISTS market_price_momentum (
  market_id String,
  timestamp DateTime64(3),
  side Enum8('YES'=1, 'NO'=2),

  -- Current State
  current_price Decimal(10, 6),

  -- Price Changes (Absolute)
  price_change_10s Decimal(10, 6) COMMENT 'Price change in last 10 seconds',
  price_change_30s Decimal(10, 6),
  price_change_1min Decimal(10, 6),
  price_change_2min Decimal(10, 6),
  price_change_5min Decimal(10, 6),

  -- Price Changes (Percentage)
  price_change_pct_10s Decimal(10, 4) COMMENT '% change in 10s',
  price_change_pct_1min Decimal(10, 4),
  price_change_pct_5min Decimal(10, 4),

  -- MOMENTUM METRICS (Velocity)
  velocity_10s Decimal(12, 8) COMMENT 'Price change per second (10s window)',
  velocity_1min Decimal(12, 8) COMMENT 'Price change per second (1min window)',
  velocity_5min Decimal(12, 8) COMMENT 'Price change per second (5min window)',

  -- MOMENTUM METRICS (Acceleration)
  acceleration_30s Decimal(12, 8) COMMENT 'Change in velocity (30s window)',
  acceleration_1min Decimal(12, 8) COMMENT 'Change in velocity (1min window)',

  -- Direction
  direction_1min Enum8('up'=1, 'down'=2, 'flat'=3),
  direction_5min Enum8('up'=1, 'down'=2, 'flat'=3),

  -- Trend Strength
  trend_strength_1min Decimal(10, 6) COMMENT 'Correlation coefficient of price over time',
  trend_strength_5min Decimal(10, 6),

  -- Volatility
  volatility_1min Decimal(10, 6) COMMENT 'Stddev of price changes in 1min',

  -- Context
  current_volume_1min Decimal(18, 2),
  volume_surge_ratio Decimal(10, 4) COMMENT 'current_volume / avg_volume',

  -- TSI INDICATORS (Austin's Momentum Strategy)
  tsi_fast Decimal(12, 8) DEFAULT NULL COMMENT 'Fast TSI line (9-period default)',
  tsi_fast_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) DEFAULT 'RMA' COMMENT 'Smoothing method for fast line',
  tsi_fast_periods UInt8 DEFAULT 9 COMMENT 'Periods for fast TSI line',

  tsi_slow Decimal(12, 8) DEFAULT NULL COMMENT 'Slow TSI line (21-period default)',
  tsi_slow_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) DEFAULT 'RMA' COMMENT 'Smoothing method for slow line',
  tsi_slow_periods UInt8 DEFAULT 21 COMMENT 'Periods for slow TSI line',

  -- Crossover Detection
  crossover_signal Enum8('BULLISH'=1, 'BEARISH'=2, 'NEUTRAL'=3) DEFAULT 'NEUTRAL' COMMENT 'Current crossover state',
  crossover_timestamp DateTime64(3) DEFAULT NULL COMMENT 'When crossover occurred',

  -- Price Smoothing (optional noise reduction)
  price_smoothed Decimal(10, 6) DEFAULT NULL COMMENT 'Smoothed mid price',
  price_smoothing_method Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) DEFAULT 'RMA' COMMENT 'Method used for price smoothing',
  price_smoothing_periods UInt8 DEFAULT 3 COMMENT 'Periods for price smoothing',

  -- Metadata
  momentum_calculation_version String DEFAULT 'v1_tsi' COMMENT 'Algorithm version (for A/B testing)',

  calculated_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (market_id, side, timestamp)
SETTINGS index_granularity = 4096;

-- Indexes for momentum queries
CREATE INDEX IF NOT EXISTS idx_high_velocity ON market_price_momentum(velocity_1min)
  TYPE minmax GRANULARITY 2;

CREATE INDEX IF NOT EXISTS idx_acceleration ON market_price_momentum(acceleration_1min)
  TYPE minmax GRANULARITY 2;

-- Indexes for TSI queries
CREATE INDEX IF NOT EXISTS idx_crossover ON market_price_momentum(market_id, crossover_signal, crossover_timestamp)
  TYPE minmax GRANULARITY 1;

COMMENT ON TABLE market_price_momentum IS 'Momentum derivatives + TSI indicators for Austin''s momentum strategy';
