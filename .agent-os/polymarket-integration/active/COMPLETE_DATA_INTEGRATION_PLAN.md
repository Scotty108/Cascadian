# Complete Data Integration Plan - Remove ALL Mock Data

## Goal
Transform CASCADIAN into a **100% real data platform** with NO mock/fake data anywhere.

## Current Status Summary

### ✅ Already Using Real Data
- **Events Page** - Polymarket Gamma API
- **Event Detail Page** - Polymarket Gamma API
- **Market Detail Page** - Polymarket Gamma API + CLOB API
- **Market Screener** - Polymarket Gamma API

### ⚠️ Has Infrastructure But Untested
- **Wallet Detail Page** - Rebuilt with real APIs, needs real wallet address to test
- **6 Wallet API Endpoints** - Created, need testing

### ❌ Still Using Mock Data (MUST FIX TODAY)
- **Whale Activity** (7 tabs) - All mock data
- **Insider Activity** (2 pages) - All mock data
- **Various API Routes** - Some still have mock generators

---

## Database Migration Status

### ✅ Completed Migrations
1. `20251022140000_create_polymarket_tables_v2.sql` - Markets + sync_logs
2. `20251023000001_create_prices_1m_table.sql` - OHLC data
3. `20251022220000_add_market_analytics.sql` - Market analytics

### 📝 New Migration (Ready to Apply)
4. `20251023120000_create_wallet_analytics_tables.sql` - **7 wallet tables**

**Action Required**: Apply migration via Supabase Dashboard
- See: `supabase/APPLY_WALLET_MIGRATION.md`

---

## Phase 1: Remove Whale Activity Mock Data

### Files to Update

#### 1. Whale Trades Tab
**File**: `/components/whale-activity/trades-tab.tsx`

**Current**: Mock generator function
**Target**: Real aggregated trades from Data-API

**Implementation**:
```typescript
// Replace mock with:
const { data: whaleTrades } = useQuery({
  queryKey: ['whale-trades', { limit, sortBy }],
  queryFn: () => fetch('/api/whale/aggregated-trades').then(r => r.json())
});
```

**New API Endpoint Needed**: `/api/whale/aggregated-trades/route.ts`
- Fetch trades from multiple known whale addresses
- Aggregate and sort by size/timestamp
- Filter trades > $10k (whale threshold)

#### 2. Whale Positions Tab
**File**: `/components/whale-activity/positions-tab.tsx`

**Current**: Mock generator
**Target**: Real positions aggregated from market holders

**Implementation**:
```typescript
// Use market holders endpoint
const { data: whalePositions } = useQuery({
  queryKey: ['whale-positions'],
  queryFn: () => fetch('/api/whale/aggregated-positions').then(r => r.json())
});
```

**New API Endpoint**: `/api/whale/aggregated-positions/route.ts`
- Fetch top holders for popular markets
- Aggregate by wallet address
- Calculate total position values

#### 3. Whale Scoreboard Tab
**File**: `/components/whale-activity/scoreboard-tab.tsx`

**Current**: Mock whale profiles
**Target**: Real wallet rankings from database

**Implementation**:
```typescript
// Query from wallets table
const { data: whaleScoreboard } = useQuery({
  queryKey: ['whale-scoreboard'],
  queryFn: () => fetch('/api/whale/scoreboard').then(r => r.json())
});
```

**New API Endpoint**: `/api/whale/scoreboard/route.ts`
- Query `wallets` table where `is_whale = TRUE`
- Order by `whale_score DESC` or `total_volume_usd DESC`
- Return top 50 whales

#### 4. Unusual Trades Tab
**File**: `/components/whale-activity/unusual-trades-tab.tsx`

**Current**: Mock unusual trade generator
**Target**: Real trades with unusual size/timing

**Implementation**:
```typescript
// Detect unusual trades
const { data: unusualTrades } = useQuery({
  queryKey: ['unusual-trades'],
  queryFn: () => fetch('/api/whale/unusual-trades').then(r => r.json())
});
```

**New API Endpoint**: `/api/whale/unusual-trades/route.ts`
- Query `wallet_trades` where `amount_usd > THRESHOLD`
- Compare to market's average trade size
- Flag trades that are 10x+ average

#### 5. Concentration Tab
**File**: `/components/whale-activity/concentration-tab.tsx`

**Current**: Mock concentration data
**Target**: Real market holder concentration

**Implementation**:
```typescript
// Use market holders
const { data: concentration } = useQuery({
  queryKey: ['market-concentration', marketId],
  queryFn: () => fetch(`/api/whale/concentration?market=${marketId}`).then(r => r.json())
});
```

**New API Endpoint**: `/api/whale/concentration/route.ts`
- Query `market_holders` table
- Calculate Herfindahl index (concentration measure)
- Show top 10 holders and their market share %

#### 6. Flips Tab
**File**: `/components/whale-activity/flips-tab.tsx`

**Current**: Mock position flips
**Target**: Real position changes over time

**Implementation**:
```typescript
// Track position changes
const { data: flips } = useQuery({
  queryKey: ['position-flips'],
  queryFn: () => fetch('/api/whale/flips').then(r => r.json())
});
```

**New API Endpoint**: `/api/whale/flips/route.ts`
- Query `whale_activity_log` where `activity_type = 'POSITION_FLIP'`
- Track when whales change from YES to NO or vice versa
- Show recent flips (last 24-48 hours)

#### 7. Flows Tab
**File**: `/components/whale-activity/flows-tab.tsx`

**Current**: Mock capital flows
**Target**: Real net buy/sell flows

**Implementation**:
```typescript
// Calculate net flows
const { data: flows } = useQuery({
  queryKey: ['capital-flows'],
  queryFn: () => fetch('/api/whale/flows').then(r => r.json())
});
```

**New API Endpoint**: `/api/whale/flows/route.ts`
- Query `wallet_trades` grouped by market
- Sum `amount_usd` where `side = 'BUY'` minus `side = 'SELL'`
- Calculate net flow per market

---

## Phase 2: Remove Insider Activity Mock Data

### Files to Update

#### 1. Insider Activity Interface
**File**: `/components/insider-activity-interface/index.tsx`

**Current**: Hardcoded fake wallet list with fake scores
**Target**: Real wallet timing analysis

**Implementation**:
```typescript
// Query suspected insiders from database
const { data: insiders } = useQuery({
  queryKey: ['suspected-insiders'],
  queryFn: () => fetch('/api/insider/suspected').then(r => r.json())
});
```

**New API Endpoint**: `/api/insider/suspected/route.ts`
- Query `wallets` where `is_suspected_insider = TRUE`
- Order by `insider_score DESC`
- Include timing analysis metrics

#### 2. Insider Dashboard Tab
**File**: `/components/insiders/dashboard-tab.tsx`

**Current**: Mock summary stats
**Target**: Real aggregated insider metrics

**Implementation**:
```typescript
// Get insider summary
const { data: summary } = useQuery({
  queryKey: ['insider-summary'],
  queryFn: () => fetch('/api/insider/summary').then(r => r.json())
});
```

**New API Endpoint**: `/api/insider/summary/route.ts`
- Count wallets where `insider_score > 70`
- Sum total volume from suspected insiders
- Calculate average timing score

#### 3. Market Watch Tab
**File**: `/components/insiders/market-watch-tab.tsx`

**Current**: Mock insider activity per market
**Target**: Real insider trades per market

**Implementation**:
```typescript
// Get insider activity by market
const { data: marketActivity } = useQuery({
  queryKey: ['insider-market-activity', marketId],
  queryFn: () => fetch(`/api/insider/market-activity?market=${marketId}`).then(r => r.json())
});
```

**New API Endpoint**: `/api/insider/market-activity/route.ts`
- Query `wallet_trades` where wallet has high `insider_score`
- Group by market
- Show early entries before price movements

---

## Phase 3: Create New API Endpoints

### Priority 1: Whale Aggregation Endpoints

1. **`/api/whale/aggregated-trades/route.ts`**
   - Fetch trades from known whale addresses
   - Requires: List of whale addresses (from `wallets` table)
   - Returns: Aggregated trades sorted by size/time

2. **`/api/whale/aggregated-positions/route.ts`**
   - Aggregate market holders data
   - Calculate total positions per whale
   - Returns: Whale positions across all markets

3. **`/api/whale/scoreboard/route.ts`**
   - Query `wallets` table
   - Calculate rankings
   - Returns: Top whales by volume/score

### Priority 2: Insider Detection Endpoints

1. **`/api/insider/suspected/route.ts`**
   - Query `wallets` table for suspected insiders
   - Include timing analysis
   - Returns: List of suspected insider wallets

2. **`/api/insider/summary/route.ts`**
   - Aggregate insider metrics
   - Returns: Summary stats

3. **`/api/insider/timing-analysis/route.ts`**
   - Analyze trade timing vs price movements
   - Calculate timing scores
   - Returns: Timing analysis for wallets

### Priority 3: Data Ingestion Background Jobs

1. **Wallet Discovery Job**
   - Scan recent trades for new wallet addresses
   - Add to `wallets` table
   - Schedule: Every 15 minutes

2. **Whale Classification Job**
   - Calculate `whale_score` for all wallets
   - Set `is_whale = TRUE` where score > 70
   - Schedule: Every hour

3. **Insider Detection Job**
   - Calculate `insider_score` based on timing
   - Set `is_suspected_insider = TRUE` where score > 70
   - Schedule: Every hour

4. **PnL Snapshot Job**
   - Calculate current PnL for all tracked wallets
   - Insert into `wallet_pnl_snapshots`
   - Schedule: Every 6 hours

---

## Phase 4: Test & Verify

### Testing Checklist

- [ ] Migration applied to Supabase
- [ ] All 7 wallet tables exist
- [ ] Whale trades tab shows real or empty state
- [ ] Whale positions tab shows real or empty state
- [ ] Whale scoreboard shows real or empty state
- [ ] Whale unusual trades shows real or empty state
- [ ] Whale concentration shows real or empty state
- [ ] Whale flips shows real or empty state
- [ ] Whale flows shows real or empty state
- [ ] Insider interface shows real or empty state
- [ ] Insider dashboard shows real or empty state
- [ ] Insider market watch shows real or empty state
- [ ] NO mock data generators remaining
- [ ] All empty states have "Coming Soon" or "No data" messaging
- [ ] All API endpoints return proper JSON structure

---

## Implementation Order (Priority)

### Today - Session 1 (3-4 hours)
1. ✅ Create wallet analytics migration
2. ✅ Document migration application
3. ✅ Document address finding
4. 🔄 Remove mock data from whale trades tab
5. ⏳ Create whale aggregated-trades endpoint
6. ⏳ Remove mock data from insider interface
7. ⏳ Create insider suspected endpoint

### Today - Session 2 (3-4 hours)
8. ⏳ Remove mock data from remaining whale tabs
9. ⏳ Create remaining whale endpoints
10. ⏳ Remove mock data from insider tabs
11. ⏳ Create remaining insider endpoints
12. ⏳ Test all pages end-to-end

### Tomorrow (if needed)
13. ⏳ Find real wallet addresses
14. ⏳ Apply migration to database
15. ⏳ Test with real addresses
16. ⏳ Create background jobs for data ingestion
17. ⏳ Set up OHLC data pipeline

---

## Success Criteria

By end of today:
- ✅ All mock data generators DELETED
- ✅ All whale tabs use real API endpoints
- ✅ All insider tabs use real API endpoints
- ✅ All endpoints return proper structure (even if empty)
- ✅ All UI shows proper loading/empty states
- ✅ Migration ready to apply
- ✅ Documentation complete

By end of tomorrow (if applicable):
- ✅ Migration applied to database
- ✅ Real wallet addresses found and tested
- ✅ At least one whale in database
- ✅ At least one insider in database
- ✅ All graphs showing real or empty data
- ✅ Background jobs scheduled

---

## Key Principles

1. **NO MOCK DATA** - Delete all generators, replace with real APIs
2. **GRACEFUL DEGRADATION** - Show empty states, not errors
3. **CLEAR MESSAGING** - Tell users when data is unavailable
4. **REAL STRUCTURE** - Even empty responses should have correct shape
5. **DATABASE FIRST** - All data flows through database tables
6. **API LAYER** - All components fetch via API routes, never direct Supabase

---

## Files Modified Summary

### Created
- `supabase/migrations/20251023120000_create_wallet_analytics_tables.sql`
- `supabase/APPLY_WALLET_MIGRATION.md`
- `scripts/find-wallet-addresses.md`
- `COMPLETE_DATA_INTEGRATION_PLAN.md` (this file)

### To Modify
- `/components/whale-activity/*.tsx` (7 files)
- `/components/insider-activity-interface/index.tsx`
- `/components/insiders/*.tsx` (2 files)
- `/app/api/whale/*.ts` (create new endpoints)
- `/app/api/insider/*.ts` (create new endpoints)

### To Delete
- All `generateMock*` functions
- All `faker` imports
- All hardcoded data arrays

---

## Next Action

**START HERE**: Remove mock data from whale trades tab and create aggregated trades endpoint.

See todo list for current task tracking.
