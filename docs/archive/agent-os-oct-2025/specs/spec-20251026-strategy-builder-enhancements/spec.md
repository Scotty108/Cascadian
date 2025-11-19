# Specification: Strategy Builder Enhancements

**Version:** 1.0
**Date:** 2025-10-26
**Status:** Ready for Implementation
**Author:** spec-writer agent

---

## 1. Executive Summary

### Overview
Transform CASCADIAN's Strategy Builder from a basic visual workflow tool into a sophisticated, AI-powered trading strategy platform. This enhancement adds four major capabilities: advanced multi-condition filtering, data flow visualization for debugging, AI-powered portfolio management, and intelligent auto-layout system.

### Business Value
- **Reduced Strategy Errors**: Data flow visualization helps users identify and fix logic errors before deploying capital
- **Smarter Capital Allocation**: AI portfolio orchestrator prevents over-exposure and optimizes position sizing
- **Faster Strategy Creation**: Auto-layout and advanced filters reduce time to build complex strategies from hours to minutes
- **Increased User Confidence**: Transparency in execution via debug panel builds trust in autonomous systems

### User Impact
- **Strategy Creators**: Build sophisticated multi-condition filters without code
- **Active Traders**: Debug failed executions and understand why markets were filtered out
- **Risk-Conscious Users**: Set portfolio-wide risk parameters with AI-powered position sizing
- **Power Users**: Create clean, organized workflows with intelligent auto-layout

### Success Metrics
- **Adoption**: 70%+ of active strategies use enhanced filter nodes within 30 days
- **Debugging**: 50%+ of users interact with data flow panel after first failed execution
- **Risk Management**: 80%+ of orchestrator recommendations accepted (high AI trust)
- **UX Quality**: <5% of workflows manually re-laid out after AI auto-layout

---

## 2. Feature Scope

### Phase 1: Enhanced Filter Node (Weeks 1-2)
**In Scope:**
- Multi-condition builder UI (2-10 conditions per node)
- AND/OR logic between conditions
- Dynamic field discovery from upstream node outputs
- Field type detection and smart operators
- Category filters (Polymarket categories)
- Tag filters (multi-select with autocomplete)
- Text search filters (case-sensitive option)
- Real-time validation before execution
- Updated executor logic for all filter types

**Out of Scope:**
- Grouped conditions with nested logic `(A AND B) OR (C AND D)` - Phase 2
- Regular expressions in text search - Phase 3
- Filter templates/presets - Phase 3
- Filter performance analytics - Phase 4

### Phase 2: Data Flow Visualization (Week 3)
**In Scope:**
- Execution trace capture system
- Debug panel UI (side panel and full-screen modal)
- Node list view with input/output counts
- Node detail view with data tables
- Item tracing (follow single item through workflow)
- Filter failure reasons display
- Export to CSV
- Performance optimization for 1000+ items

**Out of Scope:**
- Time-travel debugging (scrub through execution timeline) - Phase 3
- Side-by-side execution comparison - Phase 4
- Visual diff highlighting in tables - Phase 4
- Real-time execution monitoring - Phase 5

### Phase 3: Portfolio Orchestrator (Weeks 4-5)
**In Scope:**
- Portfolio orchestrator node type
- Position sizing rules configuration:
  - Max % per position
  - Absolute bet limits (min/max)
  - Portfolio heat limit
  - Risk-reward ratio threshold
  - Drawdown protection
  - Volatility adjustment
- AI risk analysis engine (Claude Sonnet 4.5)
- Approval workflow (autonomous vs. approval-required modes)
- Decision history tracking
- High-priority notifications for pending approvals
- Approval modal with size adjustment

**Out of Scope:**
- Multi-strategy portfolio coordination - Phase 6
- Custom risk models (user-defined formulas) - Phase 4
- Backtesting of position sizing rules - Phase 5
- Machine learning for position sizing - Phase 6+

### Phase 4: Auto-Layout System (Week 6)
**In Scope:**
- Dagre integration for hierarchical layout
- Auto-layout on AI workflow creation
- Re-layout button for manual cleanup
- Layout lock/unlock toggle
- Grid snap for manual positioning
- Alignment tools (align left/right/top/bottom, distribute H/V)
- Layout preferences persistence (per user)
- Node position persistence (per workflow)

**Out of Scope:**
- Visual grouping/containers for nodes - Phase 5
- Multiple layout algorithms (force-directed, circular) - Phase 4
- Layout animations/transitions - Phase 4
- Custom layout hints in AI prompts - Phase 5

---

## 3. User Stories & Flows

### Story 1: Create Advanced Filter
**As a** strategy creator
**I want** to add multiple filter conditions in a single node
**So that** I can create sophisticated filters without chaining many nodes

**Acceptance Criteria:**
- User can add 5+ conditions in one filter node
- AND/OR toggle works correctly
- Field dropdown shows all available fields from upstream data
- Category filter works with Polymarket categories
- Tag filter supports multi-select
- Text search finds markets with matching words in title
- Real-time validation prevents invalid configurations

**User Flow:**
1. User drags "Filter" node onto canvas
2. User clicks node to open config panel
3. Config panel shows condition builder with one empty row
4. User selects field "category" from dropdown (shows all available fields)
5. User selects operator "IS" and value "Politics"
6. User clicks "+ Add Condition" to add second condition
7. AND/OR toggle appears between conditions
8. User selects field "volume", operator ">", value "100000"
9. User adds third condition: "title contains 'Trump'" with text search
10. Filter preview shows: `(category = Politics) AND (volume > 100000) AND (title contains 'Trump')`
11. User saves configuration
12. Filter node displays summary: "3 conditions (AND)" on canvas

### Story 2: Debug Data Flow
**As a** strategy user
**I want** to see exactly which markets pass through each node
**So that** I can debug why my strategy filtered out good opportunities

**Acceptance Criteria:**
- Debug panel opens from execution history
- Shows data at each node in workflow
- User can click item to trace its path
- Shows why items were filtered out
- Handles workflows with 1000+ items without lag
- Export functionality works

**User Flow:**
1. User runs strategy, execution completes with unexpected results
2. User clicks "Debug" button in execution history
3. Debug panel slides in from right side
4. Panel shows node list with flow diagram:
   - Polymarket Stream: 500 markets in → 500 markets out
   - Filter Node: 500 markets in → 47 markets out (-453 filtered)
   - Add to Watchlist: 47 markets in → 47 added
5. User clicks "Filter Node" row to see details
6. Detail view opens showing split pane:
   - Left: Input table with 500 markets (sortable, searchable)
   - Right: Output table with 47 markets (green highlight)
7. User searches for specific market "Will Biden win 2024?" in input table
8. Market is highlighted in red (filtered out)
9. User clicks on the market row
10. System shows: "Filtered out because: volume (45000) < 100000"
11. User understands why this opportunity was missed
12. User adjusts filter threshold to 40000 and re-runs

### Story 3: Orchestrator Approves Trade
**As a** conservative trader
**I want** AI to recommend position sizes based on my portfolio
**So that** I never over-expose my capital on a single bet

**Acceptance Criteria:**
- Orchestrator node analyzes market + portfolio
- AI makes intelligent position sizing decisions
- Respects all user-defined rules
- Approval workflow works smoothly
- Dashboard shows decision history

**User Flow:**
1. User creates strategy with Orchestrator node (mode: "Approval Required")
2. User configures rules:
   - Max per position: 5%
   - Portfolio heat limit: 50%
   - Risk-reward threshold: 2.0
3. Strategy executes hourly, identifies opportunity: "Bitcoin $100k by end of year"
4. Orchestrator node receives market data:
   - Question: "Will Bitcoin reach $100k by end of 2024?"
   - Current odds: 65% YES
   - Volume: $250k, Liquidity: $50k
5. Orchestrator analyzes portfolio state:
   - Total capital: $10,000
   - Deployed capital: $3,500 (7 open positions)
   - Available capital: $6,500
6. AI evaluates opportunity:
   - Volume is strong ($250k)
   - Liquidity is good ($50k)
   - Risk-reward: 2.5:1 (above 2.0 threshold ✓)
   - Recommendation: GO for $325 (3.25% of portfolio)
   - Risk score: 6/10
7. System creates pending decision record in database
8. High-priority notification sent: "Trade approval needed: Bitcoin $100k - $325 recommended"
9. User clicks notification
10. Modal opens with:
    - Market details and current odds
    - AI reasoning: "Strong fundamentals with high volume. Risk-reward is favorable at 2.5:1. Recommending 3.25% ($325) to stay within risk tolerance."
    - Recommended size: $325
    - Slider to adjust (range: $5-$500)
    - Risk score: 6/10
    - [Approve] [Reject] buttons
11. User reviews and clicks [Approve]
12. Trade executes for $325 on Polymarket
13. Dashboard shows orchestrator decision in history with outcome tracking

### Story 4: AI Auto-Layouts Workflow
**As a** strategy builder
**I want** AI-created workflows to be visually organized
**So that** I can understand the logic at a glance

**Acceptance Criteria:**
- Auto-layout runs when AI creates workflow
- Workflows have clean, hierarchical appearance
- No crossing edges (minimize)
- Manual positioning persists when locked
- Re-layout button fixes tangled workflows

**User Flow:**
1. User opens Strategy Builder
2. User types in AI chat: "Build a bot that finds Politics markets with volume >$100k and high whale activity, then adds to watchlist"
3. AI creates workflow with 4 nodes:
   - Node 1: Polymarket Stream (Politics category)
   - Node 2: Filter (volume > 100k)
   - Node 3: Filter (whale activity > 70)
   - Node 4: Add to Watchlist
4. AI response includes layout hints: depth ranking for each node
5. System auto-applies dagre layout algorithm:
   - Direction: Left-to-right (LR)
   - Nodes arranged by depth: Stream → Filters → Watchlist
   - Clean spacing: 150px between ranks, 80px between nodes
   - No overlapping edges
6. User sees clean, organized workflow on canvas
7. Toast notification: "Auto-layout applied. Click 'Re-layout' to reorganize manually edited workflows."
8. User manually adjusts Node 3 position slightly down
9. System auto-locks layout to preserve manual edits
10. User adds new Filter node (Node 5) between Node 3 and Node 4
11. Workflow looks cluttered with new node placement
12. User clicks "Re-layout" button in toolbar
13. Workflow re-organized with all 5 nodes in correct hierarchical positions
14. User is satisfied and saves workflow

---

## 4. Technical Design

### 4.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CASCADIAN Strategy Builder                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Enhanced   │  │  Data Flow   │  │  Portfolio   │          │
│  │    Filter    │  │     Debug    │  │ Orchestrator │          │
│  │     Node     │  │    Panel     │  │     Node     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                  │                   │                 │
│         └──────────────────┴───────────────────┘                │
│                            │                                     │
│              ┌─────────────▼─────────────┐                      │
│              │   Workflow Executor        │                      │
│              │   (lib/workflow/executor)  │                      │
│              └─────────────┬─────────────┘                      │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                │
│         │                  │                  │                 │
│  ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐          │
│  │  Supabase   │   │  Anthropic  │   │   Dagre     │          │
│  │  Postgres   │   │  Claude API │   │   Layout    │          │
│  └─────────────┘   └─────────────┘   └─────────────┘          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Component Architecture

```
components/
├── strategy-builder/
│   ├── enhanced-filter-node/
│   │   ├── filter-node-v2.tsx              # Main filter node component
│   │   ├── multi-condition-builder.tsx    # Condition builder UI
│   │   ├── condition-row.tsx              # Single condition row
│   │   ├── field-selector.tsx             # Smart field dropdown
│   │   ├── operator-selector.tsx          # Type-aware operators
│   │   ├── value-input.tsx                # Smart value input
│   │   ├── category-picker.tsx            # Polymarket categories
│   │   ├── tag-picker.tsx                 # Tag multi-select
│   │   └── text-search-input.tsx          # Text search with options
│   │
│   ├── data-flow-panel/
│   │   ├── index.tsx                      # Main debug panel
│   │   ├── debug-panel-layout.tsx         # Side panel / full-screen
│   │   ├── node-list-view.tsx             # Timeline of nodes
│   │   ├── node-detail-view.tsx           # Detailed node inspection
│   │   ├── data-table.tsx                 # Sortable/filterable table
│   │   ├── item-trace-view.tsx            # Follow specific item
│   │   ├── flow-diagram-highlight.tsx     # Visual flow with trace
│   │   └── export-button.tsx              # CSV export
│   │
│   ├── orchestrator-node/
│   │   ├── orchestrator-node.tsx          # Main orchestrator node
│   │   ├── config-panel.tsx               # Configuration UI
│   │   ├── position-sizing-rules.tsx      # Rule configuration
│   │   ├── risk-tolerance-slider.tsx      # Risk level (1-10)
│   │   ├── approval-modal.tsx             # Trade approval UI
│   │   ├── decision-history.tsx           # Past decisions table
│   │   └── pending-decisions-badge.tsx    # Notification badge
│   │
│   └── auto-layout/
│       ├── layout-toolbar.tsx             # Layout controls
│       ├── re-layout-button.tsx           # Trigger re-layout
│       ├── lock-toggle.tsx                # Lock/unlock layout
│       ├── alignment-tools.tsx            # Align/distribute buttons
│       ├── grid-snap-toggle.tsx           # Grid snap on/off
│       └── layout-engine.ts               # Dagre integration
│
lib/
├── workflow/
│   ├── executor.ts                         # Existing executor (extend)
│   ├── node-executors/
│   │   ├── filter-executor-v2.ts          # Enhanced filter executor
│   │   ├── orchestrator-executor.ts       # Portfolio orchestrator
│   │   └── trace-collector.ts             # Data flow trace capture
│   │
│   └── layout/
│       ├── dagre-layout.ts                # Dagre layout algorithm
│       ├── layout-hints.ts                # AI layout hints parser
│       └── layout-persistence.ts          # Save/load layout state
│
├── ai/
│   └── orchestrator-analysis.ts           # AI risk analysis logic
│
└── utils/
    ├── field-discovery.ts                 # Dynamic field detection
    ├── filter-evaluation.ts               # Multi-condition eval
    └── export-csv.ts                      # Data export utility
```

### 4.3 Database Schema

#### 4.3.1 Extend `strategy_execution_logs` for Data Flow Traces

```sql
-- =====================================================================
-- MIGRATION: Add Data Flow Trace Columns
-- =====================================================================
-- File: supabase/migrations/20251027000000_add_data_flow_traces.sql
-- Purpose: Extend strategy_execution_logs to support data flow debugging
-- =====================================================================

-- Add columns for data snapshots and filter tracking
ALTER TABLE strategy_execution_logs
ADD COLUMN IF NOT EXISTS input_snapshot JSONB,
ADD COLUMN IF NOT EXISTS output_snapshot JSONB,
ADD COLUMN IF NOT EXISTS items_added TEXT[],
ADD COLUMN IF NOT EXISTS items_removed TEXT[],
ADD COLUMN IF NOT EXISTS filter_failures JSONB; -- {"market-123": "volume < 100000", ...}

-- Add constraint to limit snapshot size (prevent huge JSONB)
-- Store max 1000 items per snapshot
ALTER TABLE strategy_execution_logs
ADD CONSTRAINT check_snapshot_size
CHECK (
  jsonb_array_length(COALESCE(input_snapshot, '[]'::jsonb)) <= 1000
  AND jsonb_array_length(COALESCE(output_snapshot, '[]'::jsonb)) <= 1000
);

-- Index for snapshot queries
CREATE INDEX IF NOT EXISTS idx_execution_logs_snapshots
  ON strategy_execution_logs(execution_id)
  WHERE input_snapshot IS NOT NULL;

-- Index for filter failures
CREATE INDEX IF NOT EXISTS idx_execution_logs_filter_failures
  ON strategy_execution_logs USING gin(filter_failures)
  WHERE filter_failures IS NOT NULL;

-- Comments
COMMENT ON COLUMN strategy_execution_logs.input_snapshot IS
  'JSONB snapshot of input data (limited to first 1000 items for performance)';

COMMENT ON COLUMN strategy_execution_logs.output_snapshot IS
  'JSONB snapshot of output data (limited to first 1000 items for performance)';

COMMENT ON COLUMN strategy_execution_logs.items_added IS
  'Array of item IDs added by this node (e.g., new markets from stream)';

COMMENT ON COLUMN strategy_execution_logs.items_removed IS
  'Array of item IDs removed by this node (e.g., filtered out markets)';

COMMENT ON COLUMN strategy_execution_logs.filter_failures IS
  'Map of item ID to filter failure reason: {"market-123": "volume < 100000"}';
```

#### 4.3.2 Create `orchestrator_decisions` Table

```sql
-- =====================================================================
-- MIGRATION: Create Orchestrator Decisions Table
-- =====================================================================
-- File: supabase/migrations/20251027000001_create_orchestrator_decisions.sql
-- Purpose: Track AI portfolio orchestrator decisions for approval workflow
-- =====================================================================

CREATE TABLE IF NOT EXISTS orchestrator_decisions (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Keys
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL, -- Node ID within workflow

  -- Market Information
  market_id TEXT NOT NULL,
  market_question TEXT NOT NULL,
  market_category TEXT,
  current_odds JSONB, -- { "yes": 0.65, "no": 0.35 }

  -- Decision Details
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'pending')),
  direction TEXT CHECK (direction IN ('YES', 'NO')), -- Which outcome to bet on
  recommended_size NUMERIC NOT NULL, -- USD amount recommended by AI
  actual_size NUMERIC, -- Actual size if user adjusted
  risk_score NUMERIC CHECK (risk_score BETWEEN 1 AND 10),

  -- AI Analysis
  ai_reasoning TEXT NOT NULL, -- Why AI made this decision
  ai_confidence NUMERIC CHECK (ai_confidence BETWEEN 0 AND 1),
  ai_model TEXT DEFAULT 'claude-sonnet-4-5', -- Model used for analysis

  -- Portfolio Context (snapshot)
  portfolio_snapshot JSONB, -- { total: 10000, deployed: 3500, available: 6500, positions: 7 }

  -- User Override
  user_override BOOLEAN DEFAULT FALSE,
  override_reason TEXT,
  user_notes TEXT,

  -- Trade Execution Reference
  trade_id UUID, -- FK to trades table (if executed)
  trade_status TEXT, -- 'pending', 'executed', 'failed', 'cancelled'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  decided_at TIMESTAMPTZ, -- When user approved/rejected
  executed_at TIMESTAMPTZ, -- When trade was executed

  -- Indexes inline for clarity
  CONSTRAINT orchestrator_decisions_workflow_id_key
    FOREIGN KEY (workflow_id) REFERENCES workflow_sessions(id) ON DELETE CASCADE
);

-- =====================================================================
-- INDEXES
-- =====================================================================

-- Index 1: Pending decisions (for notification polling)
CREATE INDEX idx_orchestrator_decisions_pending
  ON orchestrator_decisions(workflow_id, created_at DESC)
  WHERE decision = 'pending';

-- Index 2: Decision history by workflow
CREATE INDEX idx_orchestrator_decisions_workflow
  ON orchestrator_decisions(workflow_id, created_at DESC);

-- Index 3: Decision history by execution
CREATE INDEX idx_orchestrator_decisions_execution
  ON orchestrator_decisions(execution_id, created_at DESC);

-- Index 4: Market-specific decisions (prevent duplicate pending)
CREATE INDEX idx_orchestrator_decisions_market
  ON orchestrator_decisions(workflow_id, market_id, decision)
  WHERE decision = 'pending';

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

ALTER TABLE orchestrator_decisions ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view decisions for their own workflows
CREATE POLICY "Users can view own orchestrator decisions"
  ON orchestrator_decisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = orchestrator_decisions.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Policy 2: Service role can insert decisions (called by executor)
CREATE POLICY "Service role can insert orchestrator decisions"
  ON orchestrator_decisions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = orchestrator_decisions.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- Policy 3: Users can update decisions (approve/reject)
CREATE POLICY "Users can update own orchestrator decisions"
  ON orchestrator_decisions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workflow_sessions
      WHERE workflow_sessions.id = orchestrator_decisions.workflow_id
        AND workflow_sessions.user_id = auth.uid()
    )
  );

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- Function: Get pending decisions count
CREATE OR REPLACE FUNCTION get_pending_decisions_count(p_workflow_id UUID)
RETURNS BIGINT AS $$
  SELECT COUNT(*)
  FROM orchestrator_decisions
  WHERE workflow_id = p_workflow_id
    AND decision = 'pending';
$$ LANGUAGE sql STABLE;

-- Function: Get decision statistics
CREATE OR REPLACE FUNCTION get_orchestrator_stats(p_workflow_id UUID)
RETURNS TABLE(
  total_decisions BIGINT,
  approved_decisions BIGINT,
  rejected_decisions BIGINT,
  pending_decisions BIGINT,
  avg_risk_score NUMERIC,
  avg_recommended_size NUMERIC,
  approval_rate NUMERIC
) AS $$
  SELECT
    COUNT(*) AS total_decisions,
    COUNT(*) FILTER (WHERE decision = 'approve') AS approved_decisions,
    COUNT(*) FILTER (WHERE decision = 'reject') AS rejected_decisions,
    COUNT(*) FILTER (WHERE decision = 'pending') AS pending_decisions,
    AVG(risk_score) AS avg_risk_score,
    AVG(recommended_size) AS avg_recommended_size,
    CASE
      WHEN COUNT(*) FILTER (WHERE decision IN ('approve', 'reject')) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE decision = 'approve')::NUMERIC /
        COUNT(*) FILTER (WHERE decision IN ('approve', 'reject'))::NUMERIC,
        2
      )
      ELSE NULL
    END AS approval_rate
  FROM orchestrator_decisions
  WHERE workflow_id = p_workflow_id;
$$ LANGUAGE sql STABLE;

-- Comments
COMMENT ON TABLE orchestrator_decisions IS
  'Tracks AI portfolio orchestrator decisions for position sizing and risk management. Supports approval workflow.';

COMMENT ON COLUMN orchestrator_decisions.ai_reasoning IS
  'AI-generated reasoning for this position size recommendation (2-3 sentences)';

COMMENT ON COLUMN orchestrator_decisions.portfolio_snapshot IS
  'Snapshot of portfolio state at decision time: { total, deployed, available, positions, recent_pnl, win_rate }';

COMMENT ON FUNCTION get_orchestrator_stats(UUID) IS
  'Returns aggregate statistics for orchestrator decisions: counts, averages, approval rate';
```

#### 4.3.3 Extend `workflow_sessions` for Layout Preferences

```sql
-- =====================================================================
-- MIGRATION: Add Layout Preferences to Workflow Sessions
-- =====================================================================
-- File: supabase/migrations/20251027000002_add_layout_preferences.sql
-- Purpose: Store auto-layout preferences and lock state per workflow
-- =====================================================================

-- Add layout configuration columns
ALTER TABLE workflow_sessions
ADD COLUMN IF NOT EXISTS layout_locked BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS layout_direction TEXT DEFAULT 'LR' CHECK (layout_direction IN ('LR', 'TB', 'RL', 'BT')),
ADD COLUMN IF NOT EXISTS layout_config JSONB DEFAULT '{
  "rankSeparation": 150,
  "nodeSeparation": 80,
  "edgeSeparation": 20,
  "align": "UL"
}'::jsonb;

-- Comments
COMMENT ON COLUMN workflow_sessions.layout_locked IS
  'If TRUE, auto-layout is disabled and manual positioning persists. If FALSE, auto-layout can run.';

COMMENT ON COLUMN workflow_sessions.layout_direction IS
  'Layout direction: LR (left-right), TB (top-bottom), RL (right-left), BT (bottom-top)';

COMMENT ON COLUMN workflow_sessions.layout_config IS
  'Dagre layout configuration: { rankSeparation, nodeSeparation, edgeSeparation, align }';
```

### 4.4 API Endpoints

#### 4.4.1 Orchestrator APIs

```typescript
// File: app/api/orchestrator/analyze/route.ts
/**
 * POST /api/orchestrator/analyze
 *
 * Analyzes a market opportunity and recommends position size using AI.
 *
 * Request Body:
 * {
 *   workflowId: string;
 *   nodeId: string;
 *   market: {
 *     id: string;
 *     question: string;
 *     category: string;
 *     volume24h: number;
 *     liquidity: number;
 *     currentOdds: { yes: number; no: number };
 *     createdAt: string;
 *     endDate: string;
 *   };
 *   signal: {
 *     direction: 'YES' | 'NO';
 *     confidence: number; // 0-1
 *     reasoning: string;
 *   };
 *   rules: {
 *     maxPerPosition: number; // Percentage (0-1)
 *     minBet: number; // USD
 *     maxBet: number; // USD
 *     portfolioHeatLimit: number; // Percentage (0-1)
 *     riskRewardThreshold: number; // Ratio
 *     drawdownProtection?: { threshold: number; reduction: number };
 *     volatilityAdjustment: boolean;
 *   };
 * }
 *
 * Response:
 * {
 *   success: boolean;
 *   decision: 'approve' | 'reject';
 *   recommendedSize: number; // USD
 *   riskScore: number; // 1-10
 *   reasoning: string;
 *   confidence: number; // 0-1
 *   decisionId: string; // UUID for tracking
 * }
 */

// File: app/api/orchestrator/decisions/[id]/approve/route.ts
/**
 * POST /api/orchestrator/decisions/[id]/approve
 *
 * Approves a pending orchestrator decision and executes the trade.
 *
 * Request Body:
 * {
 *   adjustedSize?: number; // Optional size adjustment
 *   userNotes?: string;
 * }
 *
 * Response:
 * {
 *   success: boolean;
 *   tradeId: string; // Reference to executed trade
 *   executedSize: number;
 *   executedPrice: number;
 * }
 */

// File: app/api/orchestrator/decisions/[id]/reject/route.ts
/**
 * POST /api/orchestrator/decisions/[id]/reject
 *
 * Rejects a pending orchestrator decision.
 *
 * Request Body:
 * {
 *   reason?: string;
 *   userNotes?: string;
 * }
 *
 * Response:
 * {
 *   success: boolean;
 *   message: string;
 * }
 */

// File: app/api/orchestrator/decisions/route.ts
/**
 * GET /api/orchestrator/decisions?workflowId={id}&status={status}&limit={n}
 *
 * Retrieves orchestrator decision history.
 *
 * Query Params:
 * - workflowId: string (required)
 * - status: 'pending' | 'approve' | 'reject' | 'all' (default: 'all')
 * - limit: number (default: 50, max: 500)
 * - offset: number (default: 0)
 *
 * Response:
 * {
 *   success: boolean;
 *   decisions: Array<{
 *     id: string;
 *     marketId: string;
 *     marketQuestion: string;
 *     decision: string;
 *     recommendedSize: number;
 *     actualSize?: number;
 *     riskScore: number;
 *     aiReasoning: string;
 *     createdAt: string;
 *     decidedAt?: string;
 *   }>;
 *   total: number;
 *   hasMore: boolean;
 * }
 */
```

#### 4.4.2 Data Flow APIs

```typescript
// File: app/api/executions/[id]/trace/route.ts
/**
 * GET /api/executions/[id]/trace
 *
 * Retrieves complete data flow trace for an execution.
 *
 * Response:
 * {
 *   success: boolean;
 *   executionId: string;
 *   workflowId: string;
 *   nodes: Array<{
 *     nodeId: string;
 *     nodeType: string;
 *     status: string;
 *     inputCount: number;
 *     outputCount: number;
 *     itemsAdded: string[];
 *     itemsRemoved: string[];
 *     filterFailures?: Record<string, string>; // itemId -> reason
 *     durationMs: number;
 *   }>;
 *   totalDuration: number;
 * }
 */

// File: app/api/executions/[id]/trace/[nodeId]/route.ts
/**
 * GET /api/executions/[id]/trace/[nodeId]?limit={n}&offset={m}
 *
 * Retrieves detailed data for a specific node in execution.
 *
 * Query Params:
 * - limit: number (default: 50, max: 1000)
 * - offset: number (default: 0)
 * - view: 'input' | 'output' | 'filtered' (default: 'all')
 *
 * Response:
 * {
 *   success: boolean;
 *   nodeId: string;
 *   nodeType: string;
 *   input: Array<any>; // Input data snapshot
 *   output: Array<any>; // Output data snapshot
 *   filtered: Array<{ item: any; reason: string }>; // Filtered items with reasons
 *   total: { input: number; output: number; filtered: number };
 *   hasMore: boolean;
 * }
 */

// File: app/api/executions/[id]/export/route.ts
/**
 * GET /api/executions/[id]/export?nodeId={id}&format=csv
 *
 * Exports execution data to CSV.
 *
 * Query Params:
 * - nodeId: string (optional, exports specific node data)
 * - format: 'csv' (future: 'json', 'xlsx')
 * - view: 'input' | 'output' | 'filtered' (default: 'all')
 *
 * Response:
 * Content-Type: text/csv
 * Content-Disposition: attachment; filename="execution-{id}-{nodeId}.csv"
 */
```

#### 4.4.3 Auto-Layout APIs

```typescript
// File: app/api/workflows/[id]/auto-layout/route.ts
/**
 * POST /api/workflows/[id]/auto-layout
 *
 * Calculates auto-layout positions for workflow nodes.
 *
 * Request Body:
 * {
 *   nodes: Array<{ id: string; type: string; data: any }>;
 *   edges: Array<{ id: string; source: string; target: string }>;
 *   direction?: 'LR' | 'TB' | 'RL' | 'BT'; // Default: 'LR'
 *   config?: {
 *     rankSeparation?: number; // Default: 150
 *     nodeSeparation?: number; // Default: 80
 *     edgeSeparation?: number; // Default: 20
 *     align?: 'UL' | 'UR' | 'DL' | 'DR'; // Default: 'UL'
 *   };
 * }
 *
 * Response:
 * {
 *   success: boolean;
 *   positions: Record<string, { x: number; y: number }>; // nodeId -> position
 * }
 */

// File: app/api/workflows/[id]/layout-preferences/route.ts
/**
 * GET /api/workflows/[id]/layout-preferences
 * POST /api/workflows/[id]/layout-preferences
 *
 * Get or update layout preferences for a workflow.
 *
 * POST Request Body:
 * {
 *   layoutLocked: boolean;
 *   layoutDirection: 'LR' | 'TB' | 'RL' | 'BT';
 *   layoutConfig: {
 *     rankSeparation: number;
 *     nodeSeparation: number;
 *     edgeSeparation: number;
 *     align: string;
 *   };
 * }
 *
 * Response:
 * {
 *   success: boolean;
 *   preferences: {
 *     layoutLocked: boolean;
 *     layoutDirection: string;
 *     layoutConfig: object;
 *   };
 * }
 */
```

---

## 5. Enhanced Filter Node Specification

### 5.1 Multi-Condition Builder UI

**Component:** `components/strategy-builder/enhanced-filter-node/multi-condition-builder.tsx`

**Features:**
- Add 2-10 conditions per filter node
- Visual condition rows with drag-to-reorder
- AND/OR toggle between conditions
- Real-time preview of combined filter logic
- Validation errors displayed inline

**UI Structure:**
```tsx
<MultiConditionBuilder>
  <ConditionRow key={1}>
    <FieldSelector /> {/* Dropdown: category, volume, title, etc. */}
    <OperatorSelector /> {/* Type-aware: =, >, contains, etc. */}
    <ValueInput /> {/* Smart input based on field type */}
    <RemoveButton /> {/* × icon */}
  </ConditionRow>

  <LogicToggle> {/* AND / OR */}

  <ConditionRow key={2}>
    {/* ... */}
  </ConditionRow>

  <AddConditionButton /> {/* + Add Condition */}

  <FilterPreview>
    (category = Politics) AND (volume > 100000)
  </FilterPreview>

  <ValidationErrors>
    ⚠ Field "volumee" does not exist. Did you mean "volume"?
  </ValidationErrors>
</MultiConditionBuilder>
```

**State Management:**
```typescript
interface FilterState {
  conditions: FilterCondition[];
  logicOperator: 'AND' | 'OR';
  validationErrors: string[];
}

interface FilterCondition {
  id: string; // UUID for React keys
  field: string; // 'volume', 'category', 'title', etc.
  operator: FilterOperator;
  value: any;
  fieldType?: 'number' | 'string' | 'array' | 'date' | 'boolean';
}

type FilterOperator =
  | 'eq' | 'ne' // Equals, Not Equals
  | 'gt' | 'gte' | 'lt' | 'lte' // Greater/Less Than
  | 'in' | 'not_in' // Array membership
  | 'contains' | 'not_contains' // String/Array contains
  | 'starts_with' | 'ends_with' // String patterns
  | 'between'; // Numeric range
```

### 5.2 Field Discovery Mechanism

**Component:** `lib/utils/field-discovery.ts`

**Purpose:** Dynamically discover available fields from upstream node outputs.

**Algorithm:**
1. Get output from connected upstream node
2. Extract all field paths from first item (or sample of items)
3. Detect field types by inspecting values
4. Group fields by category (Market Data, Analytics, Metadata)
5. Return structured field list for dropdown

**Implementation:**
```typescript
export function discoverFields(upstreamOutput: any[]): FieldDefinition[] {
  if (!upstreamOutput || upstreamOutput.length === 0) {
    return [];
  }

  const sampleSize = Math.min(10, upstreamOutput.length);
  const samples = upstreamOutput.slice(0, sampleSize);

  const fieldMap = new Map<string, FieldDefinition>();

  samples.forEach(item => {
    extractFieldsFromObject(item, '', fieldMap, item);
  });

  return Array.from(fieldMap.values());
}

function extractFieldsFromObject(
  obj: any,
  prefix: string,
  fieldMap: Map<string, FieldDefinition>,
  sampleValue: any
) {
  Object.keys(obj).forEach(key => {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    const type = detectFieldType(value);

    if (!fieldMap.has(path)) {
      fieldMap.set(path, {
        path,
        name: key,
        type,
        category: categorizeField(path),
        sampleValue: formatSampleValue(value, type),
      });
    }

    // Recurse for nested objects (limit depth to 3)
    if (type === 'object' && prefix.split('.').length < 3) {
      extractFieldsFromObject(value, path, fieldMap, sampleValue);
    }
  });
}

function detectFieldType(value: any): FieldType {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  if (typeof value === 'object') return 'object';
  return 'string';
}

function categorizeField(path: string): FieldCategory {
  // Market data fields
  if (['id', 'question', 'category', 'volume', 'liquidity', 'currentPrice'].includes(path)) {
    return 'Market Data';
  }
  // Analytics fields
  if (path.startsWith('analytics.') || ['omega_ratio', 'sharpe_ratio'].includes(path)) {
    return 'Analytics';
  }
  // Metadata
  return 'Metadata';
}

interface FieldDefinition {
  path: string; // 'analytics.roi'
  name: string; // 'roi'
  type: FieldType;
  category: FieldCategory;
  sampleValue: string; // '1.23' or '"Politics"' or '[...]'
}

type FieldType = 'number' | 'string' | 'boolean' | 'array' | 'date' | 'object' | 'unknown';
type FieldCategory = 'Market Data' | 'Analytics' | 'Metadata';
```

### 5.3 Category & Tag Filter Implementation

**Category Filter:**
- Polymarket categories are predefined: Politics, Crypto, Sports, Pop Culture, Science, Business, etc.
- UI: Dropdown with all categories
- Operators: IS, IS NOT, IN, NOT IN

**Tag Filter:**
- Tags are user-created labels on markets (e.g., "election", "bitcoin", "trump")
- UI: Multi-select dropdown with autocomplete
- Fetch available tags from database or upstream data
- Operators: HAS, DOES NOT HAVE, HAS ANY OF, HAS ALL OF

**Implementation:**
```typescript
// File: components/strategy-builder/enhanced-filter-node/category-picker.tsx
export function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  const categories = [
    'Politics',
    'Crypto',
    'Sports',
    'Pop Culture',
    'Science',
    'Business',
    'Finance',
    'Technology',
    'Other',
  ];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select category" />
      </SelectTrigger>
      <SelectContent>
        {categories.map(cat => (
          <SelectItem key={cat} value={cat}>
            {cat}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// File: components/strategy-builder/enhanced-filter-node/tag-picker.tsx
export function TagPicker({ value, onChange }: TagPickerProps) {
  const [search, setSearch] = useState('');
  const { data: availableTags } = useQuery({
    queryKey: ['tags', search],
    queryFn: () => fetchAvailableTags(search),
  });

  return (
    <MultiSelect
      value={value}
      onValueChange={onChange}
      options={availableTags || []}
      placeholder="Select tags"
      searchPlaceholder="Search tags..."
      onSearchChange={setSearch}
    />
  );
}
```

### 5.4 Executor Logic for Enhanced Filters

**File:** `lib/workflow/node-executors/filter-executor-v2.ts`

**Purpose:** Execute multi-condition filters on data arrays.

**Algorithm:**
```typescript
export async function executeEnhancedFilter(
  node: WorkflowNode,
  context: ExecutionContext
): Promise<any[]> {
  const config = node.data.config as EnhancedFilterConfig;
  const upstreamData = getUpstreamData(node, context);

  if (!upstreamData || !Array.isArray(upstreamData)) {
    throw new Error('Filter node requires array input from upstream node');
  }

  const { conditions, logicOperator } = config;
  const filterFailures: Record<string, string> = {};

  const filteredData = upstreamData.filter(item => {
    const results = conditions.map(cond => evaluateCondition(item, cond));

    const passed = logicOperator === 'AND'
      ? results.every(r => r.passed)
      : results.some(r => r.passed);

    if (!passed) {
      // Track why item was filtered out
      const failedConditions = results
        .filter(r => !r.passed)
        .map(r => r.reason)
        .join(', ');
      filterFailures[item.id] = failedConditions;
    }

    return passed;
  });

  // Store trace data for debugging
  await storeTraceData(context.executionId, node.id, {
    inputSnapshot: upstreamData.slice(0, 1000), // Limit to 1000
    outputSnapshot: filteredData.slice(0, 1000),
    itemsRemoved: Object.keys(filterFailures),
    filterFailures,
  });

  return filteredData;
}

function evaluateCondition(
  item: any,
  condition: FilterCondition
): { passed: boolean; reason: string } {
  const fieldValue = getNestedValue(item, condition.field);

  switch (condition.operator) {
    case 'eq':
      return {
        passed: fieldValue === condition.value,
        reason: `${condition.field} (${fieldValue}) !== ${condition.value}`,
      };

    case 'gt':
      return {
        passed: fieldValue > condition.value,
        reason: `${condition.field} (${fieldValue}) <= ${condition.value}`,
      };

    case 'contains':
      if (typeof fieldValue === 'string') {
        return {
          passed: fieldValue.toLowerCase().includes(condition.value.toLowerCase()),
          reason: `${condition.field} does not contain "${condition.value}"`,
        };
      }
      if (Array.isArray(fieldValue)) {
        return {
          passed: fieldValue.includes(condition.value),
          reason: `${condition.field} does not include "${condition.value}"`,
        };
      }
      return { passed: false, reason: `${condition.field} is not searchable` };

    case 'in':
      return {
        passed: Array.isArray(condition.value) && condition.value.includes(fieldValue),
        reason: `${condition.field} (${fieldValue}) not in [${condition.value.join(', ')}]`,
      };

    // ... other operators

    default:
      return { passed: true, reason: '' };
  }
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}
```

---

## 6. Data Flow Visualization Specification

### 6.1 Execution Trace Capture System

**File:** `lib/workflow/node-executors/trace-collector.ts`

**Purpose:** Capture data snapshots during node execution for debugging.

**Integration Points:**
- Called by node executors after execution
- Stores data in `strategy_execution_logs` table
- Limits snapshots to 1000 items for performance

**Implementation:**
```typescript
export async function storeTraceData(
  executionId: string,
  nodeId: string,
  trace: {
    inputSnapshot: any[];
    outputSnapshot: any[];
    itemsAdded?: string[];
    itemsRemoved?: string[];
    filterFailures?: Record<string, string>;
  }
) {
  const supabase = createClient();

  // Limit snapshot size
  const limitedInput = trace.inputSnapshot.slice(0, 1000);
  const limitedOutput = trace.outputSnapshot.slice(0, 1000);

  await supabase
    .from('strategy_execution_logs')
    .update({
      input_snapshot: limitedInput,
      output_snapshot: limitedOutput,
      items_added: trace.itemsAdded || [],
      items_removed: trace.itemsRemoved || [],
      filter_failures: trace.filterFailures || {},
    })
    .eq('execution_id', executionId)
    .eq('node_id', nodeId);
}

export async function getExecutionTrace(executionId: string) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('strategy_execution_logs')
    .select('*')
    .eq('execution_id', executionId)
    .order('started_at', { ascending: true });

  if (error) throw error;

  return data.map(log => ({
    nodeId: log.node_id,
    nodeType: log.node_type,
    status: log.status,
    inputCount: log.input_snapshot?.length || 0,
    outputCount: log.output_snapshot?.length || 0,
    itemsAdded: log.items_added || [],
    itemsRemoved: log.items_removed || [],
    filterFailures: log.filter_failures || {},
    durationMs: log.duration_ms,
    input: log.input_snapshot,
    output: log.output_snapshot,
  }));
}
```

### 6.2 Debug Panel UI Design

**Component:** `components/strategy-builder/data-flow-panel/index.tsx`

**Layout Options:**
- Side panel (default): 40% width, slides in from right
- Full-screen modal: Covers entire viewport with close button

**Main Views:**
1. **Node List View**: Timeline showing all nodes with flow counts
2. **Node Detail View**: Detailed inspection of single node
3. **Item Trace View**: Follow specific item through workflow

**UI Structure:**
```tsx
<DataFlowPanel executionId={executionId} open={isOpen} onClose={onClose}>
  <PanelHeader>
    <Title>Data Flow Debug</Title>
    <ViewToggle> {/* Side Panel / Full Screen */}
    <CloseButton />
  </PanelHeader>

  <PanelBody>
    {/* Node List View (default) */}
    <NodeListView
      nodes={traceData.nodes}
      onNodeClick={setSelectedNode}
    />

    {/* Node Detail View (when node selected) */}
    {selectedNode && (
      <NodeDetailView
        node={selectedNode}
        onBack={() => setSelectedNode(null)}
        onItemClick={setTracedItem}
      />
    )}

    {/* Item Trace View (when item selected) */}
    {tracedItem && (
      <ItemTraceView
        item={tracedItem}
        nodes={traceData.nodes}
        onBack={() => setTracedItem(null)}
      />
    )}
  </PanelBody>
</DataFlowPanel>
```

**Node List View:**
```tsx
<NodeListView>
  <FlowDiagram> {/* Simplified ReactFlow visualization */}

  <NodeTimeline>
    <NodeCard key={node1}>
      <NodeIcon /> {/* Icon based on node type */}
      <NodeName>Polymarket Stream</NodeName>
      <FlowCounts>
        <Input>500 in</Input>
        <Arrow>→</Arrow>
        <Output>500 out</Output>
      </FlowCounts>
      <Duration>245ms</Duration>
    </NodeCard>

    <NodeCard key={node2} status="filtered">
      <NodeIcon />
      <NodeName>Filter: Volume & Category</NodeName>
      <FlowCounts>
        <Input>500 in</Input>
        <Arrow>→</Arrow>
        <Output success>47 out</Output>
        <Filtered>-453 filtered</Filtered>
      </FlowCounts>
      <Duration>18ms</Duration>
    </NodeCard>

    {/* ... more nodes */}
  </NodeTimeline>
</NodeListView>
```

**Node Detail View:**
```tsx
<NodeDetailView node={node}>
  <DetailHeader>
    <BackButton />
    <NodeName>{node.nodeType}</NodeName>
    <ExportButton onClick={exportToCSV} />
  </DetailHeader>

  <SplitPane>
    <LeftPane title="Input (500 items)">
      <DataTable
        data={node.input}
        columns={autoDetectColumns(node.input)}
        sortable
        searchable
        pagination={{ pageSize: 50 }}
        onRowClick={handleRowClick}
        highlightFn={item => !node.output.includes(item) ? 'red' : undefined}
      />
    </LeftPane>

    <RightPane title="Output (47 items)">
      <DataTable
        data={node.output}
        columns={autoDetectColumns(node.output)}
        sortable
        searchable
        pagination={{ pageSize: 50 }}
        onRowClick={handleRowClick}
        highlightFn={() => 'green'}
      />
    </RightPane>
  </SplitPane>

  {node.filterFailures && (
    <FilterFailuresSection>
      <Title>Filtered Items ({Object.keys(node.filterFailures).length})</Title>
      <Table>
        <Row each={Object.entries(node.filterFailures)}>
          <Cell>{item.id}</Cell>
          <Cell>{item.question}</Cell>
          <Cell error>{reason}</Cell>
        </Row>
      </Table>
    </FilterFailuresSection>
  )}
</NodeDetailView>
```

### 6.3 Interactive Item Tracing

**Component:** `components/strategy-builder/data-flow-panel/item-trace-view.tsx`

**Purpose:** Follow a specific item (e.g., market) through entire workflow to see where it was added/removed.

**Features:**
- Breadcrumb trail showing item's path
- Visual highlighting on flow diagram
- Reason display for each filter that removed the item
- Quick jump to any node in the path

**UI Structure:**
```tsx
<ItemTraceView item={item} nodes={nodes}>
  <TraceHeader>
    <BackButton />
    <ItemTitle>{item.question}</ItemTitle>
    <ItemId>{item.id}</ItemId>
  </TraceHeader>

  <Breadcrumb>
    <Step success>Polymarket Stream</Step>
    <Arrow>→</Arrow>
    <Step success>Filter: Category</Step>
    <Arrow>→</Arrow>
    <Step error>Filter: Volume</Step>
    <CrossIcon /> {/* Item stopped here */}
  </Breadcrumb>

  <FlowDiagramHighlight>
    {/* ReactFlow with highlighted path */}
    <Node id="stream" highlight="green" />
    <Edge id="stream-filter1" highlight="green" />
    <Node id="filter1" highlight="green" />
    <Edge id="filter1-filter2" highlight="red" />
    <Node id="filter2" highlight="red" />
  </FlowDiagramHighlight>

  <TraceDetails>
    <NodeTrace key="stream">
      <NodeName>Polymarket Stream</NodeName>
      <Status success>✓ Item Added</Status>
      <Details>Market streamed from Polymarket API</Details>
    </NodeTrace>

    <NodeTrace key="filter1">
      <NodeName>Filter: Category</NodeName>
      <Status success>✓ Passed</Status>
      <Details>category (Politics) = Politics</Details>
    </NodeTrace>

    <NodeTrace key="filter2">
      <NodeName>Filter: Volume</NodeName>
      <Status error>✗ Filtered Out</Status>
      <Reason>volume (45000) &lt; 100000</Reason>
      <Suggestion>
        This market was filtered because volume is below threshold.
        <Link>Adjust filter to volume &gt; 40000</Link>
      </Suggestion>
    </NodeTrace>
  </TraceDetails>
</ItemTraceView>
```

### 6.4 Performance Considerations

**Challenge:** Handling large data snapshots (1000+ items) without UI lag.

**Solutions:**
1. **Snapshot Size Limit**: Cap at 1000 items per node
2. **Virtual Scrolling**: Use `@tanstack/react-virtual` for tables
3. **Pagination**: 50 items per page default
4. **Lazy Loading**: Load node details on-demand
5. **Debounced Search**: 300ms debounce on search inputs
6. **JSONB Indexing**: Database indexes on snapshot columns
7. **Worker Thread CSV Export**: Use Web Worker for large exports

**Implementation:**
```typescript
// Virtual scrolling for large tables
import { useVirtualizer } from '@tanstack/react-virtual';

function DataTable({ data }: { data: any[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40, // Row height
    overscan: 10, // Render 10 extra rows
  });

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <DataRow
            key={virtualRow.index}
            data={data[virtualRow.index]}
            style={{ height: `${virtualRow.size}px` }}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## 7. Portfolio Orchestrator Specification

### 7.1 AI Risk Analysis Engine Design

**File:** `lib/ai/orchestrator-analysis.ts`

**Purpose:** AI-powered position sizing and risk analysis using Claude Sonnet 4.5.

**Input Data Structure:**
```typescript
interface OrchestratorAnalysisInput {
  market: {
    id: string;
    question: string;
    category: string;
    volume24h: number;
    liquidity: number;
    currentOdds: { yes: number; no: number };
    createdAt: string;
    endDate: string;
  };
  portfolio: {
    totalCapital: number;
    deployedCapital: number;
    availableCapital: number;
    openPositions: number;
    recentPnL: number; // Last 7 days
    winRate7d: number; // 0-1
  };
  signal: {
    direction: 'YES' | 'NO';
    confidence: number; // 0-1
    reasoning: string;
  };
  rules: {
    maxPerPosition: number; // Percentage (0-1)
    minBet: number; // USD
    maxBet: number; // USD
    portfolioHeatLimit: number; // Percentage (0-1)
    riskRewardThreshold: number; // Ratio
    drawdownProtection?: {
      threshold: number; // If down X%, trigger
      reduction: number; // Reduce bet size by Y%
    };
    volatilityAdjustment: boolean;
  };
}

interface OrchestratorAnalysisOutput {
  decision: 'GO' | 'NO_GO';
  recommendedSize: number; // USD
  riskScore: number; // 1-10
  reasoning: string; // 2-3 sentences
  confidence: number; // 0-1
  checks: {
    sufficientCapital: boolean;
    withinPositionLimit: boolean;
    withinHeatLimit: boolean;
    meetsRiskReward: boolean;
    marketQuality: 'good' | 'fair' | 'poor';
  };
}
```

**AI Prompt Template:**
```typescript
const ORCHESTRATOR_PROMPT = `You are a professional portfolio manager for prediction market trading. Analyze this opportunity and recommend a position size.

**Market Opportunity:**
- Question: {{market.question}}
- Category: {{market.category}}
- Current Odds: {{market.currentOdds.yes}}% YES, {{market.currentOdds.no}}% NO
- 24h Volume: ${{market.volume24h}}
- Liquidity: ${{market.liquidity}}
- Time to Close: {{daysUntilClose}} days

**Signal:**
- Direction: {{signal.direction}}
- Confidence: {{signal.confidence}}
- Reasoning: {{signal.reasoning}}

**Portfolio State:**
- Total Capital: ${{portfolio.totalCapital}}
- Deployed: ${{portfolio.deployedCapital}} ({{deployedPercent}}%)
- Available: ${{portfolio.availableCapital}}
- Open Positions: {{portfolio.openPositions}}
- Recent Performance: {{portfolio.recentPnL >= 0 ? '+' : ''}}${{portfolio.recentPnL}} ({{portfolio.winRate7d}}% win rate)

**Risk Rules:**
- Max per position: {{rules.maxPerPosition * 100}}%
- Bet range: ${{rules.minBet}} - ${{rules.maxBet}}
- Portfolio heat limit: {{rules.portfolioHeatLimit * 100}}% (currently at {{deployedPercent}}%)
- Risk-reward threshold: {{rules.riskRewardThreshold}}:1
{{#if rules.drawdownProtection}}
- Drawdown protection: If down {{rules.drawdownProtection.threshold}}%, reduce bets by {{rules.drawdownProtection.reduction}}%
{{/if}}

**Your Task:**
Analyze this opportunity considering:
1. Market quality (volume, liquidity, time to close)
2. Signal strength and confidence
3. Current portfolio exposure and performance
4. Risk-reward ratio for this bet
5. Position sizing best practices (Kelly Criterion, risk parity)

**Provide:**
1. Decision: GO or NO_GO
2. Recommended bet size in USD (if GO)
3. Risk score (1-10, where 1=very safe, 10=very risky)
4. Brief reasoning (2-3 sentences explaining your decision)
5. Confidence level (0-1)

**Output Format (JSON):**
{
  "decision": "GO" | "NO_GO",
  "recommendedSize": number,
  "riskScore": number,
  "reasoning": "string",
  "confidence": number
}`;
```

**Implementation:**
```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';

export async function analyzeOrchestratorDecision(
  input: OrchestratorAnalysisInput
): Promise<OrchestratorAnalysisOutput> {
  // Pre-flight checks
  const checks = performPreflightChecks(input);

  // If basic checks fail, return NO_GO immediately
  if (!checks.sufficientCapital || !checks.withinHeatLimit) {
    return {
      decision: 'NO_GO',
      recommendedSize: 0,
      riskScore: 10,
      reasoning: 'Insufficient capital or portfolio heat limit exceeded.',
      confidence: 1.0,
      checks,
    };
  }

  // Calculate risk-reward ratio
  const riskRewardRatio = calculateRiskReward(input.market.currentOdds, input.signal.direction);

  if (riskRewardRatio < input.rules.riskRewardThreshold) {
    return {
      decision: 'NO_GO',
      recommendedSize: 0,
      riskScore: 7,
      reasoning: `Risk-reward ratio (${riskRewardRatio.toFixed(2)}:1) below threshold (${input.rules.riskRewardThreshold}:1).`,
      confidence: 1.0,
      checks,
    };
  }

  // Render prompt with data
  const prompt = renderPrompt(ORCHESTRATOR_PROMPT, input);

  // Call AI for analysis
  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-5'),
    schema: z.object({
      decision: z.enum(['GO', 'NO_GO']),
      recommendedSize: z.number(),
      riskScore: z.number().min(1).max(10),
      reasoning: z.string(),
      confidence: z.number().min(0).max(1),
    }),
    prompt,
    temperature: 0.3, // Lower temperature for consistent decisions
  });

  // Validate recommended size against rules
  const validatedSize = validateRecommendedSize(object.recommendedSize, input.rules);

  return {
    ...object,
    recommendedSize: validatedSize,
    checks,
  };
}

function performPreflightChecks(input: OrchestratorAnalysisInput) {
  const deployedPercent = input.portfolio.deployedCapital / input.portfolio.totalCapital;

  return {
    sufficientCapital: input.portfolio.availableCapital >= input.rules.minBet,
    withinPositionLimit: true, // Checked after size recommendation
    withinHeatLimit: deployedPercent < input.rules.portfolioHeatLimit,
    meetsRiskReward: true, // Checked before AI call
    marketQuality: assessMarketQuality(input.market),
  };
}

function calculateRiskReward(odds: { yes: number; no: number }, direction: 'YES' | 'NO'): number {
  const probability = direction === 'YES' ? odds.yes / 100 : odds.no / 100;
  const potentialGain = (1 / probability) - 1;
  const potentialLoss = 1;
  return potentialGain / potentialLoss;
}

function assessMarketQuality(market: any): 'good' | 'fair' | 'poor' {
  if (market.volume24h > 100000 && market.liquidity > 20000) return 'good';
  if (market.volume24h > 50000 && market.liquidity > 10000) return 'fair';
  return 'poor';
}

function validateRecommendedSize(size: number, rules: any): number {
  // Clamp to min/max bounds
  let validatedSize = Math.max(rules.minBet, Math.min(size, rules.maxBet));

  // Ensure doesn't exceed max per position
  const maxAllowed = rules.maxPerPosition * rules.totalCapital;
  validatedSize = Math.min(validatedSize, maxAllowed);

  return Math.round(validatedSize * 100) / 100; // Round to cents
}
```

### 7.2 Position Sizing Formulas

**Kelly Criterion (Reference):**
```
Kelly % = (bp - q) / b

where:
- b = decimal odds - 1 (e.g., 1.54 - 1 = 0.54)
- p = probability of winning (AI confidence or model prediction)
- q = probability of losing (1 - p)

Example:
- Odds: 65% YES (decimal: 1.54)
- AI confidence: 75%
- Kelly % = (0.54 * 0.75 - 0.25) / 0.54 = 28.7%
- With $10k portfolio: $2,870

Note: Use fractional Kelly (e.g., 0.5 * Kelly) for safety
```

**Risk-Parity Adjustment:**
```typescript
function adjustForVolatility(baseSize: number, market: any): number {
  const volatilityScore = calculateVolatilityScore(market);

  // volatilityScore: 0 (stable) to 1 (very volatile)
  // Reduce bet size for high volatility
  const volatilityAdjustment = 1 - (volatilityScore * 0.5); // Max 50% reduction

  return baseSize * volatilityAdjustment;
}

function calculateVolatilityScore(market: any): number {
  // Proxy for volatility using liquidity and volume
  const liquidityRatio = market.liquidity / market.volume24h;

  // Low liquidity = high volatility
  if (liquidityRatio < 0.1) return 0.8; // High volatility
  if (liquidityRatio < 0.2) return 0.5; // Medium volatility
  return 0.2; // Low volatility
}
```

**Drawdown Protection:**
```typescript
function applyDrawdownProtection(
  baseSize: number,
  portfolio: any,
  rules: any
): number {
  if (!rules.drawdownProtection) return baseSize;

  const currentDrawdown = portfolio.recentPnL / portfolio.totalCapital;

  if (currentDrawdown < -rules.drawdownProtection.threshold) {
    const reduction = 1 - rules.drawdownProtection.reduction;
    return baseSize * reduction;
  }

  return baseSize;
}
```

### 7.3 Approval Workflow Implementation

**Autonomous Mode:**
1. Orchestrator analyzes opportunity
2. If decision = GO, execute trade immediately
3. Log decision to `orchestrator_decisions` table
4. Send low-priority notification: "Trade executed: $325 on Bitcoin market"

**Approval Required Mode:**
1. Orchestrator analyzes opportunity
2. If decision = GO, create pending decision record
3. Send high-priority notification: "Trade approval needed"
4. User clicks notification → Approval modal opens
5. User reviews and approves/rejects/adjusts
6. On approve: Execute trade, update decision record
7. On reject: Update decision record, skip trade

**Approval Modal Component:**
```tsx
// File: components/strategy-builder/orchestrator-node/approval-modal.tsx
export function ApprovalModal({ decisionId }: ApprovalModalProps) {
  const { data: decision } = useQuery({
    queryKey: ['orchestrator-decision', decisionId],
    queryFn: () => fetchDecision(decisionId),
  });

  const [adjustedSize, setAdjustedSize] = useState(decision?.recommendedSize);
  const approveMutation = useMutation({
    mutationFn: (size: number) => approveDecision(decisionId, size),
  });
  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectDecision(decisionId, reason),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trade Approval Required</DialogTitle>
        </DialogHeader>

        <MarketSummary>
          <Question>{decision.marketQuestion}</Question>
          <Category>{decision.marketCategory}</Category>
          <Odds>
            Current Odds: {decision.currentOdds.yes}% YES, {decision.currentOdds.no}% NO
          </Odds>
          <Direction>
            Direction: <Badge>{decision.direction}</Badge>
          </Direction>
        </MarketSummary>

        <AIRecommendation>
          <RiskScore score={decision.riskScore}>
            Risk Score: {decision.riskScore}/10
          </RiskScore>
          <Reasoning>{decision.aiReasoning}</Reasoning>
          <Confidence>AI Confidence: {(decision.aiConfidence * 100).toFixed(0)}%</Confidence>
        </AIRecommendation>

        <PositionSizeControl>
          <Label>Position Size</Label>
          <Slider
            value={[adjustedSize]}
            onValueChange={([val]) => setAdjustedSize(val)}
            min={decision.rules.minBet}
            max={decision.rules.maxBet}
            step={5}
          />
          <SizeDisplay>${adjustedSize}</SizeDisplay>
          <RecommendedBadge>
            Recommended: ${decision.recommendedSize}
          </RecommendedBadge>
        </PositionSizeControl>

        <PortfolioImpact>
          <Stat>
            <Label>Portfolio Impact</Label>
            <Value>{((adjustedSize / decision.portfolio.total) * 100).toFixed(1)}%</Value>
          </Stat>
          <Stat>
            <Label>New Total Exposure</Label>
            <Value>
              {(((decision.portfolio.deployed + adjustedSize) / decision.portfolio.total) * 100).toFixed(1)}%
            </Value>
          </Stat>
        </PortfolioImpact>

        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => rejectMutation.mutate('User declined')}
          >
            Reject
          </Button>
          <Button
            variant="default"
            onClick={() => approveMutation.mutate(adjustedSize)}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? 'Approving...' : 'Approve & Execute'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 7.4 Decision Tracking System

**Database Table:** `orchestrator_decisions` (see Section 4.3.2)

**Decision History UI:**
```tsx
// File: components/strategy-builder/orchestrator-node/decision-history.tsx
export function DecisionHistory({ workflowId }: DecisionHistoryProps) {
  const { data: decisions } = useQuery({
    queryKey: ['orchestrator-decisions', workflowId],
    queryFn: () => fetchDecisions(workflowId),
  });

  const columns = [
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ row }) => formatDate(row.getValue('createdAt')),
    },
    {
      accessorKey: 'marketQuestion',
      header: 'Market',
    },
    {
      accessorKey: 'decision',
      header: 'Decision',
      cell: ({ row }) => (
        <Badge variant={row.getValue('decision') === 'approve' ? 'success' : 'destructive'}>
          {row.getValue('decision')}
        </Badge>
      ),
    },
    {
      accessorKey: 'recommendedSize',
      header: 'Recommended',
      cell: ({ row }) => `$${row.getValue('recommendedSize')}`,
    },
    {
      accessorKey: 'actualSize',
      header: 'Actual',
      cell: ({ row }) => row.getValue('actualSize') ? `$${row.getValue('actualSize')}` : '-',
    },
    {
      accessorKey: 'riskScore',
      header: 'Risk',
      cell: ({ row }) => (
        <RiskBadge score={row.getValue('riskScore')}>
          {row.getValue('riskScore')}/10
        </RiskBadge>
      ),
    },
    {
      accessorKey: 'tradeStatus',
      header: 'Trade Status',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orchestrator Decision History</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={decisions || []}
          pagination
          searchable
        />
      </CardContent>
    </Card>
  );
}
```

**Performance Analytics:**
- Track approval rate (approved / total decisions)
- Average risk score of approved trades
- Comparison: AI recommended size vs. actual size
- Outcome tracking: P&L of executed trades
- Decision latency: Time from creation to approval/rejection

---

## 8. Auto-Layout System Specification

### 8.1 Dagre/ELKjs Integration

**Library Choice:** Dagre (simpler, lighter weight)

**Installation:**
```bash
npm install @dagrejs/dagre
npm install @types/dagre --save-dev
```

**File:** `lib/workflow/layout/dagre-layout.ts`

**Implementation:**
```typescript
import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

export interface LayoutConfig {
  direction: 'LR' | 'TB' | 'RL' | 'BT'; // Left-Right, Top-Bottom, etc.
  rankSeparation: number; // Horizontal spacing between ranks
  nodeSeparation: number; // Vertical spacing between nodes
  edgeSeparation: number; // Spacing between edges
  align: 'UL' | 'UR' | 'DL' | 'DR'; // Alignment
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  direction: 'LR',
  rankSeparation: 150,
  nodeSeparation: 80,
  edgeSeparation: 20,
  align: 'UL',
};

export function calculateDagreLayout(
  nodes: Node[],
  edges: Edge[],
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): Record<string, { x: number; y: number }> {
  // Create a new directed graph
  const graph = new dagre.graphlib.Graph();

  // Set graph configuration
  graph.setGraph({
    rankdir: config.direction,
    ranksep: config.rankSeparation,
    nodesep: config.nodeSeparation,
    edgesep: config.edgeSeparation,
    align: config.align,
  });

  // Default to assigning a new object as a label for each new edge
  graph.setDefaultEdgeLabel(() => ({}));

  // Add nodes to the graph
  nodes.forEach(node => {
    // Use actual node dimensions if available, otherwise default
    const width = node.width || 280;
    const height = node.height || 120;

    graph.setNode(node.id, {
      width,
      height,
      label: node.data.label || node.type,
    });
  });

  // Add edges to the graph
  edges.forEach(edge => {
    graph.setEdge(edge.source, edge.target);
  });

  // Run the layout algorithm
  dagre.layout(graph);

  // Extract positions from graph
  const positions: Record<string, { x: number; y: number }> = {};

  graph.nodes().forEach(nodeId => {
    const nodeWithPosition = graph.node(nodeId);

    positions[nodeId] = {
      // Center the node at the calculated position
      x: nodeWithPosition.x - (nodeWithPosition.width / 2),
      y: nodeWithPosition.y - (nodeWithPosition.height / 2),
    };
  });

  return positions;
}

export function applyLayoutToNodes(
  nodes: Node[],
  positions: Record<string, { x: number; y: number }>
): Node[] {
  return nodes.map(node => ({
    ...node,
    position: positions[node.id] || node.position,
  }));
}
```

### 8.2 Layout Algorithm Configuration

**User Preferences:** Stored in `workflow_sessions.layout_config`

**Configurable Parameters:**
- **Direction:** LR (left-to-right) vs. TB (top-to-bottom)
  - LR: Good for linear workflows (Source → Transform → Action)
  - TB: Good for hierarchical workflows (Decision trees)

- **Rank Separation:** Horizontal spacing between node levels (default: 150px)
  - Smaller (100px): Compact layout
  - Larger (200px): Spacious layout

- **Node Separation:** Vertical spacing between nodes in same rank (default: 80px)

- **Edge Separation:** Spacing between parallel edges (default: 20px)

- **Align:** Node alignment within ranks
  - UL (up-left): Align nodes to top-left
  - UR (up-right): Align nodes to top-right
  - DL (down-left): Align nodes to bottom-left
  - DR (down-right): Align nodes to bottom-right

**Settings UI:**
```tsx
// File: components/strategy-builder/auto-layout/layout-settings.tsx
export function LayoutSettings({ workflowId }: LayoutSettingsProps) {
  const { data: preferences } = useQuery({
    queryKey: ['layout-preferences', workflowId],
    queryFn: () => fetchLayoutPreferences(workflowId),
  });

  const updateMutation = useMutation({
    mutationFn: (config: LayoutConfig) => updateLayoutPreferences(workflowId, config),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="h-4 w-4 mr-2" />
          Layout Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <div>
            <Label>Direction</Label>
            <Select
              value={preferences.direction}
              onValueChange={val => updateMutation.mutate({ ...preferences, direction: val })}
            >
              <SelectItem value="LR">Left to Right</SelectItem>
              <SelectItem value="TB">Top to Bottom</SelectItem>
              <SelectItem value="RL">Right to Left</SelectItem>
              <SelectItem value="BT">Bottom to Top</SelectItem>
            </Select>
          </div>

          <div>
            <Label>Rank Separation: {preferences.rankSeparation}px</Label>
            <Slider
              value={[preferences.rankSeparation]}
              onValueChange={([val]) => updateMutation.mutate({ ...preferences, rankSeparation: val })}
              min={50}
              max={300}
              step={10}
            />
          </div>

          <div>
            <Label>Node Separation: {preferences.nodeSeparation}px</Label>
            <Slider
              value={[preferences.nodeSeparation]}
              onValueChange={([val]) => updateMutation.mutate({ ...preferences, nodeSeparation: val })}
              min={40}
              max={150}
              step={10}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

### 8.3 Manual Override Tools

**Layout Toolbar:**
```tsx
// File: components/strategy-builder/auto-layout/layout-toolbar.tsx
export function LayoutToolbar({ workflowId, nodes, edges, onNodesChange }: LayoutToolbarProps) {
  const [layoutLocked, setLayoutLocked] = useState(true);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false);

  const handleReLayout = () => {
    const positions = calculateDagreLayout(nodes, edges);
    const updatedNodes = applyLayoutToNodes(nodes, positions);
    onNodesChange(updatedNodes);
    toast.success('Workflow re-organized');
  };

  const handleAlign = (direction: 'left' | 'right' | 'top' | 'bottom') => {
    const selectedNodes = nodes.filter(n => n.selected);
    if (selectedNodes.length < 2) {
      toast.error('Select 2+ nodes to align');
      return;
    }

    const aligned = alignNodes(selectedNodes, direction);
    onNodesChange(nodes.map(n => aligned.find(a => a.id === n.id) || n));
  };

  const handleDistribute = (direction: 'horizontal' | 'vertical') => {
    const selectedNodes = nodes.filter(n => n.selected);
    if (selectedNodes.length < 3) {
      toast.error('Select 3+ nodes to distribute');
      return;
    }

    const distributed = distributeNodes(selectedNodes, direction);
    onNodesChange(nodes.map(n => distributed.find(d => d.id === n.id) || n));
  };

  return (
    <div className="flex items-center gap-2 bg-background border rounded-lg p-2">
      <Button variant="ghost" size="sm" onClick={handleReLayout}>
        <Grid className="h-4 w-4 mr-2" />
        Re-layout
      </Button>

      <Separator orientation="vertical" className="h-6" />

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLayoutLocked(!layoutLocked)}
            >
              {layoutLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {layoutLocked ? 'Layout locked (manual edits preserved)' : 'Layout unlocked (auto-layout enabled)'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Separator orientation="vertical" className="h-6" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <AlignLeft className="h-4 w-4 mr-2" />
            Align
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => handleAlign('left')}>Align Left</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAlign('right')}>Align Right</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAlign('top')}>Align Top</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAlign('bottom')}>Align Bottom</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <Distribute className="h-4 w-4 mr-2" />
            Distribute
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => handleDistribute('horizontal')}>
            Distribute Horizontally
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleDistribute('vertical')}>
            Distribute Vertically
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-2">
        <Checkbox
          id="grid-snap"
          checked={gridSnapEnabled}
          onCheckedChange={setGridSnapEnabled}
        />
        <Label htmlFor="grid-snap" className="text-sm">Snap to Grid</Label>
      </div>
    </div>
  );
}
```

**Alignment Helper Functions:**
```typescript
// File: lib/workflow/layout/alignment-tools.ts
export function alignNodes(
  nodes: Node[],
  direction: 'left' | 'right' | 'top' | 'bottom'
): Node[] {
  if (nodes.length < 2) return nodes;

  const positions = nodes.map(n => n.position);

  let alignValue: number;

  switch (direction) {
    case 'left':
      alignValue = Math.min(...positions.map(p => p.x));
      return nodes.map(n => ({ ...n, position: { ...n.position, x: alignValue } }));

    case 'right':
      alignValue = Math.max(...positions.map(p => p.x));
      return nodes.map(n => ({ ...n, position: { ...n.position, x: alignValue } }));

    case 'top':
      alignValue = Math.min(...positions.map(p => p.y));
      return nodes.map(n => ({ ...n, position: { ...n.position, y: alignValue } }));

    case 'bottom':
      alignValue = Math.max(...positions.map(p => p.y));
      return nodes.map(n => ({ ...n, position: { ...n.position, y: alignValue } }));
  }
}

export function distributeNodes(
  nodes: Node[],
  direction: 'horizontal' | 'vertical'
): Node[] {
  if (nodes.length < 3) return nodes;

  const sorted = [...nodes].sort((a, b) => {
    if (direction === 'horizontal') {
      return a.position.x - b.position.x;
    } else {
      return a.position.y - b.position.y;
    }
  });

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const totalSpace = direction === 'horizontal'
    ? last.position.x - first.position.x
    : last.position.y - first.position.y;

  const spacing = totalSpace / (sorted.length - 1);

  return sorted.map((node, index) => ({
    ...node,
    position: {
      ...node.position,
      [direction === 'horizontal' ? 'x' : 'y']: first.position[direction === 'horizontal' ? 'x' : 'y'] + (spacing * index),
    },
  }));
}

export function snapToGrid(position: { x: number; y: number }, gridSize: number = 20): { x: number; y: number } {
  return {
    x: Math.round(position.x / gridSize) * gridSize,
    y: Math.round(position.y / gridSize) * gridSize,
  };
}
```

### 8.4 AI Copilot Integration

**When AI Copilot creates a workflow, it should include layout hints in the response.**

**Modified AI Response Format:**
```typescript
interface AIWorkflowResponse {
  nodes: Node[];
  edges: Edge[];
  layoutHints?: {
    importanceRanking?: Record<string, number>; // nodeId -> importance (1=highest)
    groupings?: Array<{
      name: string;
      nodes: string[]; // nodeIds in this group
    }>;
    criticalPath?: string[]; // nodeIds on critical path
  };
}
```

**AI Prompt Addition:**
```typescript
const AI_LAYOUT_PROMPT_SUFFIX = `
When creating the workflow, also provide layout hints:
1. Rank nodes by importance (1 = most important)
2. Group related nodes (e.g., "Data Preparation", "Decision Logic")
3. Identify critical path (main data flow)

Include in response:
{
  "layoutHints": {
    "importanceRanking": {
      "node-1": 1,
      "node-2": 2
    },
    "groupings": [
      {
        "name": "Data Preparation",
        "nodes": ["node-1", "node-2"]
      }
    ],
    "criticalPath": ["node-1", "node-3", "node-5"]
  }
}
`;
```

**Layout Hints Application:**
```typescript
// File: lib/workflow/layout/layout-hints.ts
export function applyLayoutHints(
  nodes: Node[],
  edges: Edge[],
  hints: LayoutHints
): Node[] {
  // Calculate base layout
  let positions = calculateDagreLayout(nodes, edges);

  // Adjust based on importance ranking
  if (hints.importanceRanking) {
    positions = adjustForImportance(positions, hints.importanceRanking);
  }

  // Apply grouping (future: visual containers)
  if (hints.groupings) {
    positions = adjustForGroupings(positions, hints.groupings);
  }

  return applyLayoutToNodes(nodes, positions);
}

function adjustForImportance(
  positions: Record<string, Position>,
  ranking: Record<string, number>
): Record<string, Position> {
  // Higher importance → more central position
  // (This is a simple implementation; can be enhanced)
  return positions;
}
```

---

## 9. Integration Points

### 9.1 Existing Autonomous Execution System

**Integration:** All enhancements integrate with the existing workflow executor built in the autonomous execution system (Task Groups 1-7).

**Key Integration Points:**

1. **Workflow Executor (`lib/workflow/executor.ts`)**
   - Enhanced filter executor registers as new node type handler
   - Orchestrator executor registers as new node type handler
   - Trace collector hooks into executor lifecycle

2. **Strategy Execution Logs (`strategy_execution_logs` table)**
   - Extended with data snapshot columns
   - Used by data flow debug panel

3. **Workflow Sessions (`workflow_sessions` table)**
   - Extended with layout preferences
   - Auto-layout applied on save

4. **Node Palette (`components/node-palette.tsx`)**
   - Add "Enhanced Filter" node
   - Add "Portfolio Orchestrator" node

5. **Node Config Panel (`components/node-config-panel/index.tsx`)**
   - Enhanced filter config UI
   - Orchestrator config UI

### 9.2 ReactFlow Canvas

**Integration:** Auto-layout and enhanced nodes work with existing ReactFlow setup.

**Changes to Strategy Builder:**
```typescript
// File: app/(dashboard)/strategy-builder/page.tsx

// Add layout toolbar
import { LayoutToolbar } from '@/components/strategy-builder/auto-layout/layout-toolbar';

// Add debug panel trigger
import { DataFlowPanel } from '@/components/strategy-builder/data-flow-panel';

function StrategyBuilderPage() {
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);

  return (
    <div>
      {/* Existing ReactFlow canvas */}
      <ReactFlow nodes={nodes} edges={edges} /* ... */ />

      {/* Add layout toolbar */}
      <LayoutToolbar
        workflowId={workflowId}
        nodes={nodes}
        edges={edges}
        onNodesChange={setNodes}
      />

      {/* Add debug panel */}
      {showDebugPanel && selectedExecutionId && (
        <DataFlowPanel
          executionId={selectedExecutionId}
          open={showDebugPanel}
          onClose={() => setShowDebugPanel(false)}
        />
      )}
    </div>
  );
}
```

### 9.3 AI Copilot Chat

**Integration:** AI Copilot should be aware of new node types and auto-layout.

**Updates to Copilot Prompts:**
```typescript
const COPILOT_SYSTEM_PROMPT = `
Available node types:
- polymarket-stream: Fetch markets from Polymarket
- filter: Filter data (supports multi-condition with AND/OR logic, category filters, tag filters, text search)
- orchestrator: AI portfolio manager for position sizing and risk analysis
- llm-analysis: AI analysis node
- transform: Data transformation
- add-to-watchlist: Add markets to monitoring
// ... other node types

When creating workflows:
1. Use "filter" node for advanced filtering (supports 2-10 conditions)
2. Use "orchestrator" node for position sizing decisions
3. Include layout hints for clean visual organization
4. Prefer fewer nodes with multi-condition filters over many single-condition filters
`;
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

**Enhanced Filter Node:**
- ✅ Field discovery from upstream data
- ✅ Multi-condition evaluation (AND logic)
- ✅ Multi-condition evaluation (OR logic)
- ✅ Category filter matching
- ✅ Tag filter matching (HAS ANY OF, HAS ALL OF)
- ✅ Text search (case-sensitive and case-insensitive)
- ✅ Nested field path extraction
- ✅ Filter failure tracking

**Portfolio Orchestrator:**
- ✅ AI risk analysis prompt rendering
- ✅ Pre-flight checks (capital, heat limit)
- ✅ Risk-reward ratio calculation
- ✅ Position size validation (min/max bounds)
- ✅ Drawdown protection logic
- ✅ Volatility adjustment formula
- ✅ Decision record creation
- ✅ Approval workflow state transitions

**Auto-Layout:**
- ✅ Dagre layout calculation
- ✅ Position application to nodes
- ✅ Alignment tools (left, right, top, bottom)
- ✅ Distribution tools (horizontal, vertical)
- ✅ Grid snap calculation
- ✅ Layout hints parsing

### 10.2 Integration Tests

**Data Flow Trace:**
- ✅ Trace data captured during execution
- ✅ Snapshot size limited to 1000 items
- ✅ Filter failures recorded correctly
- ✅ API endpoint returns complete trace
- ✅ API endpoint returns node-specific trace
- ✅ CSV export generates correct format

**Orchestrator Workflow:**
- ✅ Autonomous mode executes immediately
- ✅ Approval mode creates pending decision
- ✅ Notification sent for pending approval
- ✅ Approval executes trade
- ✅ Rejection updates decision record
- ✅ Size adjustment applied correctly

**Auto-Layout Integration:**
- ✅ Layout calculated on AI workflow creation
- ✅ Re-layout button updates positions
- ✅ Lock toggle prevents auto-layout
- ✅ Layout preferences persisted to database
- ✅ Grid snap applied on node drag

### 10.3 End-to-End Test Scenarios

**Scenario 1: Create and Debug Multi-Condition Filter**
1. User creates workflow with Polymarket Stream node
2. User adds Enhanced Filter node with 3 conditions:
   - category = Politics
   - volume > 100000
   - title contains "Trump"
3. User connects nodes and runs workflow
4. Execution completes with 47 markets passing filter
5. User opens Debug Panel
6. User sees 500 markets in → 47 markets out
7. User clicks on filtered market
8. System shows: "Filtered out because: volume (45000) < 100000"
9. User adjusts filter threshold to 40000
10. User re-runs workflow
11. Filtered market now passes

**Scenario 2: Orchestrator Approval Workflow**
1. User creates workflow with Orchestrator node (Approval Required mode)
2. User configures rules:
   - Max per position: 5%
   - Portfolio heat limit: 50%
   - Risk-reward threshold: 2.0
3. Workflow runs hourly via cron
4. Orchestrator identifies opportunity: Bitcoin $100k market
5. AI analyzes and recommends $325 (risk: 6/10)
6. Pending decision created, notification sent
7. User receives high-priority notification
8. User clicks notification → Approval modal opens
9. User reviews AI reasoning and portfolio impact
10. User adjusts size to $300 using slider
11. User clicks "Approve & Execute"
12. Trade executes on Polymarket for $300
13. Decision history shows approved trade with user adjustment

**Scenario 3: AI Auto-Layout**
1. User opens Strategy Builder
2. User types: "Build a bot for Politics markets with volume >$100k, then analyze with AI, then add to watchlist"
3. AI creates 4 nodes and includes layout hints
4. System auto-applies dagre layout
5. Workflow displays with clean left-to-right flow
6. User manually moves one node down slightly
7. Layout auto-locks to preserve manual edits
8. User adds 5th node (new filter)
9. Workflow looks cluttered
10. User clicks "Re-layout" button
11. All 5 nodes reorganized hierarchically
12. User saves workflow with clean layout

### 10.4 Performance Tests

**Data Flow Panel:**
- ✅ Loads 1000-item trace in <2 seconds
- ✅ Table virtual scrolling maintains 60fps
- ✅ Search/filter on 1000 items in <500ms
- ✅ CSV export of 1000 items in <3 seconds

**Orchestrator AI:**
- ✅ AI analysis completes in <5 seconds (p95)
- ✅ Handles 10 concurrent analyses without timeout
- ✅ Rate limiting prevents API quota exhaustion

**Auto-Layout:**
- ✅ Layout calculation for 50-node workflow in <1 second
- ✅ Re-layout updates canvas in <200ms
- ✅ No visual flicker during layout application

---

## 11. Implementation Plan

### Phase 1: Enhanced Filter Node (Weeks 1-2) - Priority: HIGH

**Week 1: Core Multi-Condition Logic**
- [ ] Create `multi-condition-builder.tsx` component
- [ ] Implement `condition-row.tsx` with field/operator/value selectors
- [ ] Build `field-discovery.ts` for dynamic field extraction
- [ ] Implement `filter-executor-v2.ts` with multi-condition evaluation
- [ ] Add AND/OR logic toggle
- [ ] Write 8 unit tests for filter evaluation

**Week 2: Polymarket-Specific Filters & UI Polish**
- [ ] Implement `category-picker.tsx` component
- [ ] Implement `tag-picker.tsx` with autocomplete
- [ ] Implement `text-search-input.tsx` with options
- [ ] Add real-time validation and error display
- [ ] Add filter preview (formula display)
- [ ] Integrate with node palette and config panel
- [ ] Write 6 integration tests

**Deliverables:**
- Enhanced Filter node available in palette
- Multi-condition builder fully functional
- Category, tag, and text search filters working
- Real-time validation prevents errors
- 14 tests passing

### Phase 2: Data Flow Visualization (Week 3) - Priority: HIGH

**Week 3: Debug Panel & Trace System**
- [ ] Extend `strategy_execution_logs` table with snapshot columns (migration)
- [ ] Implement `trace-collector.ts` for data capture
- [ ] Update node executors to call trace collector
- [ ] Create `data-flow-panel/index.tsx` main component
- [ ] Implement `node-list-view.tsx` with timeline
- [ ] Implement `node-detail-view.tsx` with split-pane tables
- [ ] Implement `item-trace-view.tsx` for item following
- [ ] Build API endpoints: `/api/executions/[id]/trace`
- [ ] Add virtual scrolling for performance
- [ ] Implement CSV export functionality
- [ ] Write 8 integration tests

**Deliverables:**
- Debug panel accessible from execution history
- Complete data flow trace visualization
- Item tracing functional
- CSV export working
- 8 tests passing

### Phase 3: Portfolio Orchestrator (Weeks 4-5) - Priority: MEDIUM

**Week 4: Core Orchestrator Logic**
- [ ] Create `orchestrator_decisions` table (migration)
- [ ] Implement `orchestrator-analysis.ts` AI engine
- [ ] Build orchestrator node executor
- [ ] Implement position sizing formulas (Kelly, risk-parity)
- [ ] Add pre-flight checks and validation
- [ ] Create `orchestrator-node.tsx` component
- [ ] Build `config-panel.tsx` with rule configuration
- [ ] Write 10 unit tests for AI logic

**Week 5: Approval Workflow & UI**
- [ ] Implement approval workflow state machine
- [ ] Create `approval-modal.tsx` component
- [ ] Build notification system integration
- [ ] Implement decision approval/rejection APIs
- [ ] Create `decision-history.tsx` component
- [ ] Add pending decisions badge
- [ ] Integrate with strategy dashboard
- [ ] Write 6 integration tests
- [ ] Write 2 E2E tests for approval flow

**Deliverables:**
- Portfolio Orchestrator node functional
- AI risk analysis working
- Approval workflow complete
- Decision history tracking
- Dashboard integration
- 18 tests passing

### Phase 4: Auto-Layout System (Week 6) - Priority: LOW

**Week 6: Layout Engine & Tools**
- [ ] Install dagre dependencies
- [ ] Extend `workflow_sessions` table with layout columns (migration)
- [ ] Implement `dagre-layout.ts` core algorithm
- [ ] Build `layout-toolbar.tsx` component
- [ ] Implement `re-layout-button.tsx`
- [ ] Implement `lock-toggle.tsx`
- [ ] Build `alignment-tools.tsx` (align/distribute)
- [ ] Implement `grid-snap-toggle.tsx`
- [ ] Create `layout-hints.ts` parser
- [ ] Update AI Copilot to include layout hints
- [ ] Build API endpoints for layout preferences
- [ ] Write 8 integration tests

**Deliverables:**
- Auto-layout on AI workflow creation
- Re-layout button functional
- Alignment/distribution tools working
- Grid snap operational
- Layout preferences persisted
- 8 tests passing

### Timeline Summary

```
Week 1-2: Enhanced Filter Node (18 hours)
  ├─ Week 1: Core logic (9 hours)
  └─ Week 2: UI polish (9 hours)

Week 3: Data Flow Visualization (12 hours)

Week 4-5: Portfolio Orchestrator (20 hours)
  ├─ Week 4: Core logic (10 hours)
  └─ Week 5: Approval workflow (10 hours)

Week 6: Auto-Layout System (10 hours)

Total: 60 hours (6 weeks @ 10 hours/week)
```

### Dependencies

**External:**
- Anthropic Claude API (Sonnet 4.5) - for orchestrator AI
- Dagre layout library - for auto-layout
- TanStack React Table - for data flow tables (already installed)

**Internal:**
- Workflow executor framework (exists)
- ReactFlow canvas (exists)
- Supabase database (exists)
- Node palette system (exists)
- AI Copilot (exists)

---

## 12. Security & Performance

### 12.1 Security Considerations

**Data Snapshot Privacy:**
- ✅ RLS policies on `strategy_execution_logs` ensure users only see own data
- ✅ Snapshots limited to 1000 items to prevent excessive storage
- ✅ No sensitive data (API keys, secrets) stored in snapshots
- ✅ Snapshot data encrypted at rest (Supabase default)

**Orchestrator Decision Security:**
- ✅ RLS policies on `orchestrator_decisions` prevent cross-user access
- ✅ Trade execution requires user approval (in approval mode)
- ✅ AI reasoning logged for audit trail
- ✅ User can override AI recommendations

**AI API Security:**
- ✅ AI API keys stored in environment variables (not in code)
- ✅ Rate limiting on orchestrator API (max 100 requests/hour/user)
- ✅ Input validation prevents prompt injection
- ✅ AI responses validated against schema (Zod)

### 12.2 Performance Optimizations

**Data Flow Panel:**
- ✅ Virtual scrolling for tables (TanStack Virtual)
- ✅ Pagination (50 items per page default)
- ✅ Debounced search (300ms)
- ✅ Lazy loading of node details
- ✅ JSONB indexes on snapshot columns
- ✅ Worker thread for CSV export (large datasets)

**Orchestrator AI:**
- ✅ Streaming AI responses (show progress)
- ✅ Cache similar market analyses (5-minute TTL)
- ✅ Timeout protection (10-second max)
- ✅ Fallback to rule-based sizing if AI fails
- ✅ Batch API calls when possible

**Auto-Layout:**
- ✅ Layout calculation throttled (max once per second)
- ✅ Debounced re-layout on drag (500ms)
- ✅ Layout applied in single batch (no incremental updates)
- ✅ Position changes trigger single ReactFlow update
- ✅ Layout hints pre-calculated by AI (not on client)

### 12.3 Rate Limits

**API Endpoints:**
- `POST /api/orchestrator/analyze`: 100 requests/hour/user
- `GET /api/executions/[id]/trace`: 500 requests/hour/user
- `POST /api/workflows/[id]/auto-layout`: 50 requests/hour/user
- `GET /api/orchestrator/decisions`: 1000 requests/hour/user

**Database Constraints:**
- Max snapshot size: 1000 items per node
- Max execution logs: 10,000 per workflow (auto-archive old)
- Max pending decisions: 100 per workflow (auto-reject after 24h)

### 12.4 Error Handling

**Enhanced Filter:**
- ❌ Field doesn't exist → Show suggestion ("Did you mean X?")
- ❌ Type mismatch → Show error inline ("Cannot use > on string field")
- ❌ Invalid value → Highlight and prevent save
- ❌ Upstream data missing → Show warning, allow save (will error on execution)

**Data Flow Panel:**
- ❌ Trace data not found → Show "No trace data available. Re-run workflow to capture."
- ❌ Snapshot size exceeded → Show "Partial data (first 1000 items)"
- ❌ Export fails → Retry 3 times, then show error with download link

**Orchestrator:**
- ❌ AI API timeout → Fallback to rule-based sizing
- ❌ AI API error → Log error, notify user, skip trade
- ❌ Insufficient capital → Reject with clear message
- ❌ Trade execution fails → Log error, retry 3 times, notify user

**Auto-Layout:**
- ❌ Layout algorithm fails → Fallback to manual positioning
- ❌ Circular dependencies → Detect and break cycle
- ❌ Invalid layout config → Reset to defaults

---

## 13. Future Enhancements (Post-MVP)

### Phase 5: Advanced Features (Weeks 7-10)
- Grouped conditions with nested logic: `(A AND B) OR (C AND D)`
- Time-travel debugging (scrub through execution timeline)
- Side-by-side execution comparison
- Visual diff highlighting in data tables
- Filter templates/presets library
- Custom AI models selection (Claude vs GPT-4)
- Backtesting for position sizing rules

### Phase 6: Portfolio Coordination (Weeks 11-14)
- Multi-strategy portfolio coordination
- Cross-strategy risk limits
- Portfolio rebalancing recommendations
- Machine learning for position sizing
- Predictive analytics for strategy performance

### Phase 7: Advanced Layout (Weeks 15-16)
- Visual grouping/containers for nodes
- Multiple layout algorithms (force-directed, circular, tree)
- Layout animations/transitions
- Custom layout hints in AI prompts
- Layout templates library

---

## Appendix A: Database Schema DDL (Complete)

See Section 4.3 for complete SQL DDL statements:
- `20251027000000_add_data_flow_traces.sql`
- `20251027000001_create_orchestrator_decisions.sql`
- `20251027000002_add_layout_preferences.sql`

---

## Appendix B: API Endpoint Reference

See Section 4.4 for complete API specifications:
- Orchestrator APIs (4 endpoints)
- Data Flow APIs (3 endpoints)
- Auto-Layout APIs (2 endpoints)

---

## Appendix C: Component Hierarchy

```
app/(dashboard)/strategy-builder/page.tsx
├─ ReactFlow (existing)
├─ LayoutToolbar
│  ├─ ReLayoutButton
│  ├─ LockToggle
│  ├─ AlignmentTools
│  ├─ DistributeTools
│  └─ GridSnapToggle
├─ NodePalette (existing, extended)
│  ├─ EnhancedFilterNode
│  └─ OrchestratorNode
├─ NodeConfigPanel (existing, extended)
│  ├─ EnhancedFilterConfig
│  │  ├─ MultiConditionBuilder
│  │  │  ├─ ConditionRow (x N)
│  │  │  │  ├─ FieldSelector
│  │  │  │  ├─ OperatorSelector
│  │  │  │  ├─ ValueInput
│  │  │  │  │  ├─ CategoryPicker
│  │  │  │  │  ├─ TagPicker
│  │  │  │  │  └─ TextSearchInput
│  │  │  │  └─ RemoveButton
│  │  │  ├─ LogicToggle (AND/OR)
│  │  │  ├─ AddConditionButton
│  │  │  ├─ FilterPreview
│  │  │  └─ ValidationErrors
│  └─ OrchestratorConfig
│     ├─ PositionSizingRules
│     ├─ RiskToleranceSlider
│     └─ ModeToggle (Autonomous/Approval)
└─ DataFlowPanel
   ├─ PanelHeader
   ├─ NodeListView
   │  ├─ FlowDiagram
   │  └─ NodeTimeline
   ├─ NodeDetailView
   │  ├─ DataTable (Input)
   │  ├─ DataTable (Output)
   │  ├─ FilterFailuresSection
   │  └─ ExportButton
   └─ ItemTraceView
      ├─ Breadcrumb
      ├─ FlowDiagramHighlight
      └─ TraceDetails

components/strategy-dashboard/
├─ OrchestratorDecisionHistory
├─ PendingDecisionsBadge
└─ ApprovalModal
   ├─ MarketSummary
   ├─ AIRecommendation
   ├─ PositionSizeControl
   └─ PortfolioImpact
```

---

## Appendix D: Key Files to Create/Modify

### New Files (48 total)

**Enhanced Filter Node:**
1. `components/strategy-builder/enhanced-filter-node/filter-node-v2.tsx`
2. `components/strategy-builder/enhanced-filter-node/multi-condition-builder.tsx`
3. `components/strategy-builder/enhanced-filter-node/condition-row.tsx`
4. `components/strategy-builder/enhanced-filter-node/field-selector.tsx`
5. `components/strategy-builder/enhanced-filter-node/operator-selector.tsx`
6. `components/strategy-builder/enhanced-filter-node/value-input.tsx`
7. `components/strategy-builder/enhanced-filter-node/category-picker.tsx`
8. `components/strategy-builder/enhanced-filter-node/tag-picker.tsx`
9. `components/strategy-builder/enhanced-filter-node/text-search-input.tsx`
10. `lib/utils/field-discovery.ts`
11. `lib/utils/filter-evaluation.ts`
12. `lib/workflow/node-executors/filter-executor-v2.ts`

**Data Flow Panel:**
13. `components/strategy-builder/data-flow-panel/index.tsx`
14. `components/strategy-builder/data-flow-panel/debug-panel-layout.tsx`
15. `components/strategy-builder/data-flow-panel/node-list-view.tsx`
16. `components/strategy-builder/data-flow-panel/node-detail-view.tsx`
17. `components/strategy-builder/data-flow-panel/data-table.tsx`
18. `components/strategy-builder/data-flow-panel/item-trace-view.tsx`
19. `components/strategy-builder/data-flow-panel/flow-diagram-highlight.tsx`
20. `components/strategy-builder/data-flow-panel/export-button.tsx`
21. `lib/workflow/node-executors/trace-collector.ts`
22. `lib/utils/export-csv.ts`
23. `app/api/executions/[id]/trace/route.ts`
24. `app/api/executions/[id]/trace/[nodeId]/route.ts`
25. `app/api/executions/[id]/export/route.ts`

**Portfolio Orchestrator:**
26. `components/strategy-builder/orchestrator-node/orchestrator-node.tsx`
27. `components/strategy-builder/orchestrator-node/config-panel.tsx`
28. `components/strategy-builder/orchestrator-node/position-sizing-rules.tsx`
29. `components/strategy-builder/orchestrator-node/risk-tolerance-slider.tsx`
30. `components/strategy-builder/orchestrator-node/approval-modal.tsx`
31. `components/strategy-builder/orchestrator-node/decision-history.tsx`
32. `components/strategy-builder/orchestrator-node/pending-decisions-badge.tsx`
33. `lib/ai/orchestrator-analysis.ts`
34. `lib/workflow/node-executors/orchestrator-executor.ts`
35. `app/api/orchestrator/analyze/route.ts`
36. `app/api/orchestrator/decisions/route.ts`
37. `app/api/orchestrator/decisions/[id]/approve/route.ts`
38. `app/api/orchestrator/decisions/[id]/reject/route.ts`

**Auto-Layout:**
39. `components/strategy-builder/auto-layout/layout-toolbar.tsx`
40. `components/strategy-builder/auto-layout/re-layout-button.tsx`
41. `components/strategy-builder/auto-layout/lock-toggle.tsx`
42. `components/strategy-builder/auto-layout/alignment-tools.tsx`
43. `components/strategy-builder/auto-layout/grid-snap-toggle.tsx`
44. `components/strategy-builder/auto-layout/layout-settings.tsx`
45. `lib/workflow/layout/dagre-layout.ts`
46. `lib/workflow/layout/layout-hints.ts`
47. `lib/workflow/layout/layout-persistence.ts`
48. `lib/workflow/layout/alignment-tools.ts`
49. `app/api/workflows/[id]/auto-layout/route.ts`
50. `app/api/workflows/[id]/layout-preferences/route.ts`

**Database Migrations:**
51. `supabase/migrations/20251027000000_add_data_flow_traces.sql`
52. `supabase/migrations/20251027000001_create_orchestrator_decisions.sql`
53. `supabase/migrations/20251027000002_add_layout_preferences.sql`

**Tests:**
54-90. Various test files for components and utilities

### Modified Files (6 total)

1. `app/(dashboard)/strategy-builder/page.tsx` - Add layout toolbar and debug panel
2. `components/node-palette.tsx` - Add Enhanced Filter and Orchestrator nodes
3. `components/node-config-panel/index.tsx` - Add config UIs for new nodes
4. `lib/workflow/executor.ts` - Register new node executors
5. `components/workflow-editor/ConversationalChat.tsx` - Update AI prompts with new node types
6. `package.json` - Add dagre dependency

---

## Summary

This specification provides a complete, actionable plan for implementing four major enhancements to CASCADIAN's Strategy Builder:

1. **Enhanced Filter Node**: Multi-condition filtering with Polymarket-specific filters (category, tags, text search)
2. **Data Flow Visualization**: Debug panel for tracing data through workflows and understanding filter decisions
3. **Portfolio Orchestrator**: AI-powered position sizing and risk management with approval workflow
4. **Auto-Layout System**: Intelligent workflow organization using dagre algorithm

**Total Scope:**
- 53 new files
- 6 modified files
- 3 database migrations
- 48+ tests
- 6 weeks implementation timeline
- 60 hours total effort

**Key Technical Decisions:**
- Use Dagre for layout (not ELKjs) - simpler, lighter weight
- Use Claude Sonnet 4.5 for orchestrator AI - best reasoning capabilities
- Store max 1000 items per snapshot - balance between debuggability and performance
- Support both autonomous and approval modes for orchestrator - flexibility for different risk tolerances
- Lock layout by default after manual edits - prevent accidental re-layout

**Success Metrics:**
- 70%+ adoption of enhanced filters within 30 days
- 50%+ users interact with debug panel after first failed execution
- 80%+ orchestrator recommendations accepted (high AI trust)
- <5% workflows manually re-laid out after AI auto-layout

All specifications align with CASCADIAN's existing architecture and coding standards. Ready for implementation by general-purpose agent.

---

**End of Specification Document**
