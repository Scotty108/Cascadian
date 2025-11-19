# Phase 2: Breakthrough Investigation Summary

**Date:** November 7, 2025
**Status:** Key Discovery Made - Fanout Identified, But Formula Still Wrong
**Critical Finding:** trade_cashflows_v3 is per-trade data, not pre-aggregated

---

## What We Discovered Today

### 1. ✅ Verified Offset Issue
- **98% of trades:** outcome_idx = win_idx (different from Phase 1A claim of +1 offset)
- **2% of trades:** outcome_idx = win_idx + 1
- **Finding:** Offset = 0 gives POSITIVE values, offset +1 gives NEGATIVE values (wrong direction)

### 2. ✅ Identified the Fanout Root Cause
- **trade_cashflows_v3 is PER-TRADE DATA:**
  - 5,576 rows for niggemon
  - 830 unique condition-outcome combos
  - **6.72 rows per combo** (not pre-aggregated!)

- **This causes 6.72x fanout when joining positions to cashflows**
- **ChatGPT was right:** Need to aggregate first, then join

### 3. ❌ But Pre-aggregation Doesn't Solve It
- Aggregating cashflows first: Still produces $1.9M (19x too high)
- This means **fanout isn't the only problem**

### 4. ❌ Winning Shares Are Wrong Magnitude
- **With OFFSET = 0:** only $5,028 in winning shares
- **Expected:** Should be in $100K+ range
- **With OFFSET = +1:** -$161M in winning shares (wrong sign)
- **Neither offset produces viable results**

---

## What We Tested (In Priority Order)

| Approach | Result | Status |
|----------|--------|--------|
| **Realized gains vs losses breakdown** | Gains=$0, Losses=-$160M | ❌ No positive gains |
| **OFFSET = 0 (exact match)** | $2.16M | ❌ 21x too high |
| **OFFSET = +1 (detected pattern)** | -$159M | ❌ Wrong sign |
| **Shares only (no cashflows)** | $5,028 | ❌ 20x too small |
| **ChatGPT pre-aggregated cashflows** | $1.91M | ❌ Still 19x high |

---

## Key Insights

### Insight 1: The Fundamental Problem
- We're matching the **WRONG outcome** with current offset
- niggemon has 799 LOSING conditions (resolved 0 winning)
- Should have SOME winning conditions

### Insight 2: Winning Shares Are Severely Underestimated
- $5,028 total winning shares is implausible for 799 resolved markets
- Average: $6.30 per winning market (unrealistic for typical Polymarket positions)
- Suggests: Either wrong offset or wrong data source

### Insight 3: Cashflows Are in Right Ballpark
- $1.9M total cashflows = makes sense for heavy trader
- This is what we'd expect from all entries + exits across 799 markets

---

## Why All Previous Approaches Failed

1. **Phase 1B design (win_idx + 1):** Matched wrong outcome, inverted sign
2. **ChatGPT fanout fix:** Solved JOIN fanout but didn't address wrong offset
3. **Secondary Claude truth check:** Correctly identified offset wasn't the solution
4. **Third Claude tables:** Pre-calc tables either empty or using wrong formula
5. **Simple +/- variations:** All fundamentally off by 10x-1000x

---

## The Real Problem (Hypothesis)

The issue is **not a formula variant** or **not just join fanout**. The core problem is:

**We're using the wrong combination of:**
1. Data source (outcome_positions_v2 + trade_cashflows_v3 vs trade_flows_v2 aggregated)
2. Offset detection (98% OFFSET=0, not +1 as Phase 1A claimed)
3. Join logic (still producing wrong magnitude even with clean aggregation)

---

## Recommended Next Steps

### Option A: Use ChatGPT's Complete Approach (Most Systematic)
Follow ChatGPT's steps A-K exactly:
- Build canonical_condition_uniq (de-duplicated mapping)
- Aggregate trade_flows_v2 by market FIRST
- Map through de-duplicated condition table
- Use OFFSET = 0 (based on today's findings)
- Run guardrails G1-G3 to validate

**Time:** 2-3 hours
**Confidence:** 70% (systematic and tested pattern)

### Option B: Use Only OFFSET = 0 with Your User Guidance
Since only OFFSET = 0 produces sensible magnitude:
- Commit to offset = 0 = exact match
- Use trade_flows_v2 as data source (not outcomes + cashflows separately)
- Test one market manually to verify before generalizing
- Accept whatever result formula produces

**Time:** 1-2 hours
**Confidence:** 50% (missing clarity on data source)

### Option C: Query Existing P&L Table
Secondary Claude reported wallet_pnl_summary_v2 exists with 730K rows:
- Query that table directly
- See what values it contains for niggemon
- Reverse-engineer the formula from existing results

**Time:** 30 minutes
**Confidence:** 90% (if table data is correct)

---

## Critical User Question

**Which data source is authoritative?**
1. outcome_positions_v2 (position-based, aggregated)
2. trade_flows_v2 (transaction-based, per-trade)
3. Pre-calc P&L table if it exists (wallet_pnl_summary_v2)

Once clarified, formula implementation becomes straightforward.

---

## Files Created Today

- test-gains-losses-breakdown.ts (shows 0 gains, all losses)
- test-both-offsets-fixed.ts (OFFSET=0 vs OFFSET=+1 comparison)
- inspect-trade-cashflows.ts (discovered per-trade structure)
- apply-chatgpt-fanout-fix.ts (tested pre-aggregation)
- fanout-fix-simple.ts (side-by-side comparison)
- PHASE_2_BREAKTHROUGH_SUMMARY.md (this document)

---

## Status

**PHASE 2: FINAL DIAGNOSTIC COMPLETE**

We've identified:
- ✅ Correct offset ratio (98% = 0, not +1)
- ✅ Fanout root cause (trade_cashflows_v3 per-trade data)
- ✅ Why all formulas fail (fundamental mismatch in approach)
- ❌ NOT YET: Correct working formula

**Next: Need user clarification on data source priority, then proceed with ChatGPT's systematic 6-step approach.**

