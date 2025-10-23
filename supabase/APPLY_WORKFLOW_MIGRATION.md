# Workflow Sessions Migration - Application Guide

## Quick Start

Apply the workflow sessions migration to your Supabase database:

```bash
# Using Supabase CLI (recommended)
supabase db push

# Or apply specific migration
supabase db push supabase/migrations/20251023000000_create_workflow_sessions.sql
```

## Manual Application

If you prefer to apply the migration manually via Supabase Dashboard:

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of `/supabase/migrations/20251023000000_create_workflow_sessions.sql`
4. Paste into the SQL Editor
5. Click **Run**

## Verification

After applying the migration, verify it was successful:

```sql
-- Check tables exist
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('workflow_sessions', 'workflow_executions');

-- Should return:
--   workflow_sessions
--   workflow_executions

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('workflow_sessions', 'workflow_executions');

-- Both should have rowsecurity = true

-- Check indexes were created
SELECT count(*) as index_count
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'workflow_sessions';

-- Should return: 9 indexes

-- Test a simple query
SELECT count(*) FROM workflow_sessions;
-- Should return: 0 (no workflows yet)
```

## Post-Migration Setup

### 1. Update Environment Variables

Ensure your `.env.local` has Supabase credentials:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 2. Test CRUD Operations

Use the Supabase SQL Editor to test basic operations:

```sql
-- Create a test workflow (replace 'your-user-id' with actual user ID)
INSERT INTO workflow_sessions (
  user_id,
  name,
  description,
  nodes,
  edges,
  tags,
  status
) VALUES (
  'your-user-id'::uuid,
  'Test Workflow',
  'Testing workflow sessions',
  '[]'::jsonb,
  '[]'::jsonb,
  ARRAY['test'],
  'draft'
)
RETURNING id, name, created_at;

-- List workflows (RLS will filter by your user)
SELECT id, name, status, created_at
FROM workflow_sessions
WHERE is_current_version = TRUE;

-- Delete test workflow
DELETE FROM workflow_sessions
WHERE name = 'Test Workflow';
```

### 3. Integrate with Frontend

Import the service in your React components:

```typescript
import { workflowSessionService } from '@/lib/services/workflow-session-service'

// Example: List workflows
const { data: workflows, error } = await workflowSessionService.listWorkflows({
  status: 'active',
  limit: 20,
})

// Example: Create workflow
const { data: newWorkflow, error } = await workflowSessionService.createWorkflow({
  name: 'My Trading Bot',
  description: 'Momentum-based strategy',
  nodes: [],
  edges: [],
  tags: ['momentum', 'politics'],
})

// Example: Save workflow changes
const { data: updated, error } = await workflowSessionService.updateWorkflow(
  workflowId,
  {
    nodes: updatedNodes,
    edges: updatedEdges,
  }
)
```

## Migration Details

### Tables Created

1. **`workflow_sessions`** - Stores workflow definitions with versioning
2. **`workflow_executions`** - Tracks execution history and results

### Helper Functions Created

- `get_current_workflow_version(uuid)` - Get current version of a workflow
- `get_workflow_version_history(text, uuid)` - Get version history
- `duplicate_workflow(uuid, text, uuid)` - Duplicate workflow/template
- `archive_old_workflow_versions(text, uuid, integer)` - Cleanup old versions
- `get_workflow_execution_stats(uuid)` - Get execution statistics

### Indexes Created

**workflow_sessions (9 indexes):**
- User ID lookup
- Current version filtering
- Updated timestamp sorting
- Status filtering
- Favorites filtering
- Templates filtering
- Tags searching (GIN)
- Full-text search (GIN)
- Folder organization

**workflow_executions (4 indexes):**
- Workflow ID lookup
- User ID lookup
- Status filtering
- Recent executions composite

### RLS Policies

**workflow_sessions:**
- Users can view their own workflows + public templates
- Users can only insert/update/delete their own workflows

**workflow_executions:**
- Users can only view/insert/update their own executions

## Troubleshooting

### Error: relation "auth.users" does not exist

If you get this error, your Supabase project doesn't have the default auth schema. Update the migration:

```sql
-- Change this line in the migration
user_id UUID NOT NULL REFERENCES auth.users(id),

-- To this (removes FK constraint)
user_id UUID NOT NULL,
```

### Error: permission denied for table workflow_sessions

This means RLS is blocking your query. Make sure you're authenticated:

```typescript
// Check if user is logged in
const { data: { user } } = await supabase.auth.getUser()
console.log('Current user:', user)

// If not logged in, sign in first
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password',
})
```

### Error: function duplicate_workflow does not exist

The migration didn't complete successfully. Re-apply it:

```bash
supabase db reset
supabase db push
```

## Rollback

If you need to remove the workflow sessions schema:

```sql
-- Drop tables (CASCADE removes dependent objects)
DROP TABLE IF EXISTS workflow_executions CASCADE;
DROP TABLE IF EXISTS workflow_sessions CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS update_workflow_sessions_timestamp() CASCADE;
DROP FUNCTION IF EXISTS calculate_execution_duration() CASCADE;
DROP FUNCTION IF EXISTS get_current_workflow_version(UUID);
DROP FUNCTION IF EXISTS get_workflow_version_history(TEXT, UUID);
DROP FUNCTION IF EXISTS duplicate_workflow(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS archive_old_workflow_versions(TEXT, UUID, INTEGER);
DROP FUNCTION IF EXISTS get_workflow_execution_stats(UUID);
```

## Next Steps

1. ✅ Apply migration
2. ✅ Verify tables and RLS
3. ✅ Test CRUD operations
4. 📝 Integrate with workflow builder UI
5. 📝 Add workflow execution engine
6. 📝 Build template gallery
7. 📝 Add workflow sharing features

## Resources

- [Complete Schema Documentation](/supabase/docs/workflow-sessions-guide.md)
- [TypeScript Types](/types/database.ts)
- [Service Layer](/lib/services/workflow-session-service.ts)
- [Supabase Dashboard](https://app.supabase.com)

## Support

For issues or questions:
1. Check the [schema documentation](/supabase/docs/workflow-sessions-guide.md)
2. Review example queries in the guide
3. Test RLS policies with `EXPLAIN ANALYZE`
4. Check Supabase logs in the dashboard
