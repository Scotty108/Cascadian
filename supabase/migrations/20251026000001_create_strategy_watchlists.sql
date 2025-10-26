-- =====================================================================
-- MIGRATION: Create strategy_watchlists Table
-- =====================================================================
-- Purpose: Store per-strategy watchlists for markets to monitor
--          Enables "Add to Watchlist" workflow node functionality
--
-- Feature: Autonomous Strategy Execution System
-- Date: 2025-10-26
-- Dependencies: 20251023000000_create_workflow_sessions.sql
-- Reversible: Yes (rollback included below)
-- =====================================================================

-- =====================================================================
-- TABLE: strategy_watchlists
-- =====================================================================
-- Stores markets added to watchlist by autonomous strategies
-- Supports duplicate detection via UNIQUE constraint
-- =====================================================================

CREATE TABLE IF NOT EXISTS strategy_watchlists (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Keys
  workflow_id UUID NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,

  -- Execution Context
  added_by_execution_id UUID REFERENCES workflow_executions(id) ON DELETE SET NULL,

  -- Metadata
  added_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Deduplication Constraint
  UNIQUE(workflow_id, market_id)
);

-- =====================================================================
-- INDEXES: Optimize query performance
-- =====================================================================

-- Index 1: Lookup watchlist by workflow (most common query)
-- Used for: GET /api/strategies/[id]/watchlist
CREATE INDEX idx_strategy_watchlists_workflow
  ON strategy_watchlists(workflow_id, added_at DESC);

-- Index 2: Reverse lookup by market ID
-- Used for: Finding which strategies are watching a specific market
CREATE INDEX idx_strategy_watchlists_market
  ON strategy_watchlists(market_id);

-- Index 3: Lookup by execution (for debugging)
CREATE INDEX idx_strategy_watchlists_execution
  ON strategy_watchlists(added_by_execution_id)
  WHERE added_by_execution_id IS NOT NULL;

-- =====================================================================
-- COMMENTS: Document table and column purposes
-- =====================================================================

COMMENT ON TABLE strategy_watchlists IS
  'Markets added to watchlist by autonomous strategies via "Add to Watchlist" workflow node';

COMMENT ON COLUMN strategy_watchlists.workflow_id IS
  'Foreign key to workflow_sessions. Cascades on delete (removes watchlist when strategy deleted)';

COMMENT ON COLUMN strategy_watchlists.market_id IS
  'Polymarket market identifier (e.g., condition_id or market slug)';

COMMENT ON COLUMN strategy_watchlists.added_by_execution_id IS
  'References workflow_executions to track which execution added this market. Nullable for manual additions.';

COMMENT ON COLUMN strategy_watchlists.reason IS
  'Optional explanation of why market was added (from workflow node output). Example: "High volume ($125K), Politics category"';

COMMENT ON COLUMN strategy_watchlists.metadata IS
  'Snapshot of market data at time of add: { volume_24h, current_price, category, liquidity, etc. }';

-- =====================================================================
-- ROW LEVEL SECURITY (RLS): Ensure users can only access own data
-- =====================================================================

ALTER TABLE strategy_watchlists ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view watchlists for their own strategies
CREATE POLICY "Users can view own strategy watchlists"
  ON strategy_watchlists FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_watchlists.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Policy 2: Users can insert into watchlists for their own strategies
CREATE POLICY "Users can insert into own strategy watchlists"
  ON strategy_watchlists FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_watchlists.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Policy 3: Users can delete from watchlists for their own strategies
CREATE POLICY "Users can delete from own strategy watchlists"
  ON strategy_watchlists FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_watchlists.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Users can view own strategy watchlists" ON strategy_watchlists IS
  'RLS: Users can only SELECT watchlist entries for strategies they own (via workflow_sessions.user_id)';

COMMENT ON POLICY "Users can insert into own strategy watchlists" ON strategy_watchlists IS
  'RLS: Users can only INSERT into watchlists for their own strategies';

COMMENT ON POLICY "Users can delete from own strategy watchlists" ON strategy_watchlists IS
  'RLS: Users can only DELETE watchlist entries for their own strategies';

-- =====================================================================
-- VALIDATION: Verify migration applied successfully
-- =====================================================================

DO $$
BEGIN
  -- Verify table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'strategy_watchlists'
  ) THEN
    RAISE EXCEPTION 'Migration failed: strategy_watchlists table not created';
  END IF;

  -- Verify unique constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'strategy_watchlists'
    AND constraint_type = 'UNIQUE'
  ) THEN
    RAISE EXCEPTION 'Migration failed: UNIQUE constraint on (workflow_id, market_id) not created';
  END IF;

  -- Verify foreign key cascade behavior
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'strategy_watchlists'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND rc.delete_rule = 'CASCADE'
  ) THEN
    RAISE EXCEPTION 'Migration failed: CASCADE delete rule not set on workflow_id foreign key';
  END IF;

  -- Verify RLS is enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'strategy_watchlists'
    AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'Migration failed: Row Level Security not enabled on strategy_watchlists';
  END IF;

  RAISE NOTICE 'strategy_watchlists table created successfully';
  RAISE NOTICE '  - Added UNIQUE constraint on (workflow_id, market_id) for deduplication';
  RAISE NOTICE '  - Created 3 indexes for query optimization';
  RAISE NOTICE '  - Enabled RLS with 3 policies (SELECT, INSERT, DELETE)';
  RAISE NOTICE '  - Configured CASCADE delete when strategy is deleted';
END $$;

-- =====================================================================
-- ROLLBACK MIGRATION (for reference - run separately if needed)
-- =====================================================================
/*
-- Drop RLS policies
DROP POLICY IF EXISTS "Users can view own strategy watchlists" ON strategy_watchlists;
DROP POLICY IF EXISTS "Users can insert into own strategy watchlists" ON strategy_watchlists;
DROP POLICY IF EXISTS "Users can delete from own strategy watchlists" ON strategy_watchlists;

-- Drop indexes (CASCADE will handle this, but explicit for clarity)
DROP INDEX IF EXISTS idx_strategy_watchlists_workflow;
DROP INDEX IF EXISTS idx_strategy_watchlists_market;
DROP INDEX IF EXISTS idx_strategy_watchlists_execution;

-- Drop table (CASCADE removes foreign key constraints)
DROP TABLE IF EXISTS strategy_watchlists CASCADE;

RAISE NOTICE 'strategy_watchlists table dropped successfully';
*/
