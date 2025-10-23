# Workflow Sessions - Quick Reference

## Common TypeScript Operations

### Import

```typescript
import { workflowSessionService, workflowExecutionService } from '@/lib/services/workflow-session-service'
```

---

## Workflows

### Create New Workflow

```typescript
const { data, error } = await workflowSessionService.createWorkflow({
  name: 'My Strategy',
  description: 'Trading bot description',
  nodes: [],
  edges: [],
  tags: ['momentum', 'politics'],
  folder: 'Trading Bots',
  status: 'draft',
})
```

### List All Workflows

```typescript
const { data: workflows } = await workflowSessionService.listWorkflows({
  status: 'active',
  limit: 20,
  orderBy: 'updated_at',
  orderDirection: 'desc',
})
```

### Load Specific Workflow

```typescript
const { data: workflow } = await workflowSessionService.getWorkflow(workflowId)
```

### Save Changes (No Versioning)

```typescript
await workflowSessionService.updateWorkflow(workflowId, {
  nodes: updatedNodes,
  edges: updatedEdges,
})
```

### Save as New Version

```typescript
const { data: newVersion } = await workflowSessionService.createVersion(workflowId, {
  nodes: updatedNodes,
  edges: updatedEdges,
})
```

### Delete Workflow

```typescript
// Soft delete (archive)
await workflowSessionService.archiveWorkflow(workflowId)

// Hard delete (permanent)
await workflowSessionService.deleteWorkflow(workflowId)
```

### Duplicate Workflow

```typescript
const { data: newWorkflowId } = await workflowSessionService.duplicateWorkflow(
  sourceWorkflowId,
  'Copy of Strategy'
)
```

### Toggle Favorite

```typescript
await workflowSessionService.toggleFavorite(workflowId, true) // Star
await workflowSessionService.toggleFavorite(workflowId, false) // Unstar
```

### Search Workflows

```typescript
const { data: results } = await workflowSessionService.listWorkflows({
  searchQuery: 'momentum',
  tags: ['politics'],
  isFavorite: true,
})
```

### Get Version History

```typescript
const { data: history } = await workflowSessionService.getVersionHistory('My Strategy')
```

---

## Executions

### Start Execution

```typescript
const { data: execution } = await workflowExecutionService.startExecution(workflowId)
```

### Complete Execution (Success)

```typescript
await workflowExecutionService.completeExecution(executionId, {
  status: 'completed',
  nodesExecuted: 5,
  outputs: {
    'node-1': { markets: [...] },
    'node-2': { filtered: [...] },
  },
})
```

### Complete Execution (Failure)

```typescript
await workflowExecutionService.completeExecution(executionId, {
  status: 'failed',
  nodesExecuted: 2,
  errorMessage: 'Filter node failed',
  errors: [
    { nodeId: 'node-2', nodeType: 'filter', error: 'Invalid config', timestamp: Date.now() },
  ],
})
```

### Get Execution History

```typescript
const { data: executions } = await workflowExecutionService.listExecutions({
  workflowId,
  limit: 10,
})
```

### Get Execution Stats

```typescript
const { data: stats } = await workflowExecutionService.getExecutionStats(workflowId)
// Returns: { total_executions, successful_executions, failed_executions, avg_duration_ms, last_execution_at }
```

---

## Common SQL Queries

### List User's Workflows

```sql
SELECT id, name, status, tags, updated_at
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
ORDER BY updated_at DESC
LIMIT 20;
```

### Get Favorites

```sql
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND is_favorite = TRUE
ORDER BY updated_at DESC;
```

### Search by Tag

```sql
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND tags && ARRAY['momentum', 'politics']
ORDER BY updated_at DESC;
```

### Full-Text Search

```sql
SELECT *
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
  AND (name ILIKE '%momentum%' OR description ILIKE '%momentum%')
ORDER BY updated_at DESC;
```

### Get Public Templates

```sql
SELECT id, name, description, tags, execution_count
FROM workflow_sessions
WHERE is_template = TRUE
  AND is_current_version = TRUE
ORDER BY execution_count DESC;
```

### Get Most Active Workflows

```sql
SELECT id, name, execution_count, last_executed_at
FROM workflow_sessions
WHERE user_id = auth.uid()
  AND is_current_version = TRUE
ORDER BY execution_count DESC
LIMIT 10;
```

### Get Failed Executions

```sql
SELECT we.*, ws.name as workflow_name
FROM workflow_executions we
JOIN workflow_sessions ws ON we.workflow_id = ws.id
WHERE we.user_id = auth.uid()
  AND we.status = 'failed'
ORDER BY we.execution_started_at DESC
LIMIT 20;
```

### Get Execution Success Rate

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'completed') as successful,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) as total,
  ROUND(COUNT(*) FILTER (WHERE status = 'completed')::numeric / COUNT(*) * 100, 2) as success_rate
FROM workflow_executions
WHERE workflow_id = 'your-workflow-id';
```

---

## Database Functions

### Duplicate Workflow

```sql
SELECT duplicate_workflow(
  'source-workflow-id'::uuid,
  'New Workflow Name',
  auth.uid()
);
```

### Get Version History

```sql
SELECT * FROM get_workflow_version_history('My Strategy', auth.uid());
```

### Get Execution Stats

```sql
SELECT * FROM get_workflow_execution_stats('workflow-id'::uuid);
```

### Archive Old Versions

```sql
-- Keep only last 5 versions
SELECT archive_old_workflow_versions('My Strategy', auth.uid(), 5);
```

---

## Filter Options

### WorkflowSessionFilters

```typescript
{
  status?: 'draft' | 'active' | 'paused' | 'archived'
  isTemplate?: boolean
  isFavorite?: boolean
  folder?: string
  tags?: string[]
  searchQuery?: string
  isCurrentVersion?: boolean
  limit?: number
  offset?: number
  orderBy?: 'updated_at' | 'created_at' | 'name' | 'execution_count'
  orderDirection?: 'asc' | 'desc'
}
```

### WorkflowExecutionFilters

```typescript
{
  workflowId?: string
  status?: 'running' | 'completed' | 'failed' | 'cancelled'
  startDate?: Date
  endDate?: Date
  limit?: number
  offset?: number
  orderBy?: 'execution_started_at' | 'duration_ms' | 'nodes_executed'
  orderDirection?: 'asc' | 'desc'
}
```

---

## Type Reference

### WorkflowSession (Application Type)

```typescript
{
  id: string
  userId: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  trigger?: WorkflowTrigger
  variables: Record<string, any>
  version: number
  isCurrentVersion: boolean
  parentWorkflowId?: string
  tags: string[]
  isTemplate: boolean
  isFavorite: boolean
  folder?: string
  lastExecutedAt?: Date
  executionCount: number
  status: 'draft' | 'active' | 'paused' | 'archived'
  createdAt: Date
  updatedAt: Date
}
```

### WorkflowExecution (Application Type)

```typescript
{
  id: string
  workflowId: string
  userId: string
  executionStartedAt: Date
  executionCompletedAt?: Date
  durationMs?: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  nodesExecuted: number
  outputs: Record<string, any>
  errors?: ExecutionError[]
  errorMessage?: string
  workflowSnapshot?: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
    version: number
  }
  createdAt: Date
}
```

---

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

---

## Migration Commands

```bash
# Apply migration
supabase db push

# Verify
supabase db dump

# Rollback (if needed)
psql -h host -d db -c "DROP TABLE workflow_executions, workflow_sessions CASCADE;"
```

---

## Debugging

### Check RLS Policies

```sql
-- View all policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename IN ('workflow_sessions', 'workflow_executions');
```

### Check Indexes

```sql
-- List indexes
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE tablename IN ('workflow_sessions', 'workflow_executions')
ORDER BY tablename, indexname;
```

### Check Current User

```typescript
const { data: { user } } = await supabase.auth.getUser()
console.log('Current user:', user?.id)
```

### Test RLS

```sql
-- Set user context
SELECT set_config('request.jwt.claims', '{"sub": "user-id"}', true);

-- Run query (will be filtered by RLS)
SELECT * FROM workflow_sessions;
```

---

## Performance Tips

1. **Always filter by `is_current_version = TRUE`** unless you need history
2. **Use tags array** for filtering (GIN indexed)
3. **Use limit/offset** for pagination
4. **Avoid N+1 queries** - use JOIN for executions
5. **Use prepared statements** for repeated queries
6. **Cache frequently accessed workflows** in React state

---

## Error Handling

```typescript
const { data, error } = await workflowSessionService.createWorkflow({...})

if (error) {
  if (error.message.includes('duplicate key')) {
    console.error('Workflow with this name already exists')
  } else if (error.message.includes('permission denied')) {
    console.error('Not authenticated or no permission')
  } else {
    console.error('Unknown error:', error.message)
  }
  return
}

// Success
console.log('Workflow created:', data.id)
```

---

## Complete Example: Save Workflow from ReactFlow

```typescript
import { workflowSessionService } from '@/lib/services/workflow-session-service'
import { useState, useCallback } from 'react'
import { useNodesState, useEdgesState } from 'reactflow'

function WorkflowBuilder({ workflowId }: { workflowId?: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [currentWorkflowId, setCurrentWorkflowId] = useState(workflowId)
  const [saving, setSaving] = useState(false)

  // Load workflow
  useEffect(() => {
    if (currentWorkflowId) {
      workflowSessionService.getWorkflow(currentWorkflowId).then(({ data }) => {
        if (data) {
          setNodes(data.nodes)
          setEdges(data.edges)
        }
      })
    }
  }, [currentWorkflowId])

  // Save workflow
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      if (currentWorkflowId) {
        // Update existing
        await workflowSessionService.updateWorkflow(currentWorkflowId, {
          nodes,
          edges,
        })
      } else {
        // Create new
        const { data } = await workflowSessionService.createWorkflow({
          name: 'Untitled Workflow',
          nodes,
          edges,
          status: 'draft',
        })
        if (data) setCurrentWorkflowId(data.id)
      }
      console.log('Workflow saved!')
    } catch (error) {
      console.error('Failed to save:', error)
    } finally {
      setSaving(false)
    }
  }, [currentWorkflowId, nodes, edges])

  return (
    <div>
      <button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Workflow'}
      </button>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
      />
    </div>
  )
}
```

---

**For complete documentation, see:**
- `/supabase/docs/workflow-sessions-guide.md` - Full schema reference
- `/supabase/APPLY_WORKFLOW_MIGRATION.md` - Migration instructions
- `/WORKFLOW_SESSION_IMPLEMENTATION.md` - Complete implementation guide
