# Autonomous Strategy Execution Integration - Complete

**Date**: October 27, 2025
**Status**: ✅ Fully Integrated

---

## 🎯 Overview

Successfully integrated the **autonomous strategy execution system** with the **paper trading deployment system**. The background job scheduler now works seamlessly with the strategy builder's deployment flow.

### Problem Solved

Previously, there were **two separate table systems** that didn't communicate:

1. **`workflow_sessions`** table - Used by the cron executor
2. **`strategy_definitions`** table - Used by the strategy builder and deployment system

This meant that deploying a strategy through the UI wouldn't trigger autonomous execution because the cron job was looking at the wrong table.

### Solution Implemented

Updated **all autonomous execution components** to use `strategy_definitions` as the single source of truth.

---

## 📋 Changes Made

### 1. Strategy Executor (Cron Job) - `/app/api/cron/strategy-executor/executor.ts`

**Changed:**
- ✅ `findDueStrategies()` - Now queries `strategy_definitions` instead of `workflow_sessions`
- ✅ `executeStrategy()` - Extracts nodes/edges from `node_graph` JSONB field
- ✅ `updateStrategyAfterExecution()` - Updates `strategy_definitions` and creates execution logs
- ✅ Added `cronToMinutes()` helper to convert cron expressions to minutes

**Field Mappings:**

| Old (workflow_sessions) | New (strategy_definitions) |
|------------------------|---------------------------|
| `id` | `strategy_id` |
| `name` | `strategy_name` |
| `user_id` | `created_by` |
| `auto_run = TRUE` | `execution_mode = 'SCHEDULED'` AND `is_active = TRUE` |
| `execution_interval_minutes` | `schedule_cron` (converted to minutes) |
| `next_execution_at` | Calculated from `last_executed_at` + cron interval |
| `execution_count` | `total_executions` |
| `average_execution_time_ms` | `avg_execution_time_ms` |
| `nodes` / `edges` | `node_graph.nodes` / `node_graph.edges` |

**Removed:**
- ❌ `success_count` / `error_count` - Not tracked in strategy_definitions
- ❌ Auto-pause after 3 errors - Simplified for MVP
- ❌ `next_execution_at` database field - Now calculated dynamically

---

### 2. Strategy Control Endpoints

All control endpoints updated to use `strategy_definitions`:

#### `/app/api/strategies/[id]/start/route.ts`
- ✅ Now queries `strategy_definitions` (not `workflow_sessions`)
- ✅ Sets `is_active = true` to activate strategy
- ✅ Validates `execution_mode = 'SCHEDULED'` before starting
- ✅ Returns trading mode info in response

#### `/app/api/strategies/[id]/pause/route.ts`
- ✅ Now queries `strategy_definitions`
- ✅ Sets `is_active = false` to pause strategy
- ✅ Simplified state management (no separate 'paused' status)

#### `/app/api/strategies/[id]/stop/route.ts`
- ✅ Now queries `strategy_definitions`
- ✅ Sets `is_active = false` to stop strategy
- ✅ Identical to pause (simplified)

#### `/app/api/strategies/[id]/resume/route.ts`
- ✅ Now queries `strategy_definitions`
- ✅ Sets `is_active = true` to resume strategy
- ✅ Validates `execution_mode = 'SCHEDULED'` before resuming

---

## 🔄 How It Works Now

### Complete Deployment → Execution Flow

```
1. User builds strategy in Strategy Builder
   └─> Saves to strategy_definitions table
   └─> Sets node_graph, trading_mode, paper_bankroll_usd

2. User clicks "Deploy" button
   └─> Opens Deployment Config Dialog
   └─> User selects:
       - Trading mode (Paper/Live)
       - Paper bankroll ($100 - $1,000,000)
       - Execution frequency (1min, 5min, 15min, 30min, 1hour)
       - Auto-start (Yes/No)

3. Deployment API creates deployment record
   └─> POST /api/strategies/[id]/deploy
   └─> Updates strategy_definitions:
       - execution_mode = 'SCHEDULED'
       - schedule_cron = '*/5 * * * *' (example: every 5 minutes)
       - trading_mode = 'paper'
       - paper_bankroll_usd = 10000

4. (Optional) Start API activates strategy
   └─> POST /api/strategies/[id]/start
   └─> Updates strategy_definitions:
       - is_active = TRUE
   └─> Now eligible for cron execution!

5. Vercel Cron Job runs every minute
   └─> GET /api/cron/strategy-executor
   └─> Queries: execution_mode='SCHEDULED' AND is_active=TRUE
   └─> Checks: last_executed_at + cron_interval <= NOW
   └─> Executes due strategies via WorkflowExecutor

6. WorkflowExecutor processes workflow
   └─> Executes nodes in topological order
   └─> Orchestrator node makes trade decisions
   └─> Creates paper_trades records (if paper mode)
   └─> Updates paper_portfolios via database triggers

7. Executor updates strategy after execution
   └─> Updates strategy_definitions:
       - last_executed_at = NOW
       - total_executions += 1
       - avg_execution_time_ms = rolling average
   └─> Creates strategy_execution_logs record

8. Dashboard shows real-time performance
   └─> Fetches from paper_portfolios and paper_trades
   └─> Displays P&L, ROI, win rate, positions
```

---

## 🗄️ Database Schema

### `strategy_definitions` Table (Primary)

```sql
CREATE TABLE strategy_definitions (
  strategy_id UUID PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  strategy_description TEXT,
  strategy_type TEXT,

  -- Node Graph
  node_graph JSONB NOT NULL,  -- { nodes: [...], edges: [...] }

  -- Execution Configuration
  execution_mode TEXT DEFAULT 'MANUAL',  -- 'MANUAL' | 'AUTO' | 'SCHEDULED'
  schedule_cron TEXT,                     -- '*/5 * * * *' = every 5 minutes
  is_active BOOLEAN DEFAULT TRUE,         -- TRUE = running, FALSE = paused

  -- Paper Trading
  trading_mode TEXT DEFAULT 'paper',      -- 'paper' | 'live'
  paper_bankroll_usd NUMERIC,
  paper_pnl_usd NUMERIC DEFAULT 0,
  paper_positions_count INTEGER DEFAULT 0,

  -- Performance Tracking
  total_executions INTEGER DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  avg_execution_time_ms INTEGER,

  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Cron Query

```sql
-- What the cron executor queries every minute:
SELECT * FROM strategy_definitions
WHERE execution_mode = 'SCHEDULED'
  AND is_active = TRUE
  AND (
    last_executed_at IS NULL
    OR last_executed_at + INTERVAL '[cron_interval] minutes' <= NOW()
  )
LIMIT 25;
```

---

## ⚙️ Cron Expression Mapping

The deployment dialog provides 5 execution frequency options:

| Label | Cron Expression | Interval |
|-------|----------------|----------|
| Every 1 minute | `* * * * *` | 1 min |
| Every 5 minutes | `*/5 * * * *` | 5 min |
| Every 15 minutes | `*/15 * * * *` | 15 min |
| Every 30 minutes | `*/30 * * * *` | 30 min |
| Every 1 hour | `0 * * * *` | 60 min |

The `cronToMinutes()` function in the executor converts these to numeric intervals for calculating if a strategy is due.

---

## 📊 Execution Tracking

### Real-Time Updates

Every execution creates a log record in `strategy_execution_logs`:

```sql
CREATE TABLE strategy_execution_logs (
  id UUID PRIMARY KEY,
  strategy_id UUID REFERENCES strategy_definitions(strategy_id),
  status TEXT,                    -- 'completed' | 'failed'
  execution_time_ms INTEGER,
  nodes_executed INTEGER,
  error_message TEXT,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Performance Metrics

The `strategy_definitions` table tracks rolling statistics:

- **`total_executions`** - Lifetime execution count
- **`last_executed_at`** - Last execution timestamp (used to calculate next due time)
- **`avg_execution_time_ms`** - Rolling average execution time

Formula for rolling average:
```javascript
newAvg = (oldAvg * oldCount + newTime) / (oldCount + 1)
```

---

## 🔐 Security

### Vercel Cron Authentication

The cron endpoint is protected by Bearer token authentication:

```typescript
// In route.ts
function verifyAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET || process.env.ADMIN_API_KEY

  return authHeader === `Bearer ${cronSecret}`
}
```

### Supabase RLS

All strategy queries use Supabase service role key in the cron job, bypassing RLS. This is necessary because:
- Cron runs server-side without user context
- Service role has full database access
- User ownership is still tracked via `created_by` field

---

## 🧪 Testing the System

### Manual Test Flow

1. **Create a strategy** in Strategy Builder
   ```
   - Add nodes (Data Source → Filter → Orchestrator)
   - Configure orchestrator with paper portfolio settings
   - Save strategy
   ```

2. **Deploy the strategy**
   ```
   - Click "Deploy" button
   - Select "Paper Trading" mode
   - Set bankroll to $10,000
   - Choose "Every 5 minutes" frequency
   - Enable "Auto-start after deployment"
   - Click "Deploy"
   ```

3. **Verify deployment**
   ```sql
   SELECT
     strategy_name,
     execution_mode,
     schedule_cron,
     is_active,
     trading_mode,
     paper_bankroll_usd
   FROM strategy_definitions
   WHERE strategy_id = '[your-strategy-id]';

   -- Expected result:
   -- execution_mode: SCHEDULED
   -- schedule_cron: */5 * * * *
   -- is_active: TRUE
   -- trading_mode: paper
   ```

4. **Wait for cron execution** (max 1 minute)
   ```
   - Vercel Cron runs every 1 minute
   - Check execution logs in Vercel dashboard
   - Or query database:

   SELECT * FROM strategy_execution_logs
   WHERE strategy_id = '[your-strategy-id]'
   ORDER BY executed_at DESC
   LIMIT 5;
   ```

5. **Check paper trading results**
   ```sql
   -- View paper trades
   SELECT * FROM paper_trades
   WHERE strategy_id = '[your-strategy-id]'
   ORDER BY created_at DESC;

   -- View portfolio metrics
   SELECT * FROM paper_portfolios
   WHERE strategy_id = '[your-strategy-id]';
   ```

### Expected Behavior

- ✅ Strategy executes automatically every 5 minutes
- ✅ Each execution creates a log record
- ✅ Paper trades are created when orchestrator decides to trade
- ✅ Portfolio metrics auto-update via database triggers
- ✅ Dashboard shows real-time performance data

---

## 📈 Performance Considerations

### Cron Job Limits

- **Frequency**: Runs every 1 minute (Vercel Cron minimum)
- **Timeout**: 10 seconds (Vercel default for serverless functions)
- **Strategy Limit**: 25 strategies per execution (to stay under timeout)
- **Execution Time**: Target < 5 seconds for all strategies

### Optimization Strategies

1. **Partial Index on strategy_definitions**
   ```sql
   CREATE INDEX idx_scheduled_active_strategies
   ON strategy_definitions(execution_mode, is_active, last_executed_at)
   WHERE execution_mode = 'SCHEDULED' AND is_active = TRUE;
   ```

2. **Limit strategies fetched**: 25 per cron run
3. **Parallel execution**: Could be added later if needed
4. **Caching**: Node graph parsing could be cached

---

## 🚀 What's Next

### Immediate Priorities

1. ✅ **Background Job Scheduler** - COMPLETE!
2. 🔄 **Strategy Control Endpoints** - COMPLETE!
3. 🔄 **Execution Logging** - COMPLETE!
4. 📋 **Watchlist System** - Next up
5. 📋 **Live Trading Integration** - Phase 3

### Future Enhancements

- **Auto-pause on errors** - Restore 3-error auto-pause logic
- **Email notifications** - Alert users when strategies pause/error
- **Execution history UI** - Display logs in dashboard
- **Performance analytics** - Win rate trends, P&L charts over time
- **Multi-strategy orchestration** - Coordinate multiple strategies
- **Live trading mode** - Connect to Polymarket CLOB API

---

## 🎉 Summary

The autonomous strategy execution system is now **fully integrated** with the paper trading deployment system. Users can:

1. ✅ Build strategies visually in the Strategy Builder
2. ✅ Deploy with paper/live trading configuration
3. ✅ Set execution frequency (1min - 1hour intervals)
4. ✅ Enable auto-start for immediate autonomous execution
5. ✅ View real-time performance in the Strategy Dashboard
6. ✅ Control strategies (start/pause/stop/resume) via API or UI

The system is production-ready for **paper trading mode**. Live trading integration is planned for Phase 3.

---

**Key Achievement**: Unified the deployment and execution systems to work seamlessly together, eliminating the workflow_sessions / strategy_definitions disconnect! 🎊
