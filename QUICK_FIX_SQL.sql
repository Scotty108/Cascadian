-- ============================================================================
-- CRITICAL DATABASE FIXES - COPY AND PASTE INTO SUPABASE SQL EDITOR
-- ============================================================================
-- URL: https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/sql/new
-- ============================================================================

-- ---------------------------------------------------------------------------
-- MIGRATION 1: Unarchive Default Strategies
-- ---------------------------------------------------------------------------

UPDATE strategy_definitions
SET is_archived = FALSE
WHERE is_predefined = TRUE
  AND is_archived = TRUE;

-- Verify:
SELECT
  COUNT(*) as unarchived_count,
  STRING_AGG(strategy_name, ', ') as strategy_names
FROM strategy_definitions
WHERE is_predefined = TRUE
  AND is_archived = FALSE;

-- ---------------------------------------------------------------------------
-- MIGRATION 2: Add Performance Indexes
-- ---------------------------------------------------------------------------

-- Index for strategy executor cron job
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_active_scheduled
ON public.strategy_definitions (is_active, execution_mode)
WHERE is_active = true AND execution_mode = 'SCHEDULED';

-- Index for general strategy filtering
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_mode_active
ON public.strategy_definitions (execution_mode, is_active);

-- Index for strategy archiving queries
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_archived_predefined
ON public.strategy_definitions (is_archived, is_predefined);

-- Index for notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
ON public.notifications (user_id, is_read, created_at DESC)
WHERE is_archived = false;

-- Add comments
COMMENT ON INDEX idx_strategy_definitions_active_scheduled IS 'Optimizes strategy executor cron job queries';
COMMENT ON INDEX idx_strategy_definitions_mode_active IS 'General index for strategy filtering';
COMMENT ON INDEX idx_strategy_definitions_archived_predefined IS 'Optimizes strategy library filtering';
COMMENT ON INDEX idx_notifications_user_read IS 'Optimizes notification queries';

-- ---------------------------------------------------------------------------
-- VERIFICATION: Check that indexes were created
-- ---------------------------------------------------------------------------

SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_strategy_definitions_active_scheduled',
    'idx_strategy_definitions_mode_active',
    'idx_strategy_definitions_archived_predefined',
    'idx_notifications_user_read'
  )
ORDER BY indexname;

-- ============================================================================
-- DONE! You should see:
-- 1. Unarchived strategies count and names
-- 2. All 4 indexes created
-- ============================================================================
