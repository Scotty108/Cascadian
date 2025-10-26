# API Endpoints Summary

**Date:** 2025-10-25
**Status:** ✅ Complete (3 endpoints ready)

Complete API layer for TSI Momentum System - connects UI components to backend data.

---

## 🎯 Endpoints Built

### 1. TSI Signal Endpoint ✅

**Endpoint:** `GET /api/signals/tsi/[marketId]`

**Purpose:** Returns TSI momentum signal with conviction score for a market

**Query Parameters:**
- `lookbackMinutes` (number, default: 1440) - How far back to calculate TSI
- `fresh` (boolean, default: false) - Force recalculation instead of cache

**Response:**
```typescript
{
  success: true
  cached: boolean
  market_id: string
  tsi_fast: number              // -100 to +100
  tsi_slow: number              // -100 to +100
  crossover_signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  crossover_timestamp: string | null
  directional_conviction: number  // 0-1 score
  elite_consensus_pct: number     // % of elite wallets
  category_specialist_pct: number // % of specialists
  omega_weighted_consensus: number // Omega-weighted vote
  meets_entry_threshold: boolean   // conviction >= 0.9
  signal_strength: 'STRONG' | 'MODERATE' | 'WEAK'
  updated_at: string
}
```

**Example Request:**
```bash
GET /api/signals/tsi/0x1234567890abcdef?lookbackMinutes=1440&fresh=false
```

**Features:**
- ✅ 10-second cache (configurable)
- ✅ Calculates TSI using tsi-calculator library
- ✅ Calculates conviction using directional-conviction library
- ✅ Determines signal strength automatically
- ✅ Error handling with detailed messages

**Used By:**
- `components/tsi-signal-card.tsx`
- `hooks/use-market-tsi.ts`

**Database Tables:**
- `market_price_momentum` (ClickHouse) - Caches TSI results
- `price_snapshots_10s` (ClickHouse) - Price history
- `trades_raw` (ClickHouse) - Recent trades for conviction

---

### 2. Top Wallets Endpoint ✅

**Endpoint:** `GET /api/wallets/top`

**Purpose:** Returns top-performing wallets ranked by Tier 1 metrics

**Query Parameters:**
- `window` ('30d' | '90d' | '180d' | 'lifetime', default: 'lifetime')
- `sortBy` ('omega' | 'pnl' | 'win_rate' | 'ev_per_bet' | 'resolved_bets', default: 'omega')
- `sortOrder` ('asc' | 'desc', default: 'desc')
- `limit` (number, default: 50, max: 500)
- `offset` (number, default: 0) - For pagination
- `minTrades` (number, default: 10) - Minimum trades to qualify

**Response:**
```typescript
{
  success: true
  wallets: [
    {
      wallet_address: string
      window: '30d' | '90d' | '180d' | 'lifetime'
      omega_gross: number
      omega_net: number
      net_pnl_usd: number
      hit_rate: number          // 0-1 (win rate)
      avg_win_usd: number
      avg_loss_usd: number
      ev_per_bet_mean: number
      resolved_bets: number
      win_loss_ratio: number    // avg_win / avg_loss
      total_volume_usd: number
    }
  ]
  total: number               // Total matching wallets
  window: string
  sortBy: string
  sortOrder: string
  limit: number
  offset: number
  metadata: {
    timestamp: string
    min_trades_filter: number
  }
}
```

**Example Request:**
```bash
GET /api/wallets/top?window=lifetime&sortBy=omega&sortOrder=desc&limit=50&offset=0&minTrades=10
```

**Features:**
- ✅ Multi-column sorting (5 metrics)
- ✅ Time window filtering (4 windows)
- ✅ Pagination support
- ✅ Minimum trades filter
- ✅ Returns total count for UI pagination
- ✅ Calculates win/loss ratio on-the-fly
- ✅ Filters out wallets with Omega <= 0

**Used By:**
- `components/top-wallets-table.tsx`
- `hooks/use-top-wallets.ts`

**Database Tables:**
- `wallet_metrics_complete` (ClickHouse) - Pre-calculated Tier 1 metrics

**Tier 1 Metrics Included:**
1. `metric_1_omega_gross` - Omega ratio (before fees)
2. `metric_2_omega_net` - Omega ratio (after fees) ⭐ PRIMARY
3. `metric_9_net_pnl_usd` - Total net P&L
4. `metric_12_hit_rate` - Win rate
5. `metric_13_avg_win_usd` - Average win size
6. `metric_14_avg_loss_usd` - Average loss size
7. `metric_15_ev_per_bet_mean` - Expected value per bet
8. `metric_22_resolved_bets` - Number of resolved bets

---

### 3. Austin Categories Endpoint ✅ (Pre-existing)

**Endpoint:** `GET /api/austin/categories`

**Purpose:** Returns category winnability analysis using Austin Methodology

**Query Parameters:**
- `window` ('24h' | '7d' | '30d' | 'lifetime', default: '30d')
- `limit` (number, default: 20)
- `winnableOnly` (boolean, default: false) - Only return "winnable games"

**Response:**
```typescript
{
  success: true
  count: number
  window: string
  limit: number
  winnableOnly: boolean
  categories: [
    {
      category: string
      categoryRank: number        // 1 = best category
      eliteWalletCount: number
      medianOmegaOfElites: number
      meanCLVOfElites: number     // Closing Line Value
      avgEVPerHour: number
      totalVolumeUsd: number
      avgMarketLiquidity: number
      activeMarketCount: number
      topMarkets: [
        {
          marketId: string
          question: string
          volume24h: number
          liquidity: number
          eliteParticipation: number
          avgEliteOmega: number
        }
      ]
      topSpecialists: [...]
      isWinnableGame: boolean     // Meets Austin's criteria
      winnabilityScore: number    // 0-100
      calculatedAt: string
    }
  ]
  metadata: {
    timestamp: string
    cached: boolean
  }
}
```

**Example Request:**
```bash
GET /api/austin/categories?window=30d&limit=20&winnableOnly=false
```

**Features:**
- ✅ Austin Methodology implementation
- ✅ Winnability scoring (0-100)
- ✅ "Winnable Game" criteria detection
- ✅ Elite wallet analysis
- ✅ Top markets per category
- ✅ Category specialist identification
- ✅ 5-minute cache

**Used By:**
- `components/category-leaderboard.tsx`
- `hooks/use-austin-methodology.ts`

**Database Tables:**
- `category_analytics` (ClickHouse) - Pre-calculated category stats
- `wallet_metrics_by_category` (ClickHouse) - Wallet performance by category
- `elite_trade_attributions` (ClickHouse) - Elite wallet activity

**Winnability Criteria (Austin's "Winnable Game"):**
- ✅ Elite wallet count ≥ 20
- ✅ Median Omega ≥ 2.0
- ✅ Mean CLV ≥ 2%
- ✅ Avg EV/hour ≥ $10
- ✅ Total volume ≥ $100k

**Winnability Score Formula (0-100):**
- Elite Count: `(count/50) × 25` points
- Median Omega: `(omega/5) × 25` points
- Mean CLV: `(clv/0.05) × 20` points
- EV per Hour: `(ev/20) × 20` points
- Total Volume: `(volume/1M) × 10` points

---

## 🔗 Data Pipeline Architecture

```
┌─────────────────┐
│  ClickHouse DB  │
│                 │
│ - trades_raw    │
│ - wallet_metrics│
│ - category_stats│
│ - price_history │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  API Endpoints  │
│                 │
│ /api/signals/   │
│ /api/wallets/   │
│ /api/austin/    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  React Hooks    │
│                 │
│ use-market-tsi  │
│ use-top-wallets │
│ use-austin      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  UI Components  │
│                 │
│ TSI Signal Card │
│ Top Wallets Tbl │
│ Category Board  │
└─────────────────┘
```

**Data Flow:**
1. **ClickHouse** stores all metrics (pre-calculated by scripts)
2. **API Endpoints** query ClickHouse and format responses
3. **React Hooks** fetch from APIs with React Query (caching, refetching)
4. **UI Components** consume hooks and display data

---

## 🚀 How to Connect Everything

### Step 1: Toggle Mock Data Off

In each hook, change `useMockData` to `false`:

**`hooks/use-market-tsi.ts`:**
```typescript
// Line ~45
const useMockData = false  // ✅ Changed from true
```

**`hooks/use-top-wallets.ts`:**
```typescript
// Line ~55
const useMockData = false  // ✅ Changed from true
```

**`hooks/use-austin-methodology.ts`:**
```typescript
// Already using real API ✅
```

### Step 2: Ensure Data Exists

Before switching to real data, ensure these tables have data:

**ClickHouse:**
```sql
-- Check trades
SELECT COUNT(*) FROM trades_raw;

-- Check wallet metrics
SELECT COUNT(*) FROM wallet_metrics_complete;

-- Check category analytics
SELECT COUNT(*) FROM category_analytics;

-- Check price snapshots
SELECT COUNT(*) FROM price_snapshots_10s;
```

**Required Scripts (in order):**
1. ✅ `discover-all-wallets-enhanced.ts` (Running now - 56k wallets)
2. ⏳ `sync-all-wallets-bulk.ts` (After discovery - populates trades_raw)
3. ⏳ `enrich-trades.ts` (After sync - calculates P&L)
4. ⏳ `calculate-tier1-metrics.ts` (After enrichment - populates wallet_metrics_complete)

### Step 3: Test Endpoints

**Test TSI Signal:**
```bash
curl "http://localhost:3000/api/signals/tsi/0x1234...?fresh=true"
```

**Test Top Wallets:**
```bash
curl "http://localhost:3000/api/wallets/top?window=lifetime&limit=10"
```

**Test Austin Categories:**
```bash
curl "http://localhost:3000/api/austin/categories?window=30d&limit=5"
```

### Step 4: View in Browser

**Demo Pages:**
- TSI Signals: `http://localhost:3000/demo/tsi-signals`
- Top Wallets: `http://localhost:3000/demo/top-wallets`
- Categories: `http://localhost:3000/demo/category-leaderboard`

---

## 📊 API Response Times (Expected)

| Endpoint | Cold (No Cache) | Warm (Cached) | Complexity |
|----------|----------------|---------------|------------|
| `/api/signals/tsi/[id]` | 200-500ms | 10-50ms | Medium (TSI calc) |
| `/api/wallets/top` | 100-300ms | 50-100ms | Low (simple query) |
| `/api/austin/categories` | 500-1000ms | 100-200ms | High (complex agg) |

**Optimization Notes:**
- TSI signals cached for 10 seconds
- Top wallets query is highly optimized (indexed columns)
- Austin categories uses 5-minute cache
- All endpoints use ClickHouse (columnar storage = fast aggregations)

---

## 🔧 Environment Variables Required

```bash
# ClickHouse
CLICKHOUSE_HOST=https://your-clickhouse-cloud.com:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your-password
CLICKHOUSE_DATABASE=cascadian

# Supabase (for wallet_scores table)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

## 🎯 Error Handling

All endpoints include:
- ✅ Try-catch blocks
- ✅ Detailed error messages
- ✅ 400 errors for invalid params
- ✅ 500 errors for server issues
- ✅ Console logging for debugging

**Example Error Response:**
```json
{
  "error": "Failed to fetch top wallets",
  "details": "Table wallet_metrics_complete does not exist"
}
```

---

## 🔄 Caching Strategy

| Endpoint | Cache TTL | Cache Location | Invalidation |
|----------|-----------|----------------|--------------|
| TSI Signals | 10 seconds | ClickHouse | Auto-refresh |
| Top Wallets | No cache | React Query (5 min) | Manual refetch |
| Austin Categories | 5 minutes | Library cache | Auto-refresh |

**React Query Settings:**
- TSI: `staleTime: 5s`, `refetchInterval: 10s`
- Top Wallets: `staleTime: 60s`, `refetchInterval: 5min`
- Austin: `staleTime: 5min`, handled by library

---

## ✅ Quality Checklist

- ✅ TypeScript typed responses
- ✅ Input validation
- ✅ Error handling
- ✅ Console logging
- ✅ Cache optimization
- ✅ Pagination support
- ✅ Sorting support
- ✅ Filtering support
- ✅ Database connection handling
- ✅ Query parameter parsing
- ✅ Response formatting
- ✅ Performance optimization

---

## 📝 Next Steps

1. **Wait for wallet discovery to complete** (~10 more min)
2. **Run bulk sync** (`sync-all-wallets-bulk.ts`) - populates `trades_raw`
3. **Run trade enrichment** (`enrich-trades.ts`) - calculates P&L
4. **Calculate Tier 1 metrics** (`calculate-tier1-metrics.ts`) - populates `wallet_metrics_complete`
5. **Toggle `useMockData = false`** in all hooks
6. **Test endpoints** with real data
7. **View demo pages** to see live data

---

## 🎉 Summary

**API Layer Complete!**

We now have a complete data pipeline:

```
ClickHouse → API Endpoints → React Hooks → UI Components
```

**3 Endpoints Built:**
1. ✅ `/api/signals/tsi/[marketId]` - TSI momentum signals
2. ✅ `/api/wallets/top` - Elite trader leaderboard
3. ✅ `/api/austin/categories` - Category winnability (pre-existing)

**Total Lines of Code:** ~340 lines across 2 new endpoints

**Ready to use as soon as data is populated!**

Just toggle `useMockData = false` and the entire system goes live with real ClickHouse data.
