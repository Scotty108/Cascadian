# Trade Tables Comparison & Enrichment Status
## Quick Reference

### Current State

Three distinct trade tables with different quality levels:

```
TRADES_RAW
├─ Source: CLOB fills + ERC1155 transfers (raw ingestion)
├─ Rows: 160.9M
├─ Condition_ID Coverage: 51% (82M rows have condition_id)
├─ Market_ID Coverage: Partial (some entries are '12', some missing)
├─ Purpose: Primary source of truth
└─ Issues: Missing market/condition mappings for 78.9M rows

TRADES_WITH_DIRECTION ⭐ KEY TABLE
├─ Source: Unknown enrichment process (NOT FOUND IN CODE)
├─ Rows: 82M (same count as trades_raw condition_id hits)
├─ Condition_ID_NORM Coverage: 100% (user-reported, ALL rows have it)
├─ Market_ID Coverage: ~80% (filtering on valid market IDs)
├─ Purpose: Appears to be enriched/filtered version for analytics
└─ Status: MYSTERY - Need to find creation script!

TRADES_DEDUP_MAT_NEW
├─ Source: Dedup rebuild from trades_raw
├─ Rows: 106M
├─ Condition_ID Coverage: 66% (70M rows)
├─ Dedup Logic: row_number() OVER (PARTITION BY tx_hash, wallet)
├─ Purpose: Remove duplicate fills from same transaction
└─ Status: Complete and documented
```

---

## Critical Discovery

**The 82M Row Match:**
- `trades_raw` has exactly 82M rows WITH condition_id (51% of 160.9M)
- `trades_with_direction` has exactly 82M rows TOTAL
- **This is NOT a coincidence** - indicates:
  - Either: trades_with_direction IS the filtered set of trades_raw (condition_id != '')
  - Or: enrichment process selected the same 82M rows and added condition_id_norm

**Why This Matters:**
- If true enrichment: We've gained the "norm" version (lowercase, no 0x prefix)
- If just filtering: We haven't gained data, just normalized it
- **But user says 100% coverage** - that's the key question to resolve

---

## Data Quality Timeline

```
STARTING POINT (Raw Data):
  trades_raw: 160.9M rows
    ├─ 82M with condition_id (51%)
    └─ 78.9M without condition_id (49%) ← MISSING
         ├─ Some might be recoverable from condition_market_map
         ├─ Some might need market_id normalization
         └─ Some might be permanently lost

AFTER ENRICHMENT (Unknown Process):
  trades_with_direction: 82M rows
    ├─ 82M with condition_id_norm (100%)
    └─ All in valid markets (not '12')

AFTER DEDUP (Known Process):
  trades_dedup_mat_new: 106M rows (larger!)
    ├─ 70M with condition_id (66%)
    └─ 36M without condition_id (34%)
```

**Note:** trades_dedup_mat_new is LARGER than trades_with_direction, but has LESS coverage. This suggests:
- Different source or different dedup logic
- Or: with_direction already deduplicated before creation

---

## Key Files by Purpose

### For Enrichment Understanding:
1. `/Users/scotty/Projects/Cascadian-app/scripts/build-trades-dedup-mat.ts`
   - Shows downstream views expect `condition_id_norm`
   - References `market_id` filtering (excludes '12')
   - Creates PnL calculation views

2. `/Users/scotty/Projects/Cascadian-app/agents/compare-trade-tables.ts`
   - Actively compares all three tables
   - References `condition_id_norm` in trades_with_direction
   - Likely runs diagnostics

3. `/Users/scotty/Projects/Cascadian-app/agents/analyze-trade-tables.ts`
   - Detailed schema analysis of each table
   - Identifies presence of tx_hash, condition_id, market_id

### For Dedup Logic:
1. `/Users/scotty/Projects/Cascadian-app/scripts/dedup-forensics-and-rebuild.ts`
   - Documents exact dedup approach: row_number() over (tx_hash, wallet)
   - Creates trades_dedup_mat_new with 106M rows
   - Verifies: unique fills = final rows

### For Consumption:
1. `/Users/scotty/Projects/Cascadian-app/scripts/quick-pnl-check.ts`
   - Tests trades_with_direction as P&L source
   - Compares with other PnL tables
   - Expected to find ~80K P&L for known wallets

---

## Verification Queries (Run These Now)

### 1. Confirm trades_with_direction Exists and Structure
```sql
SELECT 
  engine,
  table_name,
  data_compressed_bytes / 1024 / 1024 AS size_mb
FROM system.tables
WHERE name = 'trades_with_direction'
  AND database = currentDatabase()
LIMIT 1
```

### 2. Check Definition if it's a View
```sql
SELECT create_table_query
FROM system.tables
WHERE name = 'trades_with_direction'
  AND database = currentDatabase()
```

### 3. Verify Condition_ID Coverage (User's Claim)
```sql
SELECT
  COUNT(*) as total_rows,
  COUNT(DISTINCT condition_id_norm) as distinct_conditions,
  COUNT(CASE WHEN condition_id_norm = '' THEN 1 END) as empty_condition_norm,
  COUNT(CASE WHEN market_id = '12' THEN 1 END) as market_12_rows,
  COUNT(CASE WHEN market_id != '12' AND market_id != '' THEN 1 END) as valid_market_rows
FROM trades_with_direction
```

### 4. Compare Coverage Across Tables
```sql
SELECT
  'trades_raw' as table_name,
  COUNT(*) as total,
  COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_cid,
  COUNT(DISTINCT condition_id) as distinct_cid
FROM trades_raw
UNION ALL
SELECT
  'trades_with_direction',
  COUNT(*) as total,
  COUNT(CASE WHEN condition_id_norm != '' THEN 1 END) as with_cid,
  COUNT(DISTINCT condition_id_norm) as distinct_cid
FROM trades_with_direction
UNION ALL
SELECT
  'trades_dedup_mat_new',
  COUNT(*) as total,
  COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_cid,
  COUNT(DISTINCT condition_id) as distinct_cid
FROM trades_dedup_mat_new
```

### 5. Find Creation History in Query Log
```sql
SELECT
  timestamp,
  query_duration_ms,
  written_rows,
  substring(query, 1, 150) as query_snippet
FROM system.query_log
WHERE table = 'trades_with_direction'
  AND type = 'QueryFinish'
ORDER BY timestamp DESC
LIMIT 30
```

---

## What's Missing (Action Items)

| Item | Status | Impact | Priority |
|------|--------|--------|----------|
| Find trades_with_direction CREATE script | 🔴 CRITICAL | Can't reproduce enrichment | P0 |
| Verify 100% condition_id coverage claim | 🟡 IMPORTANT | Confirms value of table | P1 |
| Understand why row count is exactly 82M | 🟡 IMPORTANT | Clarifies enrichment logic | P1 |
| Document enrichment process | 🟡 IMPORTANT | Enable future improvements | P2 |
| Compare dedup_mat_new vs with_direction | 🟢 NICE-TO-HAVE | Optimize table usage | P3 |

---

## Hypothesis: What Likely Happened

**Scenario:** Someone created a high-quality enriched table but didn't commit the script or documented it elsewhere

```
Phase 1: Data Ingestion (DONE)
→ trades_raw created with 160.9M rows

Phase 2: Enrichment (DONE but code missing?)
→ Script that:
  1. Takes trades_raw
  2. Joins with condition_market_map or market_resolutions
  3. Normalizes condition_id → condition_id_norm
  4. Filters to valid market_ids (excludes '12', empty, etc.)
  5. Creates trades_with_direction with 82M rows ← ONLY USES VALID CONDITION_ID ROWS
  6. All 82M rows end up with condition_id_norm filled

Phase 3: Deduplication (DONE)
→ dedup-forensics-and-rebuild.ts creates trades_dedup_mat_new
→ Uses row_number() logic
→ Result: 106M rows (includes rows without condition_id that with_direction filtered out)

Result: Two good paths:
- Path A: trades_raw → enrichment → trades_with_direction (82M, 100% quality)
- Path B: trades_raw → dedup → trades_dedup_mat_new (106M, 66% quality)
```

---

## Recommended Next Steps

### Immediate (Today):
1. Run the 5 verification queries above
2. Check if trades_with_direction is a VIEW or TABLE
3. If VIEW: Get the create_table_query from system.tables
4. If TABLE: Search git history for CREATE TABLE statement

### Short-term (This Week):
1. Find the enrichment script (check .claude/agents, archived files, etc.)
2. Verify exact row count and coverage claims
3. Understand which table is "canonical" for P&L calculations
4. Document the data pipeline with diagrams

### Medium-term (Next 2 Weeks):
1. Consider consolidating tables (choose winner: with_direction or dedup_mat_new?)
2. Document which table to use for what purpose
3. Set up automated verification of coverage metrics
4. Consider backfilling missing condition_ids for remaining 78.9M rows

---

## Expected Outcomes

If trades_with_direction has 100% condition_id coverage on 82M rows:
- **Data quality improvement:** 51% → 100% (for the 82M rows)
- **Usable volume:** From 82M to potentially 106M+ if we can backfill missing ids
- **PnL calculation:** Can use with_direction as reliable source (once verified)
- **Market analysis:** Can support complete condition-based analytics

If enrichment is still incomplete:
- **Potential:** Could reach 160.9M rows with complete enrichment
- **Opportunity:** Backfill missing condition_ids using market_resolutions_final
- **Timeline:** Depends on enrichment complexity (days to weeks)

---

## Bottom Line

You've found a **hidden gem of better data** - now we need to:
1. Understand its origin (find the creation script)
2. Verify its quality (run coverage queries)
3. Decide if we use it, expand it, or consolidate with other tables

**The 82M → 82M row match is the smoking gun.** It tells us trades_with_direction IS related to the complete condition_id records from trades_raw, but with some transformation that added the _norm suffix and confirmed coverage.

Finding that enrichment script is the key to scaling this approach to all 160.9M rows.
