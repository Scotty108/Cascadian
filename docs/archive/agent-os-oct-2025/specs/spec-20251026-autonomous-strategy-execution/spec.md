# Specification: Autonomous Strategy Execution System

**Feature**: 24/7 Autonomous Strategy Execution & Monitoring for CASCADIAN
**Date**: 2025-10-26
**Status**: Design Phase
**Version**: 1.0

---

## Executive Summary

### Feature Overview

Transform CASCADIAN's Strategy Builder from an on-demand workflow execution tool into a fully autonomous 24/7 trading system. Currently, strategies execute once when users click "Run". This feature enables strategies to run continuously in the background, monitoring markets, executing trades, and providing real-time visibility through dedicated dashboards and notifications.

### Business Value

- **Competitive Advantage**: Only Polymarket platform with true autonomous trading capabilities
- **User Retention**: Users rely on CASCADIAN 24/7, increasing daily active usage
- **Revenue Opportunity**: Premium feature driving Pro/Enterprise tier upgrades
- **Market Positioning**: Positions CASCADIAN as institutional-grade trading infrastructure

### User Impact

- **Effortless Trading**: Set-and-forget strategies that work while users sleep
- **Never Miss Opportunities**: Computer-driven execution catches every signal
- **Risk Management**: Sub-wallet allocations and loss limits protect capital
- **Complete Visibility**: Real-time dashboards show exactly what strategies are doing

---

## Feature Scope

### What's Included in MVP (Phase 1)

**Core Autonomous Execution**:
- Background job system for 24/7 strategy execution
- Start/pause/stop controls for strategies
- Configurable execution intervals (5min, 15min, 1hr, etc.)
- Strategy status tracking (running, paused, stopped, error)
- Auto-restart on errors with exponential backoff

**Strategy Dashboard**:
- Individual strategy detail page with real-time status
- Execution metrics (uptime, last run, next run)
- Execution history log (last 50 runs)
- Performance metrics (total executions, success rate)
- Manual execution trigger

**Watchlist System**:
- "Add to Watchlist" workflow node
- Per-strategy watchlist storage in database
- View watchlist in strategy dashboard
- Manual removal from watchlist
- Duplicate detection

**Basic Notifications**:
- In-app notification system (bell icon)
- Strategy status changes (started, paused, stopped, error)
- Basic notification preferences

**Paper Trading Mode**:
- Simulated trade execution with real prices
- Hypothetical P&L tracking
- Test strategies before live trading

### What's Future Phases (Phase 2-3)

**Phase 2 - Watchlist Intelligence**:
- "Monitor Watchlist" workflow node
- Conditional triggers (momentum, volume, whale activity)
- Watchlist-to-trade conversion logic
- Exit position automation

**Phase 3 - Live Trading Integration**:
- Polymarket wallet connection (WalletConnect)
- Real CLOB API order execution
- Sub-wallet capital allocation system
- Risk management (stop-loss, take-profit, daily loss limits)
- Advanced notification delivery (email, SMS)

### What's Explicitly Out of Scope

- Mobile app (web-only for MVP)
- Multi-user collaboration on strategies
- Strategy marketplace during autonomous execution
- Advanced backtesting with historical replay
- Social trading / copy trading features
- Telegram/Discord bot integrations
- Custom API for external strategy triggers

---

## User Stories & Flows

### Story 1: Create and Deploy Autonomous Strategy

**As a** CASCADIAN user
**I want to** create a strategy that runs 24/7 automatically
**So that** I can systematically capture opportunities without manual intervention

**Acceptance Criteria**:
- User builds strategy in visual workflow editor
- User sets execution interval (e.g., "Check every 15 minutes")
- User clicks "Start Strategy" (not "Run Strategy")
- Strategy begins executing in background
- User can navigate away and strategy continues

**Flow**:
```
1. User opens Strategy Builder
2. Builds workflow: [Stream Markets] → [Filter by Volume] → [Add to Watchlist]
3. Saves as "Politics Scanner"
4. Clicks "Configure Execution"
5. Selects interval: "Every 15 minutes"
6. Clicks "Start Strategy"
7. UI shows: "Strategy running. Next execution in 15 min."
8. User navigates to Dashboard
9. Strategy continues running in background
```

### Story 2: Monitor Running Strategy

**As a** CASCADIAN user
**I want to** see what my strategy is doing in real-time
**So that** I can verify it's working as expected

**Acceptance Criteria**:
- Strategy detail page shows current status
- Execution log displays recent activity
- Performance metrics visible (success rate, uptime)
- Can pause/resume/stop from dashboard

**Flow**:
```
1. User navigates to "My Strategies"
2. Sees "Politics Scanner" with status: Running (green badge)
3. Clicks on strategy
4. Dashboard shows:
   - Status: Running
   - Uptime: 2 hours 34 minutes
   - Last execution: 2 minutes ago (Success)
   - Next execution: In 13 minutes
   - Total executions: 11
   - Success rate: 100%
   - Execution log:
     * 14:45 - Added "Trump 2024" to watchlist (volume: $125K)
     * 14:30 - Added "Biden Poll" to watchlist (volume: $98K)
     * 14:15 - No markets matched filters
     * ...
5. User clicks "Pause Strategy"
6. Status changes to: Paused (yellow badge)
7. Next execution cancelled
```

### Story 3: Receive Notifications

**As a** CASCADIAN user
**I want to** be notified when my strategy does something important
**So that** I stay informed without constantly checking

**Acceptance Criteria**:
- Bell icon shows unread notification count
- Notifications appear in notification center
- Can mark as read or archive
- Can configure which events trigger notifications

**Flow**:
```
1. Strategy adds market to watchlist
2. System creates notification:
   - Type: strategy_update
   - Title: "Politics Scanner added market to watchlist"
   - Message: "Added 'Trump vs Biden 2024' ($125K volume)"
3. Bell icon shows red badge (1 unread)
4. User clicks bell
5. Notification center opens
6. User clicks notification
7. Navigates to strategy dashboard
8. Notification marked as read
```

### Story 4: Handle Strategy Errors

**As a** CASCADIAN user
**I want to** be notified if my strategy encounters errors
**So that** I can fix issues and resume execution

**Acceptance Criteria**:
- Strategy automatically pauses on errors
- Error notification sent to user
- Error details visible in execution log
- Can manually restart after fixing

**Flow**:
```
1. Strategy executes workflow
2. Node fails (e.g., API timeout)
3. System:
   - Marks execution as failed
   - Pauses strategy
   - Creates error notification
4. User receives notification:
   - Priority: high
   - Title: "Politics Scanner encountered an error"
   - Message: "Execution failed: API timeout at Filter node"
5. User navigates to strategy
6. Reviews error in execution log
7. Clicks "Retry Now"
8. Strategy resumes execution
```

---

## Technical Design

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERFACE LAYER                      │
│  ┌──────────────────────┐  ┌───────────────────────────┐   │
│  │  Strategy Dashboard  │  │  Notification Center      │   │
│  │  - Status indicators │  │  - Bell icon with badge   │   │
│  │  - Execution logs    │  │  - Notification list      │   │
│  │  - Performance       │  │  - Mark read/archive      │   │
│  │  - Start/Pause/Stop  │  │                           │   │
│  └──────────────────────┘  └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   API LAYER (Next.js Routes)                 │
│  ┌──────────────────────┐  ┌───────────────────────────┐   │
│  │  Strategy Control    │  │  Notification API         │   │
│  │  POST /strategies/   │  │  GET /notifications       │   │
│  │       [id]/start     │  │  POST /notifications      │   │
│  │  POST /strategies/   │  │  PATCH /notifications/    │   │
│  │       [id]/pause     │  │        [id]/read          │   │
│  │  POST /strategies/   │  │                           │   │
│  │       [id]/stop      │  │                           │   │
│  └──────────────────────┘  └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              BACKGROUND JOB ORCHESTRATOR                     │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Vercel Cron Job (Every 1 minute)                  │    │
│  │  GET /api/cron/strategy-executor                   │    │
│  │                                                     │    │
│  │  1. Query active strategies from DB                │    │
│  │  2. Check if execution is due (based on interval)  │    │
│  │  3. Execute workflow via WorkflowExecutor          │    │
│  │  4. Update last_executed_at timestamp              │    │
│  │  5. Log execution results                          │    │
│  │  6. Send notifications on events                   │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                WORKFLOW EXECUTION ENGINE                     │
│  ┌────────────────────────────────────────────────────┐    │
│  │  WorkflowExecutor (lib/workflow/executor.ts)       │    │
│  │  - Topological sort                                │    │
│  │  - Sequential node execution                       │    │
│  │  - Error handling & retry                          │    │
│  │  - Output tracking                                 │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATA PERSISTENCE                          │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ workflow_     │  │ workflow_    │  │ notifications   │  │
│  │ sessions      │  │ executions   │  │                 │  │
│  │ - execution_  │  │ - status     │  │ - type          │  │
│  │   interval    │  │ - outputs    │  │ - title         │  │
│  │ - auto_run    │  │ - errors     │  │ - message       │  │
│  │ - status      │  │ - duration   │  │ - is_read       │  │
│  │ - last_exec   │  │              │  │ - priority      │  │
│  └───────────────┘  └──────────────┘  └─────────────────┘  │
│                                                              │
│  ┌───────────────┐  ┌──────────────┐                       │
│  │ strategy_     │  │ notification_│                       │
│  │ watchlists    │  │ settings     │                       │
│  │ - market_id   │  │ - enabled    │                       │
│  │ - added_at    │  │ - delivery   │                       │
│  │ - reason      │  │                                       │
│  └───────────────┘  └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema (SQL)

```sql
-- ============================================================================
-- ALTER EXISTING workflow_sessions TABLE
-- Add columns for autonomous execution
-- ============================================================================

ALTER TABLE workflow_sessions
  ADD COLUMN execution_interval_minutes INTEGER DEFAULT 5 CHECK (execution_interval_minutes >= 1),
  ADD COLUMN auto_run BOOLEAN DEFAULT FALSE,
  ADD COLUMN last_executed_at TIMESTAMPTZ,
  ADD COLUMN next_execution_at TIMESTAMPTZ,
  ADD COLUMN execution_count INTEGER DEFAULT 0,
  ADD COLUMN success_count INTEGER DEFAULT 0,
  ADD COLUMN error_count INTEGER DEFAULT 0,
  ADD COLUMN average_execution_time_ms INTEGER;

-- Update status enum to include 'running' and 'paused'
-- Existing values: 'draft', 'active', 'archived'
-- New values: 'running', 'paused', 'stopped', 'error'
ALTER TABLE workflow_sessions
  DROP CONSTRAINT IF EXISTS workflow_sessions_status_check;

ALTER TABLE workflow_sessions
  ADD CONSTRAINT workflow_sessions_status_check
  CHECK (status IN ('draft', 'active', 'archived', 'running', 'paused', 'stopped', 'error'));

-- Index for cron job to find due executions
CREATE INDEX idx_workflow_sessions_auto_run
  ON workflow_sessions(auto_run, next_execution_at)
  WHERE auto_run = TRUE AND status IN ('running', 'error');

COMMENT ON COLUMN workflow_sessions.execution_interval_minutes IS 'How often to execute strategy (in minutes). Min: 1, Recommended: 5+';
COMMENT ON COLUMN workflow_sessions.auto_run IS 'Whether strategy runs autonomously (TRUE) or manually (FALSE)';
COMMENT ON COLUMN workflow_sessions.last_executed_at IS 'Timestamp of last successful or failed execution';
COMMENT ON COLUMN workflow_sessions.next_execution_at IS 'Scheduled timestamp for next execution';
COMMENT ON COLUMN workflow_sessions.execution_count IS 'Total number of executions (success + failure)';
COMMENT ON COLUMN workflow_sessions.success_count IS 'Number of successful executions';
COMMENT ON COLUMN workflow_sessions.error_count IS 'Number of failed executions';

-- ============================================================================
-- CREATE strategy_watchlists TABLE
-- Per-strategy watchlist for markets to monitor
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_watchlists (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Keys
  workflow_id UUID NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,

  -- Metadata
  added_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  added_by_execution_id UUID REFERENCES workflow_executions(id),
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Deduplication
  UNIQUE(workflow_id, market_id)
);

-- Indexes
CREATE INDEX idx_strategy_watchlists_workflow
  ON strategy_watchlists(workflow_id, added_at DESC);

CREATE INDEX idx_strategy_watchlists_market
  ON strategy_watchlists(market_id);

COMMENT ON TABLE strategy_watchlists IS 'Markets added to watchlist by autonomous strategies';
COMMENT ON COLUMN strategy_watchlists.reason IS 'Optional explanation of why market was added (from workflow output)';
COMMENT ON COLUMN strategy_watchlists.metadata IS 'Snapshot of market data at time of add (price, volume, etc.)';

-- ============================================================================
-- ALTER notifications TABLE
-- Enhance existing notifications table for strategy events
-- ============================================================================

-- Add workflow_id foreign key if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'workflow_id'
  ) THEN
    ALTER TABLE notifications
      ADD COLUMN workflow_id UUID REFERENCES workflow_sessions(id) ON DELETE SET NULL;

    CREATE INDEX idx_notifications_workflow
      ON notifications(workflow_id, created_at DESC);
  END IF;
END $$;

-- Ensure priority column exists with proper check constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'priority'
  ) THEN
    ALTER TABLE notifications
      ADD COLUMN priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END $$;

COMMENT ON COLUMN notifications.workflow_id IS 'Strategy that triggered notification (nullable for non-strategy notifications)';
COMMENT ON COLUMN notifications.priority IS 'Notification urgency level (low, normal, high, urgent)';

-- ============================================================================
-- CREATE notification_settings TABLE
-- User preferences for notification delivery
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_settings (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Key
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Notification Type
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'strategy_started',
    'strategy_paused',
    'strategy_stopped',
    'strategy_error',
    'watchlist_updated',
    'execution_completed',
    'execution_failed'
  )),

  -- Settings
  enabled BOOLEAN DEFAULT TRUE,
  delivery_method TEXT DEFAULT 'in-app' CHECK (delivery_method IN ('in-app', 'email', 'both')),

  -- Quiet Hours
  quiet_hours_enabled BOOLEAN DEFAULT FALSE,
  quiet_hours_start TIME,
  quiet_hours_end TIME,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint
  UNIQUE(user_id, notification_type)
);

-- Index
CREATE INDEX idx_notification_settings_user
  ON notification_settings(user_id);

COMMENT ON TABLE notification_settings IS 'User preferences for strategy notifications';
COMMENT ON COLUMN notification_settings.quiet_hours_enabled IS 'Suppress notifications during specified time range';

-- ============================================================================
-- CREATE strategy_execution_logs TABLE
-- Detailed execution logs for debugging (replaces workflow_executions outputs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_execution_logs (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Keys
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,

  -- Log Entry
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'skipped')),

  -- Output/Error
  output JSONB,
  error_message TEXT,

  -- Timing
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_strategy_execution_logs_execution
  ON strategy_execution_logs(execution_id, started_at);

CREATE INDEX idx_strategy_execution_logs_workflow
  ON strategy_execution_logs(workflow_id, started_at DESC);

COMMENT ON TABLE strategy_execution_logs IS 'Node-level execution logs for autonomous strategies';
COMMENT ON COLUMN strategy_execution_logs.output IS 'Node execution output (markets, data, etc.)';

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Strategy Watchlists: Users can only see their own strategy watchlists
ALTER TABLE strategy_watchlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategy watchlists"
  ON strategy_watchlists FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_watchlists.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert into own strategy watchlists"
  ON strategy_watchlists FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_watchlists.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete from own strategy watchlists"
  ON strategy_watchlists FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_watchlists.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Notification Settings: Users can only manage their own settings
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification settings"
  ON notification_settings FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own notification settings"
  ON notification_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own notification settings"
  ON notification_settings FOR UPDATE
  USING (user_id = auth.uid());

-- Execution Logs: Users can view logs for their own strategies
ALTER TABLE strategy_execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategy execution logs"
  ON strategy_execution_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = strategy_execution_logs.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );
```

### API Endpoints

#### Strategy Control Endpoints

```typescript
// ============================================================================
// START STRATEGY
// ============================================================================

POST /api/strategies/[id]/start

Request Body:
{
  interval_minutes?: number  // Optional: Override default interval (default: 5)
}

Response:
{
  success: true,
  data: {
    id: "uuid",
    name: "Politics Scanner",
    status: "running",
    auto_run: true,
    execution_interval_minutes: 15,
    next_execution_at: "2025-10-26T15:45:00Z",
    message: "Strategy started. Next execution in 15 minutes."
  }
}

Errors:
- 400: Strategy already running
- 404: Strategy not found
- 403: User doesn't own strategy

// ============================================================================
// PAUSE STRATEGY
// ============================================================================

POST /api/strategies/[id]/pause

Response:
{
  success: true,
  data: {
    id: "uuid",
    name: "Politics Scanner",
    status: "paused",
    auto_run: false,
    next_execution_at: null,
    message: "Strategy paused. No further executions scheduled."
  }
}

// ============================================================================
// STOP STRATEGY
// ============================================================================

POST /api/strategies/[id]/stop

Response:
{
  success: true,
  data: {
    id: "uuid",
    name: "Politics Scanner",
    status: "stopped",
    auto_run: false,
    next_execution_at: null,
    message: "Strategy stopped permanently."
  }
}

// ============================================================================
// RESUME STRATEGY
// ============================================================================

POST /api/strategies/[id]/resume

Response:
{
  success: true,
  data: {
    id: "uuid",
    name: "Politics Scanner",
    status: "running",
    auto_run: true,
    next_execution_at: "2025-10-26T15:45:00Z",
    message: "Strategy resumed."
  }
}

// ============================================================================
// GET STRATEGY STATUS
// ============================================================================

GET /api/strategies/[id]/status

Response:
{
  success: true,
  data: {
    id: "uuid",
    name: "Politics Scanner",
    status: "running",
    auto_run: true,
    execution_interval_minutes: 15,
    last_executed_at: "2025-10-26T15:30:00Z",
    next_execution_at: "2025-10-26T15:45:00Z",
    execution_count: 48,
    success_count: 47,
    error_count: 1,
    success_rate: 0.979,
    average_execution_time_ms: 1245,
    uptime_seconds: 86400,  // 24 hours
    watchlist_size: 12,
    active_trades: 0  // Future: Phase 3
  }
}

// ============================================================================
// GET EXECUTION HISTORY
// ============================================================================

GET /api/strategies/[id]/executions?limit=50&offset=0

Response:
{
  success: true,
  data: [
    {
      id: "exec-uuid-1",
      workflow_id: "uuid",
      executed_at: "2025-10-26T15:30:00Z",
      status: "completed",
      duration_ms: 1234,
      nodes_executed: 5,
      outputs: {
        "node-1": { markets: [...] },
        "node-2": { filtered: [...] }
      },
      summary: "Added 2 markets to watchlist"
    },
    {
      id: "exec-uuid-2",
      workflow_id: "uuid",
      executed_at: "2025-10-26T15:15:00Z",
      status: "failed",
      duration_ms: 543,
      nodes_executed: 3,
      error_message: "Node 'filter-1' failed: API timeout",
      summary: "Execution failed at Filter node"
    }
  ],
  metadata: {
    total: 48,
    limit: 50,
    offset: 0
  }
}

// ============================================================================
// MANUAL EXECUTION TRIGGER
// ============================================================================

POST /api/strategies/[id]/execute-now

Response:
{
  success: true,
  data: {
    execution_id: "exec-uuid",
    status: "running",
    message: "Manual execution started. Check execution history for results."
  }
}
```

#### Watchlist Endpoints

```typescript
// ============================================================================
// GET STRATEGY WATCHLIST
// ============================================================================

GET /api/strategies/[id]/watchlist?limit=100&offset=0

Response:
{
  success: true,
  data: [
    {
      id: "watchlist-uuid-1",
      workflow_id: "strategy-uuid",
      market_id: "market-123",
      added_at: "2025-10-26T14:30:00Z",
      reason: "High volume ($125K), Politics category",
      metadata: {
        volume_24h: 125000,
        current_price: 0.65,
        category: "Politics"
      },
      market: {
        question: "Will Trump win 2024?",
        category: "Politics",
        current_price: 0.67,  // Current price (may have changed)
        volume_24h: 130000
      }
    }
  ],
  metadata: {
    total: 12,
    limit: 100,
    offset: 0
  }
}

// ============================================================================
// REMOVE FROM WATCHLIST
// ============================================================================

DELETE /api/strategies/[id]/watchlist/[market_id]

Response:
{
  success: true,
  data: {
    message: "Market removed from watchlist"
  }
}

// ============================================================================
// CLEAR ENTIRE WATCHLIST
// ============================================================================

DELETE /api/strategies/[id]/watchlist

Response:
{
  success: true,
  data: {
    removed_count: 12,
    message: "Watchlist cleared"
  }
}
```

#### Notification Endpoints (Enhanced)

```typescript
// ============================================================================
// CREATE NOTIFICATION (Internal - called by background jobs)
// ============================================================================

POST /api/notifications

Request Body:
{
  user_id?: string,            // Optional: null for broadcast
  workflow_id?: string,         // Optional: strategy that triggered notification
  type: "strategy_started" | "strategy_paused" | "strategy_stopped" |
        "strategy_error" | "watchlist_updated" | "execution_completed" |
        "execution_failed",
  title: string,
  message: string,
  link?: string,                // Optional: Deep link to strategy dashboard
  priority?: "low" | "normal" | "high" | "urgent",
  metadata?: object
}

Response:
{
  success: true,
  data: {
    id: "notif-uuid",
    type: "watchlist_updated",
    title: "Politics Scanner added market to watchlist",
    message: "Added 'Trump vs Biden 2024' ($125K volume)",
    link: "/strategies/strategy-uuid",
    priority: "normal",
    is_read: false,
    created_at: "2025-10-26T15:30:00Z"
  }
}

// ============================================================================
// GET NOTIFICATION SETTINGS
// ============================================================================

GET /api/notifications/settings

Response:
{
  success: true,
  data: [
    {
      notification_type: "strategy_started",
      enabled: true,
      delivery_method: "in-app"
    },
    {
      notification_type: "strategy_error",
      enabled: true,
      delivery_method: "both",  // in-app + email
      quiet_hours_enabled: true,
      quiet_hours_start: "23:00:00",
      quiet_hours_end: "07:00:00"
    }
  ]
}

// ============================================================================
// UPDATE NOTIFICATION SETTINGS
// ============================================================================

PATCH /api/notifications/settings

Request Body:
{
  settings: [
    {
      notification_type: "strategy_error",
      enabled: true,
      delivery_method: "both"
    }
  ]
}

Response:
{
  success: true,
  data: {
    updated_count: 1,
    message: "Notification settings updated"
  }
}
```

#### Background Job Endpoint (Cron)

```typescript
// ============================================================================
// STRATEGY EXECUTOR CRON JOB
// ============================================================================

GET /api/cron/strategy-executor

Headers:
{
  "Authorization": "Bearer <CRON_SECRET>"
}

Response:
{
  success: true,
  data: {
    strategies_checked: 25,
    strategies_executed: 3,
    executions: [
      {
        workflow_id: "uuid-1",
        status: "completed",
        duration_ms: 1234
      },
      {
        workflow_id: "uuid-2",
        status: "completed",
        duration_ms: 987
      },
      {
        workflow_id: "uuid-3",
        status: "failed",
        error: "API timeout"
      }
    ],
    notifications_sent: 4,
    execution_time_ms: 5432
  }
}

Implementation Details:
1. Query workflow_sessions where auto_run=TRUE and next_execution_at <= NOW()
2. For each due strategy:
   a. Execute workflow using WorkflowExecutor
   b. Log execution to workflow_executions table
   c. Update last_executed_at, next_execution_at, execution_count
   d. Send notifications on events (watchlist updates, errors, etc.)
   e. Handle errors (auto-pause on repeated failures)
3. Return summary of executions
```

---

## Component Specifications

### Strategy Dashboard Component

**Component**: `components/strategy-dashboard-interface/index.tsx`

**Purpose**: Real-time monitoring dashboard for individual autonomous strategies

**UI Layout**:
```
┌────────────────────────────────────────────────────────────┐
│ ← Back to Strategies                                       │
│                                                            │
│ Politics Scanner                                  [Running]│
│ Created 3 days ago • Last edited 2 hours ago              │
│                                                            │
│ ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐ │
│ │ Status          │ │ Uptime          │ │ Executions   │ │
│ │ Running         │ │ 2h 34m          │ │ 48 total     │ │
│ │ Next: 13min     │ │                 │ │ 47 success   │ │
│ │                 │ │                 │ │ 1 failed     │ │
│ └─────────────────┘ └─────────────────┘ └──────────────┘ │
│                                                            │
│ [Pause Strategy] [Stop Strategy] [Execute Now]            │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐  │
│ │ Execution Log (Last 50 runs)                         │  │
│ ├──────────────────────────────────────────────────────┤  │
│ │ ✅ 15:30 - Completed (1.2s)                          │  │
│ │    Added 2 markets to watchlist                      │  │
│ │                                                       │  │
│ │ ✅ 15:15 - Completed (0.9s)                          │  │
│ │    No markets matched filters                        │  │
│ │                                                       │  │
│ │ ❌ 15:00 - Failed (0.5s)                             │  │
│ │    Error: API timeout at Filter node                 │  │
│ │    [View Details]                                    │  │
│ │                                                       │  │
│ │ ✅ 14:45 - Completed (1.1s)                          │  │
│ │    Added 3 markets to watchlist                      │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐  │
│ │ Watchlist (12 markets)                  [Clear All]  │  │
│ ├──────────────────────────────────────────────────────┤  │
│ │ Trump vs Biden 2024                            [×]   │  │
│ │ Politics • $125K volume • Added 2 min ago            │  │
│ │                                                       │  │
│ │ Bitcoin ETF Approval                           [×]   │  │
│ │ Crypto • $98K volume • Added 17 min ago              │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐  │
│ │ Performance Metrics                                   │  │
│ ├──────────────────────────────────────────────────────┤  │
│ │ Success Rate: 97.9%                                  │  │
│ │ Avg Execution Time: 1.2s                             │  │
│ │ Total Markets Watched: 45                            │  │
│ └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Key Features**:
- Real-time status indicators with color coding
- Live countdown to next execution
- Execution log with auto-refresh (every 30 seconds)
- Watchlist with inline removal
- Control buttons (Pause, Stop, Execute Now)
- Performance metrics visualization

**Data Fetching**:
```typescript
// hooks/use-strategy-status.ts
export function useStrategyStatus(workflowId: string) {
  return useQuery({
    queryKey: ['strategy-status', workflowId],
    queryFn: () => fetch(`/api/strategies/${workflowId}/status`).then(r => r.json()),
    refetchInterval: 30000, // Refresh every 30 seconds
  })
}

// hooks/use-strategy-executions.ts
export function useStrategyExecutions(workflowId: string, limit = 50) {
  return useQuery({
    queryKey: ['strategy-executions', workflowId, limit],
    queryFn: () => fetch(`/api/strategies/${workflowId}/executions?limit=${limit}`).then(r => r.json()),
    refetchInterval: 30000,
  })
}

// hooks/use-strategy-watchlist.ts
export function useStrategyWatchlist(workflowId: string) {
  return useQuery({
    queryKey: ['strategy-watchlist', workflowId],
    queryFn: () => fetch(`/api/strategies/${workflowId}/watchlist`).then(r => r.json()),
    refetchInterval: 60000, // Refresh every 60 seconds
  })
}
```

### Strategies Overview Component

**Component**: `components/strategies-overview-interface/index.tsx`

**Purpose**: Grid view of all user strategies with status badges

**UI Layout**:
```
┌────────────────────────────────────────────────────────────┐
│ My Strategies                                              │
│                                                            │
│ Filter: [All ▼] [Running ▼] [Paused ▼] [Stopped ▼]        │
│                                                            │
│ ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐ │
│ │ Politics Scanner│ │ Whale Follower  │ │ Momentum Bot │ │
│ │ [Running] 🟢    │ │ [Paused] 🟡     │ │ [Running] 🟢 │ │
│ │                 │ │                 │ │              │ │
│ │ Uptime: 2h 34m  │ │ Last run: 1h ago│ │ Uptime: 5d   │ │
│ │ Watchlist: 12   │ │ Watchlist: 8    │ │ Watchlist: 3 │ │
│ │ Success: 97.9%  │ │ Success: 100%   │ │ Success: 85% │ │
│ │                 │ │                 │ │              │ │
│ │ [View] [Pause]  │ │ [View] [Resume] │ │ [View] [Stop]│ │
│ └─────────────────┘ └─────────────────┘ └──────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Notification Center Component

**Component**: `components/notification-center/index.tsx`

**Purpose**: In-app notification list with mark as read/archive

**UI Layout**:
```
┌────────────────────────────────────────────────────────────┐
│ Notifications                           [Mark All Read]    │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐  │
│ │ 🔴 Politics Scanner added market to watchlist        │  │
│ │    Added 'Trump vs Biden 2024' ($125K volume)        │  │
│ │    2 minutes ago                      [×]            │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐  │
│ │    Politics Scanner completed execution              │  │
│ │    No markets matched filters                        │  │
│ │    17 minutes ago                     [×]            │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐  │
│ │ ⚠️ Whale Follower encountered an error               │  │
│ │    Execution failed: API timeout                     │  │
│ │    1 hour ago                         [×]            │  │
│ └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Features**:
- Unread indicator (red dot)
- Priority-based styling (errors in red)
- Deep links to strategy dashboard
- Mark as read / Archive
- Real-time updates via polling

---

## New Workflow Nodes

### "Add to Watchlist" Node

**Node Type**: `add-to-watchlist`

**Purpose**: Add markets to strategy's persistent watchlist

**Configuration**:
```typescript
interface AddToWatchlistConfig {
  reason?: string  // Optional: Why market was added
}
```

**Inputs**:
- `markets`: Array of market objects (from Stream Markets node)

**Outputs**:
- `added`: Array of added market IDs
- `duplicates`: Array of market IDs already in watchlist
- `count`: Number of markets added

**Execution Logic**:
```typescript
async function executeAddToWatchlist(node, inputs, context) {
  const markets = inputs.markets || []
  const { reason } = node.config

  const added = []
  const duplicates = []

  for (const market of markets) {
    const exists = await checkWatchlistExists(context.workflowId, market.id)

    if (exists) {
      duplicates.push(market.id)
      continue
    }

    await supabase.from('strategy_watchlists').insert({
      workflow_id: context.workflowId,
      market_id: market.id,
      reason: reason || `Added by ${node.label}`,
      metadata: {
        volume_24h: market.volume_24h,
        current_price: market.current_price,
        category: market.category
      }
    })

    added.push(market.id)

    // Send notification
    await createNotification({
      workflow_id: context.workflowId,
      type: 'watchlist_updated',
      title: `${workflow.name} added market to watchlist`,
      message: `Added '${market.question}' ($${formatNumber(market.volume_24h)} volume)`,
      link: `/strategies/${context.workflowId}`,
      priority: 'normal'
    })
  }

  return { added, duplicates, count: added.length }
}
```

**UI in Node Palette**:
```
┌─────────────────────────┐
│ 📌 Add to Watchlist     │
│ Add markets to monitor  │
└─────────────────────────┘
```

---

## Integration Points

### Existing WorkflowExecutor Integration

The existing `WorkflowExecutor` class (`lib/workflow/executor.ts`) already supports:
- ✅ Topological sorting for node execution order
- ✅ Reference resolution (`${nodeId.field}` syntax)
- ✅ Error handling with try/catch
- ✅ Execution context tracking

**What We Need to Add**:
```typescript
// In executeOnce() method, after successful execution:

// Send notifications on key events
if (output.added && output.added.length > 0) {
  await notificationService.createNotification({
    workflow_id: workflow.id,
    type: 'watchlist_updated',
    title: `${workflow.name} added markets to watchlist`,
    message: `Added ${output.added.length} market(s)`,
    priority: 'normal'
  })
}

// Update strategy metrics
await supabase
  .from('workflow_sessions')
  .update({
    execution_count: execution_count + 1,
    success_count: errors.length === 0 ? success_count + 1 : success_count,
    error_count: errors.length > 0 ? error_count + 1 : error_count,
    last_executed_at: new Date().toISOString(),
    next_execution_at: calculateNextExecution(execution_interval_minutes),
    average_execution_time_ms: calculateAverageExecutionTime(executionTime)
  })
  .eq('id', workflow.id)
```

### Notification System Integration

The existing notification system (`app/api/notifications/route.ts`) already supports:
- ✅ POST endpoint for creating notifications
- ✅ GET endpoint for fetching notifications
- ✅ Type validation (whale_activity, market_alert, insider_alert, strategy_update, system, security, account)

**What We Need to Add**:
- New notification types: `strategy_started`, `strategy_paused`, `strategy_stopped`, `strategy_error`, `watchlist_updated`, `execution_completed`, `execution_failed`
- Workflow ID foreign key (already added in schema above)
- Priority-based filtering

---

## Security & Risk Management

### Execution Safety

**Rate Limiting**:
- Minimum execution interval: 1 minute (prevent API abuse)
- Maximum concurrent executions per user: 10 strategies
- Serverless function timeout: 10 seconds (Vercel limit)

**Error Handling**:
- Auto-pause strategy after 3 consecutive failures
- Exponential backoff for API retries (1s, 2s, 4s, 8s)
- Graceful degradation (return stale DB data if API fails)

**Resource Limits**:
- Maximum watchlist size per strategy: 1000 markets
- Maximum execution log retention: 100 entries
- Maximum node count per workflow: 50 nodes

### User Safety

**Notifications**:
- Immediate notification on strategy errors
- Daily summary email (future: Phase 3)
- Quiet hours support (suppress notifications during sleep)

**Audit Trail**:
- Every execution logged to `workflow_executions` table
- Node-level logs in `strategy_execution_logs` table
- Cannot delete execution history (append-only)

### Data Protection

**RLS Policies**:
- Users can only view/modify their own strategies
- Users can only view their own watchlists
- Users can only view their own execution logs
- Service role required for cron job execution

---

## Testing Strategy

### Unit Tests

**Test Coverage Required**:
- `WorkflowExecutor.execute()` with autonomous trigger
- `calculateNextExecution()` function
- `AddToWatchlistNode` executor
- Notification creation logic
- Status badge rendering

**Example Test**:
```typescript
describe('WorkflowExecutor', () => {
  it('should calculate next execution correctly', () => {
    const interval = 15 // minutes
    const lastExecuted = new Date('2025-10-26T15:30:00Z')
    const nextExecution = calculateNextExecution(lastExecuted, interval)

    expect(nextExecution).toEqual(new Date('2025-10-26T15:45:00Z'))
  })

  it('should auto-pause strategy after 3 consecutive failures', async () => {
    const workflow = createTestWorkflow()
    workflow.error_count = 2

    // Execute with intentional failure
    const result = await workflowExecutor.execute(workflow)

    expect(result.success).toBe(false)

    const updated = await getWorkflow(workflow.id)
    expect(updated.status).toBe('paused')
    expect(updated.error_count).toBe(3)
  })
})
```

### Integration Tests

**Test Scenarios**:
1. Start strategy → Verify status = 'running'
2. Cron job finds due strategy → Executes workflow → Updates timestamps
3. Add to watchlist → Market added to DB → Notification sent
4. Strategy fails → Auto-pauses → Error notification sent
5. User pauses strategy → Cron job skips it
6. Resume strategy → Next execution scheduled

### E2E Tests (Playwright)

**Test Flows**:
```typescript
test('User can start autonomous strategy', async ({ page }) => {
  await page.goto('/strategy-builder')

  // Build simple workflow
  await page.click('[data-node="stream-markets"]')
  await page.click('[data-node="add-to-watchlist"]')

  // Save strategy
  await page.click('[data-action="save"]')
  await page.fill('[name="strategy-name"]', 'Test Strategy')
  await page.click('[data-action="confirm-save"]')

  // Start strategy
  await page.click('[data-action="start-strategy"]')

  // Verify status
  await expect(page.locator('[data-status-badge]')).toHaveText('Running')
  await expect(page.locator('[data-next-execution]')).toContain('In')
})

test('User receives notification on watchlist update', async ({ page }) => {
  await page.goto('/strategies/test-strategy-id')

  // Trigger manual execution
  await page.click('[data-action="execute-now"]')

  // Wait for notification
  await page.waitForSelector('[data-notification-badge]', { timeout: 10000 })

  // Open notification center
  await page.click('[data-notification-bell]')

  // Verify notification
  await expect(page.locator('[data-notification-title]').first()).toContain('added market')
})
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Tasks**:
1. Database migrations (schema changes above)
2. Update `workflow_sessions` table with new columns
3. Create `strategy_watchlists` table
4. Create `notification_settings` table
5. Create `strategy_execution_logs` table

**Deliverables**:
- SQL migration file
- RLS policies applied
- Test data seed script

### Phase 2: Backend Logic (Week 2)

**Tasks**:
1. Build `/api/cron/strategy-executor` endpoint
2. Enhance `WorkflowExecutor` for autonomous execution
3. Build strategy control API endpoints (start, pause, stop, resume)
4. Build watchlist API endpoints (get, remove, clear)
5. Build "Add to Watchlist" node executor
6. Build notification creation service

**Deliverables**:
- Cron job endpoint functional
- Strategy control endpoints tested
- Watchlist CRUD working
- Notifications sending correctly

### Phase 3: Frontend Components (Week 3)

**Tasks**:
1. Build Strategy Dashboard component
2. Build Strategies Overview component
3. Build Notification Center component
4. Add status badges and indicators
5. Build execution log viewer
6. Build watchlist viewer
7. Add control buttons (Start, Pause, Stop)

**Deliverables**:
- Strategy dashboard page complete
- Strategies overview page complete
- Notification center functional
- Real-time status updates working

### Phase 4: Integration & Polish (Week 4)

**Tasks**:
1. Connect frontend to backend APIs
2. Add real-time polling/updates
3. Implement error handling UI
4. Add loading states and skeletons
5. Write unit tests
6. Write integration tests
7. Write E2E tests
8. Documentation updates

**Deliverables**:
- End-to-end flow working
- All tests passing
- Documentation complete
- Ready for QA

### Phase 5: Testing & Launch (Week 5)

**Tasks**:
1. QA testing
2. Bug fixes
3. Performance optimization
4. User acceptance testing (3-5 beta users)
5. Launch preparation
6. Production deployment

**Deliverables**:
- MVP launched to production
- Beta user feedback collected
- Metrics dashboard tracking usage

---

## Success Criteria

### MVP Launch Criteria

- ✅ User can start a strategy and it runs autonomously
- ✅ Cron job executes strategies every minute
- ✅ Strategy dashboard shows real-time status
- ✅ Execution log displays last 50 runs
- ✅ Watchlist system adds/removes markets correctly
- ✅ Notifications sent for key events
- ✅ User can pause/resume/stop strategies
- ✅ Error handling auto-pauses on repeated failures
- ✅ At least 3 beta users successfully test autonomous strategies

### Performance Targets

- Cron job execution: < 5 seconds (for 25 active strategies)
- Strategy dashboard load: < 500ms
- Notification delivery: < 2 seconds after event
- Database query performance: < 150ms (p95)
- Uptime: 99%+ for background jobs

---

## Open Questions & Decisions

### Technical Decisions

**Q1: Should we use Vercel Cron or external job queue?**
- **Recommendation**: Start with Vercel Cron (simpler, MVP-friendly)
- **Future**: Migrate to BullMQ + Redis if we need longer execution times

**Q2: How do we handle long-running workflows (> 10 seconds)?**
- **Recommendation**: Split execution across multiple cron cycles
- **Implementation**: Store intermediate state in `globalState` field

**Q3: Should strategies auto-restart after errors?**
- **Recommendation**: Auto-pause after 3 consecutive failures, require manual resume
- **Rationale**: Prevents runaway API costs and user confusion

**Q4: What's the minimum execution interval?**
- **Recommendation**: 5 minutes (safe for API rate limits)
- **Power users**: Allow 1 minute minimum for Pro tier

**Q5: Do we need strategy scheduling (e.g., only run 9am-5pm)?**
- **Recommendation**: Phase 2 feature (not MVP)
- **Implementation**: Add `schedule_start_time` and `schedule_end_time` columns

### Product Decisions

**Q1: Should we allow editing strategies while they're running?**
- **Recommendation**: Require pause before editing
- **Rationale**: Prevents mid-execution state corruption

**Q2: Do watchlists expire automatically?**
- **Recommendation**: No expiration in MVP, manual removal only
- **Future**: Add `expires_at` column for time-based expiration

**Q3: Should we provide strategy templates for autonomous trading?**
- **Recommendation**: Yes, create 3-5 predefined templates
- **Examples**: "Volume Scanner", "Whale Tracker", "Momentum Rider"

---

## Dependencies

### External Services

- **Polymarket Gamma API** - Market data fetching
- **Vercel Cron** - Background job scheduling
- **Supabase Database** - Data persistence
- **Existing WorkflowExecutor** - Workflow execution engine

### Internal Components

- ✅ `lib/workflow/executor.ts` - Workflow execution (exists)
- ✅ `types/workflow.ts` - Type definitions (exists)
- ✅ `app/api/notifications/route.ts` - Notifications (exists)
- ❌ `app/api/cron/strategy-executor/route.ts` - Cron job (new)
- ❌ `app/api/strategies/[id]/start/route.ts` - Strategy control (new)
- ❌ `components/strategy-dashboard-interface/` - Dashboard UI (new)

---

## Risks & Mitigations

### Risk 1: Vercel Serverless Timeout (10 seconds)

**Impact**: High
**Probability**: Medium

**Mitigation**:
- Keep workflows simple and fast (< 5 seconds target)
- Break complex workflows into multiple steps
- Monitor execution times and alert on slowness
- Future: Migrate to external job queue if needed

### Risk 2: API Rate Limits (Polymarket)

**Impact**: High
**Probability**: Medium

**Mitigation**:
- Implement request throttling (max 100 req/min)
- Cache market data aggressively (5-minute stale time)
- Distribute executions across minute (not all at :00)
- Backoff on 429 errors

### Risk 3: User Confusion (Autonomous vs Manual)

**Impact**: Medium
**Probability**: Low

**Mitigation**:
- Clear UI labels ("Start Strategy" vs "Run Once")
- Prominent status badges (Running, Paused, Stopped)
- Onboarding tutorial for autonomous features
- Tooltips explaining behavior

### Risk 4: Runaway Costs (User creates 100 strategies)

**Impact**: High
**Probability**: Low

**Mitigation**:
- Limit: 10 active strategies per user (Free tier)
- Limit: 50 active strategies per user (Pro tier)
- Monitor total strategy count in admin dashboard
- Alert on anomalous activity

### Risk 5: Database Load (High-frequency polling)

**Impact**: Medium
**Probability**: Medium

**Mitigation**:
- Index all foreign keys and status columns
- Use partial indexes (WHERE auto_run = TRUE)
- Implement connection pooling (Supabase default)
- Monitor query performance with EXPLAIN ANALYZE

---

## Metrics & Monitoring

### Key Metrics

**Strategy Metrics**:
- Total active strategies
- Average execution interval
- Execution success rate
- Average execution duration
- Watchlist size distribution

**User Metrics**:
- % of users with at least 1 active strategy
- Average strategies per user
- Retention rate (7-day, 30-day)
- Time spent on strategy dashboard

**System Metrics**:
- Cron job execution time
- Cron job success rate
- API error rate
- Database query performance (p50, p95, p99)
- Notification delivery latency

### Monitoring Dashboard

**Grafana/Supabase Dashboard**:
```sql
-- Active strategies count
SELECT COUNT(*)
FROM workflow_sessions
WHERE auto_run = TRUE AND status = 'running';

-- Execution success rate (last 24 hours)
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success,
  (SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::float / COUNT(*)) * 100 as success_rate
FROM workflow_executions
WHERE executed_at >= NOW() - INTERVAL '24 hours';

-- Average execution time (last 1000 executions)
SELECT AVG(duration_ms) as avg_duration_ms
FROM workflow_executions
ORDER BY executed_at DESC
LIMIT 1000;
```

---

## Conclusion

This specification provides a complete blueprint for implementing autonomous strategy execution in CASCADIAN. By leveraging existing infrastructure (WorkflowExecutor, notification system) and adding strategic enhancements (watchlists, background jobs, dashboards), we transform CASCADIAN from a manual tool into a true 24/7 autonomous trading platform.

**Next Steps**:
1. Review spec with team for feedback
2. Finalize technical decisions (cron vs queue, minimum interval, etc.)
3. Begin Phase 1 implementation (database migrations)
4. Set up development environment with test data
5. Start building cron job endpoint

**Estimated Timeline**: 5 weeks to MVP launch
**Estimated Effort**: 1 full-time engineer
**Risk Level**: Medium (dependent on Vercel Cron reliability)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-26
**Next Review**: After Phase 1 completion
**Maintained By**: Engineering Team
**Status**: Ready for Implementation
