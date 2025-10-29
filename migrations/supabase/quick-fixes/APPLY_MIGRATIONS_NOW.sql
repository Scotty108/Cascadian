-- ============================================================================
-- CONSOLIDATED MIGRATIONS FOR PHASE 1 METRICS
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard
-- ============================================================================

-- Migration 1: wallet_scores_by_category
-- ============================================================================

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

-- Indexes for wallet_scores_by_category
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_wallet ON wallet_scores_by_category(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_category ON wallet_scores_by_category(category);
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_omega ON wallet_scores_by_category(category, omega_ratio DESC)
  WHERE meets_minimum_trades = TRUE;
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_roi ON wallet_scores_by_category(category, roi_per_bet DESC)
  WHERE meets_minimum_trades = TRUE;

-- Update timestamp trigger for wallet_scores_by_category
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

-- Comments for wallet_scores_by_category
COMMENT ON TABLE wallet_scores_by_category IS 'Omega scores and performance metrics broken down by market category (Politics, Crypto, Sports, etc.)';
COMMENT ON COLUMN wallet_scores_by_category.category IS 'Market category: Politics, Crypto, Sports, Business, Science, Pop Culture';
COMMENT ON COLUMN wallet_scores_by_category.omega_ratio IS 'Ratio of total gains to total losses within this category';
COMMENT ON COLUMN wallet_scores_by_category.roi_per_bet IS 'Average profit per trade in this category (total_pnl / closed_positions)';
COMMENT ON COLUMN wallet_scores_by_category.overall_roi IS 'Overall return percentage in this category (total_pnl / (total_gains + total_losses))';


-- Migration 2: wallet_tracking_criteria
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_tracking_criteria (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID, -- NULL for system/default criteria
  name TEXT NOT NULL,
  description TEXT,

  -- Omega criteria
  min_omega_ratio DECIMAL(10, 4),
  max_omega_ratio DECIMAL(10, 4),
  min_omega_momentum DECIMAL(10, 4),

  -- Performance criteria
  min_total_pnl DECIMAL(18, 2),
  min_roi_per_bet DECIMAL(18, 2),
  min_overall_roi DECIMAL(10, 4),
  min_win_rate DECIMAL(5, 4),

  -- Volume criteria
  min_closed_positions INTEGER,
  min_total_positions INTEGER,

  -- Grade criteria
  allowed_grades TEXT[], -- Array of 'S', 'A', 'B', 'C', 'D', 'F'

  -- Momentum criteria
  allowed_momentum TEXT[], -- Array of 'improving', 'declining', 'stable'

  -- Category criteria
  categories TEXT[], -- Array of categories to filter on
  category_match_mode TEXT CHECK (category_match_mode IN ('any', 'all', 'primary')),

  -- Active status
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for wallet_tracking_criteria
CREATE INDEX IF NOT EXISTS idx_wallet_tracking_criteria_user ON wallet_tracking_criteria(user_id) WHERE is_active = TRUE;

-- Update timestamp trigger for wallet_tracking_criteria
CREATE OR REPLACE FUNCTION update_wallet_tracking_criteria_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_wallet_tracking_criteria_updated_at_trigger ON wallet_tracking_criteria;
CREATE TRIGGER update_wallet_tracking_criteria_updated_at_trigger
  BEFORE UPDATE ON wallet_tracking_criteria
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_tracking_criteria_updated_at();

-- Insert default criteria examples (only if they don't exist)
INSERT INTO wallet_tracking_criteria (name, description, min_omega_ratio, min_closed_positions, allowed_grades, is_active)
SELECT * FROM (VALUES
  ('Elite Performers', 'Top tier wallets with exceptional omega ratios', 3.0, 20, ARRAY['S', 'A'], TRUE),
  ('Consistent Winners', 'Solid performers with good track records', 1.5, 50, ARRAY['A', 'B', 'C'], TRUE),
  ('High Volume Traders', 'Active traders with many positions', 1.0, 100, ARRAY['S', 'A', 'B', 'C'], TRUE),
  ('Improving Momentum', 'Wallets with positive momentum', 1.0, 10, ARRAY['S', 'A', 'B'], TRUE)
) AS v(name, description, min_omega_ratio, min_closed_positions, allowed_grades, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM wallet_tracking_criteria WHERE wallet_tracking_criteria.name = v.name
);

-- Update the last row to include improving momentum (only if it exists)
UPDATE wallet_tracking_criteria
SET allowed_momentum = ARRAY['improving']
WHERE name = 'Improving Momentum' AND allowed_momentum IS NULL;

-- Comments for wallet_tracking_criteria
COMMENT ON TABLE wallet_tracking_criteria IS 'User-defined criteria for filtering wallets to track or copy trade';
COMMENT ON COLUMN wallet_tracking_criteria.category_match_mode IS 'How to match categories: any (at least one), all (all selected), primary (best performing category)';


-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Run these after migration to verify tables were created:

-- Check wallet_scores_by_category table
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'wallet_scores_by_category'
ORDER BY ordinal_position;

-- Check wallet_tracking_criteria table
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'wallet_tracking_criteria'
ORDER BY ordinal_position;

-- Check default criteria were inserted
SELECT id, name, description, min_omega_ratio, min_closed_positions
FROM wallet_tracking_criteria
ORDER BY id;

-- Expected results:
-- ✅ wallet_scores_by_category should have 22 columns
-- ✅ wallet_tracking_criteria should have 18 columns
-- ✅ 4 default criteria should be present

SELECT '✅ Migrations applied successfully!' AS status;
