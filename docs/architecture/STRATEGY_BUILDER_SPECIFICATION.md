# CASCADIAN Strategy Builder Specification
**Version**: 1.0
**Date**: 2025-10-25
**Status**: Design Specification
**Related Docs**:
- `DATABASE_ARCHITECT_SPEC.md` (102 metrics, 11 strategies)
- `CASCADIAN_COMPLETE_SCHEMA_V1.md` (database schema)
- `CASCADIAN_MOMENTUM_STRATEGY_ADDENDUM.md` (TSI momentum)

---

## Executive Summary

The Strategy Builder is a visual, node-based system for creating sophisticated trading strategies and wallet screening filters. It connects to real data sources (ClickHouse + Supabase) and supports:

- **11 Predefined Strategies**: Eggman Hunter, Aggressive Growth, etc. (from DATABASE_ARCHITECT_SPEC.md)
- **Custom Strategies**: User-created combinations of filters and logic
- **TSI Momentum Integration**: Austin's momentum strategy as building blocks
- **Real-Time Data**: No mock data - streams from WebSocket + database
- **Visual Interface**: Drag-and-drop node editor

**Key Requirement**: Everything must be flexible enough to support ANY filter/strategy combination without code changes.

---

## Table of Contents

1. [Node Type System](#1-node-type-system)
2. [Database Schema for Strategies](#2-database-schema-for-strategies)
3. [Strategy Execution Engine](#3-strategy-execution-engine)
4. [Real Data Integration](#4-real-data-integration)
5. [Example Strategies](#5-example-strategies)
6. [UI/UX Specifications](#6-uiux-specifications)
7. [Implementation Plan](#7-implementation-plan)

---

## 1. Node Type System

### 1.1 Core Node Types

**Six fundamental node types** that can combine to create any strategy:

```typescript
type NodeType =
  | 'DATA_SOURCE'      // Input: wallets, markets, trades
  | 'FILTER'           // Condition: metric > value
  | 'LOGIC'            // Combine: AND/OR/NOT
  | 'AGGREGATION'      // Math: count, sum, avg, min, max
  | 'SIGNAL'           // Output: entry/exit conditions
  | 'ACTION'           // Output: add to watchlist, alert, etc.
```

### 1.2 DATA_SOURCE Nodes

**Purpose**: Define what data to operate on

```typescript
interface DataSourceNode {
  type: 'DATA_SOURCE';
  id: string;
  config: {
    source: 'WALLETS' | 'MARKETS' | 'TRADES' | 'SIGNALS' | 'CATEGORIES';

    // Optional prefilters (performance optimization)
    prefilters?: {
      table: string;           // e.g., 'wallet_scores'
      where?: string;          // SQL WHERE clause
      limit?: number;
    };

    // Real-time or batch
    mode: 'REALTIME' | 'BATCH';

    // Refresh interval (for realtime)
    refreshMs?: number;       // e.g., 10000 (10 seconds)
  };
}
```

**Examples**:
```typescript
// All elite wallets (omega >= 2.0)
{
  type: 'DATA_SOURCE',
  id: 'elite_wallets',
  config: {
    source: 'WALLETS',
    prefilters: {
      table: 'wallet_scores',
      where: 'omega_ratio >= 2.0 AND closed_positions >= 10'
    },
    mode: 'BATCH'
  }
}

// Watchlist markets with momentum
{
  type: 'DATA_SOURCE',
  id: 'watchlist_markets',
  config: {
    source: 'MARKETS',
    prefilters: {
      table: 'watchlist_markets',
      where: 'is_active = true'
    },
    mode: 'REALTIME',
    refreshMs: 10000
  }
}

// Recent momentum signals
{
  type: 'DATA_SOURCE',
  id: 'recent_signals',
  config: {
    source: 'SIGNALS',
    prefilters: {
      table: 'momentum_trading_signals',
      where: 'signal_timestamp >= now() - INTERVAL 1 HOUR',
      limit: 100
    },
    mode: 'REALTIME',
    refreshMs: 60000
  }
}
```

### 1.3 FILTER Nodes

**Purpose**: Apply conditions to data

```typescript
interface FilterNode {
  type: 'FILTER';
  id: string;
  config: {
    // What metric/field to filter on
    field: string;              // e.g., 'omega_ratio', 'tsi_fast', 'win_rate'

    // Operator
    operator:
      | 'EQUALS'
      | 'NOT_EQUALS'
      | 'GREATER_THAN'
      | 'GREATER_THAN_OR_EQUAL'
      | 'LESS_THAN'
      | 'LESS_THAN_OR_EQUAL'
      | 'IN'
      | 'NOT_IN'
      | 'CONTAINS'
      | 'BETWEEN'
      | 'IS_NULL'
      | 'IS_NOT_NULL';

    // Value(s) to compare against
    value: any;                 // number, string, array, etc.

    // Optional: Category-specific filter
    categorySpecific?: {
      enabled: boolean;
      category: string;
    };
  };
}
```

**Examples**:
```typescript
// Omega ratio >= 3.0 (S-grade)
{
  type: 'FILTER',
  id: 'omega_s_grade',
  config: {
    field: 'omega_ratio',
    operator: 'GREATER_THAN_OR_EQUAL',
    value: 3.0
  }
}

// Win rate > 60%
{
  type: 'FILTER',
  id: 'high_win_rate',
  config: {
    field: 'win_rate',
    operator: 'GREATER_THAN',
    value: 0.6
  }
}

// Category is AI or Crypto
{
  type: 'FILTER',
  id: 'tech_categories',
  config: {
    field: 'category',
    operator: 'IN',
    value: ['AI', 'Crypto']
  }
}

// TSI bullish crossover
{
  type: 'FILTER',
  id: 'tsi_bullish',
  config: {
    field: 'crossover_signal',
    operator: 'EQUALS',
    value: 'BULLISH'
  }
}

// Directional conviction >= 0.9 (Austin's threshold)
{
  type: 'FILTER',
  id: 'high_conviction',
  config: {
    field: 'directional_conviction',
    operator: 'GREATER_THAN_OR_EQUAL',
    value: 0.9
  }
}

// Category-specific: S-grade in AI only
{
  type: 'FILTER',
  id: 'ai_specialist',
  config: {
    field: 'omega_ratio',
    operator: 'GREATER_THAN_OR_EQUAL',
    value: 3.0,
    categorySpecific: {
      enabled: true,
      category: 'AI'
    }
  }
}
```

### 1.4 LOGIC Nodes

**Purpose**: Combine multiple conditions

```typescript
interface LogicNode {
  type: 'LOGIC';
  id: string;
  config: {
    operator: 'AND' | 'OR' | 'NOT' | 'XOR';

    // Input nodes (can be filters or other logic nodes)
    inputs: string[];           // Node IDs
  };
}
```

**Examples**:
```typescript
// Elite AND high win rate
{
  type: 'LOGIC',
  id: 'elite_winners',
  config: {
    operator: 'AND',
    inputs: ['omega_s_grade', 'high_win_rate']
  }
}

// Bullish TSI OR high conviction
{
  type: 'LOGIC',
  id: 'entry_signal',
  config: {
    operator: 'OR',
    inputs: ['tsi_bullish', 'high_conviction']
  }
}

// NOT in Politics category
{
  type: 'LOGIC',
  id: 'no_politics',
  config: {
    operator: 'NOT',
    inputs: ['politics_category_filter']
  }
}
```

### 1.5 AGGREGATION Nodes

**Purpose**: Calculate metrics across filtered data

```typescript
interface AggregationNode {
  type: 'AGGREGATION';
  id: string;
  config: {
    function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'PERCENTILE' | 'STDEV';

    // Field to aggregate (for SUM/AVG/MIN/MAX)
    field?: string;

    // For PERCENTILE
    percentile?: number;        // e.g., 95 for P95

    // Group by (optional)
    groupBy?: string[];         // e.g., ['category']
  };
}
```

**Examples**:
```typescript
// Count elite wallets
{
  type: 'AGGREGATION',
  id: 'count_elite',
  config: {
    function: 'COUNT'
  }
}

// Average omega ratio
{
  type: 'AGGREGATION',
  id: 'avg_omega',
  config: {
    function: 'AVG',
    field: 'omega_ratio'
  }
}

// Top 95th percentile ROI
{
  type: 'AGGREGATION',
  id: 'p95_roi',
  config: {
    function: 'PERCENTILE',
    field: 'roi_per_bet',
    percentile: 95
  }
}

// Count elite wallets by category
{
  type: 'AGGREGATION',
  id: 'elite_by_category',
  config: {
    function: 'COUNT',
    groupBy: ['category']
  }
}
```

### 1.6 SIGNAL Nodes

**Purpose**: Generate trading signals (ENTRY/EXIT/HOLD)

```typescript
interface SignalNode {
  type: 'SIGNAL';
  id: string;
  config: {
    signalType: 'ENTRY' | 'EXIT' | 'HOLD';

    // Condition (logic node ID)
    condition: string;

    // Signal metadata
    direction?: 'YES' | 'NO';   // For ENTRY signals
    strength?: 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG';

    // Optional: Position sizing
    positionSize?: {
      method: 'FIXED' | 'KELLY' | 'OMEGA_WEIGHTED';
      baseAmount?: number;      // For FIXED
    };
  };
}
```

**Examples**:
```typescript
// Entry signal: TSI bullish + high conviction
{
  type: 'SIGNAL',
  id: 'momentum_entry',
  config: {
    signalType: 'ENTRY',
    condition: 'entry_logic',  // AND(tsi_bullish, high_conviction)
    direction: 'YES',
    strength: 'STRONG',
    positionSize: {
      method: 'KELLY',
      baseAmount: 100
    }
  }
}

// Exit signal: TSI bearish crossover
{
  type: 'SIGNAL',
  id: 'momentum_exit',
  config: {
    signalType: 'EXIT',
    condition: 'tsi_bearish'
  }
}
```

### 1.7 ACTION Nodes

**Purpose**: What to do when conditions are met

```typescript
interface ActionNode {
  type: 'ACTION';
  id: string;
  config: {
    action:
      | 'ADD_TO_WATCHLIST'
      | 'REMOVE_FROM_WATCHLIST'
      | 'SEND_ALERT'
      | 'LOG_RESULT'
      | 'EXECUTE_TRADE'      // Future: Auto-trading
      | 'WEBHOOK';

    // Action-specific config
    params?: Record<string, any>;
  };
}
```

**Examples**:
```typescript
// Add to watchlist
{
  type: 'ACTION',
  id: 'add_to_watchlist',
  config: {
    action: 'ADD_TO_WATCHLIST',
    params: {
      watchlistType: 'markets',
      autoRemoveAfter: '7d'
    }
  }
}

// Send alert
{
  type: 'ACTION',
  id: 'send_notification',
  config: {
    action: 'SEND_ALERT',
    params: {
      channels: ['email', 'webhook'],
      priority: 'HIGH',
      message: 'Momentum entry signal detected: {{market_id}}'
    }
  }
}

// Webhook callback
{
  type: 'ACTION',
  id: 'webhook_callback',
  config: {
    action: 'WEBHOOK',
    params: {
      url: 'https://example.com/signals',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer {{api_key}}'
      },
      body: {
        signal: '{{signal}}',
        market: '{{market_id}}',
        timestamp: '{{timestamp}}'
      }
    }
  }
}
```

---

## 2. Database Schema for Strategies

### 2.1 `strategy_definitions` Table (Supabase)

**Purpose**: Store user-created and predefined strategies

```sql
CREATE TABLE IF NOT EXISTS strategy_definitions (
  -- Identity
  strategy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name TEXT NOT NULL,
  strategy_description TEXT,

  -- Type
  strategy_type TEXT NOT NULL CHECK (strategy_type IN ('SCREENING', 'MOMENTUM', 'ARBITRAGE', 'CUSTOM')),
  is_predefined BOOLEAN DEFAULT FALSE,   -- True for 11 predefined strategies

  -- Node Graph (stored as JSON)
  node_graph JSONB NOT NULL,
  /*
  Example structure:
  {
    "nodes": [
      { "type": "DATA_SOURCE", "id": "wallets", "config": {...} },
      { "type": "FILTER", "id": "omega_filter", "config": {...} },
      { "type": "LOGIC", "id": "and_logic", "config": {...} },
      { "type": "SIGNAL", "id": "entry_signal", "config": {...} }
    ],
    "edges": [
      { "from": "wallets", "to": "omega_filter" },
      { "from": "omega_filter", "to": "and_logic" },
      { "from": "and_logic", "to": "entry_signal" }
    ]
  }
  */

  -- Execution Settings
  execution_mode TEXT DEFAULT 'MANUAL' CHECK (execution_mode IN ('MANUAL', 'AUTO', 'SCHEDULED')),
  schedule_cron TEXT,                    -- For SCHEDULED mode
  is_active BOOLEAN DEFAULT TRUE,

  -- Performance Tracking
  total_executions INTEGER DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  avg_execution_time_ms INTEGER,

  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Version Control
  version INTEGER DEFAULT 1,
  parent_strategy_id UUID REFERENCES strategy_definitions(strategy_id)  -- For cloning/forking
);

-- Indexes
CREATE INDEX idx_strategy_type ON strategy_definitions(strategy_type);
CREATE INDEX idx_active_strategies ON strategy_definitions(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_predefined_strategies ON strategy_definitions(is_predefined) WHERE is_predefined = TRUE;
```

### 2.2 `strategy_executions` Table (Supabase)

**Purpose**: Track strategy execution history and results

```sql
CREATE TABLE IF NOT EXISTS strategy_executions (
  -- Identity
  execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,

  -- Execution Context
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('MANUAL', 'AUTO', 'SCHEDULED')),
  triggered_by UUID REFERENCES auth.users(id),

  -- Results (stored as JSON for flexibility)
  results JSONB NOT NULL,
  /*
  Example structure:
  {
    "matched_wallets": ["0x123...", "0x456..."],
    "matched_markets": ["market_123", "market_456"],
    "signals_generated": [
      { "signal_id": "sig_1", "type": "ENTRY", "market_id": "market_123", ... }
    ],
    "aggregations": {
      "total_wallets": 15,
      "avg_omega": 3.2,
      "total_pnl": 12500.50
    }
  }
  */

  -- Performance
  execution_time_ms INTEGER NOT NULL,
  nodes_evaluated INTEGER NOT NULL,
  data_points_processed INTEGER NOT NULL,

  -- Status
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
  error_message TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_strategy_executions_strategy ON strategy_executions(strategy_id, executed_at DESC);
CREATE INDEX idx_strategy_executions_status ON strategy_executions(status);
```

### 2.3 `strategy_node_cache` Table (ClickHouse)

**Purpose**: Cache intermediate node results for performance

```sql
CREATE TABLE IF NOT EXISTS strategy_node_cache (
  -- Identity
  node_id String,
  strategy_id String,
  execution_id String,

  -- Cache Key (hash of inputs)
  cache_key String,

  -- Cached Result (JSON serialized)
  result String,

  -- TTL
  cached_at DateTime64(3) DEFAULT now64(),
  expires_at DateTime64(3),

  -- Metadata
  data_points_count UInt32,
  computation_time_ms UInt32
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(cached_at)
ORDER BY (strategy_id, node_id, cache_key)
TTL expires_at
SETTINGS index_granularity = 8192;
```

---

## 3. Strategy Execution Engine

### 3.1 Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│  1. Load Strategy Definition (node_graph from DB)      │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  2. Build Execution DAG (topological sort)              │
│     - Detect cycles                                     │
│     - Validate node connections                         │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  3. Execute Nodes (depth-first, cached)                 │
│     - DATA_SOURCE → fetch data                          │
│     - FILTER → apply conditions                         │
│     - LOGIC → combine results                           │
│     - AGGREGATION → calculate metrics                   │
│     - SIGNAL → generate signals                         │
│     - ACTION → execute actions                          │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  4. Collect Results & Save Execution Record             │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Strategy Execution Engine Implementation

**File**: `lib/strategy-builder/execution-engine.ts`

```typescript
import { clickhouse } from '@/lib/clickhouse/client';
import { createClient } from '@supabase/supabase-js';

export interface StrategyDefinition {
  strategyId: string;
  strategyName: string;
  nodeGraph: {
    nodes: Node[];
    edges: Edge[];
  };
}

export interface Node {
  type: NodeType;
  id: string;
  config: Record<string, any>;
}

export interface Edge {
  from: string;
  to: string;
}

export interface ExecutionContext {
  strategyId: string;
  executionId: string;
  userId?: string;
  mode: 'MANUAL' | 'AUTO' | 'SCHEDULED';
}

export interface NodeResult {
  nodeId: string;
  data: any;              // Flexible: array, number, object, etc.
  timestamp: Date;
  executionTimeMs: number;
  cached: boolean;
}

export interface StrategyResult {
  executionId: string;
  results: Record<string, NodeResult>;
  aggregations?: Record<string, any>;
  signalsGenerated?: any[];
  actionsExecuted?: any[];
  totalExecutionTimeMs: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  errorMessage?: string;
}

/**
 * Strategy Execution Engine
 * Executes node graphs against real data sources
 */
export class StrategyExecutionEngine {
  private supabase: ReturnType<typeof createClient>;
  private nodeCache: Map<string, NodeResult> = new Map();

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Execute a strategy
   */
  async execute(
    strategy: StrategyDefinition,
    context: ExecutionContext
  ): Promise<StrategyResult> {
    const startTime = Date.now();
    const results: Record<string, NodeResult> = {};

    try {
      // Build execution order (topological sort)
      const executionOrder = this.buildExecutionOrder(strategy.nodeGraph);

      // Execute nodes in order
      for (const nodeId of executionOrder) {
        const node = strategy.nodeGraph.nodes.find(n => n.id === nodeId);
        if (!node) {
          throw new Error(`Node ${nodeId} not found in graph`);
        }

        const nodeResult = await this.executeNode(node, results, context);
        results[nodeId] = nodeResult;
      }

      // Collect aggregations, signals, actions
      const aggregations = this.collectAggregations(results);
      const signalsGenerated = this.collectSignals(results);
      const actionsExecuted = await this.executeActions(results, context);

      // Save execution record
      await this.saveExecutionRecord(context, results, {
        aggregations,
        signalsGenerated,
        actionsExecuted
      });

      return {
        executionId: context.executionId,
        results,
        aggregations,
        signalsGenerated,
        actionsExecuted,
        totalExecutionTimeMs: Date.now() - startTime,
        status: 'SUCCESS'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Save failed execution
      await this.saveExecutionRecord(context, results, {
        status: 'FAILED',
        errorMessage
      });

      return {
        executionId: context.executionId,
        results,
        totalExecutionTimeMs: Date.now() - startTime,
        status: 'FAILED',
        errorMessage
      };
    }
  }

  /**
   * Execute a single node
   */
  private async executeNode(
    node: Node,
    previousResults: Record<string, NodeResult>,
    context: ExecutionContext
  ): Promise<NodeResult> {
    const startTime = Date.now();

    // Check cache first
    const cacheKey = this.getCacheKey(node, previousResults);
    const cached = await this.getFromCache(cacheKey);

    if (cached) {
      return { ...cached, cached: true };
    }

    // Execute based on node type
    let data: any;

    switch (node.type) {
      case 'DATA_SOURCE':
        data = await this.executeDataSource(node);
        break;
      case 'FILTER':
        data = await this.executeFilter(node, previousResults);
        break;
      case 'LOGIC':
        data = await this.executeLogic(node, previousResults);
        break;
      case 'AGGREGATION':
        data = await this.executeAggregation(node, previousResults);
        break;
      case 'SIGNAL':
        data = await this.executeSignal(node, previousResults);
        break;
      case 'ACTION':
        data = await this.executeAction(node, previousResults, context);
        break;
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }

    const result: NodeResult = {
      nodeId: node.id,
      data,
      timestamp: new Date(),
      executionTimeMs: Date.now() - startTime,
      cached: false
    };

    // Cache result
    await this.saveToCache(cacheKey, result);

    return result;
  }

  /**
   * Execute DATA_SOURCE node - fetch from database
   */
  private async executeDataSource(node: Node): Promise<any[]> {
    const { source, prefilters, mode } = node.config;

    // Map source to table
    const tableMap: Record<string, string> = {
      'WALLETS': 'wallet_scores',
      'MARKETS': 'markets',
      'TRADES': 'trades_raw',
      'SIGNALS': 'momentum_trading_signals',
      'CATEGORIES': 'category_analytics'
    };

    const table = tableMap[source];
    if (!table) {
      throw new Error(`Unknown data source: ${source}`);
    }

    // Determine if ClickHouse or Supabase
    const isClickHouse = ['TRADES', 'SIGNALS', 'CATEGORIES'].includes(source);

    if (isClickHouse) {
      // Fetch from ClickHouse
      const query = `
        SELECT *
        FROM ${table}
        ${prefilters?.where ? `WHERE ${prefilters.where}` : ''}
        ${prefilters?.limit ? `LIMIT ${prefilters.limit}` : ''}
      `;

      const result = await clickhouse.query({ query });
      const data = await result.json<any[]>();
      return data;
    } else {
      // Fetch from Supabase
      let query = this.supabase.from(table).select('*');

      if (prefilters?.where) {
        // Parse WHERE clause (simplified - real implementation needs SQL parser)
        query = this.applySupabaseFilters(query, prefilters.where);
      }

      if (prefilters?.limit) {
        query = query.limit(prefilters.limit);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Supabase query failed: ${error.message}`);
      }

      return data || [];
    }
  }

  /**
   * Execute FILTER node - apply condition to data
   */
  private async executeFilter(
    node: Node,
    previousResults: Record<string, NodeResult>
  ): Promise<any[]> {
    const { field, operator, value, categorySpecific } = node.config;

    // Get input data (from connected node)
    const inputData = this.getInputData(node.id, previousResults);

    if (!Array.isArray(inputData)) {
      throw new Error(`Filter node ${node.id} expects array input`);
    }

    // Apply filter
    return inputData.filter(item => {
      // Category-specific filter
      if (categorySpecific?.enabled && item.category !== categorySpecific.category) {
        return false;
      }

      // Get field value
      const fieldValue = this.getFieldValue(item, field);

      // Apply operator
      switch (operator) {
        case 'EQUALS':
          return fieldValue === value;
        case 'NOT_EQUALS':
          return fieldValue !== value;
        case 'GREATER_THAN':
          return fieldValue > value;
        case 'GREATER_THAN_OR_EQUAL':
          return fieldValue >= value;
        case 'LESS_THAN':
          return fieldValue < value;
        case 'LESS_THAN_OR_EQUAL':
          return fieldValue <= value;
        case 'IN':
          return Array.isArray(value) && value.includes(fieldValue);
        case 'NOT_IN':
          return Array.isArray(value) && !value.includes(fieldValue);
        case 'CONTAINS':
          return String(fieldValue).includes(String(value));
        case 'BETWEEN':
          return Array.isArray(value) && fieldValue >= value[0] && fieldValue <= value[1];
        case 'IS_NULL':
          return fieldValue === null || fieldValue === undefined;
        case 'IS_NOT_NULL':
          return fieldValue !== null && fieldValue !== undefined;
        default:
          throw new Error(`Unknown operator: ${operator}`);
      }
    });
  }

  /**
   * Execute LOGIC node - combine conditions
   */
  private async executeLogic(
    node: Node,
    previousResults: Record<string, NodeResult>
  ): Promise<any[]> {
    const { operator, inputs } = node.config;

    // Get input results
    const inputResults = inputs.map((inputId: string) => {
      const result = previousResults[inputId];
      if (!result) {
        throw new Error(`Input node ${inputId} not found`);
      }
      return result.data;
    });

    // Ensure all inputs are arrays
    if (!inputResults.every(r => Array.isArray(r))) {
      throw new Error(`Logic node ${node.id} expects array inputs`);
    }

    // Apply logic operator
    switch (operator) {
      case 'AND':
        // Intersection of all arrays (items present in ALL inputs)
        return this.intersectArrays(inputResults);

      case 'OR':
        // Union of all arrays (items present in ANY input)
        return this.unionArrays(inputResults);

      case 'NOT':
        // Items NOT in first input (requires exactly 1 input)
        if (inputResults.length !== 1) {
          throw new Error('NOT operator requires exactly 1 input');
        }
        // Return empty array (NOT is handled by filtering against another set)
        return [];

      case 'XOR':
        // Items present in exactly one input (exclusive OR)
        return this.xorArrays(inputResults);

      default:
        throw new Error(`Unknown logic operator: ${operator}`);
    }
  }

  /**
   * Execute AGGREGATION node - calculate metrics
   */
  private async executeAggregation(
    node: Node,
    previousResults: Record<string, NodeResult>
  ): Promise<number | Record<string, number>> {
    const { function: aggFunc, field, percentile, groupBy } = node.config;

    // Get input data
    const inputData = this.getInputData(node.id, previousResults);

    if (!Array.isArray(inputData)) {
      throw new Error(`Aggregation node ${node.id} expects array input`);
    }

    // Group by (if specified)
    if (groupBy && groupBy.length > 0) {
      const grouped = this.groupBy(inputData, groupBy);
      const result: Record<string, number> = {};

      for (const [key, items] of Object.entries(grouped)) {
        result[key] = this.calculateAggregation(items, aggFunc, field, percentile);
      }

      return result;
    }

    // Single aggregation
    return this.calculateAggregation(inputData, aggFunc, field, percentile);
  }

  /**
   * Execute SIGNAL node - generate trading signal
   */
  private async executeSignal(
    node: Node,
    previousResults: Record<string, NodeResult>
  ): Promise<any> {
    const { signalType, condition, direction, strength, positionSize } = node.config;

    // Get condition result
    const conditionResult = previousResults[condition];
    if (!conditionResult) {
      throw new Error(`Condition node ${condition} not found`);
    }

    // Condition must evaluate to boolean or non-empty array
    const conditionMet = Array.isArray(conditionResult.data)
      ? conditionResult.data.length > 0
      : Boolean(conditionResult.data);

    if (!conditionMet) {
      return null; // No signal
    }

    // Generate signal
    return {
      signalId: crypto.randomUUID(),
      signalType,
      direction,
      strength: strength || 'MODERATE',
      positionSize,
      timestamp: new Date(),
      conditionData: conditionResult.data
    };
  }

  /**
   * Execute ACTION node - perform action
   */
  private async executeAction(
    node: Node,
    previousResults: Record<string, NodeResult>,
    context: ExecutionContext
  ): Promise<any> {
    const { action, params } = node.config;

    // Get input data
    const inputData = this.getInputData(node.id, previousResults);

    switch (action) {
      case 'ADD_TO_WATCHLIST':
        return await this.addToWatchlist(inputData, params);

      case 'SEND_ALERT':
        return await this.sendAlert(inputData, params, context);

      case 'LOG_RESULT':
        console.log('Strategy result:', inputData);
        return { logged: true };

      case 'WEBHOOK':
        return await this.callWebhook(inputData, params);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // Helper methods (implementation details)

  private buildExecutionOrder(graph: { nodes: Node[]; edges: Edge[] }): string[] {
    // Topological sort implementation
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      // Visit dependencies first
      const dependencies = graph.edges
        .filter(e => e.to === nodeId)
        .map(e => e.from);

      dependencies.forEach(visit);

      order.push(nodeId);
    };

    graph.nodes.forEach(node => visit(node.id));

    return order;
  }

  private getCacheKey(node: Node, previousResults: Record<string, NodeResult>): string {
    // Hash node config + input data
    const inputs = this.getInputIds(node.id);
    const inputHashes = inputs.map(id => {
      const result = previousResults[id];
      return result ? JSON.stringify(result.data) : '';
    });

    return `${node.id}:${JSON.stringify(node.config)}:${inputHashes.join(':')}`;
  }

  private async getFromCache(cacheKey: string): Promise<NodeResult | null> {
    // Check in-memory cache first
    if (this.nodeCache.has(cacheKey)) {
      return this.nodeCache.get(cacheKey)!;
    }

    // Check ClickHouse cache (if TTL not expired)
    // Implementation: Query strategy_node_cache table

    return null;
  }

  private async saveToCache(cacheKey: string, result: NodeResult): Promise<void> {
    // Save to in-memory cache
    this.nodeCache.set(cacheKey, result);

    // Save to ClickHouse cache (with TTL)
    // Implementation: Insert into strategy_node_cache table
  }

  private getInputData(nodeId: string, previousResults: Record<string, NodeResult>): any {
    // Find nodes connected to this node
    // For simplicity, assume single input (real implementation handles multiple)
    const inputIds = this.getInputIds(nodeId);

    if (inputIds.length === 0) {
      return [];
    }

    const inputResult = previousResults[inputIds[0]];
    return inputResult?.data || [];
  }

  private getInputIds(nodeId: string): string[] {
    // Get IDs of nodes that feed into this node
    // This requires access to the graph edges
    // For now, return empty array (real implementation stores graph in class)
    return [];
  }

  private getFieldValue(item: any, field: string): any {
    // Support nested fields with dot notation
    const parts = field.split('.');
    let value = item;

    for (const part of parts) {
      value = value?.[part];
    }

    return value;
  }

  private intersectArrays(arrays: any[][]): any[] {
    if (arrays.length === 0) return [];
    if (arrays.length === 1) return arrays[0];

    // Find items present in ALL arrays
    const first = arrays[0];
    return first.filter(item =>
      arrays.slice(1).every(arr => arr.includes(item))
    );
  }

  private unionArrays(arrays: any[][]): any[] {
    // Combine all arrays, remove duplicates
    const combined = arrays.flat();
    return Array.from(new Set(combined));
  }

  private xorArrays(arrays: any[][]): any[] {
    // Items present in exactly one array
    const counts = new Map<any, number>();

    arrays.forEach(arr => {
      arr.forEach(item => {
        counts.set(item, (counts.get(item) || 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .filter(([_, count]) => count === 1)
      .map(([item, _]) => item);
  }

  private groupBy(data: any[], fields: string[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};

    data.forEach(item => {
      const key = fields.map(f => this.getFieldValue(item, f)).join('|');

      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(item);
    });

    return groups;
  }

  private calculateAggregation(
    data: any[],
    func: string,
    field?: string,
    percentile?: number
  ): number {
    if (data.length === 0) return 0;

    switch (func) {
      case 'COUNT':
        return data.length;

      case 'SUM': {
        if (!field) throw new Error('SUM requires field');
        return data.reduce((sum, item) => sum + (this.getFieldValue(item, field) || 0), 0);
      }

      case 'AVG': {
        if (!field) throw new Error('AVG requires field');
        const sum = data.reduce((s, item) => s + (this.getFieldValue(item, field) || 0), 0);
        return sum / data.length;
      }

      case 'MIN': {
        if (!field) throw new Error('MIN requires field');
        return Math.min(...data.map(item => this.getFieldValue(item, field) || Infinity));
      }

      case 'MAX': {
        if (!field) throw new Error('MAX requires field');
        return Math.max(...data.map(item => this.getFieldValue(item, field) || -Infinity));
      }

      case 'PERCENTILE': {
        if (!field || !percentile) throw new Error('PERCENTILE requires field and percentile');
        const sorted = data
          .map(item => this.getFieldValue(item, field) || 0)
          .sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[index];
      }

      default:
        throw new Error(`Unknown aggregation function: ${func}`);
    }
  }

  private collectAggregations(results: Record<string, NodeResult>): Record<string, any> {
    const aggregations: Record<string, any> = {};

    Object.entries(results).forEach(([nodeId, result]) => {
      if (nodeId.includes('agg_') || typeof result.data === 'number') {
        aggregations[nodeId] = result.data;
      }
    });

    return aggregations;
  }

  private collectSignals(results: Record<string, NodeResult>): any[] {
    const signals: any[] = [];

    Object.values(results).forEach(result => {
      if (result.data && typeof result.data === 'object' && 'signalType' in result.data) {
        signals.push(result.data);
      }
    });

    return signals;
  }

  private async executeActions(
    results: Record<string, NodeResult>,
    context: ExecutionContext
  ): Promise<any[]> {
    const actions: any[] = [];

    for (const [nodeId, result] of Object.entries(results)) {
      if (nodeId.startsWith('action_')) {
        actions.push(result.data);
      }
    }

    return actions;
  }

  private async saveExecutionRecord(
    context: ExecutionContext,
    results: Record<string, NodeResult>,
    metadata: any
  ): Promise<void> {
    await this.supabase.from('strategy_executions').insert({
      execution_id: context.executionId,
      strategy_id: context.strategyId,
      executed_at: new Date().toISOString(),
      execution_mode: context.mode,
      triggered_by: context.userId,
      results: {
        nodes: results,
        ...metadata
      },
      execution_time_ms: Object.values(results).reduce((sum, r) => sum + r.executionTimeMs, 0),
      nodes_evaluated: Object.keys(results).length,
      data_points_processed: Object.values(results).reduce((sum, r) =>
        Array.isArray(r.data) ? sum + r.data.length : sum, 0
      ),
      status: metadata.status || 'SUCCESS',
      error_message: metadata.errorMessage
    });
  }

  // Action implementations

  private async addToWatchlist(data: any[], params: any): Promise<any> {
    // Implementation: Add items to watchlist
    return { added: data.length };
  }

  private async sendAlert(data: any[], params: any, context: ExecutionContext): Promise<any> {
    // Implementation: Send alerts
    return { sent: true };
  }

  private async callWebhook(data: any[], params: any): Promise<any> {
    // Implementation: HTTP POST to webhook URL
    return { called: true };
  }

  private applySupabaseFilters(query: any, whereClause: string): any {
    // Simple implementation - real version needs proper SQL parsing
    // For now, assume whereClause like "omega_ratio >= 2.0"
    return query; // TODO: Parse and apply filters
  }
}
```

---

## 4. Real Data Integration

### 4.1 Data Source Connectors

**No mock data** - all connectors fetch from real sources:

```typescript
/**
 * Data Source Connectors
 * Connect strategy nodes to real databases
 */

// ClickHouse connector
export const clickhouseConnector = {
  async fetchWalletMetrics(filters?: string) {
    const query = `
      SELECT *
      FROM wallet_metrics_complete
      ${filters ? `WHERE ${filters}` : ''}
      ORDER BY omega_ratio DESC
    `;

    const result = await clickhouse.query({ query });
    return await result.json<any[]>();
  },

  async fetchMomentumSignals(filters?: string) {
    const query = `
      SELECT *
      FROM momentum_trading_signals
      ${filters ? `WHERE ${filters}` : ''}
      ORDER BY signal_timestamp DESC
    `;

    const result = await clickhouse.query({ query });
    return await result.json<any[]>();
  },

  async fetchPriceSnapshots(marketId: string, hours: number = 24) {
    const query = `
      SELECT
        timestamp,
        mid_price,
        tsi_fast,
        tsi_slow,
        crossover_signal
      FROM market_price_momentum
      WHERE market_id = {marketId:String}
        AND timestamp >= now() - INTERVAL {hours:UInt32} HOUR
      ORDER BY timestamp ASC
    `;

    const result = await clickhouse.query({
      query,
      query_params: { marketId, hours }
    });

    return await result.json<any[]>();
  }
};

// Supabase connector
export const supabaseConnector = {
  async fetchWatchlist(userId: string) {
    const { data, error } = await supabase
      .from('watchlist_markets')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) throw error;
    return data || [];
  },

  async fetchEliteWallets(minOmega: number = 2.0) {
    const { data, error } = await supabase
      .from('wallet_scores')
      .select('*')
      .gte('omega_ratio', minOmega)
      .gte('closed_positions', 10)
      .order('omega_ratio', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async fetchCategorySpecialists(category: string) {
    const { data, error } = await supabase
      .from('wallet_scores_by_category')
      .select('*')
      .eq('category', category)
      .gte('omega_ratio', 2.0)
      .order('omega_ratio', { ascending: false });

    if (error) throw error;
    return data || [];
  }
};

// WebSocket real-time connector
export const realtimeConnector = {
  subscribeToMarketPrices(marketIds: string[], callback: (data: any) => void) {
    // Connect to Polymarket WebSocket RTDS
    // Real-time price updates every tick

    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

    ws.on('message', (msg) => {
      const data = JSON.parse(msg);
      if (marketIds.includes(data.market_id)) {
        callback(data);
      }
    });

    return () => ws.close();
  },

  subscribeToSignals(callback: (signal: any) => void) {
    // Subscribe to new momentum signals
    // Polls momentum_trading_signals table every 10s

    const interval = setInterval(async () => {
      const recentSignals = await clickhouseConnector.fetchMomentumSignals(
        'signal_timestamp >= now() - INTERVAL 10 SECOND'
      );

      recentSignals.forEach(callback);
    }, 10000);

    return () => clearInterval(interval);
  }
};
```

### 4.2 Real-Time Streaming

**WebSocket Integration** for live strategy updates:

```typescript
/**
 * Real-Time Strategy Executor
 * Executes strategies on live data streams
 */
export class RealtimeStrategyExecutor {
  private wsConnections: Map<string, WebSocket> = new Map();
  private activeStrategies: Map<string, StrategyDefinition> = new Map();

  /**
   * Start real-time execution of a strategy
   */
  async startRealtimeExecution(strategy: StrategyDefinition) {
    // Find DATA_SOURCE nodes with mode='REALTIME'
    const realtimeNodes = strategy.nodeGraph.nodes.filter(
      n => n.type === 'DATA_SOURCE' && n.config.mode === 'REALTIME'
    );

    for (const node of realtimeNodes) {
      await this.subscribeToDataSource(node, strategy);
    }

    this.activeStrategies.set(strategy.strategyId, strategy);
  }

  /**
   * Subscribe to real-time data source
   */
  private async subscribeToDataSource(node: Node, strategy: StrategyDefinition) {
    const { source, refreshMs = 10000 } = node.config;

    switch (source) {
      case 'MARKETS':
        // Subscribe to market price updates
        this.subscribeToMarketPrices(node, strategy, refreshMs);
        break;

      case 'SIGNALS':
        // Subscribe to new momentum signals
        this.subscribeToSignals(node, strategy, refreshMs);
        break;

      default:
        // Polling-based subscription
        this.startPolling(node, strategy, refreshMs);
    }
  }

  private subscribeToMarketPrices(node: Node, strategy: StrategyDefinition, refreshMs: number) {
    const marketIds = ['market_1', 'market_2']; // Get from watchlist

    const unsubscribe = realtimeConnector.subscribeToMarketPrices(marketIds, async (priceUpdate) => {
      // Trigger strategy execution with new data
      await this.executeWithRealtimeData(strategy, node.id, priceUpdate);
    });

    // Store cleanup function
    this.wsConnections.set(`${strategy.strategyId}:${node.id}`, unsubscribe as any);
  }

  private async executeWithRealtimeData(
    strategy: StrategyDefinition,
    nodeId: string,
    data: any
  ) {
    // Execute strategy with updated data
    const engine = new StrategyExecutionEngine();

    const context: ExecutionContext = {
      strategyId: strategy.strategyId,
      executionId: crypto.randomUUID(),
      mode: 'AUTO'
    };

    await engine.execute(strategy, context);
  }

  /**
   * Stop real-time execution
   */
  stopRealtimeExecution(strategyId: string) {
    // Close WebSocket connections
    for (const [key, ws] of this.wsConnections.entries()) {
      if (key.startsWith(strategyId)) {
        if (typeof ws === 'function') {
          ws(); // Call cleanup function
        } else {
          ws.close();
        }
        this.wsConnections.delete(key);
      }
    }

    this.activeStrategies.delete(strategyId);
  }
}
```

---

## 5. Example Strategies

### 5.1 Eggman Hunter Strategy

**Goal**: Find elite wallets with S-grade omega ratio (>= 3.0)

```json
{
  "strategyName": "Eggman Hunter",
  "strategyType": "SCREENING",
  "nodeGraph": {
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "all_wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_scores",
            "where": "closed_positions >= 10"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "omega_s_grade",
        "config": {
          "field": "omega_ratio",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 3.0
        }
      },
      {
        "type": "FILTER",
        "id": "min_trades",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 25
        }
      },
      {
        "type": "LOGIC",
        "id": "combine_filters",
        "config": {
          "operator": "AND",
          "inputs": ["omega_s_grade", "min_trades"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "count_eggmen",
        "config": {
          "function": "COUNT"
        }
      },
      {
        "type": "ACTION",
        "id": "add_to_watchlist",
        "config": {
          "action": "ADD_TO_WATCHLIST",
          "params": {
            "watchlistType": "wallets"
          }
        }
      }
    ],
    "edges": [
      { "from": "all_wallets", "to": "omega_s_grade" },
      { "from": "all_wallets", "to": "min_trades" },
      { "from": "omega_s_grade", "to": "combine_filters" },
      { "from": "min_trades", "to": "combine_filters" },
      { "from": "combine_filters", "to": "count_eggmen" },
      { "from": "combine_filters", "to": "add_to_watchlist" }
    ]
  }
}
```

### 5.2 TSI Momentum Entry Strategy

**Goal**: Generate entry signals on TSI bullish crossover + high conviction

```json
{
  "strategyName": "TSI Momentum Entry",
  "strategyType": "MOMENTUM",
  "nodeGraph": {
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "watchlist_markets",
        "config": {
          "source": "MARKETS",
          "prefilters": {
            "table": "watchlist_markets",
            "where": "is_active = true"
          },
          "mode": "REALTIME",
          "refreshMs": 10000
        }
      },
      {
        "type": "DATA_SOURCE",
        "id": "momentum_signals",
        "config": {
          "source": "SIGNALS",
          "prefilters": {
            "table": "momentum_trading_signals",
            "where": "signal_timestamp >= now() - INTERVAL 5 MINUTE"
          },
          "mode": "REALTIME",
          "refreshMs": 60000
        }
      },
      {
        "type": "FILTER",
        "id": "tsi_bullish",
        "config": {
          "field": "crossover_signal",
          "operator": "EQUALS",
          "value": "BULLISH"
        }
      },
      {
        "type": "FILTER",
        "id": "high_conviction",
        "config": {
          "field": "directional_conviction",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 0.9
        }
      },
      {
        "type": "LOGIC",
        "id": "entry_conditions",
        "config": {
          "operator": "AND",
          "inputs": ["tsi_bullish", "high_conviction"]
        }
      },
      {
        "type": "SIGNAL",
        "id": "generate_entry",
        "config": {
          "signalType": "ENTRY",
          "condition": "entry_conditions",
          "direction": "YES",
          "strength": "STRONG"
        }
      },
      {
        "type": "ACTION",
        "id": "send_alert",
        "config": {
          "action": "SEND_ALERT",
          "params": {
            "channels": ["webhook"],
            "priority": "HIGH",
            "message": "TSI momentum entry signal: {{market_id}}"
          }
        }
      }
    ],
    "edges": [
      { "from": "momentum_signals", "to": "tsi_bullish" },
      { "from": "momentum_signals", "to": "high_conviction" },
      { "from": "tsi_bullish", "to": "entry_conditions" },
      { "from": "high_conviction", "to": "entry_conditions" },
      { "from": "entry_conditions", "to": "generate_entry" },
      { "from": "generate_entry", "to": "send_alert" }
    ]
  }
}
```

### 5.3 Category Specialist Hunter (Austin Methodology)

**Goal**: Find wallets with S-grade in AI category but F-grade in Sports

```json
{
  "strategyName": "AI Specialist Hunter",
  "strategyType": "SCREENING",
  "nodeGraph": {
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "category_scores",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_scores_by_category",
            "where": "meets_minimum_trades = true"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "ai_s_grade",
        "config": {
          "field": "omega_ratio",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 3.0,
          "categorySpecific": {
            "enabled": true,
            "category": "AI"
          }
        }
      },
      {
        "type": "FILTER",
        "id": "sports_f_grade",
        "config": {
          "field": "omega_ratio",
          "operator": "LESS_THAN_OR_EQUAL",
          "value": 0.5,
          "categorySpecific": {
            "enabled": true,
            "category": "Sports"
          }
        }
      },
      {
        "type": "LOGIC",
        "id": "combine_specialists",
        "config": {
          "operator": "AND",
          "inputs": ["ai_s_grade", "sports_f_grade"]
        }
      },
      {
        "type": "ACTION",
        "id": "tag_specialists",
        "config": {
          "action": "ADD_TO_WATCHLIST",
          "params": {
            "watchlistType": "wallets",
            "tags": ["ai_specialist", "potential_insider"]
          }
        }
      }
    ],
    "edges": [
      { "from": "category_scores", "to": "ai_s_grade" },
      { "from": "category_scores", "to": "sports_f_grade" },
      { "from": "ai_s_grade", "to": "combine_specialists" },
      { "from": "sports_f_grade", "to": "combine_specialists" },
      { "from": "combine_specialists", "to": "tag_specialists" }
    ]
  }
}
```

---

## 6. UI/UX Specifications

### 6.1 Visual Node Editor

**React Flow Integration** for drag-and-drop interface:

```typescript
/**
 * Strategy Builder UI Component
 */
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';

export function StrategyBuilderInterface() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  return (
    <div className="h-screen w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
      >
        <Background />
        <Controls />

        {/* Node Palette */}
        <NodePalette />

        {/* Node Inspector */}
        <NodeInspector selectedNode={selectedNode} />

        {/* Real-Time Preview */}
        <ResultsPreview />
      </ReactFlow>
    </div>
  );
}
```

**Node Palette** (left sidebar):
```
DATA SOURCE NODES:
- Wallets
- Markets
- Trades
- Signals
- Categories

FILTER NODES:
- Metric Filter (>=, <=, etc.)
- Category Filter
- Time Range Filter

LOGIC NODES:
- AND
- OR
- NOT

AGGREGATION NODES:
- Count
- Average
- Sum
- Percentile

SIGNAL NODES:
- Entry Signal
- Exit Signal

ACTION NODES:
- Add to Watchlist
- Send Alert
- Webhook
```

### 6.2 Real-Time Preview Panel

**Live Results** as you build:

```typescript
export function ResultsPreview({ strategy }: { strategy: StrategyDefinition }) {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Auto-execute strategy on changes (debounced)
  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);

      const engine = new StrategyExecutionEngine();
      const result = await engine.execute(strategy, {
        strategyId: strategy.strategyId,
        executionId: crypto.randomUUID(),
        mode: 'MANUAL'
      });

      setResults(result);
      setLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [strategy]);

  return (
    <div className="results-preview">
      <h3>Live Preview</h3>

      {loading && <div>Executing strategy...</div>}

      {results && (
        <>
          <div>
            <strong>Matched Wallets:</strong> {results.aggregations?.total_wallets || 0}
          </div>
          <div>
            <strong>Signals Generated:</strong> {results.signalsGenerated?.length || 0}
          </div>
          <div>
            <strong>Execution Time:</strong> {results.totalExecutionTimeMs}ms
          </div>

          {/* Show sample results */}
          <pre>{JSON.stringify(results, null, 2)}</pre>
        </>
      )}
    </div>
  );
}
```

### 6.3 Strategy Library

**Predefined + Custom** strategies:

```typescript
export function StrategyLibrary() {
  const { data: strategies } = useQuery(['strategies'], async () => {
    const { data } = await supabase
      .from('strategy_definitions')
      .select('*')
      .order('created_at', { ascending: false });

    return data;
  });

  return (
    <div className="strategy-library">
      <h2>Strategy Library</h2>

      {/* Predefined Strategies */}
      <section>
        <h3>Predefined Strategies</h3>
        <div className="grid grid-cols-3 gap-4">
          {strategies?.filter(s => s.is_predefined).map(strategy => (
            <StrategyCard key={strategy.strategy_id} strategy={strategy} />
          ))}
        </div>
      </section>

      {/* User Strategies */}
      <section>
        <h3>My Strategies</h3>
        <div className="grid grid-cols-3 gap-4">
          {strategies?.filter(s => !s.is_predefined).map(strategy => (
            <StrategyCard key={strategy.strategy_id} strategy={strategy} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

---

## 7. Implementation Plan

### Phase 0: Schema & Infrastructure (Week 1)
- [ ] Create `strategy_definitions` table (Supabase)
- [ ] Create `strategy_executions` table (Supabase)
- [ ] Create `strategy_node_cache` table (ClickHouse)
- [ ] Set up React Flow dependencies

### Phase 1: Core Engine (Week 2)
- [ ] Implement `StrategyExecutionEngine` class
- [ ] Implement all 6 node types (DATA_SOURCE, FILTER, LOGIC, AGGREGATION, SIGNAL, ACTION)
- [ ] Implement data source connectors (ClickHouse + Supabase)
- [ ] Add caching layer
- [ ] Unit tests for execution engine

### Phase 2: UI Components (Week 3)
- [ ] Build visual node editor (React Flow)
- [ ] Create node palette (drag-and-drop)
- [ ] Build node inspector panel
- [ ] Implement real-time preview
- [ ] Add strategy save/load

### Phase 3: Predefined Strategies (Week 4)
- [ ] Seed 11 predefined strategies from DATABASE_ARCHITECT_SPEC.md
- [ ] Seed TSI momentum strategy
- [ ] Add strategy templates
- [ ] Build strategy library UI

### Phase 4: Real-Time Integration (Week 5)
- [ ] Implement `RealtimeStrategyExecutor`
- [ ] WebSocket integration (Polymarket RTDS)
- [ ] Live strategy execution
- [ ] Alert/notification system

### Phase 5: Testing & Polish (Week 6)
- [ ] End-to-end testing with real data
- [ ] Performance optimization (caching, indexing)
- [ ] UI/UX refinement
- [ ] Documentation

---

## Conclusion

This strategy builder system provides:

✅ **Flexibility**: Any filter/strategy can be built without code changes
✅ **Real Data**: No mock data - connects to ClickHouse + Supabase + WebSocket
✅ **Visual Interface**: Drag-and-drop node editor
✅ **Real-Time**: Live execution on streaming data
✅ **Extensible**: Easy to add new node types
✅ **Performant**: Caching, incremental execution

**Key Success Factors**:
- Node type system supports all 11 strategies + TSI momentum
- Execution engine handles real-time and batch modes
- UI provides instant feedback with live preview
- Database schema stores strategies as flexible JSON (not hardcoded)

Ready for implementation!
