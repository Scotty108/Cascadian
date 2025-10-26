# CASCADIAN - Action Plan to Full Functionality

## Current Status (2025-10-25)

### ✅ Completed
- [x] Database schema designed (20 tables: 13 ClickHouse + 8 Supabase - but really more in Supabase)
- [x] All migrations created and applied
- [x] ClickHouse Cloud connected (13 migrations applied)
- [x] Supabase tables created (8 new TSI tables)
- [x] Default TSI config set (9p/21p RMA, 0.9 conviction)
- [x] 5,322 wallet scores already in Supabase

### ⚠️ Missing Data
- [ ] 0 discovered wallets in `discovered_wallets` table
- [ ] 0 trades in ClickHouse `trades_raw` table
- [ ] 0 calculated metrics in metric tables

### ⚠️ Missing Implementation
- [ ] TSI calculator + smoothing library
- [ ] Tier 1 metrics implementation (8 critical)
- [ ] Austin Methodology materialized view
- [ ] Directional conviction calculator

---

## Phase 1: Data Population (Week 1)

### Step 1: Wallet Discovery ⏱️ ~30 min
**Goal:** Populate `discovered_wallets` table with all Polymarket wallets (no 50k cap)

```bash
npx tsx scripts/discover-all-wallets-enhanced.ts
```

**Expected output:**
- Discovers wallets from 3 sources:
  - PnL subgraph
  - Markets database
  - Activity subgraph
- Populates `discovered_wallets` table
- Creates sync queue with priority scoring

**Verification:**
```sql
-- Supabase
SELECT COUNT(*) FROM discovered_wallets;
SELECT source, COUNT(*) FROM wallets_by_source GROUP BY source;
```

---

### Step 2: Bulk Sync Wallet Trades ⏱️ ~2-4 hours
**Goal:** Sync historical trades for all discovered wallets to ClickHouse

```bash
npx tsx scripts/sync-all-wallets-bulk.ts
```

**Expected output:**
- Fetches `OrderFilledEvent` data from Goldsky for each wallet
- Inserts trades into ClickHouse `trades_raw` table
- Updates `wallet_sync_metadata` with progress
- Handles errors gracefully (retries up to 3x)

**Verification:**
```sql
-- ClickHouse
SELECT COUNT(*) FROM trades_raw;
SELECT wallet_address, COUNT(*) as trades
FROM trades_raw
GROUP BY wallet_address
ORDER BY trades DESC
LIMIT 10;
```

---

### Step 3: Calculate Tier 1 Metrics ⏱️ ~1 hour
**Goal:** Calculate the 8 most critical metrics for all wallets

**8 Critical Metrics:**
1. `metric_1_omega_gross` - Omega ratio (gross)
2. `metric_2_omega_net` - Omega ratio (net of fees)
3. `metric_9_net_pnl_usd` - Total net P&L
4. `metric_12_hit_rate` - Win rate
5. `metric_13_avg_win_usd` - Average win size
6. `metric_14_avg_loss_usd` - Average loss size
7. `metric_15_ev_per_bet_mean` - Expected value per bet
8. `metric_22_resolved_bets` - Number of resolved bets

**Script to create:**
```bash
npx tsx scripts/calculate-tier1-metrics.ts
```

**What it does:**
- Reads trades from ClickHouse `trades_raw`
- Calculates metrics for each wallet across 4 windows (30d/90d/180d/lifetime)
- Inserts into `wallet_metrics_complete` table
- Also populates `wallet_metrics_by_category` (category-specific metrics)

**Verification:**
```sql
-- ClickHouse
SELECT COUNT(*) FROM wallet_metrics_complete;
SELECT
  wallet_address,
  window,
  metric_2_omega_net,
  metric_12_hit_rate,
  metric_22_resolved_bets
FROM wallet_metrics_complete
WHERE window = 'lifetime'
ORDER BY metric_2_omega_net DESC
LIMIT 10;
```

---

## Phase 2: TSI Momentum Strategy (Week 2)

### Step 4: Implement Smoothing Library ⏱️ ~2 hours
**File:** `lib/metrics/smoothing.ts`

**Functions to implement:**
```typescript
export function sma(values: number[], period: number): number[];
export function ema(values: number[], period: number): number[];
export function rma(values: number[], period: number): number[];
export function getSmoothing(method: 'SMA' | 'EMA' | 'RMA'): (values: number[], period: number) => number[];
```

**Implementation notes:**
- SMA: Simple Moving Average
- EMA: Exponential Moving Average (alpha = 2/(period+1))
- RMA: Running Moving Average / Wilder's smoothing (alpha = 1/period)
- Runtime configurable based on `smoothing_configurations` table

---

### Step 5: Implement TSI Calculator ⏱️ ~3 hours
**File:** `lib/metrics/tsi-calculator.ts`

**Main function:**
```typescript
export interface TSIConfig {
  fastPeriods: number;
  fastSmoothing: 'SMA' | 'EMA' | 'RMA';
  slowPeriods: number;
  slowSmoothing: 'SMA' | 'EMA' | 'RMA';
}

export interface TSIResult {
  tsiFast: number;
  tsiSlow: number;
  crossoverSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  crossoverTimestamp?: Date;
}

export async function calculateTSI(
  marketId: string,
  priceHistory: PricePoint[],
  config: TSIConfig
): Promise<TSIResult>;
```

**What it does:**
1. Fetches price history from `market_price_history`
2. Calculates momentum (price changes)
3. Applies double smoothing using configured method
4. Detects crossovers (bullish/bearish)
5. Updates `market_price_momentum` table

**Verification:**
```sql
-- ClickHouse
SELECT
  market_id,
  tsi_fast,
  tsi_slow,
  crossover_signal,
  crossover_timestamp
FROM market_price_momentum
WHERE crossover_signal != 'NEUTRAL'
ORDER BY updated_at DESC
LIMIT 20;
```

---

### Step 6: Implement Directional Conviction ⏱️ ~4 hours
**File:** `lib/metrics/directional-conviction.ts`

**Formula:**
```
directional_conviction =
  0.50 * elite_consensus_pct +
  0.30 * category_specialist_pct +
  0.20 * omega_weighted_consensus
```

**Main function:**
```typescript
export interface ConvictionResult {
  directionalConviction: number; // 0-1 score
  eliteConsensusPct: number;     // % of elite wallets on this side
  categorySpecialistPct: number; // % of category specialists
  omegaWeightedConsensus: number; // Omega-weighted vote
  meetsEntryThreshold: boolean;  // conviction >= 0.9
}

export async function calculateDirectionalConviction(
  marketId: string,
  side: 'YES' | 'NO',
  recentTrades: Trade[]
): Promise<ConvictionResult>;
```

**What it does:**
1. Identifies elite wallets (Omega > 2.0) who recently traded this market
2. Identifies category specialists for this market's category
3. Calculates omega-weighted consensus
4. Combines into conviction score
5. Updates `momentum_trading_signals` table

---

### Step 7: Build Austin Methodology View ⏱️ ~3 hours
**File:** `lib/metrics/austin-methodology.ts`

**Purpose:** Top-down category analysis to find "winnable games"

**Main function:**
```typescript
export interface CategoryAnalysis {
  category: string;
  eliteWalletCount: number;
  medianOmegaOfElites: number;
  meanCLVOfElites: number;
  avgEVPerHour: number;
  topMarkets: MarketAnalysis[];
  categoryRank: number; // 1 = best category
}

export async function analyzeCategories(): Promise<CategoryAnalysis[]>;
```

**What it does:**
1. Reads from `category_analytics` ClickHouse table
2. Ranks categories by elite performance
3. Identifies top markets within each category
4. Generates "winnable games" recommendations
5. Can be materialized as a view or cached in Redis

**Output:**
```typescript
[
  {
    category: 'Politics',
    eliteWalletCount: 342,
    medianOmegaOfElites: 3.2,
    meanCLVOfElites: 0.045,
    avgEVPerHour: 12.5,
    categoryRank: 1,
    topMarkets: [...]
  },
  // ... other categories
]
```

---

## Phase 3: Live Signals Pipeline (Week 3)

### Step 8: Real-Time Price Snapshots ⏱️ ~2 hours
**Script:** `scripts/collect-price-snapshots.ts`

**What it does:**
- Polls Polymarket API every 10 seconds
- Collects prices for watchlist markets (~100)
- Inserts into `price_snapshots_10s` table
- Runs continuously in background

---

### Step 9: Signal Generation Pipeline ⏱️ ~4 hours
**Script:** `scripts/generate-momentum-signals.ts`

**What it does:**
1. Runs every 10 seconds
2. Fetches latest price snapshots
3. Calculates TSI for each market
4. Detects crossovers
5. Calculates directional conviction
6. Generates ENTRY/EXIT/HOLD signals
7. Inserts into `momentum_trading_signals` table
8. Triggers user notifications (if conviction >= 0.9)

---

### Step 10: Signal Delivery System ⏱️ ~3 hours
**File:** `lib/signals/signal-delivery.ts`

**What it does:**
- Reads user preferences from `user_signal_preferences`
- Filters signals by user criteria
- Delivers via push/email/webhook
- Logs delivery in `signal_delivery_log`
- Tracks user actions (viewed, clicked, traded)

---

## Verification Checklist

### After Phase 1:
```bash
# Run verification
npx tsx scripts/verify-database-setup.ts

# Expected:
# ✅ trades_raw: 100,000+ rows
# ✅ wallet_metrics_complete: 5,000+ rows
# ✅ discovered_wallets: 10,000+ rows
```

### After Phase 2:
```sql
-- ClickHouse: Check TSI signals
SELECT COUNT(*) FROM momentum_trading_signals;
SELECT * FROM momentum_trading_signals
WHERE signal_type = 'ENTRY'
  AND meets_entry_threshold = 1
ORDER BY fired_at DESC
LIMIT 10;
```

### After Phase 3:
```bash
# Test live signal delivery
npx tsx scripts/test-live-signals.ts

# Expected:
# ✅ Price snapshots collecting (10s interval)
# ✅ TSI calculated for watchlist markets
# ✅ Signals generated when conviction >= 0.9
# ✅ Notifications delivered to users
```

---

## Priority Order (Recommended)

**Week 1 - Get Data Flowing:**
1. ✅ Run wallet discovery → `discover-all-wallets-enhanced.ts`
2. ✅ Bulk sync trades → `sync-all-wallets-bulk.ts`
3. ✅ Calculate Tier 1 metrics → `calculate-tier1-metrics.ts`

**Week 2 - Build TSI System:**
4. 📝 Implement smoothing library → `lib/metrics/smoothing.ts`
5. 📝 Implement TSI calculator → `lib/metrics/tsi-calculator.ts`
6. 📝 Implement directional conviction → `lib/metrics/directional-conviction.ts`

**Week 3 - Live Signals:**
7. 📝 Build Austin Methodology view → `lib/metrics/austin-methodology.ts`
8. 📝 Price snapshot collection → `scripts/collect-price-snapshots.ts`
9. 📝 Signal generation pipeline → `scripts/generate-momentum-signals.ts`
10. 📝 Signal delivery system → `lib/signals/signal-delivery.ts`

---

## Quick Start (Right Now!)

```bash
# 1. Verify everything is set up
npx tsx scripts/verify-database-setup.ts

# 2. Run wallet discovery (30 min)
npx tsx scripts/discover-all-wallets-enhanced.ts

# 3. Bulk sync trades (2-4 hours) - can run overnight
npx tsx scripts/sync-all-wallets-bulk.ts

# 4. Calculate metrics (1 hour)
npx tsx scripts/calculate-tier1-metrics.ts

# 5. Verify data populated
npx tsx scripts/verify-database-setup.ts
```

After Step 5, you'll have a fully populated database ready for TSI implementation!
