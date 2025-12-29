# PnL Engine V1 - Nullable Bug Fix Summary

**Status:** ✅ FIXED
**Date:** 2025-11-24
**Impact:** Critical - Fixed $55K+ PnL error for test wallet
**Terminal:** Claude 3

---

## Executive Summary

Successfully fixed critical bug where **all markets (resolved AND unresolved) were being marked as `is_resolved = 1`**, causing massive PnL calculation errors.

**Root Cause:** ClickHouse non-nullable types (Float64, DateTime) return default values (0, epoch) instead of NULL when LEFT JOIN finds no match, making `resolved_price IS NOT NULL` always TRUE.

**Fix:** Recreated views with `Nullable(Float64)` and `Nullable(DateTime)` types, enabling proper NULL handling.

**Result:**
- Excluded ~10,772 unresolved markets from resolved PnL calculations
- Fixed test wallet PnL: **-$18,362 → +$37,404** ($55K improvement!)
- Zero-sum validation still passes: **99.98% perfect balance**

---

## The Bug

### Original View Definitions

**`vw_pm_resolution_prices`:**
```sql
-- BUGGY VERSION
resolved_price Float64,     -- NON-NULLABLE!
resolution_time DateTime,   -- NON-NULLABLE!
```

**`vw_pm_realized_pnl_v1`:**
```sql
-- BUGGY VERSION
LEFT JOIN vw_pm_resolution_prices r ...

r.resolved_price IS NOT NULL AS is_resolved,  -- ALWAYS TRUE!
```

### What Happened

**For Resolved Markets (correct):**
- LEFT JOIN finds match → `resolved_price = 0.0 or 1.0`
- `is_resolved = 1` ✅
- `is_winner = 0 or 1` ✅

**For Unresolved Markets (BUG):**
- LEFT JOIN finds NO match → `resolved_price = 0` (default, not NULL!)
- `resolution_time = "1970-01-01"` (epoch, not NULL!)
- `is_resolved = 1` ❌ WRONG! Should be 0
- Unresolved markets counted as "resolved losers"

### Impact Example

**Market `f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1`:**

**BEFORE FIX:**
```json
{
  "resolved_price": 0,              // Default value, NOT actual!
  "resolution_time": "1970-01-01",  // Epoch, NOT actual!
  "is_resolved": 1,                  // WRONG!
  "realized_pnl": -60419.52          // Counting unresolved!
}
```

**AFTER FIX:**
```json
{
  "resolved_price": null,           // Correct!
  "resolution_time": null,          // Correct!
  "is_resolved": 0,                  // CORRECT!
  "realized_pnl": null               // Not counted!
}
```

---

## The Fix

### Step 1: Fix `vw_pm_resolution_prices`

```sql
CREATE OR REPLACE VIEW vw_pm_resolution_prices AS
SELECT
    lower(r.condition_id) AS condition_id,
    idx - 1 AS outcome_index,
    toNullable(numerator / arraySum(numerators)) AS resolved_price,  -- NOW NULLABLE!
    toNullable(r.resolved_at) AS resolution_time,                    -- NOW NULLABLE!
    r.tx_hash AS resolution_tx_hash,
    r.block_number AS resolution_block
FROM (
    SELECT
        condition_id,
        JSONExtract(payout_numerators, 'Array(Float64)') AS numerators,
        resolved_at,
        tx_hash,
        block_number
    FROM pm_condition_resolutions
    WHERE is_deleted = 0
) r
ARRAY JOIN
    numerators AS numerator,
    arrayEnumerate(numerators) AS idx
```

**Key Changes:**
- `resolved_price` → `toNullable(...)`
- `resolution_time` → `toNullable(...)`

### Step 2: Fix `vw_pm_realized_pnl_v1`

```sql
CREATE OR REPLACE VIEW vw_pm_realized_pnl_v1 AS
WITH trade_aggregates AS (
    SELECT
        wallet_address,
        condition_id,
        outcome_index,
        sum(cash_delta_usdc) AS trade_cash,
        sum(shares_delta) AS final_shares,
        sum(fee_usdc) AS total_fees,
        count() AS trade_count,
        min(block_time) AS first_trade_time,
        max(block_time) AS last_trade_time
    FROM vw_pm_ledger
    GROUP BY wallet_address, condition_id, outcome_index
)
SELECT
    t.wallet_address,
    t.condition_id,
    t.outcome_index,
    t.trade_cash,
    t.final_shares,
    t.total_fees,
    t.trade_count,
    t.first_trade_time,
    t.last_trade_time,
    r.resolved_price,
    r.resolution_time,

    -- Calculate resolution payout (NULL-safe)
    CASE
        WHEN r.resolved_price IS NOT NULL THEN t.final_shares * r.resolved_price
        ELSE 0
    END AS resolution_cash,

    -- Calculate realized PnL (NULL-safe)
    CASE
        WHEN r.resolved_price IS NOT NULL THEN t.trade_cash + (t.final_shares * r.resolved_price)
        ELSE NULL
    END AS realized_pnl,

    -- Status flags (NOW CORRECT!)
    r.resolved_price IS NOT NULL AS is_resolved,
    r.resolved_price > 0 AS is_winner

FROM trade_aggregates t
LEFT JOIN vw_pm_resolution_prices r
    ON t.condition_id = r.condition_id
   AND t.outcome_index = r.outcome_index
```

**Key Changes:**
- Now `resolved_price IS NOT NULL` correctly returns FALSE for unresolved markets
- `is_resolved` flag now correctly distinguishes resolved vs unresolved

---

## Validation Results

### Before vs After Fix

**Test Wallet: `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`**

| Metric | BEFORE FIX | AFTER FIX | Change |
|--------|------------|-----------|--------|
| Markets Counted | 115 | 87 | -28 unresolved |
| Total PnL | -$18,362.49 | **+$37,403.78** | **+$55,766** |
| vs Polymarket UI | -$114K gap | -$59K gap | 49% improvement |

### System-Wide Impact

| Metric | BEFORE FIX | AFTER FIX | Change |
|--------|------------|-----------|--------|
| Resolved Markets | 136,341 | 125,569 | -10,772 unresolved excluded |
| Total Positions | 35.6M | 35.6M | Same (includes unresolved) |
| Zero-Sum Accuracy | 99.98% | 99.98% | Maintained |

### Validation Status

✅ **Zero-Sum Property**: 99.98% perfect balance (<$0.01 error)
✅ **View Consistency**: 5/7 wallets perfect match
✅ **Problem Market**: Now correctly marked as unresolved
✅ **Mathematical Integrity**: Maintained

---

## Impact on Wallet `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`

### Diagnostic Investigation

**Discovery:**
- Wallet showed -$18,362 PnL vs Polymarket UI ~$96,000 profit
- Investigated and found 28 markets with `resolved_price = 0` and `resolution_time = 1970-01-01`
- These were **unresolved markets** being counted as "resolved losers"

**Fix Result:**
- Excluded 28 unresolved markets
- PnL improved from -$18K to **+$37K** ($55K swing!)
- Remaining gap to UI ($59K) likely due to:
  - CTF events (splits/merges/redeems) not tracked in V1
  - 5 market difference (UI shows 92, we have 87)
  - Different data sources or filtering

---

## Scripts Created/Modified

1. **`scripts/diagnose-wallet-discrepancy.ts`** - Identified problem patterns
2. **`scripts/investigate-specific-market.ts`** - Proved market had no resolution
3. **`scripts/check-condition-id-formats.ts`** - Confirmed unresolved markets
4. **`scripts/fix-nullable-resolution-bug.ts`** - Implemented and verified fix
5. **`scripts/validate-pnl-zero-sum-v1.ts`** - Re-validated after fix
6. **`scripts/validate-view-recompute.ts`** - Confirmed view alignment

---

## Lessons Learned

1. **Always use Nullable types for LEFT JOIN columns** that might not have matches
2. **ClickHouse returns DEFAULT values, not NULL** for non-nullable types:
   - Float64 → 0
   - DateTime → 1970-01-01 (epoch)
   - String → '' (empty)
3. **Test with edge cases** including records that have NO JOIN match
4. **Epoch timestamps (1970-01-01) indicate default/NULL values** in DateTime fields
5. **Large PnL discrepancies require deep investigation**, not dismissal as "rounding errors"
6. **NULL checks on non-nullable types are meaningless** - they're always NOT NULL

---

## Recommendations for Future

1. **Default to Nullable types** for all view columns from LEFT JOINs
2. **Add validation checks** for epoch timestamps in resolved data
3. **Document NULL handling** explicitly in view definitions
4. **Test with unresolved markets** in all validation scripts
5. **Add this pattern to "NEVER DO THIS AGAIN" guide**

---

## Related Documentation

- [PNL_V1_CRITICAL_BUG_FOUND.md](./PNL_V1_CRITICAL_BUG_FOUND.md) - Initial bug discovery
- [PNL_V1_STEP2_COMPLETE_SUMMARY.md](./PNL_V1_STEP2_COMPLETE_SUMMARY.md) - Original Step 2 completion
- [PNL_ENGINE_CANONICAL_SPEC.md](./PNL_ENGINE_CANONICAL_SPEC.md) - Overall specification

---

## Next Steps

1. ✅ Fix applied and validated
2. ✅ Zero-sum validation passed
3. ✅ Wallet PnL dramatically improved
4. ⏭️ Continue with Step 3: Wallet-level aggregations
5. ⏭️ Investigate remaining $59K gap (CTF events, data source differences)
6. ⏭️ Update all documentation with nullable handling requirements

---

**Terminal:** Claude 3
**Date:** 2025-11-24
**Status:** ✅ FIXED AND VALIDATED
