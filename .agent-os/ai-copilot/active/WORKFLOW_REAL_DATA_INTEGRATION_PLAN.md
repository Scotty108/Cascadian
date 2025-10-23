# Workflow Real Data Integration Plan

**Status**: Production-Ready Architecture Design
**Created**: 2025-10-23
**Priority**: High - Critical for AI Trading Bot MVP

---

## Executive Summary

The AI Copilot successfully builds workflow nodes but currently uses mock data. This document provides a complete architecture for connecting workflows to real Polymarket data streams, fixing automatic node connections, and implementing safe live trading capabilities.

### Current State Analysis

**Existing Integration (EXCELLENT):**
- ✅ Real Polymarket Gamma API client (`lib/polymarket/client.ts`)
- ✅ Supabase database sync with markets table
- ✅ CLOB API trade aggregation system
- ✅ React Query hooks for real-time data
- ✅ API routes at `/api/polymarket/*`
- ✅ Production-ready error handling, retries, rate limiting

**What's Mock:**
- ❌ Workflow node executors use stub data
- ❌ No connection between workflow system and real API
- ❌ Buy/sell nodes return fake success responses
- ❌ AI doesn't automatically connect nodes with edges

**Impact:**
- Workflows execute but return test data
- Cannot use for real trading strategies
- Users must manually connect nodes after AI creates them

---

## Architecture Overview

### Data Flow: Real World → Workflow Execution

```
Polymarket Gamma API → Supabase DB → API Routes → Workflow Executors → Results
         ↓                   ↓              ↓
    CLOB Trade API    Background Sync  React Query Cache
```

### Integration Points

1. **Data Source Layer** (EXISTS - Ready to Use)
   - `lib/polymarket/client.ts` - Gamma API client
   - `lib/polymarket/sync.ts` - Database sync orchestration
   - `lib/polymarket/trade-aggregator.ts` - CLOB analytics

2. **API Layer** (EXISTS - Ready to Use)
   - `/api/polymarket/markets` - Market list with analytics
   - `/api/polymarket/events` - Event/category data
   - `/api/polymarket/market/[id]` - Market details

3. **Workflow Execution Layer** (NEEDS INTEGRATION)
   - `lib/workflow/node-executors.ts` - Currently uses mocks
   - Needs to call API routes or use client directly

4. **AI Layer** (NEEDS FIX)
   - `/api/ai/conversational-build/route.ts` - Creates nodes but not edges
   - Needs edge creation logic enhancement

---

## Implementation Plan

## Phase 1: Connect Polymarket Stream Node to Real Data

### Problem
The `executePolymarketStreamNode` in `lib/workflow/node-executors.ts` (lines 201-262) returns hardcoded stub data instead of real markets.

### Solution: Backend API Approach (RECOMMENDED)

**Why Backend?**
- Workflows execute server-side during runs
- Can use Supabase direct queries (faster than API)
- Consistent with existing sync architecture
- Better for rate limiting and caching

**Implementation:**

```typescript
// lib/workflow/node-executors.ts

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
    sortBy = 'volume' // volume, liquidity, momentum
  } = config

  try {
    // Build Supabase query
    let query = supabaseAdmin
      .from('markets')
      .select('*, market_analytics(*)')  // Join analytics for metrics
      .eq('active', active)

    // Filter by categories (if specified)
    if (categories.length > 0) {
      query = query.in('category', categories)
    }

    // Filter by minimum volume
    if (minVolume > 0) {
      query = query.gte('volume_24h', minVolume)
    }

    // Sort by specified field
    const sortColumn = sortBy === 'momentum'
      ? 'market_analytics.momentum_score'
      : sortBy === 'liquidity'
      ? 'liquidity'
      : 'volume_24h'

    query = query.order(sortColumn, { ascending: false })

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

**Required Changes:**
- File: `/Users/scotty/Projects/Cascadian-app/lib/workflow/node-executors.ts`
- Lines: 201-262 (replace stub implementation)
- Add import: `import { supabaseAdmin } from '@/lib/supabase'`

**Testing:**
```typescript
// Test query
const result = await executePolymarketStreamNode({
  categories: ['Politics'],
  minVolume: 10000,
  maxResults: 5
}, null, {})

console.log(result.markets) // Should show real markets
console.log(result.dataSource) // Should be 'real'
```

---

## Phase 2: Fix Automatic Node Connection in AI

### Problem
The AI creates nodes but doesn't automatically connect them with edges. Users see isolated nodes that need manual connection.

**Root Cause Analysis:**
File: `/Users/scotty/Projects/Cascadian-app/app/api/ai/conversational-build/route.ts`

The `buildBatchSystemPrompt()` (line 479) tells the AI to "Connect ALL nodes using connectNodes" but doesn't enforce it.

### Solution: Enhanced Prompts + Post-Processing

**Strategy 1: Improve AI Prompt (Quick Win)**

```typescript
// app/api/ai/conversational-build/route.ts

function buildBatchSystemPrompt(): string {
  return `You are building a COMPLETE Polymarket trading bot workflow.

CRITICAL RULES:
1. Build the ENTIRE workflow in one response
2. Use ALL necessary function calls
3. ALWAYS connect nodes immediately after creating them
4. EVERY node must have at least one edge (except first/last)

WORKFLOW PATTERN:
1. Create node A with addPolymarketStreamNode
2. Create node B with addFilterNode
3. IMMEDIATELY call connectNodes(A.id, B.id)
4. Continue this pattern for ALL nodes

Example execution order:
- addPolymarketStreamNode(id: "stream-1")
- addFilterNode(id: "filter-1")
- connectNodes(sourceId: "stream-1", targetId: "filter-1")
- addLLMNode(id: "llm-1")
- connectNodes(sourceId: "filter-1", targetId: "llm-1")
- etc...

Available node types:
- polymarket-stream: Fetch Polymarket market data (ALWAYS FIRST)
- filter: Filter data by conditions
- llm-analysis: AI analysis with custom prompts
- transform: Data transformation with formulas
- condition: If/then/else logic
- polymarket-buy: Execute buy orders (ALWAYS LAST)

REMEMBER: Call connectNodes AFTER each pair of nodes!`
}
```

**Strategy 2: Auto-Connect Post-Processing (Bulletproof)**

Add automatic edge creation after AI finishes:

```typescript
// app/api/ai/conversational-build/route.ts

/**
 * Auto-connect nodes if AI forgot to connect them
 * Creates a linear flow: node1 → node2 → node3 → etc
 */
function autoConnectNodes(workflow: any): any {
  const nodes = workflow.nodes || []
  const edges = workflow.edges || []

  // Skip if already connected
  if (edges.length >= nodes.length - 1) {
    return workflow
  }

  console.log('[Auto-Connect] Connecting unconnected nodes...')

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
      newEdges.push({
        id: `edge-${source.id}-${target.id}`,
        source: source.id,
        target: target.id,
        label: `${source.type} → ${target.type}`,
      })
    }
  }

  return { ...workflow, edges: newEdges }
}

// In buildWorkflowComplete() function, add before returning:
async function buildWorkflowComplete(...) {
  // ... existing code ...

  // Auto-connect if needed
  workflowInProgress = autoConnectNodes(workflowInProgress)

  const summary = generateWorkflowSummary(workflowInProgress, allToolCalls)

  return NextResponse.json({
    message: `${aiResponse}\n\n${summary}`,
    toolCalls: allToolCalls,
    suggestions: ['Test workflow', 'Make adjustments', 'Explain how it works'],
    workflowComplete: isComplete,
    nodeCount: workflowInProgress.nodes?.length || 0,
    edgeCount: workflowInProgress.edges?.length || 0, // Add this
    passCount,
  })
}
```

**Required Changes:**
- File: `/Users/scotty/Projects/Cascadian-app/app/api/ai/conversational-build/route.ts`
- Add `autoConnectNodes()` function after line 437
- Update `buildBatchSystemPrompt()` at line 479
- Call `autoConnectNodes()` in `buildWorkflowComplete()` before line 189

---

## Phase 3: Implement Safe Buy Node Execution

### Problem
`executePolymarketBuyNode` returns fake success instead of executing real trades.

### Solution: Simulation Mode + Real Trading Mode

**Safety-First Approach:**

```typescript
// lib/workflow/node-executors.ts

/**
 * Polymarket Buy Node
 *
 * Modes:
 * - SIMULATION: Logs intent, returns mock success (DEFAULT)
 * - PAPER_TRADING: Records to database, no blockchain tx
 * - LIVE: Actually executes on-chain (requires wallet connection)
 */
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
    mode = 'SIMULATION' // SIMULATION | PAPER_TRADING | LIVE
  } = config

  // Get market data for validation
  const market = inputs?.markets?.[0] || inputs?.filtered?.[0]

  if (!market) {
    throw new Error('Buy node requires market data from previous node')
  }

  // SIMULATION MODE (Safe for testing)
  if (mode === 'SIMULATION') {
    console.log('[SIMULATION] Buy Order:', {
      market: market.question,
      outcome,
      amount,
      orderType,
      currentPrice: market.currentPrice
    })

    return {
      orderId: `sim_${Date.now()}`,
      marketId: market.id,
      outcome,
      amount,
      executedPrice: market.currentPrice,
      status: 'simulated',
      timestamp: Date.now(),
      mode: 'SIMULATION',
      note: 'This is a simulated trade - no real execution'
    }
  }

  // PAPER TRADING MODE (Record to database)
  if (mode === 'PAPER_TRADING') {
    const order = {
      market_id: market.id,
      outcome,
      amount,
      order_type: orderType,
      limit_price: limitPrice || market.currentPrice,
      executed_price: market.currentPrice,
      status: 'paper_filled',
      created_at: new Date().toISOString()
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

    return {
      orderId: data.id,
      marketId: market.id,
      outcome,
      amount,
      executedPrice: data.executed_price,
      status: 'paper_filled',
      timestamp: Date.now(),
      mode: 'PAPER_TRADING'
    }
  }

  // LIVE TRADING MODE (Requires implementation)
  if (mode === 'LIVE') {
    // TODO: Implement Polymarket CLOB order submission
    // Requires:
    // - User wallet connection (private key or Web3 provider)
    // - CLOB API order endpoints
    // - On-chain transaction signing
    // - Order status monitoring

    throw new Error('LIVE trading not yet implemented. Use SIMULATION or PAPER_TRADING modes.')
  }

  throw new Error(`Unknown trading mode: ${mode}`)
}
```

**Database Schema for Paper Trading:**

```sql
-- Add to Supabase migrations
CREATE TABLE paper_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  workflow_id TEXT,
  market_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  order_type TEXT NOT NULL, -- market, limit
  limit_price NUMERIC,
  executed_price NUMERIC NOT NULL,
  status TEXT NOT NULL, -- paper_filled, paper_cancelled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX idx_paper_trades_user ON paper_trades(user_id);
CREATE INDEX idx_paper_trades_market ON paper_trades(market_id);
```

**Required Changes:**
- File: `/Users/scotty/Projects/Cascadian-app/lib/workflow/node-executors.ts`
- Lines: 456-484 (replace stub implementation)
- Create migration: `/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251023120000_paper_trades.sql`

---

## Phase 4: Data Validation & Error Handling

### Node Input Validation

Add validation to ensure nodes receive correct data types:

```typescript
// lib/workflow/validation.ts

export function validateNodeInputs(
  nodeType: string,
  inputs: any,
  config: any
): { valid: boolean; error?: string } {

  switch (nodeType) {
    case 'filter':
      if (!inputs?.markets && !Array.isArray(inputs)) {
        return {
          valid: false,
          error: 'Filter node requires market data from Polymarket Stream node'
        }
      }
      break

    case 'llm-analysis':
      if (!inputs) {
        return {
          valid: false,
          error: 'LLM node requires input data'
        }
      }
      break

    case 'polymarket-buy':
      const hasMarket = inputs?.markets?.[0] || inputs?.filtered?.[0]
      if (!hasMarket) {
        return {
          valid: false,
          error: 'Buy node requires market data. Connect to Filter or Stream node.'
        }
      }
      break
  }

  return { valid: true }
}

// Use in executeNodeByType():
export async function executeNodeByType(
  type: NodeType,
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {

  // Validate inputs
  const validation = validateNodeInputs(type, inputs, config)
  if (!validation.valid) {
    throw new Error(`Node validation failed: ${validation.error}`)
  }

  // ... rest of execution
}
```

**Required Changes:**
- Create file: `/Users/scotty/Projects/Cascadian-app/lib/workflow/validation.ts`
- Import in: `/Users/scotty/Projects/Cascadian-app/lib/workflow/node-executors.ts`

---

## Phase 5: Testing Strategy

### Unit Tests for Node Executors

```typescript
// __tests__/workflow/node-executors.test.ts

describe('Polymarket Stream Node', () => {
  it('should fetch real market data from database', async () => {
    const result = await executePolymarketStreamNode({
      categories: ['Politics'],
      minVolume: 0,
      maxResults: 5
    }, null, {})

    expect(result.dataSource).toBe('real')
    expect(result.markets).toBeInstanceOf(Array)
    expect(result.markets.length).toBeGreaterThan(0)
    expect(result.markets[0]).toHaveProperty('question')
    expect(result.markets[0]).toHaveProperty('currentPrice')
  })

  it('should filter by category', async () => {
    const result = await executePolymarketStreamNode({
      categories: ['Crypto'],
      maxResults: 10
    }, null, {})

    expect(result.markets.every(m => m.category === 'Crypto')).toBe(true)
  })
})

describe('Filter Node', () => {
  it('should filter markets by volume', async () => {
    const mockInput = {
      markets: [
        { id: '1', volume: 50000 },
        { id: '2', volume: 100000 },
        { id: '3', volume: 25000 }
      ]
    }

    const result = await executeFilterNode({
      conditions: [{
        field: 'volume',
        operator: 'gt',
        value: 40000
      }]
    }, mockInput, {})

    expect(result.filtered.length).toBe(2)
    expect(result.filtered.every(m => m.volume > 40000)).toBe(true)
  })
})

describe('Buy Node', () => {
  it('should execute in simulation mode', async () => {
    const mockInput = {
      markets: [{ id: 'market-1', currentPrice: 0.65, question: 'Test?' }]
    }

    const result = await executePolymarketBuyNode({
      outcome: 'Yes',
      amount: 10,
      mode: 'SIMULATION'
    }, mockInput, {})

    expect(result.status).toBe('simulated')
    expect(result.mode).toBe('SIMULATION')
    expect(result.orderId).toMatch(/^sim_/)
  })

  it('should throw error if no market data', async () => {
    await expect(
      executePolymarketBuyNode({
        outcome: 'Yes',
        amount: 10
      }, {}, {})
    ).rejects.toThrow('requires market data')
  })
})
```

### Integration Test: Full Workflow

```typescript
// __tests__/workflow/full-workflow.test.ts

describe('Full Trading Workflow', () => {
  it('should execute: Stream → Filter → LLM → Buy', async () => {
    // Step 1: Stream markets
    const streamResult = await executePolymarketStreamNode({
      categories: ['Politics'],
      minVolume: 10000,
      maxResults: 10
    }, null, {})

    expect(streamResult.markets.length).toBeGreaterThan(0)

    // Step 2: Filter markets
    const filterResult = await executeFilterNode({
      conditions: [{
        field: 'volume',
        operator: 'gt',
        value: 50000
      }]
    }, streamResult, {})

    expect(filterResult.filtered.length).toBeGreaterThan(0)

    // Step 3: LLM analysis
    const llmResult = await executeLLMAnalysisNode({
      userPrompt: 'Is this market about politics?',
      outputFormat: 'boolean'
    }, filterResult.filtered[0], {})

    expect(typeof llmResult.result).toBe('boolean')

    // Step 4: Buy (simulation)
    const buyResult = await executePolymarketBuyNode({
      outcome: 'Yes',
      amount: 10,
      mode: 'SIMULATION'
    }, filterResult, {})

    expect(buyResult.status).toBe('simulated')
  })
})
```

---

## Security & Safety Considerations

### 1. Trading Mode Safeguards

**Default to Simulation:**
```typescript
// Always default to safe mode
const mode = config.mode || 'SIMULATION'

// Require explicit opt-in for live trading
if (mode === 'LIVE') {
  if (!context.userApproved) {
    throw new Error('LIVE trading requires explicit user approval')
  }
  if (!context.walletConnected) {
    throw new Error('LIVE trading requires wallet connection')
  }
}
```

### 2. Amount Limits

```typescript
// Enforce max trade amount
const MAX_TRADE_AMOUNT = parseFloat(process.env.MAX_TRADE_AMOUNT || '100')

if (amount > MAX_TRADE_AMOUNT) {
  throw new Error(`Trade amount ${amount} exceeds limit ${MAX_TRADE_AMOUNT}`)
}
```

### 3. Rate Limiting for Workflows

```typescript
// Prevent workflow spam
const WORKFLOW_RATE_LIMIT = 10 // executions per minute

// Track in Redis or in-memory
const executionCount = await getExecutionCount(context.userId)
if (executionCount > WORKFLOW_RATE_LIMIT) {
  throw new Error('Workflow execution rate limit exceeded')
}
```

### 4. Data Staleness Warnings

```typescript
// Warn if market data is stale
const dataAge = Date.now() - result.timestamp
if (dataAge > 5 * 60 * 1000) { // 5 minutes
  console.warn('[Workflow] Market data is stale, consider refreshing')
}
```

---

## Monitoring & Observability

### Workflow Execution Logging

```typescript
// lib/workflow/logger.ts

export async function logWorkflowExecution(
  workflowId: string,
  userId: string,
  nodes: any[],
  result: any,
  error?: any
) {
  await supabaseAdmin.from('workflow_executions').insert({
    workflow_id: workflowId,
    user_id: userId,
    node_count: nodes.length,
    status: error ? 'failed' : 'success',
    error_message: error?.message,
    execution_time_ms: result.duration_ms,
    data_source: result.dataSource, // 'real' or 'mock'
    created_at: new Date().toISOString()
  })
}
```

### Metrics to Track

- Workflow execution success rate
- Average execution time
- Node failure rates by type
- Data source distribution (real vs mock)
- Buy node execution mode distribution

---

## File Changes Summary

### Files to Modify

1. **`/Users/scotty/Projects/Cascadian-app/lib/workflow/node-executors.ts`**
   - Replace `executePolymarketStreamNode` (lines 201-262)
   - Replace `executePolymarketBuyNode` (lines 456-484)
   - Add import: `import { supabaseAdmin } from '@/lib/supabase'`
   - Add input validation calls

2. **`/Users/scotty/Projects/Cascadian-app/app/api/ai/conversational-build/route.ts`**
   - Update `buildBatchSystemPrompt()` (line 479)
   - Add `autoConnectNodes()` function (after line 437)
   - Call `autoConnectNodes()` in `buildWorkflowComplete()` (before line 189)

### Files to Create

3. **`/Users/scotty/Projects/Cascadian-app/lib/workflow/validation.ts`**
   - Input validation functions
   - Type guards for node data

4. **`/Users/scotty/Projects/Cascadian-app/lib/workflow/logger.ts`**
   - Workflow execution logging
   - Performance metrics

5. **`/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251023120000_paper_trades.sql`**
   - Paper trading table schema

### Files to Test

6. **`/Users/scotty/Projects/Cascadian-app/__tests__/workflow/node-executors.test.ts`**
7. **`/Users/scotty/Projects/Cascadian-app/__tests__/workflow/full-workflow.test.ts`**

---

## Rollout Plan

### Stage 1: Real Data Integration (1-2 days)
- ✅ Modify `executePolymarketStreamNode` to use Supabase
- ✅ Test with real market data
- ✅ Verify categories, volume filtering work
- ✅ Deploy to staging

### Stage 2: Auto-Connect Nodes (0.5 days)
- ✅ Add `autoConnectNodes()` function
- ✅ Update AI prompts
- ✅ Test full workflow builds
- ✅ Deploy to staging

### Stage 3: Safe Trading (1 day)
- ✅ Implement simulation mode (current default)
- ✅ Add paper trading mode with database
- ✅ Create paper_trades table
- ✅ Test trading workflows end-to-end
- ✅ Deploy to staging

### Stage 4: Validation & Monitoring (0.5 days)
- ✅ Add input validation
- ✅ Add execution logging
- ✅ Set up monitoring dashboards
- ✅ Deploy to production

### Stage 5: Live Trading (Future - Post-MVP)
- Implement CLOB order submission
- Add wallet connection
- Add order status tracking
- Implement withdrawal limits
- Security audit

---

## API Endpoints Available for Workflows

The following endpoints are already built and ready to use:

### Market Data
- **GET `/api/polymarket/markets`** - List markets with filters
  - Query params: `category`, `active`, `limit`, `offset`, `sort`, `include_analytics`
  - Returns: Paginated markets with optional analytics

- **GET `/api/polymarket/market/[id]`** - Single market detail
  - Returns: Full market data with OHLC, orderbook, etc.

### Events
- **GET `/api/polymarket/events`** - List events
  - Query params: `limit`, `offset`, `closed`
  - Returns: Events with nested markets

### Trade Data (CLOB API)
- **GET `/api/polymarket/aggregate/[conditionId]`** - Trade analytics
  - Returns: 24h trade metrics, buy/sell ratio, momentum

### Sync
- **POST `/api/polymarket/sync`** - Trigger manual sync
  - Returns: Sync result with stats

---

## Code Examples

### Example 1: Complete Workflow (Stream → Filter → Buy)

```typescript
// Workflow definition (what AI creates)
const workflow = {
  nodes: [
    {
      id: 'stream-1',
      type: 'polymarket-stream',
      data: {
        config: {
          categories: ['Politics'],
          minVolume: 50000,
          maxResults: 10
        }
      }
    },
    {
      id: 'filter-1',
      type: 'filter',
      data: {
        config: {
          conditions: [{
            field: 'currentPrice',
            operator: 'gt',
            value: 0.5
          }]
        }
      }
    },
    {
      id: 'buy-1',
      type: 'polymarket-buy',
      data: {
        config: {
          outcome: 'Yes',
          amount: 10,
          mode: 'SIMULATION'
        }
      }
    }
  ],
  edges: [
    { id: 'e1', source: 'stream-1', target: 'filter-1' },
    { id: 'e2', source: 'filter-1', target: 'buy-1' }
  ]
}

// Execution (what happens when user runs it)
// 1. Stream executes → returns real markets from Supabase
// 2. Filter executes → filters markets by price > 0.5
// 3. Buy executes → simulates buy order on first filtered market
```

### Example 2: Advanced Workflow (Stream → LLM → Transform → Condition → Buy)

```typescript
const advancedWorkflow = {
  nodes: [
    {
      id: 'stream-1',
      type: 'polymarket-stream',
      data: {
        config: {
          categories: ['Crypto'],
          minVolume: 100000,
          maxResults: 5
        }
      }
    },
    {
      id: 'llm-1',
      type: 'llm-analysis',
      data: {
        config: {
          userPrompt: 'Analyze this market for bullish sentiment. Return true/false.',
          outputFormat: 'boolean'
        }
      }
    },
    {
      id: 'transform-1',
      type: 'transform',
      data: {
        config: {
          operations: [{
            type: 'add-column',
            config: {
              name: 'edge',
              formula: 'currentPrice - 0.5' // Calculate edge
            }
          }]
        }
      }
    },
    {
      id: 'condition-1',
      type: 'condition',
      data: {
        config: {
          conditions: [{
            if: 'edge > 0.2', // Only trade if edge > 20%
            then: 'buy',
            else: 'skip'
          }]
        }
      }
    },
    {
      id: 'buy-1',
      type: 'polymarket-buy',
      data: {
        config: {
          outcome: 'Yes',
          amount: 50,
          mode: 'PAPER_TRADING' // Record to database
        }
      }
    }
  ]
}
```

---

## Performance Optimization

### Caching Strategy

```typescript
// Cache market data for 30 seconds
const CACHE_TTL = 30 * 1000

const cachedMarkets = new Map<string, { data: any, timestamp: number }>()

async function executePolymarketStreamNode(config, inputs, context) {
  const cacheKey = JSON.stringify({ categories: config.categories, minVolume: config.minVolume })
  const cached = cachedMarkets.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[Cache] Using cached market data')
    return cached.data
  }

  // Fetch fresh data
  const result = await fetchFromDatabase(config)

  // Update cache
  cachedMarkets.set(cacheKey, {
    data: result,
    timestamp: Date.now()
  })

  return result
}
```

### Batch Processing

For workflows that need to analyze many markets:

```typescript
// Process markets in batches to avoid memory issues
const BATCH_SIZE = 50

async function processManyMarkets(markets) {
  const results = []

  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(m => analyzeSingleMarket(m))
    )
    results.push(...batchResults)
  }

  return results
}
```

---

## FAQ

### Q: Why not use the Polymarket client directly in workflows?
**A:** Workflows execute server-side, and the client hits external APIs which are rate-limited. Using Supabase is faster (local database), cached, and doesn't hit rate limits.

### Q: How do I test workflows without real trades?
**A:** Use `mode: 'SIMULATION'` (default) which logs trades but doesn't execute. For tracking, use `mode: 'PAPER_TRADING'`.

### Q: Can workflows run on a schedule?
**A:** Yes! Future enhancement: Add cron job support to run workflows every X minutes/hours.

### Q: What happens if market data is stale?
**A:** The sync system automatically triggers background updates when data is >5min old. Workflows still execute with available data.

### Q: How do I add a new node type?
**A:**
1. Add to `NodeType` union in types
2. Create executor function in `node-executors.ts`
3. Add to AI tool definitions in `conversational-build/route.ts`
4. Add UI component in `components/nodes/`

### Q: Can I use external APIs in nodes?
**A:** Yes! The `httpRequest` node already supports this. Or create custom nodes with API calls.

---

## Next Steps After Implementation

### Immediate (MVP Complete)
- ✅ Real market data in workflows
- ✅ Automatic node connections
- ✅ Safe simulation mode
- ✅ Paper trading tracking

### Short Term (Phase 2)
- Workflow scheduling (cron jobs)
- Performance metrics dashboard
- Workflow templates (save/share)
- Multi-user collaboration

### Long Term (Phase 3)
- Live trading with wallet integration
- Advanced order types (limit, stop-loss)
- Backtesting framework
- Portfolio management

---

## Success Metrics

### Technical Metrics
- ✅ 100% of workflows use real data (no mocks)
- ✅ <500ms average node execution time
- ✅ >95% automatic edge creation success rate
- ✅ Zero accidental live trades in simulation mode

### User Metrics
- Users can build working trading bots in <5 minutes
- Workflows execute successfully without manual fixes
- Paper trading records provide valuable insights
- Users trust the system enough to enable live trading

---

## Conclusion

This implementation plan provides a complete, production-ready architecture for connecting workflows to real Polymarket data. The existing infrastructure (API client, database sync, CLOB aggregation) is already excellent - we just need to wire it up to the workflow execution engine.

**Key Strengths:**
- Leverages existing production-ready components
- Safety-first approach with simulation/paper trading
- Automatic edge creation solves UX issue
- Comprehensive error handling and validation

**Timeline:** 2-3 days for full implementation (Stages 1-4)

**Risk Level:** Low - mostly integration work, no new external dependencies

Ready to implement! 🚀
