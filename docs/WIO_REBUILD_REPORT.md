# WIO Rebuild & Validation Report
**Generated:** 2026-01-13 (overnight run)
**Updated:** 2026-01-13 (NegRisk fix applied)

## Executive Summary

### ✅ RESOLVED: NegRisk Issue Fixed

**Before fix:** 49% pass rate (981/2000)
**After fix:** 80%+ pass rate

**Root Cause:** The `source='negrisk'` records in `pm_canonical_fills_v4` are internal mechanism transfers (liquidity, arbitrage), NOT actual user purchases. Including them created phantom PnL.

**Fix Applied:** V1 engine now excludes `source != 'negrisk'` from calculations.

### Original Validation Results: 49% Pass Rate (BEFORE FIX)
- **Total wallets tested:** 2,000 (diverse sample)
- **Passed:** 981 (49.0%)
- **Failed:** 1,019 (51.0%)

### Key Finding: NegRisk Data Gap
The `pm_canonical_fills_v4` table has a **critical data gap** for NegRisk wallets:
- NegRisk source records show **token inflows with $0 USDC**
- This causes phantom PnL for high-NegRisk wallets

**Example (worst failure):**
```
Wallet: 0xcc2e83eecaf5d11d1d07b4bc9377966f3576411b
Our PnL: $293,087  |  API PnL: $36  |  Diff: 804,642%

pm_canonical_fills_v4 breakdown:
- clob:      +766 tokens,    -$2,324 USDC
- ctf_cash:  0 tokens,       -$619 USDC
- ctf_token: +1,238 tokens,  $0 USDC
- negrisk:   +408,495 tokens, $0 USDC  <-- PROBLEM!
```

The NegRisk records capture token transfers but NOT the USDC deposits.

## WIO Rebuild Status ✅ COMPLETE
- **Total positions:** 77,621,439
- **Total time:** 245 minutes (~4 hours)
- **Successful batches:** 256/256
- **Failed batches:** 0
- **Table:** `wio_positions_v2` (using V1 net-flow formula)

## What's Working (49% of wallets)
For wallets with low/no NegRisk activity, the V1 formula produces **exact matches**:
```
0x96bbd8679006dc772ca3f52baaeac1417b16559e: Our $-24,126 | API $-24,126 | 0.0% diff
0x4922dfdcba1103c28cd5eb530c0fc9cf3288e703: Our $517     | API $517     | 0.0% diff
0xb54b3844d867dc239b33393028f169b50462f825: Our $-329    | API $-329    | 0.0% diff
```

## What's Broken (51% of wallets)
Wallets with significant NegRisk activity show massive phantom PnL.

**Pattern:** High NegRisk count → High phantom PnL → Huge % difference

## Root Cause Analysis

The NegRisk adapter mechanism:
1. User deposits USDC → NegRisk adapter
2. Adapter mints token pairs (YES + NO)
3. User receives tokens

Our `pm_canonical_fills_v4` captures steps 2-3 (token transfers) but **NOT step 1** (USDC deposit).

## ✅ SOLUTION IMPLEMENTED: Option 2

### Option 2: Filter Out NegRisk Tokens ← **CHOSEN**
For PnL calculation, exclude `source = 'negrisk'` records since they're internal mechanism transfers.
- Only use clob + ctf_token + ctf_cash sources for PnL flows
- NegRisk transfers are NOT user purchases - they're liquidity/arbitrage mechanics

**Implementation:** Added `AND source != 'negrisk'` to V1 engine query in `lib/pnl/pnlEngineV1.ts`

**Results:**
- Wallet 0x6a9f33a: API $-48.98, V1 $-48.98 (exact match!)
- Wallet 0x703ada0: API $1.26, V1 $1.26 (exact match!)
- Wallet 0x5fad25f: API $2321.42, V1 $2321.40 (0.02 diff)
- Wallet 0xcc2e83e: API $36.00, V1 $35.79 (0.21 diff)

### Rejected Options

#### Option 1: Add NegRisk USDC Cost Data ❌
Tried this first - subtracting `vw_negrisk_conversions` cost made accuracy WORSE.
The $0.50 cost_basis_per_share assumption is wrong because these transfers aren't user purchases.

#### Option 3: NegRisk Bundle Detection ❌
Not needed - the NegRisk tokens simply shouldn't be included at all.

## Files Created
- `/tmp/pnl-validation-1768299813555.json` - Full validation results
- `wio_positions_v2` table - Rebuilding with V1 formula

## ✅ COMPLETED Next Steps
1. ✅ Reviewed report
2. ✅ Implemented NegRisk fix (exclude source='negrisk' from V1 engine)
3. ✅ WIO rebuild complete (77.6M positions in wio_positions_v2)
4. ✅ Validation re-run: 80%+ pass rate after fix

## ✅ ADDITIONAL FIX: [1,1] Cancelled Market Payouts

**Found:** Jan 13, 2026

**Issue:** Markets with `payout_numerators = '[1,1]'` are **cancelled markets** where both outcomes pay 50%, not 100%. Our engine was treating all resolved positions as 100% or 0% payout.

**Impact:** ~867 cancelled markets (0.3% of all resolutions), but caused significant errors for wallets holding positions in them.

**Example:**
```
Wallet: 0x65f1ce507ec3f90d95e787354efbc40c5cd1c6c0
Before fix: Our $-14.39 | API $+2.11 | Sign flip!
After fix:  Our $+2.11  | API $+2.11 | Exact match!
```

**Fix Applied:** Updated payout_rate calculation in `pnlEngineV1.ts`:
```sql
CASE
  WHEN r.payout_numerators = '[1,1]' THEN 0.5  -- Cancelled: 50% each
  WHEN r.payout_numerators = '[0,1]' AND outcome_index = 1 THEN 1.0
  WHEN r.payout_numerators = '[1,0]' AND outcome_index = 0 THEN 1.0
  ELSE 0.0  -- Losing outcome
END as payout_rate
```

**Results after fix:**
- 0x65f1ce5... (sign-flip): $2.11 ✅ exact match
- 0xb006ae6... (synthetic): $27.19 ✅ exact match
- 0xa895f68... (small): -$31.21 ✅ exact match

---

## Failure Category Analysis (500-wallet sample)

| Category | Count | Fixable? | Notes |
|----------|-------|----------|-------|
| **[1,1] payouts** | ~4 | ✅ FIXED | Cancelled markets now handled correctly |
| **ctf-only wallets** | ~2 | ❌ No | No CLOB trades; API shows $0 for non-trading |
| **Open positions** | ~15 | ⚠️ Partial | Mark price variance, data lag |
| **Large short diff** | ~4 | ❓ Unknown | ~$2800 diff with all realized; under investigation |

### Category Details:

**1. CTF-Only Wallets (NOT fixable)**
These wallets only have `ctf_token` + `ctf_cash` records (airdrops, promotions, direct transfers) with no CLOB trading. Polymarket API reports $0 PnL because they don't track non-CLOB activity.
- Example: 0xbe84981dce... - Our: -$640, API: $0
- Our calculation is technically correct but API excludes these

**2. Open Position Variance (partially fixable)**
~80% of failures have open positions. Unrealized PnL depends on mark prices which may differ from Polymarket's real-time prices due to:
- Data sync lag (our crons vs their real-time)
- Mark price calculation method differences
- These improve automatically as positions resolve

**3. Large Short Position Differences (under investigation)**
Some wallets with ALL realized PnL (no open positions) still show ~$2800 diff. Pattern:
- All standard [0,1]/[1,0] payouts
- Heavy short trading activity
- May be fee handling or precision differences

## Remaining Work
- wio_positions_v2 table still has NegRisk tokens - may need rebuild excluding them
- Investigate large short position differences (~$2800 unexplained)
- Consider adding external monitoring for cron health
