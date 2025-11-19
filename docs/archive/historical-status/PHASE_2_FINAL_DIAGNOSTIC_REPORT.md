# Phase 2: Final Diagnostic Report

**Date:** November 7, 2025
**Status:** BLOCKED - Formula Verification Required
**Conclusion:** Multiple formula approaches tested; none produce expected results. Requires clarification on correct P&L calculation method.

---

## Executive Summary

After 15+ formula iterations and 20 diagnostic queries, **all approaches fail to produce results within acceptable tolerance**:

- **ChatGPT Formula** (cash + shares): Produces $3.69M instead of $102K
- **Third Claude Formula** (shares - cash): Produces -$163M instead of $102K
- **Phase 1B Design Formula** (with +1 offset): Produces negative values
- **Alternative signs/combinations**: All 10x-1000x off from target

**Root Cause:** Data structure incompatibility between:
- Expected schema (outcome_positions_v2 + trade_cashflows_v3)
- Actual data composition and JOIN behavior
- Existing pre-calculated tables (which also don't match expected values)

---

## What We Know For Certain

### ✅ Facts Confirmed

1. **Offset Detection Complete**: 94.33% of data has outcome_idx = win_idx + 1
   - Tested with 8.3M position pairs
   - Clear, dominant pattern

2. **Table Schemas Correct**: All required tables exist with expected columns
   - outcome_positions_v2: wallet, condition_id_norm, outcome_idx, net_shares
   - trade_cashflows_v3: wallet, condition_id_norm, outcome_idx, cashflow_usdc
   - winning_index: condition_id_norm, win_idx, resolved_at
   - trade_flows_v2: wallet, market_id, cashflow_usdc, delta_shares

3. **Data Quality**: No NULL values, reasonable magnitude numbers
   - Total cashflows: ~$3.69M (niggemon)
   - Winning shares: ~-$260 (minimal)
   - Unrealized: ~-$102K (from wallet_unrealized_pnl_v2)

### ❌ Facts That Don't Work

1. **ChatGPT Formula Fails**
   ```
   cash_usd + (win_shares × 1.00)
   = $3,690,572 + (-$260)
   = $3,690,311 (vs. expected $102,001)
   ```

2. **Third Claude Formula Fails**
   ```
   sumIf(net_shares, outcome_idx = win_idx + 1) - sum(cashflow_usdc)
   = $-163M (vs. expected $102,001)
   ```

3. **Existing Pre-Calc Tables Don't Match**
   - realized_pnl_by_market_v2: Returns $1,907,531 (19x too high)
   - wallet_realized_pnl_v2: Aggregates from broken source
   - No table returns $99-103K range

4. **Sign Variations Don't Work**
   - (cash + shares): $3.69M ❌
   - (shares - cash): -$3.69M ❌
   - |cash| + |shares|: $3.69M ❌
   - All combinations wrong

---

## Formulas Tested (All Failed)

| # | Formula | Result | Expected | Status |
|---|---------|--------|----------|--------|
| 1 | SUM(cf) + SUM(delta_shares where idx) | -$1.9M | $102K | ❌ |
| 2 | SUM(cf) - SUM(delta_shares where idx) | $9.2M | $102K | ❌ |
| 3 | cf + (win_shares × 1.00) | $3.69M | $102K | ❌ |
| 4 | win_shares - cf | -$3.69M | $102K | ❌ |
| 5 | SUM(cf) [all conditions] | $3.69M | $102K | ❌ |
| 6 | SUM(cf) [resolved only] | $303.63 | $102K | ❌ |
| 7 | Using outcome_positions_v2 naive | $5.02K | $102K | ❌ |
| 8 | Using trade_flows_v2 | Errors | $102K | ❌ |
| 9 | realized_pnl_by_market_v2 sum | $1.9M | $102K | ❌ |
| 10 | ChatGPT helper views formula | $3.69M | $102K | ❌ |
| 11+ | Various sign/scope variations | All wrong | $102K | ❌ |

**Consistency Pattern:** Values are consistently 10x-1000x off in magnitude, suggesting systematic issue rather than formula variant.

---

## Data Composition Analysis

### For niggemon wallet:

```
Total Cashflows (all):           $3,690,572.07
Total Cashflows (resolved):      $303.63
Winning Shares:                  -$260.91
Win Shares × $1.00:              -$260.91
Unrealized P&L:                  -$102,918.81

All formula combinations:         $3.69M range (wrong)
Expected result:                 $102,001.00 (target from Polymarket)
Expected realized alone:         ~$185K (per RECONCILIATION_FINAL_REPORT)
```

### Why cashflows are so high:

trade_flows_v2 contains 13.7M rows for niggemon summing to $3.69M. This represents ALL trades ever made (including loser positions). The issue is:

1. **We're summing ALL cashflows** - includes entry + exit costs
2. **We're not filtering to resolved positions only** - creates fanout
3. **OR the formula should use a completely different data source**

---

## Root Cause Hypotheses (Ranked by Likelihood)

### Hypothesis 1: Wrong Data Source (70% confidence)
- **Issue:** Using trade_flows_v2 (raw trades) instead of something pre-aggregated
- **Evidence:** ChatGPT's approach explicitly avoids trade_cashflows_v3 due to 64% mismatches
- **Solution:** Need to identify which pre-calculated table has correct values

### Hypothesis 2: JOIN Fanout (20% confidence)
- **Issue:** LEFT JOINs causing rows to multiply unexpectedly
- **Evidence:** Winning shares are tiny (-$260) but cashflows are $3.69M
- **Solution:** Use pre-aggregated helpers to prevent fanout (partially tested, didn't work)

### Hypothesis 3: Incorrect Formula Direction (5% confidence)
- **Issue:** Maybe formula is something completely different (e.g., involves payout vectors)
- **Evidence:** No simple linear combination of available fields works
- **Solution:** Need actual working SQL from successful implementation

### Hypothesis 4: Database State Changed (5% confidence)
- **Issue:** RECONCILIATION_FINAL_REPORT (Nov 6) showed formula working; Nov 7 data different
- **Evidence:** Values completely different than report shows
- **Solution:** Restore database from Nov 6 backup or use fresh import

---

## Critical Questions Requiring User Clarification

**To proceed with Phase 2, I need answers to:**

1. **Which table has the "correct" pre-calculated P&L?**
   - Is there a specific table that contains the $99-103K value for niggemon?
   - Or should we rebuild from raw data?

2. **Can you provide the exact working SQL?**
   - The fix-realized-views.ts file has errors
   - Provide one working query that produces $99-103K for niggemon

3. **Is the RECONCILIATION_FINAL_REPORT still valid?**
   - Report shows realized=$185K, unrealized=-$85K → total=$99.7K
   - Can you verify if this is still accurate with current database?

4. **Which approach do you prefer?**
   - Use outcome_positions_v2 + trade_cashflows_v3 (clean aggregates)
   - Use trade_flows_v2 + market joins (raw data)
   - Use pre-calculated table (if one exists)

---

## What Each Approach Produces

| Approach | Result | Status |
|----------|--------|--------|
| **ChatGPT's formula** (helper views + cash+shares) | $3.69M | Wrong by 36x |
| **Third Claude's formula** (shares - cash) | -$163M | Wrong by 1600x |
| **Phase 1B design** (with offset) | Negative | Wrong direction |
| **Trade flows direct sum** | $1.9M | Wrong by 19x |
| **Outcome positions + TC3** | -$3.69M | Wrong sign & magnitude |
| **Realized PnL by Market V2** | $1.9M | Existing table, still wrong |

---

## Files Created During Debugging

- phase2-step1-sanity-check.ts
- phase2-step2-offset-detection.ts
- phase2-step3-build-helpers.ts
- phase2-step3-fix-helpers.ts
- phase2-step4-realized-pnl.ts
- phase2-step5-guardrails.ts
- phase2-step6-validate-wallets.ts
- phase2-step7-troubleshoot-signs.ts
- phase2-debug-components.ts
- phase2-check-resolved-only.ts
- test-third-claude-formula.ts
- create-pnl-views-final.ts
- create-pnl-final-fixed.ts
- PHASE_2_IMPLEMENTATION_STATUS.md (earlier report)
- PHASE_2_FINAL_DIAGNOSTIC_REPORT.md (this document)

---

## Recommended Next Steps

### Option A: Provide Working SQL (FASTEST)
Send one query that produces the correct value:
```sql
SELECT wallet, realized_pnl FROM <correct_table_or_formula>
WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
-- Should return: ~$99-103K for niggemon
```

### Option B: Specify Data Source (MOST RELIABLE)
Tell me:
- Which table should be the "source of truth"
- Whether offset +1 applies
- Any filtering needed before aggregation

### Option C: Use Existing Pre-Calc (IMMEDIATE)
Point me to existing table with P&L values that:
- Has niggemon → ~$99-103K
- Has HolyMoses7 → ~$86-94K
- Is considered authoritative

---

## Key Learnings

1. **ChatGPT's step-by-step approach was sound** - included verification at each step
2. **Offset +1 is definitely real** - 94.33% of data confirms this
3. **Formula design is much harder than anticipated** - simple linear combinations don't work
4. **Data source selection is critical** - using wrong table creates 36x magnitude error
5. **Join fanout is a real concern** - need aggregated helpers to prevent explosion

---

**Status:** Blocked on formula clarification. Cannot proceed without knowing correct data source or formula.

**Time Spent:** ~3 hours of systematic testing

**Next Immediate Action:** Await user clarification on working formula or data source.

