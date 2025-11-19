# CASCADIAN Strategy Builder & Copy Trading - Comprehensive Analysis Report

## Executive Summary

The Cascadian platform has a **sophisticated strategy builder with an advanced node-based visual editor** using ReactFlow. The system supports multi-condition filtering, wallet metrics-based decisions, and autonomous execution. However, there are significant gaps between the UI/backend infrastructure and actual copy trading execution.

**Current State**: 60-70% complete
- Strategy builder UI: 100% (fully implemented)
- Wallet filtering & metrics: 90% (component exists, API partially implemented)
- Copy trading execution: 30% (database schema + monitoring, no actual trade execution)
- Real-time streaming: 0% (planned for Phase 3)

---

## 1. STRATEGY BUILDER UI (100% BUILT & WORKING)

### 1.1 Node-Based Editor Architecture

**Location**: `/components/strategy-builder/`

**Core Components**:
- **Enhanced Filter Node** (`enhanced-filter-node.tsx`)
  - Multi-condition filtering with AND/OR logic
  - Supports 102+ wallet metrics from DATABASE_ARCHITECT_SPEC.md
  - Visual badge showing condition count and logic type
  - Validation indicators (green/red based on completeness)
  - Render: Purple gradient with condition count badge

- **Orchestrator Node** (`orchestrator-node.tsx`)
  - Portfolio position sizing and risk management
  - Mode: Autonomous vs Approval Required
  - Displays: Portfolio size, risk tolerance (1-10), Kelly fraction, max position, bet range
  - Drawdown protection toggle
  - Pending decisions badge with pulse animation
  - Render: Violet gradient with shield icon

- **Action Node** (`action-node.tsx`)
  - 5 action types: ADD_TO_WATCHLIST, REMOVE_FROM_WATCHLIST, SEND_ALERT, LOG_RESULT, WEBHOOK
  - Icons and status indicators
  - Render: Pink gradient

- **Other Nodes** (in `/components/strategy-nodes/`)
  - Data Source Node
  - Filter Node (basic)
  - Logic Node
  - Aggregation Node
  - Signal Node
  - Watchlist Node

**Framework**: React Flow (@xyflow/react) with Handle positions (Left/Right)

**Key Features**:
- Grid snap toggle & layout tools
- Lock/unlock nodes
- Alignment tools
- Visual state indicators (idle, running, completed, error)
- Memoized components for performance

**Configuration Storage**: Supabase `strategy_definitions` table
```typescript
interface StrategyDefinition {
  strategy_id: string
  strategy_name: string
  strategy_description?: string
  node_graph: NodeGraph  // nodes[] + edges[]
  execution_mode: 'MANUAL' | 'SCHEDULED' | 'AUTONOMOUS'
  is_active: boolean
  trading_mode: 'paper' | 'live'
  paper_bankroll_usd?: number
}
```

### 1.2 Enhanced Filter Configuration

**File**: `/components/strategy-builder/enhanced-filter-node/enhanced-filter-config-panel.tsx`

**Supported Conditions**:
```typescript
interface EnhancedFilterConfig {
  version: 2
  conditions: Array<{
    field: string
    operator: FilterOperator
    value: any
  }>
  logic: 'AND' | 'OR'
}
```

**Operators Supported** (17 types):
- Comparison: EQUALS, NOT_EQUALS, GREATER_THAN, LESS_THAN, BETWEEN
- Percentile: IN_PERCENTILE, NOT_IN_PERCENTILE
- Text: CONTAINS, STARTS_WITH, ENDS_WITH
- Null: IS_NULL, IS_NOT_NULL
- List: IN, NOT_IN

**Fields Available** (102+ metrics):
- Core Performance: omega_ratio, sortino_ratio, calmar_ratio, net_pnl, total_gains, win_rate, profit_factor
- Risk: max_drawdown, cvar_95, tail_ratio, skewness, kurtosis, risk_of_ruin
- Activity: resolved_bets, track_record_days, bets_per_week
- Advanced: kelly_utilization_pct, optimal_f, edge_half_life_hours
- Momentum: omega_momentum_30d, clv_momentum_30d, hot_hand_z_score

---

## 2. WALLET FILTERING & METRICS (90% BUILT)

### 2.1 Wallet Filter Component

**Location**: `/components/wallet-filter-node/index.tsx`

**Filtering Criteria**:
```typescript
interface WalletFilterCriteria {
  min_omega_ratio?: number
  max_omega_ratio?: number
  min_roi_per_bet?: number
  min_closed_positions?: number
  allowed_grades?: string[]  // 'S' | 'A' | 'B' | 'C' | 'D' | 'F'
  allowed_momentum?: string[] // 'improving' | 'declining' | 'stable'
  categories?: string[]       // Market categories (Politics, Crypto, Sports, etc.)
}
```

**Preset Segments** (from `/components/omega-leaderboard-interface/`):
- All Wallets
- S Grade Only (Omega > 3.0)
- Hot Momentum (Improving omega)
- High Earners (PnL > $10k)
- Reasonable Omega (≤50, filters outliers)

**Sort Options**:
- Omega Ratio
- ROI Per Bet
- Overall ROI %
- Omega Momentum
- Total PnL
- Win Rate
- Avg Gain
- Closed Positions

### 2.2 Wallet Metrics Available

**Complete Type Definition**: `/lib/strategy-builder/types.ts` (102 metrics)

**Phase 1 - Core (8 metrics)**:
- omega_ratio, sortino_ratio, calmar_ratio
- net_pnl, total_gains, total_losses
- win_rate, profit_factor

**Phase 2 - Risk (14 metrics)**:
- max_drawdown, avg_drawdown, time_in_drawdown_pct
- recovery_time_avg_days, cvar_95, max_single_trade_loss_pct

**Phase 3 - Activity (5 metrics)**:
- resolved_bets, track_record_days, bets_per_week
- brier_score, log_score

**Phase 4-9 - Advanced** (70+ metrics):
- Execution microstructure, position sizing, Kelly fraction
- Capital velocity, information decay, behavioral metrics
- Momentum indicators, trend flags, discipline metrics

### 2.3 Leaderboard Interface

**Location**: `/components/omega-leaderboard-interface/index.tsx`

**Features**:
- Search bar + sorting dropdowns
- Segment filters (S Grade, Hot Momentum, High Earners)
- Visual performance cards with color coding
- Summary metrics (average omega, PnL, win rate)
- ECharts integration for visualization

**API Endpoint**: `/api/wallets/filter` (POST)
- Accepts WalletFilterCriteria
- Returns matching wallet count + data

---

## 3. COPY TRADING IMPLEMENTATION (30% BUILT)

### 3.1 Copy Trading Modes (Documented but NOT EXECUTED)

**Architecture Document**: `/docs/copy-trading-modes-architecture.md`

**6 Supported Modes**:

1. **MIRROR_ALL** - Copy every trade from all tracked wallets
2. **CONSENSUS_ONLY** - Only copy when 2+ wallets agree (OWRR threshold)
3. **TOP_PERFORMER** - Copy only from top N wallets
4. **WEIGHTED** - Weight trades by metric (omega, win_rate, roi, sharpe)
5. **TIER_BASED** - Different rules per wallet tier
6. **HYBRID** - Copy all from top N, consensus for others

**Configuration Structure**:
```typescript
copy_trading: {
  enabled: boolean
  mode: 'MIRROR_ALL' | 'CONSENSUS_ONLY' | 'TOP_PERFORMER' | 'WEIGHTED' | 'TIER_BASED' | 'HYBRID'
  poll_interval_seconds: number
  max_latency_seconds: number
  mode_config: { /* mode-specific settings */ }
  detection: {
    monitor_new_positions: boolean
    monitor_position_increases: boolean
    monitor_exits: boolean
    grouping_window_seconds: number
  }
  copy_behavior: {
    copy_exact_outcome: boolean
    copy_exact_market: boolean
    ignore_if_already_holding: boolean
  }
}
```

### 3.2 Copy Trading Database Schema

**Tables** (Created in migration `20251029000001_create_copy_trading_tables.sql`):

1. **copy_trade_strategies**
   - strategy_id, user_id
   - mode, enabled, poll_interval_seconds
   - tracking_wallets (array), mode_config (JSON)

2. **copy_trades** (Historical trades)
   - id, strategy_id, source_wallet, market_id, side
   - our_entry_price, our_shares, our_usd_amount
   - status ('open' | 'closed'), realized_pnl, unrealized_pnl
   - our_timestamp, latency_seconds, slippage_bps

3. **copy_trade_signals** (Detected signals)
   - source_wallet, market_id, side
   - signal_type, signal_received_at, wallets_agreeing
   - confidence_score, owrr_value

4. **tracked_wallets** (Which wallets we follow)
   - strategy_id, wallet_address, status
   - trades_copied, trades_skipped, cumulative_pnl

### 3.3 Copy Trading UI Components

**Location**: `/components/strategy-dashboard/components/copy-trading-section.tsx`

**Features** (Frontend ONLY):
- Performance summary: total trades, active positions, win rate, PnL, avg latency
- Recent trades table: source wallet, market, side, entry price, shares, status, PnL
- Tracked wallets list: address, status, trades copied/skipped, omega, category
- Daily performance chart: trades per day, PnL, win rate

**API Endpoint Expected** (NOT IMPLEMENTED):
```
GET /api/strategies/{strategyId}/copy-trading/performance
```

### 3.4 Wallet Monitoring (Polling Infrastructure)

**Location**: `/app/api/trading/monitor/route.ts`

**Current Capabilities**:
- GET endpoint returns status + recent signals/trades (last 24h)
- Queries `copy_trade_signals` and `copy_trades` tables
- Returns last poll timestamp
- Configuration: TRADING_ENABLED, MOCK_TRADING flags

**Missing**: Actual monitoring loop that:
- Polls tracked wallets for new trades
- Detects matching positions
- Generates consensus signals
- Executes trades (paper or live)

---

## 4. STRATEGY EXECUTION (PARTIAL)

### 4.1 Execution Engine

**Location**: `/lib/strategy-builder/execution-engine.ts`

**What Works**:
- Topological sort of node graph
- Sequential node execution
- Result caching and aggregation
- ClickHouse connector for wallet metrics queries
- Supabase connector for persistence

**Execution Flow**:
1. Parse node graph from strategy definition
2. Build execution order (topological sort)
3. Execute nodes sequentially:
   - Fetch data from data source nodes
   - Apply filter conditions
   - Execute logic operations
   - Generate signals
   - Collect aggregations
   - Execute actions (ADD_TO_WATCHLIST, etc.)
4. Save execution record

**What's Missing**:
- Actual trade placement logic
- Integration with trading APIs/wallets
- Real-time execution (currently one-shot)
- Approval workflow implementation
- Strategy persistence across executions

### 4.2 API Endpoints

**Implemented**:

| Endpoint | Status | Purpose |
|----------|--------|---------|
| GET /api/strategies | Working | List all strategies |
| POST /api/strategies | Working | Create strategy |
| POST /api/strategies/execute | Working | Execute strategy once |
| GET /api/strategies/[id]/execute | Working | Get execution history |
| POST /api/strategies/[id]/execute-now | Working | Manual trigger |
| GET /api/strategies/[id]/watchlist | Working | Get strategy watchlist |
| DELETE /api/strategies/[id]/watchlist | Working | Clear watchlist |
| GET /api/strategies/[id]/watchlist/stream | NOT IMPL | WebSocket (501 response) |
| GET /api/insiders/wallets | Mock Data | Insider wallet scoring |

**Missing**:
- Trade execution endpoints
- Position management endpoints
- Copy trading control endpoints
- Approval workflow endpoints
- Performance calculation endpoints

---

## 5. REAL-TIME STREAMING & WEBSOCKETS (0% BUILT)

### 5.1 Current Status

**Watchlist Stream Endpoint** (`/app/api/strategies/[id]/watchlist/stream/route.ts`):
- Returns HTTP 501 (Not Implemented)
- **Intentionally experimental** - reserved for Phase 3
- Comment: "Planned for Phase 3 of backend infrastructure rollout"

### 5.2 Planned Features (Phase 3)

Per the endpoint documentation, Phase 3 should include:
- WebSocket-based streaming
- Second-by-second price monitoring
- Real-time momentum/acceleration calculations
- Sub-second latency signal detection
- Auto-execution integration

### 5.3 Current Polling Alternative

**Polling-based access** available via:
- GET /api/strategies/[id]/watchlist (with limit/offset)
- Poll interval configurable in copy_trading config

---

## 6. SUMMARY TABLE - WHAT'S BUILT vs MISSING

| Component | Status | Files | Notes |
|-----------|--------|-------|-------|
| **Strategy Builder UI** | 100% | strategy-builder/*.tsx | Full ReactFlow editor, all node types |
| **Node Configuration** | 100% | enhanced-filter-node/, orchestrator-node/ | Multi-condition builder, position sizing |
| **Wallet Filtering** | 90% | wallet-filter-node/, omega-leaderboard | Component + sorting exists, API partial |
| **Wallet Metrics** | 90% | lib/strategy-builder/types.ts | 102 metrics defined, partially queryable |
| **Strategy Execution Engine** | 70% | lib/strategy-builder/execution-engine.ts | Parses graph, runs nodes, missing: trade placement |
| **Strategy API** | 80% | app/api/strategies/** | CRUD + execution history, missing: trade endpoints |
| **Watchlist Management** | 80% | app/api/strategies/[id]/watchlist | List/clear, missing: real-time stream |
| **Copy Trading Schema** | 100% | supabase/migrations/20251029000001 | All tables created |
| **Copy Trading UI** | 70% | strategy-dashboard/components/copy-trading-section.tsx | Display only, no control |
| **Copy Trading Logic** | 10% | docs/ + minimal code | Documented modes, no execution |
| **Copy Trading Execution** | 0% | MISSING | No trade placement code |
| **Wallet Monitor** | 40% | app/api/trading/monitor/ | Status check, no polling loop |
| **Real-time Streaming** | 0% | PLACEHOLDER | 501 error, Phase 3 only |

---

## 7. KEY GAPS & BLOCKERS

### Critical Gaps (Blocking Copy Trading)

1. **No Trade Execution Engine**
   - Missing: Logic to actually execute trades (paper or live)
   - Missing: Integration with trading APIs/smart contracts
   - Missing: Position management (entry, exit, adjustments)

2. **No Wallet Monitoring Loop**
   - `/app/api/trading/monitor/route.ts` only reports status
   - Missing: Background job/cron that polls tracked wallets
   - Missing: Signal generation (consensus detection)
   - Missing: Trade triggering

3. **No Approval Workflow**
   - Orchestrator node has mode field
   - UI has approval modal component
   - Missing: Backend endpoint to handle approvals
   - Missing: Execution gate based on approval

4. **No Performance Calculation**
   - copy-trading-section.tsx expects API at `/api/strategies/{id}/copy-trading/performance`
   - Endpoint does NOT exist
   - Missing: PnL calculation, latency measurement, slippage tracking

5. **No Real-Time Streaming**
   - Intentionally Phase 3 (not priority)
   - Currently polling-only via GET /api/strategies/[id]/watchlist

### Medium Priority Gaps

1. **Incomplete Wallet Metrics**
   - 102 metrics defined but not all queryable
   - Missing ClickHouse integration for metrics
   - Fallback to Supabase leaderboard (incomplete)

2. **Limited Action Types**
   - Currently: WATCHLIST, ALERT, LOG, WEBHOOK only
   - Missing: COPY_TRADE, EXECUTE_TRADE, UPDATE_POSITION

3. **No Autonomous Scheduling**
   - execution_mode field exists in DB
   - No cron/background job system for autonomous execution

### Nice-to-Have Gaps

1. **No Strategy Composition/Templates**
   - Can't save/reuse strategy templates
   - Missing: Strategy marketplace/sharing

2. **No Backtesting**
   - Can't test strategy on historical data
   - Missing: Performance simulation

3. **No Multi-Leg Orders**
   - Can only copy single trades
   - Missing: Hedging, spread strategies

---

## 8. RECOMMENDED IMPLEMENTATION ROADMAP

### Phase 1: Enable Copy Trading (2-3 weeks)

**Priority 1A** - Trade Execution Engine
- [ ] Create TradeExecutor class
- [ ] Implement paper trading (mock trades to DB)
- [ ] Add position tracking
- [ ] Create GET /api/strategies/[id]/copy-trading/performance endpoint

**Priority 1B** - Wallet Monitoring Loop
- [ ] Create background worker (cron or Temporal)
- [ ] Implement tracked wallet polling
- [ ] Signal detection (consensus logic)
- [ ] Trade triggering

**Priority 1C** - Approval Workflow
- [ ] Create POST /api/strategies/[id]/approve endpoint
- [ ] Implement decision queue
- [ ] Add approval timeout/auto-execution logic

### Phase 2: Enhance Wallet Metrics (1-2 weeks)

- [ ] Migrate all 102 metrics to ClickHouse
- [ ] Create wallet_metrics view with caching
- [ ] Add metric aggregation by category
- [ ] Performance optimization (indexes, materialized views)

### Phase 3: Real-Time Streaming (2-3 weeks)

- [ ] Implement WebSocket server
- [ ] Add real-time price feed integration
- [ ] Implement momentum/acceleration calculations
- [ ] Sub-second latency detection

---

## 9. FILE MANIFEST

### Strategy Builder Core
- `/components/strategy-builder/` (35 files)
  - enhanced-filter-node/ (8 files)
  - orchestrator-node/ (5 files)
  - Layout tools, grid snap, alignment
  - Configuration dialogs

### Node Types
- `/components/strategy-nodes/`
  - action-node.tsx
  - signal-node.tsx
  - data-source-node.tsx
  - aggregation-node.tsx
  - filter-node.tsx
  - watchlist-node.tsx
  - logic-node.tsx

### Strategy Execution
- `/lib/strategy-builder/`
  - execution-engine.ts (execution orchestration)
  - clickhouse-connector.ts (metric queries)
  - supabase-connector.ts (persistence)
  - types.ts (102 metrics + configs)
  - field-discovery.ts (available fields)
  - metric-field-mapping.ts (metric definitions)

### API Routes
- `/app/api/strategies/`
  - route.ts (CRUD)
  - execute/route.ts (one-shot execution)
  - [id]/execute-now/route.ts (manual trigger)
  - [id]/watchlist/route.ts (list/clear)
  - [id]/watchlist/stream/route.ts (501)
  - [id]/trades/route.ts
  - [id]/positions/route.ts
  - [id]/performance/route.ts
  - [id]/status/route.ts

### Copy Trading
- `/docs/copy-trading-modes-architecture.md`
- `/supabase/migrations/20251029000001_create_copy_trading_tables.sql`
- `/components/strategy-dashboard/components/copy-trading-section.tsx`
- `/app/api/trading/monitor/route.ts`

### Wallet Filtering
- `/components/wallet-filter-node/index.tsx`
- `/components/omega-leaderboard-interface/index.tsx`

### Database
- `supabase/migrations/*` (workflow_sessions, strategy_definitions, copy_trading_*)

---

## 10. CONCLUSION

The Cascadian strategy builder is **architecturally complete and visually impressive**. The UI, filtering components, and backend infrastructure are 80-90% done. However, the system is **missing the actual execution engine** for copy trading.

**Current Capability**: Users can design strategies visually, but trades won't actually execute.

**To ship copy trading**: Need to implement ~2-3 weeks of work on trade execution, wallet monitoring, and approval workflows. The hard part (UI, metrics, schema) is already done.

**Recommended**: Build trade execution in Phase 1, defer real-time streaming to Phase 3 as currently planned.
