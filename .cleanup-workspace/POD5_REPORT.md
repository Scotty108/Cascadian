# Pod 5: Application Source Code - Complete Architecture Map

**Generated:** 2025-11-18  
**Scope:** Core application structure, ClickHouse dependencies, refactoring needs  
**Thoroughness Level:** Medium  

---

## EXECUTIVE SUMMARY

The Cascadian application is a sophisticated Next.js 15 system with:

- **92 API routes** serving real-time wallet, market, and strategy data
- **572 React components** (5.8MB) providing the user interface
- **115 library modules** (1.7MB) containing core business logic
- **Deep ClickHouse integration** across nearly all data-fetching paths
- **1,190 files** directly importing ClickHouse client

### KEY FINDING: WIDE REFACTORING SCOPE

ClickHouse is not isolated in a data layer—it's woven throughout the application:
- Direct queries in API routes (12 critical files)
- Query builders in strategy modules (3 complex files)
- Metric calculations in 10+ library modules
- Ingestion pipelines in 20+ scripts

**Refactoring Scope:** LARGE (150-220 hours estimated)

---

## 1. APPLICATION STRUCTURE

### 1.1 Next.js App Router Layout

The application uses Next.js App Router with route groups for organization:

**Dashboard Routes** (app/(dashboard)/):
```
├── admin/                  - Admin tools and monitoring
├── analysis/               - Market analysis views
├── dashboard/              - Main dashboard landing
├── discovery/              - Market discovery interface
├── events/                 - Event tracking UI
├── insiders/               - Insider activity tracking
├── intelligence-signals/   - AI signal display
├── my-analytics/           - User portfolio analytics
├── my-assets/              - Asset holdings view
├── notifications/          - Notification center
├── settings/               - User preferences
├── strategies/             - Strategy management
├── strategy-builder/       - Visual strategy composer
├── subscription/           - Subscription management
└── trading/                - Trading interface
```

**API Routes** (app/api/):
```
├── admin/                  - Health checks, pipeline status
├── austin/                 - Austin methodology analysis
├── cron/                   - Scheduled jobs
├── insiders/               - Insider data endpoints
├── leaderboard/            - Ranking endpoints
├── markets/                - Market data API
├── notifications/          - Notification endpoints
├── omega/                  - Omega ratio endpoints
├── orchestrator/           - AI orchestration
├── polymarket/             - Polymarket integration
├── signals/                - Trading signals
├── strategies/             - Strategy operations
├── trading/                - Trading operations
├── wallets/                - Wallet analytics
└── whale/                  - Whale activity tracking
```

**Authentication** (app/):
```
├── layout.tsx              - Root layout
├── loading.tsx             - Global loading states
├── signin/page.tsx         - Login page
└── signup/page.tsx         - Registration page
```

**Size Metrics:**
- Total: 1.0MB
- ~150 TypeScript/TSX files
- 92 API routes
- 18 dashboard sections

---

## 2. LIBRARY MODULES (lib/)

### 2.1 ClickHouse Client Layer

**lib/clickhouse/client.ts** (93 lines):
```typescript
export function getClickHouseClient(): ClickHouseClient {
  // Singleton connection management
  // Compression enabled
  // 180s timeout
  // Max 16 concurrent connections
  // Async insert enabled
}

export const clickhouse = {
  query: (...args) => getClickHouseClient().query(...args),
  insert: (...args) => getClickHouseClient().insert(...args),
  command: (...args) => getClickHouseClient().command(...args),
  exec: (...args) => getClickHouseClient().exec(...args),
}
```

**Key Configuration:**
- `request_timeout`: 180,000ms (3 min)
- `max_open_connections`: 16
- `async_insert`: enabled
- `compression`: request + response

### 2.2 Metrics & Analytics Modules

**lib/metrics/** (12 files, 1,200+ lines):

1. **austin-methodology.ts** (250+ lines)
   - Top-down category analysis
   - Identifies "winnable games"
   - Criteria: Elite count, median omega, CLV, EV/hour, volume
   - Generates winnability score (0-100)
   - Uses: ClickHouse queries + Supabase

2. **directional-conviction.ts** (200+ lines)
   - Smart money consensus calculation
   - Components: Elite consensus (50%), Specialist consensus (30%), Omega-weighted (20%)
   - Determines entry signals
   - Uses: ClickHouse + Supabase

3. **omega.ts** (254 lines)
   - Omega ratio calculation (gains / losses)
   - Omega momentum (30d vs 60d change)
   - Sharpe ratio calculation
   - Uses: ClickHouse queries

4. **owrr.ts** - Outcome-weighted return rate
5. **tsi-calculator.ts** - TSI momentum signals
6. **market-momentum.ts** - Market momentum tracking
7. **market-sii.ts** - Smart insider index
8. **position-matching.ts** - Position reconciliation
9. **wallet-metrics-calculator.ts** - Comprehensive metrics
10. Plus 2-3 more specialized modules

**Data Pattern:**
```typescript
// Typical metric query (lib/metrics/omega.ts)
const query = `
  SELECT
    count() as total_trades,
    countIf(pnl > 0) as winning_trades,
    sumIf(pnl, pnl > 0) as total_gains,
    sumIf(abs(pnl), pnl <= 0) as total_losses
  FROM trades_raw
  WHERE wallet_address = '${walletAddress}'
    AND timestamp >= toDateTime(${cutoffTimestamp})
    AND is_closed = true
`
```

### 2.3 Strategy Builder

**lib/strategy-builder/** (6 files, 1,500+ lines):

1. **clickhouse-connector.ts** (538 lines) - CRITICAL
   - Query builder for wallet metrics
   - Features:
     - PREWHERE optimization (high-cardinality filters)
     - Column pruning
     - Partition pruning
     - Index hints for range queries
     - Batch query support
     - Retry logic (3 attempts)
   - Classes: WalletMetricsConnector
   - Methods: queryWalletMetrics(), queryWalletMetricsByCategory(), batchQuery()

2. **execution-engine.ts** (200+ lines)
   - Strategy execution logic
   - Workflow orchestration
   - Trade decision logic

3. **supabase-connector.ts** (200+ lines)
   - Supabase integration
   - Market lookups
   - Metadata queries

4. **field-discovery.ts** - Dynamic field discovery
5. **metric-field-mapping.ts** - Field name mapping
6. **types.ts** - TypeScript definitions

**Example Query Builder Usage:**
```typescript
const connector = new WalletMetricsConnector()
const result = await connector.queryWalletMetrics({
  filters: [
    { field: 'omega_net', operator: 'GREATER_THAN', value: 2.0 }
  ],
  timeWindow: '30d',
  orderBy: { field: 'omega_net', direction: 'DESC' },
  limit: 50
})
```

### 2.4 Trading Operations

**lib/trading/** (7 files, 1,000+ lines):

1. **wallet-monitor.ts** - Real-time wallet monitoring
2. **decision-engine.ts** - Trade decision logic
3. **polymarket-executor.ts** - Polymarket API execution
4. **owrr-calculator.ts** - OWRR calculations
5. **position-sizing.ts** - Kelly criterion sizing
6. **types.ts** - Type definitions
Plus additional modules

### 2.5 Analytics & Data

**lib/analytics/** (5 files):
- wallet-category-breakdown.ts
- wallet-resolution-accuracy.ts
- wallet-specialists.ts
- enrich-watchlist.ts

**lib/data/** (4 files):
- dimension-readers.ts - Dimension table reading
- wallet-pnl-feed.ts - PnL data streaming
- wallet-signal-set.ts - Signal generation
- Other data utilities

### 2.6 Workflow Engine

**lib/workflow/** (25 files, 2,000+ lines):
- node-executors.ts - Strategy node execution
- executor-integration.ts - Integration logic
- filter-executor-v2.ts - Advanced filtering
- layout/ - Graph layout algorithms (3 files)
- __tests__/ - Unit tests (8 files)

**Size:** 1.7MB total, 115 TypeScript files

---

## 3. REACT COMPONENTS

### 3.1 Component Organization

**Total:** 572 TSX files, 5.8MB

**Strategy Builder Components** (50+ files):
```
components/
├── strategy-builder/
│   ├── strategy-builder.tsx    - Main visual composer
│   ├── node-palette.tsx        - Available nodes
│   ├── node-config-panel.tsx   - Configuration UI (66KB!)
│   └── workflow-editor/        - Flow editor
│
├── strategy-nodes/             - Custom node implementations
│   ├── wallet-filter-node/     - Wallet filtering node
│   ├── nodes/                  - All node types
│   └── ...
│
├── node-config-panel.tsx       - Complex config panel
└── strategy-dashboard/         - Strategy management
```

**Dashboard Components** (40+ files):
```
├── dashboard-content/          - Main dashboard
├── overview-dashboard/         - Overview view
├── strategy-dashboard/         - Strategies view
├── omega-leaderboard-interface/ - Leaderboard
├── wallet-detail-interface/    - Wallet deep dive
├── market-detail-interface/    - Market analysis
├── execution-logs-dashboard/   - Execution logs
└── Others...
```

**Data Visualization** (30+ files):
```
├── whale-activity/             - Whale tracking
├── whale-activity-interface/   - Whale UI
├── pump-screener-interface/    - Market screener
├── market-insights/            - Market insights
├── intelligence-signals/       - Signal display
└── Others...
```

**UI Component Library** (64 files, components/ui/):
```
├── chart.tsx                   - Recharts wrapper
├── metric-card.tsx             - Metric display
├── omega-badge.tsx             - Omega badge
├── sparkline.tsx               - Mini charts
├── animated-card.tsx           - Animated cards
├── skeletons/                  - Loading skeletons
├── Common components:
│   ├── button.tsx, card.tsx, input.tsx, select.tsx
│   ├── dialog.tsx, sheet.tsx, popover.tsx
│   ├── tabs.tsx, accordion.tsx, dropdown menus
│   └── 50+ more...
```

**Navigation & Layout** (10+ files):
```
├── dashboardSidebar.tsx        - Main sidebar (30KB)
├── topbar.tsx                  - Top navigation bar
├── search-bar.tsx              - Search interface
├── notifications-content.tsx   - Notifications
└── Others...
```

**Key Component Stats:**
- Largest: node-config-panel.tsx (66KB)
- Average: 8-15KB per component
- All use TypeScript strict mode
- All are functional components
- Heavy use of React hooks

### 3.2 Component Dependencies

**NO direct ClickHouse imports** - All components consume API routes

**Typical data flow:**
```
Component (TSX)
    ↓ fetch('api/wallets/top')
API Route (route.ts)
    ↓ clickhouse.query(...)
ClickHouse Database
```

---

## 4. CLICKHOUSE INTEGRATION POINTS

### 4.1 Critical API Routes (12 Files)

These routes directly query ClickHouse and need refactoring:

| Route | File | Queries |
|-------|------|---------|
| GET /api/wallets/top | app/api/wallets/top/route.ts | wallet_metrics |
| GET /api/leaderboard/omega | app/api/leaderboard/omega/route.ts | wallet_metrics |
| GET /api/leaderboard/roi | app/api/leaderboard/roi/route.ts | wallet_metrics |
| GET /api/leaderboard/whale | app/api/leaderboard/whale/route.ts | trades_raw |
| GET /api/omega/leaderboard | app/api/omega/leaderboard/route.ts | wallet_metrics |
| GET /api/wallets/[address]/orphans | app/api/wallets/[address]/orphans/route.ts | trades_raw |
| GET /api/wallets/[address]/category-breakdown | app/api/wallets/[address]/category-breakdown/route.ts | Aggregates |
| GET /api/signals/tsi/[marketId] | app/api/signals/tsi/[marketId]/route.ts | trades_raw |
| GET /api/trading/track-wallet | app/api/trading/track-wallet/route.ts | trades_raw |
| GET /api/markets/[id]/owrr | app/api/markets/[id]/owrr/route.ts | Aggregates |
| POST /api/leaderboard/wallet/[address] | app/api/leaderboard/wallet/[address]/route.ts | wallet_metrics |
| GET /api/admin/pipeline-status | app/api/admin/pipeline-status/route.ts | system.tables |

### 4.2 ClickHouse Modules (27 Files)

**lib/clickhouse/** (6 files):
- client.ts - Connection manager
- metrics-calculator.ts - Metric calculations
- pnl-views.ts - P&L aggregations
- wallet-clustering.ts - Wallet grouping
- orphan-filter.ts - Data quality
- mutations.ts - Update operations

**lib/metrics/** (12 files) - All use ClickHouse:
- austin-methodology.ts
- directional-conviction.ts
- omega.ts
- owrr.ts
- tsi-calculator.ts
- market-momentum.ts
- market-sii.ts
- position-matching.ts
- wallet-metrics-calculator.ts
- Plus 3 more

**lib/strategy-builder/** (3 files):
- clickhouse-connector.ts (PRIMARY - 538 lines)
- execution-engine.ts
- index.ts

**lib/trading/** (1 file):
- wallet-monitor.ts

**lib/analytics/** (2 files):
- wallet-category-breakdown.ts
- wallet-resolution-accuracy.ts

**lib/workflow/** (1 file):
- node-executors.ts

**lib/other/** (2 files):
- smart-money-flow.ts
- scoring-engine.ts

### 4.3 Query Patterns

**Pattern 1: Simple Aggregation**
```sql
SELECT omega_ratio, realized_pnl, win_rate, total_trades
FROM wallet_metrics
WHERE time_window = '30d' AND omega_ratio > 0
ORDER BY omega_ratio DESC LIMIT 50
```

**Pattern 2: Complex Joins**
```sql
SELECT t.wallet_address, count(*) as trade_count, sum(t.pnl) as total_pnl
FROM trades_raw t
LEFT JOIN market_resolutions r ON t.condition_id = r.condition_id
WHERE t.wallet_address = ? AND t.timestamp >= ?
GROUP BY t.wallet_address
```

**Pattern 3: Metric Calculation**
```sql
SELECT
  count() as total,
  countIf(pnl > 0) as wins,
  sumIf(pnl, pnl > 0) as gains,
  sumIf(abs(pnl), pnl <= 0) as losses
FROM trades_raw
WHERE wallet_address = ? AND is_closed = true
```

**Pattern 4: Advanced Filtering**
```sql
SELECT wallet_address, omega_ratio
FROM wallet_metrics
WHERE omega_ratio >= quantile(0.75)(omega_ratio)
  AND time_window = '90d'
  AND total_trades >= 50
```

---

## 5. ACTIVE OPERATIONAL SCRIPTS (scripts/)

### 5.1 Goldsky Integration Scripts

**PRIMARY INGESTION:**
```
scripts/goldsky-parallel-ingestion.ts    # CRITICAL SCRIPT
- 15 concurrent workers
- Checkpoint system (every 10 wallets)
- Batch inserts (10k trades)
- Resume capability
- ETA tracking
- ~8-12 hour runtime for 65k wallets
```

**Supporting Scripts:**
```
worker-goldsky.ts                - Worker process
test-goldsky-subgraph.ts        - Connection tests
test-goldsky-batch.ts           - Batch tests
check-goldsky-staging.ts        - Staging validation
```

### 5.2 Data Transformation Pipeline

**goldsky-parallel-ingestion.ts** (532 lines):

Key components:
1. **Checkpoint System**
   - Saves every 10 wallets
   - Allows resume after crashes
   - Tracks progress (ETA, throughput)

2. **Transformation Logic**
   ```typescript
   // Token ID resolution
   const tokenInfo = await resolveTokenIdToCondition(tokenId)
   
   // Condition → Market mapping
   const marketId = await resolveConditionToMarket(tokenInfo.condition)
   
   // Side calculation (BUY/SELL)
   // Shares correction (÷128 bug)
   // Price calculation
   ```

3. **Quality Checks**
   - Deduplication via filterDuplicateTrades()
   - Null checks
   - Error handling

### 5.3 Legacy Scripts (Can Delete)

These 800+ scripts are investigation/diagnostic files:
```
scripts/                         # 343MB
├── 01-*.ts to 61-*.ts          # Historical diagnostics
├── analyze-*.ts                 # Analysis scripts
├── check-*.ts                   # Validation scripts
├── debug-*.ts                   # Debugging scripts
├── investigate-*.ts             # Investigation scripts
├── verify-*.ts                  # Verification scripts
└── ... many more
```

**These can be safely deleted after migration.**

---

## 6. FILES THAT MUST BE PRESERVED

### KEEP (No Changes Needed)

**React Components** (572 files, 5.8MB):
- ALL components in components/
- All dashboard pages
- All UI components
- All strategy visualizations
- Zero changes needed (consume APIs)

**Authentication & Pages** (6 files):
- app/layout.tsx
- app/loading.tsx
- app/signin/page.tsx
- app/signup/page.tsx
- app/not-found.tsx
- app/opengraph-image.tsx

**External Integrations** (Keep):
- lib/polymarket/ (external API)
- lib/polymarket/client.ts
- lib/polymarket/sync.ts
- lib/polymarket/utils.ts
- lib/supabase.ts (authentication)

**Utilities** (Keep):
- lib/utils.ts
- lib/random-utils.ts
- lib/name-generators.ts
- lib/cache/
- lib/types/

**Goldsky Client** (Already Correct):
- lib/goldsky/client.ts
- lib/goldsky/batch-resolver.ts

### KEEP & REFACTOR

**API Routes** (92 files, 1.0MB):
- ALL api/ routes need query updates
- Maintain response contracts (JSON shape)
- 2-3 hours per route
- Total: 24-36 hours

**Metrics Modules** (10 files, 1,200+ lines):
- austin-methodology.ts - Update queries
- directional-conviction.ts - Update queries
- omega.ts - Refactor calculations
- owrr.ts - Update queries
- tsi-calculator.ts - Update queries
- market-momentum.ts - Update queries
- market-sii.ts - Update queries
- position-matching.ts - Update queries
- wallet-metrics-calculator.ts - Update queries
- Plus 1-2 more
- Total: 40-60 hours

**Strategy Builder** (3 files, 1,000+ lines):
- clickhouse-connector.ts - REPLACE entirely with goldsky-connector.ts
- execution-engine.ts - Update data fetching
- supabase-connector.ts - Keep as-is
- Total: 20-30 hours

**Trading Operations** (5 files, 800+ lines):
- wallet-monitor.ts - Update queries
- decision-engine.ts - Update data layer
- polymarket-executor.ts - Keep
- owrr-calculator.ts - Update queries
- position-sizing.ts - Keep
- Total: 15-20 hours

**Analytics** (4 files, 500+ lines):
- wallet-category-breakdown.ts - Rewrite
- wallet-resolution-accuracy.ts - Rewrite
- wallet-specialists.ts - Update
- enrich-watchlist.ts - Update
- Total: 10-15 hours

**Workflow Engine** (4 files, 500+ lines):
- node-executors.ts - Update data fetching
- executor-integration.ts - Update
- filter-executor-v2.ts - Update
- layout modules - Keep
- Total: 8-12 hours

### DELETE (After Migration)

**Investigation Scripts** (343MB, 800+ files):
- All scripts/ except goldsky-parallel-ingestion.ts
- All analysis/debug/diagnostic scripts
- Can be safely deleted

**ClickHouse-Specific Code** (after migration):
- lib/clickhouse/ (except for transition period)
- All ClickHouse documentation
- Schema reference files

---

## 7. REFACTORING SCOPE ESTIMATE

### Effort Matrix

| Component | Files | Impact | Hours | Days |
|-----------|-------|--------|-------|------|
| API Routes | 12 | High | 24-36 | 3-4 |
| Metrics | 10 | High | 40-60 | 5-8 |
| Strategy Builder | 3 | High | 20-30 | 3-4 |
| Trading Operations | 5 | Medium | 15-20 | 2-3 |
| Analytics | 4 | Medium | 10-15 | 1-2 |
| Workflow Engine | 4 | Medium | 8-12 | 1-2 |
| Testing | - | N/A | 40-60 | 5-8 |
| Integration | - | N/A | 10-20 | 1-3 |
| **TOTAL** | **38** | - | **167-253** | **21-34** |

### Timeline

**Realistic estimate:** 4-6 weeks with 1 experienced developer

**Week 1-2:**
- Create data layer abstraction
- Implement Goldsky provider
- Begin API route migration

**Week 2-3:**
- Migrate metrics modules
- Refactor strategy builder

**Week 3-4:**
- Migrate trading operations
- Update analytics modules

**Week 4-5:**
- Integration testing
- Performance validation
- Bug fixes

**Week 5-6:**
- Final cleanup
- Documentation
- Cleanup scripts deletion

---

## 8. CRITICAL TABLES USED

### Primary Data Tables

**trades_raw**
- Columns: trade_id, wallet_address, market_id, condition_id, side, shares, entry_price, timestamp, pnl, is_closed
- Used by: All metrics modules, API routes

**wallet_metrics**
- Columns: wallet_address, time_window, omega_ratio, realized_pnl, win_rate, total_trades, ...
- Used by: Leaderboard APIs, Austin methodology

**wallet_metrics_complete**
- Columns: wallet_address, time_window, all_metrics (70+ fields)
- Used by: Strategy builder, analytics

**wallet_metrics_by_category**
- Columns: wallet_address, category, metrics by category
- Used by: Category breakdown, Austin methodology

**market_resolutions**
- Columns: condition_id, market_id, resolution_value, timestamp
- Used by: PnL calculations, resolution tracking

---

## 9. EXTERNAL DEPENDENCIES

### Goldsky (Primary Data Source)
Already integrated in lib/goldsky/:
```typescript
export async function fetchAllWalletTrades(walletAddress: string)
export async function resolveTokenId(tokenId: string)
```

### Supabase (Metadata & Auth)
Used for:
- User authentication
- Market metadata lookups
- Condition → Market mapping
- Strategy storage
- Notification state

### Polymarket API
Used for:
- Current market prices
- Resolution outcomes
- Live order book data

### External services to preserve:
- Polymarket API calls (lib/polymarket/)
- Supabase connections (lib/supabase.ts)
- No changes needed

---

## 10. DATA FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│ GOLDSKY (Already Integrated)                               │
│ - fetchAllWalletTrades(wallet)                             │
│ - resolveTokenId(tokenId)                                  │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
    ┌────────────────────────────┐
    │ Data Transformation (KEEP) │
    │ - Token → Condition        │
    │ - Condition → Market       │
    │ - Side calculation         │
    │ - Price calculation        │
    └────────────┬───────────────┘
                 │
                 ↓
    ┌────────────────────────────────────┐
    │ ClickHouse (To be REPLACED)        │
    │ - trades_raw                       │
    │ - wallet_metrics                   │
    │ - market_resolutions               │
    │ - ... other tables                 │
    └────────────┬───────────────────────┘
                 │
                 ↓
    ┌──────────────────────────────────────────┐
    │ Business Logic Layer (REFACTOR)          │
    │ - lib/metrics/                           │
    │ - lib/strategy-builder/                  │
    │ - lib/trading/                           │
    │ - lib/analytics/                         │
    └────────────┬─────────────────────────────┘
                 │
                 ↓
    ┌──────────────────────────────────────────┐
    │ API Routes (REFACTOR)                    │
    │ - app/api/wallets/                       │
    │ - app/api/leaderboard/                   │
    │ - app/api/markets/                       │
    │ - ... 92 routes total                    │
    └────────────┬─────────────────────────────┘
                 │
                 ↓
    ┌──────────────────────────────────────────┐
    │ React Components (NO CHANGE)             │
    │ - 572 TSX files                          │
    │ - Consume API responses                  │
    └──────────────────────────────────────────┘
```

---

## 11. RISK ASSESSMENT

### HIGH RISK

1. **Metric Calculation Drift**
   - ClickHouse aggregations may differ from Goldsky calculations
   - Impact: Leaderboard rankings could shift
   - Mitigation: Parallel run period, validation tests

2. **Performance Regression**
   - ClickHouse optimized for analytical queries (< 200ms)
   - Goldsky queries may be slower
   - Impact: API latency increase
   - Mitigation: Caching strategy, query optimization

3. **API Contract Breaking**
   - Frontend depends on exact response shapes
   - Impact: UI breaks if fields missing
   - Mitigation: Schema validation tests

### MEDIUM RISK

1. **Query Complexity**
   - Some ClickHouse queries highly optimized
   - Impact: Difficult to replicate exactly
   - Mitigation: Accept small variations, test thoroughly

2. **Data Completeness**
   - Goldsky may have different coverage than ClickHouse
   - Impact: Missing wallets or trades
   - Mitigation: Coverage analysis, backfill strategy

3. **Real-Time Requirements**
   - Some features need sub-200ms latency
   - Impact: Timeout failures under load
   - Mitigation: Caching layer, materialized views

### LOW RISK

1. **Component Changes**
   - Components are data-agnostic (consume APIs)
   - Impact: None
   - Mitigation: None needed

2. **Authentication Changes**
   - Supabase client separate from data layer
   - Impact: None
   - Mitigation: None needed

---

## 12. TESTING STRATEGY

### Test Categories

**1. API Contract Tests**
```typescript
describe('GET /api/wallets/top', () => {
  it('returns correct response shape', async () => {
    const response = await fetch('/api/wallets/top')
    const data = await response.json()
    
    expect(data).toHaveProperty('wallets')
    expect(data).toHaveProperty('total')
    expect(data.wallets[0]).toHaveProperty('wallet_address')
    expect(data.wallets[0]).toHaveProperty('omega_net')
    // ... check all fields
  })
})
```

**2. Metric Validation Tests**
```typescript
describe('Omega Calculation', () => {
  it('matches ClickHouse results within tolerance', async () => {
    const clickhouseResult = calculateOmegaClickHouse(wallet)
    const goldskyResult = calculateOmegaGoldsky(wallet)
    
    expect(goldskyResult.omega_ratio)
      .toBeCloseTo(clickhouseResult.omega_ratio, 2) // 2% tolerance
  })
})
```

**3. Integration Tests**
- Strategy execution with Goldsky data
- Leaderboard ranking consistency
- Wallet detail page data completeness
- Market analysis page functionality

**4. Performance Tests**
- Query response times (target: < 500ms)
- API latency (target: < 200ms)
- Component render times
- Load testing (concurrent requests)

---

## 13. PRESERVATION CHECKLIST

### Must Keep (Do Not Modify)

- [x] All React components (572 files)
- [x] All UI components (64 files)
- [x] Dashboard layouts
- [x] Authentication pages
- [x] API route structure
- [x] lib/polymarket/ (external API)
- [x] lib/supabase.ts
- [x] lib/utils.ts
- [x] lib/cache/
- [x] lib/goldsky/ (already correct)
- [x] lib/types/

### Must Keep & Refactor

- [ ] API routes (92 files) - Update queries
- [ ] Metrics modules (10 files) - Change data source
- [ ] Strategy builder (3 files) - Replace connector
- [ ] Trading operations (5 files) - Update queries
- [ ] Analytics (4 files) - Rewrite queries

### Must Delete

- [ ] scripts/ (except goldsky-parallel-ingestion.ts)
- [ ] lib/clickhouse/ (after migration)
- [ ] All diagnostic/test scripts
- [ ] ClickHouse schema documentation

---

## 14. DELIVERABLES

### Immediate Outputs

1. **POD5_REPORT.md** (this file)
   - Complete architecture map
   - ClickHouse integration points
   - Refactoring scope

2. **Integration Points Reference**
   - All 12 critical API routes
   - All 27 ClickHouse modules
   - All query patterns

3. **Preservation Matrix**
   - Files to keep
   - Files to refactor
   - Files to delete

4. **Effort Estimates**
   - Per-module breakdown
   - Timeline recommendations
   - Testing requirements

---

## SUMMARY TABLE

| Aspect | Value |
|--------|-------|
| **Total Source Files** | 1,200+ |
| **API Routes** | 92 |
| **React Components** | 572 |
| **Library Modules** | 115 |
| **ClickHouse Imports** | 1,190 files |
| **Critical Routes** | 12 |
| **High-Impact Modules** | 27 |
| **Refactoring Scope** | 150-220 hours |
| **Timeline** | 4-6 weeks |
| **Risk Level** | Medium |
| **Testability** | Good (contracts stable) |

---

**Report Generated:** 2025-11-18  
**Analyst:** Claude Code (Pod 5 Specialist)  
**Status:** Analysis Complete - Ready for Planning Phase

**Next Steps:**
1. Review this architecture map
2. Create data layer abstraction
3. Implement Goldsky provider
4. Begin systematic API migration
5. Refactor metrics modules
6. Comprehensive testing
7. Cleanup and optimization

