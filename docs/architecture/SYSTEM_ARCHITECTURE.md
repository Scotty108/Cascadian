# CASCADIAN - System Architecture Documentation

**Version**: 2.0
**Last Updated**: 2025-10-23
**Platform**: Polymarket Prediction Market Intelligence Terminal

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [System Components](#system-components)
3. [Data Flow Architecture](#data-flow-architecture)
4. [Database Design](#database-design)
5. [API Architecture](#api-architecture)
6. [Frontend Architecture](#frontend-architecture)
7. [Workflow Execution Engine](#workflow-execution-engine)
8. [Caching & Performance](#caching--performance)
9. [Security Architecture](#security-architecture)
10. [Deployment Architecture](#deployment-architecture)
11. [Scalability Considerations](#scalability-considerations)

---

## Architecture Overview

### System Type
CASCADIAN is a **3-tier web application** with serverless API architecture:

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT TIER                          │
│  Next.js React App (SSR/CSR Hybrid)                    │
│  • TanStack Query for state management                 │
│  • ReactFlow for workflow visualization                │
│  • shadcn/ui + Radix UI components                     │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTPS/JSON
┌──────────────────┴──────────────────────────────────────┐
│                  APPLICATION TIER                        │
│  Next.js API Routes (Vercel Serverless Functions)      │
│  • Polymarket integration layer                        │
│  • Workflow execution engine                           │
│  • AI/LLM integration                                   │
│  • Business logic & data transformation                │
└──────────────────┬──────────────────────────────────────┘
                   │ REST/PostgreSQL Protocol
┌──────────────────┴──────────────────────────────────────┐
│                    DATA TIER                             │
│  Supabase (PostgreSQL 15+)                             │
│  • Markets, analytics, wallets, workflows              │
│  • Row-Level Security (RLS)                            │
│  • Real-time subscriptions                             │
│  • Full-text search indexes                            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              EXTERNAL SERVICES                          │
│  • Polymarket APIs (Gamma, CLOB, Data)                 │
│  • OpenAI GPT-4 (market analysis)                       │
│  • Anthropic Claude (strategy copilot)                  │
│  • Google Gemini (multimodal AI)                        │
└─────────────────────────────────────────────────────────┘
```

### Design Principles

1. **API-First Design** - All data access through well-defined REST endpoints
2. **Separation of Concerns** - Clear boundaries between data, business logic, and presentation
3. **Stateless Services** - API routes are stateless; state lives in database or client
4. **Optimistic UI** - React Query optimistic updates for instant feedback
5. **Graceful Degradation** - Return stale data if external APIs fail
6. **Progressive Enhancement** - Core features work without JavaScript

---

## System Components

### 1. Frontend Layer (Next.js Client)

**Technology**: Next.js 15.3.4 (App Router) + React 19.1.0

**Key Responsibilities**:
- Server-side rendering (SSR) for SEO and initial load
- Client-side rendering (CSR) for interactivity
- State management (React Query + React Context)
- UI rendering (React components)
- Real-time updates (React Query polling)
- Workflow visualization (ReactFlow canvas)

**Component Organization**:
```
/app
├── (dashboard)          # Protected routes with sidebar layout
│   ├── discovery/       # Market screening & whale tracking
│   ├── events/          # Event browsing
│   ├── analysis/        # Advanced analytics
│   ├── strategy-builder/ # Workflow editor
│   └── [other routes]/
├── (auth)              # Authentication pages
└── api/                # Backend API routes

/components
├── ui/                 # Base UI components (40+)
├── [feature]/          # Feature-specific components
└── workflow-editor/    # Workflow tools
```

**State Management Strategy**:
- **Server State**: TanStack Query (React Query) with 5-minute stale time
- **UI State**: React Context (theme, toasts, modals)
- **URL State**: Search params (filters, pagination)
- **Local State**: React useState/useReducer

---

### 2. API Layer (Next.js API Routes)

**Technology**: Next.js Serverless Functions on Vercel

**Key Responsibilities**:
- External API integration (Polymarket)
- Business logic execution
- Data transformation and validation
- Authentication & authorization
- Workflow execution orchestration
- Real-time streaming (Server-Sent Events)

**API Route Organization**:
```
/app/api/
├── polymarket/              # Polymarket integration
│   ├── markets/             # Market data
│   ├── events/              # Event data
│   ├── wallet/[address]/    # Wallet analytics
│   ├── holders/             # Holder rankings
│   ├── ohlc/               # Price history
│   ├── order-book/         # Order book
│   └── sync/               # Background sync
├── whale/                   # Whale intelligence
│   ├── positions/
│   ├── trades/
│   ├── flows/
│   ├── flips/
│   ├── scoreboard/
│   └── concentration/
├── insiders/               # Insider signals
├── execute-workflow/       # Workflow execution (streaming)
├── ai/                     # AI integration
│   └── conversational-build/ # Strategy copilot
├── admin/                  # Admin operations
└── cron/                   # Scheduled tasks
```

**Execution Model**:
- Stateless, auto-scaling serverless functions
- 10-second timeout limit (Vercel default)
- Streaming responses for long operations (SSE)
- Environment-based configuration

---

### 3. Data Layer (Supabase PostgreSQL)

**Technology**: Supabase (managed PostgreSQL 15+)

**Key Responsibilities**:
- Persistent data storage
- Real-time subscriptions
- Row-Level Security (RLS)
- Full-text search
- Geospatial queries (future)

**Schema Organization**:
```sql
-- Market Intelligence
markets                    # Polymarket market metadata
market_analytics          # Trade analytics (Phase 2)
prices_1m                 # OHLC price history

-- Wallet Intelligence
wallets                   # Discovered wallet profiles
wallet_positions          # Current holdings
wallet_trades            # Historical trades

-- Workflow System
workflow_sessions         # Saved workflow definitions
workflow_executions       # Execution history

-- User Management
users                     # Supabase Auth users
user_settings            # User preferences
```

---

### 4. External Service Integration

**Polymarket APIs**:
- **Gamma API** - Market metadata, events (`https://gamma-api.polymarket.com`)
- **CLOB API** - Order books, trade history (`https://clob.polymarket.com`)
- **Data API** - Wallets, positions, holders (`https://data-api.polymarket.com`)

**AI Services**:
- **OpenAI GPT-4** - Market analysis, sentiment scoring
- **Anthropic Claude** - Conversational strategy builder
- **Google Gemini** - Multimodal analysis, image generation

**Integration Pattern**:
```typescript
// Retry with exponential backoff
const polymarketClient = new PolymarketClient({
  baseURL: 'https://gamma-api.polymarket.com',
  timeout: 10000,
  retries: 4,
  retryDelay: (attempt) => Math.pow(2, attempt) * 1000
})

// Graceful degradation
try {
  const data = await polymarketClient.getMarkets()
  return data
} catch (error) {
  if (isNetworkError(error)) {
    // Return stale DB data
    return await getMarketsFromDB()
  }
  throw error
}
```

---

## Data Flow Architecture

### 1. Market Data Sync Flow

```
┌─────────────────────────────────────────────────────────┐
│ STEP 1: Scheduled Trigger (Every 5 minutes)            │
│  Vercel Cron → POST /api/polymarket/sync               │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ STEP 2: Fetch Events from Polymarket                   │
│  GET https://gamma-api.polymarket.com/events            │
│  • Paginated (100 events/page, max 1000)               │
│  • Extract nested markets                              │
│  • Category extraction from tags                       │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ STEP 3: Data Transformation                            │
│  • Parse JSON strings (outcomes, prices)               │
│  • Convert types (string → number)                     │
│  • Validate constraints (end_date, volume)             │
│  • Deduplicate by market_id                           │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ STEP 4: Database UPSERT                                │
│  • Batch size: 500 markets                             │
│  • ON CONFLICT (market_id) DO UPDATE                  │
│  • Mutex lock prevents concurrent syncs               │
│  • Log success/failure to sync_logs                   │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ STEP 5: Client Cache Invalidation                      │
│  • React Query detects DB changes (polling)            │
│  • Automatic refetch on window focus                   │
│  • UI updates with new data                            │
└─────────────────────────────────────────────────────────┘
```

**Sync Performance**:
- Events fetch: ~1 second (5 pages × 200ms)
- Market transformation: ~500ms (1000+ markets)
- Batch UPSERT: ~2 seconds (2 batches × 1 second)
- **Total sync time**: 8-10 seconds

---

### 2. User Query Flow (Market Screener)

```
┌─────────────────────────────────────────────────────────┐
│ USER ACTION: Apply filters in screener UI               │
│  Category: Sports, Volume > $10K, Active: true         │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ REACT QUERY: usePolymarketMarkets() hook               │
│  • Check cache (5-minute stale time)                   │
│  • If stale → fetch from API                          │
│  • If fresh → return cached data                       │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ API ROUTE: GET /api/polymarket/markets                 │
│  ?category=Sports&volume_min=10000&active=true         │
│  • Validate query params (Zod schema)                  │
│  • Check DB staleness (> 5 min?)                       │
│  • Trigger background sync if stale (non-blocking)     │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ DATABASE QUERY: Supabase query builder                │
│  SELECT * FROM markets                                  │
│  WHERE category = 'Sports'                             │
│    AND volume_24h >= 10000                             │
│    AND active = true                                    │
│  ORDER BY volume_24h DESC                              │
│  LIMIT 100 OFFSET 0                                     │
│  • Uses idx_markets_category_volume (indexed)          │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ RESPONSE TRANSFORMATION                                │
│  • Join with market_analytics (if requested)           │
│  • Format currency values                              │
│  • Add metadata (total count, page, limit)             │
│  • Return JSON response                                │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ UI RENDER: TanStack Table component                    │
│  • Virtual scrolling for performance                   │
│  • Client-side sorting/filtering                       │
│  • Pagination controls                                  │
└─────────────────────────────────────────────────────────┘
```

**Query Performance**:
- Cache hit: < 1ms
- Cache miss + DB query: 50-150ms (p50)
- With analytics join: 100-250ms

---

### 3. Workflow Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│ USER ACTION: Click "Run" on workflow                   │
│  Workflow: [Start] → [Stream Markets] → [Filter] →    │
│            [LLM Analysis] → [End]                      │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ FRONTEND: Collect nodes & edges                        │
│  const workflow = { nodes, edges, variables }          │
│  POST /api/execute-workflow (streaming SSE)            │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ EXECUTOR: Topological sort                             │
│  • Build dependency graph                              │
│  • Detect cycles (error if found)                      │
│  • Determine execution order                           │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ NODE EXECUTION: Sequential execution                   │
│                                                          │
│  Node 1: Start                                          │
│   → Stream: { status: 'running', nodeId: 'start' }     │
│   → Execute: Return {} (no-op)                         │
│   → Stream: { status: 'success', output: {} }          │
│                                                          │
│  Node 2: Stream Markets                                │
│   → Stream: { status: 'running', nodeId: 'stream' }    │
│   → Execute: GET /api/polymarket/markets?limit=10      │
│   → Stream: { status: 'success', output: [markets] }   │
│                                                          │
│  Node 3: Filter (volume > $5K)                         │
│   → Stream: { status: 'running', nodeId: 'filter' }    │
│   → Execute: markets.filter(m => m.volume > 5000)      │
│   → Stream: { status: 'success', output: [filtered] }  │
│                                                          │
│  Node 4: LLM Analysis                                   │
│   → Stream: { status: 'running', nodeId: 'llm' }       │
│   → Execute: Call OpenAI with prompt + market data    │
│   → Stream: { status: 'success', output: analysis }    │
│                                                          │
│  Node 5: End                                            │
│   → Stream: { status: 'success', nodeId: 'end' }       │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ FRONTEND: Real-time UI updates                         │
│  • Update node status indicators                       │
│  • Display execution logs                              │
│  • Show output data per node                           │
│  • Final result displayed on End node                   │
└─────────────────────────────────────────────────────────┘
```

**Streaming Protocol**:
```typescript
// Server-Sent Events (SSE) format
res.write(`data: ${JSON.stringify({
  type: 'node_status',
  nodeId: 'stream-markets',
  status: 'running',
  timestamp: Date.now()
})}\n\n`)

res.write(`data: ${JSON.stringify({
  type: 'node_output',
  nodeId: 'stream-markets',
  status: 'success',
  output: markets,
  timestamp: Date.now()
})}\n\n`)
```

---

### 4. Whale Intelligence Flow

```
┌─────────────────────────────────────────────────────────┐
│ DATA COLLECTION: Polymarket Data API                   │
│  GET /holders?market={conditionId}&limit=100            │
│  • Returns top 100 holders per market                  │
│  • YES holders + NO holders                            │
│  • Position sizes, entry prices                        │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ WHALE DETECTION: Scoring algorithm                     │
│                                                          │
│  Whale Score = f(position_size, consistency)           │
│  • position_size > $10,000 → is_whale = true           │
│  • Track across multiple markets                       │
│                                                          │
│  Smart Money Score = f(win_rate, sharpe_ratio)         │
│  • Calculate from closed positions                     │
│  • Weight recent trades higher                         │
│                                                          │
│  Reputation Score = f(track_record, longevity)         │
│  • Historical performance                              │
│  • Time since first trade                              │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ DATABASE STORAGE                                        │
│  INSERT INTO wallets (address, whale_score, ...)       │
│  INSERT INTO wallet_positions (...)                    │
│  INSERT INTO wallet_trades (...)                       │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│ WHALE INTELLIGENCE ENDPOINTS                           │
│  GET /api/whale/positions    # Large positions         │
│  GET /api/whale/trades       # Whale activity          │
│  GET /api/whale/flows        # Smart money flows       │
│  GET /api/whale/flips        # Position reversals      │
│  GET /api/whale/scoreboard   # Leaderboard rankings    │
└─────────────────────────────────────────────────────────┘
```

---

## Database Design

### Entity-Relationship Diagram

```
┌──────────────────────┐
│      markets         │
├──────────────────────┤
│ PK market_id         │◄──────────┐
│    title             │           │
│    category          │           │
│    volume_24h        │           │
│    liquidity         │           │
│    current_price     │           │
│    active, closed    │           │
└──────────────────────┘           │
         △                         │
         │ 1:1                    │
         │                         │
┌──────────────────────┐           │
│  market_analytics    │           │
├──────────────────────┤           │
│ PK market_id         │───────────┘
│    trades_24h        │
│    buy_volume_24h    │
│    sell_volume_24h   │
│    momentum_score    │
└──────────────────────┘

┌──────────────────────┐
│      wallets         │
├──────────────────────┤
│ PK address           │◄──────────┐
│    whale_score       │           │
│    smart_money_score │           │
│    reputation_score  │           │
└──────────────────────┘           │
         △                         │
         │ 1:N                    │
         │                         │
┌──────────────────────┐           │
│  wallet_positions    │           │
├──────────────────────┤           │
│ PK id                │           │
│ FK wallet_address    │───────────┘
│ FK market_id         │───────────┐
│    shares            │           │
│    entry_price       │           │
│    unrealized_pnl    │           │
└──────────────────────┘           │
                                   │
┌──────────────────────┐           │
│   wallet_trades      │           │
├──────────────────────┤           │
│ PK id                │           │
│ FK wallet_address    │───────────┤
│ FK market_id         │───────────┘
│    outcome           │
│    side (buy/sell)   │
│    amount, price     │
│    timestamp         │
└──────────────────────┘

┌──────────────────────┐
│  workflow_sessions   │
├──────────────────────┤
│ PK id (UUID)         │◄──────────┐
│ FK user_id           │           │
│    name, description │           │
│    nodes (JSONB)     │           │
│    edges (JSONB)     │           │
│    version           │           │
│    status            │           │
└──────────────────────┘           │
         △                         │
         │ 1:N                    │
         │                         │
┌──────────────────────┐           │
│ workflow_executions  │           │
├──────────────────────┤           │
│ PK id (UUID)         │           │
│ FK workflow_id       │───────────┘
│    status            │
│    outputs (JSONB)   │
│    errors (JSONB)    │
│    duration_ms       │
└──────────────────────┘
```

### Index Strategy

**Performance Indexes**:
```sql
-- Markets table
CREATE INDEX idx_markets_active ON markets (active) WHERE active = true;
CREATE INDEX idx_markets_category ON markets (category) WHERE active = true;
CREATE INDEX idx_markets_volume_24h ON markets (volume_24h DESC) WHERE active = true;
CREATE INDEX idx_markets_category_volume ON markets (category, volume_24h DESC);
CREATE INDEX idx_markets_end_date ON markets (end_date ASC) WHERE active = true;

-- Full-text search
CREATE INDEX idx_markets_title_trgm ON markets USING gin (title gin_trgm_ops);

-- JSONB indexing
CREATE INDEX idx_markets_raw_data_gin ON markets USING gin (raw_polymarket_data);

-- Wallet positions
CREATE INDEX idx_wallet_positions_address ON wallet_positions (wallet_address);
CREATE INDEX idx_wallet_positions_market ON wallet_positions (market_id);
CREATE INDEX idx_wallet_positions_composite ON wallet_positions (wallet_address, market_id);

-- Wallet trades
CREATE INDEX idx_wallet_trades_address ON wallet_trades (wallet_address);
CREATE INDEX idx_wallet_trades_timestamp ON wallet_trades (timestamp DESC);
```

**Rationale**:
- Partial indexes on `active=true` reduce index size by ~50%
- Composite indexes (category + volume) avoid multiple index scans
- GIN indexes for fuzzy search (pg_trgm) and JSONB queries
- DESC indexes on volume/timestamp for common sort orders

---

## API Architecture

### RESTful Endpoint Design

**Naming Convention**:
- Collection: `/api/resource` (plural)
- Single resource: `/api/resource/{id}`
- Sub-resources: `/api/resource/{id}/sub-resource`
- Actions: `/api/resource/action` (POST)

**HTTP Methods**:
- `GET` - Read data (idempotent)
- `POST` - Create or execute actions (non-idempotent)
- `PUT` - Full update (idempotent)
- `PATCH` - Partial update (idempotent)
- `DELETE` - Remove resource (idempotent)

**Response Format**:
```typescript
// Success response
{
  success: true,
  data: T,                // Actual data payload
  metadata?: {            // Optional metadata
    total: number,
    page: number,
    limit: number,
    stale: boolean,
    last_synced: string
  }
}

// Error response
{
  success: false,
  error: {
    code: string,         // Machine-readable error code
    message: string,      // Human-readable error message
    details?: any         // Additional error context
  }
}
```

### API Endpoint Catalog

**Market Intelligence** (10 endpoints):
```
GET  /api/polymarket/markets               # List markets with filters
GET  /api/polymarket/markets/[id]          # Single market detail
GET  /api/polymarket/events                # List events
GET  /api/polymarket/events/[slug]         # Single event detail
GET  /api/polymarket/events/related        # Related markets
GET  /api/polymarket/ohlc/[marketId]       # OHLC price history
GET  /api/polymarket/order-book/[marketId] # Live order book
GET  /api/polymarket/holders               # Market holder rankings
POST /api/polymarket/sync                  # Trigger manual sync
GET  /api/polymarket/sync                  # Get sync status
```

**Wallet Analytics** (5 endpoints):
```
GET /api/polymarket/wallet/[address]/positions        # Open positions
GET /api/polymarket/wallet/[address]/closed-positions # Historical
GET /api/polymarket/wallet/[address]/trades          # Trade history
GET /api/polymarket/wallet/[address]/value           # Portfolio value
GET /api/polymarket/wallet/[address]/activity        # Activity log
```

**Whale Intelligence** (6 endpoints):
```
GET /api/whale/positions      # Large positions (whales)
GET /api/whale/trades         # Whale trading activity
GET /api/whale/flows          # Smart money flows
GET /api/whale/flips          # Position reversals
GET /api/whale/concentration  # Market concentration metrics
GET /api/whale/scoreboard     # Whale rankings
```

**Insider Signals** (2 endpoints):
```
GET /api/insiders/markets  # Markets with insider activity
GET /api/insiders/wallets  # Insider wallet profiles
```

**Workflow Execution** (2 endpoints):
```
POST /api/execute-workflow              # Execute workflow (streaming SSE)
POST /api/ai/conversational-build       # AI copilot chat
```

**Admin Operations** (2 endpoints):
```
POST /api/admin/ingest              # Manual data ingestion
POST /api/admin/apply-migration     # Database migrations
```

**Scheduled Jobs** (1 endpoint):
```
GET /api/cron/refresh-wallets      # Scheduled wallet refresh
```

---

## Frontend Architecture

### Component Hierarchy

```
App (RootLayout)
├── QueryClientProvider (TanStack Query)
├── ThemeProvider (next-themes)
└── DashboardLayout
    ├── Sidebar (Navigation)
    ├── Topbar (User menu, search)
    └── Page Content
        ├── MarketScreener (TanStack Table)
        │   ├── FilterBar
        │   ├── DataTable (virtual scrolling)
        │   └── Pagination
        ├── MarketDetailView
        │   ├── PriceChart (ECharts)
        │   ├── OrderBook
        │   ├── HolderRankings
        │   └── RelatedMarkets
        ├── StrategyBuilder (ReactFlow)
        │   ├── WorkflowCanvas
        │   ├── NodePalette
        │   ├── NodeConfigPanel
        │   └── ExecutionLogs
        └── WalletDetailView
            ├── PositionTable
            ├── TradeHistory
            ├── PerformanceCharts
            └── ActivityTimeline
```

### Rendering Strategy

**Server-Side Rendering (SSR)**:
- Initial page load for SEO
- Static metadata (title, description, OG tags)
- Public pages (landing, docs)

**Client-Side Rendering (CSR)**:
- Interactive components (screener, workflow builder)
- Real-time data updates
- Optimistic UI updates

**Incremental Static Regeneration (ISR)** (Future):
- Market detail pages (revalidate every 60 seconds)
- Event pages (revalidate every 5 minutes)

### Code Splitting Strategy

```typescript
// Route-based splitting (automatic with Next.js App Router)
// Each page.tsx is a separate chunk

// Component-based splitting (manual)
const StrategyBuilder = dynamic(
  () => import('@/components/strategy-builder'),
  { ssr: false, loading: () => <LoadingSkeleton /> }
)

const MarketDetailChart = dynamic(
  () => import('@/components/market-detail-interface/PriceChart'),
  { ssr: false }
)
```

---

## Workflow Execution Engine

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  WORKFLOW EXECUTOR                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Parse & Validate                                    │
│     • Validate nodes & edges (Zod schema)              │
│     • Check for required fields                         │
│     • Detect invalid node types                         │
│                                                          │
│  2. Build Dependency Graph                              │
│     • Topological sort                                  │
│     • Detect cycles → throw error                       │
│     • Determine execution order                         │
│                                                          │
│  3. Execute Nodes Sequentially                          │
│     For each node in order:                             │
│       • Stream status: 'running'                        │
│       • Get node executor (by type)                     │
│       • Execute with inputs from previous nodes         │
│       • Handle errors (try/catch)                       │
│       • Stream output or error                          │
│                                                          │
│  4. Aggregate Results                                   │
│     • Collect all node outputs                          │
│     • Calculate total duration                          │
│     • Log execution to database                         │
│     • Stream final status                               │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Node Executor Interface

```typescript
interface NodeExecutor {
  type: string
  execute(
    node: WorkflowNode,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any>
}

// Example: Polymarket Stream Node
class PolymarketStreamExecutor implements NodeExecutor {
  type = 'polymarket-stream'

  async execute(node, inputs, context) {
    const { filters, limit } = node.config
    const markets = await fetchMarkets(filters, limit)
    return { markets }
  }
}

// Example: LLM Analysis Node
class LLMAnalysisExecutor implements NodeExecutor {
  type = 'llm-analysis'

  async execute(node, inputs, context) {
    const { prompt, model } = node.config
    const inputData = inputs['input'] // from previous node
    const analysis = await callLLM(model, prompt, inputData)
    return { analysis }
  }
}
```

### Execution Context

```typescript
interface ExecutionContext {
  workflowId: string
  userId: string
  variables: Record<string, any>  // User-defined variables
  stream: (event: ExecutionEvent) => void  // SSE stream
  abort: AbortSignal  // For cancellation
}
```

---

## Caching & Performance

### Multi-Layer Caching Strategy

```
┌─────────────────────────────────────────────────────────┐
│ LAYER 1: Browser Cache (React Query)                   │
│  • Stale time: 5 minutes (markets), 30 seconds (wallets) │
│  • Automatic refetch on window focus                   │
│  • Optimistic updates on mutations                     │
│  • Request deduplication                                │
└─────────────────────────────────────────────────────────┘
         ▼ Cache miss or stale
┌─────────────────────────────────────────────────────────┐
│ LAYER 2: API Response Cache (In-memory, Future: Redis) │
│  • In-flight request deduplication                     │
│  • 1-minute cache for expensive queries                │
│  • Shared across all users                             │
└─────────────────────────────────────────────────────────┘
         ▼ Cache miss
┌─────────────────────────────────────────────────────────┐
│ LAYER 3: Database Query Cache (PostgreSQL)             │
│  • Indexed queries (< 100ms)                           │
│  • Materialized views (future)                         │
│  • Connection pooling (Supabase)                       │
└─────────────────────────────────────────────────────────┘
         ▼ Data not fresh (> 5 min)
┌─────────────────────────────────────────────────────────┐
│ LAYER 4: External API (Polymarket)                     │
│  • Background sync every 5 minutes                      │
│  • Rate limiting: 100 req/min                          │
│  • Retry with exponential backoff                      │
└─────────────────────────────────────────────────────────┘
```

### Performance Benchmarks

| Operation | Target | Current | Optimization |
|-----------|--------|---------|--------------|
| Market screener query | < 150ms | 120ms | Indexed |
| Market detail load | < 200ms | 180ms | Joined query |
| Workflow execution | Variable | N/A | Streaming |
| Full market sync | < 15s | 8-10s | Batched UPSERT |
| Wallet position load | < 100ms | 80ms | Indexed |
| OHLC chart data | < 300ms | 250ms | Pagination |

---

## Security Architecture

### Authentication Flow (Supabase Auth)

```
1. User signs in with email/password
   ↓
2. Supabase Auth validates credentials
   ↓
3. Return JWT access token + refresh token
   ↓
4. Client stores tokens in localStorage (httpOnly in future)
   ↓
5. Client includes token in Authorization header
   ↓
6. API routes validate token with Supabase
   ↓
7. Extract user_id from JWT payload
   ↓
8. Execute query with RLS (user_id filter)
```

### Row-Level Security (RLS) Policies

```sql
-- Users can only read their own workflows
CREATE POLICY "Users can read own workflows"
ON workflow_sessions FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own workflows
CREATE POLICY "Users can insert own workflows"
ON workflow_sessions FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own workflows
CREATE POLICY "Users can update own workflows"
ON workflow_sessions FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own workflows
CREATE POLICY "Users can delete own workflows"
ON workflow_sessions FOR DELETE
USING (auth.uid() = user_id);

-- Public read for market data
CREATE POLICY "Anyone can read markets"
ON markets FOR SELECT
TO anon, authenticated
USING (true);

-- Only service role can write market data
CREATE POLICY "Only service role can write markets"
ON markets FOR ALL
TO service_role
USING (true);
```

### API Security Measures

**Input Validation**:
```typescript
import { z } from 'zod'

const MarketQuerySchema = z.object({
  category: z.enum(['Politics', 'Sports', 'Crypto', 'Finance']).optional(),
  active: z.boolean().optional(),
  limit: z.number().min(1).max(1000).default(100),
  offset: z.number().min(0).default(0)
})

// In API route
const params = MarketQuerySchema.parse(req.query)
```

**Rate Limiting** (Future - Upstash Rate Limit):
```typescript
import { Ratelimit } from '@upstash/ratelimit'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, '1 m') // 100 requests per minute
})

const { success } = await ratelimit.limit(req.ip)
if (!success) {
  return res.status(429).json({ error: 'Rate limit exceeded' })
}
```

---

## Deployment Architecture

### Vercel Deployment

```
┌─────────────────────────────────────────────────────────┐
│                     VERCEL EDGE                          │
│  • CDN (Cloudflare)                                     │
│  • DDoS protection                                      │
│  • HTTPS/TLS termination                                │
│  • Geo-routing                                          │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│              NEXT.JS APPLICATION                        │
│  • SSR/CSR hybrid rendering                            │
│  • Static asset serving                                │
│  • Image optimization (next/image)                     │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│          SERVERLESS FUNCTIONS (API Routes)              │
│  • Auto-scaling (0 to infinity)                        │
│  • 10-second timeout                                    │
│  • 50MB response limit                                  │
│  • Environment variables injected                       │
└──────────────────┬──────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────┐
│                SUPABASE (External)                      │
│  • PostgreSQL database                                  │
│  • Connection pooling                                   │
│  • Managed backups                                      │
│  • Real-time subscriptions                             │
└─────────────────────────────────────────────────────────┘
```

### Environment Configuration

**Production** (`main` branch):
```
VERCEL_ENV=production
NEXT_PUBLIC_SUPABASE_URL=https://prod.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<prod-key>
POLYMARKET_API_URL=https://gamma-api.polymarket.com
```

**Staging** (`staging` branch):
```
VERCEL_ENV=preview
NEXT_PUBLIC_SUPABASE_URL=https://staging.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<staging-key>
```

**Development** (Local):
```
VERCEL_ENV=development
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<local-key>
```

### CI/CD Pipeline (GitHub Actions)

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20.x'
      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test (future)

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

---

## Scalability Considerations

### Current Limits & Future Scaling

**Database** (Supabase Free Tier → Pro):
- Current: 500MB storage, 2GB bandwidth/month
- Scale to: 8GB+ storage, 50GB+ bandwidth
- Connection pooling: PgBouncer (included)
- Read replicas (future): For analytics queries

**API** (Vercel Hobby → Pro):
- Current: 100GB bandwidth, serverless functions
- Scale to: Unlimited bandwidth, edge functions
- Rate limiting: Upstash Redis (future)
- Caching: Vercel Edge Config (future)

**Frontend** (Vercel Edge):
- CDN: Global edge network (already in place)
- Static assets: Aggressive caching (365 days)
- Image optimization: next/image (automatic)

### Horizontal Scaling Strategy (Future)

```
┌─────────────────────────────────────────────────────────┐
│                  LOAD BALANCER                          │
│  (Vercel Edge - automatic)                             │
└──────────────────┬──────────────────────────────────────┘
                   ▼
         ┌─────────┴─────────┐
         ▼                   ▼
┌─────────────────┐   ┌─────────────────┐
│ Function        │   │ Function        │  (Auto-scaling)
│ Instance 1      │   │ Instance N      │
└─────────────────┘   └─────────────────┘
         │                   │
         └─────────┬─────────┘
                   ▼
         ┌─────────────────────┐
         │  Supabase (managed) │
         │  Connection Pool    │
         └─────────────────────┘
```

### Database Sharding Strategy (Future - 100K+ users)

```
-- Shard by user_id hash
Shard 1: user_id % 4 == 0  (Users A-F)
Shard 2: user_id % 4 == 1  (Users G-M)
Shard 3: user_id % 4 == 2  (Users N-T)
Shard 4: user_id % 4 == 3  (Users U-Z)

-- Market data (shared globally)
Global DB: markets, market_analytics, prices_1m

-- User data (sharded)
Shard DB: workflow_sessions, workflow_executions, user_settings
```

---

## Monitoring & Observability (Future)

### Metrics to Track

**Application Metrics**:
- API response times (p50, p95, p99)
- Error rates by endpoint
- Request volume by endpoint
- Workflow execution duration
- Database query performance

**Business Metrics**:
- Daily Active Users (DAU)
- Workflow execution count
- Market sync success rate
- User retention (7d, 30d, 90d)

**Infrastructure Metrics**:
- Serverless function cold starts
- Database connection pool usage
- Cache hit rate
- CDN bandwidth usage

### Tools

- **Vercel Analytics** - Web vitals, page performance
- **Sentry** (future) - Error tracking, performance monitoring
- **PostHog** (future) - Product analytics, feature flags
- **Supabase Dashboard** - Database performance, query insights

---

**Document Version**: 2.0
**Last Updated**: 2025-10-23
**Next Review**: 2025-11-23
**Maintained By**: Engineering Team
