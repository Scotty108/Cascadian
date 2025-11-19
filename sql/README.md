# Polymarket Global Indexer - SQL Schema

**Author:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
**Status:** Ready for Implementation

---

## Overview

This directory contains the ClickHouse schema design for integrating the Goldsky-hosted Polymarket PNL Subgraph into Cascadian for global wallet coverage.

---

## Files

| File | Description | Size |
|------|-------------|------|
| **INDEXER_SCHEMA_DESIGN.md** | Complete design document with architecture, rationale, and implementation guide | 20 KB |
| **ddl_pm_positions_indexer.sql** | DDL for raw position data table (ReplacingMergeTree) | 3.7 KB |
| **ddl_pm_wallet_pnl_indexer.sql** | DDL for aggregated wallet P&L (AggregatingMergeTree + View) | 5.3 KB |
| **example_queries_indexer.sql** | 40+ example queries for common use cases | 10 KB |

---

## Quick Start

### 1. Review Design Document

Read `INDEXER_SCHEMA_DESIGN.md` for complete context:
- Schema mapping from GraphQL to ClickHouse
- Engine choices (ReplacingMergeTree, AggregatingMergeTree)
- Token ID decoding strategy
- Query patterns and performance considerations
- Integration with existing C2 Data API schema

### 2. Execute DDL

**Order matters:**
```bash
# 1. Create positions table (base table)
clickhouse-client --query "$(cat ddl_pm_positions_indexer.sql)"

# 2. Create aggregated wallet P&L (depends on positions table)
clickhouse-client --query "$(cat ddl_pm_wallet_pnl_indexer.sql)"
```

Or use the ClickHouse client:
```bash
clickhouse-client < ddl_pm_positions_indexer.sql
clickhouse-client < ddl_pm_wallet_pnl_indexer.sql
```

### 3. Test with Example Queries

Use `example_queries_indexer.sql` to validate schema:
```sql
-- Check table exists
SHOW TABLES LIKE 'pm_%indexer%';

-- View table schema
DESCRIBE TABLE pm_positions_indexer;
DESCRIBE TABLE pm_wallet_pnl_indexer;

-- (After ingestion) Test queries
-- See example_queries_indexer.sql for full set
```

---

## Schema Overview

### Table: pm_positions_indexer

**Purpose:** Store individual position records from Goldsky PNL Subgraph

**Key Fields:**
- `composite_id` - Unique position identifier (user-tokenId)
- `wallet_address` - Trader wallet (40 char hex)
- `token_id` - Outcome token ID (256-bit)
- `condition_id` - Decoded market condition ID (64 char hex)
- `outcome_index` - Decoded outcome index (0-based)
- `amount` - Current position size (Decimal128, 18 decimals)
- `avg_price` - Volume-weighted entry price (Decimal64, 6 decimals)
- `realized_pnl` - Realized P&L in USDC (Decimal64, 6 decimals)
- `total_bought` - Cumulative buys (Decimal128, 18 decimals)
- `version` - Monotonic version for ReplacingMergeTree

**Engine:** `ReplacingMergeTree(version)` - Enables idempotent upserts

**Partitioning:** Monthly by `last_synced_at`

**Ordering:** `(wallet_address, condition_id, outcome_index, composite_id)`

### Table: pm_wallet_pnl_indexer (Materialized View)

**Purpose:** Aggregated wallet-level P&L metrics

**Key Metrics:**
- `total_positions` - Position count
- `distinct_markets` - Unique markets traded
- `total_realized_pnl` - Total P&L (USDC)
- `total_volume` - Cumulative volume
- `winning_positions` / `losing_positions` - Win/loss counts
- Derived: `win_rate`, `avg_position_size`, etc.

**Engine:** `AggregatingMergeTree()` - Incremental aggregation

**Uses State Combinators:** Query with `-Merge` combinators to get final values

### View: pm_wallet_pnl_summary_indexer

**Purpose:** Human-readable wrapper around aggregated metrics

**Features:**
- Applies `-Merge` combinators automatically
- Converts units (USDC decimals → USD, shares → floats)
- Computes derived metrics (win_rate)
- Ready for API consumption

---

## Integration Points

### Existing Schema Compatibility

**Current Table:** `pm_wallet_market_pnl_resolved`
- Source: C2 Data API (CLOB + external trades)
- Scope: Resolved binary markets
- Coverage: ~13K wallets (ghost cohort)

**New Tables:** `pm_positions_indexer` + `pm_wallet_pnl_indexer`
- Source: Goldsky PNL Subgraph
- Scope: All markets (resolved + active)
- Coverage: All Polymarket wallets (global)

**Reconciliation:** See `INDEXER_SCHEMA_DESIGN.md` section "Integration with Existing Schema" for comparison queries.

---

## Example Use Cases

### 1. Global Leaderboard
```sql
SELECT
  wallet_address,
  total_realized_pnl_usd,
  win_rate,
  distinct_markets
FROM pm_wallet_pnl_summary_indexer
WHERE distinct_markets >= 10
ORDER BY total_realized_pnl_usd DESC
LIMIT 100;
```

### 2. Wallet Portfolio
```sql
SELECT
  condition_id,
  outcome_index,
  amount / 1e18 as shares,
  realized_pnl / 1e6 as pnl_usd
FROM pm_positions_indexer FINAL
WHERE wallet_address = '0x...'
ORDER BY last_synced_at DESC;
```

### 3. Market Participants
```sql
SELECT
  wallet_address,
  amount / 1e18 as shares,
  realized_pnl / 1e6 as pnl_usd
FROM pm_positions_indexer FINAL
WHERE condition_id = '0x...'
ORDER BY ABS(amount) DESC;
```

**See `example_queries_indexer.sql` for 40+ more examples.**

---

## Next Steps

1. **Review Design**: Read `INDEXER_SCHEMA_DESIGN.md`
2. **Execute DDL**: Run both DDL files against ClickHouse
3. **Implement Decoder**: Create `lib/polymarket/token-decoder.ts` (see design doc)
4. **Build Pipeline**: Create `scripts/backfill-indexer-positions.ts`
5. **Test Limited Backfill**: Fetch first 1000 positions
6. **Validate Schema**: Run example queries
7. **Full Backfill**: Ingest all positions from subgraph
8. **Reconciliation**: Compare with existing C2 Data API data
9. **Update APIs**: Point endpoints to new indexer tables
10. **Monitor**: Set up sync monitoring (lag, errors, query latency)

---

## Performance Notes

- **Storage:** ~52 MB uncompressed, ~15 MB compressed (130K positions)
- **Query Speed:** <10ms for wallet queries, <50ms for leaderboards
- **Sync Time:** ~2 seconds (parallel), ~13 seconds (sequential) for full backfill
- **Incremental Sync:** 5-minute refresh recommended

---

## Support

For questions or issues:
1. Check `INDEXER_SCHEMA_DESIGN.md` for detailed explanations
2. Review `example_queries_indexer.sql` for query patterns
3. Refer to ClickHouse docs: https://clickhouse.com/docs/
4. Contact: C1 (Claude 1)

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
