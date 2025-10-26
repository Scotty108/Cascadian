-- =====================================================================
-- MIGRATION: Enhance notifications Table for Strategy Events
-- =====================================================================
-- Purpose: Add workflow_id foreign key and update notification types
--          to support autonomous strategy execution notifications
--
-- Feature: Autonomous Strategy Execution System
-- Date: 2025-10-26
-- Dependencies: 20251023200000_create_notifications_table.sql
--               20251023000000_create_workflow_sessions.sql
-- Reversible: Yes (rollback included below)
-- =====================================================================

-- =====================================================================
-- ADD WORKFLOW_ID COLUMN: Link notifications to strategies
-- =====================================================================

-- Add workflow_id column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications'
    AND column_name = 'workflow_id'
  ) THEN
    ALTER TABLE public.notifications
      ADD COLUMN workflow_id UUID REFERENCES workflow_sessions(id) ON DELETE SET NULL;

    COMMENT ON COLUMN public.notifications.workflow_id IS
      'Strategy that triggered notification (nullable for non-strategy notifications)';
  END IF;
END $$;

-- =====================================================================
-- CREATE INDEX: Optimize workflow notification queries
-- =====================================================================

-- Index for looking up notifications by workflow
CREATE INDEX IF NOT EXISTS idx_notifications_workflow
  ON public.notifications(workflow_id, created_at DESC)
  WHERE workflow_id IS NOT NULL;

COMMENT ON INDEX idx_notifications_workflow IS
  'Optimizes queries for fetching notifications by strategy/workflow';

-- =====================================================================
-- UPDATE NOTIFICATION TYPE CONSTRAINT: Add strategy event types
-- =====================================================================

-- Drop existing type constraint
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

-- Add new constraint with expanded notification types
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    -- Existing types (maintain backward compatibility)
    'whale_activity',
    'market_alert',
    'insider_alert',
    'strategy_update',
    'system',
    'security',
    'account',

    -- New strategy execution types
    'strategy_started',      -- Strategy begins autonomous execution
    'strategy_paused',       -- Strategy paused (manual or auto)
    'strategy_stopped',      -- Strategy stopped permanently
    'strategy_error',        -- Execution error occurred
    'watchlist_updated',     -- Market added to watchlist
    'execution_completed',   -- Execution completed successfully
    'execution_failed'       -- Execution failed with error
  ));

-- Update column comment with new types
COMMENT ON COLUMN public.notifications.type IS
  'Notification category: whale_activity, market_alert, insider_alert, strategy_update, system, security, account, strategy_started, strategy_paused, strategy_stopped, strategy_error, watchlist_updated, execution_completed, execution_failed';

-- =====================================================================
-- VERIFY PRIORITY COLUMN: Ensure it exists with correct constraint
-- =====================================================================

-- Add priority column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications'
    AND column_name = 'priority'
  ) THEN
    ALTER TABLE public.notifications
      ADD COLUMN priority TEXT DEFAULT 'normal'
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

    COMMENT ON COLUMN public.notifications.priority IS
      'Notification urgency level: low, normal, high, urgent';
  END IF;
END $$;

-- =====================================================================
-- UPDATE RLS POLICIES: Ensure workflow notifications are accessible
-- =====================================================================

-- The existing "Allow public read access" policy should already allow
-- users to read notifications. No changes needed to RLS policies.

-- Verify RLS is still enabled
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'notifications'
    AND rowsecurity = true
  ) THEN
    RAISE WARNING 'Row Level Security is not enabled on notifications table. This may be intentional.';
  END IF;
END $$;

-- =====================================================================
-- HELPER FUNCTION: Create strategy notification
-- =====================================================================

CREATE OR REPLACE FUNCTION create_strategy_notification(
  p_user_id UUID,
  p_workflow_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_link TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT AS $$
DECLARE
  notification_id BIGINT;
  should_send BOOLEAN;
BEGIN
  -- Check if notification should be sent based on user settings
  should_send := should_send_notification(p_user_id, p_type);

  -- If user has disabled this notification type or is in quiet hours, don't send
  IF NOT should_send THEN
    RETURN NULL;
  END IF;

  -- Insert notification
  INSERT INTO public.notifications (
    user_id,
    workflow_id,
    type,
    title,
    message,
    link,
    priority,
    metadata,
    is_read,
    is_archived
  )
  VALUES (
    p_user_id,
    p_workflow_id,
    p_type,
    p_title,
    p_message,
    p_link,
    p_priority,
    p_metadata,
    FALSE,
    FALSE
  )
  RETURNING id INTO notification_id;

  RETURN notification_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_strategy_notification IS
  'Creates a strategy-related notification with user preference checking. Returns notification ID or NULL if notification was suppressed.';

-- =====================================================================
-- VALIDATION: Verify migration applied successfully
-- =====================================================================

DO $$
BEGIN
  -- Verify workflow_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications'
    AND column_name = 'workflow_id'
  ) THEN
    RAISE EXCEPTION 'Migration failed: workflow_id column not added to notifications';
  END IF;

  -- Verify priority column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications'
    AND column_name = 'priority'
  ) THEN
    RAISE EXCEPTION 'Migration failed: priority column not added to notifications';
  END IF;

  -- Verify index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'notifications'
    AND indexname = 'idx_notifications_workflow'
  ) THEN
    RAISE EXCEPTION 'Migration failed: idx_notifications_workflow index not created';
  END IF;

  -- Verify helper function exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'create_strategy_notification'
  ) THEN
    RAISE EXCEPTION 'Migration failed: create_strategy_notification function not created';
  END IF;

  RAISE NOTICE 'notifications table enhanced successfully';
  RAISE NOTICE '  - Added workflow_id column for linking to strategies';
  RAISE NOTICE '  - Updated notification types with 7 new strategy event types';
  RAISE NOTICE '  - Verified priority column exists';
  RAISE NOTICE '  - Created idx_notifications_workflow index';
  RAISE NOTICE '  - Added create_strategy_notification() helper function';
END $$;

-- =====================================================================
-- ROLLBACK MIGRATION (for reference - run separately if needed)
-- =====================================================================
/*
-- Drop helper function
DROP FUNCTION IF EXISTS create_strategy_notification;

-- Drop index
DROP INDEX IF EXISTS idx_notifications_workflow;

-- Remove workflow_id column
ALTER TABLE public.notifications
  DROP COLUMN IF EXISTS workflow_id;

-- Restore original type constraint
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'whale_activity',
    'market_alert',
    'insider_alert',
    'strategy_update',
    'system',
    'security',
    'account'
  ));

RAISE NOTICE 'notifications table enhancement rolled back';
*/
