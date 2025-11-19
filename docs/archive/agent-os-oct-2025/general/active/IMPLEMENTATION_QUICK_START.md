# Quick Start: Real Data Integration

**Goal**: Connect workflows to real Polymarket data in 4 simple steps
**Time**: 2-3 hours
**Files to modify**: 2 files, create 1 migration

---

## Step 1: Enable Real Data in Polymarket Stream Node (30 min)

### File: `lib/workflow/node-executors.ts`

**Find this function** (around line 201):
```typescript
async function executePolymarketStreamNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const { categories = ['Politics'], minVolume = 0, maxResults = 10 } = config

  // TODO: Integrate with actual Polymarket API
  // For MVP, return stub data
  const stubMarkets = [
    // ... stub data
  ]
```

**Replace with**:
```typescript
async function executePolymarketStreamNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const {
    categories = [],
    minVolume = 0,
    maxResults = 10,
    active = true,
  } = config

  try {
    // Build Supabase query
    let query = supabaseAdmin
      .from('markets')
      .select('*, market_analytics(*)')
      .eq('active', active)

    // Filter by categories
    if (categories.length > 0) {
      query = query.in('category', categories)
    }

    // Filter by minimum volume
    if (minVolume > 0) {
      query = query.gte('volume_24h', minVolume)
    }

    // Sort by volume (highest first)
    query = query.order('volume_24h', { ascending: false })

    // Limit results
    query = query.limit(maxResults)

    // Execute query
    const { data, error } = await query

    if (error) {
      throw new Error(`Database query failed: ${error.message}`)
    }

    // Transform to workflow format
    const markets = (data || []).map(row => ({
      id: row.market_id,
      question: row.title,
      category: row.category,
      currentPrice: parseFloat(row.current_price),
      volume: parseFloat(row.volume_24h),
      liquidity: parseFloat(row.liquidity),
      endsAt: new Date(row.end_date),
      outcomes: row.outcomes,
      active: row.active,
      // Add analytics if available
      trades24h: row.market_analytics?.[0]?.trades_24h || 0,
      momentum: row.market_analytics?.[0]?.momentum_score || 0,
      buySellRatio: row.market_analytics?.[0]?.buy_sell_ratio || 1,
    }))

    return {
      markets,
      count: markets.length,
      timestamp: Date.now(),
      dataSource: 'real', // Flag for debugging
    }

  } catch (error: any) {
    console.error('[Workflow] Polymarket stream error:', error)
    throw new Error(`Failed to fetch Polymarket data: ${error.message}`)
  }
}
```

**Add import at top of file**:
```typescript
import { supabaseAdmin } from '@/lib/supabase'
```

**Test it**:
```bash
# In your terminal
cd /Users/scotty/Projects/Cascadian-app
pnpm dev

# Then create a workflow with:
# - Add Polymarket Stream node
# - Categories: Politics
# - Min Volume: 10000
# - Run workflow
# - Should see real markets from database
```

---

## Step 2: Fix Automatic Node Connections (45 min)

### File: `app/api/ai/conversational-build/route.ts`

**Step 2.1: Add auto-connect function**

After line 437 (after the `applyToolCallToWorkflow` function), add:

```typescript
/**
 * Auto-connect nodes if AI forgot to connect them
 * Creates a linear flow: node1 → node2 → node3 → etc
 */
function autoConnectNodes(workflow: any): any {
  const nodes = workflow.nodes || []
  const edges = workflow.edges || []

  // Skip if already well-connected
  if (edges.length >= nodes.length - 1) {
    console.log('[Auto-Connect] Workflow already connected')
    return workflow
  }

  console.log(`[Auto-Connect] Connecting ${nodes.length} nodes (found ${edges.length} edges)`)

  const newEdges = [...edges]

  // Sort nodes by creation order (x position is auto-incremented)
  const sortedNodes = [...nodes].sort((a, b) => a.position.x - b.position.x)

  // Create edges between consecutive nodes
  for (let i = 0; i < sortedNodes.length - 1; i++) {
    const source = sortedNodes[i]
    const target = sortedNodes[i + 1]

    // Check if edge already exists
    const edgeExists = newEdges.some(
      e => e.source === source.id && e.target === target.id
    )

    if (!edgeExists) {
      const newEdge = {
        id: `edge-${source.id}-${target.id}`,
        source: source.id,
        target: target.id,
        label: `${source.type} → ${target.type}`,
      }
      newEdges.push(newEdge)
      console.log(`[Auto-Connect] Created edge: ${source.id} → ${target.id}`)
    }
  }

  return { ...workflow, edges: newEdges }
}
```

**Step 2.2: Use auto-connect in batch workflow**

Find the `buildWorkflowComplete` function (around line 107) and add auto-connect before returning:

```typescript
async function buildWorkflowComplete(
  messages: any[],
  currentWorkflow: any
): Promise<Response> {
  // ... existing code ...

  // RIGHT BEFORE: const summary = generateWorkflowSummary(...)
  // ADD THIS:

  // Auto-connect nodes if AI forgot
  workflowInProgress = autoConnectNodes(workflowInProgress)

  const summary = generateWorkflowSummary(workflowInProgress, allToolCalls)

  return NextResponse.json({
    message: `${aiResponse}\n\n${summary}`,
    toolCalls: allToolCalls,
    suggestions: ['Test workflow', 'Make adjustments', 'Explain how it works'],
    workflowComplete: isComplete,
    nodeCount: workflowInProgress.nodes?.length || 0,
    edgeCount: workflowInProgress.edges?.length || 0, // Add edge count
    passCount,
  })
}
```

**Step 2.3: Improve AI prompt**

Find `buildBatchSystemPrompt()` function (around line 479) and replace with:

```typescript
function buildBatchSystemPrompt(): string {
  return `You are building a COMPLETE Polymarket trading bot workflow.

CRITICAL RULES:
1. Build the ENTIRE workflow in one response
2. Use ALL necessary function calls
3. Connect nodes by calling connectNodes AFTER creating each pair
4. Every node should be connected in sequence

WORKFLOW PATTERN (FOLLOW THIS):
1. Create Stream node: addPolymarketStreamNode(id: "stream-1", ...)
2. Create Filter node: addFilterNode(id: "filter-1", ...)
3. CONNECT THEM: connectNodes(sourceId: "stream-1", targetId: "filter-1")
4. Create next node: addLLMNode(id: "llm-1", ...)
5. CONNECT IT: connectNodes(sourceId: "filter-1", targetId: "llm-1")
6. Continue this pattern...

Available node types (in typical order):
1. polymarket-stream - Fetch markets (ALWAYS FIRST)
2. filter - Filter by conditions
3. llm-analysis - AI analysis with ANY custom prompt
4. transform - Math/data transformation
5. condition - If/then/else branching
6. polymarket-buy - Execute trade (LAST)

REMEMBER: Call connectNodes() after creating node pairs!

Build the complete workflow now.`
}
```

**Test it**:
```bash
# In workflow builder, ask AI:
"Build me a bot that finds politics markets with >50k volume and buys Yes"

# Should create:
# 1. Polymarket Stream node (Politics, 50k volume)
# 2. Filter node (volume > 50000)
# 3. Buy node (Yes, $10)
# 4. All nodes connected automatically
```

---

## Step 3: Enable Safe Trading (Paper Trading) (1 hour)

### File 1: Create Migration

Create: `supabase/migrations/20251023120000_paper_trades.sql`

```sql
-- Paper Trading Table
-- Stores simulated trades for testing workflows

CREATE TABLE paper_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  workflow_id TEXT,
  market_id TEXT NOT NULL,
  market_question TEXT,
  outcome TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'market', -- market, limit
  limit_price NUMERIC,
  executed_price NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'paper_filled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- Indexes for fast queries
CREATE INDEX idx_paper_trades_user ON paper_trades(user_id);
CREATE INDEX idx_paper_trades_market ON paper_trades(market_id);
CREATE INDEX idx_paper_trades_created ON paper_trades(created_at DESC);

-- RLS policies (optional, for multi-user)
ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trades"
  ON paper_trades FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert trades"
  ON paper_trades FOR INSERT
  TO authenticated
  WITH CHECK (true);
```

**Apply migration**:
```bash
cd /Users/scotty/Projects/Cascadian-app
# Make sure Supabase is running
supabase db push

# Or if using remote:
# Apply via Supabase dashboard > SQL Editor
```

### File 2: Update Buy Node

In `lib/workflow/node-executors.ts`, find `executePolymarketBuyNode` (around line 456) and replace:

```typescript
async function executePolymarketBuyNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const {
    marketId,
    outcome = 'Yes',
    amount = 10,
    orderType = 'market',
    limitPrice,
    slippage = 2,
    mode = 'SIMULATION', // SIMULATION | PAPER_TRADING | LIVE
  } = config

  // Get market data from previous node
  const market = inputs?.markets?.[0] || inputs?.filtered?.[0]

  if (!market) {
    throw new Error('Buy node requires market data. Connect to Stream or Filter node.')
  }

  // SIMULATION MODE (default, logs only)
  if (mode === 'SIMULATION') {
    console.log('[SIMULATION] Buy Order:', {
      market: market.question,
      outcome,
      amount,
      currentPrice: market.currentPrice,
    })

    return {
      orderId: `sim_${Date.now()}`,
      marketId: market.id,
      marketQuestion: market.question,
      outcome,
      amount,
      executedPrice: market.currentPrice,
      status: 'simulated',
      timestamp: Date.now(),
      mode: 'SIMULATION',
      note: 'This is a simulated trade - no real execution',
    }
  }

  // PAPER TRADING MODE (records to database)
  if (mode === 'PAPER_TRADING') {
    const order = {
      market_id: market.id,
      market_question: market.question,
      outcome,
      amount,
      order_type: orderType,
      limit_price: limitPrice || market.currentPrice,
      executed_price: market.currentPrice,
      status: 'paper_filled',
      created_at: new Date().toISOString(),
      notes: `Workflow execution at ${new Date().toISOString()}`,
    }

    // Store in paper_trades table
    const { data, error } = await supabaseAdmin
      .from('paper_trades')
      .insert(order)
      .select()
      .single()

    if (error) {
      throw new Error(`Paper trade failed: ${error.message}`)
    }

    console.log('[PAPER TRADING] Recorded trade:', data.id)

    return {
      orderId: data.id,
      marketId: market.id,
      marketQuestion: market.question,
      outcome,
      amount,
      executedPrice: data.executed_price,
      status: 'paper_filled',
      timestamp: Date.now(),
      mode: 'PAPER_TRADING',
      note: 'Paper trade recorded to database',
    }
  }

  // LIVE TRADING MODE (not implemented yet)
  if (mode === 'LIVE') {
    throw new Error(
      'LIVE trading not yet implemented. Use SIMULATION or PAPER_TRADING modes for now.'
    )
  }

  throw new Error(`Unknown trading mode: ${mode}`)
}
```

**Test it**:
```typescript
// In workflow, set Buy node mode to PAPER_TRADING
// Run workflow
// Check Supabase dashboard > paper_trades table
// Should see recorded trade
```

---

## Step 4: Add Validation (30 min)

### Create: `lib/workflow/validation.ts`

```typescript
/**
 * Workflow Node Input Validation
 *
 * Validates that nodes receive the correct input data types
 * to prevent runtime errors and provide helpful error messages.
 */

export function validateNodeInputs(
  nodeType: string,
  inputs: any,
  config: any
): { valid: boolean; error?: string } {

  switch (nodeType) {
    case 'polymarket-stream':
      // Stream nodes don't require inputs (they're sources)
      return { valid: true }

    case 'filter':
      // Filter needs array of items
      const hasArray =
        inputs?.markets ||
        inputs?.filtered ||
        inputs?.transformed ||
        Array.isArray(inputs)

      if (!hasArray) {
        return {
          valid: false,
          error: 'Filter node requires array of items. Connect to Polymarket Stream or Transform node.',
        }
      }
      break

    case 'llm-analysis':
      // LLM needs some input data
      if (!inputs) {
        return {
          valid: false,
          error: 'LLM Analysis node requires input data from previous node.',
        }
      }
      break

    case 'transform':
      // Transform needs data to transform
      const hasData =
        inputs?.markets ||
        inputs?.filtered ||
        inputs?.data ||
        Array.isArray(inputs)

      if (!hasData) {
        return {
          valid: false,
          error: 'Transform node requires data from previous node.',
        }
      }
      break

    case 'condition':
      // Condition needs data to evaluate
      if (!inputs) {
        return {
          valid: false,
          error: 'Condition node requires input data to evaluate.',
        }
      }
      break

    case 'polymarket-buy':
      // Buy needs market data
      const hasMarket =
        inputs?.markets?.[0] ||
        inputs?.filtered?.[0] ||
        inputs?.transformed?.[0]

      if (!hasMarket) {
        return {
          valid: false,
          error: 'Buy node requires market data. Connect to Stream, Filter, or Transform node.',
        }
      }

      // Validate amount
      if (!config.amount || config.amount <= 0) {
        return {
          valid: false,
          error: 'Buy node requires positive amount value.',
        }
      }
      break
  }

  return { valid: true }
}

/**
 * Validate entire workflow before execution
 */
export function validateWorkflow(workflow: {
  nodes: any[]
  edges: any[]
}): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check for at least one node
  if (workflow.nodes.length === 0) {
    errors.push('Workflow must have at least one node')
  }

  // Check for disconnected nodes (except first node)
  const connectedNodeIds = new Set<string>()
  workflow.edges.forEach(edge => {
    connectedNodeIds.add(edge.source)
    connectedNodeIds.add(edge.target)
  })

  const firstNodeId = workflow.nodes[0]?.id
  workflow.nodes.forEach(node => {
    if (node.id !== firstNodeId && !connectedNodeIds.has(node.id)) {
      errors.push(`Node "${node.id}" is not connected to workflow`)
    }
  })

  // Check for circular dependencies (basic check)
  const targetNodes = new Set(workflow.edges.map(e => e.target))
  const sourceNodes = new Set(workflow.edges.map(e => e.source))

  workflow.nodes.forEach(node => {
    if (targetNodes.has(node.id) && sourceNodes.has(node.id)) {
      // Node is both source and target - might be circular
      // (This is a simple check, full cycle detection would be more complex)
      console.warn(`[Validation] Node "${node.id}" might be in circular dependency`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}
```

### Update: `lib/workflow/node-executors.ts`

Add import at top:
```typescript
import { validateNodeInputs } from './validation'
```

In `executeNodeByType` function (around line 20), add validation before switch:

```typescript
export async function executeNodeByType(
  type: NodeType,
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {

  // Validate inputs before execution
  const validation = validateNodeInputs(type, inputs, config)
  if (!validation.valid) {
    throw new Error(`[${type}] ${validation.error}`)
  }

  switch (type) {
    // ... rest of switch statement
  }
}
```

**Test validation**:
```typescript
// Create workflow with Buy node but no Stream node
// Should fail with: "Buy node requires market data..."
```

---

## Testing Checklist

### ✅ Real Data Integration

```bash
# 1. Create workflow
- Add Polymarket Stream node
  - Categories: ["Politics", "Crypto"]
  - Min Volume: 50000
  - Max Results: 5

# 2. Run workflow
# 3. Check console logs
# Should see: "Fetched 5 markets (real data)"
# Should NOT see stub markets

# 4. Check output
# Markets should have:
- Real questions from Polymarket
- Current prices (0-1 range)
- Volume > 50000
- Categories match selection
```

### ✅ Auto-Connect Nodes

```bash
# 1. Ask AI: "Build a bot that finds crypto markets and buys Yes"

# 2. AI should create:
- Polymarket Stream (Crypto)
- Buy (Yes, $10)

# 3. Check visual editor
- Should see arrow connecting Stream → Buy
- No manual connection needed

# 4. Run workflow
- Should execute successfully
```

### ✅ Paper Trading

```bash
# 1. Create workflow:
- Stream (Politics, volume > 10k)
- Buy (Yes, $10, mode: PAPER_TRADING)

# 2. Connect nodes

# 3. Run workflow

# 4. Check Supabase:
SELECT * FROM paper_trades ORDER BY created_at DESC LIMIT 5;

# Should see new row with:
- market_question (real question)
- outcome: Yes
- amount: 10
- status: paper_filled
```

### ✅ Validation

```bash
# 1. Create workflow:
- Buy node (no Stream node before it)

# 2. Try to run
# Should fail with: "Buy node requires market data..."

# 3. Add Stream node and connect
# 4. Run again
# Should succeed
```

---

## Troubleshooting

### Problem: "supabaseAdmin is not defined"

**Solution**: Add import at top of `node-executors.ts`:
```typescript
import { supabaseAdmin } from '@/lib/supabase'
```

### Problem: "markets table does not exist"

**Solution**: Run Polymarket sync to populate database:
```bash
# Via API
curl -X POST http://localhost:3000/api/polymarket/sync

# Or via Supabase dashboard
# Run: SELECT * FROM markets LIMIT 1;
# Should return data
```

### Problem: Workflow shows "0 markets found"

**Solution**: Check filters:
- Reduce minVolume (try 0)
- Change categories (try "Politics")
- Check database has data: `SELECT COUNT(*) FROM markets WHERE active = true`

### Problem: Nodes created but not connected

**Solution**:
1. Check `autoConnectNodes()` function exists
2. Verify it's called before `generateWorkflowSummary()`
3. Check console logs for "[Auto-Connect]" messages

### Problem: Paper trades not saving

**Solution**:
1. Check migration applied: `SELECT * FROM paper_trades LIMIT 1`
2. Check Supabase admin client permissions
3. Check error logs in workflow execution

---

## Next Steps

After completing these 4 steps, you'll have:

✅ **Working Features**:
- Real Polymarket data in workflows
- Automatic node connections
- Paper trading with database tracking
- Input validation with helpful errors

🚀 **Ready for**:
- Building complex trading strategies
- Testing with real market conditions
- Analyzing paper trade performance
- Scaling to production

📈 **Future Enhancements**:
- Workflow scheduling (run every X minutes)
- Performance dashboards
- Live trading mode
- Backtesting framework

---

## Quick Commands

```bash
# Start dev server
cd /Users/scotty/Projects/Cascadian-app
pnpm dev

# Apply database migrations
supabase db push

# Sync Polymarket data
curl -X POST http://localhost:3000/api/polymarket/sync

# Check database
psql postgres://... -c "SELECT COUNT(*) FROM markets WHERE active = true"

# View paper trades
psql postgres://... -c "SELECT * FROM paper_trades ORDER BY created_at DESC LIMIT 10"
```

---

## Success Criteria

You'll know it's working when:

1. **Data**: Workflow returns real market questions (not "Will Bitcoin hit $100k?")
2. **Connections**: AI creates nodes with arrows between them automatically
3. **Trading**: Paper trades appear in Supabase `paper_trades` table
4. **Errors**: Clear validation messages guide users to fix issues

Ready to ship! 🎉
