# Feature Spec: AI Copilot for Strategy Builder

## Overview

Add an AI-powered conversational assistant to the existing Strategy Builder that enables users to **create and modify** trading bot workflows through natural language conversation. The AI Copilot will use function calling to manipulate the ReactFlow canvas, supporting both iterative building (one node at a time), batch building (complete workflows from long prompts), and **editing existing workflows**.

**KEY REQUIREMENT**: AI must be able to modify existing workflows, not just create new ones. Users should be able to say "change the filter to volume > 100k" or "add another LLM node after the filter".

## User Story

As a trader using the Strategy Builder, I want to describe my trading strategy in natural language so that the AI can automatically build the node-based workflow without requiring manual drag-and-drop, allowing me to rapidly prototype and iterate on complex trading strategies.

## Acceptance Criteria

### Core Functionality
- [ ] Users can chat with AI to build workflows conversationally
- [ ] AI supports iterative building: "add a filter for volume > 50k"
- [ ] AI supports batch building: "build me a complete bot that does X, Y, Z"
- [ ] **AI can modify existing workflows**: "change the filter to volume > 100k", "remove the watchlist node"
- [ ] AI creates Polymarket-specific nodes (data stream, filters, LLM analysis, etc.)
- [ ] LLM nodes accept ANY custom prompt (e.g., "Does this relate to Batman?")
- [ ] Transform nodes accept ANY custom formula (e.g., "edge = aiProbability - currentPrice")
- [ ] AI automatically connects nodes in logical order

### User Experience
- [ ] Chat interface displays in sidebar alongside visual editor
- [ ] Users can see AI's function calls as it builds the workflow
- [ ] AI provides helpful suggestions for next steps
- [ ] Keyboard shortcut (Cmd+K / Ctrl+K) opens chat
- [ ] **Manual approval required**: Users must explicitly click "Run Strategy" to execute
- [ ] Confirmation dialog appears before executing real trades
- [ ] System handles errors gracefully with user feedback

### Execution
- [ ] Workflows execute successfully after AI builds them
- [ ] Proper validation before execution
- [ ] Clear error messages with actionable feedback

## Technical Design

### Architecture

The AI Copilot integrates with the existing Strategy Builder by adding:

1. **Conversational Chat Component** - Sidebar UI for user-AI interaction
2. **Conversational Build API** - Backend endpoint handling AI function calling
3. **New Node Types** - Polymarket-specific workflow nodes
4. **Enhanced Workflow Executor** - Execute AI-built workflows with proper ordering
5. **Supporting Libraries** - LLM analysis, data transformation, monitoring

**Integration Points:**
- Existing: `app/(dashboard)/strategy-builder/page.tsx` (add chat sidebar)
- Existing: ReactFlow canvas and node system (extend with new nodes)
- New: `/app/api/ai/conversational-build/route.ts` (AI endpoint)
- New: `/lib/workflow/*` (execution engine)
- New: `/lib/llm/*` (LLM analysis)
- New: `/lib/transform/*` (data transformation)

### Components Affected

**Modified Components:**
- `app/(dashboard)/strategy-builder/page.tsx`
  - Add chat sidebar with state for messages
  - Apply AI tool calls to nodes/edges
  - Add keyboard shortcut (Cmd+K to open chat)
  - Add state to track if chat is open
  - Pass current workflow to chat component
- `components/node-palette.tsx` - Add new Polymarket node types to palette

**Database Considerations:**
- `workflows` table (if exists): Ensure it supports new node types in nodes JSON column
- No schema migration needed if using flexible JSON for nodes/edges
- Optional: Store conversation history for each workflow (nice to have, not MVP)

**No Changes Needed:**
- `components/execution-panel.tsx` - Already handles execution (add confirmation dialog)
- `components/node-config-panel.tsx` - Already handles node configuration

### New Components

**Chat Interface:**
- `components/workflow-editor/ConversationalChat.tsx` - Main chat UI component
  - Message history display
  - Input field with suggestions
  - Tool call visualization
  - Loading states

**Node Components (Simplified Approach for MVP):**

**Option A - Generic Component (RECOMMENDED for MVP):**
- `components/nodes/polymarket-node.tsx` - Single generic component for all Polymarket nodes
  - Renders different UI based on node type
  - Reduces code duplication
  - Faster to implement (~200 lines vs 1000+ lines)
  - Focus on executor logic first, polish UI later

**Option B - Separate Components (Future Enhancement):**
- Individual components for each node type (10 components x 100-150 lines)
- Better for highly customized UIs
- Implement after MVP if needed

**MVP Node Types (Must Have):**
1. `polymarket-stream` - Fetches Polymarket market data
2. `filter` - Filters data by conditions
3. `llm-analysis` - LLM analysis with custom prompts
4. `transform` - Data transformation with custom formulas
5. `condition` - If/then/else logic
6. `polymarket-buy` - Execute buy orders (stub for MVP)

**Post-MVP Node Types (Nice to Have):**
7. `llm-research` - LLM with research tools (add later)
8. `polymarket-sell` - Execute sell orders (add later)
9. `watchlist` - Monitor markets (complex, add later)
10. `wallet-intelligence` - Analyze smart wallets (add later)

### API Endpoints

#### New Endpoints

**POST /api/ai/conversational-build**
- Purpose: Handle conversational workflow building and editing with AI
- Request:
  ```typescript
  {
    messages: Array<{ role: 'user' | 'assistant', content: string }>,
    currentWorkflow: { nodes: Node[], edges: Edge[] }
  }
  ```
- Response:
  ```typescript
  {
    message: string,                    // AI response
    toolCalls: Array<ToolCall>,         // Function calls made
    suggestions: string[],              // Next step suggestions
    workflowComplete?: boolean,         // For batch requests
    nodeCount?: number,                 // Nodes in workflow
    passCount?: number                  // Number of AI passes
  }
  ```
- Features:
  - Detects batch vs iterative requests
  - Multi-pass execution for complex workflows
  - Function calling with Zod schemas
  - Supports up to 10 passes for unlimited complexity
  - **Can modify existing workflows** (updateNode, deleteNode, reconnect)

#### Modified Endpoints

**POST /api/workflow/execute** (enhance existing `/api/execute-workflow`)
- Add support for new node types
- Implement topological sorting
- Add reference resolution (`${nodeId.field}`)
- Support for stateful monitoring
- Enhanced error handling

### Data Model

```typescript
// Core workflow types
interface Workflow {
  id: string
  name: string
  description?: string
  trigger: WorkflowTrigger
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

interface WorkflowTrigger {
  type: 'manual' | 'schedule' | 'continuous' | 'webhook'
  config?: {
    cron?: string              // "0 * * * *" for hourly
    webhook_url?: string
    interval?: number          // seconds for continuous
  }
}

interface WorkflowNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: NodeData
  condition?: string           // Optional conditional execution
}

interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
}

// Node types specific to Polymarket trading
type NodeType =
  | 'polymarket-stream'        // Fetch market data
  | 'wallet-intelligence'      // Analyze wallet positions
  | 'filter'                   // Filter data
  | 'transform'                // Transform data with formulas
  | 'llm-analysis'             // LLM with custom prompt
  | 'llm-research'             // LLM with research tools
  | 'wallet-analysis'          // Analyze smart wallets
  | 'condition'                // If/then/else logic
  | 'loop'                     // Iterate over items
  | 'delay'                    // Wait/delay execution
  | 'polymarket-buy'           // Execute buy order
  | 'polymarket-sell'          // Execute sell order
  | 'add-to-watchlist'         // Monitor market
  | 'monitor-momentum'         // Track momentum changes
  | 'notification'             // Send alerts
  | 'start'                    // Existing
  | 'end'                      // Existing
  | 'javascript'               // Existing
  | 'httpRequest'              // Existing
  | 'conditional'              // Existing (may replace with 'condition')

// Node configuration examples
interface FilterNodeConfig {
  conditions: Array<{
    field: string                    // e.g., 'volume', 'category'
    operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
    value: any
  }>
}

interface LLMNodeConfig {
  model: string                      // 'claude-sonnet-4-5', 'gpt-4', etc.
  systemPrompt?: string
  userPrompt: string                 // ANY custom prompt
  temperature?: number
  maxTokens?: number
  tools?: string[]                   // ['web_search', 'news_api', 'perplexity']
  outputFormat?: 'text' | 'json' | 'boolean' | 'number'
}

interface TransformNodeConfig {
  operations: Array<{
    type: 'add-column' | 'filter-rows' | 'aggregate' | 'sort' | 'join'
    config: any                      // e.g., { name: 'edge', formula: 'aiProbability - currentPrice' }
  }>
}

interface ConditionNodeConfig {
  conditions: Array<{
    if?: string                      // Expression to evaluate
    and?: string | string[]          // Additional conditions
    then: string                     // Target node ID
    else?: string                    // Else target node ID
  }>
}

interface WatchlistNodeConfig {
  marketId: string
  conditions: Array<{
    trigger: string                  // e.g., "momentum > 0.05"
    action: 'buy' | 'sell' | 'notify' | 'remove'
    removeAfterTrigger?: boolean
  }>
  checkInterval: number              // seconds
}

// Execution context
interface ExecutionContext {
  workflowId: string
  executionId: string
  startTime: number
  outputs: Map<string, any>          // Store outputs by node ID
  globalState: Record<string, any>   // Shared state across nodes
  watchlists: Map<string, WatchlistState>
  variables: Record<string, any>     // User-defined variables
}

interface ExecutionResult {
  success: boolean
  executionId: string
  outputs: Record<string, any>
  errors?: ExecutionError[]
  executionTime: number
  nodesExecuted: number
}

interface ExecutionError {
  nodeId: string
  nodeType: string
  error: string
  timestamp: number
}

// Polymarket types
interface PolymarketMarket {
  id: string
  question: string
  description: string
  category: string
  endsAt: Date
  currentPrice: number
  volume: number
  liquidity: number
  outcomes: string[]
  rules?: string
  conditionId?: string
}

interface TradeOrder {
  marketId: string
  outcome: string
  amount: number
  side: 'buy' | 'sell'
  orderType: 'market' | 'limit'
  limitPrice?: number
  slippage?: number
}
```

### State Management

**Component State (Strategy Builder Page):**
- `nodes` - ReactFlow nodes (existing)
- `edges` - ReactFlow edges (existing)
- `chatMessages` - Conversation history (new)
- `isChatOpen` - Chat sidebar visibility (new)

**Global State:**
- No Redux/Jotai needed - all state in React components
- Execution context managed by WorkflowExecutor
- Watchlist state managed by WatchlistManager

**Data Flow:**
1. User sends message → ConversationalChat component
2. Chat calls `/api/ai/conversational-build` with message history + current workflow
3. API uses AI SDK to get function calls
4. API returns tool calls + AI message
5. Chat component applies tool calls to workflow state
6. Parent page updates nodes/edges
7. ReactFlow canvas re-renders with new nodes

### UI/UX Flow

**Iterative Building:**
1. User opens Strategy Builder
2. Clicks "AI Copilot" button to open chat sidebar
3. AI greets: "Hi! I'll help you build a Polymarket trading bot. What would you like your bot to do?"
4. User: "Help me build a bot"
5. AI: "What markets are you interested in?" [Shows suggestions: Politics | Crypto | Sports]
6. User: "Politics"
7. AI creates Polymarket Stream node, connects to existing Start node
8. AI: "Added Politics data source! Want to filter by volume or time?"
9. User: "Add filter for volume > 50k"
10. AI creates Filter node, connects to stream
11. AI: "Added volume filter! What analysis should we run?"
12. [Continues conversationally...]

**Batch Building:**
1. User: "Build me a complete bot that fetches Politics markets, filters for volume > 50k and ending in 24h, uses LLM to check if figurable, uses LLM with research tools to get probability, calculates edge as aiProbability minus currentPrice, if edge > 0.15 buy, else add to watchlist"
2. AI processes request, identifies ~10 nodes needed
3. AI makes multiple function calls in sequence:
   - `addPolymarketStreamNode({ categories: ['Politics'] })`
   - `addFilterNode({ conditions: [{ field: 'volume', operator: 'gt', value: 50000 }] })`
   - `addFilterNode({ conditions: [{ field: 'endsAt', operator: 'lt', value: '24h' }] })`
   - `addLLMNode({ prompt: 'Is this market figurable or rigged?', outputFormat: 'boolean' })`
   - `addLLMNode({ prompt: 'Analyze and determine probability', tools: ['web_search', 'news_api'], outputFormat: 'number' })`
   - `addTransformNode({ operations: [{ type: 'add-column', config: { name: 'edge', formula: 'aiProbability - currentPrice' }}] })`
   - `addConditionNode({ conditions: [{ if: 'edge > 0.15', then: 'buy-node', else: 'watchlist-node' }] })`
   - `addActionNode({ actionType: 'polymarket-buy' })`
   - `addActionNode({ actionType: 'add-to-watchlist' })`
   - `connectNodes(...)` x 9 times
4. AI: "✅ Workflow Complete! I've built a bot with 10 nodes that will filter Politics markets, analyze with AI, calculate edge, and execute buys when edge > 15%"
5. User sees complete workflow on canvas

**Execution:**
1. User clicks "Run Strategy"
2. Workflow executor performs topological sort
3. Executes nodes in dependency order
4. Shows progress in execution panel
5. Displays results and any errors

### Error Handling

**AI Conversation Errors:**
- Network errors → "Sorry, I encountered a connection error. Please try again."
- Invalid function calls → AI retries with corrected parameters
- Ambiguous requests → AI asks clarifying questions
- Timeout → "This is taking longer than expected. Should I continue?"

**Workflow Execution Errors:**
- Node execution fails → Mark node as error, stop workflow, show error message
- Circular dependencies → Validation error before execution
- Missing node connections → Validation warning
- Invalid node configurations → Show in node config panel with hints
- API rate limits → Retry with exponential backoff
- Polymarket API errors → Log and notify user

**Reference Resolution Errors:**
- Invalid reference `${nodeId.field}` → Show error with available fields
- Undefined node ID → Highlight missing connection

### Performance Considerations

**AI Response Time:**
- First response: ~2-5 seconds (single node)
- Batch building: ~10-30 seconds (10+ nodes, multiple passes)
- Show loading indicator with "AI is thinking..."
- Stream responses if possible (future enhancement)

**Workflow Execution:**
- Topological sort: O(V + E) - fast for typical workflows (<100 nodes)
- Node execution: Depends on node type
  - Filter/Transform: <100ms
  - LLM analysis: 2-10 seconds
  - API calls: 500ms-5 seconds
- Total workflow: 10-60 seconds for typical strategies

**Canvas Rendering:**
- ReactFlow handles 100+ nodes efficiently
- Auto-layout for AI-generated nodes (prevent overlap)
- Fit view after batch building

**Optimizations:**
- Cache LLM responses for identical prompts
- Debounce chat input
- Lazy load node components
- Virtualize long chat histories

### Security Considerations

**API Keys:**
- Store in environment variables only
- Never expose to client
- Rotate regularly

**User Input:**
- Sanitize custom formulas before evaluation
- Validate LLM prompts (block code injection)
- Rate limit API calls per user
- Sandbox JavaScript node execution (existing)

**Polymarket Integration:**
- Use read-only API keys where possible
- Require explicit confirmation before trades
- Implement spending limits
- Log all trading activity

**AI Safety:**
- Validate all function call parameters with Zod
- Prevent infinite loops in AI passes (max 10)
- Monitor token usage
- Reject malicious prompts

## Dependencies

### New Packages

```bash
pnpm add @ai-sdk/anthropic @ai-sdk/openai
pnpm add node-cron mathjs
pnpm add -D @types/node-cron
```

**Already Installed:**
- ✅ `@xyflow/react` (ReactFlow)
- ✅ `ai` (Vercel AI SDK)
- ✅ `zod` (validation)
- ✅ `@supabase/supabase-js` (database)

### External Services

**Required:**
- Anthropic API (Claude) - Primary AI model
- OpenAI API (GPT-5) - Fallback option
- Polymarket API - Market data and trading -refer to database (not fuly set up yet)

**Optional:**
- Perplexity API - Research tool for LLM
- Brave Search API - Web search tool
- News API - News data for analysis

## Implementation Plan

### Phase 0: Assessment & Setup (1 hour)
**Goal**: Understand existing codebase and prepare for implementation

**Tasks:**
- [ ] Review existing Strategy Builder implementation in `app/(dashboard)/strategy-builder/page.tsx`
- [ ] Identify existing node types and their patterns
- [ ] Check if database schema supports new node types (JSON flexibility)
- [ ] Test existing workflow execution system
- [ ] Verify ReactFlow is properly installed and working
- [ ] Review existing node components (start, end, conditional, javascript, httpRequest)
- [ ] Understand existing nodeTypes registry and how to extend it
- [ ] Identify reusable patterns for generic node component

**Deliverables:**
- Assessment notes on existing architecture
- List of existing node types to keep
- Database compatibility confirmation
- Plan for generic node component structure

**Estimated effort**: 1 hour

### Phase 1: Core Infrastructure (4-6 hours)
**Goal**: Set up workflow execution engine and type system

**Files:**
- Create `/types/workflow.ts` - All TypeScript types (~150 lines)
- Create `/lib/workflow/executor.ts` - Workflow executor with topological sort (~300 lines)
- Create `/lib/workflow/node-executors.ts` - Node execution logic (~150 lines)
- Enhance `/app/api/workflow/execute/route.ts` - Execution API endpoint (~80 lines)

**Tasks:**
- Define all workflow types (Workflow, Node, Edge, ExecutionContext, etc.)
- Implement WorkflowExecutor class with topological sorting
- Add reference resolution (`${nodeId.field}`)
- Create node executor functions for each node type
- Add error handling and validation

**Estimated effort**: 4-6 hours

### Phase 2: AI Conversational Layer (4-6 hours)
**Goal**: Build conversational AI with function calling

**Files:**
- Create `/app/api/ai/conversational-build/route.ts` - Main AI endpoint (~400 lines)
- Create `/lib/ai/tools.ts` - Function definitions with Zod schemas (~200 lines)
- Create `/lib/ai/batch-builder.ts` - Multi-pass batch building logic (~150 lines)

**Tasks:**
- Implement conversational build API
- Add batch vs iterative detection
- Create Zod schemas for all node types
- Implement multi-pass execution (up to 10 passes)
- Add workflow summary generation
- Create suggestion engine
- Error handling and retry logic

**Estimated effort**: 4-6 hours

### Phase 3: Chat UI Integration (3-4 hours)
**Goal**: Add chat interface to Strategy Builder

**Files:**
- Create `/components/workflow-editor/ConversationalChat.tsx` - Chat component (~200 lines)
- Modify `/app/(dashboard)/strategy-builder/page.tsx` - Add chat sidebar (~50 lines changed)
- Create `/components/ui/chat-message.tsx` - Message display component (~50 lines)

**Tasks:**
- Build chat UI with message history
- Add input field with suggestions
- Display tool calls as they happen
- Show loading states
- Add suggestion chips
- Auto-scroll to latest message
- Responsive design (sidebar on desktop, modal on mobile)
- Integrate with existing ReactFlow canvas

**Estimated effort**: 3-4 hours

### Phase 4: Polymarket Node Components - SIMPLIFIED FOR MVP (2-3 hours)
**Goal**: Create generic node component that handles all Polymarket node types

**Files:**
- Create `/components/nodes/polymarket-node.tsx` - Generic component (~200 lines)
  - Renders different icon/color based on node.type
  - Shows label, description, status
  - Displays configuration in simple form
  - Reuses existing node card styling
- Modify `/components/node-palette.tsx` - Add 6 MVP node types (~50 lines)
- Modify `/app/(dashboard)/strategy-builder/page.tsx` - Register new node types (~20 lines)

**MVP Node Types to Add:**
1. `polymarket-stream` - Data source (icon: Database, color: blue)
2. `filter` - Filter conditions (icon: Filter, color: purple)
3. `llm-analysis` - AI analysis (icon: Brain, color: pink)
4. `transform` - Formulas (icon: Calculator, color: orange)
5. `condition` - If/then logic (icon: GitBranch, color: green)
6. `polymarket-buy` - Execute trade (icon: DollarSign, color: teal)

**Tasks:**
- Create generic PolymarketNode component with type switching
- Add 6 node types to node palette
- Register node types in nodeTypes object
- Add default data for each node type
- Style consistently with existing nodes
- Test drag-and-drop and click-to-add

**Estimated effort**: 2-3 hours

**Future Enhancement (Post-MVP):**
- Create specialized components for complex nodes
- Add advanced configuration UIs
- Polish animations and interactions

### Phase 5: Supporting Services - MVP SCOPE (3-4 hours)
**Goal**: Implement essential services with stubs for complex features

**Files:**
- Create `/lib/llm/analyzer.ts` - LLM analysis (~100 lines)
- Create `/lib/transform/data-transformer.ts` - Formula evaluation (~80 lines)
- Create `/lib/polymarket/client.ts` - API stub (~50 lines)

**MVP Tasks:**
- ✅ Implement LLMAnalyzer with basic prompts (no tools for MVP)
- ✅ Add template variable replacement (`{{variable}}`)
- ✅ Build DataTransformer with mathjs for custom formulas
- ✅ Stub Polymarket API client (returns mock data)
- ✅ Error handling for each service

**Skipped for MVP (Add Later):**
- ❌ LLM with research tools (add in Phase 2)
- ❌ WatchlistManager (complex monitoring, add later)
- ❌ Wallet intelligence analysis (add later)

**Estimated effort**: 3-4 hours

### Phase 6: Testing & Polish (3-4 hours)
**Goal**: Test all functionality and fix bugs

**Tasks:**
- Test iterative building: Add nodes one by one
- Test batch building: Long prompts creating full workflows
- Test custom LLM prompts: "Does this relate to Batman?"
- Test custom formulas: "edge = aiProbability - currentPrice"
- Test workflow execution: All node types execute correctly
- Test error handling: Network errors, invalid configs, etc.
- Test edge cases: Empty workflows, circular deps, missing connections
- Fix bugs and improve UX
- Add loading states and better feedback
- Improve AI suggestions
- Mobile responsiveness

**Estimated effort**: 3-4 hours

### Phase 7: Documentation & Examples (2 hours)
**Goal**: Document feature and create examples

**Tasks:**
- Update README with AI Copilot usage
- Create example prompts guide
- Document custom prompt syntax
- Document custom formula syntax
- Create video walkthrough (optional)
- Add inline help in chat UI
- Create strategy templates using AI

**Estimated effort**: 2 hours

**Total Estimated Effort (MVP)**: 18-25 hours (~1 week)
**Total Estimated Effort (Full Implementation)**: 26-35 hours (~1-2 weeks)

## Task Breakdown

### Backend Tasks (MVP)

**Phase 0 - Assessment:**
- [ ] Review existing Strategy Builder code
- [ ] Identify existing node types and patterns
- [ ] Verify database schema supports new node types

**Phase 1 - Core Infrastructure:**
- [ ] Create workflow type definitions in `/types/workflow.ts`
- [ ] Implement WorkflowExecutor with topological sorting
- [ ] Create node executor functions for MVP node types (6 nodes)
- [ ] Enhance workflow execution API endpoint
- [ ] Add error handling and validation

**Phase 2 - AI Layer:**
- [ ] Build conversational-build API with function calling
- [ ] Implement batch building with multi-pass execution
- [ ] Create Zod schemas for MVP node types
- [ ] Add support for modifying existing workflows (updateNode, deleteNode)
- [ ] Implement suggestion generation

**Phase 5 - Services:**
- [ ] Implement LLMAnalyzer service (basic, no tools for MVP)
- [ ] Build DataTransformer with mathjs
- [ ] Add Polymarket API client stub (mock data)

**Post-MVP Backend:**
- [ ] Add LLM with research tools
- [ ] Create WatchlistManager for monitoring
- [ ] Implement wallet intelligence
- [ ] Real Polymarket API integration

### Frontend Tasks (MVP)

**Phase 3 - Chat UI:**
- [ ] Create ConversationalChat component
- [ ] Add chat sidebar to Strategy Builder page
- [ ] Build chat message display component
- [ ] Add suggestion chips UI
- [ ] Show tool call indicators
- [ ] Implement loading states for AI responses
- [ ] Add keyboard shortcut (Cmd+K / Ctrl+K)

**Phase 4 - Node Components:**
- [ ] Create generic PolymarketNode component (handles all 6 node types)
- [ ] Update node palette with 6 MVP node types
- [ ] Update node type registry in page.tsx
- [ ] Add default data for each node type
- [ ] Style consistently with existing nodes

**Phase 6 - Polish:**
- [ ] Add auto-layout for AI-generated nodes (prevent overlaps)
- [ ] Add mobile responsive chat interface
- [ ] Add confirmation dialog before execution
- [ ] Polish animations and transitions

**Post-MVP Frontend:**
- [ ] Create specialized node components for complex nodes
- [ ] Add advanced configuration UIs
- [ ] Add workflow explanation feature
- [ ] Improve mobile experience

### Integration Tasks (MVP)

- [ ] Connect chat component to conversational-build API
- [ ] Apply AI tool calls to ReactFlow canvas (add/update/delete nodes)
- [ ] Sync workflow state between chat and canvas
- [ ] Connect execution panel to new node types
- [ ] Integrate node config panel with new nodes
- [ ] Add keyboard shortcuts (Cmd+K to open chat)
- [ ] Pass current workflow to AI for modification support

**Post-MVP Integration:**
- [ ] Implement auto-save for AI-built workflows
- [ ] Add undo/redo for AI changes
- [ ] Store conversation history with workflows

### Testing Tasks (MVP)

**Phase 6 - Core Testing:**
- [ ] Test iterative building: "add a filter", "add LLM node"
- [ ] Test batch building: "build me a complete bot that..."
- [ ] **Test modifying workflows**: "change filter to volume > 100k", "remove this node"
- [ ] Test all 6 node types execute correctly
- [ ] Test custom LLM prompts work
- [ ] Test custom formulas evaluate correctly
- [ ] Test error handling (network, validation, execution)
- [ ] Test edge cases (empty workflow, cycles, missing connections)
- [ ] Test keyboard shortcut (Cmd+K)
- [ ] Test manual approval flow (Run Strategy button + confirmation)

**Post-MVP Testing:**
- [ ] Test mobile responsiveness
- [ ] Load test with large workflows (50+ nodes)
- [ ] Test concurrent executions
- [ ] Performance testing with slow network
- [ ] Test with different AI models (Claude vs GPT-4)

## Testing Strategy

### Unit Tests

**Backend:**
- Test WorkflowExecutor.topologicalSort() with various graphs
- Test reference resolution with valid/invalid paths
- Test LLMAnalyzer.analyze() with different output formats
- Test DataTransformer.transform() with formulas
- Test each node executor function

**Frontend:**
- Test ConversationalChat message handling
- Test tool call application logic
- Test node rendering with different states
- Test suggestion generation

### Integration Tests

**Full Workflow Building:**
- User sends message → AI builds nodes → Canvas updates → Workflow executes
- Test both iterative and batch building paths
- Test multi-turn conversations
- Test workflow execution with AI-built workflows

**API Tests:**
- Test `/api/ai/conversational-build` with various prompts
- Test `/api/workflow/execute` with complex workflows
- Test error responses and retries

### Manual Testing Checklist

- [ ] Open Strategy Builder and start chat
- [ ] Build simple workflow iteratively (5 nodes)
- [ ] Build complex workflow from batch prompt (15 nodes)
- [ ] Execute AI-built workflow successfully
- [ ] Test custom LLM prompt: "Does this question relate to Batman?"
- [ ] Test custom formula: "momentum = (price - price_1h) / price_1h"
- [ ] Test error handling: Invalid formula, missing connection
- [ ] Test mobile layout
- [ ] Test with slow network connection
- [ ] Test import/export AI-built workflow
- [ ] Verify node auto-layout prevents overlaps
- [ ] Check that suggestions are contextual and helpful

### Load Testing

- Create workflow with 50+ nodes via batch building
- Execute workflow with 50+ nodes
- Send 10 messages rapidly to chat
- Test with 100+ message conversation history

## Rollout Plan

### Development

1. Create feature branch: `feature/ai-copilot-strategy-builder`
2. Implement Phase 1: Core Infrastructure
3. Test locally with mock data
4. Implement Phase 2: AI Layer
5. Test AI function calling end-to-end
6. Implement Phase 3: Chat UI
7. Test full iterative building flow
8. Implement Phase 4: Node Components
9. Test batch building flow
10. Implement Phase 5: Supporting Services
11. Test workflow execution
12. Phase 6: Testing & bug fixes
13. Phase 7: Documentation

### Staging

1. Deploy to staging environment
2. Add test Polymarket data
3. Verify all API keys configured
4. Run full test suite
5. Get QA approval
6. Performance testing with large workflows

### Production

1. Feature flag: `ENABLE_AI_COPILOT` (default: false)
2. Roll out to 10% of users
3. Monitor error rates and performance
4. Collect user feedback
5. Iterate on suggestions and UX
6. Roll out to 50% of users
7. Full rollout after 1 week

## Success Metrics

### Primary Metrics

- **AI Copilot Usage Rate**: Target 40% of Strategy Builder users try AI Copilot within first session
- **Workflow Completion Rate**: Target 70% of AI-started workflows get completed and saved
- **Time to First Workflow**: Reduce from 15 min (manual) to 5 min (with AI)
- **Workflow Complexity**: Average nodes per AI-built workflow >8 (vs 4 for manual)

### Secondary Metrics

- **Batch vs Iterative**: Track usage split (expect 30% batch, 70% iterative)
- **Custom Prompts**: % of LLM nodes using custom prompts (target >50%)
- **Custom Formulas**: % of Transform nodes using custom formulas (target >30%)
- **Execution Success Rate**: >80% of AI-built workflows execute without errors
- **User Satisfaction**: NPS score >50 for AI Copilot feature
- **Retention**: Users who use AI Copilot return 2x more often

### Technical Metrics

- **AI Response Time**: p50 <3s, p95 <8s, p99 <15s
- **Function Call Accuracy**: >95% of function calls have valid parameters
- **Workflow Execution Time**: p50 <30s, p95 <90s
- **Error Rate**: <5% of conversations encounter errors
- **API Costs**: <$0.20 per workflow built

## Risks & Mitigations

**Risk**: AI generates invalid workflows (missing connections, invalid configs)
- **Mitigation**: Strict Zod validation, AI retries on errors, validation before execution

**Risk**: Users frustrated by slow AI responses (>10s)
- **Mitigation**: Show progress indicators, allow cancellation, optimize prompts

**Risk**: AI costs exceed budget ($0.50+ per workflow)
- **Mitigation**: Use Claude Haiku for simple requests, cache responses, rate limiting

**Risk**: Users can't describe complex strategies clearly
- **Mitigation**: Provide example prompts, suggestions, iterative clarification

**Risk**: Polymarket API rate limits break workflows
- **Mitigation**: Implement exponential backoff, queue system, user notifications

**Risk**: LLM hallucinations create nonsensical workflows
- **Mitigation**: Validate all outputs, show reasoning to user, allow easy undo

**Risk**: Custom formulas have security vulnerabilities
- **Mitigation**: Use mathjs in safe mode, sandbox evaluation, whitelist functions

**Risk**: Users confused by AI-generated complex workflows
- **Mitigation**: Add workflow explanation feature, step-by-step breakdown, visual highlights

## MVP Priorities & Scope

### Must Have for MVP (Week 1)

**Core Functionality:**
1. ✅ Conversational AI with function calling
2. ✅ Iterative building (one node at a time)
3. ✅ Batch building (complete workflows from long prompts)
4. ✅ **AI can modify existing workflows** (updateNode, deleteNode, reconnect)
5. ✅ Chat UI sidebar in Strategy Builder
6. ✅ Keyboard shortcut (Cmd+K / Ctrl+K)

**Essential Node Types (6 total):**
1. ✅ `polymarket-stream` - Fetch market data (stub)
2. ✅ `filter` - Filter by conditions
3. ✅ `llm-analysis` - Custom prompt analysis
4. ✅ `transform` - Custom formulas
5. ✅ `condition` - If/then/else logic
6. ✅ `polymarket-buy` - Execute trades (stub)

**Supporting Services:**
- ✅ Workflow executor with topological sort
- ✅ LLM analyzer (basic, no tools)
- ✅ Data transformer with mathjs
- ✅ Polymarket API stub (mock data)

### Should Have (Week 2)

**Enhanced Features:**
- ✅ LLM with research tools (web search, news)
- ✅ Better error handling and validation
- ✅ Node config UI polish
- ✅ Auto-layout for AI-generated nodes
- ✅ Confirmation dialog before execution

**Additional Nodes:**
- ✅ `llm-research` - LLM with tools
- ✅ `polymarket-sell` - Sell orders

### Nice to Have (Week 3+)

**Advanced Features:**
- ❌ Watchlist monitoring (complex, defer)
- ❌ Wallet intelligence analysis (defer)
- ❌ Workflow explanation feature
- ❌ Voice input support
- ❌ Version control for workflows
- ❌ Collaborative editing

**Polish:**
- ❌ Specialized node components (vs generic)
- ❌ Advanced animations
- ❌ Workflow templates library

## Resolved Questions

**Q: Should we support voice input for conversations?**
- **A**: No for MVP. Text chat is sufficient. Can add later if users request.

**Q: Should AI auto-execute workflows after building, or require manual approval?**
- **A**: ✅ **Manual approval REQUIRED**. Users must explicitly click "Run Strategy" button. Add confirmation dialog for real trades.

**Q: What's the max workflow complexity we should support?**
- **A**: Start with 50 nodes max for MVP. Can increase to 100+ if needed based on usage.

**Q: Should we allow AI to modify existing workflows, or only build new ones?**
- **A**: ✅ **YES - Critical requirement**. AI MUST be able to modify existing workflows. Users should say "change the filter to volume > 100k" or "remove this node".

**Q: Do we need version control for AI-generated workflows?**
- **A**: Not for MVP. Add timestamps and history tracking in post-MVP. Good for future enhancement.

**Q: Should we add a "Explain this workflow" feature?**
- **A**: Yes, but post-MVP. Good feature for v2. Focus on building first.

**Q: What's the best way to handle Polymarket API authentication?**
- **A**: Use stub approach initially (mock data). Implement real authentication when ready to execute actual trades.

**Q: Should we support collaborative editing with AI (multiple users)?**
- **A**: Not for MVP. Complex feature. Add later if there's demand.

## Open Questions (Still to Resolve)

- [ ] Should we store conversation history in database or just in session?
- [ ] What's the optimal context window for AI (how many messages to include)?
- [ ] Should we support importing/exporting workflows with conversation history?
- [ ] How should we handle API rate limiting for heavy users?
- [ ] Should we add analytics tracking for AI usage patterns?

## References

- Implementation Guide: `/Users/scotty/Projects/Cascadian-app/.agent-os/product/COMPLETE_IMPLEMENTATION_GUIDE.md`
- Existing Strategy Builder: `/app/(dashboard)/strategy-builder/page.tsx`
- ReactFlow Documentation: https://reactflow.dev/
- Vercel AI SDK Documentation: https://sdk.vercel.ai/docs
- OpenLovable Reference: Conversational AI patterns
- Polymarket API: https://docs.polymarket.com/
- MiroMind Research Agent: https://github.com/MiroMindAI/MiroFlow
