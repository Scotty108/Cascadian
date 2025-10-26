-- Migration 012: Create fired_signals table
-- Purpose: Track all signals fired for analytics and optimization
-- Priority: MEDIUM (Phase 2)

CREATE TABLE IF NOT EXISTS fired_signals (
  signal_id UUID DEFAULT generateUUIDv4(),
  market_id String,
  market_slug String,
  signal_type Enum8('ELITE_MOMENTUM'=1, 'MOMENTUM_ONLY'=2),

  momentum_velocity Decimal(12, 8),
  momentum_acceleration Decimal(12, 8),

  elite_wallet_address Nullable(String),
  elite_omega_score Nullable(Decimal(10, 4)),
  elite_side Nullable(Enum8('BUY'=1, 'SELL'=2)),

  confidence Enum8('LOW'=1, 'MEDIUM'=2, 'HIGH'=3),
  entry_window String,
  price_at_signal Decimal(10, 6),
  timestamp DateTime DEFAULT now(),

  -- Track outcomes
  user_action Nullable(Enum8('IGNORED'=1, 'VIEWED'=2, 'TRADED'=3)),
  user_entry_price Nullable(Decimal(10, 6)),
  user_entry_time Nullable(DateTime),
  signal_pnl Nullable(Decimal(18, 2))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, market_id)
SETTINGS index_granularity = 8192;

COMMENT ON TABLE fired_signals IS 'All signals fired - for analytics, backtesting, and optimization';
