-- Wallet Scores Table
-- Stores pre-calculated Omega scores and smart metrics for wallets

CREATE TABLE IF NOT EXISTS wallet_scores (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,

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

  -- Classification
  momentum_direction TEXT CHECK (momentum_direction IN ('improving', 'declining', 'stable', 'insufficient_data')),
  grade TEXT CHECK (grade IN ('S', 'A', 'B', 'C', 'D', 'F')),
  meets_minimum_trades BOOLEAN DEFAULT FALSE,

  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Indexes
  CONSTRAINT wallet_scores_wallet_address_key UNIQUE (wallet_address)
);

-- Index for fast lookups
CREATE INDEX idx_wallet_scores_wallet ON wallet_scores(wallet_address);

-- Index for ranking queries
CREATE INDEX idx_wallet_scores_omega ON wallet_scores(omega_ratio DESC) WHERE meets_minimum_trades = TRUE;

-- Index for momentum queries
CREATE INDEX idx_wallet_scores_momentum ON wallet_scores(omega_momentum DESC) WHERE momentum_direction = 'improving';

-- Index for grade filtering
CREATE INDEX idx_wallet_scores_grade ON wallet_scores(grade) WHERE meets_minimum_trades = TRUE;

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_wallet_scores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_wallet_scores_updated_at_trigger
  BEFORE UPDATE ON wallet_scores
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_scores_updated_at();

-- Comment
COMMENT ON TABLE wallet_scores IS 'Pre-calculated Omega scores and performance metrics for wallet addresses';
COMMENT ON COLUMN wallet_scores.omega_ratio IS 'Ratio of total gains to total losses (higher is better)';
COMMENT ON COLUMN wallet_scores.omega_momentum IS 'Rate of change in Omega ratio (positive = improving)';
COMMENT ON COLUMN wallet_scores.grade IS 'Letter grade: S (>3.0), A (>2.0), B (>1.5), C (>1.0), D (>0.5), F (<=0.5)';
