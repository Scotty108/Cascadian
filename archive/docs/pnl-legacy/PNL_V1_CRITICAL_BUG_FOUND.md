# PnL Engine V1 - CRITICAL BUG: Unresolved Markets Marked as Resolved

**Status:** 🚨 CRITICAL BUG IDENTIFIED
**Date:** 2025-11-24
**Impact:** Massive PnL discrepancy vs Polymarket UI ($114K+ difference)

---

## Executive Summary

**BUG:** All markets (resolved AND unresolved) are being marked as `is_resolved = 1` in `vw_pm_realized_pnl_v1`.

**ROOT CAUSE:** ClickHouse non-nullable types return DEFAULT values (0 for Float64, epoch for DateTime) when LEFT JOIN finds no match, making `resolved_price IS NOT NULL` always TRUE.

**IMPACT:**
- Wallet `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`:
  - **Our calculation**: 115 markets, -$18,362 PnL
  - **Polymarket UI**: 92 predictions, ~$96,000 profit
  - **Discrepancy**: $114,000+ (600% error!)

---

## Technical Details

### View Schema Issue

**`vw_pm_resolution_prices`:**
```sql
`resolved_price` Float64,     -- NON-NULLABLE!
`resolution_time` DateTime,   -- NON-NULLABLE!
```

**`vw_pm_realized_pnl_v1`:**
```sql
LEFT JOIN vw_pm_resolution_prices r
  ON t.condition_id = r.condition_id
  AND t.outcome_index = r.outcome_index

...

r.resolved_price IS NOT NULL AS is_resolved,  -- ALWAYS TRUE!
r.resolved_price > 0 AS is_winner
```

### What Happens

**Resolved Market (correct):**
- LEFT JOIN finds match
- `resolved_price` = 0.0 or 1.0 (actual value)
- `resolution_time` = actual timestamp
- `is_resolved` = 1 ✅
- `is_winner` = 0 or 1 ✅

**Unresolved Market (BUG):**
- LEFT JOIN finds NO match
- `resolved_price` = **0.0** (default for Float64, NOT NULL!)
- `resolution_time` = **"1970-01-01 00:00:00"** (default for DateTime, NOT NULL!)
- `is_resolved` = **1** ❌ WRONG! Should be 0
- `is_winner` = **0** ❌ WRONG! Market not resolved

### Evidence

**Market `f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1`:**

```bash
# Check pm_condition_resolutions
$ No rows found ❌

# Check vw_pm_resolution_prices
$ No rows found ❌

# Check vw_pm_realized_pnl_v1
$ 2 rows found:
{
  "resolved_price": 0,              ← DEFAULT VALUE, NOT ACTUAL!
  "resolution_time": "1970-01-01",  ← EPOCH, NOT ACTUAL!
  "is_resolved": 1,                  ← WRONG!
  "is_winner": 0,                    ← WRONG!
  "realized_pnl": -60419.52          ← COUNTING UNRESOLVED MARKET!
}
```

This market:
- Has **74 trades** ($-57K impact)
- Is **NOT resolved** (no resolution data)
- Is being **counted as resolved** in our PnL
- Polymarket UI **excludes it** from PnL

---

## Impact Analysis

### Wallet `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`

**Our Calculation (INCORRECT):**
- 115 "resolved" markets
- -$18,362.49 PnL
- Includes BOTH resolved AND unresolved markets

**Polymarket UI (CORRECT):**
- 92 predictions
- ~$96,000 profit
- Only ACTUALLY resolved markets

**Difference:**
- 23 extra markets being counted
- $114,000+ PnL error
- 600% discrepancy!

### Pattern Found

From diagnostic:
- **44 markets** with negative trade_cash + zero resolution_cash = **-$127K impact**
- **78 markets** with positive trade_cash + zero resolution_cash = **+$72K impact**

These are UNRESOLVED markets being included in "resolved" PnL!

---

## The Fix

### Option 1: Use Nullable Types (Recommended)

**Modify `vw_pm_resolution_prices`:**
```sql
CREATE OR REPLACE VIEW vw_pm_resolution_prices AS
SELECT
    lower(r.condition_id) AS condition_id,
    idx - 1 AS outcome_index,
    toNullable(numerator / arraySum(numerators)) AS resolved_price,  -- Make nullable
    toNullable(r.resolved_at) AS resolution_time,                    -- Make nullable
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

**Then LEFT JOIN will return:**
- `resolved_price` = NULL (when no match)
- `resolution_time` = NULL (when no match)
- `is_resolved` = 0 (correct!)

### Option 2: Explicit NULL Check

**Modify `vw_pm_realized_pnl_v1`:**
```sql
-- Instead of: r.resolved_price IS NOT NULL AS is_resolved
-- Use explicit check for default values:

(r.resolved_price IS NOT NULL
 AND r.resolution_time > toDateTime('1970-01-01 01:00:00')) AS is_resolved
```

This filters out the epoch default value.

### Option 3: Use INNER JOIN for Resolved Markets

Create TWO views:

**`vw_pm_pnl_all`** (LEFT JOIN, includes unresolved):
```sql
LEFT JOIN vw_pm_resolution_prices r ...
```

**`vw_pm_pnl_resolved_only`** (INNER JOIN, resolved only):
```sql
INNER JOIN vw_pm_resolution_prices r ...
```

Then queries use the appropriate view:
- UI comparisons: use `vw_pm_pnl_resolved_only`
- Full analysis: use `vw_pm_pnl_all`

---

## Recommendation

**Implement Option 1 + Option 3:**

1. ✅ Fix `vw_pm_resolution_prices` to use Nullable types
2. ✅ Fix `vw_pm_realized_pnl_v1` to handle NULL correctly
3. ✅ Create `vw_pm_pnl_resolved_only` for UI comparisons
4. ✅ Keep `vw_pm_realized_pnl_v1` for full analysis (with correct is_resolved flag)

This gives us:
- Correct NULL handling
- Explicit separation of resolved vs all markets
- Backwards compatibility with existing queries

---

## Next Steps

1. **IMMEDIATE:** Create fixed views with Nullable types
2. **IMMEDIATE:** Rerun wallet verification with corrected PnL
3. **VALIDATION:** Verify corrected PnL matches Polymarket UI
4. **UPDATE:** Update all documentation and validation scripts
5. **DOCUMENT:** Add this to "NEVER DO THIS AGAIN" guide

---

## Lessons Learned

1. **Always use Nullable types for LEFT JOIN columns** that might not have matches
2. **ClickHouse returns DEFAULT values, not NULL** for non-nullable types
3. **Test with markets that have NO resolution** to catch this bug
4. **Epoch timestamps indicate default/NULL values** in DateTime fields
5. **Large PnL discrepancies require deep investigation**, not just "rounding errors"

---

## Related Files

- `scripts/diagnose-wallet-discrepancy.ts` - Identified the problem pattern
- `scripts/investigate-specific-market.ts` - Proved market has no resolution
- `scripts/check-pnl-view-for-market.ts` - Showed is_resolved=1 for unresolved market
- `scripts/check-resolution-view-for-market.ts` - Confirmed 0 resolution rows
- `scripts/show-view-definition.ts` - Revealed non-nullable types

---

**Terminal:** Claude 3
**Date:** 2025-11-24
**Status:** Bug identified, fix pending implementation
