-- Migration: Create wallet_leaderboard_history table
-- Purpose: Track wallet rank changes over time (for "Rising Stars" strategy)
-- Priority: HIGH (Phase 1)

CREATE TABLE IF NOT EXISTS wallet_leaderboard_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  snapshot_date DATE NOT NULL,

  -- Overall Rankings
  overall_rank INT,
  overall_rank_prev_day INT,
  overall_rank_7d_ago INT,
  overall_rank_30d_ago INT,

  -- Rank Changes (CRITICAL for "Rising Star" strategy)
  rank_change_1d INT,
  rank_change_7d INT,
  rank_change_30d INT,

  -- Context
  omega_ratio DECIMAL(12, 4),
  omega_ratio_prev_day DECIMAL(12, 4),
  total_pnl DECIMAL(18, 2),
  resolved_bets INT,

  -- Category-Specific Rankings
  category_ranks JSONB,
  category_rank_changes_7d JSONB,

  -- Movement Classification
  movement_type TEXT CHECK (movement_type IN ('rocketing', 'rising', 'stable', 'declining', 'falling')),
  momentum_score DECIMAL(10, 6),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(wallet_address, snapshot_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_leaderboard_history_date ON wallet_leaderboard_history(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_leaderboard_history_wallet ON wallet_leaderboard_history(wallet_address, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_leaderboard_history_rank_change ON wallet_leaderboard_history(rank_change_7d DESC)
  WHERE rank_change_7d > 10;

COMMENT ON TABLE wallet_leaderboard_history IS 'Daily snapshots of wallet rankings for tracking momentum';
COMMENT ON COLUMN wallet_leaderboard_history.rank_change_7d IS 'KEY: Positive = moved up in rankings (Rising Stars)';
