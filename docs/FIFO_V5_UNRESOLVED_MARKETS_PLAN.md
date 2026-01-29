# FIFO V5: Unresolved Markets Extension Plan

**Date:** January 28, 2026
**Status:** Planning Phase
**Priority:** CRITICAL

---

## Executive Summary

**Current Gap:** The existing `pm_trade_fifo_roi_v3_mat_deduped` table (286M rows) only tracks positions held through market resolution. It **misses ALL closed positions on unresolved markets**.

**Impact:** Missing scalpers, day traders, and any fully-closed position where the market hasn't resolved yet.

**Solution:** Extend FIFO V5 to track both resolved AND unresolved market activity.

---

## Current State

### Table: `pm_trade_fifo_roi_v3_mat_deduped`
- **Rows:** 286,226,634
- **Wallets:** 1,900,840
- **Coverage:** Resolved markets only
- **Time range:** Nov 21, 2022 → Jan 28, 2026
- **Deduplication:** GROUP BY (tx_hash, wallet, condition_id, outcome_index)
- **Status:** ✅ Complete and validated

### What's Tracked (Resolved Markets)
- ✅ Buy then hold to resolution
- ✅ Buy, sell 50% early, hold 50% to resolution
- ✅ Buy, sell 100% early (before resolution), then market resolves
- ✅ SHORT positions (net negative tokens)
- ✅ Per-transaction FIFO V5 logic

### What's NOT Tracked (Critical Gap)
- ❌ Buy then sell 100% (position closed, market still open)
- ❌ Buy then sell 50% (position open, market still open)
- ❌ Any activity on unresolved markets
- ❌ Scalpers who close positions within hours/days
- ❌ Day traders who exit before resolution

---

## Implementation Strategy

### Method: Separate Build → Unified Materialized Table

**Why this approach:**
- ✅ Safest: 286M validated rows stay intact
- ✅ Testable: Verify unresolved logic independently
- ✅ Reversible: Can abort without losing work
- ✅ Clean separation: Easier to debug each part
- ✅ Production-ready: Single materialized table (not VIEW)

---

## Phase 0: Fast Validation (Last 7 Days) - WITH MERGE

**Goal:** Validate unresolved logic on small dataset AND test unified table queries before full backfill

### Script: `rebuild-unresolved-7days-test.ts`

**Filter:**
```sql
WHERE wallet IN (
  SELECT DISTINCT wallet
  FROM pm_canonical_fills_v4
  WHERE event_time >= now() - INTERVAL 7 DAY
)
```

**Process:**
1. Build unresolved table (7-day active wallets)
2. Extract resolved rows for same wallets from 286M table
3. Merge both into unified test table
4. Run real queries to validate

**Expected Results:**
- Wallets: ~50,000-100,000 active in last 7 days
- Unresolved rows: ~5-10M (full history, unresolved markets only)
- Resolved rows: ~2-5M (full history, resolved markets only)
- Unified rows: ~7-15M (both combined)
- Runtime: 30-45 minutes

**Output Tables:**
- `pm_trade_fifo_roi_v3_mat_unresolved_7d_test` (~10M rows)
- `pm_trade_fifo_roi_v3_mat_resolved_7d_test` (~3M rows)
- `pm_trade_fifo_roi_v3_mat_unified_7d_test` (~13M rows - MERGED)

**Validation Steps:**
1. Zero duplicates check (unresolved table)
2. is_closed logic verification
3. Extract resolved rows for same wallets
4. Merge into unified table
5. Verify row counts match (resolved + unresolved = unified)
6. Test leaderboard query on unified table
7. Test wallet PnL breakdown query
8. Manual verification of 10 sample wallets

**Success Criteria:**
- ✅ Zero duplicates on (tx_hash, wallet, condition_id, outcome_index)
- ✅ is_closed = 1 when tokens_held = 0
- ✅ resolved_at = NULL for unresolved markets
- ✅ exit_value = sell proceeds only (no payout for unresolved)
- ✅ Unified table row count = resolved + unresolved
- ✅ Queries run successfully on unified table
- ✅ Manual verification of 10 sample wallets

---

## Phase 1: Build Unresolved Table (Full Dataset)

**Run after Phase 0 validation passes**

### Script: `rebuild-unresolved-full.ts`

**Table:** `pm_trade_fifo_roi_v3_mat_unresolved`

**Logic:**
```sql
-- Process ALL conditions that HAVEN'T resolved
SELECT DISTINCT condition_id
FROM pm_canonical_fills_v4
WHERE source = 'clob'
  AND condition_id NOT IN (
    SELECT condition_id
    FROM pm_condition_resolutions
    WHERE is_deleted = 0 AND payout_numerators != ''
  )
```

**FIFO Calculation for Unresolved:**
```sql
-- Same FIFO logic as resolved, but:
exit_value = early_sell_proceeds  -- NO payout (market not resolved)
resolved_at = NULL                -- market still open
is_closed = CASE
  WHEN tokens_held = 0 THEN 1     -- fully exited
  ELSE 0                          -- still holding
END
pnl_usd = exit_value - cost_usd   -- realized PnL only
```

**Expected Results:**
- Rows: ~150-200M (unresolved positions)
- Runtime: 3-4 hours
- Batching: 200 batches (same as resolved)

**Key Columns:**
- `resolved_at` = NULL (market not resolved)
- `is_closed` = 1 (if position fully exited) or 0 (if still holding)
- `exit_value` = sell proceeds only (no payout)
- `pnl_usd` = realized PnL from sells

---

## Phase 2: Create Unified Materialized Table

**Run after Phase 1 completes**

### Script: `create-unified-table.ts`

**Table:** `pm_trade_fifo_roi_v3_mat_unified`

**Process:**
```sql
-- Step 1: Create table (same schema)
CREATE TABLE pm_trade_fifo_roi_v3_mat_unified (
  tx_hash String,
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,
  entry_time DateTime,
  resolved_at Nullable(DateTime),  -- NULL for unresolved
  cost_usd Float64,
  tokens Float64,
  tokens_sold_early Float64,
  tokens_held Float64,
  exit_value Float64,
  pnl_usd Float64,
  roi Float64,
  pct_sold_early Float64,
  is_maker UInt8,
  is_short UInt8,
  is_closed UInt8  -- NEW: 1 if position fully exited
) ENGINE = MergeTree()
ORDER BY (wallet, condition_id, outcome_index, tx_hash)
SETTINGS index_granularity = 8192;

-- Step 2: Insert resolved positions (existing table)
INSERT INTO pm_trade_fifo_roi_v3_mat_unified
SELECT * FROM pm_trade_fifo_roi_v3_mat_deduped;

-- Step 3: Insert unresolved positions (new table)
INSERT INTO pm_trade_fifo_roi_v3_mat_unified
SELECT * FROM pm_trade_fifo_roi_v3_mat_unresolved;
```

**Expected Results:**
- Total rows: ~450-500M (286M + 150-200M)
- Total wallets: ~1.9M
- Runtime: 1-2 hours (two sequential INSERTs)

**Verification:**
```sql
-- Check totals
SELECT
  count() as total_rows,
  countIf(resolved_at IS NOT NULL) as resolved_rows,
  countIf(resolved_at IS NULL) as unresolved_rows,
  countIf(is_closed = 1) as closed_positions,
  countIf(is_closed = 0) as open_positions,
  uniq(wallet) as wallets
FROM pm_trade_fifo_roi_v3_mat_unified;

-- Expected:
-- total_rows: ~450-500M
-- resolved_rows: ~286M
-- unresolved_rows: ~150-200M
-- closed_positions: ~100-150M
-- open_positions: ~300-350M
```

---

## Phase 3: Verification & Cutover

### Verification Tests

**1. Duplicate Check:**
```sql
SELECT
  count() as total,
  uniq(tx_hash, wallet, condition_id, outcome_index) as unique_keys,
  count() - uniq(tx_hash, wallet, condition_id, outcome_index) as duplicates
FROM pm_trade_fifo_roi_v3_mat_unified
-- duplicates MUST be 0 (with ~2% margin for uniq() approximation)
```

**2. is_closed Logic:**
```sql
SELECT
  countIf(is_closed = 1 AND tokens_held > 0) as invalid_closed,
  countIf(is_closed = 0 AND tokens_held = 0) as invalid_open
FROM pm_trade_fifo_roi_v3_mat_unified
-- Both should be 0
```

**3. Resolved vs Unresolved Split:**
```sql
SELECT
  countIf(resolved_at IS NOT NULL) as resolved,
  countIf(resolved_at IS NULL) as unresolved
FROM pm_trade_fifo_roi_v3_mat_unified
-- resolved should match original 286M table
```

**4. FIFO V5 Multi-Buy Tracking:**
```sql
SELECT
  wallet, condition_id, outcome_index,
  count() as buy_transactions,
  sum(pnl_usd) as position_pnl,
  any(resolved_at) as resolved_at
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE abs(cost_usd) >= 100
GROUP BY wallet, condition_id, outcome_index
HAVING count() > 1
ORDER BY count() DESC
LIMIT 10
-- Should find positions with multiple buy transactions (TRUE FIFO V5)
```

**5. Sample Wallet Verification:**
- Pick 20 wallets (10 scalpers, 10 holders)
- Manually verify their trades vs unified table
- Check closed positions are tracked correctly

### Cutover Plan

**When verification passes:**
1. Update API endpoints to use `pm_trade_fifo_roi_v3_mat_unified`
2. Update leaderboard queries
3. Update PnL calculation endpoints
4. Keep old tables as backup for 7 days

**Backup Tables (keep until confident):**
- `pm_trade_fifo_roi_v3_mat_deduped` (286M resolved)
- `pm_trade_fifo_roi_v3_mat_unresolved` (150M unresolved)

**Rollback Plan:**
- If issues found, switch back to `pm_trade_fifo_roi_v3_mat_deduped`
- Can rebuild unified from source tables (fast, just two INSERTs)

---

## Timeline

### Fast Validation Path (Recommended)

| Phase | Task | Duration | Can Run |
|-------|------|----------|---------|
| **0a** | Build 7-day test script (DONE) | 0 min | ✅ Complete |
| **0b** | Run 7-day test (build + merge) | 30-45 min | Now |
| **0c** | Verify & test queries | 15 min | Now |
| **Total Phase 0** | | **45-60 min** | **Complete tonight** |
| | | | |
| **1a** | Build full unresolved script | 1 hour | After Phase 0 ✅ |
| **1b** | Full unresolved backfill | 3-4 hours | Overnight |
| **2** | Create unified table | 1-2 hours | After Phase 1 |
| **3** | Verify & cutover | 30 min | After Phase 2 |
| **Total Full** | | **5.5-7.5 hours** | **Next overnight** |

**Tonight (Phase 0):** Build unresolved + merge with resolved + test queries (45-60 min)
**Tomorrow night (Phases 1-3):** Full backfill + unification (7 hours)

---

## Schema Comparison

### Current (Resolved Only)
```sql
resolved_at DateTime        -- always has value (market resolved)
is_closed UInt8 DEFAULT 0   -- not really used (all resolved)
exit_value Float64          -- includes payout from resolution
```

### Extended (Resolved + Unresolved)
```sql
resolved_at Nullable(DateTime)  -- NULL if market not resolved
is_closed UInt8                 -- 1 if fully exited, 0 if holding
exit_value Float64              -- sell proceeds (+ payout if resolved)
```

**Key difference:**
- Resolved: `exit_value = sell_proceeds + (tokens_held * payout)`
- Unresolved: `exit_value = sell_proceeds` (no payout yet)

---

## Query Patterns (After Unification)

### Get All Positions (Resolved + Unresolved)
```sql
SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
```

### Get Only Closed Positions
```sql
SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
WHERE is_closed = 1
```

### Get Only Open Positions
```sql
SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
WHERE is_closed = 0
```

### Get Resolved Market Positions
```sql
SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
WHERE resolved_at IS NOT NULL
```

### Get Unresolved Market Positions
```sql
SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
WHERE resolved_at IS NULL
```

### Get Scalpers (Closed Before Resolution)
```sql
SELECT wallet, sum(pnl_usd) as total_pnl
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE is_closed = 1
  AND resolved_at IS NULL  -- closed but market not resolved
GROUP BY wallet
ORDER BY total_pnl DESC
```

---

## Success Criteria

### Phase 0 (7-Day Test WITH MERGE)
- ✅ Zero duplicates in unresolved test table
- ✅ is_closed logic works correctly
- ✅ Unresolved positions tracked
- ✅ Resolved positions extracted for same wallets
- ✅ Unified table created successfully
- ✅ Row counts match (resolved + unresolved = unified)
- ✅ Leaderboard query runs on unified table
- ✅ PnL breakdown query runs on unified table
- ✅ Manual verification of 10 sample wallets

### Phase 1 (Full Unresolved Backfill)
- ✅ 150-200M rows inserted
- ✅ Zero duplicates
- ✅ All unresolved conditions processed
- ✅ No batch errors

### Phase 2 (Unified Table)
- ✅ 450-500M total rows
- ✅ 286M resolved + 150-200M unresolved = total
- ✅ Zero duplicates in unified table
- ✅ Both source tables intact

### Phase 3 (Production)
- ✅ All verification tests pass
- ✅ Sample queries perform well
- ✅ API endpoints updated
- ✅ 20 wallet manual verification

---

## Risk Mitigation

### What Could Go Wrong

**1. Memory Issues (500M rows)**
- **Mitigation:** Use 200 batches (same as Phase 3)
- **Fallback:** Increase batch count to 300

**2. Unresolved Logic Has Bugs**
- **Mitigation:** Phase 0 validation catches bugs early
- **Fallback:** Fix script, re-run (source data safe)

**3. Unified Table Too Slow**
- **Mitigation:** Test queries in Phase 3 verification
- **Fallback:** Add indexes, optimize ORDER BY

**4. Duplicate Issues**
- **Mitigation:** Same GROUP BY logic as validated Phase 3
- **Fallback:** Source tables safe, can rebuild

---

## Files to Create

### Phase 0 (7-Day Test)
- `scripts/rebuild-unresolved-7days-test.ts` - Test script
- `scripts/verify-unresolved-test.ts` - Verification script

### Phase 1 (Full Unresolved)
- `scripts/rebuild-unresolved-full.ts` - Full backfill script

### Phase 2 (Unified)
- `scripts/create-unified-table.ts` - Merge script

### Phase 3 (Verification)
- `scripts/verify-unified-table.ts` - Complete verification suite

---

## Open Questions

1. **SHORT positions on unresolved markets:** Do we need special handling?
2. **Refresh cadence:** How often to update unresolved table? (Daily? Hourly?)
3. **Incremental updates:** Build cron to update both resolved + unresolved?
4. **Query performance:** Will 500M row table need special indexes?

---

## Notes

- **TRUE FIFO V5:** Multiple rows per position (one per buy transaction)
- **Deduplication key:** `(tx_hash, wallet, condition_id, outcome_index)`
- **No aggregation:** Per-transaction tracking (not per-position)
- **Atomic operations:** Always CREATE new table, never UPDATE in place
- **Backup strategy:** Keep source tables until unified table proven stable

---

**Next Step:** Build Phase 0 (7-day test script) and validate unresolved logic.
