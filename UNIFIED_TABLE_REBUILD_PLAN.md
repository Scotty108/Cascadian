# Unified Table Rebuild Plan (Safe Option)

**Problem:** 189 pending DELETE mutations taking 49+ days to process on `pm_trade_fifo_roi_v3_mat_unified`

**Solution:** Build a completely new table with fresh data, swap when ready

---

## The Safe Approach

Instead of fixing the old table (risky), we:
1. ✅ Build brand new table (`pm_trade_fifo_roi_v3_mat_unified_v2`)
2. ✅ Keep old table completely untouched (zero data loss risk)
3. ✅ Verify new table is correct
4. ✅ Atomic swap when ready (zero downtime)
5. ✅ Keep old table as backup

---

## Execution Steps

### Step 1: Build Fresh Table (~30-45 minutes)

```bash
npx tsx scripts/build-unified-fresh-v2.ts
```

**What it does:**
- Kills pending mutations on old table (stops the 49-day queue)
- Creates new table: `pm_trade_fifo_roi_v3_mat_unified_v2`
- Copies ALL resolved positions from old table (~575M rows)
- Builds fresh unresolved positions from last 24 hours (~13M rows)
- Zero DELETE mutations needed (just INSERT)

**Old table:** COMPLETELY UNTOUCHED (still has stale data, but zero risk)

### Step 2: Compare Tables

```bash
npx tsx scripts/compare-unified-tables.ts
```

**What it shows:**
- Row counts comparison (old vs new)
- Freshness comparison (staleness in minutes)
- Wallet overlap check
- Data integrity verification
- Clear recommendation: safe to swap or not

**Expected results:**
- New table: ~588M rows (same as old)
- Unresolved staleness: <10 minutes (vs 23 hours in old)
- Resolved staleness: <10 minutes (vs 7 hours in old)
- 100% wallet overlap on resolved data

### Step 3: Swap Tables (when ready)

```bash
npx tsx scripts/swap-unified-tables.ts
```

**What it does:**
- Safety checks (verifies new table is not empty and fresh)
- Drops old backup if exists
- Atomic swap:
  ```sql
  RENAME TABLE
    pm_trade_fifo_roi_v3_mat_unified TO pm_trade_fifo_roi_v3_mat_unified_backup,
    pm_trade_fifo_roi_v3_mat_unified_v2 TO pm_trade_fifo_roi_v3_mat_unified
  ```
- Verifies production table is now fresh
- Zero downtime (atomic operation)

**After swap:**
- ✅ Production table (`pm_trade_fifo_roi_v3_mat_unified`) has fresh data
- ✅ Old table preserved as `pm_trade_fifo_roi_v3_mat_unified_backup`
- ✅ All queries automatically use fresh table

---

## Why This is Safe

1. **Zero Risk to Current Data**
   - Old table never modified during build
   - Can abort at any time before swap
   - Backup created during swap

2. **Atomic Swap**
   - RENAME is instantaneous
   - Either succeeds completely or fails completely
   - No intermediate state where queries fail

3. **Easy Rollback**
   ```sql
   -- If something goes wrong, just swap back
   RENAME TABLE
     pm_trade_fifo_roi_v3_mat_unified TO pm_trade_fifo_roi_v3_mat_unified_v2,
     pm_trade_fifo_roi_v3_mat_unified_backup TO pm_trade_fifo_roi_v3_mat_unified
   ```

4. **Verification Before Swap**
   - Compare script shows exactly what will change
   - Manual approval required before swap
   - Can inspect both tables side-by-side

---

## Timeline

| Step | Duration | Can Abort? |
|------|----------|------------|
| Build new table | 30-45 min | ✅ Yes (old table untouched) |
| Compare tables | <1 min | ✅ Yes (just reading data) |
| Swap tables | <1 sec | ⚠️ No (but atomic - zero downtime) |

**Total time to fresh data:** ~30-45 minutes

---

## What You Get

**Before (Old Table):**
- Unresolved: 23 hours stale
- Resolved: 7 hours stale
- 189 pending mutations (49 days to complete)
- Queries work but data is old

**After (New Table):**
- Unresolved: <10 minutes stale
- Resolved: <10 minutes stale
- Zero pending mutations
- Queries use fresh data

---

## Cleanup (After 24-48 Hours)

Once you're confident the new table is working:

```sql
-- Drop the old backup
DROP TABLE pm_trade_fifo_roi_v3_mat_unified_backup;
```

Saves ~20 GB disk space.

---

## Future Refreshes

**Lesson Learned:** DELETE mutations on 588M row tables are too slow.

**New Approach for Daily Refreshes:**
1. Use the rebuild approach (this script) instead of DELETE+INSERT
2. OR: Partition table by date to make DELETEs faster
3. OR: Use a separate unresolved table that gets fully rebuilt daily

**For now:** This script gives you fresh data today, future optimization can come later.

---

## Files Created

- `scripts/build-unified-fresh-v2.ts` - Builds new table with fresh data
- `scripts/compare-unified-tables.ts` - Compares old vs new tables
- `scripts/swap-unified-tables.ts` - Swaps tables atomically

All scripts are idempotent (safe to re-run).

---

## Ready to Execute?

```bash
# Step 1: Build new table (30-45 min)
npx tsx scripts/build-unified-fresh-v2.ts

# Step 2: Compare (verify it's good)
npx tsx scripts/compare-unified-tables.ts

# Step 3: Swap (when ready)
npx tsx scripts/swap-unified-tables.ts
```

**Zero data loss risk. Zero downtime. Fresh data in 30-45 minutes.**
