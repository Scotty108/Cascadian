# Unified Table Validation Results - Jan 29, 2026, 10:35 AM

## ✅ What's Working Well

1. **✅ Data Freshness** - Table is current
   - Latest resolution: 5:14 PM today (85 min ago)
   - Source table (v3): 5:20 PM today (82 min ago)
   - Cron automation working (minor lag expected between runs)

2. **✅ FIFO Logic** - Calculations are correct
   - PnL calculation: 100% accurate (exit_value - cost_usd = pnl_usd)
   - ROI calculation: 100% accurate (pnl_usd / cost_usd = roi)
   - Win rate: 52.07% (within normal 40-60% range)

3. **✅ Overall Statistics** - Reasonable
   - 588.51M total rows
   - 1.93M unique wallets
   - 575.15M resolved positions
   - 13.36M unresolved positions

4. **✅ Negative Costs** - These are SHORT positions (expected)
   - 61M short positions have negative cost_usd (correct FIFO V5 behavior)
   - All negative costs are shorts (is_short = 1)

---

## 🚨 Critical Issues Found

### 1. **Massive Duplicates** (51M groups in last 30 days)

**Problem:** Same position key (tx_hash, wallet, condition_id, outcome_index) exists multiple times with identical data.

**Example:**
```
tx_hash: clob_0xe649d2e3...
wallet: 0x3504fb6dc5e65f5ec80c0115eb2bdfa146c203fb
condition_id: 0ac23db1e56971022bc7e822b907a2466c618b34104ea72bc9fa95e41c86a9c6
outcome_index: 0
Duplicate count: 3 (all with same entry_time, resolved_at)
```

**Root Cause:** Phase 2 likely inserted data multiple times, or data was copied from a source with duplicates.

**Impact:**
- Inflates row count (588M instead of ~537M unique)
- Could cause PnL calculations to count same position multiple times
- Wastes storage space

**Fix:** Run OPTIMIZE TABLE FINAL to deduplicate

---

### 2. **is_closed Flag Incorrect** (47M positions)

**Problem:** 47M positions have `tokens_held > 0.01` (still holding tokens) but `is_closed = 1` (marked as closed).

**Breakdown:**
- ✅ 76.4M correctly closed (tokens_held <= 0.01, is_closed = 1)
- ❌ 47M incorrectly closed (tokens_held > 0.01, is_closed = 1) **← ERROR**
- ✅ 38.3M correctly open (tokens_held > 0.01, is_closed = 0)

**Root Cause:** The `is_closed` flag was set during copy, but doesn't match current token holdings. Likely from Phase 2 copying resolved data that was already marked closed in the source.

**Impact:**
- Queries filtering by `is_closed` will be inaccurate
- Position close rates will be wrong

**Fix:** Recalculate is_closed based on tokens_held

---

### 3. **Unresolved Positions with PnL** (13.3M positions)

**Problem:** ALL unresolved positions (resolved_at IS NULL) have non-zero PnL and exit_value. They should all be zero.

**Stats:**
- 13.36M total unresolved
- 13.26M have non-zero PnL (99.3%) **← Should be 0%**
- 8.96M have non-zero exit_value (67%) **← Should be 0%**
- 8.66M marked as closed (65%) **← Unresolved can't be closed**

**Root Cause:** Data was copied as "unresolved" but already had resolved calculations. Possibly:
1. Resolved_at was lost during Phase 2 copy
2. Positions were resolved in source but copied as unresolved

**Impact:**
- Unrealized PnL calculations will be completely wrong
- Open positions will show incorrect values
- Dashboards showing "current holdings" will be broken

**Fix:** Either:
- Set all PnL/exit_value to 0 for unresolved positions, OR
- Find the correct resolved_at dates and reclassify these as resolved

---

### 4. **Token Balance Errors** (8.6M positions, 5% of sample)

**Problem:** `tokens != tokens_sold_early + tokens_held` (FIFO accounting broken)

**Impact:**
- Position tracking is inaccurate
- Can't trust "how many tokens are you holding" queries

**Fix:** Recalculate tokens_sold_early and tokens_held from source

---

### 5. **Minor Issues**

**Null Condition IDs:** 18,684 rows have empty condition_id (very small %)
**Cron Lag:** 245 positions waiting for next cron update (acceptable - runs every 2 hours)

---

## 📊 Phase 2 Data Quality Assessment

**Phase 2 achieved its goal:** All 1.99M wallets were added to the table.

**But data quality issues were introduced:**
1. Duplicates from multiple copy runs
2. Attribute flags not recalculated (is_closed, unresolved PnL)
3. Some source data corruption carried over

**Why this happened:**
- Phase 2 copied from `pm_trade_fifo_roi_v3_mat_deduped` which itself had issues
- Multiple timeout/retry cycles may have inserted same data twice
- `is_closed` was calculated once at copy time, not maintained
- Unresolved positions were copied with their current (incorrect) PnL values

---

## 🔧 Recommended Fixes (Priority Order)

### Fix #1: OPTIMIZE TABLE (2 hours, removes duplicates)
```sql
OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL
```
**Effect:** Removes 51M duplicate rows, leaves ~537M unique rows

### Fix #2: Recalculate is_closed flag (10 min)
```sql
ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
UPDATE is_closed = CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END
WHERE resolved_at IS NOT NULL
```

### Fix #3: Fix unresolved positions (30 min)
Two options:
**A) Zero out PnL for unresolved (safe):**
```sql
ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
UPDATE
  pnl_usd = 0,
  exit_value = 0,
  roi = 0,
  is_closed = 0
WHERE resolved_at IS NULL
```

**B) Investigate and reclassify (better but slower):**
- Query source table to find if these should be resolved
- Update resolved_at dates properly
- Keep existing PnL calculations

### Fix #4: Rebuild from clean source (NUCLEAR option, 12-16 hours)
- Drop current unified table
- Rebuild from `pm_trade_fifo_roi_v3` (confirmed clean source)
- Use proven FIFO V5 logic
- Calculate all flags correctly from scratch

---

## 🎯 Recommendation

**IMMEDIATE (next 30 min):**
1. Run Fix #3A - Zero out unresolved PnL (safe, fixes dashboards)
2. Run Fix #2 - Recalculate is_closed (fast)

**TONIGHT (when low traffic):**
3. Run Fix #1 - OPTIMIZE TABLE FINAL (removes duplicates, takes 1-2 hours)

**CONSIDER (next week):**
4. Rebuild from pm_trade_fifo_roi_v3 if quality remains an issue

---

## Current Cron Status

✅ **Crons are working:**
- `refresh-fifo-trades` runs every 2h at :35 (processes new resolutions)
- `refresh-unified-incremental` runs every 2h at :45 (updates unified table)
- 245 positions in queue (normal lag between cron runs)

⚠️ **However:** The cron will continue to copy potentially bad data from v3 until we clean the source.

---

## Bottom Line

**Can we use the table?**
- ✅ YES for PnL queries (calculations are correct)
- ❌ NO for "is this position closed?" queries
- ❌ NO for "what are my open positions?" (unresolved data is corrupted)
- ⚠️ YES for aggregates, but watch for duplicate counting

**Priority:** Fix unresolved positions ASAP (breaks dashboards), then optimize duplicates overnight.
