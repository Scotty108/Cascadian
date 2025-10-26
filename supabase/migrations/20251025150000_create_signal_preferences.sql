-- Migration: Create user signal preferences and delivery log tables
-- Purpose: User notification settings and signal tracking
-- Priority: MEDIUM (Phase 2)

-- User Signal Preferences
CREATE TABLE IF NOT EXISTS user_signal_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),

  -- Filters
  min_confidence TEXT DEFAULT 'MEDIUM' CHECK (min_confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  require_elite_confirmation BOOLEAN DEFAULT TRUE,
  min_elite_omega_score DECIMAL(10, 4) DEFAULT 2.0,

  -- Categories
  watched_categories TEXT[],

  -- Notifications
  enable_push_notifications BOOLEAN DEFAULT TRUE,
  enable_email_notifications BOOLEAN DEFAULT FALSE,
  enable_webhook BOOLEAN DEFAULT FALSE,
  webhook_url TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Signal Delivery Log
CREATE TABLE IF NOT EXISTS signal_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id),

  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('push', 'email', 'webhook')),
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  delivery_status TEXT DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  error_message TEXT,

  -- User actions
  viewed_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  traded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_signal_delivery_log_user ON signal_delivery_log(user_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_delivery_log_status ON signal_delivery_log(delivery_status, delivered_at)
  WHERE delivery_status = 'pending';

-- Updated trigger
CREATE OR REPLACE FUNCTION update_user_signal_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_signal_preferences_updated_at ON user_signal_preferences;
CREATE TRIGGER trigger_user_signal_preferences_updated_at
  BEFORE UPDATE ON user_signal_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_signal_preferences_updated_at();

-- Comments
COMMENT ON TABLE user_signal_preferences IS 'User notification settings for Live Signals';
COMMENT ON TABLE signal_delivery_log IS 'Track delivered signals and user actions for analytics';
