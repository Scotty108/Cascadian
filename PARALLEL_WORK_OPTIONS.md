# Parallel Work Options (While Discovery Runs)

We have ~30-40 minutes while wallet discovery completes. Here's what we can build in parallel:

## 🎨 Option 1: Build UI Components (RECOMMENDED)

### What: Create React components to display the data

**High Priority Components:**

1. **TSI Signal Card** (`components/tsi-signal-card.tsx`)
   - Shows TSI crossover signal (BULLISH/BEARISH/NEUTRAL)
   - Displays conviction score with color coding
   - "Entry Signal" badge when conviction >= 0.9
   - Uses: TSI calculator + conviction calculator

2. **Category Leaderboard** (`components/category-leaderboard.tsx`)
   - Top categories by winnability score
   - "Winnable Game" badges
   - Elite wallet counts
   - Uses: Austin Methodology

3. **Top Wallets Table** (`components/top-wallets-table.tsx`)
   - Sortable by Omega, PnL, Win Rate
   - Filter by time window (30d/90d/180d/lifetime)
   - Pagination
   - Uses: Tier 1 metrics

4. **Market Momentum Chart** (`components/market-momentum-chart.tsx`)
   - TSI line chart (fast vs slow)
   - Crossover markers
   - Price overlay
   - Uses: TSI calculator

**Time Estimate:** 1-2 hours per component

---

## 🔌 Option 2: Build More API Endpoints

### What: REST APIs for frontend consumption

**High Priority Endpoints:**

1. **`/api/signals/live`** - Live TSI signals
   ```typescript
   GET /api/signals/live?marketId=0x123
   Returns: { tsi, conviction, signal: 'ENTRY' | 'EXIT' | 'HOLD' }
   ```

2. **`/api/wallets/top`** - Top performing wallets
   ```typescript
   GET /api/wallets/top?window=30d&limit=50
   Returns: Wallet[] with Tier 1 metrics
   ```

3. **`/api/markets/momentum`** - Markets with strong momentum
   ```typescript
   GET /api/markets/momentum?signal=BULLISH&minConviction=0.9
   Returns: Market[] with TSI + conviction
   ```

4. **`/api/notifications/subscribe`** - User signal subscriptions
   ```typescript
   POST /api/notifications/subscribe
   Body: { userId, categories, minConviction }
   ```

**Time Estimate:** 30-45 min per endpoint

---

## 🎣 Option 3: Build More React Hooks

### What: Data fetching hooks for UI

**High Priority Hooks:**

1. **`useTopWallets()`**
   ```typescript
   const { wallets, loading } = useTopWallets({ window: '30d', limit: 50 })
   ```

2. **`useTSISignals()`**
   ```typescript
   const { signals, loading } = useTSISignals({ marketIds: [...] })
   ```

3. **`useMarketMomentum()`**
   ```typescript
   const { tsi, conviction } = useMarketMomentum(marketId)
   ```

4. **`useLiveSignals()`** - WebSocket/polling for real-time
   ```typescript
   const { newSignals } = useLiveSignals({ categories: ['Politics'] })
   ```

**Time Estimate:** 20-30 min per hook

---

## 🧪 Option 4: Test With Sample Data

### What: Verify everything works with mock data

**High Priority Tests:**

1. **TSI Calculator Test**
   ```bash
   npx tsx lib/metrics/tsi-calculator.test.ts
   ```

2. **Conviction Calculator Test**
   ```bash
   npx tsx scripts/test-directional-conviction.ts
   ```

3. **Austin Methodology Test**
   ```bash
   npx tsx scripts/test-austin-methodology.ts
   ```

4. **Create Sample Data Script**
   - Generate realistic mock trades
   - Populate ClickHouse with sample data
   - Test entire pipeline without waiting

**Time Estimate:** 15-30 min total

---

## 📊 Option 5: Build Phase 2 Metrics (94 Remaining)

### What: Implement the other 94 metrics (beyond Tier 1's 8)

**Next Priority Tier 2 Metrics (8 metrics):**

1. `metric_5_sortino` - Sortino ratio (downside deviation)
2. `metric_6_sharpe` - Sharpe ratio (risk-adjusted returns)
3. `metric_7_martin` - Martin ratio (Ulcer Index based)
4. `metric_8_calmar` - Calmar ratio (CAGR / max drawdown)
5. `metric_17_max_drawdown` - Maximum equity drawdown
6. `metric_18_avg_drawdown` - Average drawdown depth
7. `metric_20_ulcer_index` - Downside volatility measure
8. `metric_24_bets_per_week` - Trading frequency

**Implementation:**
- Extend `calculate-tier1-metrics.ts` to `calculate-tier2-metrics.ts`
- Add ClickHouse formulas for each metric
- Test calculations

**Time Estimate:** 2-3 hours for all 8

---

## 🔔 Option 6: Build Notification System

### What: Alert users when high-conviction signals fire

**Components:**

1. **Signal Monitor** (`scripts/monitor-signals.ts`)
   - Polls for new TSI crossovers
   - Checks conviction scores
   - Triggers notifications when conviction >= 0.9

2. **Notification Delivery** (`lib/signals/notify.ts`)
   - Send email (via Resend/SendGrid)
   - Send push notification (via OneSignal)
   - Send webhook (for Discord/Slack)
   - Log to `signal_delivery_log` table

3. **User Preferences UI** (`app/(dashboard)/settings/notifications`)
   - Set minimum conviction threshold
   - Choose categories to watch
   - Configure delivery methods

**Time Estimate:** 1-2 hours

---

## 📈 Option 7: Build Admin Dashboard

### What: Monitor pipeline health and data status

**Dashboard Sections:**

1. **Data Status**
   - Wallets discovered
   - Trades synced
   - Metrics calculated
   - Last sync times

2. **Pipeline Health**
   - Sync errors
   - Enrichment completion %
   - Missing data alerts

3. **Performance Metrics**
   - Query response times
   - Cache hit rates
   - API usage stats

**Implementation:**
```
app/(dashboard)/admin/
├── page.tsx              # Main dashboard
├── data-status.tsx       # Data counts
├── pipeline-health.tsx   # Error tracking
└── performance.tsx       # Speed metrics
```

**Time Estimate:** 2-3 hours

---

## 🚀 RECOMMENDED: Start with UI Components

**Why:**
1. Backend is 100% ready
2. Most visible/impressive progress
3. Ready to demo when data loads
4. Can use mock data for now

**Suggested Order:**
1. TSI Signal Card (30 min) - Most impactful
2. Top Wallets Table (45 min) - Core feature
3. Category Leaderboard (30 min) - Uses Austin Methodology

**Total Time:** ~2 hours
**Result:** Complete frontend for 3 main features!

---

## Alternative: Quick Wins (30 min total)

If you want to see immediate results:

1. **Test All Systems** (10 min)
   ```bash
   npx tsx lib/metrics/tsi-calculator.test.ts
   npx tsx scripts/test-directional-conviction.ts
   npx tsx scripts/test-austin-methodology.ts
   ```

2. **Build One React Hook** (15 min)
   ```typescript
   // hooks/use-top-wallets.ts
   export function useTopWallets(window: '30d' | '90d' | '180d' | 'lifetime') {
     return useQuery({
       queryKey: ['top-wallets', window],
       queryFn: () => fetch(`/api/wallets/top?window=${window}`)
     })
   }
   ```

3. **Create One API Endpoint** (5 min)
   ```typescript
   // app/api/wallets/top/route.ts
   export async function GET(request: Request) {
     // Query ClickHouse wallet_metrics_complete
     // Return top 50 by omega
   }
   ```

**Result:** Full data pipeline from ClickHouse → API → React Hook → UI

---

## My Recommendation

**Build the TSI Signal Card first** (30 min) because:
- ✅ Uses both TSI + Conviction calculators (shows integration)
- ✅ Most visually impressive
- ✅ Core feature for momentum trading
- ✅ Can demo with mock data immediately
- ✅ Foundation for other components

Want me to build it now?
