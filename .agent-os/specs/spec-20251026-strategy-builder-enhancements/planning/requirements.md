# Requirements: Strategy Builder Enhancements

**Feature**: Advanced Filtering, Data Flow Visualization, AI Portfolio Management, and Intelligent Layouts
**Date**: 2025-10-26
**Status**: Planning

---

## Executive Summary

Enhance CASCADIAN's Strategy Builder with four major capabilities that transform it from a basic visual workflow tool into a sophisticated, AI-powered trading strategy platform with advanced debugging, intelligent filtering, portfolio-aware decision-making, and clean visual organization.

---

## User Story

**As a** CASCADIAN strategy creator
**I want** advanced filtering, data flow visualization, AI portfolio management, and clean workflow layouts
**So that** I can build sophisticated trading strategies, understand exactly how data flows through my logic, make intelligent position-sizing decisions, and maintain organized, readable workflows

---

## Core Requirements

### 1. Enhanced Filter Node with Multi-Conditions

**Description**: Upgrade the current single-condition filter node to support multiple filter conditions with AND/OR logic

**Current State**:
- Filter node only supports ONE condition (e.g., `omega_ratio > 1.5`)
- Field names are hard-coded, user doesn't know what fields are available
- No support for Polymarket-specific filtering (categories, tags)
- No text search capabilities

**Requirements**:
- **Multi-condition support**: Users can add 2-10 filter conditions in a single node
- **AND/OR logic**: Choose between AND (all conditions must match) or OR (any condition matches)
- **Grouped conditions**: Ability to group conditions with nested logic (e.g., `(A AND B) OR (C AND D)`)
- **Dynamic field discovery**: Dropdown showing ALL available fields from upstream node output
- **Field type awareness**: System detects field types (number, string, array, date) and suggests appropriate operators
- **Real-time validation**: Show errors before execution (e.g., "field doesn't exist", "type mismatch")

**New Filter Types**:
1. **Field-based filters** (existing, but enhanced):
   - Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `IN`, `NOT IN`, `CONTAINS`, `BETWEEN`
   - Support for nested field paths (e.g., `analytics.roi`)

2. **Category filters** (new):
   - Polymarket has predefined categories: Politics, Crypto, Sports, Pop Culture, Science, etc.
   - Filter type: "Category"
   - Operator: `IS`, `IS NOT`, `IN`, `NOT IN`
   - Value: Dropdown of Polymarket categories

3. **Tag filters** (new):
   - Markets have tags (e.g., "election", "bitcoin", "trump", "AI")
   - Filter type: "Tag"
   - Operator: `HAS`, `DOES NOT HAVE`, `HAS ANY OF`, `HAS ALL OF`
   - Value: Multi-select tag picker with autocomplete

4. **Text search filters** (new):
   - Search in market title/question
   - Filter type: "Text Search"
   - Operator: `CONTAINS`, `DOES NOT CONTAIN`, `STARTS WITH`, `ENDS WITH`
   - Options: Case-sensitive toggle

**UI/UX Improvements**:
- **Condition builder interface**:
  - Each condition on separate row with visual hierarchy
  - AND/OR toggle buttons between conditions
  - + Add Condition button
  - × Remove button per condition
  - Drag handles to reorder conditions

- **Field selector**:
  - Searchable dropdown with all available fields
  - Grouped by source (e.g., "Market Data", "Analytics", "Metadata")
  - Shows field type icon (# for numbers, "T" for text, [] for arrays)
  - Displays sample value from data

- **Value input**:
  - Smart input based on field type:
    - Numbers: Number input with +/- buttons
    - Text: Text input with autocomplete
    - Arrays: Multi-select dropdown
    - Dates: Date picker
    - Booleans: Toggle switch

**Acceptance Criteria**:
- User can create filter with 5+ conditions
- AND/OR logic works correctly
- Field dropdown shows all fields from upstream data
- Category filter works with Polymarket categories
- Tag filter supports multi-select
- Text search finds markets with matching words in title
- Real-time validation prevents invalid configurations
- Filter node executor handles all new filter types

---

### 2. Data Flow Visualization Panel

**Description**: Create a debug panel that visualizes how data flows through each node in the workflow, showing exactly which items pass through and which get filtered out

**User Flow**:
1. User runs a strategy (or views past execution)
2. User clicks "Debug" button (or "View Data Flow" on completed execution)
3. Side panel or modal opens showing:
   - List of all nodes in execution order
   - For each node:
     - Input data count (e.g., "100 markets")
     - Output data count (e.g., "23 markets passed filter")
     - Items added/removed
     - Execution time

4. User clicks on a node to see detailed view:
   - **Input Data Table**: Shows all input items
   - **Output Data Table**: Shows all output items
   - **Diff View**: Highlights added (green) and removed (red) items
   - **Condition Results**: For filters, shows which condition failed for filtered-out items

5. User clicks on specific market/item in input table:
   - System highlights that item's path through ALL subsequent nodes
   - Shows color-coded line: green if passed, red if filtered out
   - Displays "why filtered out" tooltip on nodes that filtered it

**Requirements**:

**Data Capture During Execution**:
- Extend `strategy_execution_logs` table to store data snapshots
- Capture for each node:
  - Input data (JSONB snapshot, limit to first 1000 items)
  - Output data (JSONB snapshot)
  - Items added (array of IDs)
  - Items removed (array of IDs)
  - Execution duration

**Debug Panel UI**:
- **Layout**: Side panel (default) or full-screen modal (toggle)
- **Node List View**:
  - Vertical timeline of nodes
  - Visual flow diagram (simplified ReactFlow)
  - Click node to see details

- **Node Detail View**:
  - Split pane: Input table | Output table
  - Column headers: Show all fields with sortable columns
  - Pagination: 50 items per page
  - Search/filter within table
  - Export to CSV

- **Item Tracing**:
  - Click item to "follow through workflow"
  - Highlight path on flow diagram
  - Show breadcrumb trail: "Market ABC → Filter Node → Transform Node → Watchlist"
  - Display filter failure reasons: "Filtered out by: volume < 100000"

**Interactive Features**:
- Toggle between "All items" and "Filtered items only"
- Time-travel: Scrub through execution timeline
- Compare: Side-by-side comparison of two executions

**Acceptance Criteria**:
- Debug panel opens from execution history
- Shows data at each node in workflow
- User can click item to trace its path
- Shows why items were filtered out
- Performance: Handles workflows with 1000+ items without lag
- Export functionality works

---

### 3. Portfolio Manager / Orchestrator Node

**Description**: AI-powered node that acts as a portfolio manager, analyzing potential trades and making intelligent position-sizing decisions based on portfolio constraints and risk parameters

**Concept**:
This is the "brain" of autonomous trading strategies. Instead of blindly executing every signal, the orchestrator evaluates each opportunity in the context of:
- Current portfolio state
- Available capital
- Risk tolerance
- Position sizing rules
- Historical performance

**Node Configuration**:

**Basic Settings**:
- **Portfolio size**: Total capital available (e.g., $10,000)
- **Risk tolerance**: Slider from 1 (conservative) to 10 (aggressive)
- **Operating mode**:
  - ✅ Autonomous (execute immediately)
  - ✅ Approval required (send notification, wait for confirmation)
  - Toggle per strategy

**Position Sizing Rules**:
1. **Max % per position**: Don't risk more than X% on single bet
   - Example: "No more than 5% of portfolio per trade"
   - Input: Percentage slider (1-20%)

2. **Absolute bet limits**:
   - Min bet size: $5 (prevents dust trades)
   - Max bet size: $500 (cap on any single position)

3. **Portfolio heat limit**: Total exposure across all open positions
   - Example: "Don't exceed 50% total portfolio deployed"
   - Input: Percentage slider (10-100%)

4. **Risk-reward ratio threshold**:
   - Only take bets where potential reward / potential risk > X
   - Example: "Only bet if R:R ratio > 2:1"
   - Input: Number input (1.0-10.0)

5. **Drawdown protection**:
   - If portfolio down X%, reduce bet sizes by Y%
   - Example: "If down 10%, cut bet sizes in half"
   - Input: Drawdown % and reduction %

6. **Volatility adjustment**:
   - Scale position size based on market uncertainty
   - Use market liquidity, volume, and odds stability as proxies
   - Formula: `base_size * (1 / volatility_score)`

**AI Risk Analysis Engine**:

**Input to AI**:
```json
{
  "market": {
    "question": "Will Bitcoin reach $100k by end of 2024?",
    "category": "Crypto",
    "volume_24h": 250000,
    "liquidity": 50000,
    "current_odds": { "yes": 0.65, "no": 0.35 },
    "created_at": "2024-01-15",
    "end_date": "2024-12-31"
  },
  "portfolio": {
    "total_capital": 10000,
    "deployed_capital": 3500,
    "available_capital": 6500,
    "open_positions": 7,
    "recent_pnl": -150,
    "win_rate_7d": 0.42
  },
  "strategy_signal": {
    "direction": "YES",
    "confidence": 0.75,
    "reasoning": "High volume, strong whale activity, positive sentiment"
  },
  "rules": {
    "max_per_position": 0.05,
    "min_bet": 5,
    "max_bet": 500,
    "risk_reward_threshold": 2.0
  }
}
```

**AI Prompt**:
> "You are a professional portfolio manager for prediction market trading. Analyze this opportunity and recommend a position size.
>
> Consider:
> - Current portfolio state and available capital
> - Market quality (volume, liquidity)
> - Risk-reward ratio for this bet
> - Position sizing best practices
> - User's risk tolerance and rules
>
> Provide:
> 1. Go/No-Go decision
> 2. Recommended bet size (if Go)
> 3. Risk score (1-10)
> 4. Brief reasoning (2-3 sentences)"

**AI Output**:
```json
{
  "decision": "GO",
  "recommended_size": 325,
  "risk_score": 6,
  "reasoning": "Market has strong fundamentals with high volume ($250k) and liquidity. At 65% odds, risk-reward is favorable (2.5:1). Recommended 3.25% of portfolio ($325) - within risk tolerance but below max 5% to account for current 7 open positions.",
  "confidence": 0.82
}
```

**Approval Workflow** (if mode = "Approval Required"):
1. Orchestrator analyzes opportunity
2. Creates `orchestrator_decisions` record with status='pending'
3. Sends high-priority notification to user:
   - Title: "Trade approval needed: Bitcoin $100k"
   - Message: "Recommended: BUY YES for $325 (risk: 6/10)"
   - Actions: [Approve] [Reject] [Adjust Size]
4. User clicks notification → Opens modal with:
   - Market details
   - AI reasoning
   - Recommended size with slider to adjust
   - [Approve] [Reject] buttons
5. On approve: Execute trade, update decision status
6. On reject: Skip trade, log rejection reason

**Acceptance Criteria**:
- Orchestrator node appears in node palette
- Configuration panel includes all position sizing rules
- AI analyzes market + portfolio and returns decision
- Autonomous mode executes trades immediately (within rules)
- Approval mode sends notification and waits
- User can approve/reject/adjust from notification
- Decisions logged in `orchestrator_decisions` table
- Respects all position sizing constraints
- Dashboard shows orchestrator decisions history

---

### 4. Intelligent Workflow Layout

**Description**: Automatically organize nodes in clean, hierarchical layouts when AI Copilot creates workflows, with manual override capability

**Current Problem**:
- AI Copilot creates nodes but positions them randomly or in a line
- Workflows look "tangled" with crossing edges
- No visual hierarchy showing data flow direction
- Hard to understand workflow logic at a glance

**Requirements**:

**Auto-Layout Engine**:
- **Library**: Use `dagre` (lightweight) or `elkjs` (more powerful)
- **Layout algorithm**: Hierarchical (left-to-right or top-to-bottom)
- **Ranking**: Nodes ranked by depth in workflow:
  - Depth 0: Data source nodes (leftmost)
  - Depth 1: First-level filters/transforms
  - Depth 2: Second-level logic
  - Depth N: Final actions (rightmost)

**Layout Configuration**:
```typescript
{
  direction: 'LR', // Left-to-right (or TB for top-bottom)
  rankSeparation: 150, // Horizontal spacing between ranks
  nodeSeparation: 80, // Vertical spacing between nodes
  edgeSeparation: 20, // Spacing between edges
  align: 'UL', // Alignment (UL = up-left)
}
```

**Visual Hierarchy**:
- **Critical path highlighted**: Thicker edges for main data flow
- **Grouping**: Visually group related nodes (e.g., all filters in "Data Prep" section)
- **Minimap**: Update minimap to show hierarchy colors

**AI Copilot Integration**:
- When AI creates workflow, include layout hints in response:
  ```json
  {
    "nodes": [...],
    "edges": [...],
    "layout_hints": {
      "importance_ranking": {
        "node-1": 1, // Most important
        "node-2": 2,
        "node-3": 1
      },
      "groupings": [
        {
          "name": "Data Preparation",
          "nodes": ["node-1", "node-2"]
        },
        {
          "name": "Decision Logic",
          "nodes": ["node-3", "node-4"]
        }
      ]
    }
  }
  ```

- Auto-apply layout after workflow creation
- Show toast: "Auto-layout applied. Click 'Re-layout' to fix manually edited workflows."

**Manual Override System**:
- **Lock toggle**: Padlock icon in toolbar
  - Locked (default): Auto-layout disabled, manual positioning persists
  - Unlocked: Auto-layout can run

- **Re-layout button**:
  - Icon: Grid/organize icon
  - Tooltip: "Auto-organize workflow"
  - Runs layout algorithm on current workflow

- **Alignment tools** (in toolbar):
  - Align Left/Right/Top/Bottom
  - Distribute Horizontally/Vertically
  - All operate on selected nodes

- **Grid snap**:
  - Toggle: "Snap to grid" checkbox
  - Grid size: 20px
  - Visual grid overlay (faint dots)

**Persistence**:
- Node positions saved in `workflow_sessions.workflow_data`
- Layout lock state saved per workflow
- Layout preferences (direction, spacing) saved per user

**Acceptance Criteria**:
- Auto-layout runs when AI creates workflow
- Workflows have clean, hierarchical appearance
- No crossing edges (minimize)
- Manual positioning persists when locked
- Re-layout button fixes tangled workflows
- Alignment tools work on selected nodes
- Grid snap helps with manual positioning

---

## User Flows

### Flow 1: Create Advanced Filter

1. User drags "Filter" node onto canvas
2. User clicks node to open config panel
3. Config panel shows condition builder:
   - Row 1: [Field dropdown ▼] [Operator ▼] [Value input] [× Remove]
   - [+ Add Condition] button
4. User clicks "+ Add Condition"
5. New row appears with AND/OR toggle
6. User selects "Category" from field type dropdown
7. System shows category-specific UI: [Category dropdown ▼]
8. User selects "Politics"
9. User adds another condition: "volume > 100000"
10. User adds text search condition: "title contains 'Trump'"
11. Filter preview shows: `(category = Politics) AND (volume > 100000) AND (title contains 'Trump')`
12. User saves configuration
13. Filter node displays summary: "3 conditions (AND)"

### Flow 2: Debug Data Flow

1. User runs strategy, execution completes
2. User clicks "Debug" button in execution history
3. Debug panel slides in from right
4. Panel shows node list:
   - Polymarket Stream: 500 markets in → 500 markets out
   - Filter Node: 500 markets in → 47 markets out (-453 filtered)
   - Add to Watchlist: 47 markets in → 47 added
5. User clicks "Filter Node" row
6. Detail view opens showing:
   - Input table: 500 markets (sortable, searchable)
   - Output table: 47 markets (green highlight)
   - Filtered out: 453 markets (red highlight)
7. User clicks on filtered market "Will Biden win 2024?"
8. System shows: "Filtered out because: volume (45000) < 100000"
9. User can see this market didn't proceed to watchlist

### Flow 3: Orchestrator Approves Trade

1. Strategy executes, identifies opportunity: "Bitcoin $100k by end of year"
2. Orchestrator node analyzes:
   - Portfolio: $10k total, $3.5k deployed, $6.5k available
   - Signal: BUY YES at 65% odds
   - Applies rules: max 5% per trade = $500 max
3. AI evaluates:
   - Volume: $250k (good)
   - Liquidity: $50k (good)
   - Risk-reward: 2.5:1 (above 2.0 threshold)
   - Recommendation: GO for $325 (3.25%)
4. Mode = "Approval Required"
5. System sends notification: "Trade approval: Bitcoin $100k - $325 recommended"
6. User clicks notification
7. Modal shows:
   - Market: Bitcoin $100k by end of year
   - Direction: BUY YES
   - Current odds: 65%
   - AI reasoning: "Strong fundamentals, favorable R:R"
   - Recommended size: $325
   - Slider to adjust (range: $5-$500)
   - Risk score: 6/10
8. User clicks [Approve]
9. Trade executes for $325
10. Dashboard shows orchestrator decision in history

### Flow 4: AI Auto-Layouts Workflow

1. User opens Strategy Builder
2. User types in AI chat: "Build a bot that finds Politics markets with volume >$100k and high whale activity, then adds to watchlist"
3. AI creates workflow:
   - Node 1: Polymarket Stream (Politics)
   - Node 2: Filter (volume > 100k)
   - Node 3: Filter (whale activity > 70)
   - Node 4: Add to Watchlist
4. AI includes layout hints: Node 1 at depth 0, Nodes 2-3 at depth 1, Node 4 at depth 2
5. System auto-applies dagre layout:
   - Nodes arranged left-to-right
   - Stream on left, Watchlist on right
   - Filters in middle, vertically aligned
   - Clean spacing, no overlap
6. User sees clean, organized workflow
7. User manually adjusts Node 3 position slightly
8. System auto-locks layout (preserves manual edits)
9. User adds new filter node later
10. User clicks "Re-layout" button to reorganize
11. Workflow re-organized with new node in correct position

---

## Technical Architecture

### Database Schema Changes

```sql
-- Extend execution logs for data snapshots
ALTER TABLE strategy_execution_logs
ADD COLUMN input_snapshot JSONB,
ADD COLUMN output_snapshot JSONB,
ADD COLUMN items_added TEXT[],
ADD COLUMN items_removed TEXT[],
ADD COLUMN filter_failures JSONB; -- {"market-123": "volume < 100000", ...}

CREATE INDEX idx_execution_logs_snapshots ON strategy_execution_logs(execution_id)
WHERE input_snapshot IS NOT NULL;

-- Orchestrator decisions table
CREATE TABLE orchestrator_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workflow_sessions(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'pending')),
  recommended_size NUMERIC NOT NULL,
  actual_size NUMERIC, -- If approved but user adjusted
  risk_score NUMERIC CHECK (risk_score BETWEEN 1 AND 10),
  ai_reasoning TEXT,
  user_override BOOLEAN DEFAULT FALSE,
  override_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX idx_orchestrator_decisions_pending ON orchestrator_decisions(workflow_id, created_at DESC)
WHERE decision = 'pending';

-- RLS policies
ALTER TABLE orchestrator_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY orchestrator_decisions_user_policy ON orchestrator_decisions
FOR ALL
USING (
  workflow_id IN (
    SELECT id FROM workflow_sessions WHERE user_id = auth.uid()
  )
);
```

### API Endpoints

**Orchestrator APIs**:
- `POST /api/orchestrator/analyze` - AI risk analysis
  - Input: Market data, portfolio state, rules
  - Output: Decision, recommended size, risk score, reasoning

- `POST /api/orchestrator/decisions/[id]/approve` - Approve pending decision
  - Input: Optional size adjustment
  - Output: Trade execution confirmation

- `POST /api/orchestrator/decisions/[id]/reject` - Reject pending decision
  - Input: Optional rejection reason
  - Output: Confirmation

- `GET /api/orchestrator/decisions?workflow_id=X` - Get decision history
  - Output: Array of decisions with pagination

**Data Flow APIs**:
- `GET /api/executions/[id]/trace` - Get full data flow trace
  - Output: Node-by-node data snapshots

- `GET /api/executions/[id]/trace/[node_id]` - Get specific node trace
  - Output: Input/output data for single node

**Layout APIs**:
- `POST /api/workflows/[id]/auto-layout` - Calculate auto-layout
  - Input: Current nodes and edges
  - Output: New node positions

### Component Structure

```
components/
├── filter-builder/
│   ├── condition-row.tsx           # Single filter condition
│   ├── field-selector.tsx          # Smart field dropdown
│   ├── operator-selector.tsx       # Operator dropdown (type-aware)
│   ├── value-input.tsx             # Smart value input
│   ├── multi-condition-builder.tsx # Main filter builder
│   └── category-picker.tsx         # Polymarket category selector
│
├── data-flow-panel/
│   ├── index.tsx                   # Main debug panel
│   ├── node-list-view.tsx          # Timeline of nodes
│   ├── node-detail-view.tsx        # Detailed node inspection
│   ├── data-table.tsx              # Sortable/filterable table
│   ├── item-trace-view.tsx         # Follow specific item
│   └── flow-diagram.tsx            # Visual flow with highlighting
│
├── orchestrator-config/
│   ├── index.tsx                   # Main config panel
│   ├── position-sizing-rules.tsx   # Rule configuration
│   ├── risk-tolerance-slider.tsx   # Risk level selector
│   ├── approval-modal.tsx          # Trade approval UI
│   └── decision-history.tsx        # Past decisions table
│
└── strategy-nodes/
    ├── filter-node-v2.tsx          # Enhanced filter node
    └── orchestrator-node.tsx       # Portfolio manager node
```

### Library Additions

```json
{
  "dependencies": {
    "dagre": "^0.8.5",               // Auto-layout algorithm
    "@dagrejs/dagre": "^1.1.0",      // Modern dagre wrapper
    "elkjs": "^0.9.0",               // Alternative layout engine
    "react-table": "^8.0.0",         // Advanced tables for debug panel
    "@tanstack/react-table": "^8.0.0" // Modern React Table
  }
}
```

---

## Implementation Phases

### Phase 1: Enhanced Filter Node (Week 1-2)
**Agent**: general-purpose
**Deliverables**:
- Multi-condition builder UI
- Field discovery system
- Category/tag filter support
- Text search filters
- Updated executor logic
- 8-10 tests

### Phase 2: Data Flow Visualization (Week 3)
**Agent**: general-purpose
**Deliverables**:
- Execution trace capture system
- Debug panel UI
- Node detail views
- Item tracing
- 6-8 tests

### Phase 3: Portfolio Orchestrator (Week 4-5)
**Agent**: general-purpose (with AI SDK integration)
**Deliverables**:
- Orchestrator node type
- Position sizing rules engine
- AI risk analysis integration
- Approval workflow
- Decision history
- 10-12 tests

### Phase 4: Auto-Layout System (Week 6)
**Agent**: general-purpose
**Deliverables**:
- Dagre integration
- Auto-layout function
- AI Copilot layout hints
- Manual override tools
- 6-8 tests

---

## Success Criteria

**Enhanced Filter**:
- ✅ User can add 5+ conditions in one node
- ✅ Field dropdown shows all available fields from upstream
- ✅ Category and tag filtering works
- ✅ Text search finds markets correctly
- ✅ Real-time validation prevents errors

**Data Flow Visualization**:
- ✅ Debug panel shows node-by-node data
- ✅ User can trace individual items through workflow
- ✅ Shows why items were filtered out
- ✅ Handles 1000+ items without performance issues

**Orchestrator**:
- ✅ AI makes intelligent position sizing decisions
- ✅ Respects all user-defined rules
- ✅ Approval workflow works smoothly
- ✅ Dashboard shows decision history

**Auto-Layout**:
- ✅ AI-generated workflows have clean layouts
- ✅ No crossing edges (minimal)
- ✅ Manual positioning persists
- ✅ Re-layout button reorganizes tangled workflows

---

## Open Questions

1. Should debug panel be persisted across sessions or ephemeral?
2. What's the max data snapshot size we should store per node? (currently: 1000 items)
3. For orchestrator, should we support custom AI models (Claude vs GPT-4)?
4. Should auto-layout be configurable (LR vs TB, spacing)?
5. Do we need export functionality for orchestrator decisions? (CSV/PDF report)

---

## Dependencies

- Existing autonomous execution system (Task Groups 1-7 from previous spec)
- OpenAI or Anthropic API for orchestrator AI
- ReactFlow library (already in use)
- Dagre or ELKjs for auto-layout
- React Table for data visualization

---

## Risks & Mitigations

**Risk 1: Performance with Large Data Snapshots**
- Mitigation: Limit snapshots to first 1000 items, paginate in UI, use JSONB indexes

**Risk 2: AI Analysis Latency**
- Mitigation: Show loading state, cache similar market analyses, use streaming responses

**Risk 3: Complex Filter Logic Bugs**
- Mitigation: Comprehensive test suite, formula validation, dry-run mode

**Risk 4: Layout Algorithm Complexity**
- Mitigation: Start with simple dagre, fallback to manual if layout fails, allow user to disable

---

**Status**: Ready for spec writing
**Next Step**: Use spec-writer agent to create detailed spec.md
