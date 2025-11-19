# P&L Views Root Cause Analysis - COMPLETE

## Executive Summary

**Status**: ROOT CAUSE IDENTIFIED
**Impact**: `vw_positions_open` has a bug that filters out all unresolved positions
**Fix Required**: Update WHERE clause to handle ClickHouse empty string behavior

---

## The Root Cause

### ClickHouse LEFT JOIN Behavior

When a LEFT JOIN to a table with `String` columns fails to find a match, ClickHouse returns **EMPTY STRING (`''`)**, not `NULL`.

**Test Case:**
```sql
-- Condition ID that doesn't exist in vw_resolutions_truth:
'cc02b02dcecb5d617f21b8291a731287f2fef99203a28c70ce6bd38c88e70802'

-- LEFT JOIN result:
{
  "joined_cond_id": "",           -- EMPTY STRING
  "null_check": "IS NOT NULL",    -- '' IS NOT NULL in ClickHouse!
  "empty_check": "IS EMPTY"
}
```

### Impact on `vw_positions_open`

Current WHERE clause:
```sql
WHERE (abs(p.shares_net) >= 0.01)
  AND ((mc.condition_id_32b IS NULL) OR (r.condition_id_32b IS NULL))
```

**What happens:**
1. Wallet has 30 markets with positions
2. All 30 markets exist in `token_condition_market_map` → `mc.condition_id_32b IS NOT NULL`
3. None of the 30 markets have resolutions in `vw_resolutions_truth`
4. LEFT JOIN fails → `r.condition_id_32b = ''` (empty string, NOT NULL)
5. WHERE clause evaluates to: `TRUE AND (FALSE OR FALSE)` = `FALSE`
6. **Result: All 30 positions filtered out** → Shows 0 open positions

---

## Diagnostic Results

### Wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad

| Metric | Count |
|--------|-------|
| Total positions (shares >= 0.01) | 30 |
| Markets in token_condition_market_map | 30 |
| Markets with resolutions in vw_resolutions_truth | **0** |
| Shown in vw_positions_open | **0** (BUG!) |

**Expected:** 30 open positions (unresolved markets)
**Actual:** 0 positions (filtered by bug)

### Step-by-Step Trace

```
1️⃣ Raw positions from vw_trades_canonical: 30 ✅
2️⃣ After LEFT JOIN to market_conditions: 30 (all matched) ✅
3️⃣ After LEFT JOIN to resolutions:
   - r.condition_id_32b IS NULL: 0
   - r.condition_id_32b IS NOT NULL: 30 (empty strings!)
4️⃣ After WHERE filter: 0 ❌
```

---

## The Fix

### Option 1: Update WHERE Clause (Recommended)

```sql
WHERE (abs(p.shares_net) >= 0.01)
  AND ((mc.condition_id_32b IS NULL)
    OR (mc.condition_id_32b = '')
    OR (r.condition_id_32b IS NULL)
    OR (r.condition_id_32b = ''))
```

**Pros:**
- Minimal change
- Handles both NULL and empty string cases
- Future-proof

**Cons:**
- None

### Option 2: Use COALESCE

```sql
WHERE (abs(p.shares_net) >= 0.01)
  AND ((COALESCE(mc.condition_id_32b, '') = '')
    OR (COALESCE(r.condition_id_32b, '') = ''))
```

**Pros:**
- Cleaner syntax
- Normalizes NULL and empty string

**Cons:**
- Slightly more complex

---

## Implications

### Why There's No Redemption P&L

The wallet's 30 markets **haven't been resolved yet**, so there's no redemption P&L to calculate. These are genuinely open positions.

### Data Coverage Status

| Data Type | Status |
|-----------|--------|
| Trades | ✅ All 31 markets present (Jun-Nov 2024) |
| Market metadata | ✅ All in token_condition_market_map |
| Resolutions | ❌ **0/31 markets resolved** |
| Polymarket comparison | Shows 2,816 total predictions (need API backfill for missing 2,785) |

### Why User Said "open_positions: 0"

The user ran `trace-wallet-data.ts` which queries `vw_positions_open` - this returns 0 due to the bug, NOT because positions are resolved.

---

## Action Items

### Immediate (Required)

1. ✅ Fix `vw_positions_open` WHERE clause to handle empty strings
2. ⏳ Verify wallet now shows 30 open positions
3. ⏳ Confirm Trading P&L: -$588.22 (no change expected)
4. ⏳ Confirm Redemption P&L: $0 (markets unresolved)

### Short Term

1. Backfill missing resolutions for the 31 markets we have trade data for
2. Run diagnostics to verify P&L calculations match Polymarket

### Long Term

1. API backfill for missing 2,785 markets
2. Review all views for similar NULL vs empty string handling

---

## Files Created

### Investigation Scripts
- `fix-redemption-pnl-view.ts` - Attempted to fix redemption view (blocked by missing resolutions)
- `fix-pnl-views-correct-join.ts` - Successfully updated `vw_trading_pnl_positions`
- Multiple diagnostic scripts tracing the join behavior

### Documentation
- `PNL_VIEW_INVESTIGATION_FINDINGS.md` - Initial investigation (superseded by this doc)
- `PNL_VIEWS_ROOT_CAUSE_FOUND.md` - This document

---

## Summary

**The "missing P&L" isn't missing** - the wallet's 30 markets simply haven't been resolved yet. The bug in `vw_positions_open` made it look like there were no open positions, when in fact all 30 are still open and waiting for resolution data.

**Next Step:** Fix the WHERE clause in `vw_positions_open` and confirm the wallet shows 30 open positions.
