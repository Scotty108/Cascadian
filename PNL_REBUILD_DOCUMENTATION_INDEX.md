# P&L Rebuild Tables - Complete Documentation Index

## Overview
This index guides you through the three comprehensive documents that describe the complete Cascadian P&L rebuild pipeline.

---

## Three Core Documents

### 1. PNL_TABLES_REBUILD_LINEAGE.md
**Focus:** Data flow, architecture, and root cause analysis

**Read this for:**
- Understanding the complete data pipeline from blockchain to final P&L
- How data transforms through each stage (staging → flattening → enrichment → aggregation)
- Root cause of the hex vs integer market_id inconsistency
- Field normalization patterns (condition_id_norm vs market_id)
- Script execution order and dependencies

**Key sections:**
- Architecture overview diagram
- Source data tables (erc1155_transfers, erc20_transfers)
- Core rebuild scripts (in execution order)
- Data lineage step-by-step
- Market_id inconsistency diagnosis

---

### 2. PNL_TABLES_REBUILD_SQL.md
**Focus:** Exact SQL statements and complete file paths

**Read this for:**
- Exact CREATE TABLE and SQL statements for each rebuild step
- Complete absolute file paths for every script
- Primary rebuild script (daily-sync-polymarket.ts) with full SQL
- Alternative rebuild approaches (dedup mat, fast dedup)
- Schema inspection queries to diagnose issues
- Critical migration file and its UPDATE statements

**Key sections:**
- Primary daily rebuild script (step 1, step 2)
- Source table schemas
- Alternative rebuild approaches (Option A, Option B)
- Fast dedup rebuild
- Realized PnL view SQL
- Critical migration file location and update statement
- Schema inspection queries

---

### 3. PNL_REBUILD_SCRIPTS_INDEX.md
**Focus:** Organized script reference and quick lookup

**Read this for:**
- Quick reference to all 11 scripts in the pipeline
- Purpose and duration of each script
- View hierarchy and dependencies
- Configuration details for each script
- Critical issues identified
- Execution flow diagram
- Files summary table

**Key sections:**
- Primary daily rebuild script
- Data pipeline scripts (1-6 in order)
- Alternative rebuild approaches
- PnL calculation scripts
- Additional utilities
- View hierarchy
- Critical issues
- Execution flow diagram
- Files summary table

---

## Quick Navigation Guide

### "I want to understand the complete data flow"
→ Read: **PNL_TABLES_REBUILD_LINEAGE.md**
- Start with "Architecture Overview"
- Then read "Data Lineage" section
- Check "Market_id Inconsistency Problem" section

### "I need the exact SQL to rebuild tables"
→ Read: **PNL_TABLES_REBUILD_SQL.md**
- Jump to "1. DAILY REBUILD SCRIPT (Primary)"
- Copy the CREATE TABLE AS SELECT statements
- Check "Source Tables" section for schema

### "I need to fix the market_id format issue"
→ Read all three documents, focus on:
1. **LINEAGE**: "The Hex vs Integer Inconsistency Problem"
2. **SQL**: "6. CRITICAL: migration/clickhouse/016_enhance_polymarket_tables.sql"
3. **INDEX**: "Critical Issues Identified"

### "I need to understand the alternative rebuild approaches"
→ Read: **PNL_TABLES_REBUILD_SQL.md**
- Section: "3. ALTERNATIVE REBUILD: Build Trades Dedup Mat"
- Section: "4. FAST DEDUP REBUILD (Simpler Alternative)"

### "I need to run the complete pipeline"
→ Read: **PNL_REBUILD_SCRIPTS_INDEX.md**
- Jump to "Execution Flow Diagram"
- Or read "8. Critical Execution Order"

---

## File Location Reference

All documentation is saved in the project root:
```
/Users/scotty/Projects/Cascadian-app/

├── PNL_TABLES_REBUILD_LINEAGE.md       ← Architecture & data flow
├── PNL_TABLES_REBUILD_SQL.md           ← Exact SQL & file paths
├── PNL_REBUILD_SCRIPTS_INDEX.md        ← Organized script index
└── PNL_REBUILD_DOCUMENTATION_INDEX.md  ← This file
```

---

## Primary Script Location

**Main rebuild script:**
```
/Users/scotty/Projects/Cascadian-app/scripts/daily-sync-polymarket.ts
```

This single script rebuilds both:
- `outcome_positions_v2` (from erc1155_transfers)
- `trade_cashflows_v3` (from erc20_transfers)

---

## Critical Files in Pipeline

1. **Setup:** `scripts/create-transfer-staging-tables.ts`
2. **Backfill:** `scripts/step3-streaming-backfill-parallel.ts` (2-5 hours)
3. **Transform:** `scripts/flatten-erc1155.ts`
4. **Enrich:** `scripts/build-approval-proxies.ts`
5. **Enrich:** `scripts/flatten-erc1155-correct.ts`
6. **CRITICAL:** `migrations/clickhouse/016_enhance_polymarket_tables.sql`
   - WHERE THE MARKET_ID INCONSISTENCY IS INTRODUCED
   - No normalization applied to market_id
7. **Rebuild:** `scripts/daily-sync-polymarket.ts` (PRIMARY - USE THIS)
8. **View:** `scripts/fix-realized-pnl-view.ts`

---

## Key Concepts

### market_id Format Issue
- **Root cause:** `migrations/clickhouse/016_enhance_polymarket_tables.sql` (line 264)
- **Problem:** Copies `gamma_markets.market_id` without normalization
- **Result:** HEX and INTEGER formats coexist, causing duplicate records
- **Impact:** 2-3x inflation of position rows
- **Fix location:** Choose ONE:
  - In migration (at enrichment time)
  - In daily-sync script (at rebuild time)
  - In view definitions (in-query)

### Proper Normalization Pattern
```typescript
// condition_id_norm (CORRECT):
lower(replaceAll(condition_id, '0x', ''))

// market_id (INCORRECT):
lower(market_id)  // Just lowercase, doesn't normalize
```

---

## Documents at a Glance

| Document | Lines | Focus | Best For |
|----------|-------|-------|----------|
| LINEAGE | 463 | Architecture & flow | Understanding the big picture |
| SQL | 509 | Code & statements | Getting exact SQL |
| INDEX | 371 | Script reference | Quick lookup & dependencies |
| This Doc | - | Navigation | Finding what you need |

---

## Command Reference

### Run Primary Rebuild
```bash
npx tsx scripts/daily-sync-polymarket.ts
```

### Check for market_id Inconsistency
```sql
SELECT 
  market_id,
  CASE 
    WHEN startsWith(market_id, '0x') THEN 'HEX'
    WHEN market_id ~ '^[0-9]+$' THEN 'INTEGER'
    ELSE 'OTHER'
  END AS format,
  count(*) AS row_count
FROM outcome_positions_v2
GROUP BY market_id, format
ORDER BY row_count DESC
LIMIT 20;
```

---

## Summary

You now have complete documentation of:
- **What:** 11 scripts that rebuild the P&L tables
- **Where:** Exact file paths for each
- **How:** Complete SQL statements and execution order
- **Why:** Root cause analysis of the market_id inconsistency
- **Fix:** Three possible locations to normalize market_id

---

## Next Steps

1. **Read LINEAGE.md** - Understand the architecture
2. **Read SQL.md** - Get the exact statements
3. **Read INDEX.md** - Understand dependencies
4. **Run daily-sync-polymarket.ts** - Rebuild the tables
5. **Run diagnostic query** - Check for market_id inconsistency
6. **Apply fix** - Normalize market_id in one location

---

## Document Versions

Created: 2025-11-06
Scope: Complete Cascadian P&L rebuild pipeline analysis
Coverage: All 11 scripts from blockchain logs to final P&L views
Focus: Data lineage, SQL statements, and format inconsistencies

---

For detailed information, see the three core documents in this directory.
