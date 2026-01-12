# SPLIT_HEAVY PnL Analysis

**Wallet:** 0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba
**Date:** 2026-01-09
**Status:** DISCREPANCY UNDER INVESTIGATION

## Summary

| Metric | Polymarket | V1 | V40 |
|--------|------------|-----|-----|
| **PnL** | $48,509.59 | $0 | $0 |
| **Status** | API Value | No CLOB data | Mathematically correct |

## Wallet Activity

SPLIT_HEAVY is a **pure CTF-only wallet** with zero CLOB trades:
- **Splits:** 131,060 events ($3.889B USDC spent)
- **Redemptions:** 131,044 events ($3.889B USDC received)
- **CLOB Trades:** 0

## V40 Detailed Calculation

Our V40 engine calculated:
```
Total Realized PnL:   +$695,158,654  (profit from selling winning tokens)
Total Unrealized PnL: -$695,158,654  (loss on held losing tokens)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NET TOTAL PnL:        $0             (exactly zero)
```

## Cash Flow Analysis

```
USDC Spent on Splits:     $3,889,040,399.59
USDC Received (Redemptions): $3,888,893,060.21
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Net Cash Flow:            -$147,339.38 (negative)
```

## Why V40 Returns $0

For each **split operation**:
1. Wallet spends X USDC
2. Receives X tokens of Outcome 0 (cost basis $0.50)
3. Receives X tokens of Outcome 1 (cost basis $0.50)

When one outcome wins (e.g., O1 at $1.00, O0 at $0.00):
- O1 tokens: Profit = X × ($1.00 - $0.50) = **+$0.50X**
- O0 tokens: Loss = X × ($0.00 - $0.50) = **-$0.50X**
- Net: **$0**

This is mathematically correct. **Every split-redeem cycle nets to $0** when accounting for both outcomes.

## Unredeemed Tokens

Two conditions have unredeemed tokens:
1. `f2989c...`: 116,807 tokens unredeemed (O1 wins)
2. `96f62c...`: 30,532 tokens unredeemed (O1 wins)

Total unredeemed: ~147K tokens of EACH outcome

Value analysis:
- Winning tokens (O1): 147K × $1.00 = $147,000
- Losing tokens (O0): 147K × $0.00 = $0
- Cost basis: 147K × $0.50 × 2 = $147,000
- **Net unrealized: $0**

## Why Polymarket Shows $48.5K

**Hypothesis:** Polymarket may use a different PnL definition:

1. **Realized-only accounting:** Only count PnL when tokens are actually sold/redeemed
   - Winning redemptions: realize profit
   - Losing tokens never redeemed: no realized loss

2. **Different cost allocation:** May not allocate split cost equally to both outcomes

3. **Cash flow + unredeemed value:** Some combination of metrics

**Note:** The $48.5K value is suspiciously close to:
- ~$73K unrealized profit on winning unredeemed tokens
- ~$25K adjustment factor (unclear source)

## V1 Returns $0 Because

V1 only looks at `pm_trader_events_v3` (CLOB data). SPLIT_HEAVY has **zero CLOB trades**, so V1 has no data to calculate.

## Conclusion

V40's $0 calculation is **mathematically correct** for total PnL. The discrepancy with Polymarket's $48.5K suggests they use a different metric definition.

Possible actions:
1. Accept V40 as "total PnL" and create separate "realized cash PnL" metric
2. Investigate Polymarket's exact PnL calculation methodology
3. Consider this wallet type "special case" that requires different handling
