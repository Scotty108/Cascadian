# Step 1: Database Inventory - Complete Index

## Overview

This directory contains the complete database inventory for P&L reconciliation. All tasks completed successfully.

## Documents

### 1. Main Inventory Document
**File:** `PNL_RECONCILIATION_INVENTORY.md` (21 KB)

Comprehensive 6-task inventory covering:
- Task 1: trades_raw table analysis (schema, row counts, uniqueness)
- Task 2: Tables matching 5 pattern categories (30+ tables catalogued)
- Task 3: Resolution table candidates (3 sources identified)
- Task 4: Mapping table candidates (4 sources identified)
- Task 5: Winning outcome columns (win_idx identified)
- Task 6: Market-to-condition bridge (canonical_condition identified)

Includes:
- Full CREATE TABLE/VIEW DDL
- Complete column definitions
- Purpose and usage notes
- Sample join patterns
- Schema relationship diagram

### 2. Quick Reference Guide
**File:** `INVENTORY_QUICK_REFERENCE.md` (2.2 KB)

Quick lookup guide with:
- 3 critical tables for P&L
- Supporting tables list
- P&L formula
- Join pattern template
- Table relationship diagram
- Status summary table

## Key Findings Summary

### The Three Critical Tables

| Table/View | Type | Purpose | Key Column |
|-----------|------|---------|-----------|
| `trades_raw` | TABLE | Source trades data | `outcome_index` |
| `canonical_condition` | VIEW | market_id to condition_id_norm bridge | `condition_id_norm` |
| `winning_index` | VIEW | condition_id_norm to winning outcome index | `win_idx` |

### Supporting Tables

- **`market_outcomes_expanded`** (VIEW) - Maps condition_id_norm to outcome indices
- **`market_resolutions`** (TABLE) - Raw resolution data source
- **`ctf_token_map`** (TABLE) - Token ID mappings source
- **`condition_market_map`** (TABLE) - Alternative mapping source

## The P&L Calculation

```
WINNER = (trades_raw.outcome_index == winning_index.win_idx)
REALIZED_PNL = IF(WINNER, shares - usd_value, -usd_value)
```

## The Join Pattern

```sql
FROM trades_raw t
JOIN canonical_condition cc ON t.market_id = cc.market_id
LEFT JOIN winning_index wi ON cc.condition_id_norm = wi.condition_id_norm
WHERE wi.win_idx IS NOT NULL
```

## Tables by Category

### Resolution Tables (4)
- `market_resolutions` (source)
- `market_resolutions_final` (final)
- `resolutions_norm` (view - normalized)
- `winning_index` (view - PRIMARY FOR P&L)

### Outcome Tables (2)
- `market_outcomes` (source)
- `market_outcomes_expanded` (view - expanded with indices)

### Condition Tables (2)
- `condition_market_map` (dimension)
- `canonical_condition` (view - PRIMARY BRIDGE)

### Token Mapping Tables (2)
- `ctf_token_map` (source)
- `token_market_enriched` (view)

### Market Tables (20+)
- `gamma_markets` (source)
- `markets_dim` (dimension)
- `markets_enriched` (view)
- And 17+ analytics tables

## Inventory Checklist

- [x] Task 1: trades_raw table analysis
  - [x] Schema documented
  - [x] 25+ columns identified
  - [x] P&L enrichments noted
  
- [x] Task 2: Tables by pattern
  - [x] *resolution* → 4 tables
  - [x] *outcome* → 2 tables
  - [x] *condition* → 2 tables
  - [x] *token_map* → 2 tables
  - [x] *market* → 20+ tables

- [x] Task 3: Resolution candidates
  - [x] market_resolutions_final (identified)
  - [x] resolutions_norm (identified)
  - [x] winning_index (PRIMARY identified)

- [x] Task 4: Mapping candidates
  - [x] canonical_condition (PRIMARY identified)
  - [x] market_outcomes_expanded (identified)
  - [x] ctf_token_map (identified)
  - [x] condition_market_map (identified)

- [x] Task 5: Winning outcome column
  - [x] win_idx in winning_index (identified)

- [x] Task 6: Market-to-condition bridge
  - [x] canonical_condition (identified as PRIMARY)

## Step 2: Next Actions

When ready to proceed to P&L validation (Step 2):

1. Execute trades_raw row count query
2. Verify trade_id uniqueness
3. Sample data from resolution tables
4. Sample data from mapping tables
5. Run complete P&L calculation
6. Validate against expected results
7. Identify edge cases

## Reference Files

Source files used in this inventory:
- `/migrations/clickhouse/001_create_trades_table.sql`
- `/migrations/clickhouse/014_create_ingestion_spine_tables.sql`
- `/migrations/clickhouse/015_create_wallet_resolution_outcomes.sql`
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql`
- `/scripts/realized-pnl-fix-final.ts`
- `/lib/clickhouse/client.ts`

## Contact

For questions on database structure, refer to:
- Main inventory: `PNL_RECONCILIATION_INVENTORY.md`
- Quick reference: `INVENTORY_QUICK_REFERENCE.md`

---

**Step 1 Complete** - Ready for Step 2: P&L Validation
