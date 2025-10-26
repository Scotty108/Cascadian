-- Migration: Create smoothing_configurations table
-- Purpose: Runtime configuration for TSI smoothing methods (SMA/EMA/RMA)
-- Priority: HIGH (Phase 2 - Austin's TSI Strategy)

CREATE TABLE IF NOT EXISTS smoothing_configurations (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_name TEXT NOT NULL UNIQUE,

  -- TSI Settings
  tsi_fast_periods INTEGER DEFAULT 9 CHECK (tsi_fast_periods >= 2),
  tsi_fast_smoothing TEXT DEFAULT 'RMA' CHECK (tsi_fast_smoothing IN ('SMA', 'EMA', 'RMA')),

  tsi_slow_periods INTEGER DEFAULT 21 CHECK (tsi_slow_periods >= 2),
  tsi_slow_smoothing TEXT DEFAULT 'RMA' CHECK (tsi_slow_smoothing IN ('SMA', 'EMA', 'RMA')),

  -- Price Smoothing (optional noise reduction)
  price_smoothing_enabled BOOLEAN DEFAULT TRUE,
  price_smoothing_method TEXT DEFAULT 'RMA' CHECK (price_smoothing_method IN ('SMA', 'EMA', 'RMA')),
  price_smoothing_periods INTEGER DEFAULT 3 CHECK (price_smoothing_periods >= 1),

  -- Conviction Thresholds
  entry_conviction_threshold DECIMAL(5, 4) DEFAULT 0.90 CHECK (entry_conviction_threshold BETWEEN 0 AND 1),
  exit_on_crossover BOOLEAN DEFAULT TRUE,

  -- Metadata
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Only one active config at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_config ON smoothing_configurations(is_active) WHERE is_active = TRUE;

-- Updated trigger
CREATE OR REPLACE FUNCTION update_smoothing_configurations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_smoothing_configurations_updated_at ON smoothing_configurations;
CREATE TRIGGER trigger_smoothing_configurations_updated_at
  BEFORE UPDATE ON smoothing_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_smoothing_configurations_updated_at();

-- Default configuration (Austin's RMA preference)
INSERT INTO smoothing_configurations (config_name, is_active)
VALUES ('austin_default', TRUE)
ON CONFLICT (config_name) DO NOTHING;

-- Comments
COMMENT ON TABLE smoothing_configurations IS 'Runtime configuration for TSI smoothing - allows switching SMA/EMA/RMA without code changes';
COMMENT ON COLUMN smoothing_configurations.tsi_fast_smoothing IS 'Smoothing method for fast line (9-period default)';
COMMENT ON COLUMN smoothing_configurations.tsi_slow_smoothing IS 'Smoothing method for slow line (21-period default)';
COMMENT ON COLUMN smoothing_configurations.entry_conviction_threshold IS 'Austin''s "90% confident" threshold';
