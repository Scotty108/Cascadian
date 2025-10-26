# ClickHouse Connector - Quick Reference

**One-page cheat sheet for the ClickHouse wallet metrics connector**

---

## Basic Query

```typescript
import { walletMetricsConnector } from '@/lib/strategy-builder';

const result = await walletMetricsConnector.queryWalletMetrics({
  timeWindow: 'lifetime',
  selectFields: ['omega_ratio', 'tail_ratio', 'resolved_bets'],
  filters: [
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },
  ],
  orderBy: { field: 'omega_ratio', direction: 'DESC' },
  limit: 100,
});
```

---

## Filter Operators

```typescript
// Comparison
{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }
{ field: 'omega_ratio', operator: 'GREATER_THAN_OR_EQUAL', value: 3.0 }
{ field: 'omega_ratio', operator: 'LESS_THAN', value: 5.0 }
{ field: 'omega_ratio', operator: 'EQUALS', value: 3.0 }
{ field: 'omega_ratio', operator: 'NOT_EQUALS', value: 0 }

// Range
{ field: 'omega_ratio', operator: 'BETWEEN', value: [2.0, 5.0] }

// Array
{ field: 'performance_trend_flag', operator: 'IN', value: ['Improving', 'Stable'] }
{ field: 'performance_trend_flag', operator: 'NOT_IN', value: ['Declining'] }

// Percentile
{ field: 'omega_ratio', operator: 'IN_PERCENTILE', value: 0.90 }      // Top 10%
{ field: 'omega_ratio', operator: 'NOT_IN_PERCENTILE', value: 0.10 }  // Bottom 10%

// Null
{ field: 'omega_lag_30s', operator: 'IS_NOT_NULL', value: null }
{ field: 'calibration_error', operator: 'IS_NULL', value: null }

// String
{ field: 'category', operator: 'CONTAINS', value: 'Politics' }
```

---

## Key Metrics (TIER 1)

```typescript
// Performance
'omega_ratio'           // Gains/losses after fees (CRITICAL)
'sortino_ratio'         // Risk-adjusted returns
'calmar_ratio'          // CAGR / max drawdown
'net_pnl'               // Total P&L

// Convexity
'tail_ratio'            // Top wins / bottom losses (CRITICAL)

// Copyability
'omega_lag_30s'         // Performance with 30s delay (CRITICAL)
'omega_lag_2min'        // Performance with 2min delay
'omega_lag_5min'        // Performance with 5min delay

// Capital Efficiency
'ev_per_hour_capital'   // EV per hour deployed (CRITICAL)

// Momentum
'omega_momentum_30d'    // 30-day omega trend
'performance_trend_flag' // Improving/Declining/Stable
'hot_hand_z_score'      // Recent win streak

// Activity
'resolved_bets'         // Number of trades
'track_record_days'     // Days trading
'bets_per_week'         // Trading frequency
```

---

## Performance Tips

### 1. Always Specify Time Window (4x faster)
```typescript
{ timeWindow: 'lifetime' }  // GOOD: Scans 1/4 partitions
{ /* no timeWindow */ }     // BAD: Scans all 4 partitions
```

### 2. Use Select Fields (10-30x faster)
```typescript
{ selectFields: ['omega_ratio', 'tail_ratio'] }  // GOOD: Reads 2 columns
{ /* no selectFields */ }                        // BAD: Reads 102 columns
```

### 3. Filter on Indexed Columns First
```typescript
// GOOD: Indexed column first
filters: [
  { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },      // Indexed
  { field: 'skewness', operator: 'GREATER_THAN', value: 0.5 },         // Not indexed
]

// Indexed columns: omega_ratio, ev_per_hour_capital, resolved_bets, tail_ratio, omega_lag_30s
```

### 4. Most Selective Filter First
```typescript
// GOOD: Filters 90% first
filters: [
  { field: 'resolved_bets', operator: 'GREATER_THAN', value: 100 },  // Filters 90%
  { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },    // Filters 50%
]
```

### 5. Limit Results
```typescript
{ limit: 100 }  // Only return top 100
```

### 6. Batch Queries (3x faster)
```typescript
// Parallel execution
const results = await connector.batchQuery([config1, config2, config3]);
```

---

## Common Patterns

### Top Performers
```typescript
{
  timeWindow: 'lifetime',
  selectFields: ['omega_ratio', 'resolved_bets'],
  filters: [
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
  ],
  orderBy: { field: 'omega_ratio', direction: 'DESC' },
  limit: 100,
}
```

### Momentum Screen
```typescript
{
  timeWindow: '30d',
  selectFields: ['omega_ratio', 'performance_trend_flag', 'omega_momentum_30d'],
  filters: [
    { field: 'performance_trend_flag', operator: 'EQUALS', value: 'Improving' },
    { field: 'omega_momentum_30d', operator: 'GREATER_THAN', value: 0 },
  ],
}
```

### Category Specialists
```typescript
await connector.queryWalletMetricsByCategory({
  category: 'Politics',
  timeWindow: '90d',
  selectFields: ['omega_ratio', 'calibration_error'],
  filters: [
    { field: 'is_primary_category', operator: 'EQUALS', value: true },
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.5 },
  ],
})
```

---

## API Methods

```typescript
// Query wallet_metrics_complete
await connector.queryWalletMetrics(config)

// Query wallet_metrics_by_category
await connector.queryWalletMetricsByCategory(config)

// Batch query (parallel)
await connector.batchQuery([config1, config2, config3])

// Explain query performance
await connector.explainQuery(config)
```

---

## Result Structure

```typescript
{
  data: WalletMetricsComplete[],  // Array of wallet metrics
  totalCount: number,              // Total matching wallets (without limit)
  executionTimeMs: number,         // Query execution time
  source: 'clickhouse'             // Data source
}
```

---

## Utility Functions

```typescript
import {
  isValidMetricField,
  getMetricDefinition,
  getMetricsByTier,
  getIndexedMetrics,
} from '@/lib/strategy-builder';

// Validate field
if (isValidMetricField('omega_ratio')) { /* ... */ }

// Get metric info
const def = getMetricDefinition('omega_ratio');
console.log(def.tier);        // 1
console.log(def.isIndexed);   // true
console.log(def.description); // "Omega ratio (net of fees)..."

// Get all TIER 1 metrics
const tier1 = getMetricsByTier(1);

// Get indexed metrics (good for filtering)
const indexed = getIndexedMetrics();
```

---

## Performance Targets

| Wallets | Expected Time |
|---------|--------------|
| 1K | 10ms |
| 10K | 45ms |
| 100K | 180ms |
| 1M | 850ms |

**Goal: <200ms for 10K wallets** ✅

---

## Error Handling

```typescript
try {
  const result = await connector.queryWalletMetrics({...});
} catch (error) {
  // Automatically retries 3 times with backoff
  console.error('Query failed:', error.message);
}
```

---

## Debugging Slow Queries

```typescript
// Get query execution plan
const plan = await connector.explainQuery(config);
console.log(plan);

// Look for:
// ✅ "Selected 1/4 parts by partition key"
// ✅ "Skip rows by index"
// ✅ "Reading N/105 columns"
```

---

## Optimization Checklist

Before running a query:

- [ ] Specified `timeWindow`?
- [ ] Using `selectFields`?
- [ ] Filtering on indexed columns first?
- [ ] Most selective filters first?
- [ ] Using `limit`?
- [ ] Can batch multiple queries?

---

## Files

- **README.md** - Full documentation
- **CLICKHOUSE_OPTIMIZATION_GUIDE.md** - Performance deep dive
- **examples.ts** - 10 working examples
- **__tests__/** - Test suite

---

## Import Everything

```typescript
import {
  walletMetricsConnector,
  type WalletMetricsComplete,
  type FilterOperator,
  isValidMetricField,
  getMetricsByTier,
} from '@/lib/strategy-builder';
```

---

**That's it! You're ready to query wallet metrics at scale.** 🚀
