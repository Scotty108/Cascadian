# Strategy Builder - ClickHouse Connector

High-performance connector for querying wallet metrics from ClickHouse, optimized for sub-200ms queries on 10K+ wallets.

## Overview

The ClickHouse connector provides a type-safe, optimized query builder for screening wallets based on 102 performance metrics. It's designed to power strategy building interfaces where users filter wallets by multiple criteria.

## Features

- **Sub-200ms queries** on 10K+ wallets
- **Type-safe** TypeScript interfaces
- **Automatic optimization** (partition pruning, PREWHERE, column pruning)
- **Batch query support** for testing multiple strategies in parallel
- **Comprehensive metric mapping** (102 metrics from TypeScript to ClickHouse)
- **Flexible filtering** (range, percentile, null checks, etc.)

## Quick Start

### Basic Usage

```typescript
import { walletMetricsConnector } from '@/lib/strategy-builder/clickhouse-connector';

// Find top performers
const result = await walletMetricsConnector.queryWalletMetrics({
  timeWindow: 'lifetime',
  selectFields: ['omega_ratio', 'resolved_bets', 'net_pnl'],
  filters: [
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },
  ],
  orderBy: { field: 'omega_ratio', direction: 'DESC' },
  limit: 100,
});

console.log(`Found ${result.data.length} wallets in ${result.executionTimeMs}ms`);
```

### Multi-Criteria Strategy

```typescript
// Find wallets with convexity + copyability
const result = await walletMetricsConnector.queryWalletMetrics({
  timeWindow: '90d',
  selectFields: [
    'omega_ratio',
    'tail_ratio',
    'omega_lag_30s',
    'ev_per_hour_capital',
  ],
  filters: [
    { field: 'tail_ratio', operator: 'GREATER_THAN', value: 2.5 },
    { field: 'omega_lag_30s', operator: 'GREATER_THAN', value: 2.0 },
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.5 },
  ],
  limit: 50,
});
```

### Batch Query (Test Multiple Strategies)

```typescript
const results = await walletMetricsConnector.batchQuery([
  // Strategy 1
  {
    filters: [
      { field: 'omega_ratio', operator: 'GREATER_THAN', value: 4.0 },
    ],
  },
  // Strategy 2
  {
    filters: [
      { field: 'tail_ratio', operator: 'GREATER_THAN', value: 3.0 },
    ],
  },
  // Strategy 3
  {
    filters: [
      { field: 'ev_per_hour_capital', operator: 'GREATER_THAN', value: 100 },
    ],
  },
]);

// Results for all 3 strategies returned in parallel
```

## Architecture

### Files

```
lib/strategy-builder/
├── clickhouse-connector.ts        # Main connector and query builder
├── metric-field-mapping.ts        # Complete metric mapping utilities
├── types.ts                        # TypeScript type definitions
├── examples.ts                     # 10 comprehensive examples
├── CLICKHOUSE_OPTIMIZATION_GUIDE.md # Performance optimization guide
├── __tests__/
│   └── clickhouse-connector.test.ts # Test suite
└── README.md                       # This file
```

### Tables

#### wallet_metrics_complete

Main table with 102 metrics per wallet per time window.

- **Partitions**: `7d`, `30d`, `90d`, `lifetime`
- **Primary Key**: `(wallet_address, window)`
- **Indexes**: omega_net, ev_per_hour, resolved_bets, tail_ratio, omega_lag_30s

#### wallet_metrics_by_category

Same 102 metrics broken down by category.

- **Partitions**: `(category, window)`
- **Primary Key**: `(wallet_address, category, window)`
- **Indexes**: category_omega, is_primary_category

## Metric Categories

### Phase 1: Core Performance (TIER 1)
- `omega_ratio` - Gains/losses after fees
- `sortino_ratio` - Risk-adjusted returns (downside deviation)
- `calmar_ratio` - CAGR / max drawdown
- `net_pnl` - Total P&L
- `win_rate` - Win percentage
- `profit_factor` - Wins / losses

### Phase 2: Risk Metrics
- `max_drawdown` - Maximum % decline
- `cvar_95` - Conditional value at risk
- `recovery_time_avg_days` - Avg drawdown recovery time

### Phase 3: Activity
- `resolved_bets` - Number of trades (TIER 1)
- `track_record_days` - Days trading
- `bets_per_week` - Trading frequency

### Phase 5: Convexity (TIER 1)
- `tail_ratio` - Top wins / bottom losses
- `skewness` - Distribution skewness
- `kurtosis` - Fat tail measure

### Phase 7: Capital Efficiency (TIER 1)
- `ev_per_hour_capital` - EV per hour deployed (CRITICAL)
- `capital_turnover_rate` - Volume / bankroll
- `avg_holding_period_hours` - Position duration

### Phase 9: Momentum (TIER 1)
- `omega_momentum_30d` - 30-day omega trend
- `performance_trend_flag` - Improving/Declining/Stable
- `hot_hand_z_score` - Recent win streak

### Phase 11: Copyability (TIER 1 - CRITICAL)
- `omega_lag_30s` - Performance with 30s copy delay
- `omega_lag_2min` - Performance with 2min delay
- `omega_lag_5min` - Performance with 5min delay

**See `metric-field-mapping.ts` for all 102 metrics.**

## Filter Operators

```typescript
type FilterOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL'
  | 'IN'                    // Array of values
  | 'NOT_IN'
  | 'CONTAINS'              // String pattern
  | 'BETWEEN'               // [min, max]
  | 'IS_NULL'
  | 'IS_NOT_NULL'
  | 'IN_PERCENTILE'         // Top X% (e.g., 0.90)
  | 'NOT_IN_PERCENTILE';
```

### Examples

```typescript
// Range filter
{ field: 'omega_ratio', operator: 'BETWEEN', value: [2.0, 5.0] }

// Percentile filter (top 10%)
{ field: 'omega_ratio', operator: 'IN_PERCENTILE', value: 0.90 }

// Enum filter
{ field: 'performance_trend_flag', operator: 'IN', value: ['Improving', 'Stable'] }

// Null check
{ field: 'avg_holding_period_hours', operator: 'IS_NOT_NULL', value: null }
```

## Performance Optimizations

### 1. Partition Pruning (4x speedup)

**Always specify `timeWindow`** to scan only 1 partition instead of all 4.

```typescript
// GOOD: Only scans 'lifetime' partition
{ timeWindow: 'lifetime', filters: [...] }

// BAD: Scans all 4 partitions
{ filters: [...] }
```

### 2. Column Pruning (10-30x speedup)

**Use `selectFields`** to read only needed columns.

```typescript
// GOOD: Reads 3 columns
{ selectFields: ['omega_ratio', 'tail_ratio', 'resolved_bets'] }

// BAD: Reads all 102 metric columns
{ /* no selectFields */ }
```

### 3. PREWHERE (2-5x speedup)

Automatically applied for indexed columns:
- `omega_ratio`
- `ev_per_hour_capital`
- `resolved_bets`
- `omega_lag_30s`
- `tail_ratio`

No action needed - connector handles this automatically.

### 4. Filter Ordering

Put **most selective filters first**.

```typescript
// GOOD: Most selective first
filters: [
  { field: 'resolved_bets', operator: 'GREATER_THAN', value: 100 },  // Filters 90%
  { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },    // Filters 50%
]

// BAD: Least selective first
filters: [
  { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },    // Filters 50%
  { field: 'resolved_bets', operator: 'GREATER_THAN', value: 100 },  // Filters 90%
]
```

### 5. Result Limiting

**Use `limit`** to cap results.

```typescript
{ limit: 100 }  // Only return top 100
```

### 6. Batch Queries (3x speedup)

**Use `batchQuery()`** to run multiple queries in parallel.

```typescript
// 3 queries in parallel (300ms total)
const results = await connector.batchQuery([config1, config2, config3]);

// vs sequential (900ms total)
const r1 = await connector.queryWalletMetrics(config1);
const r2 = await connector.queryWalletMetrics(config2);
const r3 = await connector.queryWalletMetrics(config3);
```

## Performance Benchmarks

Expected query times on **10,000 wallets**:

| Query Type | Time | Notes |
|-----------|------|-------|
| Single filter (indexed) | 20ms | omega_ratio > 3.0 |
| Multi-criteria (3 filters) | 45ms | With partition + column pruning |
| Top 100 with ORDER BY | 35ms | With LIMIT |
| Percentile-based | 120ms | Quantile calculation overhead |
| Category-specific | 25ms | Category partition pruning |
| Batch (3 queries) | 60ms | Parallel execution |

**Goal: <200ms for all production queries**

## Examples

See `examples.ts` for 10 comprehensive examples:

1. **Top Performers** - Simple screening
2. **Convexity Strategy** - Multi-metric filtering
3. **Momentum Screen** - Trend-based filtering
4. **Capital Efficiency** - EV/hour optimization
5. **Top Percentile** - Percentile-based filtering
6. **Category Specialists** - Category-specific queries
7. **Risk-Adjusted** - Drawdown and Sortino filtering
8. **Batch Strategies** - Parallel query execution
9. **Explain Query** - Performance analysis
10. **Advanced Filtering** - BETWEEN, NULL checks

Run examples:

```bash
npx tsx lib/strategy-builder/examples.ts
```

## Testing

Run test suite:

```bash
npm test lib/strategy-builder/__tests__/clickhouse-connector.test.ts
```

Tests cover:
- Query builder syntax
- All filter operators
- Metric field mapping
- Edge cases (null, escaping, large numbers)
- Performance optimizations

## Debugging Slow Queries

### Use EXPLAIN

```typescript
const plan = await connector.explainQuery({
  filters: [{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }]
});
console.log(plan);
```

Look for:
- ✅ "Selected 1/4 parts by partition key" (partition pruning)
- ✅ "Skip 8192/10000 rows by index" (index usage)
- ✅ "Reading 3/105 columns" (column pruning)
- ❌ "Reading all parts" (full scan - BAD)

### Optimization Checklist

Before running a query:

- [ ] Specified `timeWindow`? (partition pruning)
- [ ] Using `selectFields`? (column pruning)
- [ ] Filtering on indexed columns first?
- [ ] Most selective filters first?
- [ ] Using `limit`?
- [ ] Can batch multiple queries?

## API Reference

### walletMetricsConnector.queryWalletMetrics(config)

Query `wallet_metrics_complete` table.

**Parameters:**
- `config.timeWindow?` - '7d' | '30d' | '90d' | 'lifetime'
- `config.selectFields?` - Array of metric names
- `config.filters` - Array of filter objects
- `config.orderBy?` - { field, direction: 'ASC' | 'DESC' }
- `config.limit?` - Max results
- `config.offset?` - Skip N results
- `config.usePrewhere?` - Enable/disable PREWHERE (default: true)

**Returns:** `Promise<DataSourceResult>`

```typescript
{
  data: WalletMetricsComplete[],
  totalCount: number,
  executionTimeMs: number,
  source: 'clickhouse'
}
```

### walletMetricsConnector.queryWalletMetricsByCategory(config)

Query `wallet_metrics_by_category` table.

**Additional parameters:**
- `config.category?` - Filter by category name

### walletMetricsConnector.batchQuery(configs)

Execute multiple queries in parallel.

**Parameters:**
- `configs` - Array of query configs

**Returns:** `Promise<DataSourceResult[]>`

### walletMetricsConnector.explainQuery(config)

Get query execution plan for performance analysis.

**Returns:** `Promise<string>` (query plan)

## Field Mapping Utilities

```typescript
import {
  TS_TO_CH_MAP,          // TypeScript to ClickHouse mapping
  CH_TO_TS_MAP,          // Reverse mapping
  getMetricsByPhase,     // Get metrics by phase number
  getMetricsByTier,      // Get metrics by tier (1, 2, 3)
  getIndexedMetrics,     // Get indexed metrics
  isValidMetricField,    // Check if field exists
  getMetricDefinition,   // Get full field definition
} from '@/lib/strategy-builder/metric-field-mapping';

// Example: Get all TIER 1 metrics
const tier1Metrics = getMetricsByTier(1);
// Returns: omega_ratio, tail_ratio, ev_per_hour_capital, etc.

// Example: Check if field exists
if (isValidMetricField('omega_ratio')) {
  // Field exists
}

// Example: Get metric definition
const def = getMetricDefinition('omega_ratio');
console.log(def.description); // "Omega ratio (net of fees): gains/losses after fees"
console.log(def.tier);        // 1
console.log(def.isIndexed);   // true
```

## Advanced Usage

### Custom Optimization

```typescript
// Disable PREWHERE for low-selectivity filters (rare)
const result = await connector.queryWalletMetrics({
  filters: [{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 1.0 }],
  usePrewhere: false  // Force to WHERE clause
});
```

### Error Handling

```typescript
try {
  const result = await connector.queryWalletMetrics({...});
} catch (error) {
  console.error('Query failed:', error.message);
  // Connector automatically retries 3 times with exponential backoff
}
```

## Resources

- **Optimization Guide**: See `CLICKHOUSE_OPTIMIZATION_GUIDE.md`
- **Type Definitions**: See `types.ts`
- **Metric Mapping**: See `metric-field-mapping.ts`
- **Examples**: See `examples.ts`
- **Tests**: See `__tests__/clickhouse-connector.test.ts`

## Contributing

When adding new metrics:

1. Update ClickHouse schema migration
2. Add metric to `metric-field-mapping.ts`
3. Update TypeScript types in `types.ts`
4. Add test case in `__tests__/clickhouse-connector.test.ts`
5. Update this README

## License

MIT
