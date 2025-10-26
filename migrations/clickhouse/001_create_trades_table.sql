-- ClickHouse Schema Migration 001
-- Creates trades_raw table and materialized views for wallet analytics

-- Drop existing tables if they exist (for development)
DROP TABLE IF EXISTS wallet_metrics_daily;
DROP TABLE IF EXISTS trades_raw;

-- Main trades table
CREATE TABLE IF NOT EXISTS trades_raw (
  trade_id String,
  wallet_address String,
  market_id String,
  timestamp DateTime,
  side Enum8('YES' = 1, 'NO' = 2),
  entry_price Decimal(18, 8),
  exit_price Nullable(Decimal(18, 8)),
  shares Decimal(18, 8),
  usd_value Decimal(18, 2),
  pnl Nullable(Decimal(18, 2)),
  is_closed Bool,
  transaction_hash String,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp)
SETTINGS index_granularity = 8192;

-- Materialized view for daily wallet metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS wallet_metrics_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (wallet_address, date)
AS SELECT
  wallet_address,
  toDate(timestamp) AS date,

  -- Trade counts
  count() AS total_trades,
  countIf(is_closed = true AND pnl > 0) AS wins,
  countIf(is_closed = true AND pnl <= 0) AS losses,

  -- PnL metrics
  sumIf(pnl, is_closed = true) AS total_pnl,
  avgIf(pnl, is_closed = true AND pnl > 0) AS avg_win,
  avgIf(pnl, is_closed = true AND pnl <= 0) AS avg_loss,
  stddevPopIf(pnl, is_closed = true) AS pnl_stddev,

  -- Volume
  sum(usd_value) AS total_volume,

  -- Time tracking
  min(timestamp) AS first_trade_time,
  max(timestamp) AS last_trade_time

FROM trades_raw
GROUP BY wallet_address, toDate(timestamp);
