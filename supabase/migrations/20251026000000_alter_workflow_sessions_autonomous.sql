-- =====================================================================
-- MIGRATION: Add Autonomous Execution Columns to workflow_sessions
-- =====================================================================
-- Purpose: Extend workflow_sessions table to support 24/7 autonomous
--          strategy execution with scheduling and performance tracking
--
-- Feature: Autonomous Strategy Execution System
-- Date: 2025-10-26
-- Dependencies: 20251023000000_create_workflow_sessions.sql
-- Reversible: Yes (rollback included below)
-- =====================================================================

-- =====================================================================
-- UP MIGRATION: Add new columns for autonomous execution
-- =====================================================================

-- Add execution scheduling columns
ALTER TABLE workflow_sessions
  ADD COLUMN IF NOT EXISTS execution_interval_minutes INTEGER DEFAULT 5
    CHECK (execution_interval_minutes >= 1),
  ADD COLUMN IF NOT EXISTS auto_run BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_execution_at TIMESTAMPTZ;

-- Add performance tracking columns
ALTER TABLE workflow_sessions
  ADD COLUMN IF NOT EXISTS success_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_execution_time_ms INTEGER;

COMMENT ON COLUMN workflow_sessions.execution_interval_minutes IS
  'How often to execute strategy autonomously (in minutes). Minimum: 1, Recommended: 5+';
COMMENT ON COLUMN workflow_sessions.auto_run IS
  'Whether strategy runs autonomously (TRUE) or manually (FALSE)';
COMMENT ON COLUMN workflow_sessions.last_executed_at IS
  'Timestamp of last successful or failed execution';
COMMENT ON COLUMN workflow_sessions.next_execution_at IS
  'Scheduled timestamp for next autonomous execution';
COMMENT ON COLUMN workflow_sessions.success_count IS
  'Number of successful executions (status = completed)';
COMMENT ON COLUMN workflow_sessions.error_count IS
  'Number of failed executions (status = failed)';
COMMENT ON COLUMN workflow_sessions.average_execution_time_ms IS
  'Rolling average execution time in milliseconds';

-- =====================================================================
-- UPDATE STATUS CONSTRAINT: Add autonomous execution statuses
-- =====================================================================

-- Drop existing status constraint
ALTER TABLE workflow_sessions
  DROP CONSTRAINT IF EXISTS workflow_sessions_status_check;

-- Add new constraint with additional statuses for autonomous execution
ALTER TABLE workflow_sessions
  ADD CONSTRAINT workflow_sessions_status_check
  CHECK (status IN (
    'draft',      -- Initial state, not yet activated
    'active',     -- Manually active workflow
    'paused',     -- Temporarily paused (was archived)
    'archived',   -- Permanently archived
    'running',    -- Autonomously running
    'stopped',    -- Autonomously stopped
    'error'       -- Execution error state
  ));

-- =====================================================================
-- CREATE INDEX: Optimize cron job query performance
-- =====================================================================

-- Partial index for finding strategies due for execution
-- Used by cron job to efficiently query: WHERE auto_run = TRUE AND next_execution_at <= NOW()
CREATE INDEX IF NOT EXISTS idx_workflow_sessions_auto_run
  ON workflow_sessions(auto_run, next_execution_at)
  WHERE auto_run = TRUE AND status IN ('running', 'error');

COMMENT ON INDEX idx_workflow_sessions_auto_run IS
  'Optimizes cron job queries for finding strategies due for autonomous execution';

-- =====================================================================
-- VALIDATION: Verify migration applied successfully
-- =====================================================================

DO $$
BEGIN
  -- Verify new columns exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workflow_sessions'
    AND column_name = 'execution_interval_minutes'
  ) THEN
    RAISE EXCEPTION 'Migration failed: execution_interval_minutes column not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workflow_sessions'
    AND column_name = 'auto_run'
  ) THEN
    RAISE EXCEPTION 'Migration failed: auto_run column not created';
  END IF;

  -- Verify index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'workflow_sessions'
    AND indexname = 'idx_workflow_sessions_auto_run'
  ) THEN
    RAISE EXCEPTION 'Migration failed: idx_workflow_sessions_auto_run index not created';
  END IF;

  RAISE NOTICE 'workflow_sessions autonomous execution migration completed successfully';
  RAISE NOTICE '  - Added 7 new columns for autonomous execution';
  RAISE NOTICE '  - Updated status constraint with running/stopped/error states';
  RAISE NOTICE '  - Created partial index for cron job optimization';
END $$;

-- =====================================================================
-- ROLLBACK MIGRATION (for reference - run separately if needed)
-- =====================================================================
/*
-- Drop the index
DROP INDEX IF EXISTS idx_workflow_sessions_auto_run;

-- Remove new columns
ALTER TABLE workflow_sessions
  DROP COLUMN IF EXISTS execution_interval_minutes,
  DROP COLUMN IF EXISTS auto_run,
  DROP COLUMN IF EXISTS last_executed_at,
  DROP COLUMN IF EXISTS next_execution_at,
  DROP COLUMN IF EXISTS success_count,
  DROP COLUMN IF EXISTS error_count,
  DROP COLUMN IF EXISTS average_execution_time_ms;

-- Restore original status constraint
ALTER TABLE workflow_sessions
  DROP CONSTRAINT IF EXISTS workflow_sessions_status_check;

ALTER TABLE workflow_sessions
  ADD CONSTRAINT workflow_sessions_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'archived'));

RAISE NOTICE 'workflow_sessions autonomous execution migration rolled back';
*/
