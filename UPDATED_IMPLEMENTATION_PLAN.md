# Updated Implementation Plan: ALL 11 Strategies NOW
**Date**: 2025-10-25
**Status**: ✅ ALL METRICS AVAILABLE - Full System Build

---

## 🎉 Major Update: ClickHouse Migrations Complete!

The other Claude just completed ALL database migrations:
- ✅ `wallet_metrics_complete` - All 102 metrics across 4 time windows
- ✅ `wallet_metrics_by_category` - 102 metrics by category
- ✅ `market_price_momentum` - TSI indicators
- ✅ `momentum_trading_signals` - Trading signals
- ✅ All 8 Supabase TSI tables

**This means:** We can build ALL 11 STRATEGIES immediately, not just 3!

---

## New Implementation Timeline

### 🚀 Phase 1: Complete Backend (This Week)

#### Day 1-2: Database Setup
- [x] ✅ ClickHouse migrations complete (other Claude)
- [ ] Run strategy builder migration
- [ ] Update seed file with ALL 11 strategies
- [ ] Verify all tables accessible

#### Day 3-4: Execution Engine
- [ ] Build complete execution engine
  - ClickHouse connector (102 metrics)
  - Supabase connector (metadata)
  - Node execution logic (6 types)
  - Caching layer
- [ ] Create data connectors
  - `wallet_metrics_complete` queries
  - `wallet_metrics_by_category` queries
  - `momentum_trading_signals` queries

#### Day 5: Testing
- [ ] Test all 11 strategies with real data
- [ ] Verify query performance
- [ ] Optimize slow queries

### 🎨 Phase 2: Visual Interface (Next Week)

#### Day 6-7: Core UI
- [ ] Install React Flow
- [ ] Build node editor canvas
- [ ] Create node palette (6 node types)
- [ ] Build node inspector panel

#### Day 8-9: Strategy Management
- [ ] Strategy library UI
- [ ] Save/load strategies
- [ ] Clone/fork strategies
- [ ] Results preview panel

#### Day 10: Polish
- [ ] Real-time preview
- [ ] Error handling UI
- [ ] Performance metrics display

---

## Available Metrics Mapping

### From `wallet_metrics_complete`:

**Phase 1 Metrics (Core):**
- ✅ omega_ratio, sortino_ratio, calmar_ratio
- ✅ net_pnl, total_gains, total_losses
- ✅ win_rate, avg_gain, avg_loss
- ✅ closed_positions, active_positions

**Phase 2 Metrics (Risk):**
- ✅ max_drawdown, time_in_drawdown_pct
- ✅ cvar_95, max_single_trade_loss_pct
- ✅ kelly_utilization_pct, risk_of_ruin

**Phase 3 Metrics (Activity):**
- ✅ bets_per_week, track_record_days
- ✅ brier_score, log_score

**Phase 4 Metrics (Advanced):**
- ✅ tail_ratio (convexity #60)
- ✅ omega_lag_30s, omega_lag_2min, omega_lag_5min (#48-50)
- ✅ ev_per_hour_capital (#69)
- ✅ deposit_driven_pnl (#79)
- ✅ omega_momentum_30d (#56)
- ✅ clv_momentum_30d (#82)
- ✅ hot_hand_z_score (#86)
- ✅ performance_trend_flag (#85)
- ✅ sizing_discipline_trend (#88)
- ✅ latency_penalty_index (#55)

### From `wallet_metrics_by_category`:
- ✅ All 102 metrics broken down by category
- ✅ calibration_error (per category #91)
- ✅ clv_lag_0s (per category #89)
- ✅ omega_lag (per category #90)
- ✅ ev_per_hour (per category #92)

### From `momentum_trading_signals`:
- ✅ tsi_fast, tsi_slow
- ✅ crossover_signal (BULLISH/BEARISH/NEUTRAL)
- ✅ directional_conviction
- ✅ elite_consensus_pct

---

## Updated Strategy Mappings

### ✅ Strategy 1: "Aggressive Growth" - NOW AVAILABLE!

**Metrics Needed:**
- `bets_per_week` > 3 ✅ (metric #24)
- `deposit_driven_pnl` < 0.2 ✅ (metric #79)
- `omega_ratio` > 3.0 ✅ (metric #2)
- `omega_lag_30s` > 2.0 ✅ (metric #48)
- `tail_ratio` > 3.0 ✅ (metric #60)

**Sort by:** `ev_per_hour_capital` ✅ (metric #69)

**Status:** ✅ READY TO BUILD

### ✅ Strategy 2: "Balanced Hybrid" - ALREADY SEEDED

**Status:** ✅ WORKING (using existing wallet_scores)

### ✅ Strategy 3: "Eggman Hunter" - ALREADY SEEDED

**Status:** ✅ WORKING (using wallet_scores_by_category)

### ✅ Strategy 4: "Safe & Steady" - NOW AVAILABLE!

**Metrics Needed:**
- `bets_per_week` > 5 ✅ (metric #24)
- `closed_positions` > 100 ✅ (metric #22)
- `max_drawdown` > -20% ✅ (metric #17)
- `time_in_drawdown_pct` < 30% ✅ (metric #19)

**Sort by:** `sortino_ratio` ✅ (metric #5)

**Status:** ✅ READY TO BUILD

### ✅ Strategy 5: "Momentum Rider" - ALREADY SEEDED

**Status:** ✅ WORKING (using omega_momentum)

### ✅ Strategy 6: "Rising Star" - NOW AVAILABLE!

**Metrics Needed:**
- `track_record_days` BETWEEN 90 AND 365 ✅ (metric #23)
- `closed_positions` > 75 ✅ (metric #22)
- `performance_trend_flag` == "Improving" ✅ (metric #85)
- `sizing_discipline_trend` < 0 ✅ (metric #88)

**Sort by:** `ev_per_hour_momentum_30d` ✅ (metric #83)

**Status:** ✅ READY TO BUILD

### ✅ Strategy 7: "Alpha Decay Detector" - NOW AVAILABLE!

**Metrics Needed:**
- `omega_ratio` (lifetime) > 5.0 ✅ (metric #2)
- `closed_positions` > 200 ✅ (metric #22)
- `performance_trend_flag` == "Declining" ✅ (metric #85)

**Sort by:** `latency_penalty_index` ✅ (metric #55)

**Status:** ✅ READY TO BUILD

### ✅ Strategy 8: "Fortress" - NOW AVAILABLE!

**Metrics Needed:**
- `max_single_trade_loss_pct` < 5% ✅ (metric #38)
- `kelly_utilization_pct` BETWEEN 0.2 AND 0.7 ✅ (metric #63)
- `cvar_95` > -10% ✅ (metric #37)

**Sort by:** `risk_of_ruin` (ascending) ✅ (metric #64)

**Status:** ✅ READY TO BUILD

### ⏳ Strategy 9: "News Shark" - PARTIAL

**Metrics Needed:**
- `event_archetype_edge` ⏳ (metric #94 - may need custom implementation)
- `news_latency_median` ⏳ (metric #100)
- `edge_half_life_hours` ✅ (metric #54)

**Sort by:** `news_shock_ev_5min` ⏳ (metric #67)

**Status:** ⏳ NEEDS EVENT DETECTION (Phase 3 feature)

### ⏳ Strategy 10: "Liquidity Provider" - PARTIAL

**Metrics Needed:**
- `maker_taker_ratio` ✅ (metric #34)
- `fee_burden_pct` ✅ (metric #72)
- `liquidity_access_skill` ⏳ (metric #99)

**Sort by:** `maker_taker_ratio` ✅

**Status:** ⏳ NEEDS LIQUIDITY SKILL CALC (Phase 3 feature)

### ✅ Strategy 11: "Contrarian" - NOW AVAILABLE!

**Metrics Needed:**
- `brier_score` (top 20%) ✅ (metric #25)
- `yes_no_direction_bias` ✅ (metric #98)
- `edge_source_decomposition` ⏳ (metric #102)

**Sort by:** `crowd_orthogonality` ⏳ (metric #68)

**Status:** ⏳ NEEDS CROWD CORRELATION (Phase 3 feature)

---

## Immediate Build Plan

### ✅ 8 Strategies Ready NOW:
1. ✅ Aggressive Growth
2. ✅ Balanced Hybrid
3. ✅ Eggman Hunter
4. ✅ Safe & Steady
5. ✅ Momentum Rider
6. ✅ Rising Star
7. ✅ Alpha Decay Detector
8. ✅ Fortress

### ⏳ 3 Strategies for Phase 3 (need custom metrics):
9. ⏳ News Shark (needs event detection)
10. ⏳ Liquidity Provider (needs liquidity skill)
11. ⏳ Contrarian (needs crowd correlation)

---

## Next Steps (Today)

### Step 1: Update Strategy Seed File
Create comprehensive seed with all 8 available strategies:
```sql
-- File: supabase/migrations/20251025180000_seed_all_strategies.sql
```

### Step 2: Build Complete Execution Engine
```typescript
// File: lib/strategy-builder/execution-engine-complete.ts
// Connects to:
// - wallet_metrics_complete (ClickHouse)
// - wallet_metrics_by_category (ClickHouse)
// - wallet_scores (Supabase)
```

### Step 3: Create ClickHouse Data Connectors
```typescript
// File: lib/strategy-builder/clickhouse-connector.ts
// Query all 102 metrics with filters
```

### Step 4: Test All Strategies
```bash
npm run test:strategies
# Executes all 8 strategies against real data
# Verifies results are non-empty
# Checks query performance
```

---

## Execution Engine Architecture Update

### Data Source Routing:

```typescript
const TABLE_ROUTING = {
  // Supabase tables (for simple queries)
  'wallet_scores': 'supabase',
  'wallet_scores_by_category': 'supabase',
  'markets': 'supabase',

  // ClickHouse tables (for 102 metrics)
  'wallet_metrics_complete': 'clickhouse',
  'wallet_metrics_by_category': 'clickhouse',
  'momentum_trading_signals': 'clickhouse',
  'market_price_momentum': 'clickhouse',
};

// Smart routing: Use Supabase for basic filters, ClickHouse for advanced
function routeQuery(filters: Filter[]) {
  const metricsNeeded = filters.map(f => f.field);

  const basicMetrics = ['omega_ratio', 'closed_positions', 'total_pnl'];
  const needsClickHouse = metricsNeeded.some(m => !basicMetrics.includes(m));

  return needsClickHouse ? 'clickhouse' : 'supabase';
}
```

### Performance Optimization:

```typescript
// Prefer wallet_scores (Supabase) when possible
if (onlyBasicMetrics) {
  // Fast: Query Supabase PostgreSQL (indexed, <50ms)
  return await supabase.from('wallet_scores').select('*').gte('omega_ratio', 2.0);
}

// Use ClickHouse for advanced metrics
if (needsAdvancedMetrics) {
  // Slower but complete: Query ClickHouse (50-200ms)
  return await clickhouse.query(`
    SELECT * FROM wallet_metrics_complete
    WHERE tail_ratio > 3.0 AND omega_lag_30s > 2.0
  `);
}
```

---

## Summary

**OLD PLAN:**
- Build 3 strategies now
- Wait for migrations
- Add 8 more strategies later

**NEW PLAN:**
- Build 8 strategies NOW ✅
- Skip waiting (migrations done!)
- Add 3 advanced strategies in Phase 3

**Timeline:**
- Week 1: Backend complete (8 strategies working)
- Week 2: UI complete (visual builder)
- Week 3: Advanced strategies + real-time features

Let's start building! 🚀
