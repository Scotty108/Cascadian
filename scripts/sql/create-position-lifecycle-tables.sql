-- ═══════════════════════════════════════════════════════════════════════════════
-- POSITION LIFECYCLE & TIME-IN-TRADE SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════
-- Purpose: Track individual position lifecycles with holding duration metrics
--          Enables filtering whales (hold >7 days) vs swing traders (trade hourly)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────
-- TABLE 1: position_lifecycle
-- ───────────────────────────────────────────────────────────────────────────────
-- Tracks each FIFO lot from entry to exit with precise holding duration

CREATE TABLE IF NOT EXISTS cascadian_clean.position_lifecycle (
  wallet LowCardinality(String),
  market_cid String,
  outcome Int32,
  lot_id UInt64,                       -- Unique lot identifier

  -- Timing
  opened_at DateTime64(3),             -- Entry timestamp
  closed_at Nullable(DateTime64(3)),   -- Exit timestamp (NULL if still open)
  hold_seconds UInt64,                 -- Holding duration in seconds
  hold_days Float64,                   -- Holding duration in days

  -- Entry
  entry_qty Float64,
  entry_avg_price Float64,

  -- Exit
  exit_qty Float64,
  exit_avg_price Nullable(Float64),    -- NULL if still open

  -- P&L
  realized_pnl Float64,                -- 0 if still open

  -- Categories
  duration_category LowCardinality(String),  -- INTRADAY, SHORT_TERM, MEDIUM_TERM, LONG_TERM
  position_status LowCardinality(String),    -- OPEN, CLOSED

  -- Metadata
  created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (wallet, market_cid, outcome, lot_id)
SETTINGS index_granularity = 8192;

-- ───────────────────────────────────────────────────────────────────────────────
-- TABLE 2: wallet_time_metrics
-- ───────────────────────────────────────────────────────────────────────────────
-- Aggregated holding duration metrics per wallet

CREATE TABLE IF NOT EXISTS cascadian_clean.wallet_time_metrics (
  wallet LowCardinality(String),

  -- Position counts
  positions_total UInt64,
  positions_closed UInt64,
  positions_open UInt64,

  -- Holding duration stats (closed positions only)
  avg_hold_hours Float64,
  median_hold_hours Float64,
  max_hold_hours Float64,
  min_hold_hours Float64,

  -- Distribution by duration category
  pct_held_lt_1d Float64,      -- % held < 1 day (swing traders)
  pct_held_1_7d Float64,        -- % held 1-7 days
  pct_held_gt_7d Float64,       -- % held > 7 days (whales)
  pct_held_gt_30d Float64,      -- % held > 30 days (long-term holders)

  -- Counts by category
  count_intraday UInt64,        -- < 1 day
  count_short_term UInt64,      -- 1-7 days
  count_medium_term UInt64,     -- 7-30 days
  count_long_term UInt64,       -- > 30 days

  -- P&L by holding duration
  intraday_pnl Float64,
  short_term_pnl Float64,
  medium_term_pnl Float64,
  long_term_pnl Float64,

  -- Volume by holding duration
  intraday_volume_usd Float64,
  short_term_volume_usd Float64,
  medium_term_volume_usd Float64,
  long_term_volume_usd Float64,

  -- Metadata
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY wallet
SETTINGS index_granularity = 8192;

-- ───────────────────────────────────────────────────────────────────────────────
-- INDEX: Optimize for common queries
-- ───────────────────────────────────────────────────────────────────────────────

-- Fast lookup of all positions for a wallet+market combination
-- (Used by FIFO matcher to fetch trade history)
