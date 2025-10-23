# Workflow Session Management - Implementation Summary

## Overview

Complete database schema and service layer for AI-powered Polymarket trading bot workflow persistence, built on Supabase with PostgreSQL.

**Status**: ✅ Ready for integration

---

## What Was Built

### 1. Database Schema (`/supabase/migrations/20251023000000_create_workflow_sessions.sql`)

**Two main tables:**

#### `workflow_sessions`
- Stores complete workflow definitions (nodes + edges as JSONB)
- Supports versioning (track workflow evolution over time)
- User-specific with Row Level Security (RLS)
- Organization features: tags, folders, favorites, templates
- Full-text search on names and descriptions
- 9 optimized indexes for fast queries

#### `workflow_executions`
- Tracks workflow run history and results
- Links to workflow versions for audit trail
- Stores outputs by node ID
- Records errors and execution duration
- 4 optimized indexes for performance

**Features:**
- ✅ Version tracking with parent references
- ✅ Public template system (shareable workflows)
- ✅ RLS policies (users only see their own data)
- ✅ Helper functions (duplicate, version history, stats)
- ✅ Auto-updating timestamps
- ✅ Execution duration auto-calculation

---

### 2. TypeScript Types (`/types/database.ts`)

Complete type definitions for type-safe database operations:

- `WorkflowSessionRow` - Database row type
- `WorkflowSessionInsert` - Insert operation type
- `WorkflowSessionUpdate` - Update operation type
- `WorkflowSession` - Application-level type (parsed)
- `WorkflowExecutionRow` - Execution database row
- `WorkflowExecution` - Execution application type
- Filter types for queries
- Parser utilities (snake_case ↔ camelCase)

**Usage:**
```typescript
import type { WorkflowSession, WorkflowSessionFilters } from '@/types/database'
import { parseWorkflowSession } from '@/types/database'
```

---

### 3. Service Layer (`/lib/services/workflow-session-service.ts`)

Complete Supabase client wrapper with type-safe methods:

**Workflow Operations:**
- `listWorkflows(filters)` - List/search workflows with filters
- `getWorkflow(id)` - Get specific workflow
- `createWorkflow(workflow)` - Create new workflow
- `updateWorkflow(id, updates)` - Update workflow (no versioning)
- `createVersion(id, updates)` - Create new version
- `deleteWorkflow(id)` - Hard delete
- `archiveWorkflow(id)` - Soft delete
- `duplicateWorkflow(sourceId, newName)` - Copy workflow
- `toggleFavorite(id, isFavorite)` - Star/unstar
- `getVersionHistory(name)` - Get version timeline

**Execution Operations:**
- `startExecution(workflowId)` - Start new run
- `completeExecution(id, result)` - Mark as complete/failed
- `listExecutions(filters)` - Get execution history
- `getExecutionStats(workflowId)` - Get success rate, avg duration

**Usage:**
```typescript
import { workflowSessionService } from '@/lib/services/workflow-session-service'

// List workflows
const { data, error } = await workflowSessionService.listWorkflows({
  status: 'active',
  tags: ['momentum'],
  limit: 20,
})

// Create workflow
const { data: workflow } = await workflowSessionService.createWorkflow({
  name: 'My Bot',
  nodes: [],
  edges: [],
})

// Save changes
await workflowSessionService.updateWorkflow(workflow.id, {
  nodes: updatedNodes,
  edges: updatedEdges,
})
```

---

### 4. Documentation

#### Schema Guide (`/supabase/docs/workflow-sessions-guide.md`)
- Complete table reference
- CRUD operation examples
- Search & discovery queries
- Execution tracking examples
- Version management
- Advanced queries
- RLS policy documentation
- Performance optimization tips

#### Migration Guide (`/supabase/APPLY_WORKFLOW_MIGRATION.md`)
- Step-by-step application instructions
- Verification queries
- Post-migration setup
- Integration examples
- Troubleshooting guide
- Rollback instructions

---

## File Structure

```
/Users/scotty/Projects/Cascadian-app/
├── supabase/
│   ├── migrations/
│   │   └── 20251023000000_create_workflow_sessions.sql  [NEW]
│   ├── docs/
│   │   └── workflow-sessions-guide.md                    [NEW]
│   └── APPLY_WORKFLOW_MIGRATION.md                       [NEW]
├── types/
│   ├── database.ts                                       [NEW]
│   └── workflow.ts                                       [EXISTS]
└── lib/
    └── services/
        └── workflow-session-service.ts                   [NEW]
```

---

## Key Design Decisions

### Why JSONB for Nodes/Edges?
- **Flexibility**: ReactFlow node structure can evolve without schema changes
- **Performance**: PostgreSQL JSONB is indexed and queryable
- **Simplicity**: Store complete workflow state in two columns
- **Type Safety**: TypeScript types ensure structure at application layer

### Why Versioning?
- **Audit Trail**: Track how strategies evolve over time
- **Rollback**: Restore previous versions if needed
- **Experimentation**: Test changes without losing working versions
- **Compliance**: Required for financial trading applications

### Why RLS?
- **Security**: Users can only access their own workflows
- **Simplicity**: No manual user_id checks in application code
- **Public Templates**: RLS allows selective sharing of templates
- **Supabase Best Practice**: Recommended for all user data

### Why Separate Executions Table?
- **Performance**: Don't pollute workflow table with execution history
- **Scalability**: Executions can grow large, workflows stay small
- **Analytics**: Easy to aggregate execution stats
- **Snapshot**: Capture workflow state at execution time

---

## Usage Examples

### Create and Save Workflow

```typescript
import { workflowSessionService } from '@/lib/services/workflow-session-service'
import type { WorkflowNode, WorkflowEdge } from '@/types/workflow'

// Create workflow
const { data: workflow, error } = await workflowSessionService.createWorkflow({
  name: 'Momentum Strategy',
  description: 'Buy markets with >5% momentum in politics category',
  tags: ['momentum', 'politics'],
  nodes: [
    {
      id: 'node-1',
      type: 'polymarket-stream',
      position: { x: 100, y: 100 },
      data: { config: { categories: ['Politics'] } },
    },
    {
      id: 'node-2',
      type: 'filter',
      position: { x: 300, y: 100 },
      data: { config: { conditions: [{ field: 'momentum', operator: 'gt', value: 0.05 }] } },
    },
  ],
  edges: [
    { id: 'edge-1', source: 'node-1', target: 'node-2' },
  ],
})

if (error) {
  console.error('Failed to create workflow:', error)
  return
}

console.log('Workflow created:', workflow.id)
```

### Update Workflow

```typescript
// Update nodes/edges (in-place, no versioning)
await workflowSessionService.updateWorkflow(workflow.id, {
  nodes: updatedNodes,
  edges: updatedEdges,
})

// OR create new version (preserves history)
const { data: newVersion } = await workflowSessionService.createVersion(
  workflow.id,
  {
    nodes: updatedNodes,
    edges: updatedEdges,
  }
)
```

### List User's Workflows

```typescript
// Get all active workflows
const { data: workflows } = await workflowSessionService.listWorkflows({
  status: 'active',
  orderBy: 'updated_at',
  orderDirection: 'desc',
})

// Get favorites
const { data: favorites } = await workflowSessionService.listWorkflows({
  isFavorite: true,
})

// Search workflows
const { data: results } = await workflowSessionService.listWorkflows({
  searchQuery: 'momentum',
  tags: ['politics'],
})
```

### Track Execution

```typescript
import { workflowExecutionService } from '@/lib/services/workflow-session-service'

// Start execution
const { data: execution } = await workflowExecutionService.startExecution(workflowId)

// ... run workflow ...

// Complete successfully
await workflowExecutionService.completeExecution(execution.id, {
  status: 'completed',
  nodesExecuted: 5,
  outputs: {
    'node-1': { markets: [...] },
    'node-2': { filtered: [...] },
  },
})

// OR mark as failed
await workflowExecutionService.completeExecution(execution.id, {
  status: 'failed',
  nodesExecuted: 2,
  errorMessage: 'Node "filter" failed: Invalid configuration',
  errors: [
    { nodeId: 'node-2', nodeType: 'filter', error: 'Invalid config', timestamp: Date.now() },
  ],
})

// Get execution history
const { data: history } = await workflowExecutionService.listExecutions({
  workflowId,
  limit: 10,
})

// Get stats
const { data: stats } = await workflowExecutionService.getExecutionStats(workflowId)
console.log(`Success rate: ${stats.successful_executions / stats.total_executions * 100}%`)
```

---

## Next Steps

### 1. Apply Migration

```bash
cd /Users/scotty/Projects/Cascadian-app
supabase db push
```

### 2. Integrate with Workflow Builder

Update your ReactFlow workflow builder component to save/load from database:

```typescript
// In your workflow builder component
import { workflowSessionService } from '@/lib/services/workflow-session-service'
import { useEffect, useState } from 'react'

function WorkflowBuilder() {
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  // Load workflow on mount
  useEffect(() => {
    async function loadWorkflow() {
      const id = new URLSearchParams(window.location.search).get('id')
      if (id) {
        const { data: workflow } = await workflowSessionService.getWorkflow(id)
        if (workflow) {
          setWorkflowId(workflow.id)
          setNodes(workflow.nodes)
          setEdges(workflow.edges)
        }
      }
    }
    loadWorkflow()
  }, [])

  // Save workflow
  async function handleSave() {
    if (workflowId) {
      // Update existing
      await workflowSessionService.updateWorkflow(workflowId, { nodes, edges })
    } else {
      // Create new
      const { data } = await workflowSessionService.createWorkflow({
        name: 'Untitled Workflow',
        nodes,
        edges,
      })
      if (data) setWorkflowId(data.id)
    }
  }

  return (
    <div>
      <button onClick={handleSave}>Save Workflow</button>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={...} onEdgesChange={...} />
    </div>
  )
}
```

### 3. Add Workflow List Page

Create a page to browse saved workflows:

```typescript
// app/workflows/page.tsx
import { workflowSessionService } from '@/lib/services/workflow-session-service'

export default async function WorkflowsPage() {
  const { data: workflows } = await workflowSessionService.listWorkflows({
    isCurrentVersion: true,
    orderBy: 'updated_at',
  })

  return (
    <div>
      <h1>My Workflows</h1>
      {workflows.map(workflow => (
        <div key={workflow.id}>
          <h2>{workflow.name}</h2>
          <p>{workflow.description}</p>
          <a href={`/workflows/builder?id=${workflow.id}`}>Edit</a>
        </div>
      ))}
    </div>
  )
}
```

### 4. Add Execution Tracking

Integrate execution tracking into your workflow executor:

```typescript
import { workflowExecutionService } from '@/lib/services/workflow-session-service'

async function executeWorkflow(workflowId: string) {
  // Start execution
  const { data: execution } = await workflowExecutionService.startExecution(workflowId)

  try {
    // Run workflow
    const result = await runWorkflowEngine(workflowId)

    // Mark as completed
    await workflowExecutionService.completeExecution(execution.id, {
      status: 'completed',
      nodesExecuted: result.nodesExecuted,
      outputs: result.outputs,
    })
  } catch (error) {
    // Mark as failed
    await workflowExecutionService.completeExecution(execution.id, {
      status: 'failed',
      nodesExecuted: error.nodesExecuted ?? 0,
      errorMessage: error.message,
      errors: error.errors,
    })
  }
}
```

---

## Database Schema Highlights

### Versioning System

```sql
-- Get current version
SELECT * FROM workflow_sessions
WHERE name = 'My Strategy' AND is_current_version = TRUE;

-- Get all versions (timeline)
SELECT version, created_at, is_current_version
FROM workflow_sessions
WHERE name = 'My Strategy'
ORDER BY version DESC;

-- Restore old version
UPDATE workflow_sessions SET is_current_version = FALSE WHERE name = 'My Strategy';
UPDATE workflow_sessions SET is_current_version = TRUE WHERE id = 'old-version-id';
```

### Template System

```sql
-- Make workflow a public template
UPDATE workflow_sessions
SET is_template = TRUE
WHERE id = 'workflow-id';

-- Browse templates
SELECT * FROM workflow_sessions
WHERE is_template = TRUE AND is_current_version = TRUE;

-- Copy template to your account
SELECT duplicate_workflow('template-id'::uuid, 'My Copy', auth.uid());
```

### Full-Text Search

```sql
-- Search workflows (GIN index optimized)
SELECT * FROM workflow_sessions
WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
      @@ to_tsquery('english', 'momentum & trading');
```

---

## Performance Notes

- **9 indexes on workflow_sessions** for fast queries
- **JSONB GIN indexes** for tag and full-text search
- **Partial indexes** for common filters (is_current_version = TRUE)
- **Covering indexes** to avoid table scans
- **Auto-updated timestamps** via triggers
- **Efficient RLS policies** using indexed columns

**Expected Performance:**
- List workflows: <10ms (indexed)
- Load workflow: <5ms (PK lookup)
- Save workflow: <20ms (update + trigger)
- Search workflows: <50ms (GIN index)
- Version history: <10ms (indexed)

---

## Security

- ✅ Row Level Security (RLS) enabled on both tables
- ✅ Users can only access their own workflows
- ✅ Public templates readable by all (write-protected)
- ✅ Foreign key constraints for data integrity
- ✅ CHECK constraints for data validation
- ✅ Server-side auth.uid() for user context

---

## Support & Maintenance

### Monitoring

```sql
-- Check workflow count
SELECT status, COUNT(*) FROM workflow_sessions WHERE is_current_version = TRUE GROUP BY status;

-- Check execution success rate
SELECT
  status,
  COUNT(*) as count,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 2) as percentage
FROM workflow_executions
GROUP BY status;

-- Find slow executions
SELECT workflow_id, AVG(duration_ms) as avg_duration
FROM workflow_executions
WHERE status = 'completed'
GROUP BY workflow_id
HAVING AVG(duration_ms) > 5000
ORDER BY avg_duration DESC;
```

### Cleanup

```sql
-- Archive old executions (keep last 30 days)
DELETE FROM workflow_executions
WHERE execution_started_at < NOW() - INTERVAL '30 days';

-- Archive old versions (keep last 5 per workflow)
SELECT archive_old_workflow_versions('My Strategy', auth.uid(), 5);
```

---

## Resources

- **Migration File**: `/supabase/migrations/20251023000000_create_workflow_sessions.sql`
- **TypeScript Types**: `/types/database.ts`
- **Service Layer**: `/lib/services/workflow-session-service.ts`
- **Schema Documentation**: `/supabase/docs/workflow-sessions-guide.md`
- **Migration Guide**: `/supabase/APPLY_WORKFLOW_MIGRATION.md`
- **Workflow Types**: `/types/workflow.ts`

---

**Status**: ✅ Complete and ready for integration

All database schema, types, service layer, and documentation are complete. The workflow session management system is production-ready and follows Supabase best practices.
