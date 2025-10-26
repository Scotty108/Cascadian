-- =====================================================================
-- MIGRATION: Create strategy_execution_logs Table
-- =====================================================================
-- Purpose: Store node-level execution logs for autonomous strategies
--          Provides detailed debugging information beyond workflow_executions
--
-- Feature: Autonomous Strategy Execution System
-- Date: 2025-10-26
-- Dependencies: 20251023000000_create_workflow_sessions.sql
-- Reversible: Yes (rollback included below)
-- =====================================================================

-- =====================================================================
-- TABLE: strategy_execution_logs
-- =====================================================================
-- Node-level execution logs for debugging and monitoring
-- Each row represents one node execution within a workflow run
-- =====================================================================

CREATE TABLE IF NOT EXISTS strategy_execution_logs (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Keys
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,

  -- Node Identification
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,

  -- Execution Status
  status TEXT NOT NULL CHECK (status IN (
    'running',   -- Node is currently executing
    'success',   -- Node completed successfully
    'error',     -- Node failed with error
    'skipped'    -- Node was skipped (conditional logic)
  )),

  -- Output and Errors
  output JSONB,
  error_message TEXT,

  -- Timing
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =====================================================================
-- INDEXES: Optimize query performance
-- =====================================================================

-- Index 1: Lookup logs by execution (most common query)
-- Used for: GET /api/strategies/[id]/executions/[execution_id]/logs
CREATE INDEX idx_strategy_execution_logs_execution
  ON strategy_execution_logs(execution_id, started_at ASC);

-- Index 2: Lookup logs by workflow (for aggregate analytics)
-- Used for: GET /api/strategies/[id]/logs
CREATE INDEX idx_strategy_execution_logs_workflow
  ON strategy_execution_logs(workflow_id, started_at DESC);

-- Index 3: Find failed nodes (for debugging)
CREATE INDEX idx_strategy_execution_logs_errors
  ON strategy_execution_logs(workflow_id, status)
  WHERE status IN ('error', 'skipped');

-- Index 4: Composite index for recent execution logs
CREATE INDEX idx_strategy_execution_logs_recent
  ON strategy_execution_logs(workflow_id, execution_id, started_at DESC);

-- =====================================================================
-- TRIGGERS: Auto-calculate duration
-- =====================================================================

CREATE OR REPLACE FUNCTION calculate_execution_log_duration()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate duration when execution completes
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    NEW.duration_ms = EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strategy_execution_logs_duration
  BEFORE UPDATE ON strategy_execution_logs
  FOR EACH ROW
  EXECUTE FUNCTION calculate_execution_log_duration();

-- =====================================================================
-- COMMENTS: Document table and column purposes
-- =====================================================================

COMMENT ON TABLE strategy_execution_logs IS
  'Node-level execution logs for autonomous strategies. Provides detailed debugging information for each node in a workflow execution.';

COMMENT ON COLUMN strategy_execution_logs.execution_id IS
  'Foreign key to workflow_executions. Cascades on delete (removes logs when execution deleted)';

COMMENT ON COLUMN strategy_execution_logs.workflow_id IS
  'Foreign key to workflow_sessions. Cascades on delete (removes logs when strategy deleted)';

COMMENT ON COLUMN strategy_execution_logs.node_id IS
  'Unique identifier for the node within the workflow (from ReactFlow nodes array)';

COMMENT ON COLUMN strategy_execution_logs.node_type IS
  'Type of node executed: polymarket-stream, filter, transform, condition, llm-analysis, add-to-watchlist, etc.';

COMMENT ON COLUMN strategy_execution_logs.status IS
  'Execution status: running, success, error, or skipped';

COMMENT ON COLUMN strategy_execution_logs.output IS
  'Node execution output as JSONB. Example: { markets: [...], filtered: [...] }';

COMMENT ON COLUMN strategy_execution_logs.error_message IS
  'Error message if node execution failed. NULL if status = success';

COMMENT ON COLUMN strategy_execution_logs.started_at IS
  'Timestamp when node execution started';

COMMENT ON COLUMN strategy_execution_logs.completed_at IS
  'Timestamp when node execution completed (success or error). NULL if still running.';

COMMENT ON COLUMN strategy_execution_logs.duration_ms IS
  'Execution duration in milliseconds. Auto-calculated by trigger when completed_at is set.';

-- =====================================================================
-- ROW LEVEL SECURITY (RLS): Ensure users can only access own data
-- =====================================================================

ALTER TABLE strategy_execution_logs ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view logs for their own strategies
CREATE POLICY "Users can view own strategy execution logs"
  ON strategy_execution_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_execution_logs.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Policy 2: Service role can insert execution logs (called by cron job)
-- Note: Regular users should NOT be able to insert logs manually
CREATE POLICY "Service role can insert execution logs"
  ON strategy_execution_logs FOR INSERT
  WITH CHECK (
    -- Only allow inserts from service role or the strategy owner
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_execution_logs.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Policy 3: Service role can update execution logs (to mark as completed)
CREATE POLICY "Service role can update execution logs"
  ON strategy_execution_logs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_execution_logs.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Users can view own strategy execution logs" ON strategy_execution_logs IS
  'RLS: Users can only SELECT logs for strategies they own (via workflow_sessions.user_id)';

COMMENT ON POLICY "Service role can insert execution logs" ON strategy_execution_logs IS
  'RLS: Only service role or strategy owner can INSERT new execution logs';

COMMENT ON POLICY "Service role can update execution logs" ON strategy_execution_logs IS
  'RLS: Only service role or strategy owner can UPDATE execution logs';

-- =====================================================================
-- HELPER FUNCTION: Get execution summary
-- =====================================================================

CREATE OR REPLACE FUNCTION get_execution_log_summary(p_execution_id UUID)
RETURNS TABLE(
  total_nodes BIGINT,
  successful_nodes BIGINT,
  failed_nodes BIGINT,
  skipped_nodes BIGINT,
  avg_duration_ms NUMERIC,
  total_duration_ms BIGINT
) AS $$
  SELECT
    COUNT(*) AS total_nodes,
    COUNT(*) FILTER (WHERE status = 'success') AS successful_nodes,
    COUNT(*) FILTER (WHERE status = 'error') AS failed_nodes,
    COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_nodes,
    AVG(duration_ms) AS avg_duration_ms,
    SUM(duration_ms) AS total_duration_ms
  FROM strategy_execution_logs
  WHERE execution_id = p_execution_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION get_execution_log_summary(UUID) IS
  'Returns execution summary statistics for a specific workflow execution: total nodes, success/error/skipped counts, average and total duration.';

-- =====================================================================
-- HELPER FUNCTION: Get node performance stats
-- =====================================================================

CREATE OR REPLACE FUNCTION get_node_performance_stats(
  p_workflow_id UUID,
  p_node_id TEXT
)
RETURNS TABLE(
  total_executions BIGINT,
  successful_executions BIGINT,
  failed_executions BIGINT,
  avg_duration_ms NUMERIC,
  min_duration_ms INTEGER,
  max_duration_ms INTEGER,
  last_execution_at TIMESTAMPTZ
) AS $$
  SELECT
    COUNT(*) AS total_executions,
    COUNT(*) FILTER (WHERE status = 'success') AS successful_executions,
    COUNT(*) FILTER (WHERE status = 'error') AS failed_executions,
    AVG(duration_ms) AS avg_duration_ms,
    MIN(duration_ms) AS min_duration_ms,
    MAX(duration_ms) AS max_duration_ms,
    MAX(started_at) AS last_execution_at
  FROM strategy_execution_logs
  WHERE workflow_id = p_workflow_id
    AND node_id = p_node_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION get_node_performance_stats(UUID, TEXT) IS
  'Returns performance statistics for a specific node within a workflow: execution counts, duration stats, last execution time.';

-- =====================================================================
-- VALIDATION: Verify migration applied successfully
-- =====================================================================

DO $$
BEGIN
  -- Verify table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'strategy_execution_logs'
  ) THEN
    RAISE EXCEPTION 'Migration failed: strategy_execution_logs table not created';
  END IF;

  -- Verify cascade delete on foreign keys
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'strategy_execution_logs'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND rc.delete_rule = 'CASCADE'
  ) THEN
    RAISE EXCEPTION 'Migration failed: CASCADE delete rule not set on foreign keys';
  END IF;

  -- Verify RLS is enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'strategy_execution_logs'
    AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'Migration failed: Row Level Security not enabled on strategy_execution_logs';
  END IF;

  -- Verify helper functions exist
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_execution_log_summary') THEN
    RAISE EXCEPTION 'Migration failed: get_execution_log_summary function not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_node_performance_stats') THEN
    RAISE EXCEPTION 'Migration failed: get_node_performance_stats function not created';
  END IF;

  RAISE NOTICE 'strategy_execution_logs table created successfully';
  RAISE NOTICE '  - Created 4 indexes for query optimization';
  RAISE NOTICE '  - Enabled RLS with 3 policies (SELECT, INSERT, UPDATE)';
  RAISE NOTICE '  - Configured CASCADE delete on foreign keys';
  RAISE NOTICE '  - Created auto-calculate duration trigger';
  RAISE NOTICE '  - Added 2 helper functions for execution analytics';
END $$;

-- =====================================================================
-- ROLLBACK MIGRATION (for reference - run separately if needed)
-- =====================================================================
/*
-- Drop helper functions
DROP FUNCTION IF EXISTS get_execution_log_summary(UUID);
DROP FUNCTION IF EXISTS get_node_performance_stats(UUID, TEXT);

-- Drop trigger and function
DROP TRIGGER IF EXISTS strategy_execution_logs_duration ON strategy_execution_logs;
DROP FUNCTION IF EXISTS calculate_execution_log_duration();

-- Drop RLS policies
DROP POLICY IF EXISTS "Users can view own strategy execution logs" ON strategy_execution_logs;
DROP POLICY IF EXISTS "Service role can insert execution logs" ON strategy_execution_logs;
DROP POLICY IF EXISTS "Service role can update execution logs" ON strategy_execution_logs;

-- Drop indexes
DROP INDEX IF EXISTS idx_strategy_execution_logs_execution;
DROP INDEX IF EXISTS idx_strategy_execution_logs_workflow;
DROP INDEX IF EXISTS idx_strategy_execution_logs_errors;
DROP INDEX IF EXISTS idx_strategy_execution_logs_recent;

-- Drop table
DROP TABLE IF EXISTS strategy_execution_logs CASCADE;

RAISE NOTICE 'strategy_execution_logs table dropped successfully';
*/
