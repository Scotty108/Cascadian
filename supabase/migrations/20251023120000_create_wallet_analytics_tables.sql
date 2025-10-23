-- =====================================================================
-- WALLET ANALYTICS SCHEMA - COMPREHENSIVE DATA STORAGE
-- =====================================================================
-- Purpose: Store all wallet-related data for CASCADIAN platform
--          Supports: Wallet Detail, Whale Activity, Insider Detection
--
-- Design Goals:
--   1. Cache wallet data from Polymarket Data-API
--   2. Enable historical PnL tracking and graphs
--   3. Support whale detection and aggregation
--   4. Enable insider timing analysis
--   5. Optimize for time-series queries
--
-- Author: database-architect agent
-- Date: 2025-10-23
-- =====================================================================

-- =====================================================================
-- TABLE: wallets
-- =====================================================================
-- Master table for wallet metadata and aggregated metrics
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.wallets (
  -- Primary Key
  wallet_address TEXT PRIMARY KEY,

  -- Wallet Identification
  wallet_alias TEXT, -- User-assigned or auto-generated nickname
  ens_name TEXT, -- ENS domain if resolved

  -- Wallet Classification
  is_whale BOOLEAN DEFAULT FALSE,
  whale_score NUMERIC(5, 2) DEFAULT 0, -- 0-100 score
  is_suspected_insider BOOLEAN DEFAULT FALSE,
  insider_score NUMERIC(5, 2) DEFAULT 0, -- 0-100 score

  -- Aggregated Metrics (calculated from trades/positions)
  total_volume_usd NUMERIC(18, 2) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  total_markets_traded INTEGER DEFAULT 0,

  -- Performance Metrics
  realized_pnl_usd NUMERIC(18, 2) DEFAULT 0,
  unrealized_pnl_usd NUMERIC(18, 2) DEFAULT 0,
  total_pnl_usd NUMERIC(18, 2) DEFAULT 0,
  win_rate NUMERIC(5, 4) DEFAULT 0, -- 0.0000 to 1.0000 (0% to 100%)

  -- Activity Metrics
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  active_positions_count INTEGER DEFAULT 0,
  closed_positions_count INTEGER DEFAULT 0,

  -- Portfolio Value
  portfolio_value_usd NUMERIC(18, 2) DEFAULT 0,
  portfolio_last_updated TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT wallets_scores_check
    CHECK (
      whale_score >= 0 AND whale_score <= 100 AND
      insider_score >= 0 AND insider_score <= 100
    ),

  CONSTRAINT wallets_win_rate_check
    CHECK (win_rate >= 0 AND win_rate <= 1)
);

-- Indexes for wallets table
CREATE INDEX idx_wallets_whale_score ON public.wallets(whale_score DESC) WHERE is_whale = TRUE;
CREATE INDEX idx_wallets_insider_score ON public.wallets(insider_score DESC) WHERE is_suspected_insider = TRUE;
CREATE INDEX idx_wallets_total_volume ON public.wallets(total_volume_usd DESC);
CREATE INDEX idx_wallets_last_seen ON public.wallets(last_seen_at DESC);
CREATE INDEX idx_wallets_total_pnl ON public.wallets(total_pnl_usd DESC);

-- =====================================================================
-- TABLE: wallet_positions
-- =====================================================================
-- Current open positions for each wallet (from Data-API)
-- Updated on each fetch, represents current state
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.wallet_positions (
  -- Primary Key
  id BIGSERIAL PRIMARY KEY,

  -- Wallet Reference
  wallet_address TEXT NOT NULL REFERENCES wallets(wallet_address) ON DELETE CASCADE,

  -- Market Reference
  market_id TEXT NOT NULL,
  market_title TEXT,
  condition_id TEXT,

  -- Position Details
  outcome TEXT NOT NULL, -- 'YES' or 'NO'
  shares NUMERIC(18, 8) NOT NULL,
  entry_price NUMERIC(18, 8),
  current_price NUMERIC(18, 8),

  -- Position Value
  position_value_usd NUMERIC(18, 2),
  unrealized_pnl_usd NUMERIC(18, 2),

  -- Metadata
  opened_at TIMESTAMPTZ,
  last_updated TIMESTAMPTZ DEFAULT NOW(),

  -- Raw API data for debugging
  raw_data JSONB,

  -- Unique constraint: one position per wallet+market+outcome
  CONSTRAINT wallet_positions_unique UNIQUE (wallet_address, market_id, outcome)
);

-- Indexes for wallet_positions
CREATE INDEX idx_wallet_positions_wallet ON public.wallet_positions(wallet_address);
CREATE INDEX idx_wallet_positions_market ON public.wallet_positions(market_id);
CREATE INDEX idx_wallet_positions_unrealized_pnl ON public.wallet_positions(unrealized_pnl_usd DESC NULLS LAST);

-- =====================================================================
-- TABLE: wallet_trades
-- =====================================================================
-- Complete trade history for each wallet (from Data-API)
-- Immutable log of all trades
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.wallet_trades (
  -- Primary Key
  id BIGSERIAL PRIMARY KEY,

  -- Trade Identification
  trade_id TEXT UNIQUE, -- External trade ID from Data-API

  -- Wallet Reference
  wallet_address TEXT NOT NULL REFERENCES wallets(wallet_address) ON DELETE CASCADE,

  -- Market Reference
  market_id TEXT NOT NULL,
  market_title TEXT,
  condition_id TEXT,

  -- Trade Details
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  outcome TEXT NOT NULL, -- 'YES' or 'NO'
  shares NUMERIC(18, 8) NOT NULL,
  price NUMERIC(18, 8) NOT NULL,
  amount_usd NUMERIC(18, 2) NOT NULL,

  -- Timing
  executed_at TIMESTAMPTZ NOT NULL,

  -- Trade Context (for insider analysis)
  market_price_before NUMERIC(18, 8), -- Market price 1 hour before trade
  market_price_after NUMERIC(18, 8), -- Market price 1 hour after trade
  timing_score NUMERIC(5, 2), -- 0-100, how early/prescient this trade was

  -- Metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  raw_data JSONB
);

-- Indexes for wallet_trades
CREATE INDEX idx_wallet_trades_wallet ON public.wallet_trades(wallet_address);
CREATE INDEX idx_wallet_trades_market ON public.wallet_trades(market_id);
CREATE INDEX idx_wallet_trades_executed ON public.wallet_trades(executed_at DESC);
CREATE INDEX idx_wallet_trades_timing_score ON public.wallet_trades(timing_score DESC NULLS LAST);
CREATE INDEX idx_wallet_trades_amount ON public.wallet_trades(amount_usd DESC);

-- Composite index for whale trade queries
CREATE INDEX idx_wallet_trades_wallet_executed ON public.wallet_trades(wallet_address, executed_at DESC);

-- =====================================================================
-- TABLE: wallet_closed_positions
-- =====================================================================
-- Historical closed positions with realized PnL (from Data-API)
-- Used for win rate and historical performance
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.wallet_closed_positions (
  -- Primary Key
  id BIGSERIAL PRIMARY KEY,

  -- Position Identification
  position_id TEXT UNIQUE, -- External position ID from Data-API

  -- Wallet Reference
  wallet_address TEXT NOT NULL REFERENCES wallets(wallet_address) ON DELETE CASCADE,

  -- Market Reference
  market_id TEXT NOT NULL,
  market_title TEXT,
  condition_id TEXT,

  -- Position Details
  outcome TEXT NOT NULL,
  shares NUMERIC(18, 8) NOT NULL,
  entry_price NUMERIC(18, 8) NOT NULL,
  exit_price NUMERIC(18, 8) NOT NULL,

  -- Performance
  realized_pnl_usd NUMERIC(18, 2) NOT NULL,
  is_win BOOLEAN NOT NULL, -- TRUE if PnL > 0

  -- Timing
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ NOT NULL,
  hold_duration_hours INTEGER,

  -- Metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  raw_data JSONB
);

-- Indexes for wallet_closed_positions
CREATE INDEX idx_wallet_closed_wallet ON public.wallet_closed_positions(wallet_address);
CREATE INDEX idx_wallet_closed_market ON public.wallet_closed_positions(market_id);
CREATE INDEX idx_wallet_closed_at ON public.wallet_closed_positions(closed_at DESC);
CREATE INDEX idx_wallet_closed_pnl ON public.wallet_closed_positions(realized_pnl_usd DESC);
CREATE INDEX idx_wallet_closed_is_win ON public.wallet_closed_positions(is_win);

-- =====================================================================
-- TABLE: wallet_pnl_snapshots
-- =====================================================================
-- Time-series snapshots of wallet PnL for historical graphs
-- Captures portfolio value and PnL at regular intervals
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.wallet_pnl_snapshots (
  -- Primary Key
  id BIGSERIAL PRIMARY KEY,

  -- Wallet Reference
  wallet_address TEXT NOT NULL REFERENCES wallets(wallet_address) ON DELETE CASCADE,

  -- Snapshot Timing
  snapshot_at TIMESTAMPTZ NOT NULL,

  -- Portfolio Metrics
  portfolio_value_usd NUMERIC(18, 2) NOT NULL,
  realized_pnl_usd NUMERIC(18, 2) NOT NULL,
  unrealized_pnl_usd NUMERIC(18, 2) NOT NULL,
  total_pnl_usd NUMERIC(18, 2) NOT NULL,

  -- Position Counts
  active_positions INTEGER DEFAULT 0,
  closed_positions INTEGER DEFAULT 0,

  -- Performance
  win_rate NUMERIC(5, 4),
  total_invested_usd NUMERIC(18, 2),
  roi NUMERIC(10, 4), -- Return on Investment percentage

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one snapshot per wallet per timestamp
  CONSTRAINT wallet_pnl_snapshots_unique UNIQUE (wallet_address, snapshot_at)
);

-- Indexes for wallet_pnl_snapshots
CREATE INDEX idx_wallet_pnl_wallet ON public.wallet_pnl_snapshots(wallet_address);
CREATE INDEX idx_wallet_pnl_snapshot_at ON public.wallet_pnl_snapshots(snapshot_at DESC);
CREATE INDEX idx_wallet_pnl_wallet_time ON public.wallet_pnl_snapshots(wallet_address, snapshot_at DESC);

-- =====================================================================
-- TABLE: market_holders
-- =====================================================================
-- Cache of top holders for each market (from Data-API)
-- Used for whale concentration analysis
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.market_holders (
  -- Primary Key
  id BIGSERIAL PRIMARY KEY,

  -- Market Reference
  market_id TEXT NOT NULL,
  condition_id TEXT,

  -- Holder Details
  wallet_address TEXT NOT NULL,
  outcome TEXT NOT NULL, -- 'YES' or 'NO'
  shares NUMERIC(18, 8) NOT NULL,
  position_value_usd NUMERIC(18, 2),

  -- Concentration Metrics
  market_share_percentage NUMERIC(5, 4), -- % of total market supply held
  rank INTEGER, -- Holder rank (1 = largest holder)

  -- Metadata
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  raw_data JSONB,

  -- Unique constraint
  CONSTRAINT market_holders_unique UNIQUE (market_id, wallet_address, outcome)
);

-- Indexes for market_holders
CREATE INDEX idx_market_holders_market ON public.market_holders(market_id);
CREATE INDEX idx_market_holders_wallet ON public.market_holders(wallet_address);
CREATE INDEX idx_market_holders_shares ON public.market_holders(shares DESC);
CREATE INDEX idx_market_holders_rank ON public.market_holders(market_id, rank);

-- =====================================================================
-- TABLE: whale_activity_log
-- =====================================================================
-- Pre-aggregated whale activity for fast queries
-- Updated whenever significant whale trades occur
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.whale_activity_log (
  -- Primary Key
  id BIGSERIAL PRIMARY KEY,

  -- Whale Reference
  wallet_address TEXT NOT NULL REFERENCES wallets(wallet_address) ON DELETE CASCADE,
  wallet_alias TEXT,

  -- Activity Details
  activity_type TEXT NOT NULL CHECK (activity_type IN ('TRADE', 'POSITION_FLIP', 'LARGE_MOVE')),

  -- Market Reference
  market_id TEXT NOT NULL,
  market_title TEXT,

  -- Trade Details (if activity_type = 'TRADE')
  side TEXT CHECK (side IN ('BUY', 'SELL')),
  outcome TEXT,
  shares NUMERIC(18, 8),
  price NUMERIC(18, 8),
  amount_usd NUMERIC(18, 2),

  -- Flip Details (if activity_type = 'POSITION_FLIP')
  previous_outcome TEXT,
  new_outcome TEXT,

  -- Significance Score
  impact_score NUMERIC(5, 2) DEFAULT 0, -- 0-100, how significant this activity is

  -- Timing
  occurred_at TIMESTAMPTZ NOT NULL,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for whale_activity_log
CREATE INDEX idx_whale_activity_wallet ON public.whale_activity_log(wallet_address);
CREATE INDEX idx_whale_activity_occurred ON public.whale_activity_log(occurred_at DESC);
CREATE INDEX idx_whale_activity_impact ON public.whale_activity_log(impact_score DESC);
CREATE INDEX idx_whale_activity_market ON public.whale_activity_log(market_id);
CREATE INDEX idx_whale_activity_type ON public.whale_activity_log(activity_type);

-- =====================================================================
-- TRIGGERS: Auto-update timestamps
-- =====================================================================

CREATE OR REPLACE FUNCTION update_wallet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallets_updated
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_timestamp();

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- Function: Calculate win rate for a wallet
CREATE OR REPLACE FUNCTION calculate_wallet_win_rate(addr TEXT)
RETURNS NUMERIC AS $$
  SELECT
    CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE CAST(COUNT(*) FILTER (WHERE is_win = TRUE) AS NUMERIC) / COUNT(*)
    END
  FROM wallet_closed_positions
  WHERE wallet_address = addr;
$$ LANGUAGE sql STABLE;

-- Function: Get top whales by volume
CREATE OR REPLACE FUNCTION get_top_whales(limit_count INTEGER DEFAULT 50)
RETURNS TABLE(
  wallet_address TEXT,
  wallet_alias TEXT,
  total_volume_usd NUMERIC,
  whale_score NUMERIC,
  total_pnl_usd NUMERIC,
  win_rate NUMERIC
) AS $$
  SELECT
    wallet_address,
    wallet_alias,
    total_volume_usd,
    whale_score,
    total_pnl_usd,
    win_rate
  FROM wallets
  WHERE is_whale = TRUE
  ORDER BY total_volume_usd DESC
  LIMIT limit_count;
$$ LANGUAGE sql STABLE;

-- Function: Get suspected insiders by score
CREATE OR REPLACE FUNCTION get_suspected_insiders(limit_count INTEGER DEFAULT 50)
RETURNS TABLE(
  wallet_address TEXT,
  wallet_alias TEXT,
  insider_score NUMERIC,
  win_rate NUMERIC,
  total_trades INTEGER,
  avg_timing_score NUMERIC
) AS $$
  SELECT
    w.wallet_address,
    w.wallet_alias,
    w.insider_score,
    w.win_rate,
    w.total_trades,
    (
      SELECT AVG(timing_score)
      FROM wallet_trades
      WHERE wallet_address = w.wallet_address
        AND timing_score IS NOT NULL
    ) as avg_timing_score
  FROM wallets w
  WHERE is_suspected_insider = TRUE
  ORDER BY insider_score DESC
  LIMIT limit_count;
$$ LANGUAGE sql STABLE;

-- Function: Get recent whale activity
CREATE OR REPLACE FUNCTION get_recent_whale_activity(hours_back INTEGER DEFAULT 24, limit_count INTEGER DEFAULT 100)
RETURNS TABLE(
  activity_id BIGINT,
  wallet_address TEXT,
  wallet_alias TEXT,
  activity_type TEXT,
  market_title TEXT,
  amount_usd NUMERIC,
  impact_score NUMERIC,
  occurred_at TIMESTAMPTZ
) AS $$
  SELECT
    id,
    wallet_address,
    wallet_alias,
    activity_type,
    market_title,
    amount_usd,
    impact_score,
    occurred_at
  FROM whale_activity_log
  WHERE occurred_at >= NOW() - (hours_back || ' hours')::INTERVAL
  ORDER BY occurred_at DESC
  LIMIT limit_count;
$$ LANGUAGE sql STABLE;

-- =====================================================================
-- COMMENTS (for documentation)
-- =====================================================================

COMMENT ON TABLE public.wallets IS
  'Master wallet metadata table with aggregated metrics. Source of truth for wallet classification (whale, insider) and performance stats.';

COMMENT ON TABLE public.wallet_positions IS
  'Current open positions from Data-API. Cached for performance, refreshed on each wallet detail page load.';

COMMENT ON TABLE public.wallet_trades IS
  'Complete historical trade log. Immutable record of all wallet trading activity from Data-API.';

COMMENT ON TABLE public.wallet_closed_positions IS
  'Closed positions with realized PnL. Used to calculate win rate and historical performance.';

COMMENT ON TABLE public.wallet_pnl_snapshots IS
  'Time-series PnL snapshots for historical graphs. Enables PnL over time visualization.';

COMMENT ON TABLE public.market_holders IS
  'Top holders per market from Data-API. Used for whale concentration analysis.';

COMMENT ON TABLE public.whale_activity_log IS
  'Pre-aggregated whale activity feed. Optimized for real-time whale activity dashboard.';

-- Enable Row Level Security
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_closed_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pnl_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whale_activity_log ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY "Allow public read access" ON public.wallets FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.wallet_positions FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.wallet_trades FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.wallet_closed_positions FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.wallet_pnl_snapshots FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.market_holders FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.whale_activity_log FOR SELECT USING (true);

-- =====================================================================
-- VALIDATION
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE 'Wallet analytics tables created successfully!';
  RAISE NOTICE 'Tables: wallets, wallet_positions, wallet_trades, wallet_closed_positions';
  RAISE NOTICE 'Tables: wallet_pnl_snapshots, market_holders, whale_activity_log';
  RAISE NOTICE 'Ready for wallet data ingestion from Data-API.';
END $$;
