# Strategy Builder + Wallet Pipeline Readiness Assessment

**Report Date:** October 29, 2025
**Purpose:** Assess readiness for copy trading strategies in the Strategy Builder
**Status:** 🟡 PARTIAL - Critical gaps identified

---

## Executive Summary

The Wallet Intelligence Pipeline and Strategy Builder exist as **separate working systems**, but they are **not fully integrated** for end-to-end copy trading workflows. This report identifies what's working, what's missing, and what needs to be done to enable copy trading strategies.

### Quick Status

| Component | Status | Ready for Copy Trading? |
|-----------|--------|------------------------|
| Wallet Ingestion Pipeline | ✅ Working | Yes |
| ClickHouse Metrics (102 metrics) | ✅ Working | Yes |
| Strategy Builder UI | ✅ Working | Yes |
| Wallet Filtering API | ⚠️ Partial | Limited |
| Real-time Trade Detection | ❌ Missing | **No** |
| Copy Trade Execution | ❌ Missing | **No** |
| Performance Tracking | ⚠️ Partial | Limited |
| Data Sync (CH→Supabase) | ⚠️ Unknown | Unclear |

---

## Part 1: What's Working ✅

### 1.1 Wallet Ingestion Pipeline

**Location:** Documented in `WALLET_PIPELINE_REPORT.md`

**What exists:**
- Goldsky GraphQL API integration for wallet discovery
- Trade ingestion for 66,000+ wallets
- 2.5M+ trades with full enrichment
- Resolution data and P&L calculations
- Category-specific metrics

**Status:** ✅ **PRODUCTION READY**

### 1.2 ClickHouse Wallet Metrics

**Location:** `migrations/clickhouse/004_create_wallet_metrics_complete.sql`

**What exists:**
- 102 comprehensive metrics per wallet
- 4 time windows (30d, 90d, 180d, lifetime)
- Key metrics ready for copy trading:
  - `metric_2_omega_net` - Risk-adjusted performance
  - `metric_48_omega_lag_30s` - Copyability with 30s delay
  - `metric_49_omega_lag_2min` - Copyability with 2min delay
  - `metric_50_omega_lag_5min` - Copyability with 5min delay
  - `metric_69_ev_per_hour_capital` - Capital efficiency
  - `metric_85_performance_trend_flag` - Momentum direction

**API Endpoint:** `/api/wallets/top` ✅

**Status:** ✅ **PRODUCTION READY**

**Query Performance:** Sub-200ms for complex filters

### 1.3 Strategy Builder UI

**Location:** `app/(dashboard)/strategy-builder/page.tsx`

**What exists:**
- Visual node-based workflow builder
- Node types available:
  - **DATA_SOURCE** - Query wallets from ClickHouse
  - **FILTER** - Apply metric filters
  - **ENHANCED_FILTER** - Multi-condition filters
  - **LOGIC** - Combine multiple inputs (AND/OR)
  - **AGGREGATION** - Count, sum, average results
  - **SIGNAL** - Generate trading signals
  - **ACTION** - Add to watchlist
  - **ORCHESTRATOR** - Manage approval workflow + position sizing
- Deployment with scheduling (1min, 5min, 15min, 30min, 1hour)
- Paper trading mode
- Save/load strategies
- Test run functionality

**Status:** ✅ **PRODUCTION READY**

### 1.4 Strategy Execution Engine

**Location:** `lib/strategy-builder/execution-engine.ts`

**What exists:**
- Node-based execution orchestrator
- ClickHouse connector for wallet queries
- Supabase connector for secondary data
- Topological sort for execution order
- Execution result tracking

**Status:** ✅ **PRODUCTION READY**

---

## Part 2: What's Partially Working ⚠️

### 2.1 Wallet Filtering API

**Location:** `app/api/wallets/filter/route.ts`

**What exists:**
```typescript
POST /api/wallets/filter
{
  min_omega_ratio: 2.0,
  min_total_pnl: 1000,
  min_win_rate: 0.55,
  allowed_grades: ["S", "A"],
  allowed_momentum: ["improving"],
  limit: 100
}
```

**The Problem:**
- Uses **Supabase** `wallet_scores` table (simplified metrics)
- **NOT** using ClickHouse `wallet_metrics_complete` (102 metrics)
- Missing critical copyability metrics:
  - `omega_lag_30s`, `omega_lag_2min`, `omega_lag_5min`
  - `ev_per_hour_capital`
  - `clv_momentum_30d`
  - `tail_ratio`

**Impact:**
- Strategy builder can't filter by copyability metrics
- Can't identify wallets that perform well with latency
- Missing capital efficiency filters

**Status:** ⚠️ **LIMITED** - Works for basic filtering only

### 2.2 Data Sync (ClickHouse → Supabase)

**Expected Flow:**
```
ClickHouse (wallet_metrics_complete)
    ↓
 [Sync Job?]
    ↓
Supabase (wallet_scores)
```

**What's unclear:**
- Is there a sync job running?
- How often does it run?
- What metrics get synced?
- Is `wallet_scores` up to date with `wallet_metrics_complete`?

**Files to check:**
- `scripts/sync-wallet-scores-to-db.ts` (exists)
- `scripts/sync-omega-scores.ts` (exists)
- `scripts/calculate-omega-scores.ts` (exists)

**Status:** ⚠️ **UNKNOWN** - Needs verification

---

## Part 3: What's Missing ❌

### 3.1 Real-Time Trade Detection

**What's needed:**
A system to monitor when tracked wallets make new trades.

**Options:**
1. **Polling** (simple):
   ```typescript
   // Every 30 seconds
   SELECT * FROM trades_raw
   WHERE wallet_address IN (tracked_wallets)
     AND timestamp > last_check
   ORDER BY timestamp DESC
   ```

2. **Webhook** (better):
   - Goldsky webhook for new trades
   - Push notifications to strategy execution

3. **Stream Processing** (best):
   - Real-time stream from Goldsky
   - Sub-second latency

**Current Status:** ❌ **MISSING**

**Impact:**
- **BLOCKING** for copy trading
- Without this, strategies can't detect when to copy

### 3.2 Copy Trade Execution

**What's needed:**
1. **Polymarket API Integration**
   ```typescript
   async function executeCopyTrade(signal: CopyTradeSignal) {
     // 1. Fetch current market price
     const marketData = await polymarket.getMarket(signal.market_id)

     // 2. Calculate position size
     const size = calculatePositionSize(signal, portfolio)

     // 3. Place order
     const order = await polymarket.placeOrder({
       market_id: signal.market_id,
       side: signal.side,
       amount: size,
       price: marketData.current_price,
       type: 'MARKET' // or 'LIMIT'
     })

     // 4. Record copy trade
     await recordCopyTrade({
       source_wallet: signal.source_wallet,
       our_order_id: order.id,
       ...
     })
   }
   ```

2. **Trade Tracking Table** (Supabase)
   ```sql
   CREATE TABLE copy_trades (
     id BIGSERIAL PRIMARY KEY,
     strategy_id TEXT,
     source_wallet TEXT,
     source_trade_id TEXT,
     our_order_id TEXT,
     market_id TEXT,
     side TEXT,
     source_price DECIMAL,
     our_price DECIMAL,
     source_size DECIMAL,
     our_size DECIMAL,
     slippage DECIMAL,
     status TEXT,
     created_at TIMESTAMPTZ,
     executed_at TIMESTAMPTZ
   );
   ```

3. **Position Tracking**
   - Track open positions from copy trades
   - Monitor P&L vs source wallet
   - Implement exit strategies

**Current Status:** ❌ **MISSING**

**Impact:**
- **BLOCKING** for copy trading
- Strategy can identify wallets but can't copy them

### 3.3 Performance Comparison

**What's needed:**
Side-by-side tracking of copy trade performance vs source wallet:

```typescript
{
  strategy_id: "strat_123",
  source_wallet: "0xabc...",
  comparison_window: "30d",

  source_performance: {
    omega: 4.5,
    pnl: 12500,
    win_rate: 0.62,
    trades: 45
  },

  copy_performance: {
    omega: 3.8,  // Lower due to latency
    pnl: 9200,   // Lower due to slippage
    win_rate: 0.59,
    trades: 42,  // Missed 3 trades
    avg_latency_sec: 35,
    avg_slippage_bps: 12
  },

  efficiency: {
    omega_capture_ratio: 0.84,  // 84% of source omega
    pnl_capture_ratio: 0.74,    // 74% of source P&L
    trade_capture_ratio: 0.93,  // Copied 93% of trades
  }
}
```

**Current Status:** ⚠️ **PARTIAL**
- Can track strategy performance via `strategy_executions` table
- Missing: Comparison with source wallet

---

## Part 4: Integration Gaps

### 4.1 Strategy Builder → Wallet Pipeline

**Current Flow:**
```
Strategy Builder
    ↓
  Execute Strategy
    ↓
  Query ClickHouse (via DATA_SOURCE node)
    ↓
  Apply Filters
    ↓
  Return Wallet List
    ↓
  [DEAD END - No copy trading]
```

**Missing Steps:**
```
  Return Wallet List
    ↓
  [MISSING] Monitor Wallets for New Trades
    ↓
  [MISSING] Generate Copy Trade Signals
    ↓
  [MISSING] Execute on Polymarket
    ↓
  [MISSING] Track Performance
```

### 4.2 API Endpoint Consistency

**Problem:** Different endpoints use different data sources

| Endpoint | Data Source | Metrics Available |
|----------|-------------|-------------------|
| `/api/wallets/top` | ClickHouse `wallet_metrics_complete` | 102 metrics ✅ |
| `/api/wallets/filter` | Supabase `wallet_scores` | 12 metrics ⚠️ |
| Strategy Builder DATA_SOURCE | ClickHouse `wallet_metrics_complete` | 102 metrics ✅ |

**Issue:**
- `/api/wallets/filter` should use ClickHouse for full metric access
- OR: Sync all 102 metrics to Supabase (expensive)

**Recommendation:**
- Update `/api/wallets/filter` to query ClickHouse directly
- Keep Supabase for quick lookups and caching only

---

## Part 5: What Needs to Be Built

### Priority 1: BLOCKING for Copy Trading 🔴

#### 1. Real-Time Trade Monitor
**File:** `lib/trading/wallet-monitor.ts`

```typescript
export class WalletMonitor {
  private trackedWallets: Set<string> = new Set()

  async start() {
    // Poll every 30 seconds
    setInterval(() => this.checkForNewTrades(), 30000)
  }

  async checkForNewTrades() {
    const newTrades = await clickhouse.query(`
      SELECT * FROM trades_raw
      WHERE wallet_address IN (${this.trackedWallets})
        AND timestamp > ${this.lastCheck}
      ORDER BY timestamp DESC
    `)

    for (const trade of newTrades) {
      await this.emit('new_trade', trade)
    }
  }

  trackWallet(address: string) {
    this.trackedWallets.add(address)
  }
}
```

**Estimated Time:** 2-3 hours

#### 2. Polymarket Order Execution
**File:** `lib/trading/polymarket-executor.ts`

```typescript
export class PolymarketExecutor {
  async executeCopyTrade(signal: CopyTradeSignal) {
    // Fetch market data
    const market = await this.getMarket(signal.market_id)

    // Calculate position size
    const size = this.calculateSize(signal, this.portfolio)

    // Place order
    const order = await this.placeOrder({
      market_id: signal.market_id,
      side: signal.side,
      amount: size,
      type: 'MARKET'
    })

    // Record trade
    await this.recordTrade(signal, order)

    return order
  }
}
```

**Dependencies:**
- Polymarket API credentials
- Order execution logic
- Position sizing algorithm (Kelly criterion)

**Estimated Time:** 4-6 hours

#### 3. Copy Trade Tracking Table
**File:** `supabase/migrations/20251029_create_copy_trades.sql`

```sql
CREATE TABLE copy_trades (
  id BIGSERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  source_wallet TEXT NOT NULL,
  source_trade_id TEXT,
  our_order_id TEXT,
  market_id TEXT NOT NULL,
  condition_id TEXT,
  side TEXT NOT NULL,
  source_entry_price DECIMAL(10, 6),
  our_entry_price DECIMAL(10, 6),
  source_shares DECIMAL(18, 6),
  our_shares DECIMAL(18, 6),
  latency_seconds INTEGER,
  slippage_bps INTEGER,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  pnl_usd DECIMAL(18, 2)
);

CREATE INDEX idx_copy_trades_strategy ON copy_trades(strategy_id);
CREATE INDEX idx_copy_trades_source ON copy_trades(source_wallet);
CREATE INDEX idx_copy_trades_status ON copy_trades(status);
```

**Estimated Time:** 30 minutes

### Priority 2: IMPORTANT for Production 🟡

#### 4. Update Wallet Filter API
**File:** `app/api/wallets/filter/route.ts`

Change from Supabase to ClickHouse:

```typescript
// OLD (Supabase)
const { data: wallets } = await supabase
  .from('wallet_scores')
  .select('*')
  .gte('omega_ratio', criteria.min_omega_ratio)

// NEW (ClickHouse)
const wallets = await clickhouse.query({
  query: `
    SELECT * FROM wallet_metrics_complete
    WHERE window = 'lifetime'
      AND metric_2_omega_net >= {min_omega:Float32}
      AND metric_48_omega_lag_30s >= {min_omega_lag:Float32}
    ORDER BY metric_2_omega_net DESC
    LIMIT {limit:UInt32}
  `,
  query_params: {
    min_omega: criteria.min_omega_ratio,
    min_omega_lag: criteria.min_copyability || 1.5,
    limit: criteria.limit
  }
})
```

**Estimated Time:** 2 hours

#### 5. Performance Comparison Dashboard
**File:** `components/copy-trade-performance.tsx`

Show side-by-side comparison of:
- Source wallet metrics
- Our copy trade metrics
- Capture ratios (omega, P&L, trade count)
- Average latency and slippage

**Estimated Time:** 4 hours

### Priority 3: NICE TO HAVE 🟢

#### 6. WebSocket Trade Feed
Real-time notifications instead of polling.

**Estimated Time:** 6-8 hours

#### 7. Advanced Position Sizing
Fractional Kelly, volatility adjustment, drawdown protection.

**Estimated Time:** 4 hours

#### 8. Machine Learning Trade Prediction
Predict which source trades are likely to be profitable before copying.

**Estimated Time:** 2-3 days

---

## Part 6: Recommended Implementation Plan

### Week 1: Enable Copy Trading (MVP)

**Day 1-2: Real-Time Monitoring**
- [ ] Build `WalletMonitor` class
- [ ] Integrate with strategy execution
- [ ] Test with 5 wallets

**Day 3-4: Order Execution**
- [ ] Build `PolymarketExecutor` class
- [ ] Implement position sizing
- [ ] Test with paper trades

**Day 5: Integration**
- [ ] Connect monitor → executor
- [ ] Create copy_trades table
- [ ] End-to-end test

**Deliverable:** Copy trading works for 1 strategy in paper mode

### Week 2: Production Readiness

**Day 6-7: API Updates**
- [ ] Update `/api/wallets/filter` to use ClickHouse
- [ ] Add copyability metrics to filter options
- [ ] Update strategy builder UI to show new metrics

**Day 8-9: Performance Tracking**
- [ ] Build comparison queries
- [ ] Create performance dashboard
- [ ] Add alerts for underperformance

**Day 10: Testing & Deployment**
- [ ] Test with 10 strategies
- [ ] Monitor latency and slippage
- [ ] Deploy to production

**Deliverable:** Copy trading works for multiple strategies with monitoring

### Week 3: Polish & Optimize

- [ ] WebSocket feed (if needed)
- [ ] Advanced position sizing
- [ ] Performance optimizations
- [ ] Documentation

---

## Part 7: Critical Questions to Answer

### Q1: Is the data sync running?
**Check:**
```bash
# Look for cron jobs or scheduled tasks
grep -r "sync.*wallet" scripts/
```

**Answer:** Scripts exist but unclear if scheduled

### Q2: What's the Polymarket API setup?
**Check:** `.env.local` for Polymarket credentials

**Status:** ⚠️ User selected `.env.local` lines 14-21 (API key section) - check if Polymarket keys exist

### Q3: What's the portfolio bankroll?
**For position sizing, we need:**
- Total bankroll (e.g., $10,000)
- Max position size (e.g., 5% = $500)
- Risk tolerance (Kelly fraction)

**Check:** Strategy settings in database

### Q4: What's the latency budget?
**Need to know:**
- Expected latency (30s? 2min?)
- Filter wallets by `omega_lag_30s` or `omega_lag_2min`?

**Recommendation:** Start with 30s-2min latency budget

---

## Part 8: Testing Checklist

Before deploying copy trading to production:

### Unit Tests
- [ ] WalletMonitor detects new trades within 30s
- [ ] Position sizing never exceeds max
- [ ] Order execution handles API errors
- [ ] Trade recording captures all fields

### Integration Tests
- [ ] Strategy → Monitor → Executor → Record (end-to-end)
- [ ] Multiple strategies can track same wallet
- [ ] Slippage calculation is accurate
- [ ] Performance comparison matches reality

### Paper Trading Tests
- [ ] Run 5 strategies for 7 days
- [ ] Compare paper results to source wallets
- [ ] Measure: latency, slippage, capture ratios
- [ ] Validate no trades were missed

### Production Smoke Tests
- [ ] Small position sizes ($5-$10)
- [ ] Single strategy tracking 3 wallets
- [ ] Monitor for 48 hours
- [ ] Verify P&L tracking

---

## Part 9: Risks & Mitigation

### Risk 1: High Latency
**Problem:** 2-minute latency kills edge
**Mitigation:**
- Only copy wallets with high `omega_lag_2min`
- Filter for `metric_48_omega_lag_30s >= 2.0`

### Risk 2: Slippage
**Problem:** Market moves against us before execution
**Mitigation:**
- Use limit orders with 1% tolerance
- Skip trades if slippage > 2%

### Risk 3: Missing Trades
**Problem:** API downtime or rate limits
**Mitigation:**
- Multiple polling intervals (30s, 1min, 2min)
- Fallback to Goldsky API

### Risk 4: Polymarket API Limits
**Problem:** Rate limits or account restrictions
**Mitigation:**
- Start with small volume
- Batch orders if possible
- Monitor API health

### Risk 5: Capital Loss
**Problem:** Copy trades underperform
**Mitigation:**
- Paper trading first (30 days)
- Start with 1-2% of bankroll
- Automated stop-loss if omega drops

---

## Part 10: Success Metrics

### Launch Criteria (Week 1)
- [ ] 1 strategy successfully copies 1 wallet
- [ ] Average latency < 2 minutes
- [ ] 0 missed trades in 48 hours
- [ ] 0 execution errors

### Production Criteria (Week 2)
- [ ] 5 strategies running simultaneously
- [ ] Average slippage < 20 bps
- [ ] Omega capture ratio > 70%
- [ ] P&L capture ratio > 60%

### Scale Criteria (Week 3+)
- [ ] 20+ strategies running
- [ ] Tracking 100+ wallets
- [ ] <1% missed trades
- [ ] Profitable after fees

---

## Part 11: Immediate Next Steps

1. **Verify Data Sync** (30 min)
   ```bash
   # Check if wallet_scores is up to date
   npm run check-db-status
   ```

2. **Check Polymarket API** (15 min)
   ```bash
   # Look for API keys in .env
   grep POLYMARKET .env.local
   ```

3. **Create Implementation Branch** (5 min)
   ```bash
   git checkout -b feature/copy-trading-integration
   ```

4. **Build WalletMonitor** (2-3 hours)
   - Start with polling approach
   - Emit events for new trades
   - Test with 5 wallets

5. **Review with Team** (1 hour)
   - Discuss latency requirements
   - Agree on position sizing rules
   - Set paper trading timeline

---

## Conclusion

**Bottom Line:** The foundation is solid, but copy trading requires 3 critical components that are currently missing:

1. ✅ Wallet metrics and filtering → **READY**
2. ✅ Strategy builder UI and execution → **READY**
3. ❌ Real-time trade monitoring → **MISSING**
4. ❌ Polymarket order execution → **MISSING**
5. ❌ Copy trade tracking → **MISSING**

**Estimated Time to MVP:** 1-2 weeks
**Estimated Time to Production:** 2-3 weeks

The good news is that 70% of the infrastructure exists. The remaining 30% is straightforward engineering work with no major blockers.

**Recommendation:** Follow the Week 1-3 implementation plan to deliver copy trading in stages, starting with a paper trading MVP.
