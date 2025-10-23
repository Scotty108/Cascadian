# Workflow Session Management - Implementation Plan

## 🎯 Goal

Add full session/strategy persistence so users can:
- ✅ Create new workflows (start fresh)
- ✅ Save workflows to Supabase
- ✅ Load existing workflows
- ✅ List all their workflows
- ✅ Delete workflows
- ✅ Duplicate workflows
- ✅ Track execution history

---

## ✅ Phase 1: Database Schema - COMPLETE

**Status**: ✅ Done by backend-architect agent

**Files Created**:
1. `supabase/migrations/20251023000000_create_workflow_sessions.sql` - Database migration
2. `types/database.ts` - TypeScript types
3. `lib/services/workflow-session-service.ts` - Service layer with all CRUD operations
4. `supabase/docs/workflow-sessions-guide.md` - Complete documentation
5. `supabase/docs/workflow-quick-reference.md` - Quick reference
6. `supabase/APPLY_WORKFLOW_MIGRATION.md` - Migration instructions
7. `WORKFLOW_SESSION_IMPLEMENTATION.md` - Implementation overview

**Features**:
- ✅ `workflow_sessions` table (stores workflows)
- ✅ `workflow_executions` table (tracks execution history)
- ✅ Version tracking system
- ✅ Row Level Security (RLS) for user isolation
- ✅ Template/sharing system
- ✅ Full-text search
- ✅ 13 optimized indexes
- ✅ Complete TypeScript types
- ✅ Service layer with all CRUD operations

---

## ⏳ Phase 2: Apply Migration - PENDING

**Next Step**: Apply the database migration to Supabase

### Instructions:

```bash
cd /Users/scotty/Projects/Cascadian-app
supabase db push
```

### Verify:

```sql
-- Check tables exist
SELECT tablename FROM pg_tables
WHERE tablename IN ('workflow_sessions', 'workflow_executions');

-- Check RLS policies
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename IN ('workflow_sessions', 'workflow_executions');
```

**See**: `supabase/APPLY_WORKFLOW_MIGRATION.md` for complete instructions

---

## ⏳ Phase 3: UI Integration - PENDING

### 3.1 Update Strategy Builder Header

**File**: `app/(dashboard)/strategy-builder/page.tsx`

**Add Buttons**:
```tsx
// Header section
<div className="flex items-center gap-2">
  {/* Existing buttons */}

  {/* NEW: Session management */}
  <Button onClick={handleNewWorkflow} variant="outline">
    <Plus className="h-4 w-4 mr-2" />
    New Strategy
  </Button>

  <Button onClick={handleSaveWorkflow} variant="default">
    <Save className="h-4 w-4 mr-2" />
    Save
  </Button>

  <Button onClick={() => setShowWorkflowList(true)} variant="outline">
    <FolderOpen className="h-4 w-4 mr-2" />
    Open
  </Button>
</div>
```

### 3.2 Add Workflow List Modal

**Create**: `components/workflow-list-modal.tsx`

**Features**:
- List all user's workflows
- Search/filter by name, tags, status
- Sort by date, name, executions
- Click to load workflow
- Delete workflow
- Duplicate workflow
- Show execution stats

**Example**:
```tsx
<WorkflowListModal
  open={showWorkflowList}
  onClose={() => setShowWorkflowList(false)}
  onSelect={handleLoadWorkflow}
  onDelete={handleDeleteWorkflow}
  onDuplicate={handleDuplicateWorkflow}
/>
```

### 3.3 Add Save/Load Logic

**File**: `app/(dashboard)/strategy-builder/page.tsx`

**State**:
```tsx
const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null)
const [currentWorkflowName, setCurrentWorkflowName] = useState('Untitled Strategy')
const [isDirty, setIsDirty] = useState(false) // Track unsaved changes
```

**Save Handler**:
```tsx
const handleSaveWorkflow = async () => {
  try {
    if (currentWorkflowId) {
      // Update existing
      await workflowSessionService.updateWorkflow(currentWorkflowId, {
        nodes,
        edges,
        updatedAt: new Date().toISOString(),
      })
    } else {
      // Create new
      const { data } = await workflowSessionService.createWorkflow({
        name: currentWorkflowName,
        description: '',
        nodes,
        edges,
        tags: [],
        status: 'draft',
      })
      setCurrentWorkflowId(data.id)
    }
    setIsDirty(false)
    toast.success('Workflow saved!')
  } catch (error) {
    toast.error('Failed to save workflow')
  }
}
```

**Load Handler**:
```tsx
const handleLoadWorkflow = async (workflowId: string) => {
  try {
    const { data } = await workflowSessionService.getWorkflow(workflowId)
    setNodes(data.nodes)
    setEdges(data.edges)
    setCurrentWorkflowId(data.id)
    setCurrentWorkflowName(data.name)
    setIsDirty(false)
    toast.success(`Loaded: ${data.name}`)
  } catch (error) {
    toast.error('Failed to load workflow')
  }
}
```

**New Handler**:
```tsx
const handleNewWorkflow = () => {
  if (isDirty) {
    // Prompt to save
    const shouldSave = confirm('Save current workflow before creating new?')
    if (shouldSave) {
      handleSaveWorkflow()
    }
  }

  // Clear canvas
  setNodes([])
  setEdges([])
  setCurrentWorkflowId(null)
  setCurrentWorkflowName('Untitled Strategy')
  setIsDirty(false)
}
```

**Track Changes**:
```tsx
// Mark dirty when nodes/edges change
useEffect(() => {
  if (nodes.length > 0 || edges.length > 0) {
    setIsDirty(true)
  }
}, [nodes, edges])
```

### 3.4 Execution Tracking Integration

**File**: `lib/workflow/executor.ts`

**Update Execute Method**:
```tsx
import { workflowExecutionService } from '@/lib/services/workflow-session-service'

async execute(workflow: Workflow): Promise<ExecutionResult> {
  // Start execution tracking
  let executionId: string | undefined
  if (workflow.id) {
    const { data } = await workflowExecutionService.startExecution(workflow.id)
    executionId = data.id
  }

  try {
    // ... existing execution logic ...

    const result = {
      success: true,
      outputs: context.outputs,
      // ...
    }

    // Complete execution tracking
    if (executionId) {
      await workflowExecutionService.completeExecution(executionId, {
        status: 'completed',
        nodesExecuted: executionOrder.length,
        outputs: Object.fromEntries(context.outputs),
      })
    }

    return result
  } catch (error) {
    // Record failed execution
    if (executionId) {
      await workflowExecutionService.completeExecution(executionId, {
        status: 'failed',
        errorMessage: error.message,
      })
    }
    throw error
  }
}
```

---

## ⏳ Phase 4: Strategy Library Integration - PENDING

### Update Existing Strategy Library

**File**: `components/strategy-library.tsx`

**Changes**:
- Replace mock data with database queries
- Load strategies from `workflow_sessions` table
- Show execution stats from `workflow_executions`
- Add filters for status, tags, favorites

**Example**:
```tsx
const [strategies, setStrategies] = useState<WorkflowSession[]>([])

useEffect(() => {
  loadStrategies()
}, [])

async function loadStrategies() {
  const { data } = await workflowSessionService.listWorkflows({
    status: 'active',
    orderBy: 'updated_at',
    orderDirection: 'desc',
    limit: 50,
  })
  setStrategies(data)
}
```

---

## 📋 Complete Implementation Checklist

### Database (Phase 2)
- [ ] Apply migration with `supabase db push`
- [ ] Verify tables created
- [ ] Verify RLS policies active
- [ ] Test basic CRUD with SQL

### Strategy Builder UI (Phase 3.1-3.2)
- [ ] Add "New Strategy" button
- [ ] Add "Save" button
- [ ] Add "Open" button
- [ ] Create `WorkflowListModal` component
- [ ] Style modal consistently

### Save/Load Logic (Phase 3.3)
- [ ] Add state for currentWorkflowId, name, isDirty
- [ ] Implement `handleSaveWorkflow`
- [ ] Implement `handleLoadWorkflow`
- [ ] Implement `handleNewWorkflow`
- [ ] Implement `handleDeleteWorkflow`
- [ ] Implement `handleDuplicateWorkflow`
- [ ] Add dirty state tracking
- [ ] Add unsaved changes warning
- [ ] Add toast notifications

### Execution Tracking (Phase 3.4)
- [ ] Update `WorkflowExecutor.execute()` to track executions
- [ ] Start execution record before running
- [ ] Complete execution record with results
- [ ] Handle execution failures
- [ ] Display execution history in UI

### Strategy Library (Phase 4)
- [ ] Replace mock data with database queries
- [ ] Add search/filter UI
- [ ] Show execution stats (success rate, last run)
- [ ] Add favorite/unfavorite action
- [ ] Add duplicate action
- [ ] Add delete action

### Testing
- [ ] Test create new workflow
- [ ] Test save workflow
- [ ] Test load workflow
- [ ] Test update workflow
- [ ] Test delete workflow
- [ ] Test duplicate workflow
- [ ] Test execution tracking
- [ ] Test with multiple users (RLS)
- [ ] Test unsaved changes warning
- [ ] Test workflow list filtering

### Polish
- [ ] Add loading states
- [ ] Add error handling
- [ ] Add success messages
- [ ] Add keyboard shortcuts (Cmd+S to save)
- [ ] Add auto-save (optional)
- [ ] Add workflow preview thumbnails (optional)

---

## 🎯 MVP Scope for Session Management

**Must Have**:
- ✅ Save workflow to database
- ✅ Load workflow from database
- ✅ List user's workflows
- ✅ Create new workflow (clear canvas)
- ✅ Delete workflow
- ✅ Track basic execution stats

**Nice to Have** (can defer):
- Version history UI
- Template/sharing UI
- Auto-save every 30s
- Workflow thumbnails
- Detailed execution timeline
- Workflow analytics dashboard

---

## 📚 Reference Documents

**Migration Guide**: `supabase/APPLY_WORKFLOW_MIGRATION.md`
**Complete Schema Docs**: `supabase/docs/workflow-sessions-guide.md`
**Quick Reference**: `supabase/docs/workflow-quick-reference.md`
**Type Definitions**: `types/database.ts`
**Service Layer**: `lib/services/workflow-session-service.ts`

---

## 🚀 Next Immediate Step

**Apply the database migration**:

```bash
cd /Users/scotty/Projects/Cascadian-app
supabase db push
```

Then verify with:
```sql
SELECT * FROM workflow_sessions LIMIT 1;
```

Once database is ready, proceed with UI integration (Phase 3).

---

## 💡 Integration Tips

1. **Start Simple**: Just add Save/Load first, defer fancy features
2. **Use Service Layer**: Don't write SQL directly, use `workflowSessionService`
3. **Type Safety**: Import types from `types/database.ts`
4. **Error Handling**: All service methods return `{ data, error }`
5. **RLS is Automatic**: Service uses Supabase client with user context
6. **Test Incrementally**: Test each feature (save, load, delete) separately

---

**Status**: Ready for Phase 2 (Apply Migration) 🚀
