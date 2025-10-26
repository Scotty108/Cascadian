-- Migration 011: Create elite_trade_attributions table
-- Purpose: Track elite wallet activity in watchlist markets
-- Priority: HIGH (Phase 2)

CREATE TABLE IF NOT EXISTS elite_trade_attributions (
  trade_id String,
  market_id String,
  wallet_address String,
  side Enum8('BUY'=1, 'SELL'=2),
  size_usd Decimal(18, 2),

  is_elite Boolean,
  elite_omega_score Nullable(Decimal(10, 4)),

  timestamp DateTime,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, timestamp, wallet_address)
SETTINGS index_granularity = 8192;

-- Index for elite wallet lookups
CREATE INDEX IF NOT EXISTS idx_elite_wallets ON elite_trade_attributions(wallet_address)
  TYPE minmax GRANULARITY 4;

COMMENT ON TABLE elite_trade_attributions IS 'Elite wallet activity tracking for attribution and copytrading signals';
