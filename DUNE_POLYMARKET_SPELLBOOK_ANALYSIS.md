# Dune Analytics Polymarket Spellbook - Architecture Analysis

**Date:** 2025-11-07
**Source:** https://github.com/duneanalytics/spellbook/tree/main/dbt_subprojects/daily_spellbook/models/_projects/polymarket/polygon
**Purpose:** Reference architecture for evaluating & cleaning Cascadian's 87-table schema

---

## Executive Summary

Dune's Polymarket Spellbook uses a **clean 15-table tiered architecture** (raw → base → staging → marts) with:
- **Atomic schema design:** Each table has a single, clear purpose
- **Incremental-first approach:** All tables support merge/upsert workflows
- **Denormalized marts:** Analytics tables optimize for query performance, not normalization
- **Two-stage P&L model:** Positions + resolutions (no complex payout vector calculations)

**Key Insight:** They avoid sophisticated P&L formulas by relying on **position snapshots + binary resolutions**, making their P&L calculation simple: `pnl = final_balance - cost_basis`. This is fundamentally different from Cascadian's complex payout vector approach.

---

## Core Tables by Tier

### Tier 1: Raw Tables (Blockchain Events)

| Table | Purpose | Key Fields | Source |
|-------|---------|-----------|--------|
| `polymarket_polygon_market_trades_raw` | CLOB trade events from blockchain | block_time, tx_hash, condition_id, asset_id, maker/taker, amount, shares, price, fee | CTFExchange + NegRiskCtfExchange OrderFilled events |
| `polymarket_polygon_positions_raw` | Daily token balance snapshots | day, address, token_id, balance | balances_incremental_subset_daily macro (Dune's generic token holder macro) |
| `polymarket_polygon_base_ctf_tokens` | Token registration events | condition_id, token0, token1, block_time | CTFExchange_evt_TokenRegistered + NegRiskCtfExchange_evt_TokenRegistered |
| `polymarket_polygon_base_market_conditions` | Market condition metadata | condition_id, condition_token, condition_status, oracle, outcome_slot_count | On-chain condition creation events |

### Tier 2: Staging/Enriched Tables (Joined & Normalized)

| Table | Purpose | Key Joins | Grain |
|-------|---------|-----------|-------|
| `polymarket_polygon_market_details` | On-chain + API merged market metadata | (API data) LEFT JOIN on-chain events LEFT JOIN resolutions | One row per **outcome token** (denormalized) |
| `polymarket_polygon_market_trades` | Enriched trades with market context | market_trades_raw LEFT JOIN market_details | One row per **trade** |
| `polymarket_polygon_positions` | Enriched position snapshots with market metadata | positions_raw INNER JOIN market_details | One row per **address, token, day** |
| `polymarket_polygon_users_capital_actions` | Deposits, withdrawals, conversions | Magic wallet + Safe proxy lookups UNION'd into events | One row per **capital action** |
| `polymarket_polygon_market_outcomes` | Market resolution outcomes | Extracted from API or oracle data | One row per **market outcome** |
| `polymarket_polygon_market_prices_*` | Daily/hourly token prices | From trading data aggregations | One row per **token, period** |

### Tier 3: User Reference Tables (Dimensional)

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `polymarket_polygon_users_safe_proxies` | Safe wallet proxy mappings | eoa, safe_proxy, creation_time, first_funder |
| `polymarket_polygon_users_magic_wallet_proxies` | Magic.link proxy mappings | eoa, magic_proxy, creation_time |
| `polymarket_polygon_users` | Unified user directory | address, wallet_type, funding_metadata |

### Tier 4: Analytics Marts (Final Output Tables)

| Table | Purpose | Grain | Key Optimizations |
|-------|---------|-------|-------------------|
| `polymarket_polygon_markets` | Market directory + metadata | One row per **market** | Fast market lookups |
| `polymarket_polygon_*_prices_daily` | End-of-day prices | One row per **condition_id, token_id, day** | Time-series queries |
| `polymarket_polygon_*_prices_latest` | Most recent prices | One row per **condition_id, token_id** | Real-time dashboards |

**Total: 15 tables with clear hierarchy (raw → base → staging → marts)**

---

## Data Lineage Flow

```
Blockchain Events (Dune raw tables)
    ↓
CTFExchange_evt_TokenRegistered → polymarket_polygon_base_ctf_tokens
CTFExchange_evt_OrderFilled → polymarket_polygon_market_trades_raw
Token balances → polymarket_polygon_positions_raw
UMA MarketPrepared events → market_details (on-chain enrichment)
    ↓
Polymarket API (external)
    ↓
polymarket_polygon_market_details (ON-CHAIN JOIN API)
    ↓
    ├─→ polymarket_polygon_market_trades (enrich trades)
    ├─→ polymarket_polygon_positions (enrich positions)
    ├─→ polymarket_polygon_market_prices_* (aggregate prices)
    ├─→ polymarket_polygon_markets (final market mart)
    └─→ polymarket_polygon_market_outcomes (resolutions)
        ↓
    [ANALYTICS QUERIES USE MARTS]
```

**Key Design Pattern:** Data flows ONE DIRECTION. Raw → base → staging → marts. No circular dependencies.

---

## P&L Calculation Architecture

### Their Approach: Simple & Direct

Dune does **NOT** implement complex P&L calculations in SQL. Instead, they:

1. **Capture positions snapshots** (`polymarket_polygon_positions`) with daily granularity
2. **Capture resolutions** (`polymarket_polygon_market_outcomes`) with binary winner
3. **Compute PnL in application code** or dashboards

**Their Formula (Implied):**
```
pnl = final_balance - cost_basis
```

Where:
- `final_balance` = Position balance at market resolution
- `cost_basis` = Sum of all buy transactions (in collateral, USDC)

### Why This Works for Dune

- **Outcome binary:** Each market resolves to exactly one outcome (0 or 1)
- **Final state only:** They snapshot positions daily, so settlement state is captured
- **No payout vectors:** Negative risk is handled at the market definition layer, not in P&L

### Why This DOESN'T Work for Cascadian

Cascadian uses **multi-outcome markets** with **payout vectors** (e.g., outcome 0 pays 0.25x, outcome 1 pays 0.75x). This requires:
- Tracking which shares you own (`shares`)
- Tracking the payout numerator for your winning outcome
- Computing: `pnl = shares * (payout_numerator / payout_denominator) - cost_basis`

**They don't need this complexity because Polymarket on Polygon only supports binary markets.**

---

## Schema Design Patterns

### Pattern 1: Denormalization at Marts Layer

Dune's `polymarket_polygon_market_details` is **intentionally denormalized**:
- One row per **outcome token** (not per market)
- Duplicates outcome name, question, market status across rows
- Reason: Faster joins in analytics queries (no multi-table lookups)

```sql
-- Staging (one row per outcome token)
FROM api_data
INNER JOIN on_chain_metadata USING (market_id)
LEFT JOIN resolutions USING (market_id)
-- Result: market appears 2x (once per outcome token)
```

### Pattern 2: Incremental Merge with Composite Keys

All large tables use incremental merge:
```sql
-- Dbt incremental:
-- Unique key: (block_time, evt_index, tx_hash)
-- Strategy: Merge on new blocks only
```

**Why:** Blockchain data is immutable, so they only process new blocks since last run.

### Pattern 3: Left Joins to Preserve Raw Data

When enriching raw tables, they **always left join** to ensure no rows are lost:
```sql
SELECT raw.*, enriched.*
FROM raw_table raw
LEFT JOIN enriched_table enriched ON raw.id = enriched.id
```

Never inner join at staging layer (only at final marts if intentional filtering).

### Pattern 4: Deduplication with Row_Number + First Value

For events that might fire multiple times:
```sql
WITH dedup AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY condition_id, token_id ORDER BY block_time) as rn
  FROM raw_events
)
SELECT * FROM dedup WHERE rn = 1
```

Keeps first occurrence only.

### Pattern 5: Null Filtering at End, Not Beginning

```sql
-- DO THIS (filter late)
SELECT * FROM enriched_table
WHERE token_id IS NOT NULL AND condition_id IS NOT NULL

-- NOT THIS (filter early and lose rows)
WHERE token_id IS NOT NULL
  AND condition_id IS NOT NULL
  AND ...
```

### Pattern 6: Separate Proxy User Tables, Then Union

Three proxy types:
1. `users_safe_proxies` - Safe wallet proxies
2. `users_magic_wallet_proxies` - Magic.link proxies
3. `users` - UNION of both + additional metadata

Then join to capital actions using the proxy address.

**Why:** Keeps concerns separate, enables debugging of specific proxy types.

---

## Naming Conventions

### Tier Naming

| Tier | Prefix/Suffix | Example |
|------|---------------|---------|
| Raw (Blockchain) | `*_raw` | `market_trades_raw`, `positions_raw` |
| Base (Simple transforms) | `base_*` | `base_ctf_tokens`, `base_market_conditions` |
| Staging | no prefix | `market_trades`, `market_details`, `positions` |
| Marts | no prefix | `markets`, `users` (used in analytics) |
| Lookup/Dimensional | no prefix (but context clear) | `users_safe_proxies`, `market_prices_latest` |

### Field Naming

| Convention | Example | Reason |
|-----------|---------|--------|
| Timestamps | `block_time`, `resolved_on_timestamp` | Explicit about source |
| Blockchain refs | `tx_hash`, `block_number`, `contract_address` | Clarity on immutable ID |
| Amounts | `amount` (collateral), `shares` (tokens) | Domain-specific distinction |
| IDs | `condition_id`, `token_id`, `question_id` | Always explicit about ID type |
| Flags | `active`, `closed`, `accepting_orders` | Boolean fields |
| Computed | `price`, `unique_key` | Derived from raw fields |

### Incremental Markers

No special naming; instead, use dbt config:
```yaml
models:
  polymarket_trades:
    materialized: incremental
    unique_id: [block_time, evt_index, tx_hash]
    on_schema_change: fail
```

---

## Source of Truth vs. Derived

### Source of Truth (Write Once, Read Many)

1. **Blockchain Events (Raw Tables)**
   - `polymarket_polygon_market_trades_raw`
   - `polymarket_polygon_positions_raw`
   - `polymarket_polygon_base_ctf_tokens`
   - Reason: Immutable, canonical source from Dune's extraction layer

2. **API Snapshots (Semi-External)**
   - `polymarket_polygon_market_details` (API portion)
   - Merged with on-chain data, but API snapshot is the reference for market metadata
   - Reason: Polymarket API is authoritative for market names, descriptions, links

### Derived Tables (Read-Heavy, Recomputable)

1. **Enriched Staging**
   - `polymarket_polygon_market_trades`, `polymarket_polygon_positions`
   - Reason: Simple left joins of source tables
   - Can be regenerated from raw + API at any time

2. **Aggregations**
   - `polymarket_polygon_market_prices_daily/hourly`
   - Reason: Computed from `market_trades` data
   - Can be recalculated from trades

3. **User Lookups**
   - `polymarket_polygon_users`
   - Reason: Convenience table combining safe + magic proxies
   - Can be regenerated from source proxy tables

### Never Write to Raw Tables Directly

All updates flow through:
1. Blockchain extraction (Dune raw tables)
2. dbt incremental merges (with deduplication)
3. Cascading updates (raw → base → staging → marts)

---

## Key Contrasts with Cascadian

| Aspect | Dune Approach | Cascadian Current | Cascadian Should Be |
|--------|---------------|-------------------|-------------------|
| **P&L Complexity** | Simple (position + resolution) | Complex (payout vectors) | Complex but disciplined |
| **Table Count** | 15 (clean hierarchy) | 87 (messy) | 25-30 (proposed clean) |
| **Denormalization** | Intentional at marts | Mixed across all layers | Intentional at marts, normalized elsewhere |
| **Incremental Strategy** | Merge on composite key | Ad-hoc per table | Standardized merge pattern |
| **Raw Data Preservation** | Always left join | Sometimes lost | Never lose raw data |
| **Resolution Source** | Binary (market definition) | Binary (from oracle) | Payout vector (different problem) |
| **Proxy Handling** | Separate tables then union | Mixed in single user table | Separate lookup, join as needed |
| **Computed Fields** | In marts or dashboards | In multiple staging tables | In final marts only |

---

## Recommended Clean Schema for Cascadian

Based on Dune's pattern, Cascadian should use:

### Tier 1: Raw Tables (Immutable, Blockchain Events)
```
1. trades_raw (CLOB fills)
2. transfers_raw (ERC1155 + ERC20)
3. condition_registrations_raw
4. market_resolutions_raw (from oracle)
5. position_snapshots_raw (daily balances)
```

### Tier 2: Base/Mapping Tables (Simple Transforms)
```
6. ctf_token_mapping (condition_id → token pairs)
7. condition_metadata (condition_id → market context)
8. outcome_resolver_map (outcome text → index mapping)
```

### Tier 3: Staging/Enriched (Normalized)
```
9. trades_enriched (raw + mapped condition_id, outcome_index)
10. positions_enriched (snapshots + market context)
11. capital_flows (deposits/withdrawals only)
12. wallet_proxies (EOA → proxy mappings)
```

### Tier 4: Computed (Read-Heavy)
```
13. trades_canonical (dedup + direction inference)
14. winning_outcomes (market → outcome_index at resolution)
15. positions_at_resolution (final balance before settlement)
```

### Tier 5: Analytics (PnL Marts)
```
16. wallet_pnl (final PnL by wallet, computed from positions × vectors)
17. market_pnl (PnL by market, rolled up)
18. daily_prices (price snapshots)
```

**Total: 18 tables (vs. current 87)**

---

## Implementation Checklist for Cascadian Cleanup

- [ ] **Freeze Raw Tables:** Mark trades_raw, transfers_raw as append-only, document schema
- [ ] **Implement Tier 2 Mapping:** Build ctf_token_mapping, outcome_resolver_map with clear grain
- [ ] **Standardize Enrichment:** All staging tables use LEFT JOIN to preserve raw rows
- [ ] **Implement Incremental Merges:** All large tables use block_time/evt_index composite key + merge
- [ ] **Denormalize Marts Only:** Move computed fields (pnl, direction, outcome_index) to final layer
- [ ] **Create Proxy Lookup:** Separate wallet_proxies table, join as needed (don't duplicate)
- [ ] **Document Grain:** Every table's docstring must state its grain (e.g., "one row per trade", "one row per address, condition, day")
- [ ] **Remove Circular Dependencies:** Ensure data flows one direction only
- [ ] **Test Incremental Safety:** Verify rerun of any table produces identical results
- [ ] **Archive Old Tables:** Move 70 unused tables to archive/ directory with justification

---

## Files Referenced

- Dune Spellbook: https://github.com/duneanalytics/spellbook/tree/main/dbt_subprojects/daily_spellbook/models/_projects/polymarket/polygon
- Models analyzed:
  - polymarket_polygon_market_trades_raw.sql
  - polymarket_polygon_positions_raw.sql
  - polymarket_polygon_market_details.sql
  - polymarket_polygon_market_trades.sql
  - polymarket_polygon_positions.sql
  - polymarket_polygon_users_capital_actions.sql
  - _schema.yml

---

## Next Steps

1. **Compare grain:** Map Cascadian's 87 tables to Dune's 15-table grain
2. **Identify consolidation opportunities:** Which tables can merge?
3. **Design P&L isolation:** Isolate payout vector logic to final marts only
4. **Implement incremental gates:** Add dbt merge configs with composite keys
5. **Archive and document:** Deprecate unused tables with migration plan

