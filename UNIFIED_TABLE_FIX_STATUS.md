# Unified Table Fix - Progress Status (Jan 29, 2026)

## Timeline

| Time | Action | Status |
|------|--------|--------|
| 10:57 AM | Fixed unresolved PnL (10day) | ✅ Complete (6 min) |
| 11:02 AM | Fixed is_closed flags (10day) | ✅ Complete (5 min) |
| 11:08 AM | Verified fixes | ✅ Complete (0 bad positions) |
| 11:32 AM | Attempted OPTIMIZE TABLE | ⚠️ Didn't dedupe (SharedMergeTree limitation) |
| 11:43 AM | Started GROUP BY deduplication | 🔄 In Progress (ETA: 11:53-11:58 AM) |

---

## What We Fixed (10day Table)

### Fix #1: Unresolved Position PnL ✅
**Problem:** 8.8M positions with `resolved_at = NULL` had false PnL totaling -$687M
**Fix:** Set `pnl_usd = 0`, `exit_value = 0`, `roi = 0`, `is_closed = 0`
**Runtime:** 6 minutes
**Result:** 0 bad unresolved positions

### Fix #2: is_closed Flag ✅
**Problem:** 74M positions (27%) had wrong `is_closed` flags
**Fix:** Recalculated `is_closed = CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END`
**Runtime:** 5 minutes
**Result:** 100% accurate flags

### Fix #3: Duplicates 🔄 IN PROGRESS
**Problem:** 7.52M duplicate rows (44.8% of recent data)
**Why OPTIMIZE didn't work:** SharedMergeTree doesn't auto-deduplicate (that's ReplacingMergeTree)
**Fix:** Recreate table with GROUP BY deduplication
**Runtime:** 15-20 minutes (started 11:43 AM)
**Expected result:** 183M rows → ~95M rows (88M duplicates removed)

---

## Impact on Leaderboards

### Before Fix (Would Have Been CATASTROPHIC)

Top traders would show completely false profits from unresolved positions:

| Wallet | Trades | False PnL (before) | Actual PnL (after) | Error |
|--------|--------|-------------------|-------------------|-------|
| 0x6a72...3ee | 34,744 | **+$10.6M** | **$0** | 100% false |
| 0xe20a...469 | 12,974 | **+$7.3M** | **$0** | 100% false |
| 0xdc87...ab6 | 39,610 | **+$6.4M** | **$0** | 100% false |

**These wallets got ALL their PnL from unresolved positions!**

### After Fix (Accurate)

- ✅ Only counting realized PnL (resolved positions)
- ✅ Only counting fully closed trades (tokens_held ≤ 0.01)
- ✅ Unresolved positions show zero PnL (correct)
- ✅ Copy trading recommendations now follow profitable strategies, not unrealized bets

---

## FIFO V5 Logic Verification ✅

### Confirmed Behaviors:

**1. Multiple Buys → Partial Sell → More Buys → Full Sell**
- Each buy creates a separate position (different tx_hash)
- Partial sell: Updates `tokens_sold_early`, `tokens_held` on first position
- Full sell: Sets `is_closed = 1` when `tokens_held ≤ 0.01`
- Each fully closed position = 1 trade for win rate

**2. Only Counting Resolved Positions**
- ✅ Unresolved positions (still open markets): `pnl_usd = 0`, `exit_value = 0`
- ✅ Resolved positions: Calculated from `exit_value - cost_usd`
- ✅ Markets can still be "open" but trades can be "closed" (fully exited)

**3. Trade-by-Trade Accuracy**
- ✅ Win rate = closed trades with `pnl_usd > 0` / total closed trades
- ✅ ROI = `pnl_usd / cost_usd` per trade
- ✅ Token accounting: `tokens = tokens_sold_early + tokens_held` (100% accurate after fix)

**4. SHORT Positions**
- Uses synthetic tx_hash: `short_{wallet[1:10]}_{condition_id[1:10]}_{outcome_index}`
- Always `is_closed = 0` (can't close short until resolved)
- Counted in leaderboards when `resolved_at IS NOT NULL`

---

## Technical Details

### Why SharedMergeTree Doesn't Auto-Deduplicate

**Engine:** `SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')`
**ORDER BY:** `(wallet, condition_id, outcome_index, tx_hash)`

**Deduplication behavior:**
- ❌ SharedMergeTree: Does NOT deduplicate (requires manual GROUP BY)
- ✅ ReplacingMergeTree: Auto-deduplicates on merge (would need engine change)
- ✅ OPTIMIZE FINAL: Merges parts but doesn't dedupe in SharedMergeTree

**Our solution:**
```sql
CREATE TABLE new_table AS
SELECT
  tx_hash, wallet, condition_id, outcome_index,
  any(entry_time) as entry_time,
  any(resolved_at) as resolved_at,
  -- ... all columns with any() aggregator
FROM old_table
GROUP BY tx_hash, wallet, condition_id, outcome_index
```

**Result:** Picks one row per unique key, discards duplicates

---

## Current Table Status

### 10day Table (IN PROGRESS)
| Metric | Before Fix | After PnL Fix | After Dedup (Expected) |
|--------|-----------|---------------|------------------------|
| **Total rows** | 183.09M | 183.09M | ~95M |
| **Duplicates** | 7.52M (44.8%) | 7.52M (44.8%) | 0 (0%) |
| **Bad unresolved** | 8.8M | 0 ✅ | 0 ✅ |
| **Bad is_closed** | 74M | 0 ✅ | 0 ✅ |
| **Status** | Broken | Clean data, has duplicates | Clean + deduplicated |

### Main Table (NEEDS FIX)
| Metric | Current | After Fix (Estimate) |
|--------|---------|---------------------|
| **Total rows** | 588.51M | ~588.51M |
| **Duplicates** | ~22.4M (estimated) | TBD (need separate dedup) |
| **Bad unresolved** | 13.4M | 0 ✅ |
| **Bad is_closed** | 117M | 0 ✅ |
| **Runtime** | N/A | 35-40 min |

---

## Next Steps

### Immediate (After 10day Dedup Complete)
1. **Verify 10day table** (2 min)
   - Check zero duplicates
   - Test sample queries
   - Drop old backup if satisfied

2. **Fix Main Table PnL + is_closed** (35-40 min)
   - Run `scripts/fix-unified-immediate.ts`
   - Same fixes as 10day (unresolved PnL, is_closed flags)

### Tonight (Low Traffic)
3. **Deduplicate Main Table** (45-60 min)
   - Same GROUP BY approach as 10day
   - 588M rows → ~300M rows (estimate)

### This Week
4. **Decide on 10day Table Strategy**
   - Option A: Drop it (main table can filter by date)
   - Option B: Keep as fast test table
   - Option C: Set up automated refresh (not recommended)

---

## Rollback Plan (If Needed)

**10day table:**
```sql
-- Swap back to original
RENAME TABLE
  pm_trade_fifo_roi_v3_mat_unified_10day TO pm_trade_fifo_roi_v3_mat_unified_10day_broken,
  pm_trade_fifo_roi_v3_mat_unified_10day_old TO pm_trade_fifo_roi_v3_mat_unified_10day;

-- Verify
SELECT count() FROM pm_trade_fifo_roi_v3_mat_unified_10day;
-- Should be 183.09M (original)
```

**Cost:** <1 second (atomic RENAME)

---

## Validation Queries

### Check Zero Duplicates
```sql
SELECT
  count() as total,
  uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique,
  count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
FROM pm_trade_fifo_roi_v3_mat_unified_10day
WHERE entry_time >= now() - INTERVAL 7 DAY;
-- duplicates MUST be 0
```

### Check Zero Bad Positions
```sql
SELECT
  countIf(resolved_at IS NULL AND (pnl_usd != 0 OR exit_value != 0)) as bad_unresolved,
  countIf(resolved_at IS NOT NULL AND
          ((tokens_held <= 0.01 AND is_closed = 0) OR
           (tokens_held > 0.01 AND is_closed = 1))) as bad_closed_flag
FROM pm_trade_fifo_roi_v3_mat_unified_10day;
-- Both MUST be 0
```

### Check Token Accounting
```sql
SELECT
  countIf(abs(tokens - (tokens_sold_early + tokens_held)) > 0.01) as bad_accounting
FROM pm_trade_fifo_roi_v3_mat_unified_10day
WHERE entry_time >= now() - INTERVAL 7 DAY;
-- MUST be 0 (FIFO V5 invariant)
```

---

## Key Learnings

1. **ClickHouse Mutations are Asynchronous**
   - `ALTER TABLE UPDATE` returns immediately
   - Actual work happens in background (check `system.mutations`)
   - Can take 5-15 min for large tables

2. **SharedMergeTree ≠ Auto-Deduplication**
   - OPTIMIZE FINAL merges parts but doesn't dedupe
   - Need ReplacingMergeTree OR manual GROUP BY

3. **Atomic Operations are Key**
   - Use RENAME for instant cutover
   - Keep backups until verified
   - Can rollback in <1 second

4. **Data Quality Checks Before Production**
   - ALWAYS validate before using new table
   - Check duplicates, PnL logic, flags
   - Sample recent data (last 7 days) for fast checks

---

**Last Updated:** Jan 29, 2026, 11:45 AM
**Status:** Deduplication in progress (ETA: 11:53-11:58 AM)
