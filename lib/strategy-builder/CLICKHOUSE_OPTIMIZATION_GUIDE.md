# ClickHouse Connector - Performance Optimization Guide

## Overview

The ClickHouse connector is optimized for sub-200ms queries on wallet metrics tables containing 10,000+ wallets. This guide explains the optimization strategies and best practices.

---

## Table Architecture

### wallet_metrics_complete

```sql
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY (window)
ORDER BY (wallet_address, window)
```

**Key Properties:**
- **Partitioned by**: `window` (7d, 30d, 90d, lifetime)
- **Ordered by**: `wallet_address, window`
- **102 metrics** stored per wallet per time window
- **Indexes**: omega_net, ev_per_hour, resolved_bets, performance_trend

### wallet_metrics_by_category

```sql
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY (category, window)
ORDER BY (wallet_address, category, window)
```

**Key Properties:**
- **Partitioned by**: `category, window`
- **Ordered by**: `wallet_address, category, window`
- Same 102 metrics, broken down by category

---

## Performance Optimizations

### 1. Partition Pruning

**What it does**: Eliminates entire partitions from query scan when filtering on partition keys.

**Example:**
```typescript
// GOOD: Only scans 'lifetime' partition
connector.queryWalletMetrics({
  timeWindow: 'lifetime',
  filters: [{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }]
});

// BAD: Scans all 4 partitions
connector.queryWalletMetrics({
  filters: [{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }]
  // No timeWindow specified
});
```

**Performance Impact**: 4x faster (scans 1/4 of data)

---

### 2. PREWHERE Optimization

**What it does**: Pushes high-selectivity filters to storage layer before loading full rows.

**How it works**:
- ClickHouse reads only the filtered columns from disk
- Evaluates PREWHERE condition
- Only loads full rows that pass the filter

**Automatically Used For:**
- `wallet_address` (exact lookups)
- `omega_ratio` (high-cardinality, indexed)
- `ev_per_hour_capital` (high-cardinality, indexed)
- `resolved_bets` (high-cardinality, indexed)

**Example:**
```typescript
// Connector automatically uses PREWHERE for omega_ratio
const result = await connector.queryWalletMetrics({
  filters: [
    { field: 'omega_ratio', operator: 'GREATER_THAN_OR_EQUAL', value: 3.0 }
  ]
});

// Generated SQL:
// SELECT *
// FROM wallet_metrics_complete
// PREWHERE metric_2_omega_net >= 3.0
```

**Performance Impact**: 2-5x faster on large tables

---

### 3. Column Pruning

**What it does**: Only reads columns you need from disk, avoiding I/O overhead.

**Example:**
```typescript
// GOOD: Only reads 3 columns + primary key
connector.queryWalletMetrics({
  selectFields: ['omega_ratio', 'ev_per_hour_capital', 'tail_ratio'],
  filters: [{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }]
});

// BAD: Reads all 102 metric columns
connector.queryWalletMetrics({
  // No selectFields specified, reads all columns
  filters: [{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }]
});
```

**Performance Impact**: 10-30x faster (depends on column count)

**Generated SQL:**
```sql
-- Optimized (column pruning)
SELECT
  wallet_address,
  metric_2_omega_net AS omega_ratio,
  metric_69_ev_per_hour_capital AS ev_per_hour_capital,
  metric_60_tail_ratio AS tail_ratio
FROM wallet_metrics_complete
PREWHERE metric_2_omega_net >= 3.0

-- Unoptimized (reads all 102 columns)
SELECT *
FROM wallet_metrics_complete
PREWHERE metric_2_omega_net >= 3.0
```

---

### 4. Index Utilization

**Indexed Columns** (minmax indexes):
- `metric_2_omega_net` (omega_ratio)
- `metric_69_ev_per_hour_capital` (ev_per_hour_capital)
- `metric_22_resolved_bets` (resolved_bets)
- `metric_48_omega_lag_30s` (omega_lag_30s)
- `metric_60_tail_ratio` (tail_ratio)
- `metric_85_performance_trend_flag` (set index)

**How minmax indexes work**:
- Each granule (8,192 rows) stores min/max values
- Range queries can skip entire granules

**Example:**
```typescript
// EXCELLENT: Uses minmax index on omega_ratio
connector.queryWalletMetrics({
  filters: [
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }
  ]
});

// GOOD: Uses minmax index on ev_per_hour_capital
connector.queryWalletMetrics({
  filters: [
    { field: 'ev_per_hour_capital', operator: 'GREATER_THAN', value: 100 }
  ]
});

// POOR: No index on this field
connector.queryWalletMetrics({
  filters: [
    { field: 'skewness', operator: 'GREATER_THAN', value: 0.5 }
  ]
});
```

**Performance Impact**: 3-10x faster on indexed columns

---

### 5. Filter Ordering

**Best Practice**: Put most selective filters first.

**Example:**
```typescript
// GOOD: Most selective filter first
connector.queryWalletMetrics({
  filters: [
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 100 },  // Filters 90%
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },    // Filters 50%
    { field: 'track_record_days', operator: 'GREATER_THAN', value: 30 } // Filters 20%
  ]
});

// BAD: Least selective filter first
connector.queryWalletMetrics({
  filters: [
    { field: 'track_record_days', operator: 'GREATER_THAN', value: 30 }, // Filters 20%
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },      // Filters 50%
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 100 }     // Filters 90%
  ]
});
```

**Why it matters**: ClickHouse evaluates filters in order. Eliminate most rows early.

---

### 6. Batch Queries

**What it does**: Run multiple filter sets in parallel.

**Example:**
```typescript
// Test multiple strategies simultaneously
const results = await connector.batchQuery([
  {
    // Strategy 1: High omega, high volume
    filters: [
      { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
      { field: 'resolved_bets', operator: 'GREATER_THAN', value: 50 }
    ]
  },
  {
    // Strategy 2: Consistent performers
    filters: [
      { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },
      { field: 'performance_trend_flag', operator: 'EQUALS', value: 'Improving' }
    ]
  },
  {
    // Strategy 3: Speed demons
    filters: [
      { field: 'omega_lag_30s', operator: 'GREATER_THAN', value: 2.5 },
      { field: 'tail_ratio', operator: 'GREATER_THAN', value: 3.0 }
    ]
  }
]);
```

**Performance Impact**: 3x faster than sequential queries (parallel execution)

---

## Query Patterns & Best Practices

### Pattern 1: Top N Wallets

```typescript
// Find top 100 wallets by omega ratio
const result = await connector.queryWalletMetrics({
  timeWindow: 'lifetime',  // Partition pruning
  selectFields: [          // Column pruning
    'omega_ratio',
    'ev_per_hour_capital',
    'resolved_bets'
  ],
  filters: [
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 } // Minimum sample
  ],
  orderBy: { field: 'omega_ratio', direction: 'DESC' },
  limit: 100
});
```

**Expected Performance**: <50ms for 10K wallets

---

### Pattern 2: Multi-Criteria Screening

```typescript
// Find wallets matching specific strategy criteria
const result = await connector.queryWalletMetrics({
  timeWindow: '30d',       // Recent performance
  selectFields: [
    'omega_ratio',
    'tail_ratio',
    'omega_lag_30s',
    'ev_per_hour_capital'
  ],
  filters: [
    // Primary filters (indexed)
    { field: 'omega_ratio', operator: 'GREATER_THAN_OR_EQUAL', value: 3.0 },
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 30 },

    // Secondary filters
    { field: 'tail_ratio', operator: 'GREATER_THAN', value: 2.0 },
    { field: 'omega_lag_30s', operator: 'GREATER_THAN', value: 2.5 }
  ]
});
```

**Expected Performance**: <100ms for 10K wallets

---

### Pattern 3: Percentile-Based Filtering

```typescript
// Find wallets in top 10% of omega ratio
const result = await connector.queryWalletMetrics({
  timeWindow: 'lifetime',
  filters: [
    { field: 'omega_ratio', operator: 'IN_PERCENTILE', value: 0.90 },
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 }
  ]
});

// Generated SQL uses quantile function:
// WHERE metric_2_omega_net >= quantile(0.90)(metric_2_omega_net)
```

**Expected Performance**: <150ms (quantile calculation adds overhead)

---

### Pattern 4: Category Specialists

```typescript
// Find top Politics traders
const result = await connector.queryWalletMetricsByCategory({
  category: 'Politics',    // Partition pruning
  timeWindow: '90d',
  selectFields: [
    'omega_ratio',
    'calibration_error',
    'ev_per_hour_capital'
  ],
  filters: [
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.5 },
    { field: 'is_primary_category', operator: 'EQUALS', value: true }
  ],
  orderBy: { field: 'omega_ratio', direction: 'DESC' },
  limit: 50
});
```

**Expected Performance**: <75ms (category partition pruning is very effective)

---

## Anti-Patterns (What NOT to Do)

### ❌ Anti-Pattern 1: Querying Without Time Window

```typescript
// BAD: Scans all partitions
const result = await connector.queryWalletMetrics({
  filters: [{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }]
});

// GOOD: Only scans one partition
const result = await connector.queryWalletMetrics({
  timeWindow: 'lifetime',
  filters: [{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }]
});
```

---

### ❌ Anti-Pattern 2: SELECT * Without Limit

```typescript
// BAD: Reads all 102 columns for all matching rows
const result = await connector.queryWalletMetrics({
  timeWindow: 'lifetime'
  // No selectFields, no limit
});

// GOOD: Column pruning + limit
const result = await connector.queryWalletMetrics({
  timeWindow: 'lifetime',
  selectFields: ['omega_ratio', 'ev_per_hour_capital'],
  limit: 1000
});
```

---

### ❌ Anti-Pattern 3: Filtering on Non-Indexed Low-Selectivity Fields

```typescript
// BAD: skewness is not indexed and low selectivity
const result = await connector.queryWalletMetrics({
  filters: [
    { field: 'skewness', operator: 'GREATER_THAN', value: 0.1 }
  ]
});

// GOOD: Start with indexed high-selectivity filter
const result = await connector.queryWalletMetrics({
  filters: [
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 50 },  // Indexed
    { field: 'skewness', operator: 'GREATER_THAN', value: 0.1 }       // Then this
  ]
});
```

---

### ❌ Anti-Pattern 4: Sequential Queries Instead of Batch

```typescript
// BAD: 3 sequential queries (900ms total)
const result1 = await connector.queryWalletMetrics({ filters: filters1 });
const result2 = await connector.queryWalletMetrics({ filters: filters2 });
const result3 = await connector.queryWalletMetrics({ filters: filters3 });

// GOOD: Parallel batch (300ms total)
const [result1, result2, result3] = await connector.batchQuery([
  { filters: filters1 },
  { filters: filters2 },
  { filters: filters3 }
]);
```

---

## Performance Benchmarks

### Expected Query Times (10,000 wallets)

| Query Type | Optimized | Unoptimized | Speedup |
|-----------|-----------|-------------|---------|
| Single indexed filter | 20ms | 150ms | 7.5x |
| Multi-criteria (3 filters) | 45ms | 320ms | 7.1x |
| Top 100 with ORDER BY | 35ms | 280ms | 8.0x |
| Percentile-based | 120ms | 450ms | 3.8x |
| Category-specific | 25ms | 200ms | 8.0x |
| Batch (3 queries) | 60ms | 500ms | 8.3x |

### Scaling Expectations

| Wallet Count | Optimized Query | Unoptimized Query |
|--------------|----------------|-------------------|
| 1,000 | 10ms | 50ms |
| 10,000 | 45ms | 320ms |
| 100,000 | 180ms | 2,800ms |
| 1,000,000 | 850ms | 25,000ms |

---

## Monitoring Query Performance

### Use EXPLAIN to Analyze Queries

```typescript
const plan = await connector.explainQuery({
  timeWindow: 'lifetime',
  filters: [
    { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }
  ]
});

console.log(plan);
```

### Look For These in EXPLAIN Output:

- ✅ **Partition pruning**: "Selected 1/4 parts by partition key"
- ✅ **Index usage**: "Skip 8192/10000 rows by index"
- ✅ **Column pruning**: "Reading 3/105 columns"
- ❌ **Full scan**: "Reading all parts"

---

## Troubleshooting Slow Queries

### Query taking > 200ms?

1. **Check partition pruning**: Did you specify `timeWindow`?
2. **Check column pruning**: Are you using `selectFields`?
3. **Check filter order**: Is most selective filter first?
4. **Check indexes**: Are you filtering on indexed columns?
5. **Check result size**: Are you using `limit`?

### Common Fixes:

```typescript
// Slow query diagnosis
const result = await connector.queryWalletMetrics({
  filters: [
    { field: 'calibration_error', operator: 'LESS_THAN', value: 0.1 }
  ]
});
// Problem: No partition pruning, no index, reading all columns

// Fixed query
const result = await connector.queryWalletMetrics({
  timeWindow: 'lifetime',              // FIX 1: Partition pruning
  selectFields: ['calibration_error'], // FIX 2: Column pruning
  filters: [
    { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 }, // FIX 3: Indexed filter first
    { field: 'calibration_error', operator: 'LESS_THAN', value: 0.1 }
  ],
  limit: 1000                          // FIX 4: Limit results
});
```

---

## Advanced: Custom Optimization Hints

### Disable PREWHERE (rare cases)

```typescript
// Some queries perform better without PREWHERE
const result = await connector.queryWalletMetrics({
  filters: [{ field: 'omega_ratio', operator: 'GREATER_THAN', value: 1.0 }],
  usePrewhere: false  // Force all filters to WHERE clause
});
```

**When to use**: Low selectivity filters (>50% of rows match)

---

## Summary: Optimization Checklist

Before running a query, check:

- [ ] **Partition pruning**: Specified `timeWindow`?
- [ ] **Column pruning**: Using `selectFields` with only needed columns?
- [ ] **Indexed filters**: Filtering on indexed columns first?
- [ ] **Filter ordering**: Most selective filters first?
- [ ] **Result limiting**: Using `limit` to cap results?
- [ ] **Batch processing**: Can you batch multiple queries?

**Goal**: Every production query should execute in <200ms for 10K wallets.

---

## References

- ClickHouse Documentation: https://clickhouse.com/docs/en/guides/improving-query-performance
- MergeTree Engine: https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree
- PREWHERE: https://clickhouse.com/docs/en/sql-reference/statements/select/prewhere
