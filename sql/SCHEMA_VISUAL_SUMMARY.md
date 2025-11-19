# Polymarket Global Indexer - Schema Visual Summary

**Quick reference for architecture and data flow**

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                  GOLDSKY PNL SUBGRAPH (GraphQL)                 │
│                                                                 │
│  type UserPosition {                                            │
│    id: ID!              # Composite: user-tokenId               │
│    user: String!        # Wallet address                        │
│    tokenId: BigInt!     # Outcome token ID (256-bit)            │
│    amount: BigInt!      # Net shares (18 decimals)              │
│    avgPrice: BigInt!    # Avg entry price (6 decimals)          │
│    realizedPnl: BigInt! # Realized P&L (USDC, 6 decimals)       │
│    totalBought: BigInt! # Cumulative buys (18 decimals)         │
│  }                                                              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ GraphQL Queries (paginated, 1000/page)
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              INGESTION PIPELINE (TypeScript)                    │
│                                                                 │
│  • Fetch positions in batches                                  │
│  • Decode tokenId → (conditionId, outcomeIndex)                │
│  • Transform units (BigInt → Decimal128/64)                    │
│  • Generate version timestamp                                  │
│  • Upsert to ClickHouse                                        │
│  • Checkpoint progress (crash protection)                      │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ INSERT statements
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│         pm_positions_indexer (ReplacingMergeTree)               │
│                                                                 │
│  • composite_id (PK)        # user-tokenId                      │
│  • wallet_address           # 40 char hex                       │
│  • token_id                 # 256-bit hex                       │
│  • condition_id (DERIVED)   # 64 char hex                       │
│  • outcome_index (DERIVED)  # 0-based                           │
│  • amount                   # Decimal128(18)                    │
│  • avg_price                # Decimal64(6)                      │
│  • realized_pnl             # Decimal64(6)                      │
│  • total_bought             # Decimal128(18)                    │
│  • version                  # UInt64 (upsert key)               │
│  • last_synced_at           # DateTime                          │
│                                                                 │
│  ORDER BY (wallet_address, condition_id, outcome_index)         │
│  PARTITION BY toYYYYMM(last_synced_at)                          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ Automatic materialized view update
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│      pm_wallet_pnl_indexer (AggregatingMergeTree)               │
│                                                                 │
│  • wallet_address (PK)                                          │
│  • total_positions           # countState()                     │
│  • distinct_markets          # uniqState(condition_id)          │
│  • total_realized_pnl        # sumState(realized_pnl)           │
│  • avg_realized_pnl          # avgState(realized_pnl)           │
│  • max_position_pnl          # maxState(realized_pnl)           │
│  • min_position_pnl          # minState(realized_pnl)           │
│  • total_volume              # sumState(total_bought)           │
│  • winning_positions         # countIfState(pnl > 0)            │
│  • losing_positions          # countIfState(pnl < 0)            │
│  • last_updated_at           # maxState(last_synced_at)         │
│                                                                 │
│  ORDER BY (wallet_address, total_realized_pnl)                  │
│  Uses -State combinators for incremental aggregation            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ View with -Merge combinators
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│       pm_wallet_pnl_summary_indexer (VIEW)                      │
│                                                                 │
│  Human-readable wrapper:                                        │
│  • Applies -Merge combinators (countMerge, sumMerge, etc.)     │
│  • Converts units (USDC decimals → USD, shares → floats)       │
│  • Computes derived metrics (win_rate)                          │
│                                                                 │
│  Ready for API consumption                                      │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ SELECT queries
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API ENDPOINTS                              │
│                                                                 │
│  • GET /api/leaderboard/global                                  │
│  • GET /api/wallets/:address/positions                          │
│  • GET /api/markets/:condition_id/participants                  │
│  • GET /api/wallets/:address/summary                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Table Relationships

```
┌──────────────────────────────────────────────────────────────┐
│  pm_positions_indexer (Base Table)                           │
│  ─────────────────────────────────────────────────────────   │
│  Each row = one wallet's position in one outcome             │
│                                                              │
│  Keys:                                                       │
│  • wallet_address + condition_id + outcome_index (logical)   │
│  • composite_id (physical)                                   │
│                                                              │
│  Cardinality: ~130K positions (estimated)                    │
└────────┬─────────────────────────────────────────────────────┘
         │
         │ GROUP BY wallet_address
         │ Aggregates via materialized view
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  pm_wallet_pnl_indexer (Aggregated Table)                    │
│  ─────────────────────────────────────────────────────────   │
│  Each row = one wallet's total metrics                       │
│                                                              │
│  Keys:                                                       │
│  • wallet_address (logical)                                  │
│                                                              │
│  Cardinality: ~13K wallets (estimated)                       │
└──────────────────────────────────────────────────────────────┘
```

---

## Token ID Decoding Flow

```
Input: tokenId (256-bit hex)
   │
   │  Example: "0xa1b2c3d4...e5f6" (64 chars)
   │
   ▼
┌─────────────────────────────────────┐
│  Split into components:             │
│  • First 64 chars = condition_id    │
│  • Remaining bits = collection_id   │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Decode outcome_index:              │
│  • collection_id = 2^outcome_index  │
│  • outcome_index = log2(collection) │
└────────────┬────────────────────────┘
             │
             ▼
Output: { condition_id, outcome_index }
   │
   │  Example: { "a1b2c3d4...", 1 }
   │
   ▼
Store in ClickHouse as separate columns
```

---

## Query Pattern Optimization

```
Query Type              Primary Key Hit?   Typical Speed
────────────────────────────────────────────────────────
By wallet_address       ✅ Yes (prefix)    < 10ms
By condition_id         ✅ Yes (2nd col)   < 50ms
By wallet + condition   ✅ Yes (exact)     < 5ms
By composite_id         ✅ Yes (suffix)    < 10ms
Global aggregates       ⚠️  No (scan)      < 100ms*
Recent updates          ⚠️  Partition     < 20ms

* pm_wallet_pnl_summary_indexer uses pre-aggregated data
```

---

## Upsert Mechanism (ReplacingMergeTree)

```
Initial Insert:
┌──────────────────────────────────────────────────────┐
│  composite_id    │  amount  │  version              │
│──────────────────────────────────────────────────────│
│  user1-token1    │  100     │  1731700000000        │
└──────────────────────────────────────────────────────┘

Updated Insert (same composite_id, higher version):
┌──────────────────────────────────────────────────────┐
│  composite_id    │  amount  │  version              │
│──────────────────────────────────────────────────────│
│  user1-token1    │  150     │  1731700300000        │
└──────────────────────────────────────────────────────┘

After OPTIMIZE or Query with FINAL:
┌──────────────────────────────────────────────────────┐
│  composite_id    │  amount  │  version              │
│──────────────────────────────────────────────────────│
│  user1-token1    │  150     │  1731700300000  ✅    │
└──────────────────────────────────────────────────────┘
                     (older version removed)
```

---

## Unit Conversions

```
Storage Format → Display Format
───────────────────────────────────────────────────────
amount (Decimal128)              / 1e18  →  shares (float)
avg_price (Decimal64)            / 1e6   →  price (0.00-1.00)
realized_pnl (Decimal64)         / 1e6   →  USD (float)
total_bought (Decimal128)        / 1e18  →  shares (float)

Examples:
  amount: 1500000000000000000    →  1.5 shares
  avg_price: 650000              →  0.65 (65%)
  realized_pnl: 12500000         →  $12.50 USD
  total_bought: 5000000000000000000 → 5.0 shares
```

---

## Incremental Sync Strategy

```
┌─────────────────────────────────────────────────────┐
│  Initial Backfill (Phase B.5)                       │
│  ─────────────────────────────────────────────────  │
│  1. Fetch ALL positions from subgraph              │
│  2. Process in batches of 1000                     │
│  3. Insert to pm_positions_indexer                 │
│  4. Save checkpoint after each batch               │
│  5. Resume from checkpoint on crash                │
│                                                     │
│  Estimated time: 2-13 seconds                      │
└─────────────────────────────────────────────────────┘
         │
         │  Initial backfill complete
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Incremental Sync (Continuous)                      │
│  ─────────────────────────────────────────────────  │
│  Every 5 minutes:                                   │
│  1. Query positions updated since last_sync         │
│  2. Decode and transform                            │
│  3. Upsert to pm_positions_indexer                 │
│  4. ReplacingMergeTree handles dedup automatically │
│                                                     │
│  Typical batch size: 100-500 positions             │
└─────────────────────────────────────────────────────┘
```

---

## State Combinator Pattern (AggregatingMergeTree)

```
Storage (using -State combinators):
┌─────────────────────────────────────────────────────┐
│  wallet_address │  total_positions (AggregateState) │
│─────────────────────────────────────────────────────│
│  0xabc...       │  <binary state: count=10>         │
│  0xdef...       │  <binary state: count=25>         │
└─────────────────────────────────────────────────────┘

Query (using -Merge combinators):
SELECT
  wallet_address,
  countMerge(total_positions) as total_positions
FROM pm_wallet_pnl_indexer
GROUP BY wallet_address;

Result:
┌─────────────────────────────────────┐
│  wallet_address │  total_positions  │
│─────────────────────────────────────│
│  0xabc...       │  10               │
│  0xdef...       │  25               │
└─────────────────────────────────────┘
```

---

## Integration with Existing System

```
┌──────────────────────────────────────────────────────────┐
│  EXISTING: pm_wallet_market_pnl_resolved                 │
│  ─────────────────────────────────────────────────────   │
│  Source: C2 Data API (CLOB + external trades)            │
│  Scope: Resolved binary markets only                     │
│  Coverage: ~13K wallets (ghost cohort)                   │
│  Use Cases:                                              │
│    • Fill-level detail for ghost cohort                  │
│    • Ghost markets not in CLOB                           │
│    • Trade-by-trade analysis                             │
└──────────────────────────────────────────────────────────┘
                         │
                         │  Reconcile P&L
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  NEW: pm_positions_indexer + pm_wallet_pnl_indexer       │
│  ─────────────────────────────────────────────────────   │
│  Source: Goldsky PNL Subgraph                            │
│  Scope: All markets (resolved + active)                  │
│  Coverage: All Polymarket wallets (global)               │
│  Use Cases:                                              │
│    • Global leaderboards                                 │
│    • Wallet discovery                                    │
│    • Real-time position tracking                         │
│    • Cross-market analytics                              │
└──────────────────────────────────────────────────────────┘

Reconciliation Query:
  Compare total_realized_pnl for overlapping wallets
  Flag discrepancies > $100 or > 10%
  Investigate systematic differences
```

---

## File Structure

```
sql/
├── README.md                          # Quick start guide
├── INDEXER_SCHEMA_DESIGN.md           # Complete design doc (20 KB)
├── SCHEMA_VISUAL_SUMMARY.md           # This file (visual reference)
├── ddl_pm_positions_indexer.sql       # Base table DDL
├── ddl_pm_wallet_pnl_indexer.sql      # Aggregated table DDL
└── example_queries_indexer.sql        # 40+ example queries

Next to implement:
lib/polymarket/token-decoder.ts        # Token ID decoding logic
scripts/backfill-indexer-positions.ts  # Ingestion pipeline
```

---

**Quick Reference Complete**

For detailed explanations, see `INDEXER_SCHEMA_DESIGN.md`
For usage examples, see `example_queries_indexer.sql`
For deployment, see `README.md`

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
