# Strategy Builder: Phased Implementation Plan
**Can We Start Before ClickHouse Migrations?**

## TL;DR: **YES! Start NOW** 🚀

We can build **60-70% of the strategy builder immediately** using existing tables and metrics. The remaining 30-40% gets added incrementally as the other Claude completes migrations.

---

## Current State: What We HAVE Right Now

### ✅ Existing Supabase Tables (Ready to Use)

1. **`wallet_scores`** (created: 20251024210000)
   - ✅ omega_ratio
   - ✅ omega_momentum
   - ✅ closed_positions
   - ✅ total_pnl
   - ✅ total_gains
   - ✅ total_losses
   - ✅ win_rate
   - ✅ avg_gain
   - ✅ avg_loss
   - ✅ grade (S/A/B/C/D/F)
   - ✅ momentum_direction (improving/declining/stable)

2. **`wallet_scores_by_category`** (created: 20251024240000)
   - ✅ All wallet_scores metrics PLUS:
   - ✅ category (Politics, Crypto, Sports, etc.)
   - ✅ roi_per_bet
   - ✅ overall_roi

3. **`markets`** (created: 20251022131000)
   - ✅ market_id
   - ✅ category
   - ✅ volume
   - ✅ liquidity

4. **`watchlist_markets`** (created: 20251025130000)
   - ✅ user_id
   - ✅ market_id
   - ✅ is_active

5. **`wallet_category_tags`** (created: 20251025110000)
   - ✅ wallet_address
   - ✅ category
   - ✅ tags (JSON)

### ✅ Existing ClickHouse Tables (From Context)

1. **`trades_raw`** (created: 003_add_condition_id.sql)
   - ✅ wallet_address
   - ✅ market_id
   - ✅ condition_id
   - ✅ side (YES/NO)
   - ✅ entry_price
   - ✅ shares
   - ✅ usd_value
   - ✅ timestamp
   - ✅ is_closed

---

## What We Can Build NOW (Phase 1: Weeks 1-2)

### 1. Core Infrastructure ✅

**Strategy Builder Schema** (3 new Supabase tables):
```sql
-- We can create these TODAY
CREATE TABLE strategy_definitions (...)
CREATE TABLE strategy_executions (...)
-- ClickHouse cache table can wait (optional optimization)
```

**Execution Engine** (Complete implementation):
```typescript
// File: lib/strategy-builder/execution-engine.ts
// Uses ONLY existing tables
class StrategyExecutionEngine {
  async execute(strategy, context) {
    // Works with wallet_scores, wallet_scores_by_category, markets
  }
}
```

### 2. Working Strategies with Existing Data ✅

**Strategy 2: "Balanced Hybrid"** (FULLY WORKING TODAY)
```json
{
  "filters": [
    {"field": "closed_positions", "operator": ">=", "value": 50},
    {"field": "omega_ratio", "operator": ">=", "value": 2.0},
    {"field": "grade", "operator": "IN", "value": ["S", "A", "B"]}
  ],
  "sortBy": "total_pnl"
}
```
✅ **All metrics exist in wallet_scores**

**Strategy 3: "Eggman Hunter"** (FULLY WORKING TODAY)
```json
{
  "filters": [
    {"field": "category", "operator": "==", "value": "AI"},
    {"field": "closed_positions", "operator": ">=", "value": 10, "categorySpecific": true},
    {"field": "omega_ratio", "operator": ">=", "value": 3.0, "categorySpecific": true},
    {"field": "grade", "operator": "==", "value": "S", "categorySpecific": true}
  ],
  "sortBy": "roi_per_bet"
}
```
✅ **All metrics exist in wallet_scores_by_category**

**Strategy 5: "Momentum Rider"** (FULLY WORKING TODAY)
```json
{
  "filters": [
    {"field": "closed_positions", "operator": ">=", "value": 100},
    {"field": "omega_momentum", "operator": ">", "value": 0},
    {"field": "momentum_direction", "operator": "==", "value": "improving"}
  ],
  "sortBy": "omega_momentum"
}
```
✅ **All metrics exist in wallet_scores**

### 3. Visual UI ✅

**React Flow Node Editor** (No data dependencies):
```bash
npm install reactflow
```

```typescript
// Components we can build NOW:
- <StrategyBuilderInterface />   // Drag-and-drop editor
- <NodePalette />                 // Node library
- <NodeInspector />               // Config panel
- <ResultsPreview />              // Live execution results
- <StrategyLibrary />             // Saved strategies
```

**Why this works:** UI doesn't care which metrics exist - it just renders whatever fields are available in the database schema.

### 4. Real Data Integration ✅

**Data connectors for existing tables:**
```typescript
// lib/strategy-builder/data-connectors.ts

export const supabaseConnector = {
  async fetchWalletScores(filters?: string) {
    // Queries wallet_scores table (EXISTS TODAY)
    const { data } = await supabase
      .from('wallet_scores')
      .select('*')
      .gte('omega_ratio', 2.0);
    return data;
  },

  async fetchCategoryScores(category: string) {
    // Queries wallet_scores_by_category (EXISTS TODAY)
    const { data } = await supabase
      .from('wallet_scores_by_category')
      .select('*')
      .eq('category', category);
    return data;
  }
};
```

---

## What Needs to Wait (Phase 2: When Migrations Complete)

### ⏳ Strategies Requiring Advanced Metrics

**Strategy 1: "Aggressive Growth"** (Needs ClickHouse metrics)
```json
{
  "filters": [
    {"field": "bets_per_week", "operator": ">", "value": 3},          // ❌ Not in wallet_scores yet
    {"field": "deposit_driven_pnl", "operator": "<", "value": 0.2},   // ❌ Not calculated yet
    {"field": "omega_lag_30s", "operator": ">", "value": 2.0},        // ❌ Needs lag simulation
    {"field": "tail_ratio", "operator": ">", "value": 3.0}            // ❌ Needs convexity calc
  ]
}
```

**Blockers:**
- ❌ `bets_per_week` - Needs time-series aggregation
- ❌ `deposit_driven_pnl` - Needs integrity metric (#79)
- ❌ `omega_lag_30s` - Needs lag-adjusted omega (#48)
- ❌ `tail_ratio` - Needs convexity metric (#60)
- ❌ `ev_per_hour_capital` - Needs capital velocity (#69)

**When available:** After other Claude completes `wallet_metrics_complete` table

**Strategy 4: "Safe & Steady"** (Needs risk metrics)
```json
{
  "filters": [
    {"field": "max_drawdown", "operator": ">", "value": -20},         // ❌ Not calculated yet
    {"field": "time_in_drawdown_pct", "operator": "<", "value": 30},  // ❌ Needs drawdown tracking
    {"field": "sortino_ratio", "operator": ">", "value": 1.5}         // ❌ Needs downside volatility
  ]
}
```

**Blockers:**
- ❌ `max_drawdown` - Needs equity curve tracking
- ❌ `time_in_drawdown_pct` - Needs state tracking
- ❌ `sortino_ratio` - Needs downside deviation calc

**When available:** After `wallet_metrics_complete` includes risk metrics

---

## Phased Rollout Strategy

### 📅 Week 1-2: Phase 1 (START NOW - No Blockers)

**Infrastructure:**
- [x] Create strategy builder schema (3 tables)
- [x] Build execution engine (works with existing tables)
- [x] Implement node type system
- [x] Build data connectors (Supabase only for now)

**UI:**
- [x] Set up React Flow
- [x] Build node editor interface
- [x] Create node palette (drag-and-drop)
- [x] Build results preview panel

**Seed 3 Working Strategies:**
1. ✅ Strategy 2: "Balanced Hybrid"
2. ✅ Strategy 3: "Eggman Hunter"
3. ✅ Strategy 5: "Momentum Rider"

**Deliverable:** Users can build and execute strategies using existing metrics (omega, win rate, PnL, category analysis)

### 📅 Week 3-4: Phase 2 (After ClickHouse Migrations)

**Add Advanced Metrics:**
- [ ] Connect to `wallet_metrics_complete` table (102 metrics)
- [ ] Add ClickHouse data connector
- [ ] Enable remaining 8 strategies

**Seed Remaining Strategies:**
4. Strategy 1: "Aggressive Growth"
5. Strategy 4: "Safe & Steady"
6. Strategy 6: "Rising Star"
7. Strategy 7: "Alpha Decay Detector"
8. Strategy 8: "Fortress"
9. Strategy 9: "News Shark"
10. Strategy 10: "Liquidity Provider"
11. Strategy 11: "Contrarian"

**Deliverable:** Full 11-strategy library operational

### 📅 Week 5-6: Phase 3 (Polish & Real-Time)

**Real-Time Features:**
- [ ] WebSocket integration (Polymarket RTDS)
- [ ] Auto-execution mode
- [ ] Alert/notification system
- [ ] Live strategy monitoring

---

## Metric Mapping Layer (Smart Degradation)

**Problem:** Users try to build Strategy 1, but `tail_ratio` doesn't exist yet.

**Solution:** Metric mapping layer with graceful fallback:

```typescript
// lib/strategy-builder/metric-mapper.ts

const METRIC_AVAILABILITY = {
  // Phase 1 (Available NOW)
  'omega_ratio': { table: 'wallet_scores', status: 'READY' },
  'omega_momentum': { table: 'wallet_scores', status: 'READY' },
  'closed_positions': { table: 'wallet_scores', status: 'READY' },
  'total_pnl': { table: 'wallet_scores', status: 'READY' },
  'win_rate': { table: 'wallet_scores', status: 'READY' },
  'roi_per_bet': { table: 'wallet_scores_by_category', status: 'READY' },

  // Phase 2 (Coming soon)
  'bets_per_week': { table: 'wallet_metrics_complete', status: 'PENDING', eta: '2025-11-01' },
  'tail_ratio': { table: 'wallet_metrics_complete', status: 'PENDING', eta: '2025-11-01' },
  'omega_lag_30s': { table: 'wallet_metrics_complete', status: 'PENDING', eta: '2025-11-08' },

  // Phase 3 (Future)
  'news_latency_median': { table: 'wallet_metrics_complete', status: 'PLANNED', eta: '2025-11-15' }
};

export function checkMetricAvailability(field: string): MetricStatus {
  return METRIC_AVAILABILITY[field] || { status: 'UNKNOWN' };
}

export function getAvailableMetrics(): string[] {
  return Object.entries(METRIC_AVAILABILITY)
    .filter(([_, meta]) => meta.status === 'READY')
    .map(([field, _]) => field);
}
```

**UI Integration:**
```typescript
// In node editor, gray out unavailable metrics
<FilterNode>
  <Select name="field">
    <option value="omega_ratio">Omega Ratio ✅</option>
    <option value="tail_ratio" disabled>Tail Ratio ⏳ (Coming Nov 1)</option>
  </Select>
</FilterNode>
```

**Strategy Validation:**
```typescript
function validateStrategy(strategy: StrategyDefinition): ValidationResult {
  const missingMetrics = strategy.nodes
    .filter(n => n.type === 'FILTER')
    .map(n => n.config.field)
    .filter(field => checkMetricAvailability(field).status !== 'READY');

  if (missingMetrics.length > 0) {
    return {
      valid: false,
      warnings: missingMetrics.map(m =>
        `Metric "${m}" not available yet. ETA: ${METRIC_AVAILABILITY[m].eta}`
      )
    };
  }

  return { valid: true };
}
```

---

## Migration File We Can Create NOW

```sql
-- File: supabase/migrations/20251025170000_create_strategy_builder.sql

-- Strategy Definitions Table
CREATE TABLE IF NOT EXISTS strategy_definitions (
  strategy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name TEXT NOT NULL,
  strategy_description TEXT,
  strategy_type TEXT NOT NULL CHECK (strategy_type IN ('SCREENING', 'MOMENTUM', 'ARBITRAGE', 'CUSTOM')),
  is_predefined BOOLEAN DEFAULT FALSE,

  -- Node Graph (JSON)
  node_graph JSONB NOT NULL,

  -- Execution Settings
  execution_mode TEXT DEFAULT 'MANUAL' CHECK (execution_mode IN ('MANUAL', 'AUTO', 'SCHEDULED')),
  schedule_cron TEXT,
  is_active BOOLEAN DEFAULT TRUE,

  -- Performance Tracking
  total_executions INTEGER DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  avg_execution_time_ms INTEGER,

  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1,
  parent_strategy_id UUID REFERENCES strategy_definitions(strategy_id)
);

CREATE INDEX idx_strategy_type ON strategy_definitions(strategy_type);
CREATE INDEX idx_active_strategies ON strategy_definitions(is_active) WHERE is_active = TRUE;

-- Strategy Executions Table
CREATE TABLE IF NOT EXISTS strategy_executions (
  execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,

  executed_at TIMESTAMPTZ DEFAULT NOW(),
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('MANUAL', 'AUTO', 'SCHEDULED')),
  triggered_by UUID REFERENCES auth.users(id),

  -- Results (JSON)
  results JSONB NOT NULL,

  -- Performance
  execution_time_ms INTEGER NOT NULL,
  nodes_evaluated INTEGER NOT NULL,
  data_points_processed INTEGER NOT NULL,

  -- Status
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_strategy_executions_strategy ON strategy_executions(strategy_id, executed_at DESC);
CREATE INDEX idx_strategy_executions_status ON strategy_executions(status);

-- Seed 3 working strategies
INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES
(
  'Balanced Hybrid',
  'Find profitable traders with strong competency and risk management',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {"type": "DATA_SOURCE", "id": "wallets", "config": {"source": "WALLETS", "mode": "BATCH"}},
      {"type": "FILTER", "id": "min_trades", "config": {"field": "closed_positions", "operator": "GREATER_THAN_OR_EQUAL", "value": 50}},
      {"type": "FILTER", "id": "omega_filter", "config": {"field": "omega_ratio", "operator": "GREATER_THAN_OR_EQUAL", "value": 2.0}},
      {"type": "LOGIC", "id": "combine", "config": {"operator": "AND", "inputs": ["min_trades", "omega_filter"]}},
      {"type": "AGGREGATION", "id": "sort_pnl", "config": {"function": "MAX", "field": "total_pnl"}}
    ],
    "edges": [
      {"from": "wallets", "to": "min_trades"},
      {"from": "wallets", "to": "omega_filter"},
      {"from": "min_trades", "to": "combine"},
      {"from": "omega_filter", "to": "combine"},
      {"from": "combine", "to": "sort_pnl"}
    ]
  }'
),
(
  'Eggman Hunter',
  'Find category specialists with deep expertise',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {"type": "DATA_SOURCE", "id": "category_scores", "config": {"source": "WALLETS", "prefilters": {"table": "wallet_scores_by_category"}, "mode": "BATCH"}},
      {"type": "FILTER", "id": "ai_only", "config": {"field": "category", "operator": "EQUALS", "value": "AI"}},
      {"type": "FILTER", "id": "min_bets", "config": {"field": "closed_positions", "operator": "GREATER_THAN_OR_EQUAL", "value": 10, "categorySpecific": {"enabled": true, "category": "AI"}}},
      {"type": "FILTER", "id": "s_grade", "config": {"field": "omega_ratio", "operator": "GREATER_THAN_OR_EQUAL", "value": 3.0, "categorySpecific": {"enabled": true, "category": "AI"}}},
      {"type": "LOGIC", "id": "combine", "config": {"operator": "AND", "inputs": ["ai_only", "min_bets", "s_grade"]}},
      {"type": "AGGREGATION", "id": "sort_roi", "config": {"function": "MAX", "field": "roi_per_bet"}}
    ],
    "edges": [
      {"from": "category_scores", "to": "ai_only"},
      {"from": "category_scores", "to": "min_bets"},
      {"from": "category_scores", "to": "s_grade"},
      {"from": "ai_only", "to": "combine"},
      {"from": "min_bets", "to": "combine"},
      {"from": "s_grade", "to": "combine"},
      {"from": "combine", "to": "sort_roi"}
    ]
  }'
),
(
  'Momentum Rider',
  'Find traders currently on a hot streak',
  'MOMENTUM',
  TRUE,
  '{
    "nodes": [
      {"type": "DATA_SOURCE", "id": "wallets", "config": {"source": "WALLETS", "mode": "BATCH"}},
      {"type": "FILTER", "id": "min_history", "config": {"field": "closed_positions", "operator": "GREATER_THAN_OR_EQUAL", "value": 100}},
      {"type": "FILTER", "id": "omega_up", "config": {"field": "omega_momentum", "operator": "GREATER_THAN", "value": 0}},
      {"type": "FILTER", "id": "improving", "config": {"field": "momentum_direction", "operator": "EQUALS", "value": "improving"}},
      {"type": "LOGIC", "id": "combine", "config": {"operator": "AND", "inputs": ["min_history", "omega_up", "improving"]}},
      {"type": "AGGREGATION", "id": "sort_momentum", "config": {"function": "MAX", "field": "omega_momentum"}}
    ],
    "edges": [
      {"from": "wallets", "to": "min_history"},
      {"from": "wallets", "to": "omega_up"},
      {"from": "wallets", "to": "improving"},
      {"from": "min_history", "to": "combine"},
      {"from": "omega_up", "to": "combine"},
      {"from": "improving", "to": "combine"},
      {"from": "combine", "to": "sort_momentum"}
    ]
  }'
);

COMMENT ON TABLE strategy_definitions IS 'User-defined and predefined trading strategies using node-based composition';
COMMENT ON TABLE strategy_executions IS 'Execution history and results for strategies';
```

---

## Benefits of Starting Now

### 1. **Parallel Development** 🏎️
- Other Claude: Builds metrics pipeline
- This Claude (you): Builds strategy builder
- They integrate seamlessly when both complete

### 2. **Immediate User Value** 💰
- Users can start building strategies TODAY with existing metrics
- 3 working strategies out of the box
- Visual interface to explore wallet data

### 3. **Faster Feedback Loop** 🔄
- Test execution engine with real data NOW
- Identify edge cases early
- Refine UI based on actual usage

### 4. **Incremental Enhancement** 📈
- Metrics appear automatically as other Claude adds them
- No "big bang" deployment
- Users see strategy library grow week by week

### 5. **De-Risk the Project** 🛡️
- Proves the architecture works BEFORE investing in 102 metrics
- If execution engine fails, we know early
- Validates user demand for strategy builder

---

## Implementation Order (Next Steps)

### This Week (Can Start NOW):

1. **Monday**: Create strategy builder schema migration
   ```bash
   # File: supabase/migrations/20251025170000_create_strategy_builder.sql
   supabase db push
   ```

2. **Tuesday**: Build execution engine
   ```bash
   # File: lib/strategy-builder/execution-engine.ts
   # Implement with existing tables only
   ```

3. **Wednesday**: Create data connectors
   ```bash
   # File: lib/strategy-builder/data-connectors.ts
   # Supabase connector for wallet_scores, wallet_scores_by_category
   ```

4. **Thursday**: Build basic UI
   ```bash
   npm install reactflow
   # File: components/strategy-builder/
   ```

5. **Friday**: Test 3 seeded strategies
   ```bash
   # Verify all 3 strategies execute successfully
   # Get real results from existing data
   ```

### Next Week (Polish):

6. **Monday-Tuesday**: Build visual node editor
7. **Wednesday**: Add results preview panel
8. **Thursday**: Create strategy library UI
9. **Friday**: User testing & refinement

---

## Conclusion

**Answer: YES, start NOW!**

You can build **60-70% of the strategy builder immediately**:
- ✅ Complete infrastructure (schema, execution engine, UI)
- ✅ 3 fully working strategies (out of 11)
- ✅ Real data integration with existing tables
- ✅ Visual interface for building custom strategies

The remaining **30-40%** gets added incrementally as new metrics become available:
- ⏳ Week 3-4: Add remaining 8 strategies
- ⏳ Week 5-6: Real-time features

**The strategy builder and ClickHouse migrations are perfectly parallelizable.**

Start building today! 🚀
