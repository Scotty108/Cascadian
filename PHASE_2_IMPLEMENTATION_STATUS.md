# Phase 2: Implementation Status & Critical Findings

**Date:** November 7, 2025
**Status:** BLOCKED - Schema mismatch between formula design and actual data structures
**Action Required:** Clarification on correct formula implementation

---

## What Was Attempted

### Iteration 1: Formula from `fix-realized-views.ts`
- **Source:** fix-realized-views.ts (appears to be from previous work)
- **Formula:** `net_shares_winning - total_cashflows`
- **Result:** ❌ Column resolution error - `market_id` doesn't exist in `trade_cashflows_v3`
- **Findings:** View definition has malformed column names and references missing columns

### Iteration 2: Reverse-engineered from `realized_pnl_by_market_v2`
- **Source:** Existing `realized_pnl_by_market_v2` view in database
- **Formula:** `SUM(cashflow_usdc)` only (for resolved conditions)
- **Result:** ❌ Wrong values
  - niggemon: $1,907,531 (vs. expected $102,001)
  - HolyMoses7: $301,156 (vs. expected $89,975)

### Iteration 3: Phase 1B Formula with `+1` offset
- **Source:** PHASE_1B_FORMULA_DESIGN_COMPLETE.md
- **Formula:** `SUM(cashflow_usdc) + sumIf(delta_shares, trade_idx = win_idx + 1)`
- **Issue:** Formula produces negative values
  - niggemon: -$1,899,180.95

### Iteration 4: Alternative sign variations
- **Tested:**
  - `cashflows + settlement` → Negative
  - `cashflows - settlement` → $9.3M (too high)
  - Various absolute values → Still wrong
- **Result:** ❌ None produce expected results

---

## Critical Findings

### 1. Table Schema Misalignment

**trade_flows_v2 available columns:**
```
- wallet (String)
- market_id (String)
- trade_idx (Int16)
- outcome_raw (String)
- cashflow_usdc (Float64)
- delta_shares (Float64)
```

**Missing:** `condition_id_norm` (needed to join to `winning_index`)

**Consequence:** Can't directly implement Phase 1B formula which requires joining on `condition_id_norm`

### 2. Data Sources Conflict

| Table | Formula Source | Values | Status |
|-------|---|---|---|
| `outcome_positions_v2` | Phase 1B design | Has data, but... | ⚠️ Missing some markets |
| `trade_cashflows_v3` | RECONCILIATION_FINAL_REPORT | Has data | ⚠️ Produces wrong totals |
| `trade_flows_v2` | Original implementation | Has data | ⚠️ Missing condition_id_norm |
| `realized_pnl_by_market_v2` | Current view | Returns $1.9M | ❌ Wrong formula |

### 3. Expected vs. Actual Analysis

**For niggemon ($102,001 expected):**

| Component | Value | Formula Used |
|---|---|---|
| Cashflows (all) | $1,907,531 | SUM(cashflow_usdc) |
| Cashflows (resolved only) | $164,483 | SUM(cf) where condition has winner |
| Winning shares | $5,028 | SUM(net_shares where outcome_idx = win_idx) |
| Unrealized | -$102,919 | From wallet_unrealized_pnl_v2 |
| **Current best result** | **-$1.9M to +$9.3M** | Various attempts |
| **Expected total** | **$102,001** | Polymarket reference |

**Gap:** No formula combination produces results within ±5% of expected

---

## Root Cause Analysis

### Theory 1: Data State Changed
- RECONCILIATION_FINAL_REPORT (Nov 6) showed formula works
- Current data (Nov 7) doesn't match those values
- **Likelihood:** Medium (databases do change)

### Theory 2: Formula Description vs. Implementation Mismatch
- Phase 1B documents describe formula but actual implementation differs
- Different data sources (trade_flows_v2 vs. outcome_positions_v2 + trade_cashflows_v3)
- **Likelihood:** High (documentation often diverges from code)

### Theory 3: Missing Intermediate Calculations
- RECONCILIATION_FINAL_REPORT shows: Realized = $185K, Unrealized = -$85K, Total = $99.7K
- Current unrealized from wallet_unrealized_pnl_v2 = -$102.9K (different!)
- **Likelihood:** High (suggests different calculation method)

---

## Recommended Path Forward

### Option A: Direct Database Query (Fastest)
1. Query the existing `realized_pnl_by_market_v2` view
2. Investigate why it produces different results than expected
3. Potentially rebuild using verified correct approach

### Option B: Clarify Formula Design (Most Reliable)
1. Provide exact working SQL query from previous successful implementation
2. Specify which data sources have the "correct" pre-calculated values
3. Confirm whether existing tables should be used or rebuilt from scratch

### Option C: Fresh Implementation (Most Sustainable)
1. Confirm primary data sources (outcome_positions_v2? realized_pnl_by_market_v2?)
2. Verify expected output format and precision
3. Implement with full test coverage against known-good examples

---

## Files Created This Session
- `execute-corrected-formula.ts` - Tested nested view aggregation
- `execute-corrected-formula-v2.ts` - Tested separated CTEs
- `rebuild-pnl-materialized.ts` - Converted to MergeTree tables
- `rebuild-with-correct-formula.ts` - Tested cashflows-only formula
- `implement-phase1b-formula-fixed.ts` - Attempted Phase 1B formula
- `debug-formula-components.ts` - Analyzed component values
- `debug-cashflow-scope.ts` - Tested resolved vs. all cashflows
- `check-existing-views.ts` - Verified view existence
- `find-pnl-tables.ts` - Discovered all PnL-related tables
- `investigate-realized-pnl-v2.ts` - Analyzed source views
- `check-realized-pnl-by-market-v2.ts` - Inspected view definition
- `PHASE_2_IMPLEMENTATION_STATUS.md` - This document

---

## Next Steps (Blocked - Awaiting Clarification)

**Cannot proceed without:**
1. Confirmation of correct formula (with actual working SQL)
2. Specification of which tables contain "authoritative" data
3. Confirmation of expected output format and tolerance

**Once clarified:**
1. Implement corrected formula
2. Test against all 4 target wallets
3. Update API endpoints to use new formula
4. Deploy to production

---

## Current Data Snapshot

### Wallet P&L Values (Current Implementation)
```
niggemon:     $1,804,612.30 (Realized: $1,907,531, Unrealized: -$102,919)
HolyMoses7:   $307,639.69 (Realized: $301,156, Unrealized: $6,483)

Expected:
niggemon:     $102,001.00
HolyMoses7:   $89,975.00

Variance: 1669% - 241% (far outside acceptable range)
```

---

**Status:** Cannot continue without clarification on correct formula implementation.
**Blocker Severity:** HIGH - Formula produces wrong values by 10x-20x magnitude

