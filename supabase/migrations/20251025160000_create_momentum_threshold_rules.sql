-- Migration: Create momentum_threshold_rules table
-- Purpose: User-defined threshold rules for momentum trading
-- Priority: MEDIUM (Phase 2)

CREATE TABLE IF NOT EXISTS momentum_threshold_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  rule_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,

  -- Market Filters
  category_filter TEXT[],
  market_ids TEXT[],
  min_liquidity DECIMAL(18, 2),

  -- BUY Signal Conditions
  buy_velocity_threshold DECIMAL(12, 8),
  buy_acceleration_threshold DECIMAL(12, 8),
  buy_price_change_pct_threshold DECIMAL(10, 4),
  buy_volume_surge_threshold DECIMAL(10, 4),
  buy_trend_strength_min DECIMAL(10, 6),

  -- SELL Signal Conditions
  sell_velocity_threshold DECIMAL(12, 8),
  sell_acceleration_threshold DECIMAL(12, 8),
  sell_price_drop_threshold DECIMAL(10, 4),
  sell_time_limit_seconds INT,

  -- Logic
  require_all_buy_conditions BOOLEAN DEFAULT FALSE,
  require_all_sell_conditions BOOLEAN DEFAULT FALSE,

  -- Risk Management
  max_position_size_usd DECIMAL(18, 2),
  max_concurrent_positions INT,
  min_expected_profit_pct DECIMAL(10, 4),

  -- Timing
  signal_expiry_seconds INT DEFAULT 60,
  cooldown_after_trade_seconds INT DEFAULT 300,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_momentum_threshold_rules_user ON momentum_threshold_rules(user_id, is_active);

-- Updated trigger
CREATE OR REPLACE FUNCTION update_momentum_threshold_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_momentum_threshold_rules_updated_at ON momentum_threshold_rules;
CREATE TRIGGER trigger_momentum_threshold_rules_updated_at
  BEFORE UPDATE ON momentum_threshold_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_momentum_threshold_rules_updated_at();

-- Comments
COMMENT ON TABLE momentum_threshold_rules IS 'User-defined threshold rules for momentum trading signals';
COMMENT ON COLUMN momentum_threshold_rules.buy_velocity_threshold IS 'Trigger BUY if velocity_1min > this value';
COMMENT ON COLUMN momentum_threshold_rules.sell_velocity_threshold IS 'Trigger SELL if velocity < this (momentum flattening)';
