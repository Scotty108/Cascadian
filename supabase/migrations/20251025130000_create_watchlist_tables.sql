-- Migration: Create watchlist_markets and watchlist_wallets tables
-- Purpose: User-selected markets and wallets for live tracking (scoped for cost management)
-- Priority: MEDIUM (Phase 2)

-- Watchlist Markets
CREATE TABLE IF NOT EXISTS watchlist_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL,
  market_slug TEXT,
  condition_id TEXT,
  category TEXT,
  question TEXT,

  -- How it was added
  added_by_user_id UUID REFERENCES auth.users(id),
  auto_added BOOLEAN DEFAULT FALSE,
  auto_added_reason TEXT,

  -- Priority
  priority INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(market_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_markets_priority ON watchlist_markets(priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_markets_category ON watchlist_markets(category) WHERE category IS NOT NULL;

-- Watchlist Wallets
CREATE TABLE IF NOT EXISTS watchlist_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,

  -- Cached metrics
  omega_score DECIMAL(10, 4),
  win_rate DECIMAL(5, 4),
  closed_positions INT,
  category TEXT,
  grade TEXT,

  -- How added
  added_by_user_id UUID REFERENCES auth.users(id),
  auto_added BOOLEAN DEFAULT FALSE,
  auto_added_reason TEXT,

  -- Tracking
  last_trade_detected_at TIMESTAMPTZ,
  total_signals_generated INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_wallets_score ON watchlist_wallets(omega_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_watchlist_wallets_category ON watchlist_wallets(category) WHERE category IS NOT NULL;

-- Updated triggers
CREATE OR REPLACE FUNCTION update_watchlist_markets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_watchlist_markets_updated_at ON watchlist_markets;
CREATE TRIGGER trigger_watchlist_markets_updated_at
  BEFORE UPDATE ON watchlist_markets
  FOR EACH ROW
  EXECUTE FUNCTION update_watchlist_markets_updated_at();

CREATE OR REPLACE FUNCTION update_watchlist_wallets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_watchlist_wallets_updated_at ON watchlist_wallets;
CREATE TRIGGER trigger_watchlist_wallets_updated_at
  BEFORE UPDATE ON watchlist_wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_watchlist_wallets_updated_at();

-- Comments
COMMENT ON TABLE watchlist_markets IS 'User-selected markets for live tracking (~100 markets vs 20,000)';
COMMENT ON TABLE watchlist_wallets IS 'Elite wallets to monitor for Live Signals attribution';
