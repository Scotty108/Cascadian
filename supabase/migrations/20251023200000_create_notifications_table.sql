-- =====================================================================
-- NOTIFICATIONS SCHEMA - USER NOTIFICATION SYSTEM
-- =====================================================================
-- Purpose: Store and manage user notifications for CASCADIAN platform
--          Supports: Real-time alerts, market notifications, whale activity
--
-- Design Goals:
--   1. Support multiple notification types
--   2. Track read/unread status
--   3. Enable notification filtering and sorting
--   4. Support future user-specific notifications
--   5. Maintain notification history
--
-- Date: 2025-10-23
-- =====================================================================

-- =====================================================================
-- TABLE: notifications
-- =====================================================================
-- Master table for all platform notifications
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  -- Primary Key
  id BIGSERIAL PRIMARY KEY,

  -- User Reference (nullable for now to support anonymous users)
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Notification Classification
  type TEXT NOT NULL CHECK (type IN (
    'whale_activity',
    'market_alert',
    'insider_alert',
    'strategy_update',
    'system',
    'security',
    'account'
  )),

  -- Notification Content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT, -- Optional URL to navigate to (e.g., /wallet/0x123, /market/abc)

  -- Status
  is_read BOOLEAN DEFAULT FALSE NOT NULL,
  is_archived BOOLEAN DEFAULT FALSE NOT NULL,

  -- Priority
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  -- Metadata
  metadata JSONB DEFAULT '{}', -- Flexible additional data (wallet_address, market_id, etc.)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  read_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT notifications_read_at_check
    CHECK ((is_read = FALSE AND read_at IS NULL) OR (is_read = TRUE AND read_at IS NOT NULL)),

  CONSTRAINT notifications_archived_at_check
    CHECK ((is_archived = FALSE AND archived_at IS NULL) OR (is_archived = TRUE AND archived_at IS NOT NULL))
);

-- =====================================================================
-- INDEXES
-- =====================================================================

-- Index for fetching unread notifications
CREATE INDEX idx_notifications_unread ON public.notifications(created_at DESC)
  WHERE is_read = FALSE AND is_archived = FALSE;

-- Index for fetching user notifications
CREATE INDEX idx_notifications_user ON public.notifications(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Index for fetching all active notifications (read and unread)
CREATE INDEX idx_notifications_active ON public.notifications(created_at DESC)
  WHERE is_archived = FALSE;

-- Index for notification type filtering
CREATE INDEX idx_notifications_type ON public.notifications(type, created_at DESC);

-- Index for priority filtering
CREATE INDEX idx_notifications_priority ON public.notifications(priority, created_at DESC)
  WHERE priority IN ('high', 'urgent');

-- =====================================================================
-- TRIGGERS: Auto-update timestamps
-- =====================================================================

CREATE OR REPLACE FUNCTION update_notification_read_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_read = TRUE AND OLD.is_read = FALSE THEN
    NEW.read_at = NOW();
  ELSIF NEW.is_read = FALSE AND OLD.is_read = TRUE THEN
    NEW.read_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notifications_read_timestamp
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_read_timestamp();

CREATE OR REPLACE FUNCTION update_notification_archived_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_archived = TRUE AND OLD.is_archived = FALSE THEN
    NEW.archived_at = NOW();
  ELSIF NEW.is_archived = FALSE AND OLD.is_archived = TRUE THEN
    NEW.archived_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notifications_archived_timestamp
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_archived_timestamp();

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- Function: Get unread notification count
CREATE OR REPLACE FUNCTION get_unread_notification_count(p_user_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM notifications
  WHERE is_read = FALSE
    AND is_archived = FALSE
    AND (p_user_id IS NULL OR user_id = p_user_id OR user_id IS NULL);
$$ LANGUAGE sql STABLE;

-- Function: Mark all notifications as read
CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_user_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE notifications
  SET is_read = TRUE
  WHERE is_read = FALSE
    AND is_archived = FALSE
    AND (p_user_id IS NULL OR user_id = p_user_id OR user_id IS NULL);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function: Archive old notifications (older than 30 days)
CREATE OR REPLACE FUNCTION archive_old_notifications(days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  archived_count INTEGER;
BEGIN
  UPDATE notifications
  SET is_archived = TRUE
  WHERE created_at < NOW() - (days_old || ' days')::INTERVAL
    AND is_archived = FALSE;

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

-- Enable Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access (since we support anonymous users)
CREATE POLICY "Allow public read access" ON public.notifications
  FOR SELECT USING (true);

-- Policy: Allow authenticated users to update their own notifications
CREATE POLICY "Allow users to update own notifications" ON public.notifications
  FOR UPDATE USING (
    user_id IS NULL OR
    user_id = auth.uid()
  );

-- Policy: Allow service role to insert notifications
CREATE POLICY "Allow service role to insert" ON public.notifications
  FOR INSERT WITH CHECK (true);

-- =====================================================================
-- COMMENTS (for documentation)
-- =====================================================================

COMMENT ON TABLE public.notifications IS
  'Stores all platform notifications including whale activity, market alerts, and system messages. Supports read/unread tracking and archival.';

COMMENT ON COLUMN public.notifications.type IS
  'Notification category: whale_activity, market_alert, insider_alert, strategy_update, system, security, account';

COMMENT ON COLUMN public.notifications.metadata IS
  'Flexible JSONB field for additional data like wallet_address, market_id, amount_usd, etc.';

COMMENT ON FUNCTION get_unread_notification_count IS
  'Returns count of unread, non-archived notifications for a user (or all users if NULL)';

COMMENT ON FUNCTION mark_all_notifications_read IS
  'Marks all unread notifications as read for a user (or all users if NULL)';

COMMENT ON FUNCTION archive_old_notifications IS
  'Archives notifications older than specified days (default 30)';

-- =====================================================================
-- VALIDATION
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE 'Notifications table created successfully!';
  RAISE NOTICE 'Features: Multiple types, read/unread tracking, priority levels';
  RAISE NOTICE 'Helper functions: get_unread_count, mark_all_read, archive_old';
END $$;
