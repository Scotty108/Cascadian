# Phase 2 Implementation Blocker Report

**Status:** Implementation attempted but hit fundamental formula issues

**Date:** November 7, 2025

---

## What We Tried

### Attempt 1: Index Offset Fix Only
```sql
realized_pnl = SUM(cashflow_usdc) + sumIf(delta_shares where trade_idx = win_idx + 1)
```
**Result:** Negative values (-$2M for niggemon) - Wrong direction

### Attempt 2: Subtract Settlement Instead
```sql
realized_pnl = SUM(cashflow_usdc) - sumIf(delta_shares where trade_idx = win_idx + 1)
```
**Result:** Massively positive ($9.2M for niggemon) - Wrong magnitude

### Attempt 3: Outcome Label Matching
```sql
realized_pnl = SUM(cashflow_usdc) + sumIf(delta_shares where outcome matches winner)
```
**Result:** No settlement applied ($3.69M same as original) - Condition returns 0

### Attempt 4: Use trade_cashflows_v3 (Pre-calculated)
```sql
realized_pnl = SUM(trade_cashflows_v3.cashflow_usdc for resolved conditions)
```
**Result:** $1.9M for niggemon, expected $102K - 19x inflation remains

### Attempt 5: Per-Position Settlement (CTE approach)
```sql
WITH per_position AS (...)
SELECT ... SUM(cashflows) + (net_position × 1.00 if winning outcome)
```
**Result:** Query timeout - Too expensive for ClickHouse

---

## Key Findings

1. **Index offset diagnostic (98% match pattern) is inconclusive**
   - When we try to use the +1 offset, results flip sign or get worse
   - Suggests the diagnostic was testing something different than settlement matching

2. **Trade-level settlement approach doesn't work**
   - Tried multiple offset variations
   - Tried outcome label matching
   - None produce correct results

3. **Pre-calculated tables are unreliable**
   - trade_cashflows_v3 contains values that sum to $1.9M (19x expected)
   - Unclear if these are cashflows, settlements, or something else
   - Same 19x inflation exists whether we use trade_flows_v2 or trade_cashflows_v3

4. **Expected Values Gap**
   - Expected P&L: ~$102K
   - Best attempt so far: $1.9M (using pre-calculated trade_cashflows_v3)
   - Gap: 19x overcount
   - Unknown where the 19x multiplier comes from

---

## Hypothesis: Data or Formula Structure is Fundamentally Wrong

The consistent 19x overcount across multiple calculation approaches suggests either:

1. **The input data is wrong**
   - cashflow_usdc values are pre-multiplied by something
   - delta_shares includes non-trade positions
   - trade_cashflows_v3 includes duplicated or inflated values

2. **The expected values are different scope**
   - Maybe expected values exclude certain trades or markets
   - Maybe expected values use a different time window
   - Maybe expected values are only for a subset of the wallet's activity

3. **The settlement logic is inverted or structured differently**
   - Current approach: cost_basis + payout for winning
   - Maybe should be: negative values for losses, positive for wins
   - Maybe settlement is calculated per-market-resolution, not per-condition

---

## Recommendation: Escalate to Secondary Claude

Before continuing implementation, need clarity on:

1. **What do the expected values ($102K, $90K, etc.) actually represent?**
   - All resolved trades?
   - All trades (including unresolved)?
   - Specific time window or market subset?
   - Realized only or including unrealized?

2. **Where did the -2.3% variance claim come from?**
   - What formula produced $99,691 for niggemon?
   - What were the inputs and settings for that calculation?

3. **Why is there a consistent 19x overcount?**
   - Is trade_cashflows_v3 actually P&L or something else?
   - Are there hidden multipliers or aggregation errors in the data?
   - Is the formula structure completely wrong?

---

## Files Modified

- `/scripts/realized-pnl-corrected.ts` - Attempted 5 different formulas
- Multiple diagnostic scripts created to investigate

---

## Status

**Blocked:** Fundamental formula approach needs validation before proceeding.

**Next Action:** Consult with secondary Claude on:
- Definition of expected values
- Source of -2.3% variance reference
- Root cause of 19x overcount

Once clarified, can redesign formula accordingly.

