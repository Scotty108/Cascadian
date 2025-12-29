# PnL Sign Flip Investigation - Initial Findings
**Date:** 2025-12-16
**Wallet:** 0x227c55d09ff49d420fc741c5e301904af62fa303
**Issue:** V18 reports +$184.09, UI reports -$278.07 (wrong sign!)

---

## Executive Summary

Created `scripts/pnl/trace-market-pnl.ts` to investigate market-by-market PnL calculation for the wallet showing sign flip issue.

**Critical Finding:** Initial run returned only markets with $0.00 PnL (all fully closed positions), which doesn't match the V18 total of +$184.09. This indicates a fundamental query issue.

---

## Script Created

`scripts/pnl/trace-market-pnl.ts` - Market-level PnL tracer

**Features:**
1. Loads trades from `pm_trader_events_dedup_v2_tbl` with condition mapping
2. Aggregates by (condition_id, outcome_index) to get per-market positions
3. Joins with `pm_condition_resolutions` to get payout prices
4. Computes PnL = cash_flow + (net_shares * resolved_price)
5. Generates detailed market-by-market breakdown

**Output:**
- Top markets by absolute PnL contribution
- For each market: condition_id, outcome_index, buy/sell volumes, cash flow, resolution price, computed PnL
- Trade history for top 3 markets
- Outcome mapping (YES/NO and payout amounts)
- Pattern analysis and sign flip detection

---

## Initial Run Results

**Wallet Activity:**
- Total events in dedup table: 17,640 events (28,506 total rows with duplicates)
- Markets analyzed: 10

**Problem:**
ALL 10 markets returned showed:
- Buy Volume: $0.00
- Sell Volume: $0.00
- Net Shares: 0.00
- Cash Flow: $0.00
- Computed PnL: $0.00

**Diagnosis:**
This indicates these are fully closed-out positions (equal buys and sells). These markets don't contribute to the wallet's total PnL, so the query is returning the wrong markets.

---

## Root Cause (Suspected)

### Issue 1: Case Sensitivity in Side Comparison

SQL query uses:
```sql
sum(if(side = 'BUY', tokens, 0)) as buy_shares
sum(if(side = 'SELL', tokens, 0)) as sell_shares
```

But `pm_trader_events_dedup_v2_tbl.side` is likely lowercase: `'buy'` and `'sell'`

**Impact:** ALL sides fail to match, so buy_shares and sell_shares are always 0

**Fix Required:**
```sql
sum(if(side = 'buy', tokens, 0)) as buy_shares
sum(if(side = 'sell', tokens, 0)) as sell_shares
```

OR use case-insensitive comparison:
```sql
sum(if(lower(side) = 'buy', tokens, 0)) as buy_shares
sum(if(lower(side) = 'sell', tokens, 0)) as sell_shares
```

---

## Next Steps

### Immediate (Fix Script)
1. **Fix case sensitivity** in side comparison
2. **Re-run script** to get actual markets with non-zero PnL
3. **Verify formula** on real data:
   - Check if cash_flow sign is correct (sell - buy)
   - Check if net_shares sign is correct (buy - sell)
   - Check if resolution price mapping is correct

### Investigation Questions (Once Fixed)
1. **Cash Flow Sign:**
   - Is buy volume being subtracted correctly (negative cash flow)?
   - Is sell volume being added correctly (positive cash flow)?

2. **Outcome Indexing:**
   - Does outcome_index=0 mean NO or YES?
   - Does payout_numerators[0] correspond to the same outcome?
   - Is there an off-by-one error or YES/NO flip?

3. **Formula Comparison:**
   - Our formula: `cash_flow + (net_shares * resolved_price)`
   - Polymarket UI formula: Possibly `Gain - Loss` or different accounting

4. **Sign Flip Detection:**
   - Compare V18 output (+$184.09) with sum of market PnLs
   - If sum ≈ -$184.09, formula has sign inverted
   - If sum ≈ +$278.07, may match UI negated

---

## Validation Matrix

Once script is fixed, validate against these scenarios:

| Scenario | Buy | Sell | Net Shares | Cash Flow | Resolution | Expected PnL |
|----------|-----|------|------------|-----------|------------|--------------|
| Win (held to resolution) | $100 | $0 | +100 | -$100 | $1 | $0 (break-even) |
| Win (bought low, sold high) | $50 | $100 | 0 | +$50 | N/A | +$50 |
| Loss (held to resolution) | $100 | $0 | +100 | -$100 | $0 | -$100 |
| Loss (bought high, sold low) | $100 | $50 | 0 | -$50 | N/A | -$50 |

---

## Files Created

1. `/Users/scotty/Projects/Cascadian-app/scripts/pnl/trace-market-pnl.ts` - Investigation script
2. `/Users/scotty/Projects/Cascadian-app/docs/reports/WRONG_SIGN_INVESTIGATION_2025-12-16T00-50-23.md` - Auto-generated report (from buggy run)
3. `/Users/scotty/Projects/Cascadian-app/docs/reports/WRONG_SIGN_INVESTIGATION.md` - This manual summary

---

## Recommendations

1. **CRITICAL:** Fix case sensitivity bug in `trace-market-pnl.ts` before further analysis
2. Add wallet data validation check (ensure trades are actually loading)
3. Add intermediate debugging output (show sample trades with side values)
4. Consider adding sanity check: total cash_flow should roughly equal (total_sells - total_buys)

---

**Status:** Script created but needs bug fix before producing actionable results.
**Next Action:** Fix side comparison case sensitivity and re-run.
