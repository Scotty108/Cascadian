-- Wallet Tracking Criteria Table
-- Stores user-defined filters for which wallets to track/copy trade

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
  category_match_mode TEXT CHECK (category_match_mode IN ('any', 'all', 'primary')), -- 'any' = at least one, 'all' = all categories, 'primary' = best category

  -- Active status
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_wallet_tracking_criteria_user ON wallet_tracking_criteria(user_id) WHERE is_active = TRUE;

-- Update timestamp trigger
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

-- Insert default criteria examples
INSERT INTO wallet_tracking_criteria (name, description, min_omega_ratio, min_closed_positions, allowed_grades, is_active)
VALUES
  ('Elite Performers', 'Top tier wallets with exceptional omega ratios', 3.0, 20, ARRAY['S', 'A'], TRUE),
  ('Consistent Winners', 'Solid performers with good track records', 1.5, 50, ARRAY['A', 'B', 'C'], TRUE),
  ('High Volume Traders', 'Active traders with many positions', 1.0, 100, ARRAY['S', 'A', 'B', 'C'], TRUE),
  ('Improving Momentum', 'Wallets with positive momentum', 1.0, 10, ARRAY['S', 'A', 'B'], TRUE);

-- Update the last row to only include improving momentum
UPDATE wallet_tracking_criteria
SET allowed_momentum = ARRAY['improving']
WHERE name = 'Improving Momentum';

-- Comments
COMMENT ON TABLE wallet_tracking_criteria IS 'User-defined criteria for filtering wallets to track or copy trade';
COMMENT ON COLUMN wallet_tracking_criteria.category_match_mode IS 'How to match categories: any (at least one), all (all selected), primary (best performing category)';
