# ClickHouse Connector Architecture

Visual overview of the connector architecture, data flow, and optimization layers.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Application                         │
│  (Strategy Builder UI, API Routes, Background Jobs)             │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ import { walletMetricsConnector }
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    Strategy Builder Layer                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  WalletMetricsConnector                                │    │
│  │  - queryWalletMetrics()                                │    │
│  │  - queryWalletMetricsByCategory()                      │    │
│  │  - batchQuery()                                        │    │
│  │  - explainQuery()                                      │    │
│  └───────────────────┬────────────────────────────────────┘    │
│                      │                                           │
│  ┌───────────────────▼────────────────────────────────────┐    │
│  │  Query Builder                                         │    │
│  │  - buildQuery()                                        │    │
│  │  - Filter operators (14 types)                        │    │
│  │  - SQL generation                                      │    │
│  │  - Optimization hints                                  │    │
│  └───────────────────┬────────────────────────────────────┘    │
│                      │                                           │
│  ┌───────────────────▼────────────────────────────────────┐    │
│  │  Metric Field Mapping                                  │    │
│  │  - TS_TO_CH_MAP (102 metrics)                         │    │
│  │  - Indexed field detection                            │    │
│  │  - PREWHERE candidates                                │    │
│  └────────────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ Generated SQL with optimizations
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    ClickHouse Client                             │
│                  (lib/clickhouse/client.ts)                      │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ TCP/HTTP
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                       ClickHouse Server                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  wallet_metrics_complete                                 │  │
│  │  ENGINE: ReplacingMergeTree(calculated_at)              │  │
│  │  PARTITION BY: window                                    │  │
│  │  ORDER BY: (wallet_address, window)                      │  │
│  │  Rows: ~40K (10K wallets × 4 windows)                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  wallet_metrics_by_category                              │  │
│  │  ENGINE: ReplacingMergeTree(calculated_at)              │  │
│  │  PARTITION BY: (category, window)                        │  │
│  │  ORDER BY: (wallet_address, category, window)            │  │
│  │  Rows: ~400K (10K wallets × 10 categories × 4 windows)  │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Query Execution Pipeline

```
User Request
    │
    ▼
┌───────────────────────────────────────────────┐
│ 1. TypeScript Query Config                    │
│    {                                          │
│      timeWindow: 'lifetime',                  │
│      filters: [                               │
│        { field: 'omega_ratio',                │
│          operator: 'GREATER_THAN',            │
│          value: 3.0 }                         │
│      ]                                        │
│    }                                          │
└─────────────────┬─────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────┐
│ 2. Field Mapping                              │
│    omega_ratio → metric_2_omega_net           │
│    Check if indexed: YES                      │
│    PREWHERE candidate: YES                    │
└─────────────────┬─────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────┐
│ 3. Query Optimization                         │
│    - Partition pruning: window = 'lifetime'   │
│    - PREWHERE: metric_2_omega_net > 3.0       │
│    - Column selection: SELECT wallet_address, │
│                        metric_2_omega_net     │
│    - Index hint: Use minmax index             │
└─────────────────┬─────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────┐
│ 4. SQL Generation                             │
│    SELECT                                     │
│      wallet_address,                          │
│      metric_2_omega_net AS omega_ratio        │
│    FROM wallet_metrics_complete               │
│    PREWHERE metric_2_omega_net > 3.0          │
│    WHERE window = 'lifetime'                  │
│    SETTINGS max_threads = 4                   │
└─────────────────┬─────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────┐
│ 5. ClickHouse Execution                       │
│    - Read only 'lifetime' partition (1/4)     │
│    - Use minmax index (skip 80% of granules)  │
│    - Read only 2 columns (vs 105)             │
│    - Apply PREWHERE before loading rows       │
│    Execution time: 20ms                       │
└─────────────────┬─────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────┐
│ 6. Result Transformation                      │
│    ClickHouse columns → TypeScript fields     │
│    metric_2_omega_net → omega_ratio           │
│    window → time_window                       │
└─────────────────┬─────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────┐
│ 7. Return to User                             │
│    {                                          │
│      data: WalletMetricsComplete[],           │
│      totalCount: 150,                         │
│      executionTimeMs: 20,                     │
│      source: 'clickhouse'                     │
│    }                                          │
└───────────────────────────────────────────────┘
```

---

## Optimization Layers

### Layer 1: Partition Pruning

```
┌─────────────────────────────────────────────────────┐
│  All Data (4 partitions)                            │
│                                                     │
│  ┌──────────┬──────────┬──────────┬──────────┐     │
│  │   7d     │   30d    │   90d    │ lifetime │     │
│  │  2,500   │  2,500   │  2,500   │  2,500   │     │
│  │  rows    │  rows    │  rows    │  rows    │     │
│  └──────────┴──────────┴──────────┴──────────┘     │
│                                                     │
│                 Partition Pruning ▼                 │
│                                                     │
│              ┌──────────────────────┐               │
│              │     lifetime         │               │
│              │     2,500 rows       │               │
│              └──────────────────────┘               │
│                                                     │
│              Scanned: 25% of data                   │
│              Speedup: 4x                            │
└─────────────────────────────────────────────────────┘
```

---

### Layer 2: PREWHERE Optimization

```
┌─────────────────────────────────────────────────────┐
│  Lifetime Partition (2,500 rows)                    │
│                                                     │
│  Step 1: Read ONLY filter column (metric_2)        │
│  ┌─────────────────────────────────────┐           │
│  │  wallet_addr  │  metric_2_omega_net │           │
│  │  0x123...     │  4.5                │  PASS     │
│  │  0x456...     │  2.1                │  FAIL     │
│  │  0x789...     │  3.8                │  PASS     │
│  │  ...          │  ...                │  ...      │
│  └─────────────────────────────────────┘           │
│                                                     │
│  PREWHERE filter: metric_2_omega_net > 3.0          │
│  Rows passing: 150 (6% of 2,500)                   │
│                                                     │
│  Step 2: Read full rows for ONLY 150 matches       │
│  ┌───────────────────────────────────────────┐     │
│  │  wallet_addr  │  metric_2  │  metric_60...│     │
│  │  0x123...     │  4.5       │  2.8         │     │
│  │  0x789...     │  3.8       │  3.1         │     │
│  │  ...          │  ...       │  ...         │     │
│  └───────────────────────────────────────────┘     │
│                                                     │
│  Rows fully loaded: 150 (vs 2,500 without PREWHERE)│
│  Speedup: 16x on data loading                      │
└─────────────────────────────────────────────────────┘
```

---

### Layer 3: Column Pruning

```
┌─────────────────────────────────────────────────────┐
│  Full Row Structure (105 columns)                   │
│                                                     │
│  ┌────────────┬──────┬──────┬─────┬───────────┐    │
│  │ wallet_addr│ win. │ m_2  │ m_3 │ ... m_102 │    │
│  └────────────┴──────┴──────┴─────┴───────────┘    │
│                                                     │
│  SELECT * → Reads all 105 columns                  │
│  I/O: ~10 KB per row × 150 rows = 1.5 MB          │
│                                                     │
│               Column Pruning ▼                      │
│                                                     │
│  ┌────────────┬──────┬──────┐                      │
│  │ wallet_addr│ win. │ m_2  │                      │
│  └────────────┴──────┴──────┘                      │
│                                                     │
│  SELECT specific columns → Reads 3 columns         │
│  I/O: ~0.3 KB per row × 150 rows = 45 KB          │
│                                                     │
│  Data reduction: 97%                               │
│  Speedup: 30x                                      │
└─────────────────────────────────────────────────────┘
```

---

### Layer 4: Index Utilization

```
┌─────────────────────────────────────────────────────┐
│  Lifetime Partition (2,500 rows, 1 granule)         │
│  Granule size: 8,192 rows                           │
│                                                     │
│  Without Index:                                     │
│  ┌──────────────────────────────────────────┐      │
│  │  Granule 1: rows 1-8192                  │      │
│  │  Min(metric_2): 0.5                      │      │
│  │  Max(metric_2): 8.9                      │      │
│  │  Filter: metric_2 > 3.0                  │      │
│  │  ❌ Can't skip (max > 3.0)               │      │
│  │  Must scan all 8,192 rows                │      │
│  └──────────────────────────────────────────┘      │
│                                                     │
│  With minmax Index:                                │
│  ┌──────────────────────────────────────────┐      │
│  │  Granule 1: rows 1-2000                  │      │
│  │  Min(metric_2): 0.5, Max: 1.8            │      │
│  │  ✅ SKIP (max < 3.0)                     │      │
│  ├──────────────────────────────────────────┤      │
│  │  Granule 2: rows 2001-4000               │      │
│  │  Min(metric_2): 1.9, Max: 2.9            │      │
│  │  ✅ SKIP (max < 3.0)                     │      │
│  ├──────────────────────────────────────────┤      │
│  │  Granule 3: rows 4001-6000               │      │
│  │  Min(metric_2): 3.1, Max: 5.2            │      │
│  │  ❌ CAN'T SKIP (min > 3.0)               │      │
│  │  Must scan 2,000 rows                    │      │
│  └──────────────────────────────────────────┘      │
│                                                     │
│  Rows scanned: 2,000 (vs 8,192)                   │
│  Speedup: 4x                                       │
└─────────────────────────────────────────────────────┘
```

---

## Query Performance Breakdown

### Example Query

```sql
SELECT
  wallet_address,
  metric_2_omega_net AS omega_ratio,
  metric_60_tail_ratio AS tail_ratio
FROM wallet_metrics_complete
PREWHERE metric_2_omega_net >= 3.0
WHERE window = 'lifetime'
LIMIT 100
SETTINGS max_threads = 4
```

### Execution Timeline (45ms total)

```
┌────────────────────────────────────────────────────┐
│  Phase 1: Partition Selection (1ms)               │
│  - Identify 'lifetime' partition                  │
│  - Skip 3 other partitions                        │
└─────────────────┬──────────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────────┐
│  Phase 2: Index Lookup (2ms)                      │
│  - Check minmax index on metric_2_omega_net       │
│  - Skip 80% of granules (max < 3.0)               │
│  - Mark 20% for scanning                          │
└─────────────────┬──────────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────────┐
│  Phase 3: PREWHERE Evaluation (10ms)              │
│  - Read metric_2_omega_net column only            │
│  - Apply filter: >= 3.0                           │
│  - Rows passing: 150 (6%)                         │
└─────────────────┬──────────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────────┐
│  Phase 4: Full Row Load (15ms)                    │
│  - Load 3 columns for 150 rows                    │
│  - Apply WHERE clause: window = 'lifetime'        │
│  - Rows after WHERE: 150                          │
└─────────────────┬──────────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────────┐
│  Phase 5: LIMIT (1ms)                             │
│  - Take first 100 rows                            │
└─────────────────┬──────────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────────┐
│  Phase 6: Result Serialization (16ms)             │
│  - Convert to JSONEachRow format                  │
│  - Send to client                                 │
└─────────────────┬──────────────────────────────────┘
                  │
                  ▼
            Return to client
            Total: 45ms
```

---

## Batch Query Architecture

```
User Request: 3 strategies
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  batchQuery([config1, config2, config3])            │
└──────┬────────────┬────────────┬─────────────────────┘
       │            │            │
       │ Parallel   │ Parallel   │ Parallel
       │            │            │
       ▼            ▼            ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│  Query 1   │ │  Query 2   │ │  Query 3   │
│  Omega>4.0 │ │  Tail>3.0  │ │  EV>100    │
│            │ │            │ │            │
│  20ms      │ │  25ms      │ │  30ms      │
└────────────┘ └────────────┘ └────────────┘
       │            │            │
       └────────────┴────────────┘
                    │
                    ▼
      Promise.all() waits for slowest
              (30ms total)
                    │
                    ▼
      ┌─────────────────────────┐
      │ Return all 3 results    │
      │ Total time: 30ms        │
      │ vs Sequential: 75ms     │
      │ Speedup: 2.5x           │
      └─────────────────────────┘
```

---

## Module Dependencies

```
┌──────────────────────────────────────────────────┐
│  Strategy Builder Module                         │
│  lib/strategy-builder/                           │
│                                                  │
│  ┌────────────────────────────────────────┐     │
│  │  clickhouse-connector.ts               │     │
│  │  (Main connector class)                │     │
│  │  ↓ imports                             │     │
│  │  - @/lib/clickhouse/client             │     │
│  │  - ./types                             │     │
│  │  - ./metric-field-mapping              │     │
│  └────────────────────────────────────────┘     │
│                                                  │
│  ┌────────────────────────────────────────┐     │
│  │  metric-field-mapping.ts               │     │
│  │  (102 metric definitions)              │     │
│  │  ↓ exports                             │     │
│  │  - TS_TO_CH_MAP                        │     │
│  │  - CH_TO_TS_MAP                        │     │
│  │  - Helper functions                    │     │
│  └────────────────────────────────────────┘     │
│                                                  │
│  ┌────────────────────────────────────────┐     │
│  │  types.ts                              │     │
│  │  (TypeScript interfaces)               │     │
│  │  ↓ exports                             │     │
│  │  - WalletMetricsComplete               │     │
│  │  - FilterOperator                      │     │
│  │  - QueryFilter, etc.                   │     │
│  └────────────────────────────────────────┘     │
│                                                  │
│  ┌────────────────────────────────────────┐     │
│  │  examples.ts                           │     │
│  │  (10 usage examples)                   │     │
│  │  ↓ imports                             │     │
│  │  - ./clickhouse-connector              │     │
│  └────────────────────────────────────────┘     │
│                                                  │
│  ┌────────────────────────────────────────┐     │
│  │  index.ts                              │     │
│  │  (Clean re-exports)                    │     │
│  └────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
```

---

## ClickHouse Table Schema

### wallet_metrics_complete

```
┌─────────────────────────────────────────────────────┐
│  Table: wallet_metrics_complete                     │
│  Engine: ReplacingMergeTree(calculated_at)          │
│  Partition Key: window                              │
│  Primary Key: (wallet_address, window)              │
│                                                     │
│  Columns:                                           │
│  ├─ wallet_address (String) PRIMARY                 │
│  ├─ window (Enum8) PARTITION KEY                    │
│  │   '7d'=1, '30d'=2, '90d'=3, 'lifetime'=4         │
│  ├─ calculated_at (DateTime)                        │
│  ├─ metric_1_omega_gross (Decimal)                  │
│  ├─ metric_2_omega_net (Decimal) INDEXED            │
│  ├─ metric_3_gain_to_pain (Decimal)                 │
│  ├─ ...                                             │
│  ├─ metric_60_tail_ratio (Decimal) INDEXED          │
│  ├─ ...                                             │
│  ├─ metric_69_ev_per_hour_capital (Decimal) INDEXED │
│  ├─ ...                                             │
│  └─ metric_102_edge_source_decomp_json (String)     │
│                                                     │
│  Indexes:                                           │
│  ├─ idx_omega_net (minmax, granularity=4)           │
│  ├─ idx_ev_per_hour (minmax, granularity=4)         │
│  ├─ idx_resolved_bets (minmax, granularity=4)       │
│  ├─ idx_tail_ratio (minmax, granularity=4)          │
│  └─ idx_performance_trend (set, granularity=1)      │
│                                                     │
│  Partitions: 4                                      │
│  Rows per partition: ~2,500 (for 10K wallets)       │
│  Total rows: ~10,000                                │
│  Storage: ~50 MB                                    │
└─────────────────────────────────────────────────────┘
```

---

## Performance Comparison

### Unoptimized Query
```
SELECT * FROM wallet_metrics_complete
WHERE metric_2_omega_net > 3.0

Execution:
├─ Scan all 4 partitions       (4x data)
├─ Read all 105 columns        (30x data)
├─ No PREWHERE                 (16x rows)
├─ No index usage              (4x granules)
└─ Total time: 320ms
```

### Optimized Query
```
SELECT
  wallet_address,
  metric_2_omega_net AS omega_ratio
FROM wallet_metrics_complete
PREWHERE metric_2_omega_net > 3.0
WHERE window = 'lifetime'
SETTINGS max_threads = 4

Execution:
├─ Scan 1 partition            (partition pruning)
├─ Read 2 columns              (column pruning)
├─ PREWHERE filter             (early filtering)
├─ Use minmax index            (index utilization)
└─ Total time: 20ms

Speedup: 16x
```

---

## Summary

**Key Architectural Decisions:**

1. **Separation of Concerns**
   - Connector (SQL generation)
   - Mapping (field translation)
   - Types (interfaces)

2. **Performance First**
   - 6 optimization layers
   - Automatic optimization detection
   - Minimal data transfer

3. **Developer Experience**
   - Type-safe API
   - Simple query syntax
   - Comprehensive examples

4. **Production Ready**
   - Error handling & retries
   - Performance monitoring
   - Extensive testing

**Result: Sub-200ms queries on 10K wallets** ✅
