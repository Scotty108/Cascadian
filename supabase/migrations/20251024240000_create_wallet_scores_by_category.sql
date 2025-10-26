-- Wallet Scores By Category Table
-- Stores omega scores and performance metrics per market category per wallet

CREATE TABLE IF NOT EXISTS wallet_scores_by_category (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  category TEXT NOT NULL,

  -- Omega metrics
  omega_ratio DECIMAL(10, 4),
  omega_momentum DECIMAL(10, 4),

  -- Position stats
  total_positions INTEGER DEFAULT 0,
  closed_positions INTEGER DEFAULT 0,

  -- Performance metrics
  total_pnl DECIMAL(18, 2),
  total_gains DECIMAL(18, 2),
  total_losses DECIMAL(18, 2),
  win_rate DECIMAL(5, 4),
  avg_gain DECIMAL(18, 2),
  avg_loss DECIMAL(18, 2),
  roi_per_bet DECIMAL(18, 2),
  overall_roi DECIMAL(10, 4),

  -- Classification
  momentum_direction TEXT CHECK (momentum_direction IN ('improving', 'declining', 'stable', 'insufficient_data')),
  grade TEXT CHECK (grade IN ('S', 'A', 'B', 'C', 'D', 'F')),
  meets_minimum_trades BOOLEAN DEFAULT FALSE,

  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint: one row per wallet per category
  CONSTRAINT wallet_scores_by_category_unique UNIQUE (wallet_address, category)
);

-- Index for fast lookups by wallet and category
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_wallet ON wallet_scores_by_category(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_category ON wallet_scores_by_category(category);

-- Index for ranking queries per category
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_omega ON wallet_scores_by_category(category, omega_ratio DESC)
  WHERE meets_minimum_trades = TRUE;

-- Index for finding top performers in a category
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_roi ON wallet_scores_by_category(category, roi_per_bet DESC)
  WHERE meets_minimum_trades = TRUE;

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_wallet_scores_by_category_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_wallet_scores_by_category_updated_at_trigger ON wallet_scores_by_category;
CREATE TRIGGER update_wallet_scores_by_category_updated_at_trigger
  BEFORE UPDATE ON wallet_scores_by_category
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_scores_by_category_updated_at();

-- Comments
COMMENT ON TABLE wallet_scores_by_category IS 'Omega scores and performance metrics broken down by market category (Politics, Crypto, Sports, etc.)';
COMMENT ON COLUMN wallet_scores_by_category.category IS 'Market category: Politics, Crypto, Sports, Business, Science, Pop Culture';
COMMENT ON COLUMN wallet_scores_by_category.omega_ratio IS 'Ratio of total gains to total losses within this category';
COMMENT ON COLUMN wallet_scores_by_category.roi_per_bet IS 'Average profit per trade in this category (total_pnl / closed_positions)';
COMMENT ON COLUMN wallet_scores_by_category.overall_roi IS 'Overall return percentage in this category (total_pnl / (total_gains + total_losses))';
