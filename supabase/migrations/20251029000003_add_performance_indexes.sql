-- Performance Indexes for Cron Job Queries
--
-- These indexes optimize the queries that were hammering the database from cron jobs.
-- Without these, Postgres does full table scans on every cron execution.

-- Index for strategy executor cron job
-- Query: SELECT * FROM strategy_definitions WHERE execution_mode='SCHEDULED' AND is_active=true
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_active_scheduled
ON public.strategy_definitions (is_active, execution_mode)
WHERE is_active = true AND execution_mode = 'SCHEDULED';

-- Index for general strategy filtering
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_mode_active
ON public.strategy_definitions (execution_mode, is_active);

-- Index for strategy archiving queries
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_archived_predefined
ON public.strategy_definitions (is_archived, is_predefined);

-- Index for notification queries (if they filter by user_id and is_read)
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
ON public.notifications (user_id, is_read, created_at DESC)
WHERE is_archived = false;

-- Add comment
COMMENT ON INDEX idx_strategy_definitions_active_scheduled IS 'Optimizes strategy executor cron job queries';
COMMENT ON INDEX idx_strategy_definitions_mode_active IS 'General index for strategy filtering';
COMMENT ON INDEX idx_strategy_definitions_archived_predefined IS 'Optimizes strategy library filtering';
COMMENT ON INDEX idx_notifications_user_read IS 'Optimizes notification queries';
