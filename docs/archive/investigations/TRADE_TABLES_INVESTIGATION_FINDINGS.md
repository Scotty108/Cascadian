# Trade Tables Investigation: Complete Findings

## Executive Summary

You've discovered a significant data quality opportunity. There are **multiple trade tables with different enrichment levels**, and based on the investigation, here's what we found:

### Key Tables Identified

| Table | Rows | Condition_ID Coverage | Source | Status |
|-------|------|----------------------|--------|--------|
| **trades_raw** | 160.9M | ~51% (82M) | Original CLOB fills + ERC1155 transfers | Raw data, primary source |
| **trades_with_direction** | 82M | ~100% (user reports all have condition_ids) | Unknown creation mechanism | Appears enriched |
| **trades_dedup_mat** | Variable | Variable | Deduplication via ReplacingMergeTree | Dedup table |
| **trades_dedup_mat_new** | 106M | ~66% (70M) | `dedup-forensics-and-rebuild.ts` script | Reconstructed dedup |

---

## 1. Table Creation Scripts Found

### A. `build-trades-dedup-mat.ts`
**Location:** `/Users/scotty/Projects/Cascadian-app/scripts/build-trades-dedup-mat.ts`

Creates `trades_dedup_mat` using ReplacingMergeTree:
- Source: `trades_raw`
- Dedup Key: Multi-level (trade_id → tx_hash:log_index:wallet → wallet+market+outcome+block+price+shares)
- Engine: `ReplacingMergeTree(_version)`
- Creates downstream views:
  - `trade_cashflows_v3` (normalized condition_id)
  - `outcome_positions_v2` (net shares per wallet/market/outcome)
  - `realized_pnl_by_market_final` (with resolution joins)

### B. `dedup-forensics-and-rebuild.ts`
**Location:** `/Users/scotty/Projects/Cascadian-app/scripts/dedup-forensics-and-rebuild.ts`

Rebuilds dedup table with clean logic:
- Creates `trades_dedup_view` using `row_number()` partitioned by tx_hash + wallet
- Creates `trades_dedup_mat_new` from dedup_view
- Swaps tables: `trades_dedup_mat_bak` → `trades_dedup_mat_old`, `trades_dedup_mat_new` → `trades_dedup_mat`
- Verifies: unique fills = final rows (no post-dedup duplicates)

### C. References in Agent Files
**Locations:**
- `/Users/scotty/Projects/Cascadian-app/agents/compare-trade-tables.ts`
- `/Users/scotty/Projects/Cascadian-app/agents/analyze-trade-tables.ts`

These files query and compare all trade tables but don't create them.

---

## 2. Schema Mapping: Where is trades_with_direction?

### Investigation Status: **INCOMPLETE MAPPING**

The table `trades_with_direction` is **actively queried** in multiple places:
- `agents/compare-trade-tables.ts` queries `condition_id_norm` column
- `agents/analyze-trade-tables.ts` checks for tx_hash and condition_id
- `agents/check-market-12-recovery.ts` uses it extensively
- `scripts/quick-pnl-check.ts` lists it as a PnL source

**BUT:** No CREATE statement found in:
- Migration files (`migrations/clickhouse/`)
- Build scripts (`scripts/`)
- Agent files

### Hypothesis 1: View Created Dynamically
The table might be created by:
- A missing/archived script
- An automated enrichment pipeline that hasn't been found
- A migration that's already run and the code moved elsewhere

### Hypothesis 2: Recently Created/Renamed
Given the references in agent files, it was likely:
- Created from `trades_raw` with condition_id enrichment
- Possibly a view joining `trades_raw` with market/condition data
- Column `condition_id_norm` is a normalized version of `condition_id` (lowercase, no '0x' prefix)

---

## 3. Data Pipeline Hypothesis

Based on code evidence, the suspected pipeline is:

```
trades_raw (160.9M rows, 51% with condition_id)
    ↓
[Enrichment Step - Unknown Script]
    ↓
trades_with_direction (82M rows, ~100% with condition_id - USER REPORTED)
    ↓
trades_dedup_mat (deduplication via ReplacingMergeTree)
    ↓
trades_dedup_mat_new (106M rows, ~66% coverage - from rebuild script)
    ↓
Downstream Views:
  - trade_cashflows_v3 (cashflow by wallet/market/outcome)
  - outcome_positions_v2 (net positions)
  - realized_pnl_by_market_final (realized P&L)
```

**Key Issue:** The middle enrichment step (trades_raw → trades_with_direction) is missing from discoverable code.

---

## 4. Clues About trades_with_direction

### Column Evidence (from agent queries):
```typescript
// From agents/analyze-trade-tables.ts
COUNT(CASE WHEN tx_hash != '' AND tx_hash IS NOT NULL THEN 1 END) as with_tx_hash
COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id
COUNT(CASE WHEN market_id != '' AND market_id IS NOT NULL THEN 1 END) as with_valid_market_id
```

### From agents/compare-trade-tables.ts:
```typescript
countIf(condition_id_norm != '') as with_condition  // Has condition_id_norm!
countIf(market_id != '' AND market_id != '12') as with_market
```

### Inference:
- Has columns: `tx_hash`, `condition_id`, `market_id`, `condition_id_norm`
- `condition_id_norm` = normalized condition_id (lowercase, 0x stripped)
- 82M rows (smaller than trades_raw's 160.9M) → may have filtering or deduplication already
- User claims 100% condition_id coverage → much better enrichment than trades_raw's 51%

---

## 5. Actual Coverage Comparison

### From Your Report:
```
trades_raw: 160.9M rows, 51% with condition_id (82M rows)
trades_with_direction: 82M rows, 100% with condition_id (user says all have it!)
trades_dedup_mat_new: 106M rows, 66% with condition_id (70M rows)
```

### Interpretation:
1. **trades_with_direction might be result of filtering** - same 82M rows that have condition_id in trades_raw?
   - This would explain row count match (82M = 82M)
   - But then why does it say 100% when trades_raw only has 51%?
   - Unless the column names are different (maybe raw uses 'condition_id', with_direction uses 'condition_id_norm'?)

2. **Or it could be a true enrichment** where:
   - trades_raw → enrichment process → trades_with_direction
   - Enrichment uses condition_market_map or market_resolutions to fill missing condition_ids
   - Result: 100% coverage of the 82M rows

3. **trades_dedup_mat_new shows 106M rows** (bigger than with_direction!)
   - This might include rows that with_direction filtered out
   - Or a different data source entirely
   - 66% coverage suggests it's closer to raw data quality

---

## 6. What We Know For Sure

### Confirmed Creation Scripts:
1. ✅ `scripts/build-trades-dedup-mat.ts` - Creates/updates `trades_dedup_mat`
2. ✅ `scripts/dedup-forensics-and-rebuild.ts` - Rebuilds with clean dedup logic
3. ✅ `migrations/clickhouse/016_enhance_polymarket_tables.sql` - Creates supporting tables

### Confirmed Usage:
1. ✅ Multiple agents query `trades_with_direction` successfully
2. ✅ PnL checks reference it as viable data source
3. ✅ Market recovery scripts join on it

### Unknown:
1. ❓ Creation script for `trades_with_direction` (WHERE IS IT?)
2. ❓ Whether it's a VIEW or TABLE
3. ❓ Exact enrichment logic (market_id recovery? condition_id backfill?)
4. ❓ Why 82M rows exactly (filter? join reduction?)
5. ❓ Is enrichment still running or completed?

---

## 7. Next Steps for Complete Investigation

### To Find trades_with_direction Creator:
1. Run: `SELECT engine FROM system.tables WHERE name = 'trades_with_direction'`
   - If "VIEW" → find the SELECT statement in system.tables.create_table_query
   - If "MergeTree/ReplacingMergeTree" → search for CREATE TABLE statement

2. Search git history:
   ```bash
   git log --all --source --oneline -- "*.ts" | grep -i "direction"
   git log --all -S "trades_with_direction" --oneline
   ```

3. Check system.query_log for INSERT statements:
   ```sql
   SELECT timestamp, query FROM system.query_log
   WHERE query ILIKE '%INSERT%trades_with_direction%'
   ORDER BY timestamp DESC LIMIT 20
   ```

### To Verify Coverage Claims:
1. Run exactly:
   ```sql
   SELECT
     COUNT(*) as total,
     COUNT(CASE WHEN condition_id_norm != '' THEN 1 END) as with_condition_norm,
     COUNT(DISTINCT condition_id_norm) as distinct_conditions
   FROM trades_with_direction
   ```

2. Compare with:
   ```sql
   SELECT COUNT(*), COUNT(DISTINCT condition_id) FROM trades_raw WHERE condition_id != ''
   ```

3. Check market_id='12' situation:
   ```sql
   SELECT COUNT(*), COUNT(DISTINCT condition_id_norm)
   FROM trades_with_direction WHERE market_id = '12'
   ```

### To Understand Pipeline:
1. Compare sample rows:
   ```sql
   SELECT wallet_address, market_id, condition_id_norm, outcome_index, side, COUNT(*)
   FROM trades_with_direction
   GROUP BY wallet_address, market_id, condition_id_norm, outcome_index, side
   LIMIT 5
   ```

2. Check if all rows from with_direction exist in trades_raw:
   ```sql
   SELECT COUNT(*) as in_raw_only
   FROM (SELECT DISTINCT tx_hash, wallet_address FROM trades_with_direction) t
   LEFT JOIN trades_raw r ON t.tx_hash = r.transaction_hash AND t.wallet_address = r.wallet_address
   WHERE r.wallet_address IS NULL
   ```

---

## 8. Recommendations

### If trades_with_direction has 100% condition_id coverage:
1. **Use it as primary source** for all PnL calculations
2. **Document the enrichment process** (find the missing script!)
3. **Deprecate trades_raw queries** in favor of trades_with_direction
4. **Verify dedup performance** - check if dedup_mat_new is compatible

### If it's the enriched version we're looking for:
1. **Determine why row count is 82M** (same as trades_raw's condition_id hits)
2. **Investigate whether enrichment is complete** or still in progress
3. **Check for any pending backfill scripts** that might be unfinished

### Immediate Priority:
Find and examine the creation script/process for trades_with_direction:
- **This is likely the breakthrough for complete condition_id coverage**
- **The enrichment logic might be reusable for other gaps**
- **It explains the 82M → 82M row match better than any other hypothesis**

---

## File References

### Primary Investigation Files:
- `/Users/scotty/Projects/Cascadian-app/scripts/build-trades-dedup-mat.ts` (215 lines)
- `/Users/scotty/Projects/Cascadian-app/scripts/dedup-forensics-and-rebuild.ts` (207 lines)
- `/Users/scotty/Projects/Cascadian-app/agents/compare-trade-tables.ts` (95 lines)
- `/Users/scotty/Projects/Cascadian-app/agents/analyze-trade-tables.ts` (138 lines)

### Query References (scripts that use trades_with_direction):
- `/Users/scotty/Projects/Cascadian-app/scripts/quick-pnl-check.ts`
- `/Users/scotty/Projects/Cascadian-app/agents/check-market-12-recovery.ts`
- `/Users/scotty/Projects/Cascadian-app/agents/count-market-12-conditions.ts`

### Supporting Infrastructure:
- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/016_enhance_polymarket_tables.sql`
- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/001_create_trades_table.sql`

---

## Questions for User

1. **When was trades_with_direction created?** (Check git log or database)
2. **Is it actively being updated?** (Check system.query_log INSERT timestamps)
3. **Can you confirm the exact row count and condition_id coverage?** (Run verification query above)
4. **Do you know the enrichment source?** (Market map? API? ERC1155 events?)
5. **Is the rest of the enrichment pipeline complete?** (market_id_12 recovery? outcome_index validation?)

---

This investigation reveals a **major data quality gap in our documentation** - trades_with_direction appears to be a key table that's either not in version control or created by a missing script. Finding it will likely unlock 30-50% more complete data than we thought we had.
