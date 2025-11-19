# Executive Summary: P&L Fix Strategy

## What We Learned (Wrong Path)

We built three-layer P&L views and thought the $333K gap was from missing midprices.

**That was wrong.**

## The Real Problems

1. **ID Mapping Bug:** We truncated condition_ids to create market_ids without proving the mapping works
2. **NULL Handling Bug:** Coalesced missing midprices to $0 → made unrealized P&L negative instead of NULL
3. **Dirty Resolution Data:** Used warehouse rows with empty payout vectors
4. **No Validation:** Never proved joins work on one wallet before going system-wide

## Why Midprice Backfill Won't Help

Most markets are **delisted**. The CLOB API returns empty orderbooks for delisted markets. We'd fetch thousands of markets and get nothing back. Waste of time.

## The Right Fix (6 Steps)

### Step 1: Build ID Mapping Table ⚠️ CRITICAL
Create `token_id → condition_id → market_id` mapping table. Stop truncating IDs blindly.

### Step 2: Build Truth Resolutions View
Filter for REAL payouts only (sum(numerators) = denominator, denominator > 0). Exclude warehouse.

### Step 3: Validate Joins on One Wallet
Prove the mapping + truth view work for audit wallet BEFORE going system-wide.

### Step 4: Fix NULL Handling in P&L Views
- Layer 1 (CLOSED): Keep as-is ✅
- Layer 2 (ALL): Return NULL for missing prices (not $0) + mark "AWAITING_QUOTES"
- Layer 3 (SETTLED): Use mapping table + truth view for joins

### Step 5: Add Coverage Telemetry
Ship `{ quote_coverage_pct: 6.7%, payout_coverage_pct: 0%, coverage_quality: "AWAITING_QUOTES" }` with every wallet.

### Step 6: Defer Midprice Backfill
Only consider after Steps 1-5 work, and only for provably-active markets.

## Definition of Done

✅ ID mapping table has consistent 1:1:1 mapping
✅ Truth view has 176 valid payouts with correct sums
✅ Audit wallet diagnostic proves joins work
✅ Layer 2 returns NULL (not negative) for missing prices
✅ All 12 audit wallets show sensible numbers
✅ Coverage telemetry shipped with every response

## Expected Result After Fix

**Before (broken):**
```
Trading P&L: -$494.52
Unrealized P&L: -$677.28  ← WRONG (from $0 coalesce)
Total: -$1,171.79
```

**After (correct):**
```
Trading P&L: -$494.52 ✅
Unrealized P&L: NULL (AWAITING_QUOTES - 2/30 positions priced) ✅
Settled P&L: $0.00 (0/30 positions settled) ✅

⚠️ Coverage: 6.7% - Most markets delisted, quotes unavailable
```

This is **honest** and **correct** (not broken).

## Timeline

- Day 1 (2-3h): Steps 1-3 (mapping + validation)
- Day 2 (2-3h): Steps 4-5 (fix views + telemetry)
- Day 3 (1h): Step 6 (audit + report)

## Next Action

Start with `step1-build-id-mapping.ts` - build the token↔condition↔market mapping table and validate it's consistent.

**Full guide:** `CLAUDE_PNL_FIX_GUIDE.md`
