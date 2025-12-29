# Strategy Builder V2 Specification

> **Status:** Draft
> **Author:** Claude + Scotty
> **Date:** 2025-12-07
> **Goal:** YAML-first strategy definition with visual node editor as UI layer

---

## Executive Summary

Redesign the Strategy Builder to use YAML as the canonical strategy format. The visual node editor becomes a UI layer that reads/writes YAML. Users can switch between visual and code modes seamlessly. AI can generate strategies by producing valid YAML.

### Key Principles

1. **YAML is truth** - Strategies are defined in YAML, nodes are a visualization
2. **Bidirectional sync** - Edit YAML → nodes update, drag nodes → YAML updates
3. **AI-native** - Claude can write strategies as YAML without understanding React Flow
4. **Reduced node types** - Consolidate 17 nodes → 8 core nodes
5. **Clear data flow** - Each node category has one purpose

---

## Part 1: Node Consolidation

### Current State (17 nodes)

| Category | Nodes | Issues |
|----------|-------|--------|
| Data | DATA_SOURCE | Overly generic |
| Filtering | FILTER, ENHANCED_FILTER, WALLET_FILTER, MARKET_FILTER | 4 overlapping nodes |
| Processing | LOGIC, AGGREGATION | Fine |
| Signals | SIGNAL | Fine |
| Actions | ACTION, add-to-watchlist | Redundant |
| Market Intel | MARKET_UNIVERSE, MARKET_MONITOR | Unclear flow |
| Copy Trading | COPY_TRADE_WATCH, MANUAL_COPY_TRADE | WATCH is dead code |
| Position Mgmt | POSITION_TRACKER, EXIT_SIGNAL | Fine |
| Portfolio | ORCHESTRATOR | Overloaded |
| Alerts | ALERT, PERFORMANCE_STATS | Fine |

### Proposed State (8 nodes)

| Node | Purpose | Replaces |
|------|---------|----------|
| **SOURCE** | Define data source (wallets, markets, positions) | DATA_SOURCE |
| **FILTER** | Filter data with conditions (single or multi) | FILTER, ENHANCED_FILTER, WALLET_FILTER, MARKET_FILTER |
| **TRANSFORM** | Aggregate, compute, reshape data | LOGIC, AGGREGATION |
| **SIGNAL** | Generate trading signals | SIGNAL |
| **COPY_TRADE** | Watch wallets + execute consensus trades | COPY_TRADE_WATCH, MANUAL_COPY_TRADE |
| **POSITION** | Track positions + exit rules | POSITION_TRACKER, EXIT_SIGNAL |
| **ACTION** | Execute actions (alert, webhook, watchlist) | ACTION, add-to-watchlist |
| **DASHBOARD** | Display metrics + charts | MARKET_UNIVERSE, MARKET_MONITOR, ALERT, PERFORMANCE_STATS, ORCHESTRATOR (display) |

### Removed/Deprecated

- `COPY_TRADE_WATCH` - Dead code, merged into COPY_TRADE
- `add-to-watchlist` - Merged into ACTION
- `MARKET_UNIVERSE` - Merged into DASHBOARD
- `MARKET_MONITOR` - Merged into DASHBOARD
- `ALERT` - Merged into DASHBOARD
- `PERFORMANCE_STATS` - Merged into DASHBOARD
- `ORCHESTRATOR` - Split: display → DASHBOARD, sizing logic → COPY_TRADE/POSITION

---

## Part 2: YAML Schema

### Strategy Document Structure

```yaml
# strategy.yaml
version: "2.0"
metadata:
  id: "strat_abc123"
  name: "Smart Money Copy Trade"
  description: "Copy top 10% PnL wallets with 2-wallet consensus"
  author: "scotty"
  created: "2025-12-07T10:00:00Z"
  updated: "2025-12-07T10:00:00Z"
  tags: ["copy-trade", "smart-money"]

settings:
  mode: "paper"  # paper | live
  bankroll_usd: 10000
  max_position_pct: 5
  schedule: "*/5 * * * *"  # cron expression, null for manual

nodes:
  - id: "wallets"
    type: "SOURCE"
    config:
      source: "wallets"
      table: "wallet_metrics_complete"

  - id: "top_wallets"
    type: "FILTER"
    inputs: ["wallets"]
    config:
      conditions:
        - field: "pnl_percentile"
          op: "gte"
          value: 90
        - field: "trade_count_30d"
          op: "gte"
          value: 10
      logic: "AND"
      limit: 50

  - id: "copy_engine"
    type: "COPY_TRADE"
    inputs: ["top_wallets"]
    config:
      consensus_mode: "two_agree"
      min_notional_usd: 100
      max_copy_usd: 500
      dry_run: true

  - id: "positions"
    type: "POSITION"
    inputs: ["copy_engine"]
    config:
      exit_rules:
        price_target_pct: 20
        stop_loss_pct: 10
        follow_wallet_exits: true

  - id: "alerts"
    type: "ACTION"
    inputs: ["copy_engine", "positions"]
    config:
      actions:
        - type: "alert"
          on: "consensus_triggered"
          priority: "high"
        - type: "alert"
          on: "exit_triggered"
          priority: "medium"

  - id: "dashboard"
    type: "DASHBOARD"
    inputs: ["top_wallets", "copy_engine", "positions"]
    config:
      widgets:
        - type: "wallet_list"
          title: "Tracked Wallets"
        - type: "position_table"
          title: "Open Positions"
        - type: "pnl_chart"
          title: "P&L Over Time"
        - type: "alert_feed"
          title: "Recent Alerts"
```

### Node Type Schemas

#### SOURCE Node

```yaml
type: "SOURCE"
config:
  source: "wallets" | "markets" | "positions" | "trades"

  # For wallets
  table: "wallet_metrics_complete"

  # For markets
  status: "open" | "closed" | "all"
  tags: ["politics", "sports"]

  # For positions
  strategy_id: "strat_abc123"  # optional, defaults to current
```

#### FILTER Node

```yaml
type: "FILTER"
inputs: ["source_node_id"]
config:
  conditions:
    - field: "pnl_30d"
      op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "in" | "between" | "percentile_gte"
      value: 1000
      # For percentile
      percentile: 90
      # For between
      min: 100
      max: 1000
      # For in
      values: ["a", "b", "c"]

  logic: "AND" | "OR"
  limit: 50

  # Sorting
  sort:
    field: "pnl_30d"
    order: "desc"
```

#### TRANSFORM Node

```yaml
type: "TRANSFORM"
inputs: ["node_a", "node_b"]  # Can have multiple inputs
config:
  operation: "aggregate" | "join" | "compute" | "group"

  # For aggregate
  aggregate:
    function: "count" | "sum" | "avg" | "min" | "max" | "median"
    field: "pnl_30d"

  # For join (boolean logic on multiple inputs)
  join:
    mode: "AND" | "OR" | "NOT" | "XOR"

  # For compute (add calculated fields)
  compute:
    - name: "roi"
      expression: "pnl_30d / total_invested"
    - name: "risk_score"
      expression: "volatility * leverage"

  # For group
  group:
    by: "category"
    aggregate:
      function: "sum"
      field: "volume"
```

#### SIGNAL Node

```yaml
type: "SIGNAL"
inputs: ["filter_node"]
config:
  signal_type: "entry" | "exit" | "hold"
  direction: "yes" | "no" | "both"
  strength: "weak" | "moderate" | "strong"

  # Conditions that trigger signal
  trigger:
    conditions:
      - field: "wallet_count"
        op: "gte"
        value: 3
    logic: "AND"
```

#### COPY_TRADE Node

```yaml
type: "COPY_TRADE"
inputs: ["wallet_source"]
config:
  # Wallet selection (can override input or use input directly)
  wallets_csv: "0x123...,0x456..."  # Optional manual override

  # Consensus rules
  consensus_mode: "any" | "two_agree" | "n_of_m" | "all"
  n_required: 2  # For n_of_m mode

  # Trade filters
  min_notional_usd: 100
  max_copy_usd: 500

  # Execution
  dry_run: true
  enable_logging: true

  # Optional market filter
  allowed_markets: ["condition_id_1", "condition_id_2"]
  blocked_markets: []
  market_tags: ["politics"]  # Only copy trades in these categories
```

#### POSITION Node

```yaml
type: "POSITION"
inputs: ["copy_trade_node"]
config:
  # Display settings
  show_closed: false
  show_resolved: true

  # Exit rules
  exit_rules:
    price_target_pct: 20      # Exit at +20%
    stop_loss_pct: 10         # Exit at -10%
    trailing_stop_pct: null   # Trailing stop (optional)
    follow_wallet_exits: true # Exit when source wallets exit
    max_hold_hours: null      # Time-based exit (optional)

  # Position sizing (moved from Orchestrator)
  sizing:
    mode: "fixed" | "kelly" | "risk_parity"
    fixed_usd: 100
    kelly_fraction: 0.25
    max_position_pct: 5
```

#### ACTION Node

```yaml
type: "ACTION"
inputs: ["signal_node", "position_node"]
config:
  actions:
    - type: "alert"
      on: "signal_generated" | "consensus_triggered" | "position_opened" | "exit_triggered" | "position_resolved"
      priority: "low" | "medium" | "high" | "critical"
      channels: ["in_app", "email", "webhook"]

    - type: "webhook"
      on: "position_opened"
      url: "https://hooks.example.com/trade"
      method: "POST"
      headers:
        Authorization: "Bearer ${WEBHOOK_TOKEN}"

    - type: "watchlist"
      on: "signal_generated"
      watchlist_id: "smart_money_picks"
      reason: "Smart money signal"

    - type: "log"
      on: "any"
      level: "info" | "debug"
```

#### DASHBOARD Node

```yaml
type: "DASHBOARD"
inputs: ["wallets", "positions", "copy_engine"]
config:
  layout: "grid" | "stack"  # Widget arrangement

  widgets:
    - type: "metric"
      title: "Total P&L"
      source: "positions"
      field: "total_pnl"
      format: "currency"

    - type: "metric"
      title: "Win Rate"
      source: "positions"
      field: "win_rate"
      format: "percent"

    - type: "wallet_list"
      title: "Tracked Wallets"
      source: "wallets"
      columns: ["address", "pnl_30d", "win_rate", "trade_count"]
      limit: 10

    - type: "position_table"
      title: "Open Positions"
      source: "positions"
      filter: "status = 'open'"
      columns: ["market", "side", "entry_price", "current_price", "pnl"]

    - type: "pnl_chart"
      title: "P&L Over Time"
      source: "positions"
      period: "7d"
      granularity: "1h"

    - type: "alert_feed"
      title: "Recent Alerts"
      limit: 20
      priority_filter: ["high", "critical"]

    - type: "market_monitor"
      title: "Market Prices"
      source: "markets"
      show_sparkline: true
      poll_interval_seconds: 60
```

---

## Part 3: Visual ↔ YAML Sync

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Strategy Builder UI                       │
├─────────────────────────────┬───────────────────────────────┤
│      Visual Editor          │         YAML Editor           │
│  ┌─────────────────────┐    │    ┌─────────────────────┐    │
│  │   React Flow Canvas │    │    │   Monaco Editor     │    │
│  │   (drag/drop nodes) │    │    │   (syntax highlight)│    │
│  └──────────┬──────────┘    │    └──────────┬──────────┘    │
│             │               │               │               │
│             ▼               │               ▼               │
│  ┌─────────────────────┐    │    ┌─────────────────────┐    │
│  │ nodeGraphToYaml()   │◄───┼───►│ yamlToNodeGraph()   │    │
│  └──────────┬──────────┘    │    └──────────┬──────────┘    │
│             │               │               │               │
│             └───────────────┴───────────────┘               │
│                             │                               │
│                             ▼                               │
│                  ┌─────────────────────┐                    │
│                  │   Strategy YAML     │                    │
│                  │   (canonical truth) │                    │
│                  └──────────┬──────────┘                    │
│                             │                               │
└─────────────────────────────┼───────────────────────────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │   Strategy Engine   │
                   │   (executes YAML)   │
                   └─────────────────────┘
```

### Conversion Functions

```typescript
// lib/strategy-builder/yaml-converter.ts

interface StrategyYaml {
  version: string;
  metadata: StrategyMetadata;
  settings: StrategySettings;
  nodes: YamlNode[];
}

interface YamlNode {
  id: string;
  type: NodeType;
  inputs?: string[];
  config: Record<string, unknown>;
}

interface NodeGraph {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
}

// Visual → YAML
function nodeGraphToYaml(
  graph: NodeGraph,
  metadata: StrategyMetadata,
  settings: StrategySettings
): string {
  // 1. Topologically sort nodes by edges
  // 2. Convert each ReactFlow node to YamlNode
  // 3. Derive inputs[] from edges
  // 4. Stringify to YAML with nice formatting
}

// YAML → Visual
function yamlToNodeGraph(yaml: string): {
  graph: NodeGraph;
  metadata: StrategyMetadata;
  settings: StrategySettings;
} {
  // 1. Parse YAML
  // 2. Validate against schema
  // 3. Create ReactFlow nodes with auto-layout positions
  // 4. Create edges from inputs[] references
}

// Validation
function validateStrategyYaml(yaml: string): {
  valid: boolean;
  errors: ValidationError[];
} {
  // 1. Parse YAML syntax
  // 2. Validate against JSON Schema
  // 3. Check node type configs
  // 4. Verify edge references exist
  // 5. Check for cycles
}
```

### UI Toggle

```tsx
// Strategy Builder with mode toggle
function StrategyBuilder() {
  const [mode, setMode] = useState<"visual" | "yaml">("visual");
  const [yaml, setYaml] = useState<string>("");
  const [graph, setGraph] = useState<NodeGraph>({ nodes: [], edges: [] });

  // Sync visual → yaml when graph changes
  useEffect(() => {
    if (mode === "visual") {
      const newYaml = nodeGraphToYaml(graph, metadata, settings);
      setYaml(newYaml);
    }
  }, [graph, mode]);

  // Sync yaml → visual when switching modes
  const handleModeSwitch = (newMode: "visual" | "yaml") => {
    if (newMode === "visual" && mode === "yaml") {
      const validation = validateStrategyYaml(yaml);
      if (!validation.valid) {
        toast.error("Invalid YAML - fix errors before switching");
        return;
      }
      const { graph: newGraph } = yamlToNodeGraph(yaml);
      setGraph(newGraph);
    }
    setMode(newMode);
  };

  return (
    <div>
      <ModeToggle value={mode} onChange={handleModeSwitch} />

      {mode === "visual" ? (
        <ReactFlowCanvas graph={graph} onChange={setGraph} />
      ) : (
        <YamlEditor value={yaml} onChange={setYaml} />
      )}
    </div>
  );
}
```

---

## Part 4: AI Strategy Generation

### Prompt Template

When a user asks Claude to create a strategy, provide this context:

```
You are generating a Cascadian trading strategy in YAML format.

Available node types:
- SOURCE: Load data (wallets, markets, positions)
- FILTER: Filter with conditions (gt, lt, eq, in, percentile_gte)
- TRANSFORM: Aggregate, join, compute fields
- SIGNAL: Generate trading signals
- COPY_TRADE: Copy wallet trades with consensus
- POSITION: Track positions with exit rules
- ACTION: Alerts, webhooks, watchlist
- DASHBOARD: Display widgets

Rules:
1. Each node needs unique id (snake_case)
2. inputs[] references other node ids
3. First node has no inputs (it's a SOURCE)
4. All referenced nodes must exist
5. No circular dependencies

Example: [provide the smart money example from above]

User request: "{user_request}"

Generate valid YAML:
```

### AI Integration

```typescript
// lib/strategy-builder/ai-generator.ts

async function generateStrategyFromPrompt(
  userPrompt: string
): Promise<{ yaml: string; explanation: string }> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "user",
        content: buildPrompt(userPrompt),
      },
    ],
  });

  // Extract YAML from response
  const yaml = extractYamlFromResponse(response.content);

  // Validate
  const validation = validateStrategyYaml(yaml);
  if (!validation.valid) {
    // Ask AI to fix errors
    return retryWithErrors(userPrompt, yaml, validation.errors);
  }

  return { yaml, explanation: extractExplanation(response.content) };
}
```

---

## Part 5: Implementation Plan

### Phase 1: YAML Foundation (Week 1)

1. **Define JSON Schema for YAML validation**
   - Create `lib/strategy-builder/schema/strategy-v2.schema.json`
   - Define all node type configs
   - Add validation helpers

2. **Build YAML ↔ NodeGraph converters**
   - `nodeGraphToYaml()` function
   - `yamlToNodeGraph()` function
   - Auto-layout algorithm for imported YAML

3. **Update Strategy storage**
   - Store YAML as canonical format in DB
   - Migrate existing strategies to YAML

### Phase 2: Node Consolidation (Week 2)

4. **Create new consolidated nodes**
   - SOURCE node (combine data sources)
   - FILTER node (unified filtering)
   - TRANSFORM node (logic + aggregation)
   - COPY_TRADE node (merge watch + execute)
   - POSITION node (tracker + exit rules)
   - ACTION node (alerts + webhooks + watchlist)
   - DASHBOARD node (all display widgets)

5. **Deprecate old nodes**
   - Hide from palette
   - Keep for backward compatibility
   - Auto-migrate to new types

### Phase 3: Visual/YAML Toggle (Week 3)

6. **Add YAML editor panel**
   - Monaco editor integration
   - Syntax highlighting for YAML
   - Real-time validation

7. **Implement mode toggle**
   - Visual ↔ YAML switch button
   - Sync on mode change
   - Error handling for invalid YAML

### Phase 4: AI Generation (Week 4)

8. **Build AI strategy generator**
   - Prompt engineering
   - YAML extraction
   - Validation loop

9. **Integrate into UI**
   - "Generate with AI" button
   - Natural language input
   - Preview before applying

### Phase 5: Polish & Migration (Week 5)

10. **Migration tooling**
    - Convert existing strategies
    - Backwards compatibility layer
    - User documentation

11. **Testing & refinement**
    - E2E tests for YAML round-trip
    - Edge case handling
    - Performance optimization

---

## Part 6: Example Strategies

### 1. Smart Money Copy Trade

```yaml
version: "2.0"
metadata:
  name: "Smart Money Copy Trade"
  description: "Copy top PnL wallets with consensus"

settings:
  mode: "paper"
  bankroll_usd: 10000

nodes:
  - id: "wallets"
    type: "SOURCE"
    config:
      source: "wallets"

  - id: "top_pnl"
    type: "FILTER"
    inputs: ["wallets"]
    config:
      conditions:
        - field: "pnl_percentile"
          op: "gte"
          value: 90
      limit: 20

  - id: "copy"
    type: "COPY_TRADE"
    inputs: ["top_pnl"]
    config:
      consensus_mode: "two_agree"
      dry_run: true

  - id: "positions"
    type: "POSITION"
    inputs: ["copy"]
    config:
      exit_rules:
        price_target_pct: 25
        stop_loss_pct: 15
```

### 2. Market Screener

```yaml
version: "2.0"
metadata:
  name: "High Volume Politics"
  description: "Screen politics markets with high volume"

settings:
  mode: "paper"
  schedule: "0 */6 * * *"  # Every 6 hours

nodes:
  - id: "markets"
    type: "SOURCE"
    config:
      source: "markets"
      status: "open"

  - id: "politics"
    type: "FILTER"
    inputs: ["markets"]
    config:
      conditions:
        - field: "tags"
          op: "in"
          values: ["politics", "elections"]
        - field: "volume_24h"
          op: "gte"
          value: 100000
      logic: "AND"
      limit: 20

  - id: "display"
    type: "DASHBOARD"
    inputs: ["politics"]
    config:
      widgets:
        - type: "market_monitor"
          title: "Politics Markets"
          show_sparkline: true
```

### 3. Signal Generator

```yaml
version: "2.0"
metadata:
  name: "Whale Alert"
  description: "Signal when multiple whales buy same market"

settings:
  mode: "paper"

nodes:
  - id: "whales"
    type: "SOURCE"
    config:
      source: "wallets"

  - id: "big_wallets"
    type: "FILTER"
    inputs: ["whales"]
    config:
      conditions:
        - field: "total_volume"
          op: "gte"
          value: 1000000
      limit: 100

  - id: "watch"
    type: "COPY_TRADE"
    inputs: ["big_wallets"]
    config:
      consensus_mode: "n_of_m"
      n_required: 3
      dry_run: true  # Signal only, no execution

  - id: "alert"
    type: "ACTION"
    inputs: ["watch"]
    config:
      actions:
        - type: "alert"
          on: "consensus_triggered"
          priority: "critical"
        - type: "webhook"
          on: "consensus_triggered"
          url: "https://hooks.slack.com/..."
```

---

## Appendix A: Migration Guide

### Converting Old Strategies

```typescript
// Automatic migration for common patterns
function migrateV1ToV2(oldStrategy: V1Strategy): string {
  const nodes: YamlNode[] = [];

  for (const oldNode of oldStrategy.nodeGraph.nodes) {
    switch (oldNode.type) {
      case "DATA_SOURCE":
        nodes.push(convertDataSource(oldNode));
        break;
      case "FILTER":
      case "ENHANCED_FILTER":
      case "WALLET_FILTER":
      case "MARKET_FILTER":
        nodes.push(convertToUnifiedFilter(oldNode));
        break;
      case "LOGIC":
      case "AGGREGATION":
        nodes.push(convertToTransform(oldNode));
        break;
      case "COPY_TRADE_WATCH":
      case "MANUAL_COPY_TRADE":
        nodes.push(convertToCopyTrade(oldNode));
        break;
      // ... etc
    }
  }

  return yaml.stringify({ version: "2.0", nodes, ... });
}
```

---

## Appendix B: JSON Schema

Full JSON Schema for validation available at:
`/lib/strategy-builder/schema/strategy-v2.schema.json`

---

## Open Questions

1. **Backward compatibility** - How long do we support V1 node types?
2. **YAML storage** - Store as text blob or parsed JSON in DB?
3. **Real-time collaboration** - Support multiple editors on same strategy?
4. **Version control** - Git-like history for strategy changes?
5. **Marketplace** - Allow users to share/sell strategies as YAML?

---

## Next Steps

1. [ ] Review and approve this spec
2. [ ] Create JSON Schema for validation
3. [ ] Build YAML converter functions
4. [ ] Create new consolidated node components
5. [ ] Add YAML editor to UI
6. [ ] Implement AI generation
7. [ ] Write migration tooling
8. [ ] Update documentation
