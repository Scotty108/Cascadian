# Timestamp Fix Handoff Instructions

> **Date:** 2026-02-02
> **Status:** Immediate/Medium-term fixes COMPLETE, Long-term fix PENDING

---

## Problem Summary

The `pm_trade_fifo_roi_v3_mat_unified` table had corrupted `resolved_at` timestamps where the `tokens` column value was being written to the `resolved_at` column (interpreted as Unix timestamp, resulting in 1970-01-01 dates).

**Root Cause:** The source table (`pm_trade_fifo_roi_v3`) and destination table (`pm_trade_fifo_roi_v3_mat_unified`) have **different column orders**, and INSERT statements without explicit column names caused misalignment.

| Position | pm_trade_fifo_roi_v3 | pm_trade_fifo_roi_v3_mat_unified |
|----------|----------------------|----------------------------------|
| 6 | tokens | **resolved_at** |
| 7 | cost_usd | tokens |
| 15 | **resolved_at** | is_maker |

---

## What Was Fixed

### 1. Code Fixes (COMPLETE)

All INSERT statements now use explicit column names to prevent future corruption:

**Files modified:**
- `/app/api/cron/refresh-unified-incremental/route.ts` (6 INSERT statements)
- `/scripts/backfill-fifo-unified-gap.ts` (1 INSERT statement)

**Validation added:**
- `validateTimestamps()` function detects new epoch corruption
- Cron response now includes `epochTimestamps` count and `warnings` array

### 2. Data Fix (COMPLETE)

**Script:** `/scripts/fix-epoch-timestamps.ts`

**Results:**
| Metric | Before | After |
|--------|--------|-------|
| Epoch timestamps | 240,267 (0.0825%) | 54,354 (0.0187%) |
| Trades fixed | - | ~190,000 |

---

## What Remains (Long-Term)

### Remaining Epoch Timestamps: 54,354

These are **SOURCE DATA issues** - the `pm_condition_resolutions` table itself has `resolved_at = 1970-01-01T00:00:00` for 7,171 conditions (mostly from March-April 2023).

**To verify:**
```sql
-- Check remaining epoch timestamps by date
SELECT
  toDate(entry_time) as entry_date,
  count() as epoch_trades
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE resolved_at < '1971-01-01' AND resolved_at IS NOT NULL
GROUP BY entry_date
ORDER BY epoch_trades DESC
LIMIT 20;

-- Check source data issue
SELECT count() as epoch_conditions
FROM pm_condition_resolutions
WHERE resolved_at < '1971-01-01';
-- Expected: 7,171 conditions
```

### Options to Fix Source Data

1. **Re-fetch from Polymarket API** - Query Polymarket for the actual resolution timestamps of these 7,171 conditions
2. **Mark as unknown** - Set resolved_at to NULL for these conditions (honest about missing data)
3. **Leave as-is** - These are old 2023 markets, impact is minimal (0.02% of data)

**Recommendation:** Option 3 (leave as-is) unless historical 2023 data accuracy is critical.

---

## Verification Queries

### Check current state
```sql
SELECT
  count() as total_rows,
  countIf(resolved_at IS NULL) as unresolved,
  countIf(resolved_at >= '2020-01-01') as valid_resolved,
  countIf(resolved_at < '1971-01-01' AND resolved_at IS NOT NULL) as epoch_timestamps,
  round(countIf(resolved_at < '1971-01-01') * 100.0 / count(), 4) as epoch_pct
FROM pm_trade_fifo_roi_v3_mat_unified;
```

### Check for NEW corruption (should be 0 after code fix)
```sql
SELECT count() as recent_epoch
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE resolved_at < '1971-01-01'
  AND resolved_at IS NOT NULL
  AND entry_time >= now() - INTERVAL 7 DAY;
-- Should be 0 if code fix is working
```

### Verify specific condition is fixed
```sql
-- This was the worst-affected condition (23K trades)
SELECT count(), countIf(resolved_at >= '2020-01-01') as valid
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE condition_id = '9c691addb98320e286ccf3c5fc6c4a69dbbbdea7d3c979c1c227dbc610825620';
-- Expected: 23009 total, 23009 valid
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `/app/api/cron/refresh-unified-incremental/route.ts` | Main sync cron (FIXED) |
| `/scripts/backfill-fifo-unified-gap.ts` | Gap backfill script (FIXED) |
| `/scripts/fix-epoch-timestamps.ts` | One-time fix script (COMPLETED) |
| `/docs/operations/TIMESTAMP_FIX_HANDOFF.md` | This file |

---

## Monitoring

The cron now reports:
- `stats.epochTimestamps` - Total epoch timestamps in table
- `warnings` - Array with alert if recent entries have epoch timestamps

Check Vercel logs or cron tracker for warnings after each run.

---

## If Corruption Reoccurs

1. **Check for new INSERT statements** - Any new code writing to unified table must use explicit column names
2. **Run fix script again:**
   ```bash
   npx tsx scripts/fix-epoch-timestamps.ts
   ```
3. **Check the specific condition** that has issues and manually re-sync if needed:
   ```sql
   -- Re-sync a specific condition
   INSERT INTO pm_trade_fifo_roi_v3_mat_unified
     (tx_hash, wallet, condition_id, outcome_index, entry_time,
      resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
      exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
   SELECT
     v.tx_hash, v.wallet, v.condition_id, v.outcome_index,
     v.entry_time, v.resolved_at, v.tokens, v.cost_usd,
     v.tokens_sold_early, v.tokens_held, v.exit_value,
     v.pnl_usd, v.roi, v.pct_sold_early, v.is_maker,
     CASE WHEN v.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
     v.is_short
   FROM pm_trade_fifo_roi_v3 v
   WHERE v.condition_id = '<CONDITION_ID>';
   ```

---

## Summary

| Task | Status |
|------|--------|
| Fix column swap bug | COMPLETE |
| Add explicit column names to all INSERTs | COMPLETE |
| Add timestamp validation to cron | COMPLETE |
| Fix ~190K corrupted Jan 2026 trades | COMPLETE |
| Fix 54K source data issues (2023) | PENDING (optional) |
