-- =====================================================================
-- MIGRATION: Create orchestrator_decisions Table
-- =====================================================================
-- Purpose: Store AI-powered position sizing decisions for the Portfolio
--          Orchestrator node, supporting both autonomous and approval-based
--          trading workflows with fractional Kelly criterion
--
-- Feature: Portfolio Orchestrator - AI Risk Analysis Engine
-- Date: 2025-10-27
-- Dependencies: 20251023000000_create_workflow_sessions.sql
-- Reversible: Yes (rollback included below)
-- =====================================================================

-- =====================================================================
-- TABLE: orchestrator_decisions
-- =====================================================================
-- Stores decisions made by the Portfolio Orchestrator node, including
-- AI analysis, position sizing recommendations, and approval workflow
-- =====================================================================

CREATE TABLE IF NOT EXISTS orchestrator_decisions (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Keys
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,

  -- Node and Market Identification
  node_id TEXT NOT NULL,
  market_id TEXT NOT NULL,

  -- Decision Content
  decision TEXT NOT NULL CHECK (decision IN (
    'GO',      -- Execute trade (equivalent to BUY/SELL in fractional Kelly)
    'NO_GO',   -- Do not execute trade (equivalent to HOLD)
    'REDUCE',  -- Reduce existing position
    'CLOSE',   -- Close existing position
    'FLIP'     -- Close opposite position and open new one
  )),

  direction TEXT NOT NULL CHECK (direction IN ('YES', 'NO')),

  -- Position Sizing (based on fractional Kelly)
  recommended_size NUMERIC NOT NULL CHECK (recommended_size >= 0),
  actual_size NUMERIC CHECK (actual_size >= 0),

  -- Risk Assessment (1-10 scale)
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 1 AND 10),

  -- AI Analysis
  ai_reasoning TEXT NOT NULL,
  ai_confidence NUMERIC NOT NULL CHECK (ai_confidence BETWEEN 0 AND 1),

  -- Portfolio Context Snapshot
  -- Captures bankroll, positions, and risk state at decision time
  portfolio_snapshot JSONB NOT NULL,
  /*
  Example structure:
  {
    "bankroll_total_equity_usd": 10000,
    "bankroll_free_cash_usd": 6500,
    "deployed_capital": 3500,
    "open_positions": 7,
    "portfolio_used_fraction_pct": 0.35,
    "current_position": {
      "side": "YES",
      "shares": 100,
      "avg_entry_cost": 0.65
    },
    "cluster_allocations": {
      "Politics": 0.15,
      "Crypto": 0.20
    }
  }
  */

  -- User Overrides and Approval
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',   -- Awaiting user approval
    'approved',  -- User approved (trade executed)
    'rejected'   -- User rejected (no trade)
  )),
  user_override BOOLEAN DEFAULT FALSE,
  override_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  decided_at TIMESTAMPTZ
);

-- =====================================================================
-- INDEXES: Optimize query performance
-- =====================================================================

-- Index 1: Find pending decisions for approval workflow
-- Used by: GET /api/orchestrator/decisions?status=pending
CREATE INDEX idx_orchestrator_decisions_pending
  ON orchestrator_decisions(workflow_id, created_at DESC)
  WHERE status = 'pending';

-- Index 2: Lookup decisions by workflow (for history view)
-- Used by: GET /api/orchestrator/decisions?workflow_id=X
CREATE INDEX idx_orchestrator_decisions_workflow
  ON orchestrator_decisions(workflow_id, created_at DESC);

-- Index 3: Lookup decisions by execution (for execution detail view)
-- Used by: GET /api/executions/[id] (to show decisions made during execution)
CREATE INDEX idx_orchestrator_decisions_execution
  ON orchestrator_decisions(execution_id, created_at ASC);

-- Index 4: Find decisions by market (for market-specific analysis)
-- Used by: Analytics to track decision history per market
CREATE INDEX idx_orchestrator_decisions_market
  ON orchestrator_decisions(market_id, created_at DESC);

-- Index 5: Decision status for reporting
CREATE INDEX idx_orchestrator_decisions_status
  ON orchestrator_decisions(workflow_id, status, created_at DESC);

-- =====================================================================
-- TRIGGERS: Auto-calculate decided_at timestamp
-- =====================================================================

CREATE OR REPLACE FUNCTION set_orchestrator_decision_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  -- Set decided_at when status changes from pending to approved/rejected
  IF NEW.status IN ('approved', 'rejected') AND OLD.status = 'pending' THEN
    NEW.decided_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orchestrator_decisions_timestamp
  BEFORE UPDATE ON orchestrator_decisions
  FOR EACH ROW
  EXECUTE FUNCTION set_orchestrator_decision_timestamp();

-- =====================================================================
-- COMMENTS: Document table and column purposes
-- =====================================================================

COMMENT ON TABLE orchestrator_decisions IS
  'AI-powered position sizing decisions for the Portfolio Orchestrator node. Implements fractional Kelly criterion with approval workflow.';

COMMENT ON COLUMN orchestrator_decisions.execution_id IS
  'Foreign key to workflow_executions. Cascades on delete (removes decisions when execution deleted)';

COMMENT ON COLUMN orchestrator_decisions.workflow_id IS
  'Foreign key to workflow_sessions. Cascades on delete (removes decisions when strategy deleted)';

COMMENT ON COLUMN orchestrator_decisions.node_id IS
  'ID of the orchestrator node within the workflow that made this decision';

COMMENT ON COLUMN orchestrator_decisions.market_id IS
  'Polymarket market ID for the trading opportunity';

COMMENT ON COLUMN orchestrator_decisions.decision IS
  'AI decision: GO (execute), NO_GO (skip), REDUCE, CLOSE, or FLIP position';

COMMENT ON COLUMN orchestrator_decisions.direction IS
  'Which side to bet: YES or NO';

COMMENT ON COLUMN orchestrator_decisions.recommended_size IS
  'AI-recommended position size in USD based on fractional Kelly criterion';

COMMENT ON COLUMN orchestrator_decisions.actual_size IS
  'Actual position size executed (may differ from recommended if user adjusted). NULL if status = pending or rejected';

COMMENT ON COLUMN orchestrator_decisions.risk_score IS
  'Risk assessment on 1-10 scale. 1 = very safe, 10 = very risky';

COMMENT ON COLUMN orchestrator_decisions.ai_reasoning IS
  'AI explanation for the decision (2-3 sentences)';

COMMENT ON COLUMN orchestrator_decisions.ai_confidence IS
  'AI confidence score (0-1). Higher = more confident in decision';

COMMENT ON COLUMN orchestrator_decisions.portfolio_snapshot IS
  'JSONB snapshot of portfolio state at decision time: bankroll, positions, risk allocation';

COMMENT ON COLUMN orchestrator_decisions.status IS
  'Approval status: pending (awaiting approval), approved (trade executed), rejected (no trade)';

COMMENT ON COLUMN orchestrator_decisions.user_override IS
  'TRUE if user adjusted recommended_size before approving';

COMMENT ON COLUMN orchestrator_decisions.override_reason IS
  'Optional reason for rejection or size adjustment';

COMMENT ON COLUMN orchestrator_decisions.created_at IS
  'Timestamp when AI made the decision';

COMMENT ON COLUMN orchestrator_decisions.decided_at IS
  'Timestamp when user approved/rejected. Auto-set by trigger when status changes';

-- =====================================================================
-- ROW LEVEL SECURITY (RLS): Ensure users can only access own data
-- =====================================================================

ALTER TABLE orchestrator_decisions ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view decisions for their own workflows
CREATE POLICY "Users can view own orchestrator decisions"
  ON orchestrator_decisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = orchestrator_decisions.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Policy 2: Service role can insert decisions (called by orchestrator node)
CREATE POLICY "Service role can insert orchestrator decisions"
  ON orchestrator_decisions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = orchestrator_decisions.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Policy 3: Users can update their own pending decisions (approve/reject)
CREATE POLICY "Users can update own orchestrator decisions"
  ON orchestrator_decisions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = orchestrator_decisions.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Policy 4: Users can delete their own decisions
CREATE POLICY "Users can delete own orchestrator decisions"
  ON orchestrator_decisions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = orchestrator_decisions.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Users can view own orchestrator decisions" ON orchestrator_decisions IS
  'RLS: Users can only SELECT decisions for workflows they own (via workflow_sessions.user_id)';

COMMENT ON POLICY "Service role can insert orchestrator decisions" ON orchestrator_decisions IS
  'RLS: Only service role or workflow owner can INSERT new decisions';

COMMENT ON POLICY "Users can update own orchestrator decisions" ON orchestrator_decisions IS
  'RLS: Users can UPDATE decisions for their own workflows (approve/reject)';

COMMENT ON POLICY "Users can delete own orchestrator decisions" ON orchestrator_decisions IS
  'RLS: Users can DELETE decisions for their own workflows';

-- =====================================================================
-- HELPER FUNCTION: Get decision statistics by workflow
-- =====================================================================

CREATE OR REPLACE FUNCTION get_orchestrator_decision_stats(p_workflow_id UUID)
RETURNS TABLE(
  total_decisions BIGINT,
  pending_decisions BIGINT,
  approved_decisions BIGINT,
  rejected_decisions BIGINT,
  avg_risk_score NUMERIC,
  avg_ai_confidence NUMERIC,
  user_override_count BIGINT,
  avg_recommended_size NUMERIC,
  avg_actual_size NUMERIC
) AS $$
  SELECT
    COUNT(*) AS total_decisions,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_decisions,
    COUNT(*) FILTER (WHERE status = 'approved') AS approved_decisions,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_decisions,
    AVG(risk_score) AS avg_risk_score,
    AVG(ai_confidence) AS avg_ai_confidence,
    COUNT(*) FILTER (WHERE user_override = TRUE) AS user_override_count,
    AVG(recommended_size) AS avg_recommended_size,
    AVG(actual_size) FILTER (WHERE actual_size IS NOT NULL) AS avg_actual_size
  FROM orchestrator_decisions
  WHERE workflow_id = p_workflow_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION get_orchestrator_decision_stats(UUID) IS
  'Returns decision statistics for a workflow: counts by status, avg risk/confidence, override frequency, avg sizing';

-- =====================================================================
-- HELPER FUNCTION: Get recent pending decisions for approval
-- =====================================================================

CREATE OR REPLACE FUNCTION get_pending_decisions(
  p_workflow_id UUID,
  p_limit INTEGER DEFAULT 10
)
RETURNS SETOF orchestrator_decisions AS $$
  SELECT *
  FROM orchestrator_decisions
  WHERE workflow_id = p_workflow_id
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION get_pending_decisions(UUID, INTEGER) IS
  'Returns recent pending decisions for a workflow, ordered by created_at DESC. Default limit: 10';

-- =====================================================================
-- VALIDATION: Verify migration applied successfully
-- =====================================================================

DO $$
BEGIN
  -- Verify table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'orchestrator_decisions'
  ) THEN
    RAISE EXCEPTION 'Migration failed: orchestrator_decisions table not created';
  END IF;

  -- Verify cascade delete on foreign keys
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'orchestrator_decisions'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND rc.delete_rule = 'CASCADE'
  ) THEN
    RAISE EXCEPTION 'Migration failed: CASCADE delete rule not set on foreign keys';
  END IF;

  -- Verify RLS is enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'orchestrator_decisions'
    AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'Migration failed: Row Level Security not enabled on orchestrator_decisions';
  END IF;

  -- Verify indexes exist
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_orchestrator_decisions_pending') THEN
    RAISE EXCEPTION 'Migration failed: idx_orchestrator_decisions_pending index not created';
  END IF;

  -- Verify helper functions exist
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_orchestrator_decision_stats') THEN
    RAISE EXCEPTION 'Migration failed: get_orchestrator_decision_stats function not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_pending_decisions') THEN
    RAISE EXCEPTION 'Migration failed: get_pending_decisions function not created';
  END IF;

  RAISE NOTICE 'orchestrator_decisions table created successfully';
  RAISE NOTICE '  - Created 5 indexes for query optimization';
  RAISE NOTICE '  - Enabled RLS with 4 policies (SELECT, INSERT, UPDATE, DELETE)';
  RAISE NOTICE '  - Configured CASCADE delete on foreign keys';
  RAISE NOTICE '  - Created auto-timestamp trigger for decided_at';
  RAISE NOTICE '  - Added 2 helper functions for decision analytics';
END $$;

-- =====================================================================
-- ROLLBACK MIGRATION (for reference - run separately if needed)
-- =====================================================================
/*
-- Drop helper functions
DROP FUNCTION IF EXISTS get_orchestrator_decision_stats(UUID);
DROP FUNCTION IF EXISTS get_pending_decisions(UUID, INTEGER);

-- Drop trigger and function
DROP TRIGGER IF EXISTS orchestrator_decisions_timestamp ON orchestrator_decisions;
DROP FUNCTION IF EXISTS set_orchestrator_decision_timestamp();

-- Drop RLS policies
DROP POLICY IF EXISTS "Users can view own orchestrator decisions" ON orchestrator_decisions;
DROP POLICY IF EXISTS "Service role can insert orchestrator decisions" ON orchestrator_decisions;
DROP POLICY IF EXISTS "Users can update own orchestrator decisions" ON orchestrator_decisions;
DROP POLICY IF EXISTS "Users can delete own orchestrator decisions" ON orchestrator_decisions;

-- Drop indexes
DROP INDEX IF EXISTS idx_orchestrator_decisions_pending;
DROP INDEX IF EXISTS idx_orchestrator_decisions_workflow;
DROP INDEX IF EXISTS idx_orchestrator_decisions_execution;
DROP INDEX IF EXISTS idx_orchestrator_decisions_market;
DROP INDEX IF EXISTS idx_orchestrator_decisions_status;

-- Drop table
DROP TABLE IF EXISTS orchestrator_decisions CASCADE;

RAISE NOTICE 'orchestrator_decisions table dropped successfully';
*/
