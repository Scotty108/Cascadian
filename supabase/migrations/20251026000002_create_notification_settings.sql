-- =====================================================================
-- MIGRATION: Create notification_settings Table
-- =====================================================================
-- Purpose: Store user preferences for strategy notification delivery
--          Enables granular control over notification types and timing
--
-- Feature: Autonomous Strategy Execution System
-- Date: 2025-10-26
-- Dependencies: None (references auth.users)
-- Reversible: Yes (rollback included below)
-- =====================================================================

-- =====================================================================
-- TABLE: notification_settings
-- =====================================================================
-- User preferences for notification delivery and quiet hours
-- One row per user per notification type
-- =====================================================================

CREATE TABLE IF NOT EXISTS notification_settings (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Key
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Notification Type
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'strategy_started',      -- Strategy begins autonomous execution
    'strategy_paused',       -- Strategy paused (manual or auto)
    'strategy_stopped',      -- Strategy stopped permanently
    'strategy_error',        -- Execution error occurred
    'watchlist_updated',     -- Market added to watchlist
    'execution_completed',   -- Execution completed successfully
    'execution_failed'       -- Execution failed with error
  )),

  -- Settings
  enabled BOOLEAN DEFAULT TRUE,
  delivery_method TEXT DEFAULT 'in-app' CHECK (delivery_method IN (
    'in-app',   -- Show in notification center only
    'email',    -- Send email only (Phase 3)
    'both'      -- Both in-app and email (Phase 3)
  )),

  -- Quiet Hours (suppress notifications during specified time range)
  quiet_hours_enabled BOOLEAN DEFAULT FALSE,
  quiet_hours_start TIME,
  quiet_hours_end TIME,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique constraint: One setting row per user per notification type
  UNIQUE(user_id, notification_type)
);

-- =====================================================================
-- INDEXES: Optimize query performance
-- =====================================================================

-- Index 1: Lookup settings by user (most common query)
-- Used for: GET /api/notifications/settings
CREATE INDEX idx_notification_settings_user
  ON notification_settings(user_id);

-- Index 2: Find enabled settings by type (used by notification service)
CREATE INDEX idx_notification_settings_type_enabled
  ON notification_settings(notification_type, enabled)
  WHERE enabled = TRUE;

-- =====================================================================
-- TRIGGERS: Auto-update timestamps
-- =====================================================================

CREATE OR REPLACE FUNCTION update_notification_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notification_settings_updated
  BEFORE UPDATE ON notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_settings_timestamp();

-- =====================================================================
-- COMMENTS: Document table and column purposes
-- =====================================================================

COMMENT ON TABLE notification_settings IS
  'User preferences for strategy notification delivery and quiet hours';

COMMENT ON COLUMN notification_settings.user_id IS
  'Foreign key to auth.users. Cascades on delete (removes settings when user deleted)';

COMMENT ON COLUMN notification_settings.notification_type IS
  'Type of notification: strategy_started, strategy_paused, strategy_stopped, strategy_error, watchlist_updated, execution_completed, execution_failed';

COMMENT ON COLUMN notification_settings.enabled IS
  'Whether this notification type is enabled for the user. Default: TRUE';

COMMENT ON COLUMN notification_settings.delivery_method IS
  'How to deliver notification: in-app (default), email, or both. Email/both are Phase 3 features.';

COMMENT ON COLUMN notification_settings.quiet_hours_enabled IS
  'Suppress notifications during specified time range (quiet_hours_start to quiet_hours_end)';

COMMENT ON COLUMN notification_settings.quiet_hours_start IS
  'Start time for quiet hours (e.g., 23:00:00). Only applies if quiet_hours_enabled = TRUE';

COMMENT ON COLUMN notification_settings.quiet_hours_end IS
  'End time for quiet hours (e.g., 07:00:00). Only applies if quiet_hours_enabled = TRUE';

-- =====================================================================
-- ROW LEVEL SECURITY (RLS): Ensure users can only access own data
-- =====================================================================

ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view their own notification settings
CREATE POLICY "Users can view own notification settings"
  ON notification_settings FOR SELECT
  USING (user_id = auth.uid());

-- Policy 2: Users can insert their own notification settings
CREATE POLICY "Users can insert own notification settings"
  ON notification_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Policy 3: Users can update their own notification settings
CREATE POLICY "Users can update own notification settings"
  ON notification_settings FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Policy 4: Users can delete their own notification settings
CREATE POLICY "Users can delete own notification settings"
  ON notification_settings FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON POLICY "Users can view own notification settings" ON notification_settings IS
  'RLS: Users can only SELECT their own notification settings (user_id = auth.uid())';

COMMENT ON POLICY "Users can insert own notification settings" ON notification_settings IS
  'RLS: Users can only INSERT their own notification settings';

COMMENT ON POLICY "Users can update own notification settings" ON notification_settings IS
  'RLS: Users can only UPDATE their own notification settings';

COMMENT ON POLICY "Users can delete own notification settings" ON notification_settings IS
  'RLS: Users can only DELETE their own notification settings';

-- =====================================================================
-- HELPER FUNCTION: Check if notification should be sent
-- =====================================================================

CREATE OR REPLACE FUNCTION should_send_notification(
  p_user_id UUID,
  p_notification_type TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  setting_enabled BOOLEAN;
  quiet_enabled BOOLEAN;
  quiet_start TIME;
  quiet_end TIME;
  user_current_time TIME;
BEGIN
  -- Check if setting exists and is enabled
  SELECT enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end
  INTO setting_enabled, quiet_enabled, quiet_start, quiet_end
  FROM notification_settings
  WHERE user_id = p_user_id
    AND notification_type = p_notification_type;

  -- If no setting found, default to enabled (send notification)
  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  -- If notification type is disabled, don't send
  IF NOT setting_enabled THEN
    RETURN FALSE;
  END IF;

  -- Check quiet hours if enabled
  IF quiet_enabled AND quiet_start IS NOT NULL AND quiet_end IS NOT NULL THEN
    user_current_time := CURRENT_TIME;

    -- Handle quiet hours that span midnight
    IF quiet_start > quiet_end THEN
      -- Quiet hours span midnight (e.g., 23:00 to 07:00)
      IF user_current_time >= quiet_start OR user_current_time <= quiet_end THEN
        RETURN FALSE; -- In quiet hours
      END IF;
    ELSE
      -- Normal quiet hours (e.g., 01:00 to 06:00)
      IF user_current_time >= quiet_start AND user_current_time <= quiet_end THEN
        RETURN FALSE; -- In quiet hours
      END IF;
    END IF;
  END IF;

  -- All checks passed, send notification
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION should_send_notification(UUID, TEXT) IS
  'Check if notification should be sent based on user settings and quiet hours. Returns TRUE if notification should be sent, FALSE otherwise.';

-- =====================================================================
-- VALIDATION: Verify migration applied successfully
-- =====================================================================

DO $$
BEGIN
  -- Verify table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'notification_settings'
  ) THEN
    RAISE EXCEPTION 'Migration failed: notification_settings table not created';
  END IF;

  -- Verify unique constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'notification_settings'
    AND constraint_type = 'UNIQUE'
  ) THEN
    RAISE EXCEPTION 'Migration failed: UNIQUE constraint on (user_id, notification_type) not created';
  END IF;

  -- Verify RLS is enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'notification_settings'
    AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'Migration failed: Row Level Security not enabled on notification_settings';
  END IF;

  -- Verify helper function exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'should_send_notification'
  ) THEN
    RAISE EXCEPTION 'Migration failed: should_send_notification function not created';
  END IF;

  RAISE NOTICE 'notification_settings table created successfully';
  RAISE NOTICE '  - Added 7 notification types for strategy events';
  RAISE NOTICE '  - Created UNIQUE constraint on (user_id, notification_type)';
  RAISE NOTICE '  - Enabled RLS with 4 policies (SELECT, INSERT, UPDATE, DELETE)';
  RAISE NOTICE '  - Created should_send_notification() helper function';
  RAISE NOTICE '  - Configured auto-update timestamp trigger';
END $$;

-- =====================================================================
-- ROLLBACK MIGRATION (for reference - run separately if needed)
-- =====================================================================
/*
-- Drop helper function
DROP FUNCTION IF EXISTS should_send_notification(UUID, TEXT);

-- Drop trigger and function
DROP TRIGGER IF EXISTS notification_settings_updated ON notification_settings;
DROP FUNCTION IF EXISTS update_notification_settings_timestamp();

-- Drop RLS policies
DROP POLICY IF EXISTS "Users can view own notification settings" ON notification_settings;
DROP POLICY IF EXISTS "Users can insert own notification settings" ON notification_settings;
DROP POLICY IF EXISTS "Users can update own notification settings" ON notification_settings;
DROP POLICY IF EXISTS "Users can delete own notification settings" ON notification_settings;

-- Drop indexes
DROP INDEX IF EXISTS idx_notification_settings_user;
DROP INDEX IF EXISTS idx_notification_settings_type_enabled;

-- Drop table
DROP TABLE IF EXISTS notification_settings CASCADE;

RAISE NOTICE 'notification_settings table dropped successfully';
*/
