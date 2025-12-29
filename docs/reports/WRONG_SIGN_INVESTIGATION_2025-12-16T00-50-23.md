# PnL Sign Flip Investigation
**Generated:** 2025-12-16T00:50:23.451Z
**Wallet:** 0x227c55d09ff49d420fc741c5e301904af62fa303
**Issue:** V18 reports +$184.09, UI reports -$278.07 (wrong sign!)

---

## Executive Summary

Analyzed top 10 markets by absolute PnL contribution.

**Key Findings:**
- Total PnL from top 5 markets: $0.00
- Expected V18: +$184.09
- Expected UI: -$278.07
- Deviation from V18: $184.09
- Deviation from UI negated: $278.07

**Issues Found:** 1
- Market ⚠️  POSSIBLE ISSUE: Outcome shows payout=0 but is_yes_outcome=true1 (707bb157...): ⚠️  POSSIBLE ISSUE: Outcome shows payout=0 but is_yes_outcome=true

---

## Market-by-Market Breakdown

### Market #1: Blackhawks vs. Blues

**Condition ID:** `17750f23465e92f71d9b7490444e6fc7bf4a136f9d4bd4b4a72f598e27dc0d6d`
**Outcome Index:** 1 (YES)
**Computed PnL:** $0.00

**Position:**
- Buy: $0.00 (0.00 shares)
- Sell: $0.00 (0.00 shares)
- Net Shares: 0.00
- Cash Flow: $0.00

**Resolution:**
- Resolved: YES
- Resolution Price: $1.000000

**Calculation:**
```
cash_flow + (net_shares * resolved_price)
= 0.00 + (0.00 * 1.000000)
= 0.00 + 0.00
= $0.00
```

**Outcome Mapping:**
- [0] NO: payout=0.000000 (NO)
- [1] YES: payout=1.000000 (YES)

---

### Market #2: Canadiens vs. Rangers

**Condition ID:** `3ac90d1e3a8e210b1254d5b86a5a940f127c18f16466f7b01c4ee91c3b05c83d`
**Outcome Index:** 1 (YES)
**Computed PnL:** $0.00

**Position:**
- Buy: $0.00 (0.00 shares)
- Sell: $0.00 (0.00 shares)
- Net Shares: 0.00
- Cash Flow: $0.00

**Resolution:**
- Resolved: YES
- Resolution Price: $1.000000

**Calculation:**
```
cash_flow + (net_shares * resolved_price)
= 0.00 + (0.00 * 1.000000)
= 0.00 + 0.00
= $0.00
```

**Outcome Mapping:**
- [0] NO: payout=0.000000 (NO)
- [1] YES: payout=1.000000 (YES)

---

### Market #3: Titans vs. 49ers

**Condition ID:** `72f3c89aee1abc48cb220a951325afc84b97c96dc25b583a1061a17ba0230fa2`
**Outcome Index:** 0 (NO)
**Computed PnL:** $0.00

**Position:**
- Buy: $0.00 (0.00 shares)
- Sell: $0.00 (0.00 shares)
- Net Shares: 0.00
- Cash Flow: $0.00

**Resolution:**
- Resolved: YES
- Resolution Price: $0.000000

**Calculation:**
```
cash_flow + (net_shares * resolved_price)
= 0.00 + (0.00 * 0.000000)
= 0.00 + 0.00
= $0.00
```

**Outcome Mapping:**
- [0] NO: payout=0.000000 (NO)
- [1] YES: payout=1.000000 (YES)

---

### Market #4: Vikings vs. Cowboys

**Condition ID:** `707bb157a2ea43d2da72c850141a668af164491e3b63e81cc2da10cda89e3dbf`
**Outcome Index:** 1 (YES)
**Computed PnL:** $0.00

**Position:**
- Buy: $0.00 (0.00 shares)
- Sell: $0.00 (0.00 shares)
- Net Shares: 0.00
- Cash Flow: $0.00

**Resolution:**
- Resolved: YES
- Resolution Price: $0.000000

**Calculation:**
```
cash_flow + (net_shares * resolved_price)
= 0.00 + (0.00 * 0.000000)
= 0.00 + 0.00
= $0.00
```

**Outcome Mapping:**
- [0] NO: payout=1.000000 (NO)
- [1] YES: payout=0.000000 (YES)

---

### Market #5: Blackhawks vs. Blues

**Condition ID:** `17750f23465e92f71d9b7490444e6fc7bf4a136f9d4bd4b4a72f598e27dc0d6d`
**Outcome Index:** 0 (NO)
**Computed PnL:** $0.00

**Position:**
- Buy: $0.00 (0.00 shares)
- Sell: $0.00 (0.00 shares)
- Net Shares: 0.00
- Cash Flow: $0.00

**Resolution:**
- Resolved: YES
- Resolution Price: $0.000000

**Calculation:**
```
cash_flow + (net_shares * resolved_price)
= 0.00 + (0.00 * 0.000000)
= 0.00 + 0.00
= $0.00
```

**Outcome Mapping:**
- [0] NO: payout=0.000000 (NO)
- [1] YES: payout=1.000000 (YES)

---

## Analysis

### Cash Flow Sign Check
- **Expected:** BUY = negative cash flow (money out), SELL = positive cash flow (money in)
- **Formula:** cash_flow = sell_proceeds - buy_cost

### Outcome Indexing Check
- **Question:** Does outcome_index=0 mean YES or NO?
- **Question:** Does payout_numerators[0] correspond to YES or NO?
- **Question:** Is there an off-by-one error or YES/NO flip?

**Sample resolved markets:**

Condition 17750f23... (outcome_index=1):
    [0] NO: payout=0.00
  → [1] YES: payout=1.00

Condition 3ac90d1e... (outcome_index=1):
    [0] NO: payout=0.00
  → [1] YES: payout=1.00

Condition 72f3c89a... (outcome_index=0):
  → [0] NO: payout=0.00
    [1] YES: payout=1.00

### Formula Comparison

**Our formula (V18):**
```
PnL = cash_flow + (net_shares * resolved_price)
where:
  cash_flow = sell_proceeds - buy_cost
  net_shares = buy_shares - sell_shares
```

**Possible UI formula:**
```
PnL = Gain - Loss
where:
  Gain = sell_proceeds + (remaining_shares * current_price)
  Loss = buy_cost
```

**Hypothesis:** The UI may be using a different accounting method that produces opposite signs.

## Recommended Next Steps

1. **Verify cash flow calculation:**
   - Check if buy/sell sides are correctly assigned
   - Confirm sell_proceeds - buy_cost formula is correct

2. **Check outcome indexing:**
   - Verify payout_numerators array alignment
   - Confirm outcome_index maps correctly to YES/NO

3. **Compare formulas:**
   - Test if UI uses (Gain - Loss) vs our (cash_flow + shares*price)
   - Check if there's a sign inversion in the base formula

4. **Validate with known market:**
   - Pick a simple resolved market with 1 buy + 1 sell
   - Manually calculate PnL both ways
   - Compare with UI and V18 output

---

**Generated by:** `scripts/pnl/trace-market-pnl.ts`
