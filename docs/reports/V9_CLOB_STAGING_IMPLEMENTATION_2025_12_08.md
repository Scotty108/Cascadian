# V9 CLOB Staging Implementation

**Date:** 2025-12-08
**Status:** WORKING - Parity Verified

---

## Problem

The original v9 rebuild approach using `vw_pm_trader_events_wallet_dedup_v2` (a VIEW) was taking 6+ hours because:
- The VIEW recomputes GROUP BY on 800M+ rows on every access
- This means every INSERT chunk was re-doing the dedupe calculation
- Memory limits were being hit due to expensive GROUP BY operations

## Solution

Created a **physical staging table** using ReplacingMergeTree that:
1. Stores all raw events once (no GROUP BY during INSERT)
2. Auto-dedupes via ReplacingMergeTree engine during background merges
3. Uses ORDER BY (event_id, trader_wallet, role) as the dedupe key
4. Queries use FINAL modifier to get deduped results

### Performance Improvement

| Approach | Time for 8 days | Notes |
|----------|-----------------|-------|
| VIEW-based | 6+ hours | Re-computes GROUP BY every chunk |
| Staging table | ~2 minutes | Pre-deduped, just reads and joins |

That's a **180x speedup**.

---

## Files Created

### Staging Table Script
`tmp/create-clob-staging-v2.ts`
- Creates `pm_trader_events_dedup_v2_tbl` with ReplacingMergeTree engine
- Backfills day-by-day from `pm_trader_events_v2`
- No GROUP BY during INSERT - much faster

### Fast V9 Rebuild Script
`tmp/rebuild-clob-ledger-v9-fast.ts`
- Reads from staging table with FINAL modifier
- Uses subquery to work around ClickHouse alias limitations
- 1-day chunks to stay within memory limits

### Parity Verification
`tmp/verify-v9-clob-parity.ts`
- Tests event count parity between v9 and dedup view
- Tests cash flow sanity (USDC totals match)
- All tests passed ✅

---

## Verification Results

```
================================================================================
VERIFY V9 CLOB PARITY
================================================================================
V9 Table: pm_unified_ledger_v9_clob_tbl
Dedupe View: vw_pm_trader_events_wallet_dedup_v2

TEST A: Event Parity
   0xee92e51827... v9=188 view=188 ✅
   0x65b8e0082a... v9=140 view=140 ✅

TEST B: Cash Flow Sanity
   0xee92e51827... v9=$3809.31 view=$3809.31 ✅
   0x65b8e0082a... v9=$10963.88 view=$10963.88 ✅

SUMMARY
Event Parity:     ✅ PASS
Cash Flow Parity: ✅ PASS
```

---

## Current State

- **Staging table**: Contains Dec 1-8 data (33M rows)
- **V9 ledger**: Contains Dec 1-8 CLOB events (17.5M rows)
- **Parity**: Verified ✅

## Next Steps

1. **Full historical backfill** of staging table (2022-11-21 to present)
   - Run: `npx tsx tmp/create-clob-staging-v2.ts --start-date 2022-11-21 --end-date 2025-12-08`
   - Estimated time: ~3-4 hours for 1,113 days

2. **Full v9 ledger rebuild** once staging is complete
   - Run: `npx tsx tmp/rebuild-clob-ledger-v9-fast.ts --start-date 2022-11-21 --end-date 2025-12-08 --chunk-days 1`
   - Estimated time: ~30 minutes

3. **Wire --ledger=clob_v9 engine flag** for PnL engine

4. **Start V30 sell-cap implementation** for UI parity

---

## Technical Notes

### ReplacingMergeTree Behavior
- Dedupe happens during background merge, not INSERT
- Query with FINAL to get deduped results immediately
- No need to run OPTIMIZE FINAL manually (background merge handles it)

### FINAL + Alias Syntax
ClickHouse doesn't support `FROM table FINAL AS alias`. Use subquery:
```sql
FROM (SELECT * FROM table FINAL WHERE ...) AS alias
```

### Memory Limits
The ClickHouse cluster has ~10GB memory limit. Stay under with:
- 1-day chunks for staging INSERT
- 1-day chunks for ledger rebuild
- Lower thread count (max_threads: 2)
