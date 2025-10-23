# Workflow Sessions Schema - Developer Guide

## Overview

The workflow sessions schema provides persistent storage for AI-powered Polymarket trading bot workflows built with the ReactFlow visual canvas.

### Key Features

- **User-specific workflows** with Row Level Security (RLS)
- **Version tracking** for workflow evolution
- **Execution history** for audit trails
- **Template system** for sharing strategies
- **Organization features** (tags, folders, favorites)
- **Full-text search** on workflow names and descriptions

---

## Table Structure

### `workflow_sessions`

Stores complete workflow definitions with version support.

| Column                | Type        | Description                                    |
| --------------------- | ----------- | ---------------------------------------------- |
| `id`                  | UUID        | Primary key                                    |
| `user_id`             | UUID        | Owner (FK to auth.users)                       |
| `name`                | TEXT        | Workflow name (1-255 chars)                    |
| `description`         | TEXT        | Optional description                           |
| `nodes`               | JSONB       | ReactFlow nodes array                          |
| `edges`               | JSONB       | ReactFlow edges array                          |
| `trigger`             | JSONB       | Trigger config (manual/schedule/continuous)    |
| `variables`           | JSONB       | User-defined variables                         |
| `version`             | INTEGER     | Version number (starts at 1)                   |
| `is_current_version`  | BOOLEAN     | TRUE for latest version                        |
| `parent_workflow_id`  | UUID        | Previous version reference                     |
| `tags`                | TEXT[]      | Array of tags for filtering                    |
| `is_template`         | BOOLEAN     | Public template flag                           |
| `is_favorite`         | BOOLEAN     | User favorite flag                             |
| `folder`              | TEXT        | Optional folder/category                       |
| `last_executed_at`    | TIMESTAMPTZ | Last execution timestamp                       |
| `execution_count`     | INTEGER     | Total execution count                          |
| `status`              | TEXT        | draft \| active \| paused \| archived          |
| `created_at`          | TIMESTAMPTZ | Creation timestamp                             |
| `updated_at`          | TIMESTAMPTZ | Last update timestamp (auto-updated)           |

### `workflow_executions`

Tracks workflow execution history and results.

| Column                    | Type        | Description                               |
| ------------------------- | ----------- | ----------------------------------------- |
| `id`                      | UUID        | Primary key                               |
| `workflow_id`             | UUID        | FK to workflow_sessions                   |
| `user_id`                 | UUID        | Owner (FK to auth.users)                  |
| `execution_started_at`    | TIMESTAMPTZ | Execution start time                      |
| `execution_completed_at`  | TIMESTAMPTZ | Execution end time                        |
| `duration_ms`             | INTEGER     | Duration in milliseconds (auto-calculated)|
| `status`                  | TEXT        | running \| completed \| failed \| cancelled |
| `nodes_executed`          | INTEGER     | Number of nodes executed                  |
| `outputs`                 | JSONB       | Outputs by node ID                        |
| `errors`                  | JSONB       | Array of error objects                    |
| `error_message`           | TEXT        | Error summary                             |
| `workflow_snapshot`       | JSONB       | Workflow state at execution time          |
| `created_at`              | TIMESTAMPTZ | Creation timestamp                        |

---

## CRUD Operations

### Create New Workflow

```sql
-- Insert a new workflow
INSERT INTO workflow_sessions (
  user_id,
  name,
  description,
  nodes,
  edges,
  trigger,
  variables,
  tags,
  status
) VALUES (
  auth.uid(), -- Current user ID
  'My First Strategy',
  'Momentum-based trading bot for politics category',
  '[
    {"id": "node-1", "type": "polymarket-stream", "position": {"x": 100, "y": 100}, "data": {}},
    {"id": "node-2", "type": "filter", "position": {"x": 300, "y": 100}, "data": {}}
  ]'::jsonb,
  '[
    {"id": "edge-1", "source": "node-1", "target": "node-2"}
  ]'::jsonb,
  '{"type": "manual"}'::jsonb,
  '{"THRESHOLD": 0.75}'::jsonb,
  ARRAY['momentum', 'politics'],
  'draft'
)
RETURNING id;
```

### List All Workflows (Current Versions Only)

```sql
-- Get all current workflows for the logged-in user
SELECT
  id,
  name,
  description,
  tags,
  status,
  is_favorite,
  execution_count,
  last_executed_at,
  updated_at
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
ORDER BY updated_at DESC;
```

### List Workflows with Filters

```sql
-- Get active workflows in a specific folder, sorted by recent activity
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND status = 'active'
  AND folder = 'Trading Bots'
ORDER BY updated_at DESC
LIMIT 20;

-- Get favorite workflows with specific tag
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND is_favorite = TRUE
  AND 'momentum' = ANY(tags)
ORDER BY execution_count DESC;
```

### Load Specific Workflow

```sql
-- Load complete workflow by ID
SELECT *
FROM workflow_sessions
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  AND user_id = auth.uid(); -- RLS enforces this
```

### Update Workflow (Without Versioning)

```sql
-- Update workflow in place
UPDATE workflow_sessions
SET
  name = 'Updated Strategy Name',
  nodes = '[...]'::jsonb,
  edges = '[...]'::jsonb,
  tags = ARRAY['momentum', 'crypto', 'high-risk']
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  AND user_id = auth.uid()
RETURNING *;
```

### Update Workflow (With Versioning)

```sql
-- Create new version (two-step process)

-- Step 1: Mark current version as non-current
UPDATE workflow_sessions
SET is_current_version = FALSE
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  AND user_id = auth.uid();

-- Step 2: Insert new version
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
  status,
  version,
  is_current_version,
  parent_workflow_id
)
SELECT
  user_id,
  name,
  description,
  '[...]'::jsonb AS nodes, -- Updated nodes
  '[...]'::jsonb AS edges, -- Updated edges
  trigger,
  variables,
  tags,
  folder,
  status,
  version + 1, -- Increment version
  TRUE,
  id AS parent_workflow_id -- Reference previous version
FROM workflow_sessions
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
RETURNING id, version;
```

### Delete Workflow

```sql
-- Soft delete (archive)
UPDATE workflow_sessions
SET status = 'archived'
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  AND user_id = auth.uid();

-- Hard delete (permanent)
DELETE FROM workflow_sessions
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  AND user_id = auth.uid();
-- Note: CASCADE will delete related workflow_executions
```

### Duplicate Workflow (Using Helper Function)

```sql
-- Duplicate a workflow or template
SELECT duplicate_workflow(
  'source-workflow-id'::uuid,
  'New Workflow Name',
  auth.uid()
) AS new_workflow_id;
```

### Toggle Favorite

```sql
-- Mark as favorite
UPDATE workflow_sessions
SET is_favorite = TRUE
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  AND user_id = auth.uid();

-- Remove from favorites
UPDATE workflow_sessions
SET is_favorite = FALSE
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  AND user_id = auth.uid();
```

---

## Search & Discovery

### Full-Text Search

```sql
-- Search workflows by name or description
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND to_tsvector('english', name || ' ' || COALESCE(description, ''))
      @@ to_tsquery('english', 'momentum & trading')
ORDER BY updated_at DESC;

-- Simple ILIKE search (less efficient but easier)
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND (
    name ILIKE '%momentum%'
    OR description ILIKE '%momentum%'
  )
ORDER BY updated_at DESC;
```

### Browse Public Templates

```sql
-- Get all public templates
SELECT
  id,
  name,
  description,
  tags,
  execution_count,
  created_at
FROM workflow_sessions
WHERE is_template = TRUE
  AND is_current_version = TRUE
ORDER BY execution_count DESC;
```

### Find Workflows by Tag

```sql
-- Get workflows with ANY of these tags
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND tags && ARRAY['momentum', 'politics'] -- Overlaps operator
ORDER BY updated_at DESC;

-- Get workflows with ALL of these tags
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND tags @> ARRAY['momentum', 'politics'] -- Contains operator
ORDER BY updated_at DESC;
```

---

## Execution Tracking

### Start New Execution

```sql
-- Create execution record
INSERT INTO workflow_executions (
  workflow_id,
  user_id,
  status,
  workflow_snapshot
)
SELECT
  id,
  user_id,
  'running',
  jsonb_build_object(
    'nodes', nodes,
    'edges', edges,
    'version', version
  )
FROM workflow_sessions
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
RETURNING id AS execution_id;
```

### Complete Execution

```sql
-- Mark execution as completed
UPDATE workflow_executions
SET
  status = 'completed',
  execution_completed_at = NOW(),
  nodes_executed = 5,
  outputs = '{"node-1": {...}, "node-2": {...}}'::jsonb
WHERE id = 'execution-id';
-- Trigger automatically calculates duration_ms
```

### Record Execution Failure

```sql
-- Mark execution as failed
UPDATE workflow_executions
SET
  status = 'failed',
  execution_completed_at = NOW(),
  error_message = 'Node "filter" failed: Invalid configuration',
  errors = '[
    {
      "nodeId": "node-2",
      "nodeType": "filter",
      "error": "Invalid configuration",
      "timestamp": 1698765432000
    }
  ]'::jsonb
WHERE id = 'execution-id';
```

### Get Execution History

```sql
-- Get recent executions for a workflow
SELECT
  id,
  execution_started_at,
  execution_completed_at,
  duration_ms,
  status,
  nodes_executed,
  error_message
FROM workflow_executions
WHERE workflow_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
ORDER BY execution_started_at DESC
LIMIT 10;
```

### Get Execution Statistics

```sql
-- Use helper function
SELECT *
FROM get_workflow_execution_stats('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');

-- Returns:
-- total_executions | successful_executions | failed_executions | avg_duration_ms | last_execution_at
```

---

## Version Management

### Get Version History

```sql
-- Use helper function
SELECT *
FROM get_workflow_version_history('My Strategy', auth.uid());

-- Manual query
SELECT
  id,
  version,
  created_at,
  is_current_version,
  updated_at
FROM workflow_sessions
WHERE name = 'My Strategy'
  AND user_id = auth.uid()
ORDER BY version DESC;
```

### Restore Previous Version

```sql
-- Make an old version the current version

-- Step 1: Mark all versions as non-current
UPDATE workflow_sessions
SET is_current_version = FALSE
WHERE name = 'My Strategy'
  AND user_id = auth.uid();

-- Step 2: Mark specific version as current
UPDATE workflow_sessions
SET is_current_version = TRUE
WHERE id = 'old-version-id'
  AND user_id = auth.uid();
```

### Archive Old Versions

```sql
-- Use helper function to keep only last 5 versions
SELECT archive_old_workflow_versions('My Strategy', auth.uid(), 5);
```

---

## Advanced Queries

### Get Most Active Workflows

```sql
SELECT
  id,
  name,
  execution_count,
  last_executed_at
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
ORDER BY execution_count DESC
LIMIT 10;
```

### Get Recently Modified Workflows

```sql
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND updated_at > NOW() - INTERVAL '7 days'
ORDER BY updated_at DESC;
```

### Get Workflows Needing Attention (Failed Last Execution)

```sql
SELECT DISTINCT ON (we.workflow_id)
  ws.id,
  ws.name,
  we.execution_started_at,
  we.error_message
FROM workflow_sessions ws
JOIN workflow_executions we ON ws.id = we.workflow_id
WHERE ws.user_id = auth.uid()
  AND ws.is_current_version = TRUE
  AND we.status = 'failed'
ORDER BY we.workflow_id, we.execution_started_at DESC;
```

### Get Workflow with Execution Stats (JOIN)

```sql
SELECT
  ws.*,
  COUNT(we.id) AS total_runs,
  COUNT(we.id) FILTER (WHERE we.status = 'completed') AS successful_runs,
  AVG(we.duration_ms) AS avg_duration
FROM workflow_sessions ws
LEFT JOIN workflow_executions we ON ws.id = we.workflow_id
WHERE ws.user_id = auth.uid()
  AND ws.is_current_version = TRUE
GROUP BY ws.id
ORDER BY ws.updated_at DESC;
```

---

## Row Level Security (RLS)

RLS policies ensure users can only access their own workflows, except for public templates.

### Enabled Policies

1. **SELECT**: Users can view their own workflows OR public templates
2. **INSERT**: Users can only insert workflows for themselves
3. **UPDATE**: Users can only update their own workflows
4. **DELETE**: Users can only delete their own workflows

### Testing RLS

```sql
-- Set session user (for testing)
SELECT set_config('request.jwt.claims', '{"sub": "user-id-here"}', true);

-- Now queries will be scoped to this user
SELECT * FROM workflow_sessions;
```

---

## Performance Optimization

### Indexes

The schema includes optimized indexes for:

- User ID lookup (most common query)
- Current version filtering
- Recent updates sorting
- Status filtering
- Favorites quick access
- Template browsing
- Tag searching (GIN index)
- Full-text search (GIN index)
- Folder organization

### Query Tips

1. **Always filter by `is_current_version = TRUE`** unless you need historical versions
2. **Use `tags && ARRAY[...]`** for fast tag filtering (uses GIN index)
3. **Use full-text search** instead of multiple ILIKE queries
4. **Limit results** with `LIMIT` clause for pagination
5. **Use prepared statements** to avoid SQL injection and improve performance

---

## Migration Instructions

### Apply Migration

```bash
# Using Supabase CLI
supabase db push

# Or apply manually
psql -h your-db-host -d your-db-name -f supabase/migrations/20251023000000_create_workflow_sessions.sql
```

### Verify Migration

```sql
-- Check tables exist
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('workflow_sessions', 'workflow_executions');

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('workflow_sessions', 'workflow_executions');

-- Check indexes
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('workflow_sessions', 'workflow_executions');
```

### Rollback (if needed)

```sql
-- Drop tables (CASCADE will drop related objects)
DROP TABLE IF EXISTS workflow_executions CASCADE;
DROP TABLE IF EXISTS workflow_sessions CASCADE;

-- Drop helper functions
DROP FUNCTION IF EXISTS update_workflow_sessions_timestamp() CASCADE;
DROP FUNCTION IF EXISTS calculate_execution_duration() CASCADE;
DROP FUNCTION IF EXISTS get_current_workflow_version(UUID);
DROP FUNCTION IF EXISTS get_workflow_version_history(TEXT, UUID);
DROP FUNCTION IF EXISTS duplicate_workflow(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS archive_old_workflow_versions(TEXT, UUID, INTEGER);
DROP FUNCTION IF EXISTS get_workflow_execution_stats(UUID);
```

---

## Next Steps

1. **Apply the migration** to your Supabase project
2. **Test CRUD operations** using the examples above
3. **Integrate with frontend** using the TypeScript types in `/types/database.ts`
4. **Build the workflow service** layer (see `/lib/services/workflow-service.ts`)
5. **Add workflow execution engine** for running saved workflows

---

## Support & Resources

- [Supabase Docs](https://supabase.com/docs)
- [PostgreSQL JSONB](https://www.postgresql.org/docs/current/datatype-json.html)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Full-Text Search](https://supabase.com/docs/guides/database/full-text-search)
