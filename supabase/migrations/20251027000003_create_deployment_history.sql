-- ============================================================================
-- DEPLOYMENT HISTORY TABLE
-- ============================================================================
-- Tracks all deployments and redeployments of strategies
-- Logs configuration changes, deployment status, and version history

CREATE TABLE IF NOT EXISTS strategy_deployments (
  -- Identity
  deployment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Strategy reference
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,

  -- Deployment metadata
  deployment_type TEXT NOT NULL CHECK (deployment_type IN ('initial', 'redeploy', 'config_change', 'pause', 'resume')),
  deployment_status TEXT NOT NULL DEFAULT 'pending' CHECK (deployment_status IN ('pending', 'active', 'paused', 'failed')),

  -- Configuration snapshot at deployment time
  node_graph JSONB NOT NULL,
  trading_mode TEXT NOT NULL CHECK (trading_mode IN ('paper', 'live')),
  paper_bankroll_usd NUMERIC,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('MANUAL', 'SCHEDULED')),
  schedule_cron TEXT,

  -- Change tracking
  changes_summary TEXT, -- Human-readable summary of what changed
  changed_nodes TEXT[], -- Array of node IDs that were modified
  previous_deployment_id UUID REFERENCES strategy_deployments(deployment_id) ON DELETE SET NULL,

  -- Deployment timing
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deployed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Status tracking
  activated_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Index for fetching deployment history by strategy
CREATE INDEX idx_deployments_strategy ON strategy_deployments(strategy_id, deployed_at DESC);

-- Index for finding active deployments
CREATE INDEX idx_deployments_status ON strategy_deployments(deployment_status) WHERE deployment_status = 'active';

-- Index for deployment timeline
CREATE INDEX idx_deployments_timeline ON strategy_deployments(deployed_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_deployment_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_deployment_timestamp_trigger
  BEFORE UPDATE ON strategy_deployments
  FOR EACH ROW
  EXECUTE FUNCTION update_deployment_timestamp();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to create deployment record and update strategy status
CREATE OR REPLACE FUNCTION deploy_strategy(
  p_strategy_id UUID,
  p_deployment_type TEXT,
  p_node_graph JSONB,
  p_trading_mode TEXT,
  p_paper_bankroll_usd NUMERIC,
  p_execution_mode TEXT,
  p_schedule_cron TEXT,
  p_changes_summary TEXT DEFAULT NULL,
  p_changed_nodes TEXT[] DEFAULT NULL,
  p_deployed_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_deployment_id UUID;
  v_previous_deployment_id UUID;
BEGIN
  -- Get previous active deployment
  SELECT deployment_id INTO v_previous_deployment_id
  FROM strategy_deployments
  WHERE strategy_id = p_strategy_id
    AND deployment_status = 'active'
  ORDER BY deployed_at DESC
  LIMIT 1;

  -- Mark previous deployment as paused
  IF v_previous_deployment_id IS NOT NULL THEN
    UPDATE strategy_deployments
    SET deployment_status = 'paused',
        paused_at = NOW()
    WHERE deployment_id = v_previous_deployment_id;
  END IF;

  -- Create new deployment record
  INSERT INTO strategy_deployments (
    strategy_id,
    deployment_type,
    deployment_status,
    node_graph,
    trading_mode,
    paper_bankroll_usd,
    execution_mode,
    schedule_cron,
    changes_summary,
    changed_nodes,
    previous_deployment_id,
    deployed_by,
    activated_at
  ) VALUES (
    p_strategy_id,
    p_deployment_type,
    'active',
    p_node_graph,
    p_trading_mode,
    p_paper_bankroll_usd,
    p_execution_mode,
    p_schedule_cron,
    p_changes_summary,
    p_changed_nodes,
    v_previous_deployment_id,
    p_deployed_by,
    NOW()
  ) RETURNING deployment_id INTO v_deployment_id;

  -- Update strategy definition status
  UPDATE strategy_definitions
  SET is_active = TRUE,
      execution_mode = p_execution_mode,
      schedule_cron = p_schedule_cron,
      trading_mode = p_trading_mode,
      paper_bankroll_usd = p_paper_bankroll_usd,
      updated_at = NOW()
  WHERE strategy_id = p_strategy_id;

  RETURN v_deployment_id;
END;
$$ LANGUAGE plpgsql;

-- Function to pause deployment
CREATE OR REPLACE FUNCTION pause_deployment(p_deployment_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE strategy_deployments
  SET deployment_status = 'paused',
      paused_at = NOW()
  WHERE deployment_id = p_deployment_id
    AND deployment_status = 'active';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE strategy_deployments ENABLE ROW LEVEL SECURITY;

-- Users can view their own strategy deployments
CREATE POLICY "users_can_view_own_deployments"
  ON strategy_deployments
  FOR SELECT
  USING (
    strategy_id IN (
      SELECT strategy_id FROM strategy_definitions WHERE created_by = auth.uid()
    )
  );

-- Users can create deployments for their own strategies
CREATE POLICY "users_can_create_own_deployments"
  ON strategy_deployments
  FOR INSERT
  WITH CHECK (
    strategy_id IN (
      SELECT strategy_id FROM strategy_definitions WHERE created_by = auth.uid()
    )
  );

-- Users can update their own deployments
CREATE POLICY "users_can_update_own_deployments"
  ON strategy_deployments
  FOR UPDATE
  USING (
    strategy_id IN (
      SELECT strategy_id FROM strategy_definitions WHERE created_by = auth.uid()
    )
  );

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE strategy_deployments IS 'Tracks deployment history and configuration changes for strategies';
COMMENT ON COLUMN strategy_deployments.deployment_type IS 'Type of deployment: initial, redeploy, config_change, pause, resume';
COMMENT ON COLUMN strategy_deployments.changes_summary IS 'Human-readable summary of what changed in this deployment';
COMMENT ON COLUMN strategy_deployments.changed_nodes IS 'Array of node IDs that were modified';
COMMENT ON COLUMN strategy_deployments.previous_deployment_id IS 'Links to previous deployment for version history';

-- ============================================================================
-- VALIDATION
-- ============================================================================

DO $$
BEGIN
  -- Verify table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'strategy_deployments'
  ) THEN
    RAISE EXCEPTION 'Migration failed: strategy_deployments table not created';
  END IF;

  -- Verify helper function exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'deploy_strategy'
  ) THEN
    RAISE EXCEPTION 'Migration failed: deploy_strategy function not created';
  END IF;

  RAISE NOTICE 'strategy_deployments table created successfully';
  RAISE NOTICE '  - Created indexes for strategy, status, and timeline queries';
  RAISE NOTICE '  - Enabled RLS with 3 policies (SELECT, INSERT, UPDATE)';
  RAISE NOTICE '  - Created deploy_strategy() and pause_deployment() helper functions';
  RAISE NOTICE '  - Added auto-update timestamp trigger';
END $$;
