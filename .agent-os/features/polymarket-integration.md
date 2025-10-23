# Feature Spec: Polymarket API Integration

## Overview
Integrate real Polymarket data into the Cascadian trading app, replacing mock data generators with live market information from Polymarket's API. This establishes the foundation for all data-driven features across the application.

## User Story
As a trader using Cascadian, I want to see real-time Polymarket market data so that I can make informed trading decisions based on actual market conditions rather than mock data.

## Acceptance Criteria
- [ ] Market Screener displays real Polymarket markets with live pricing
- [ ] Event Detail pages show actual market data and trading activity
- [ ] API client handles rate limiting and errors gracefully
- [ ] Data refreshes automatically without manual page reload
- [ ] TypeScript types match actual Polymarket API responses
- [ ] Environment variables properly configure API access
- [ ] Error states provide clear feedback to users
- [ ] Loading states indicate data is being fetched

## Technical Design

### Architecture
We'll create a layered architecture:
1. **API Layer** (`/app/api/polymarket/*`) - Next.js API routes that proxy Polymarket API
2. **Client Library** (`/lib/polymarket/`) - Reusable functions for Polymarket integration
3. **Types** (`/types/polymarket.ts`) - TypeScript interfaces for Polymarket data
4. **React Hooks** (`/hooks/use-polymarket-*.ts`) - Client-side data fetching hooks
5. **UI Components** - Updated to consume real data instead of mocks

### Components Affected
- `/components/market-screener-interface/index.tsx` - Main screener table
- `/components/event-detail/index.tsx` - Individual market details
- `/components/market-map/index.tsx` - Visual market overview
- `/app/(dashboard)/discovery/screener/page.tsx` - Screener page
- `/app/(dashboard)/events/[slug]/page.tsx` - Event detail page

### New Components
- `/lib/polymarket/client.ts` - Core API client for Polymarket
- `/lib/polymarket/cache.ts` - Simple in-memory caching layer
- `/lib/polymarket/types.ts` - Type transformations and mappings
- `/types/polymarket.ts` - TypeScript interfaces
- `/hooks/use-polymarket-markets.ts` - React hook for fetching markets
- `/hooks/use-polymarket-market-detail.ts` - React hook for single market
- `/app/api/polymarket/markets/route.ts` - Markets list endpoint
- `/app/api/polymarket/markets/[id]/route.ts` - Single market endpoint

### API Endpoints

#### New Endpoints

**GET /api/polymarket/markets**
- Purpose: Fetch list of active markets with filters
- Query params:
  - `limit` (number, default: 100)
  - `offset` (number, default: 0)
  - `category` (string, optional)
  - `active` (boolean, default: true)
  - `closed` (boolean, default: false)
  - `sort_by` (string: 'volume' | 'liquidity' | 'created_at')
- Request: N/A (GET)
- Response:
```typescript
{
  success: true,
  data: Market[],
  count: number,
  total: number,
  filters: FilterParams
}
```

**GET /api/polymarket/markets/[id]**
- Purpose: Fetch detailed data for a single market
- Request: N/A (GET with ID in path)
- Response:
```typescript
{
  success: true,
  data: MarketDetail,
  timestamp: string
}
```

**GET /api/polymarket/markets/[id]/trades**
- Purpose: Fetch recent trades for a market
- Query params:
  - `limit` (number, default: 50)
  - `offset` (number, default: 0)
- Response:
```typescript
{
  success: true,
  data: Trade[],
  count: number
}
```

### Data Model

```typescript
// Core Polymarket types
interface PolymarketMarket {
  id: string;
  question: string;
  description: string;
  condition_id: string;
  slug: string;

  // Outcomes
  outcomes: string[]; // e.g., ['Yes', 'No']
  outcome_prices: string[]; // Current prices as strings

  // Market state
  active: boolean;
  closed: boolean;
  end_date_iso: string;

  // Volume and liquidity
  volume: string; // USD volume
  volume_24hr: string;
  liquidity: string;

  // Metadata
  category: string;
  tags: string[];
  image_url?: string;
  created_at: string;
  updated_at: string;
}

interface PolymarketMarketDetail extends PolymarketMarket {
  // Additional detail fields
  events?: PolymarketEvent[];
  orderbook?: OrderbookData;
  recent_trades?: Trade[];
}

interface Trade {
  id: string;
  market_id: string;
  outcome: string;
  price: string;
  amount: string;
  side: 'buy' | 'sell';
  timestamp: string;
  maker_address?: string;
  taker_address?: string;
}

// Transformed types for our app
interface CascadianMarket {
  id: string;
  title: string;
  category: string;
  yes_price: number;
  no_price: number;
  volume_24h: number;
  total_volume: number;
  liquidity: number;
  end_date: Date;
  active: boolean;
  slug: string;
  image_url?: string;
}

// Mapping function
function transformPolymarketMarket(pm: PolymarketMarket): CascadianMarket {
  return {
    id: pm.id,
    title: pm.question,
    category: pm.category,
    yes_price: parseFloat(pm.outcome_prices[0]),
    no_price: parseFloat(pm.outcome_prices[1]),
    volume_24h: parseFloat(pm.volume_24hr),
    total_volume: parseFloat(pm.volume),
    liquidity: parseFloat(pm.liquidity),
    end_date: new Date(pm.end_date_iso),
    active: pm.active,
    slug: pm.slug,
    image_url: pm.image_url
  };
}
```

### State Management
- Use React Query (TanStack Query) for server state management
- Cache API responses for 30 seconds (markets list) and 10 seconds (market detail)
- Automatic background refetching when window regains focus
- Optimistic updates for user interactions
- Global loading/error states via React Context (optional, evaluate need)

### UI/UX Flow

#### Market Screener Flow
1. User navigates to `/discovery/screener`
2. Page shows loading skeleton
3. Frontend calls `/api/polymarket/markets` via React hook
4. API route fetches from Polymarket, transforms data
5. Table renders with real market data
6. User can filter/sort (client-side initially)
7. Data auto-refreshes every 30 seconds

#### Event Detail Flow
1. User clicks market from screener
2. Navigate to `/events/[slug]`
3. Page shows loading state
4. Frontend calls `/api/polymarket/markets/[id]` and `/api/polymarket/markets/[id]/trades`
5. Render market detail with live price, volume, recent trades
6. Auto-refresh every 10 seconds

### Error Handling
- **API Rate Limit (429)** → Show toast: 'Rate limited, retrying in X seconds' + exponential backoff
- **Network Error** → Show error state with retry button
- **Invalid Market ID (404)** → Redirect to screener with toast: 'Market not found'
- **Server Error (500)** → Fall back to cached data if available, show stale indicator
- **Timeout** → Retry once, then show error state
- **Invalid API Response** → Log to console, show generic error to user

### Performance Considerations
- Implement request deduplication (multiple components requesting same data)
- Add simple in-memory cache for 30s on server-side
- Use streaming for large datasets (future enhancement)
- Lazy load market images
- Virtualize long market lists (already using TanStack Virtual)
- Debounce search/filter inputs
- Consider IndexedDB for client-side persistence (Phase 2)

### Security Considerations
- API keys stored in `.env.local` (not committed)
- Next.js API routes act as proxy (hide API keys from client)
- Input validation on all query params
- Sanitize market slugs before using in URLs
- Rate limit our own API routes (future: use Vercel rate limiting)
- CORS headers properly configured
- No user data sent to Polymarket (read-only integration)

## Learnings from Previous Implementation

### What Worked Well in Old System (Preserve These Patterns)
1. **Next.js API routes as proxy** - Hides API keys from client, works great
2. **Batch processing** - Process markets in chunks of 500, prevents timeouts
3. **TanStack Query** - Client-side caching with auto-refresh worked perfectly
4. **UPSERT pattern** - `{ onConflict: 'market_id' }` prevents duplicates
5. **Parallel processing** - `Promise.all()` for fetching multiple sources
6. **Materialized views** - When done right, 50ms vs 4-second queries

### Critical Issues to Avoid (Lessons from Old System)
1. ❌ **No pagination** - Returning 1000+ markets caused slowdowns
2. ❌ **Sequential processing** - Looping through markets one-by-one timed out
3. ❌ **No retry logic** - Rate limits (429) killed jobs permanently
4. ❌ **Missing unique constraints** - Duplicate trades slipped through
5. ❌ **In-memory cache issues** - Not shared across Vercel instances
6. ❌ **No mutex on cron jobs** - Jobs overlapped and exhausted connections
7. ❌ **Hardcoded thresholds** - Arbitrary normalization ranges broke with real data

### Real-World API Behavior (Validated)
- **Rate Limit**: ~60 requests/minute (hit this often)
- **Response Times**: 200-500ms per request
- **Failures**: Polymarket API returns 429 during peak hours
- **Data Gaps**: Missing data if job misses a run (no backfill by default)
- **Price Format**: All numbers as strings (need `parseFloat()`)

## Architecture Decision: Supabase Integration (Phase 1)

### Data Flow Architecture
```
┌──────────────────────────────────────────────┐
│         User Request                         │
│   GET /api/polymarket/markets?category=Sports│
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│      Next.js API Route Handler               │
│  1. Check DB: SELECT MAX(updated_at)         │
│  2. If stale (> 5 min): Trigger sync         │
│  3. Query Supabase with filters              │
│  4. Return JSON response                     │
└───────────────────┬──────────────────────────┘
                    │
            ┌───────┴────────┐
            │                │
    Sync Needed?         Query DB
            │                │
            ▼                ▼
┌────────────────────┐  ┌──────────────────┐
│  Sync Function     │  │  Supabase Query  │
│ 1. Acquire mutex   │  │  WHERE active    │
│ 2. Fetch Polymarket│  │  AND category    │
│ 3. Transform data  │  │  ORDER BY volume │
│ 4. Batch upsert    │  │  LIMIT 100       │
│ 5. Release mutex   │  └──────────────────┘
│ 6. Log sync        │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Polymarket API     │
│ (with retry logic) │
└────────────────────┘
          │
          ▼
┌────────────────────┐
│ Supabase Database  │
│ ├─ markets table   │
│ └─ sync_logs table │
└────────────────────┘
```

### Why Database Integration NOW (Critical Decision)

**✅ Benefits of Supabase in Phase 1:**
1. **Reduce API Calls**: Cache 1000 markets in DB → Hit Polymarket 12x/hour instead of 1000x/hour
2. **Rate Limit Safety**: 5-min sync = 120 API calls/hour (well under 60/min limit)
3. **Server-Side Filtering**: Use SQL `WHERE category = 'Sports'` (faster than client-side array filtering)
4. **Persistence**: Data survives app restarts, enables debugging and analytics
5. **Foundation for Phase 2**: Tables ready for `trades`, `prices_1m`, signals without migration

**✅ Keeps It Simple (Defers Complexity):**
- ❌ No cron jobs (old system problem: overlapping jobs)
- ❌ No table partitioning (deferred to Phase 2 when we have millions of trades)
- ❌ No materialized views (deferred to Phase 2 for wallet intelligence)
- ❌ No ClickHouse/R2 archiving (deferred to Phase 3 when >50M rows)
- ✅ Just 2 tables: `markets` + `sync_logs`

### Database Tables (Designed for Extensibility)

#### `markets` Table (Primary)
Stores current state of all Polymarket markets.

**Design Decisions:**
- ✅ Store raw JSON + parsed fields (debugging + query performance)
- ✅ Include placeholder columns for Phase 2 signals (avoid ALTER TABLE later)
- ✅ Use Postgres-native types (NUMERIC for prices, TIMESTAMPTZ for dates)
- ✅ Indexes cover all Market Screener query patterns
- ✅ UPSERT-friendly (PRIMARY KEY on market_id)

**Schema Preview** (database-architect will refine):
```sql
CREATE TABLE markets (
  market_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,

  -- Pricing (from Polymarket)
  current_price NUMERIC(18, 8),
  volume_24h NUMERIC(18, 2),
  volume_total NUMERIC(18, 2),
  liquidity NUMERIC(18, 2),

  -- Market metadata
  active BOOLEAN DEFAULT TRUE,
  closed BOOLEAN DEFAULT FALSE,
  end_date TIMESTAMPTZ,
  outcomes TEXT[],

  -- Placeholder columns for Phase 2 (NULL for now)
  momentum_score NUMERIC(5, 2),
  sii_score NUMERIC(5, 2),
  smart_money_delta NUMERIC(5, 4),

  -- Raw data for debugging
  raw_data JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `sync_logs` Table (Observability)
Tracks every sync attempt for monitoring and debugging.

**Design Decisions:**
- ✅ One row per sync operation
- ✅ Stores success/failure, error messages, row counts
- ✅ Enables alerting on repeated failures
- ✅ Foundation for analytics (sync frequency, API health)

**Schema Preview** (database-architect will refine):
```sql
CREATE TABLE sync_logs (
  id BIGSERIAL PRIMARY KEY,
  sync_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_completed_at TIMESTAMPTZ,
  status TEXT NOT NULL, -- 'success', 'partial', 'failed'
  markets_synced INTEGER,
  error_message TEXT,
  api_response_time_ms INTEGER
);
```

### Sync Strategy: On-Demand with Staleness Check

**How It Works:**
1. User requests `/api/polymarket/markets`
2. API route checks: `SELECT MAX(updated_at) FROM markets`
3. If `updated_at < NOW() - INTERVAL '5 minutes'` → Trigger sync
4. Sync acquires mutex (prevent concurrent syncs)
5. Fetch from Polymarket, batch upsert to Supabase
6. Return data from Supabase (fresh or slightly stale)

**Why 5 Minutes?**
- Proven by old system to balance freshness vs load
- 12 syncs/hour = 120 API calls/hour = 2 calls/min average (safe from 60/min limit)
- Polymarket market prices don't change every second (minutes/hours)

**Mutex Strategy:**
- Phase 1: Simple in-memory flag (works on single Vercel instance)
- Phase 2: Redis distributed lock (when we scale to multiple instances)

### Error Handling Strategy (Graceful Degradation)

**Scenario 1: Polymarket API Rate Limit (429)**
```typescript
// Exponential backoff: 1s, 2s, 4s, 8s
await retryWithBackoff(fetchMarkets, { maxRetries: 4, baseDelay: 1000 });
// If all retries fail: Return stale data from DB with { stale: true }
```

**Scenario 2: Polymarket API Timeout**
```typescript
// Single retry with 10s timeout
const markets = await fetchWithTimeout(polymarketAPI, 10000);
// If timeout: Return stale data from DB
```

**Scenario 3: Database Write Fails**
```typescript
// Log error, continue serving from Polymarket API
console.error('DB write failed:', error);
return { data: polymarketData, cached: false, error: 'DB unavailable' };
```

**Scenario 4: Concurrent Sync Attempts**
```typescript
// Second caller waits for existing sync or returns current data
if (syncInProgress) {
  return getMarketsFromDB(); // Return existing data
}
```

## Dependencies

### New Packages
- `@tanstack/react-query` - Server state management and caching
- `p-limit` - Control concurrency for parallel requests
- `@supabase/supabase-js` - Supabase client (already installed per tech-stack.md)

### External Services
- **Polymarket Gamma API** - Public REST API (no auth required for read)
  - Base URL: `https://gamma-api.polymarket.com`
  - Rate Limit: ~60 requests/minute
  - Authentication: None for public data
  - Known Issues: Returns 429 during high traffic, sometimes duplicate markets

- **Supabase (PostgreSQL 15+)** - Primary database
  - Already configured per `.env.local` and tech-stack.md
  - Free tier: 500MB database (sufficient for Phase 1: ~1000 markets × 5KB = 5MB)
  - Extensions enabled: `pg_trgm` (full-text search on market titles)

## Implementation Plan

### Phase 0: Database Setup (database-architect agent) - 1 hour
**Goal**: Design and create optimal Supabase schema for Polymarket data

**Responsibilities** (handled by database-architect agent):
1. **Refine Schema Design**
   - Optimize column types based on actual Polymarket API response
   - Determine exact precision for NUMERIC fields (prices, volumes)
   - Design indexes for optimal query performance
   - Add constraints (NOT NULL, CHECK constraints)

2. **Create Migration Script**
   - Generate production-ready SQL migration
   - Include indexes, constraints, triggers
   - Add `updated_at` trigger for automatic timestamp updates
   - Include rollback script

3. **Validate Against Query Patterns**
   - Ensure schema supports all Market Screener filters
   - Verify UPSERT performance (batch insert 500+ rows)
   - Test query performance with sample data
   - Document expected query plans

**Deliverables**:
- `/supabase/migrations/YYYYMMDD_create_polymarket_tables.sql`
- Schema documentation with query patterns
- Index justification and performance expectations

### Phase 1: Foundation (2-3 hours)
**Goal**: Set up robust API client with retry logic and Supabase integration

**Files**:
- Create `/types/polymarket.ts` - Core TypeScript interfaces (from old system)
- Create `/lib/polymarket/client.ts` - API client with retry + rate limit handling
- Create `/lib/polymarket/config.ts` - API configuration
- Create `/lib/polymarket/utils.ts` - Helper functions (batch, transform)
- Create `/lib/supabase/client.ts` - Supabase client wrapper
- Create `/lib/polymarket/sync.ts` - Sync orchestration logic
- Create `/app/api/polymarket/markets/route.ts` - Markets list endpoint with DB queries
- Create `/app/api/polymarket/sync/route.ts` - Manual sync trigger (for debugging)
- Update `.env.local` - Verify Supabase credentials

**Tasks**:
- ✅ Skip API research (we know it's `gamma-api.polymarket.com`)
- Test single market fetch with curl to verify API is still the same
- Implement fetch wrapper with:
  - Exponential backoff for 429 rate limits
  - Timeout handling (5 second max)
  - Proper error types (NetworkError, RateLimitError, etc.)
- Create TypeScript types (copy from old implementation manual)
- Build markets list API route with:
  - Pagination support (limit/offset)
  - Batch processing (500 markets at a time)
  - Parallel requests with concurrency limit (use `p-limit`)
- Add helper to transform Polymarket strings to numbers
- Manual test with Postman/browser

**Key Implementation Details** (from old system):
```typescript
// Retry with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && i < maxRetries - 1) {
        await sleep(1000 * Math.pow(2, i)); // 1s, 2s, 4s
        continue;
      }
      throw error;
    }
  }
}

// Batch processing pattern
for (const batch of chunk(markets, 500)) {
  await supabase
    .from('markets')
    .upsert(batch, { onConflict: 'market_id' });
}
```

**Estimated effort**: 2-3 hours

### Phase 2: React Integration (2-3 hours)
**Goal**: Connect React components to real data

**Files**:
- Install TanStack Query: `pnpm add @tanstack/react-query`
- Create `/lib/providers/query-provider.tsx` - React Query provider
- Create `/hooks/use-polymarket-markets.ts` - Markets list hook
- Update `/app/layout.tsx` - Wrap app in QueryProvider
- Update `/components/market-screener-interface/index.tsx` - Use real data

**Tasks**:
- Set up React Query provider
- Create custom hook for markets fetching
- Replace mock data generator with API call
- Add loading skeleton (already exists)
- Add error boundary/state
- Test data flow end-to-end

**Estimated effort**: 2-3 hours

### Phase 3: Market Detail & Caching (2-3 hours)
**Goal**: Add market detail page and optimize performance

**Files**:
- Create `/app/api/polymarket/markets/[id]/route.ts` - Single market endpoint
- Create `/hooks/use-polymarket-market-detail.ts` - Market detail hook
- Create `/lib/polymarket/cache.ts` - Simple in-memory cache
- Update `/components/event-detail/index.tsx` - Use real market data
- Update `/app/(dashboard)/events/[slug]/page.tsx` - Connect to API

**Tasks**:
- Implement market detail API route
- Add server-side caching (30s TTL)
- Create React hook for market detail
- Update Event Detail component
- Add auto-refresh logic
- Test navigation from screener to detail

**Estimated effort**: 2-3 hours

### Phase 4: Polish & Error Handling (1-2 hours)
**Goal**: Production-ready error handling and UX

**Tasks**:
- Add comprehensive error states
- Implement retry logic with exponential backoff
- Add rate limiting detection
- Create error toast notifications
- Add data refresh indicators
- Test error scenarios
- Add loading states for all async operations
- Document API usage in code comments

**Estimated effort**: 1-2 hours

## Task Breakdown

### Backend Tasks
- [ ] Test Polymarket Gamma API with curl (`curl https://gamma-api.polymarket.com/markets`)
- [ ] Create TypeScript types in `/types/polymarket.ts` (use structure from old system)
- [ ] Build API client library in `/lib/polymarket/client.ts` with:
  - [ ] Exponential backoff retry logic for 429 errors
  - [ ] 5-second timeout on requests
  - [ ] Proper error classes (RateLimitError, TimeoutError, etc.)
- [ ] Create utility functions in `/lib/polymarket/utils.ts`:
  - [ ] `transformPolymarketMarket()` - Convert strings to numbers
  - [ ] `chunk()` - Split arrays into batches
  - [ ] `sleep()` - Promise-based delay
- [ ] Add API configuration in `/lib/polymarket/config.ts`
- [ ] Create markets list endpoint `/app/api/polymarket/markets/route.ts` with:
  - [ ] Pagination (limit/offset query params)
  - [ ] Filtering (category, active status)
  - [ ] Proper error responses
- [ ] Create market detail endpoint `/app/api/polymarket/markets/[id]/route.ts`
- [ ] Implement server-side caching in `/lib/polymarket/cache.ts` (30s TTL)
- [ ] Install `p-limit` for concurrency control (`pnpm add p-limit`)
- [ ] Test all API routes with real Polymarket data

### Frontend Tasks
- [ ] Install `@tanstack/react-query` package
- [ ] Create React Query provider in `/lib/providers/query-provider.tsx`
- [ ] Wrap app with QueryProvider in `/app/layout.tsx`
- [ ] Create `use-polymarket-markets` hook
- [ ] Create `use-polymarket-market-detail` hook
- [ ] Update Market Screener to use real data
- [ ] Update Event Detail to use real data
- [ ] Add loading states (skeletons)
- [ ] Add error states with retry buttons
- [ ] Implement auto-refresh for live data

### Integration Tasks
- [ ] Connect Market Screener component to markets API
- [ ] Connect Event Detail component to market detail API
- [ ] Add error handling throughout data flow
- [ ] Implement retry logic for failed requests
- [ ] Add toast notifications for errors
- [ ] Test full user flow from screener to detail
- [ ] Verify data transformations are correct
- [ ] Test filtering and sorting with real data

### Testing Tasks
- [ ] Test happy path: screener loads markets
- [ ] Test happy path: clicking market shows detail
- [ ] Test error: network offline
- [ ] Test error: invalid market ID
- [ ] Test error: API rate limit
- [ ] Test edge case: empty markets list
- [ ] Test edge case: very long market title
- [ ] Test performance: 100+ markets rendering
- [ ] Verify caching works (network tab)
- [ ] Test auto-refresh functionality

## Testing Strategy

### Unit Tests
- Test `transformPolymarketMarket()` type conversion
- Test API client error handling
- Test cache TTL logic

### Integration Tests
- Test full flow: API route → React hook → Component
- Test error recovery and retry logic
- Test caching behavior

### Manual Testing Checklist
- [ ] Markets load on screener page
- [ ] Clicking market navigates to detail
- [ ] Detail page shows accurate data
- [ ] Prices update automatically
- [ ] Network errors show appropriate UI
- [ ] Retry button works after error
- [ ] Loading states appear during fetch
- [ ] No console errors in browser
- [ ] API routes return correct response format
- [ ] Environment variables load correctly

## Rollout Plan

### Development
1. Create feature branch: `feature/polymarket-integration`
2. Implement Phase 1 (Foundation)
3. Test API routes manually
4. Implement Phase 2 (React Integration)
5. Test in development mode
6. Implement Phase 3 (Detail & Caching)
7. Implement Phase 4 (Polish)
8. Final testing
9. Create PR for review

### Staging
1. Deploy to Vercel preview deployment
2. Verify environment variables are set
3. Test all user flows on preview URL
4. Check API rate limits with real usage
5. Monitor performance and errors
6. Get stakeholder approval

### Production
1. Merge to main branch
2. Auto-deploy via Vercel
3. Monitor error logs (Vercel dashboard)
4. Watch API usage and rate limits
5. Gather user feedback
6. Plan Phase 2 enhancements

## Success Metrics
- **Data Accuracy** - Market prices match Polymarket.com (manual verification)
- **Performance** - Markets list loads in < 2 seconds
- **Reliability** - < 1% error rate on API calls
- **User Engagement** - Users spend more time on screener (vs mock data)
- **API Efficiency** - < 500 API calls per day (via caching)

## Risks & Mitigations

- **Risk**: Polymarket API changes or breaks
  - **Mitigation**: Abstract API client behind interface, fall back to mock data with warning banner

- **Risk**: Rate limiting limits functionality
  - **Mitigation**: Implement aggressive caching, queue requests, show cached data with staleness indicator

- **Risk**: API requires authentication we don't have
  - **Mitigation**: Research API access before Phase 1, apply for API key if needed

- **Risk**: Response times are too slow
  - **Mitigation**: Server-side caching, background data fetching, show stale data while refreshing

- **Risk**: Real data structure doesn't match our UI assumptions
  - **Mitigation**: Implement Phase 1 first to validate data structure, adjust UI in Phase 2 as needed

- **Risk**: Breaking changes during development
  - **Mitigation**: Use TypeScript strictly, write tests, version API client

## Open Questions

### Answered (from old system)
- ✅ **Auth required?** No, public endpoints work without API key
- ✅ **Rate limits?** ~60 requests/minute, returns 429 when exceeded
- ✅ **WebSocket?** No real-time API available (as of old implementation)
- ✅ **Market slug format?** Stored in `market_slug` field, use for URLs
- ✅ **CORS?** Call from Next.js API routes (server-side), no CORS issues
- ✅ **Polling interval?** 30s for markets list, 10s for detail pages worked well

### Still Need to Verify
- [ ] Has Polymarket API changed since old implementation? (Quick curl test)
- [ ] Is there now a WebSocket API? (Check latest docs)
- [ ] Should we implement database caching (Supabase) or stick to in-memory?
- [ ] Do we want to track historical data (prices_1m table) or just current state?
- [ ] Should we build trade ingestion now or defer to Phase 2?

## References
- Polymarket Gamma API: `https://gamma-api.polymarket.com`
- TanStack Query Docs: https://tanstack.com/query/latest
- Next.js API Routes: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- Old implementation manual: `.agent-os/product/IMPLEMENTATION_OPERATIONS_MANUAL.md`
- Current mock data: `/app/api/whale/positions/route.ts`
- p-limit (concurrency): https://github.com/sindresorhus/p-limit

## Key Improvements Over Old System

### What We're Doing Better
1. **Pagination from Day 1** - Old system returned 1000+ markets, we'll use limit/offset
2. **Retry Logic Built-In** - Exponential backoff for rate limits (old system crashed on 429)
3. **Concurrency Control** - Use `p-limit` to avoid overwhelming API (old system didn't)
4. **Better Error Handling** - Specific error types, individual market failures won't kill batch
5. **TypeScript Strict Mode** - No ignored errors in production (old system did this!)
6. **Proper Caching Strategy** - TanStack Query with proper cache keys (old system had cache bugs)

### What We're Keeping
1. **Next.js API Proxy Pattern** - Still the best way to hide API details from client
2. **Batch Processing** - 500 items at a time prevents timeouts
3. **UPSERT Pattern** - Prevents duplicates on re-runs
4. **Parallel Execution** - `Promise.all()` for independent operations
5. **30s/10s Polling** - Validated polling intervals that balance freshness and load

### What We're Deferring
1. **Database Storage** - Start with in-memory cache, add Supabase later if needed
2. **Trade Ingestion** - Focus on markets first, add trades in Phase 2
3. **Historical Data** - No `prices_1m` table yet, current data only
4. **Cron Jobs** - Manual refresh for MVP, schedule later

## Next Steps After Implementation
1. Add more market filters (date range, volume threshold)
2. Implement WebSocket for real-time updates (if available)
3. Add historical price charts (requires database)
4. Integrate order book data
5. Add user wallet tracking (Phase 2 feature)
6. Persist favorite markets to Supabase
7. Add analytics tracking for market views
8. Build trade ingestion pipeline
9. Implement smart money delta calculations
10. Add signal generation on top of market data
