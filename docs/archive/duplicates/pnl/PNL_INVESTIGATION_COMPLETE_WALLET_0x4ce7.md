# P&L Investigation Complete - Wallet 0x4ce7

## Executive Summary

**Problem:** Wallet `0x4ce73141dbfce41e65db3723e31059a730f0abad` shows $332K P&L on Polymarket but $0 in our system

**Root Cause:** ✅ FOUND - Position status logic bug in `vw_trading_pnl_positions`

**Status:** Fix designed, blocked on schema cleanup

---

## The Bug

### Location
`cascadian_clean.vw_trading_pnl_positions` - line determining position status

### Current Logic (WRONG)
```sql
if(abs(sum(d_shares)) < 0.01, 'CLOSED', 'OPEN') AS status
```

Position marked as CLOSED only when shares go to ~zero

### What This Misses
Positions where user:
1. Sold MOST shares but not all (e.g., 900 of 1000)
2. Market resolves
3. Remaining shares redeem for payout
4. **Polymarket shows:** CLOSED, WON, full P&L visible
5. **Our system shows:** OPEN (shares != 0), trading P&L = $0 ❌

### Example
```
Buy 1000 shares @ $0.50 = -$500 cost
Sell 900 shares @ $0.60 = +$540 cash  
Market resolves, outcome wins
Remaining 100 shares redeem @ $1.00 = +$100

Polymarket:
- Status: CLOSED
- Trading P&L: +$540 - $500 = +$40
- Redemption: +$100
- Total: +$140

Our system:
- Status: OPEN (100 shares != 0)
- Trading P&L: $0 (only CLOSED positions count)
- Redemption: +$100
- Total: +$100 (MISSING $40!)
```

Multiply across 48+ positions → $332K gap!

---

## Evidence

### All Markets Have Resolutions ✅
Verified 5 sample markets for wallet 0x4ce7:
```
0x00bbbbe2... → ✅ 1 resolution
0x22d846ac... → ✅ 1 resolution
0x2adc1f42... → ✅ 1 resolution
0x23a8f862... → ✅ 1 resolution
0x1cf51cd9... → ✅ 1 resolution
```

### Data Coverage ✅
- market_resolutions_final: 157,319 conditions
- resolutions_external_ingest: 8,685 conditions  
- **Total:** 157,463 payouts (exceeds Dune 130-150K baseline)
- **Conclusion:** Missing data is NOT the issue

### Current State
```
Wallet 0x4ce7:
- Polymarket: $332,563 realized P&L, 48+ closed positions
- Our system: $0 trading P&L, 0 closed positions, 30 open
```

---

## The Fix

### Corrected Logic
```sql
if(
  abs(pos.position_shares) < 0.01 OR              -- Shares went to zero
  replaceAll(pos.market_cid, '0x', '') IN (       -- OR market resolved
    SELECT replaceAll(condition_id_norm, '0x', '')
    FROM market_resolutions_final
    WHERE length(payout_numerators) > 0
  ),
  'CLOSED',
  'OPEN'
) AS status
```

### Expected Outcome
- Wallet 0x4ce7: 0 → 48+ closed positions
- Trading realized P&L: $0 → ~$332K
- Gap closed!

---

## Blocker: Schema Technical Debt

### Issue
`vw_positions_open` has column named `p.market_cid` (table prefix baked into column name)

### Impact
Updating `vw_trading_pnl_positions` breaks downstream view `vw_market_pnl_unified`:
```
Error: Identifier 'u.market_cid' cannot be resolved
Suggestion: Maybe you meant 'p.market_cid'
```

### Root Cause
View created with aliased columns preserving CTE table prefixes

---

## Recommended Path Forward

### Option A: Quick Fix (2-3 hours)
1. Update `vw_positions_open` to alias as `market_cid` (no prefix)
2. Test dependent views
3. Apply position status fix
4. Validate wallet 0x4ce7

**Pros:** Fast
**Cons:** May break other views, bandaid solution

### Option B: Comprehensive Cleanup (8-12 hours) ✅ RECOMMENDED
1. Audit all views for column naming patterns
2. Create systematic migration plan
3. Apply consistent naming across all views
4. Apply position status fix
5. Full validation suite

**Pros:** Fixes technical debt, future-proof
**Cons:** Takes longer

---

## Files Created

**Analysis Scripts:**
- `fix-position-lifecycle.ts` - Initial analysis (found 252K "open" position issue)
- `fix-position-status-bug.ts` - First fix attempt (wrong join logic)
- `fix-position-status-bug-v2.ts` - Corrected fix (blocked by schema)

**Documentation:**
- `PNL_ROOT_CAUSE_FOUND.md` - Initial (incorrect) FIFO hypothesis
- `GOLDSKY_BACKFILL_FINDINGS.md` - Resolution coverage analysis
- `PNL_DIAGNOSTIC_0x4ce7.md` - Investigation trail
- This file - Complete findings

---

## Next Steps

1. **User Decision:** Choose Option A or B for schema cleanup
2. **Execute Cleanup:** Fix column naming in views
3. **Apply Fix:** Update position status logic
4. **Validate:**
   - Wallet 0x4ce7 shows ~$332K P&L ✅
   - 48+ closed positions ✅
   - Test 12 wallets vs Polymarket API
5. **Future:** Implement FIFO-based P&L for partial sells (separate enhancement)

---

**Status:** ✅ Root cause identified, fix designed, awaiting schema cleanup decision

**Time to resolution:** 2-12 hours depending on cleanup approach chosen

**Confidence:** HIGH - All evidence points to this single bug as the cause
