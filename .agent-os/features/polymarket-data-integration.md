# Feature Spec: Real Polymarket Data Integration for Workflow Execution

## Overview

Integrate the existing Polymarket data infrastructure (API client, database sync, and API routes) with the Strategy Builder's workflow execution system to replace mock data with real market data from Polymarket.

**Current State:**
- Mock Polymarket client returns stub data in workflow nodes
- Real Polymarket infrastructure exists separately (API client, Supabase sync, REST endpoints)
- No connection between workflow execution and real data

**Target State:**
- Workflow nodes fetch real Polymarket data via existing infrastructure
- Polymarket Stream nodes query the Supabase database (cached data)
- Optional: Direct API calls for real-time data
- Buy/Sell nodes integrate with CLOB API (future)

## User Story

As a strategy builder user, I want my workflows to use real Polymarket market data so that I can test and execute trading strategies with actual market conditions.

## Acceptance Criteria

- [ ] `polymarket-stream` node fetches real markets from database
- [ ] `filter` node filters real market data correctly
- [ ] `llm-analysis` node receives real market data in prompts
- [ ] `transform` node transforms real market fields
- [ ] `condition` node evaluates real market conditions
- [ ] `polymarket-buy` node validates market IDs against real markets
- [ ] Workflow execution results display real market data
- [ ] Error handling for API failures and stale data
- [ ] Performance: Workflow execution completes in <5 seconds

## Technical Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WORKFLOW EXECUTION                            │
│                                                                       │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐ │
│  │ Polymarket │   │   Filter   │   │    LLM     │   │ Polymarket │ │
│  │  Stream    │──▶│    Node    │──▶│  Analysis  │──▶│    Buy     │ │
│  │    Node    │   │            │   │    Node    │   │    Node    │ │
│  └────────────┘   └────────────┘   └────────────┘   └────────────┘ │
│         │                                                             │
└─────────┼─────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA ACCESS LAYER                                 │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Polymarket Service Layer                        │   │
│  │  ┌────────────────┐         ┌──────────────────┐            │   │
│  │  │  fetchMarkets  │         │  fetchMarket     │            │   │
│  │  │  (via API)     │         │  (via API)       │            │   │
│  │  └────────────────┘         └──────────────────┘            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                           │                                          │
│                           ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   API Routes                                  │   │
│  │  /api/polymarket/markets           - List markets            │   │
│  │  /api/polymarket/markets/[id]      - Single market           │   │
│  │  /api/polymarket/sync              - Trigger sync            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                           │                                          │
│                           ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                Supabase Database                              │   │
│  │  ┌──────────────────┐    ┌──────────────────┐                │   │
│  │  │    markets       │    │  market_analytics│                │   │
│  │  │  - market_id     │    │  - trades_24h    │                │   │
│  │  │  - title         │    │  - momentum      │                │   │
│  │  │  - volume_24h    │    │  - buy_sell_ratio│                │   │
│  │  │  - liquidity     │    │  etc.            │                │   │
│  │  └──────────────────┘    └──────────────────┘                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                           ▲                                          │
│                           │                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Polymarket Gamma API                             │   │
│  │  - Events endpoint (with markets)                             │   │
│  │  - Markets endpoint                                           │   │
│  │  - 5-minute background sync                                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow Patterns

#### Pattern 1: Database-First (Recommended for MVP)
**Best for:** Fast execution, cached data, reduced API calls

```typescript
polymarket-stream node
  ↓
fetch('/api/polymarket/markets?category=Politics&limit=10')
  ↓
Supabase query (with analytics join)
  ↓
Return CascadianMarket[] (transformed from DB rows)
  ↓
Filter/Transform/Analyze in workflow
```

**Pros:**
- Fast (database is indexed)
- Reliable (no rate limits)
- Analytics included (momentum, trade counts)
- Already built and working

**Cons:**
- Data may be up to 5 minutes stale
- Depends on background sync

#### Pattern 2: Direct API (Future Enhancement)
**Best for:** Real-time data, live price feeds

```typescript
polymarket-stream node (with real_time: true option)
  ↓
Direct call to lib/polymarket/client.ts
  ↓
Polymarket Gamma API
  ↓
Transform and cache
```

**Pros:**
- Real-time data
- No staleness

**Cons:**
- Slower (API latency)
- Rate limits (60 req/min)
- More expensive

### Components to Modify

#### 1. Node Executors (`lib/workflow/node-executors.ts`)

**Current:** Returns stub data
**New:** Calls real API routes

```typescript
// BEFORE (stub)
async function executePolymarketStreamNode(config, inputs, context) {
  const stubMarkets = [/* hardcoded data */]
  return { markets: stubMarkets }
}

// AFTER (real data)
async function executePolymarketStreamNode(config, inputs, context) {
  const { categories = [], minVolume = 0, maxResults = 10 } = config

  // Build query params
  const params = new URLSearchParams()
  if (categories.length > 0) params.set('category', categories[0]) // First category
  params.set('limit', maxResults.toString())
  params.set('include_analytics', 'true')
  if (minVolume > 0) params.set('min_volume', minVolume.toString())

  // Fetch from API route
  const response = await fetch(`/api/polymarket/markets?${params}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch markets: ${response.statusText}`)
  }

  const data = await response.json()

  // Transform CascadianMarket to workflow-friendly format
  const markets = data.data.map(transformMarketForWorkflow)

  return {
    markets,
    count: markets.length,
    timestamp: Date.now(),
    stale: data.stale,
  }
}
```

#### 2. Market Transformation Utility

Create `/lib/workflow/market-transformer.ts`:

```typescript
import type { CascadianMarket } from '@/types/polymarket'

/**
 * Transform CascadianMarket (from database) to workflow-friendly format
 * Makes it easier to use in filters, transforms, and LLM prompts
 */
export function transformMarketForWorkflow(market: CascadianMarket) {
  return {
    // Identity
    id: market.market_id,
    question: market.title,
    description: market.description,
    category: market.category,

    // Pricing (simplified)
    currentPrice: market.current_price,
    price: market.current_price, // Alias for convenience

    // Volume & Liquidity
    volume: market.volume_24h,
    volume24h: market.volume_24h,
    volumeTotal: market.volume_total,
    liquidity: market.liquidity,

    // Market state
    active: market.active,
    closed: market.closed,
    endsAt: market.end_date,
    outcomes: market.outcomes,

    // Analytics (if included)
    trades24h: market.analytics?.trades_24h || 0,
    buyers24h: market.analytics?.buyers_24h || 0,
    sellers24h: market.analytics?.sellers_24h || 0,
    buySellRatio: market.analytics?.buy_sell_ratio || 1,
    momentum: market.analytics?.momentum_score || 0,
    priceChange24h: market.analytics?.price_change_24h || 0,

    // Metadata
    slug: market.slug,
    imageUrl: market.image_url,
  }
}
```

#### 3. Environment Detection

Update `lib/polymarket/mock-client.ts`:

```typescript
/**
 * Check if workflow should use real data
 */
export function useRealPolymarketData(): boolean {
  // Use real data in production
  if (process.env.NODE_ENV === 'production') return true

  // Use real data if explicitly enabled
  if (process.env.NEXT_PUBLIC_USE_REAL_POLYMARKET === 'true') return true

  // Use mock data in test/development by default
  return false
}
```

#### 4. Error Handling Strategy

```typescript
/**
 * Fetch markets with fallback to mock data on error
 */
async function fetchMarketsWithFallback(params: any) {
  try {
    const response = await fetch(`/api/polymarket/markets?${params}`)

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`)
    }

    return await response.json()

  } catch (error) {
    console.error('[Workflow] Failed to fetch real data, using mock:', error)

    // Fallback to mock data
    const { fetchMockMarkets } = await import('@/lib/polymarket/mock-client')
    const mockMarkets = await fetchMockMarkets(params)

    return {
      success: true,
      data: mockMarkets,
      isMock: true,
      error: error.message,
    }
  }
}
```

### API Endpoints to Use

#### Existing Endpoints (Already Built)

1. **`GET /api/polymarket/markets`**
   - List markets with filters
   - **Query params:**
     - `category`: Filter by category
     - `limit`: Max results (default 100)
     - `offset`: Pagination offset
     - `sort`: Sort by volume/liquidity/momentum
     - `include_analytics`: Include trade metrics (set to true)
   - **Returns:** `PaginatedResponse<CascadianMarket>`

2. **`GET /api/polymarket/markets/[id]`**
   - Single market detail
   - **Returns:** `CascadianMarket`

3. **`POST /api/polymarket/sync`**
   - Trigger manual sync
   - **Auth:** Requires `Authorization: Bearer <ADMIN_API_KEY>`
   - **Returns:** Sync result

4. **`GET /api/polymarket/sync`**
   - Get sync status
   - **Returns:** `{ last_synced, is_stale, sync_in_progress }`

#### Endpoints to Create

5. **`GET /api/polymarket/markets/search`** (Optional enhancement)
   - Full-text search on market titles
   - **Query params:**
     - `q`: Search query
     - `limit`: Max results
   - **Implementation:**
     ```typescript
     const { data } = await supabaseAdmin
       .from('markets')
       .select('*')
       .textSearch('title', query, { type: 'websearch' })
       .limit(limit)
     ```

### Database Schema (Already Exists)

#### `markets` table
```sql
- market_id (PK)
- title
- description
- category
- current_price
- volume_24h
- volume_total
- liquidity
- active
- closed
- end_date
- outcomes[]
- condition_id
- raw_polymarket_data (jsonb)
- created_at
- updated_at
```

#### `market_analytics` table (Already exists)
```sql
- market_id (FK)
- condition_id
- trades_24h
- buyers_24h
- sellers_24h
- buy_volume_24h
- sell_volume_24h
- buy_sell_ratio
- momentum_score
- price_change_24h
- last_aggregated_at
```

### Rate Limiting & Caching

#### Current Strategy (Already Implemented)
- **Database cache:** 5-minute staleness threshold
- **Background sync:** Auto-triggers when data is stale
- **API rate limits:** 60 req/min to Polymarket (handled in client)
- **Retry logic:** Exponential backoff (1s, 2s, 4s, 8s)

#### Workflow-Specific Optimizations

**1. Batch fetching:**
```typescript
// Instead of: Fetch each market individually
const market1 = await fetchMarket('id1')
const market2 = await fetchMarket('id2')

// Do this: Fetch all markets in one query
const markets = await fetchMarkets({ ids: ['id1', 'id2'] })
```

**2. Result caching in execution context:**
```typescript
// Cache results within a single workflow execution
if (context.outputs.has('stream-node-1')) {
  return context.outputs.get('stream-node-1')
}

const result = await fetchMarkets(params)
context.outputs.set('stream-node-1', result)
return result
```

**3. Sync status check:**
```typescript
// Before execution, check if data is fresh
const syncStatus = await fetch('/api/polymarket/sync').then(r => r.json())

if (syncStatus.is_stale) {
  console.warn('[Workflow] Data may be stale, consider triggering sync')
  // Optionally: Auto-trigger sync in background
}
```

### Authentication & API Key Management

#### Current Setup
- **Sync endpoint:** Protected by `ADMIN_API_KEY` or `CRON_SECRET`
- **Read endpoints:** Public (no auth required)
- **Future:** User-specific API keys for trading

#### For Workflow Execution
```typescript
// No auth needed for read-only operations
const markets = await fetch('/api/polymarket/markets')

// Future: Trading operations require user context
const buyResult = await fetch('/api/polymarket/trade', {
  headers: {
    'Authorization': `Bearer ${userApiKey}`,
  },
  body: JSON.stringify({ marketId, outcome, amount })
})
```

## Implementation Plan

### Phase 1: Core Integration (1-2 hours)

**Goal:** Replace mock data with real database queries

**Tasks:**
1. Create `lib/workflow/market-transformer.ts`
   - `transformMarketForWorkflow()` function
   - Type definitions

2. Update `lib/workflow/node-executors.ts`
   - Modify `executePolymarketStreamNode()` to fetch from API
   - Add error handling with mock fallback
   - Update return format

3. Update `lib/polymarket/mock-client.ts`
   - Add `useRealPolymarketData()` function
   - Add environment variable support

4. Test workflow execution
   - Create test workflow with stream → filter → transform
   - Verify real data flows through

**Files changed:**
- `/lib/workflow/market-transformer.ts` (NEW)
- `/lib/workflow/node-executors.ts` (MODIFY)
- `/lib/polymarket/mock-client.ts` (MODIFY)

### Phase 2: Enhanced Node Support (1 hour)

**Goal:** Ensure all node types work with real data

**Tasks:**
1. Update `executeFilterNode()`
   - Test with real market fields
   - Add support for analytics fields

2. Update `executeLLMAnalysisNode()`
   - Ensure template vars work with transformed markets
   - Test prompt with real market data

3. Update `executeTransformNode()`
   - Validate formulas with real fields
   - Add helpful error messages

4. Update `executeConditionNode()`
   - Test with real market conditions

**Files changed:**
- `/lib/workflow/node-executors.ts` (MODIFY)

### Phase 3: Error Handling & Resilience (30 min)

**Goal:** Handle API failures gracefully

**Tasks:**
1. Implement fallback to mock data
2. Add retry logic for transient failures
3. Display warnings in UI when using mock data
4. Add sync status indicator

**Files changed:**
- `/lib/workflow/node-executors.ts` (MODIFY)
- `/components/workflow-editor/execution-panel.tsx` (MODIFY - optional)

### Phase 4: Buy Node Integration (Future - Phase 2)

**Goal:** Enable real trade execution

**Tasks:**
1. Create `/app/api/polymarket/trade/route.ts`
2. Integrate with CLOB API for order placement
3. Add wallet connection
4. Implement order validation
5. Update `executePolymarketBuyNode()`

**Files to create:**
- `/app/api/polymarket/trade/route.ts` (NEW)
- `/lib/polymarket/trading-client.ts` (NEW)

## Task Breakdown

### Backend Tasks

- [ ] Create market transformer utility (`lib/workflow/market-transformer.ts`)
  - `transformMarketForWorkflow()` function
  - Type definitions for workflow market format
  - Unit tests

- [ ] Update `executePolymarketStreamNode()` in `lib/workflow/node-executors.ts`
  - Replace stub data with API call to `/api/polymarket/markets`
  - Build query params from node config
  - Transform response using `transformMarketForWorkflow()`
  - Add error handling with mock fallback
  - Add logging

- [ ] Update `executeFilterNode()` in `lib/workflow/node-executors.ts`
  - Test with real market fields
  - Support analytics fields (momentum, trades_24h, etc.)
  - Add field validation

- [ ] Update `executeLLMAnalysisNode()` in `lib/workflow/node-executors.ts`
  - Test template variable replacement with real markets
  - Ensure JSON serialization works
  - Add examples in comments

- [ ] Update `executeTransformNode()` in `lib/workflow/node-executors.ts`
  - Validate formulas work with real fields
  - Add helpful error messages for missing fields
  - Test with real data

- [ ] Update `executeConditionNode()` in `lib/workflow/node-executors.ts`
  - Test conditional logic with real markets
  - Support analytics field conditions

- [ ] Add environment variable support in `lib/polymarket/mock-client.ts`
  - `useRealPolymarketData()` function
  - `NEXT_PUBLIC_USE_REAL_POLYMARKET` env var
  - Default to real data in production

### Frontend Tasks

- [ ] Add data source indicator to workflow execution UI
  - Show "Using real data" vs "Using mock data"
  - Display sync status (last synced time)
  - Show stale data warning

- [ ] Update workflow execution panel
  - Display market count in results
  - Show data freshness indicator
  - Add "Refresh data" button to trigger sync

- [ ] Add error state handling
  - Display API error messages
  - Show fallback to mock data notification
  - Add retry button

### Testing Tasks

- [ ] Test `polymarket-stream` node with various filters
  - Category filter
  - Volume filter
  - Limit parameter
  - Empty results

- [ ] Test `filter` node with real market data
  - Volume > 50000
  - Category = 'Politics'
  - Momentum > 5
  - Combined conditions

- [ ] Test `llm-analysis` node with real market data
  - Template variable replacement
  - JSON output format
  - Analysis quality

- [ ] Test `transform` node with real market data
  - Add column (edge calculation)
  - Filter rows
  - Sort by field
  - Aggregate

- [ ] Test error scenarios
  - API down (should fallback to mock)
  - Rate limit (should retry with backoff)
  - Stale data (should warn but continue)
  - Invalid market ID

- [ ] Test complete workflow end-to-end
  - Stream → Filter → Transform → LLM → Buy (stub)
  - Verify data flows correctly
  - Check execution time (<5 seconds)

## Testing Strategy

### Unit Tests

**Test:** Market transformer
```typescript
describe('transformMarketForWorkflow', () => {
  it('should transform CascadianMarket to workflow format', () => {
    const cascadian: CascadianMarket = { /* ... */ }
    const workflow = transformMarketForWorkflow(cascadian)

    expect(workflow.id).toBe(cascadian.market_id)
    expect(workflow.price).toBe(cascadian.current_price)
    expect(workflow.volume).toBe(cascadian.volume_24h)
  })
})
```

**Test:** Node executor with real data
```typescript
describe('executePolymarketStreamNode', () => {
  it('should fetch real markets from API', async () => {
    const config = { categories: ['Politics'], maxResults: 5 }
    const result = await executePolymarketStreamNode(config, {}, context)

    expect(result.markets).toBeDefined()
    expect(result.markets.length).toBeLessThanOrEqual(5)
    expect(result.markets[0]).toHaveProperty('id')
    expect(result.markets[0]).toHaveProperty('volume')
  })
})
```

### Integration Tests

**Test:** Full workflow execution
```typescript
describe('Workflow with real data', () => {
  it('should execute stream → filter → transform', async () => {
    const workflow = {
      nodes: [
        { type: 'polymarket-stream', config: { categories: ['Crypto'] } },
        { type: 'filter', config: { conditions: [{ field: 'volume', operator: 'gt', value: 10000 }] } },
        { type: 'transform', config: { operations: [{ type: 'sort', config: { field: 'volume', order: 'desc' } }] } },
      ],
      edges: [ /* ... */ ]
    }

    const result = await executeWorkflow(workflow)

    expect(result.success).toBe(true)
    expect(result.outputs['filter-node'].count).toBeGreaterThan(0)
  })
})
```

### Manual Testing Checklist

- [ ] Create workflow: Stream Politics markets
- [ ] Add filter: Volume > 50,000
- [ ] Add LLM analysis: "Which market has the best momentum?"
- [ ] Execute workflow
- [ ] Verify real market data in results
- [ ] Check execution time (<5 seconds)
- [ ] Test with stale data (trigger sync, wait, execute)
- [ ] Test with API error (disconnect network, execute)
- [ ] Verify fallback to mock data works
- [ ] Check error messages are helpful

## Rollout Plan

### Development

1. Set environment variable:
   ```bash
   NEXT_PUBLIC_USE_REAL_POLYMARKET=true
   ```

2. Implement Phase 1 changes

3. Test with development database

4. Deploy to staging branch

### Staging

1. Verify sync is running (check `/api/polymarket/sync` status)

2. Run test workflows:
   - Stream all markets
   - Filter by category
   - LLM analysis
   - Transform operations

3. Monitor performance:
   - Execution time
   - API errors
   - Fallback frequency

4. Fix any issues

### Production

1. Merge to main branch

2. Verify environment variables:
   ```bash
   NODE_ENV=production
   POLYMARKET_API_URL=https://gamma-api.polymarket.com
   ADMIN_API_KEY=<secret>
   ```

3. Monitor metrics:
   - Workflow execution success rate
   - API error rate
   - Data staleness

4. Set up alerts for:
   - Sync failures
   - Stale data > 10 minutes
   - High API error rate

## Success Metrics

### Primary Metrics

- **Data Accuracy:** 100% of workflow executions use correct market data
- **Performance:** <5 seconds average execution time
- **Reliability:** >99% workflow success rate
- **Freshness:** <5 minutes average data age

### Secondary Metrics

- **API Error Rate:** <1% of requests fail
- **Fallback Rate:** <5% of executions use mock data
- **User Satisfaction:** Positive feedback on real data

## Risks & Mitigations

### Risk 1: API Rate Limits
**Impact:** High - Could block workflow execution
**Mitigation:**
- Use database-first approach (cached data)
- Implement request deduplication
- Add exponential backoff
- Display rate limit warnings to users

### Risk 2: Stale Data
**Impact:** Medium - Users may trade on outdated prices
**Mitigation:**
- Show data freshness indicator in UI
- Auto-trigger sync before execution (optional)
- Warn users if data is >5 minutes old
- Add manual refresh button

### Risk 3: Sync Failures
**Impact:** Medium - Database becomes outdated
**Mitigation:**
- Robust error handling in sync logic
- Retry failed syncs automatically
- Alert admin on persistent failures
- Fallback to direct API calls

### Risk 4: Breaking Changes in Polymarket API
**Impact:** High - All workflows stop working
**Mitigation:**
- Store raw API responses in database
- Version API client
- Monitor Polymarket API changes
- Maintain mock data as fallback

### Risk 5: Performance Degradation
**Impact:** Medium - Slow workflow execution
**Mitigation:**
- Index database queries
- Cache results within execution context
- Use pagination for large result sets
- Monitor execution time

## Open Questions

- [ ] Should we support direct API calls for real-time data? (Answer: Not in MVP, add later)
- [ ] How do we handle multi-category filters? (Answer: Use first category for MVP)
- [ ] Should we cache workflow execution results? (Answer: No, execute fresh each time)
- [ ] Do we need authentication for workflow execution? (Answer: Not for read-only, yes for trading)
- [ ] Should we auto-trigger sync before execution? (Answer: No, rely on background sync)

## References

- [Polymarket Gamma API Docs](https://docs.polymarket.com)
- [Supabase PostgREST Docs](https://postgrest.org)
- [Existing Polymarket Client](/lib/polymarket/client.ts)
- [Database Migration](/supabase/migrations/20251022140000_create_polymarket_tables_v2.sql)
- [API Routes](/app/api/polymarket/markets/route.ts)

---

## Next Steps

1. Review this spec with the user
2. Get approval on architecture approach (database-first)
3. Begin Phase 1 implementation
4. Test with real data in development
5. Deploy to staging for validation
6. Roll out to production
