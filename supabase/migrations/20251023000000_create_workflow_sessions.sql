-- =====================================================================
-- WORKFLOW SESSIONS SCHEMA
-- =====================================================================
-- Purpose: Store and manage AI-powered Polymarket trading bot workflows
--          Built with ReactFlow visual canvas for strategy building
--
-- Design Goals:
--   1. Support versioning (track workflow evolution over time)
--   2. Enable user-specific workflows with RLS policies
--   3. Store complete workflow state (nodes + edges) as JSONB
--   4. Track execution history (optional, future phase)
--   5. Support workflow templates and duplication
--   6. Optimize for common queries (list, load, save, delete)
--
-- Query Patterns Optimized:
--   - List all workflows for a user (with filters by tags, updated_at)
--   - Load specific workflow by ID
--   - Save/update workflow (with version tracking)
--   - Duplicate workflow (copy to new ID)
--   - Search workflows by name/description
--   - Get workflow execution history
--
-- Author: database-architect agent
-- Date: 2025-10-23
-- =====================================================================

-- =====================================================================
-- TABLE: workflow_sessions
-- =====================================================================
-- Stores complete workflow definitions with version support
-- One row per workflow version, current version tracked in separate column
-- =====================================================================

CREATE TABLE IF NOT EXISTS workflow_sessions (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User Association
  user_id UUID NOT NULL,
  -- NOTE: Assumes auth.users table exists (Supabase default)
  -- If using custom users table, update this FK reference

  -- Workflow Identity
  name TEXT NOT NULL,
  description TEXT,

  -- Workflow Definition (JSONB for flexibility)
  -- Stores complete ReactFlow state: { nodes: [], edges: [] }
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Workflow Configuration
  trigger JSONB, -- { type: 'manual' | 'schedule' | 'continuous', config: {...} }
  variables JSONB DEFAULT '{}'::jsonb, -- User-defined variables for workflow

  -- Version Management
  version INTEGER NOT NULL DEFAULT 1,
  is_current_version BOOLEAN DEFAULT TRUE NOT NULL,
  parent_workflow_id UUID, -- References previous version (if versioned)

  -- Metadata & Organization
  tags TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['momentum', 'politics', 'high-risk']
  is_template BOOLEAN DEFAULT FALSE, -- Public templates users can copy
  is_favorite BOOLEAN DEFAULT FALSE, -- User favorite for quick access
  folder TEXT, -- Optional folder/category for organization

  -- Execution Metadata (for future use)
  last_executed_at TIMESTAMPTZ,
  execution_count INTEGER DEFAULT 0,

  -- Status & State
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT workflow_sessions_name_length_check
    CHECK (char_length(name) >= 1 AND char_length(name) <= 255),

  CONSTRAINT workflow_sessions_version_check
    CHECK (version >= 1),

  CONSTRAINT workflow_sessions_nodes_is_array
    CHECK (jsonb_typeof(nodes) = 'array'),

  CONSTRAINT workflow_sessions_edges_is_array
    CHECK (jsonb_typeof(edges) = 'array'),

  CONSTRAINT workflow_sessions_variables_is_object
    CHECK (jsonb_typeof(variables) = 'object')
);

-- =====================================================================
-- TABLE: workflow_executions (Optional - for execution tracking)
-- =====================================================================
-- Tracks workflow execution history and results
-- Links to specific workflow version for audit trail
-- =====================================================================

CREATE TABLE IF NOT EXISTS workflow_executions (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Workflow Reference
  workflow_id UUID NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,

  -- Execution Metadata
  execution_started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  execution_completed_at TIMESTAMPTZ,
  duration_ms INTEGER, -- Calculated duration in milliseconds

  -- Execution Results
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  nodes_executed INTEGER DEFAULT 0,

  -- Execution Outputs (by node ID)
  -- { "node-1": {...}, "node-2": {...} }
  outputs JSONB DEFAULT '{}'::jsonb,

  -- Error Tracking
  errors JSONB, -- [{ nodeId, nodeType, error, timestamp }]
  error_message TEXT,

  -- Workflow Snapshot (for audit - captures workflow state at execution time)
  workflow_snapshot JSONB, -- { nodes: [], edges: [], version: 1 }

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =====================================================================
-- INDEXES for workflow_sessions table
-- =====================================================================
-- Optimize for common query patterns
-- =====================================================================

-- Index 1: User ID lookup (primary query pattern)
CREATE INDEX idx_workflow_sessions_user_id
  ON workflow_sessions(user_id);

-- Index 2: Current version filter (most queries want current version only)
CREATE INDEX idx_workflow_sessions_current_version
  ON workflow_sessions(user_id, is_current_version)
  WHERE is_current_version = TRUE;

-- Index 3: Updated timestamp (for sorting by recency)
CREATE INDEX idx_workflow_sessions_updated_at
  ON workflow_sessions(user_id, updated_at DESC)
  WHERE is_current_version = TRUE;

-- Index 4: Status filter (active, paused, archived)
CREATE INDEX idx_workflow_sessions_status
  ON workflow_sessions(user_id, status)
  WHERE is_current_version = TRUE;

-- Index 5: Favorites filter (quick access to starred workflows)
CREATE INDEX idx_workflow_sessions_favorites
  ON workflow_sessions(user_id)
  WHERE is_favorite = TRUE AND is_current_version = TRUE;

-- Index 6: Templates filter (browse public templates)
CREATE INDEX idx_workflow_sessions_templates
  ON workflow_sessions(is_template)
  WHERE is_template = TRUE AND is_current_version = TRUE;

-- Index 7: Tags search (GIN index for array operations)
CREATE INDEX idx_workflow_sessions_tags
  ON workflow_sessions USING gin(tags);

-- Index 8: Full-text search on name and description
-- Composite tsvector for both columns
CREATE INDEX idx_workflow_sessions_search
  ON workflow_sessions
  USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- Index 9: Folder organization
CREATE INDEX idx_workflow_sessions_folder
  ON workflow_sessions(user_id, folder)
  WHERE folder IS NOT NULL AND is_current_version = TRUE;

-- =====================================================================
-- INDEXES for workflow_executions table
-- =====================================================================

-- Index 1: Workflow ID lookup (get execution history for workflow)
CREATE INDEX idx_workflow_executions_workflow_id
  ON workflow_executions(workflow_id, execution_started_at DESC);

-- Index 2: User ID lookup (get user's execution history)
CREATE INDEX idx_workflow_executions_user_id
  ON workflow_executions(user_id, execution_started_at DESC);

-- Index 3: Status filter (find failed executions)
CREATE INDEX idx_workflow_executions_status
  ON workflow_executions(status)
  WHERE status IN ('failed', 'running');

-- Index 4: Recent executions (composite for performance)
CREATE INDEX idx_workflow_executions_recent
  ON workflow_executions(user_id, execution_started_at DESC, status);

-- =====================================================================
-- TRIGGERS: Auto-update timestamps
-- =====================================================================

-- Trigger: Update workflow_sessions.updated_at
CREATE OR REPLACE FUNCTION update_workflow_sessions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_sessions_updated
  BEFORE UPDATE ON workflow_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_workflow_sessions_timestamp();

-- Trigger: Update execution duration when completed
CREATE OR REPLACE FUNCTION calculate_execution_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.execution_completed_at IS NOT NULL AND OLD.execution_completed_at IS NULL THEN
    NEW.duration_ms = EXTRACT(EPOCH FROM (NEW.execution_completed_at - NEW.execution_started_at)) * 1000;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_executions_duration
  BEFORE UPDATE ON workflow_executions
  FOR EACH ROW
  EXECUTE FUNCTION calculate_execution_duration();

-- =====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================================
-- Ensure users can only access their own workflows
-- Public templates are readable by all authenticated users
-- =====================================================================

-- Enable RLS on both tables
ALTER TABLE workflow_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view their own workflows
CREATE POLICY workflow_sessions_select_own
  ON workflow_sessions
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR is_template = TRUE -- Anyone can view templates
  );

-- Policy 2: Users can insert their own workflows
CREATE POLICY workflow_sessions_insert_own
  ON workflow_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy 3: Users can update their own workflows
CREATE POLICY workflow_sessions_update_own
  ON workflow_sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy 4: Users can delete their own workflows
CREATE POLICY workflow_sessions_delete_own
  ON workflow_sessions
  FOR DELETE
  USING (auth.uid() = user_id);

-- Policy 5: Users can view their own executions
CREATE POLICY workflow_executions_select_own
  ON workflow_executions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy 6: Users can insert their own executions
CREATE POLICY workflow_executions_insert_own
  ON workflow_executions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy 7: Users can update their own executions
CREATE POLICY workflow_executions_update_own
  ON workflow_executions
  FOR UPDATE
  USING (auth.uid() = user_id);

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- Function: Get current version of a workflow
CREATE OR REPLACE FUNCTION get_current_workflow_version(workflow_uuid UUID)
RETURNS workflow_sessions AS $$
  SELECT *
  FROM workflow_sessions
  WHERE id = workflow_uuid
    AND is_current_version = TRUE
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Function: Get workflow version history
CREATE OR REPLACE FUNCTION get_workflow_version_history(workflow_name_input TEXT, user_uuid UUID)
RETURNS TABLE(
  id UUID,
  version INTEGER,
  created_at TIMESTAMPTZ,
  is_current_version BOOLEAN
) AS $$
  SELECT id, version, created_at, is_current_version
  FROM workflow_sessions
  WHERE name = workflow_name_input
    AND user_id = user_uuid
  ORDER BY version DESC;
$$ LANGUAGE sql STABLE;

-- Function: Duplicate workflow (creates new workflow from template/existing)
CREATE OR REPLACE FUNCTION duplicate_workflow(
  source_workflow_id UUID,
  new_name TEXT,
  target_user_id UUID
)
RETURNS UUID AS $$
DECLARE
  new_workflow_id UUID;
BEGIN
  -- Insert duplicated workflow
  INSERT INTO workflow_sessions (
    user_id,
    name,
    description,
    nodes,
    edges,
    trigger,
    variables,
    tags,
    folder,
    status
  )
  SELECT
    target_user_id,
    new_name,
    description || ' (Copy)' AS description,
    nodes,
    edges,
    trigger,
    variables,
    tags,
    folder,
    'draft' AS status
  FROM workflow_sessions
  WHERE id = source_workflow_id
    AND (user_id = target_user_id OR is_template = TRUE) -- Can only copy own workflows or templates
  RETURNING id INTO new_workflow_id;

  RETURN new_workflow_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Archive old versions (cleanup for version history)
-- Keeps only last N versions per workflow name
CREATE OR REPLACE FUNCTION archive_old_workflow_versions(
  workflow_name_input TEXT,
  user_uuid UUID,
  keep_versions INTEGER DEFAULT 5
)
RETURNS INTEGER AS $$
DECLARE
  archived_count INTEGER;
BEGIN
  WITH versions_to_archive AS (
    SELECT id
    FROM workflow_sessions
    WHERE name = workflow_name_input
      AND user_id = user_uuid
      AND is_current_version = FALSE
    ORDER BY version DESC
    OFFSET keep_versions
  )
  UPDATE workflow_sessions
  SET status = 'archived'
  WHERE id IN (SELECT id FROM versions_to_archive);

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- Function: Get workflow execution statistics
CREATE OR REPLACE FUNCTION get_workflow_execution_stats(workflow_uuid UUID)
RETURNS TABLE(
  total_executions BIGINT,
  successful_executions BIGINT,
  failed_executions BIGINT,
  avg_duration_ms NUMERIC,
  last_execution_at TIMESTAMPTZ
) AS $$
  SELECT
    COUNT(*) AS total_executions,
    COUNT(*) FILTER (WHERE status = 'completed') AS successful_executions,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_executions,
    AVG(duration_ms) AS avg_duration_ms,
    MAX(execution_started_at) AS last_execution_at
  FROM workflow_executions
  WHERE workflow_id = workflow_uuid;
$$ LANGUAGE sql STABLE;

-- =====================================================================
-- COMMENTS (for documentation)
-- =====================================================================

COMMENT ON TABLE workflow_sessions IS
  'Stores AI-powered Polymarket trading bot workflows built with ReactFlow canvas. Supports versioning, templates, and user organization.';

COMMENT ON COLUMN workflow_sessions.user_id IS
  'Foreign key to auth.users (Supabase default). Owner of this workflow.';

COMMENT ON COLUMN workflow_sessions.nodes IS
  'JSONB array of ReactFlow nodes. Each node: { id, type, position, data, condition }';

COMMENT ON COLUMN workflow_sessions.edges IS
  'JSONB array of ReactFlow edges. Each edge: { id, source, target, sourceHandle, targetHandle, label }';

COMMENT ON COLUMN workflow_sessions.trigger IS
  'Workflow trigger configuration: { type: "manual" | "schedule" | "continuous", config: {...} }';

COMMENT ON COLUMN workflow_sessions.variables IS
  'User-defined variables accessible within workflow nodes: { API_KEY: "...", THRESHOLD: 0.75 }';

COMMENT ON COLUMN workflow_sessions.version IS
  'Version number for this workflow. Increments when user saves changes with versioning enabled.';

COMMENT ON COLUMN workflow_sessions.is_current_version IS
  'TRUE for the latest version of this workflow. FALSE for historical versions.';

COMMENT ON COLUMN workflow_sessions.parent_workflow_id IS
  'References the previous version of this workflow (if versioned). NULL for first version.';

COMMENT ON COLUMN workflow_sessions.tags IS
  'Array of tags for filtering/searching: ["momentum", "politics", "high-risk"]';

COMMENT ON COLUMN workflow_sessions.is_template IS
  'TRUE if this is a public template that other users can copy. FALSE for private workflows.';

COMMENT ON COLUMN workflow_sessions.is_favorite IS
  'TRUE if user has starred this workflow for quick access.';

COMMENT ON COLUMN workflow_sessions.status IS
  'Workflow lifecycle status: draft, active, paused, archived';

COMMENT ON TABLE workflow_executions IS
  'Tracks execution history for workflows. Each row represents one workflow run with results and errors.';

COMMENT ON COLUMN workflow_executions.workflow_snapshot IS
  'Captures complete workflow state at execution time for audit trail: { nodes, edges, version }';

COMMENT ON COLUMN workflow_executions.outputs IS
  'Execution outputs by node ID: { "node-1": {...}, "node-2": {...} }. Stored as JSONB for flexibility.';

COMMENT ON COLUMN workflow_executions.errors IS
  'Array of errors encountered: [{ nodeId, nodeType, error, timestamp }]';

COMMENT ON FUNCTION duplicate_workflow(UUID, TEXT, UUID) IS
  'Duplicates an existing workflow or template. Returns new workflow ID. Enforces permissions via RLS.';

COMMENT ON FUNCTION get_workflow_execution_stats(UUID) IS
  'Returns execution statistics for a workflow: total runs, success rate, avg duration, last run timestamp.';

-- =====================================================================
-- VALIDATION
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_sessions') THEN
    RAISE EXCEPTION 'workflow_sessions table was not created successfully';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_executions') THEN
    RAISE EXCEPTION 'workflow_executions table was not created successfully';
  END IF;

  RAISE NOTICE 'Workflow session tables created successfully!';
  RAISE NOTICE 'RLS policies enabled - users can only access their own workflows.';
  RAISE NOTICE 'Version tracking enabled - save workflow history for audit trail.';
  RAISE NOTICE 'Ready for workflow builder integration!';
END $$;
