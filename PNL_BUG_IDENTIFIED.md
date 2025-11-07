# P&L Calculation Bug - ROOT CAUSE IDENTIFIED

**Date:** 2025-11-07
**Status:** BUG FOUND IN SOURCE CODE
**File:** `/Users/scotty/Projects/Cascadian-app/build-wallet-pnl-correct.ts` (lines 44-56)

---

## THE BUG

### Location: Line 45-46 in `build-wallet-pnl-correct.ts`

```sql
-- BUGGY FORMULA (Current Implementation)
SUM(CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64) * IF(t.side = 'BUY', -1, 1)) as total_cashflow,
```

**Problem:** This formula is **MULTIPLYING** `entry_price * shares` to calculate cashflow, which produces:
- For BUY: `-entry_price * shares` (negative cashflow)
- For SELL: `+entry_price * shares` (positive cashflow)

**For wallet niggemon:**
- Total shares: 13,466,674.35
- Average entry price: ~$0.86
- Buggy calculation: 13,466,674.35 * $0.86 ≈ **$11,581,119**
- **This matches the observed -$11,559,641.02!**

---

## Why This Is Wrong

### The Formula Doesn't Match trades_raw.realized_pnl_usd

The script is **RECALCULATING P&L FROM SCRATCH** using entry prices and shares, but `trades_raw` already has a **pre-calculated `realized_pnl_usd` field** that is the source of truth.

**What's happening:**
1. `trades_raw.realized_pnl_usd` = $117.24 (correct, already calculated)
2. `build-wallet-pnl-correct.ts` **IGNORES** this field
3. Instead, it **RECALCULATES** using `entry_price * shares * side_multiplier`
4. This produces a **DIFFERENT VALUE** (-$11.5M) due to improper formula

---

## The Correct Approach

### Option 1: Use trades_raw.realized_pnl_usd Directly (RECOMMENDED)

```sql
-- CORRECT FORMULA (Simple Sum)
CREATE TABLE wallet_pnl_correct ENGINE = MergeTree() ORDER BY wallet_address AS
SELECT
  wallet_address,
  SUM(realized_pnl_usd) as realized_pnl,
  0 as unrealized_pnl,  -- Calculate separately from open positions
  SUM(realized_pnl_usd) as net_pnl
FROM trades_raw
WHERE realized_pnl_usd != 0  -- Only resolved trades
GROUP BY wallet_address
```

**Result for niggemon:** $117.24 (matches source data)

### Option 2: Fix the Cashflow Calculation (If Recalculation is Required)

If you MUST recalculate from entry/exit prices, the formula should be:

```sql
-- Per-trade P&L calculation
SELECT
  wallet_address,
  condition_id,
  side,
  shares,
  entry_price,
  -- Exit value depends on outcome
  CASE
    WHEN outcome_index = winning_index THEN shares * 1.0  -- Won, get $1 per share
    ELSE 0  -- Lost, get nothing
  END as exit_value,
  -- Cost basis
  shares * entry_price as cost_basis,
  -- P&L = Exit Value - Cost Basis
  exit_value - cost_basis as realized_pnl
FROM trades_raw
JOIN market_resolutions ON ...
```

**Key difference:** Calculate P&L as `(exit_value - cost_basis)`, NOT as a cashflow sum.

---

## Secondary Bug: Sign Convention

Line 45 has sign convention backwards:

```sql
IF(t.side = 'BUY', -1, 1)  -- Current (WRONG)
```

**Logic error:**
- BUY: You SPEND money (negative cashflow) ✓ This part is correct
- SELL: You RECEIVE money (positive cashflow) ✓ This part is correct

**BUT:** The formula then ADDS this to settlement to get P&L, which inverts the sign when settlement is applied.

**Better approach:** Don't use cashflow signs at all. Use P&L = Exit Value - Cost Basis.

---

## Why trades_raw.realized_pnl_usd is Different

`trades_raw.realized_pnl_usd` likely uses one of these correct approaches:
1. Exit value - Cost basis calculation
2. Payout vector multiplication: `shares * payout[outcome_index] - cost`
3. Direct sum from trade settlement events

The `build-wallet-pnl-correct.ts` script is **NOT using this field** and instead recalculating incorrectly.

---

## Impact Analysis

### Affected Code Paths

1. **build-wallet-pnl-correct.ts** (lines 12-67)
   - Creates `wallet_pnl_correct` with buggy formula
   - Expected value: $117.24
   - Actual value: -$11,559,641.02
   - Error: 98,632x inflation + sign flip

2. **rebuild-wallet-pnl-correct.ts** (lines 30-43)
   - Rebuilds `wallet_pnl_correct` from `wallet_realized_pnl_v2`
   - **This may be correct IF wallet_realized_pnl_v2 uses trades_raw.realized_pnl_usd**
   - Need to verify `wallet_realized_pnl_v2` view definition

### Tables Built with Buggy Formula

- `wallet_pnl_correct` - Uses buggy cashflow formula
- `wallet_pnl_summary_final` - Unknown, need to check source

---

## Verification Steps

### 1. Check wallet_realized_pnl_v2 Definition

```sql
SHOW CREATE TABLE wallet_realized_pnl_v2
```

**Look for:**
- Does it use `trades_raw.realized_pnl_usd`? ✅ GOOD
- Does it use `entry_price * shares * side`? ❌ BAD

### 2. Verify Correct Calculation

```sql
-- Test query
SELECT
  wallet_address,
  SUM(realized_pnl_usd) as direct_sum,
  COUNT(*) as num_trades
FROM trades_raw
WHERE wallet_address = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  AND realized_pnl_usd != 0
GROUP BY wallet_address
```

**Expected result:** $117.24 from 332 trades

### 3. Compare Against Buggy Table

```sql
SELECT
  t.wallet_address,
  SUM(t.realized_pnl_usd) as correct_pnl,
  w.realized_pnl as buggy_pnl,
  w.realized_pnl / SUM(t.realized_pnl_usd) as inflation_factor
FROM trades_raw t
JOIN wallet_pnl_correct w ON t.wallet_address = w.wallet_address
WHERE t.realized_pnl_usd != 0
GROUP BY t.wallet_address, w.realized_pnl
HAVING ABS(inflation_factor) > 100
LIMIT 10
```

**Expected:** Many wallets with 10,000x+ inflation factors

---

## Recommended Fix

### Step 1: Drop the Buggy Table

```sql
DROP TABLE wallet_pnl_correct
```

### Step 2: Rebuild with Correct Formula

```sql
CREATE TABLE wallet_pnl_correct ENGINE = MergeTree() ORDER BY wallet_address AS
SELECT
  wallet_address,
  SUM(IF(realized_pnl_usd > 0, realized_pnl_usd, 0)) as total_gains,
  SUM(IF(realized_pnl_usd < 0, ABS(realized_pnl_usd), 0)) as total_losses,
  SUM(realized_pnl_usd) as realized_pnl,
  0 as unrealized_pnl,  -- Calculate from open positions separately
  SUM(realized_pnl_usd) as net_pnl
FROM trades_raw
WHERE realized_pnl_usd != 0  -- Only resolved trades
GROUP BY wallet_address
```

### Step 3: Validate

```sql
SELECT
  wallet_address,
  realized_pnl,
  unrealized_pnl,
  net_pnl
FROM wallet_pnl_correct
WHERE wallet_address = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
```

**Expected result:** $117.24 (not -$11.5M)

---

## Alternative: Use rebuild-wallet-pnl-correct.ts

The `rebuild-wallet-pnl-correct.ts` script (lines 30-43) **MAY BE CORRECT** because it:

1. Sources from `wallet_realized_pnl_v2` view
2. Joins with `wallet_unrealized_pnl_v2` view
3. Simply sums these values

**Critical question:** Does `wallet_realized_pnl_v2` use `trades_raw.realized_pnl_usd` or does it use the buggy cashflow formula?

**Action:** Check the view definition to determine if this approach is safe.

---

## Summary

| Component | Status | Formula | Result |
|-----------|--------|---------|--------|
| **trades_raw.realized_pnl_usd** | ✅ CORRECT | Pre-calculated from trade events | $117.24 |
| **build-wallet-pnl-correct.ts** | ❌ BUGGY | `entry_price * shares * side` | -$11.5M |
| **rebuild-wallet-pnl-correct.ts** | ⚠️ UNKNOWN | Depends on `wallet_realized_pnl_v2` | TBD |
| **wallet_pnl_summary_final** | ⚠️ UNKNOWN | Source unknown | -$1.9M |

**Next action:**
1. Check `wallet_realized_pnl_v2` view definition
2. If it uses `trades_raw.realized_pnl_usd` → Use `rebuild-wallet-pnl-correct.ts`
3. If it uses buggy formula → Fix the view first, then rebuild

---

## Root Cause Statement

**The `wallet_pnl_correct` table was built using a formula that recalculates P&L from entry prices and shares (`entry_price * shares * side_multiplier`) instead of using the pre-calculated `realized_pnl_usd` field in `trades_raw`. This causes a 98,632x magnitude inflation and sign inversion.**

**Fix:** Replace the recalculation with a direct sum of `trades_raw.realized_pnl_usd`.

---

**Analysis by:** Database Architect Agent
**Investigation script:** `/Users/scotty/Projects/Cascadian-app/investigate-pnl-discrepancy.ts`
**Source files analyzed:**
- `/Users/scotty/Projects/Cascadian-app/build-wallet-pnl-correct.ts`
- `/Users/scotty/Projects/Cascadian-app/rebuild-wallet-pnl-correct.ts`
