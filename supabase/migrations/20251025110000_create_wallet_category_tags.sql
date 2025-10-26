-- Migration: Create wallet_category_tags table
-- Purpose: Tag wallets with specializations and detect insider patterns
-- Priority: HIGH (Phase 1)

CREATE TABLE IF NOT EXISTS wallet_category_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  category TEXT NOT NULL,

  -- Specialization Metrics
  category_omega DECIMAL(12, 4),
  category_win_rate DECIMAL(5, 4),
  trades_in_category INT,
  pct_of_wallet_trades DECIMAL(5, 4),
  pct_of_wallet_volume DECIMAL(5, 4),

  -- Percentile Rankings
  omega_percentile DECIMAL(5, 4) CHECK (omega_percentile >= 0 AND omega_percentile <= 1),
  clv_percentile DECIMAL(5, 4),
  ev_per_hour_percentile DECIMAL(5, 4),
  overall_rank_in_category INT,

  -- Pattern Detection
  is_likely_specialist BOOLEAN DEFAULT FALSE,
  is_likely_insider BOOLEAN DEFAULT FALSE,
  insider_confidence_score DECIMAL(5, 4) DEFAULT 0 CHECK (insider_confidence_score >= 0 AND insider_confidence_score <= 1),

  -- Sub-Category Drilling
  subcategory_win_rates JSONB,
  subcategory_bet_counts JSONB,
  consecutive_wins_in_subcategory INT,
  win_rate_vs_category_avg DECIMAL(10, 4),
  timing_pattern_score DECIMAL(10, 6),

  -- Tags
  primary_tag TEXT,
  secondary_tags TEXT[],

  -- Metadata
  first_trade_in_category TIMESTAMPTZ,
  last_trade_in_category TIMESTAMPTZ,
  last_analyzed TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(wallet_address, category)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_category_tags_insider ON wallet_category_tags(category, insider_confidence_score DESC)
  WHERE is_likely_insider = TRUE;

CREATE INDEX IF NOT EXISTS idx_wallet_category_tags_specialist ON wallet_category_tags(wallet_address)
  WHERE is_likely_specialist = TRUE;

CREATE INDEX IF NOT EXISTS idx_wallet_category_tags_category ON wallet_category_tags(category, category_omega DESC);

-- Updated trigger
CREATE OR REPLACE FUNCTION update_wallet_category_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_wallet_category_tags_updated_at ON wallet_category_tags;
CREATE TRIGGER trigger_wallet_category_tags_updated_at
  BEFORE UPDATE ON wallet_category_tags
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_category_tags_updated_at();

-- Comments
COMMENT ON TABLE wallet_category_tags IS 'Wallet specialization and insider detection';
COMMENT ON COLUMN wallet_category_tags.insider_confidence_score IS '0-1 confidence that wallet has inside information';
COMMENT ON COLUMN wallet_category_tags.subcategory_win_rates IS 'Win rates broken down by subcategory (for insider detection)';
