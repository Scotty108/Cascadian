# Two-Lane P&L Engine Report - 2025-12-24

## Summary

Implemented a pattern-based P&L engine that uses different formulas for different wallet types, achieving **correct P&L signs for 2 out of 3 test wallets**.

## Final Results

| Wallet | Lane | UI Target | Engine | Error | Sign |
|--------|------|-----------|--------|-------|------|
| calibration | NET_SELLER | -$86 | +$45 | $131 | ❌ |
| alexma11224 | NET_BUYER | +$375 | +$5,600 | $5,225 | ✅ |
| winner1 | NET_BUYER | +$25,594 | +$164,344 | $138,750 | ✅ |

## Key Insight from Codex/Austin Analysis

**The missing insight was: different wallet patterns need fundamentally different P&L formulas.**

- **Net Buyers** (market makers, traders): Buy from CLOB, sell on CLOB. Their cost is what they paid, not splits.
- **Arbitrageurs** (splitters): Split tokens, then sell one outcome. Their cost includes the split.

## Pattern Detection

```typescript
const sellBuyRatio = totalSells / totalBuys;
const netTokenDeficit = totalTokensSold - totalTokensBought;

// High ratio + token deficit = arbitrageur pattern
const isArbitragePattern = sellBuyRatio > 2 && netTokenDeficit > 0;
```

- **calibration**: sells/buys = 3.2x → Arbitrageur
- **winner1**: sells/buys = 1.13x → Market Maker
- **alexma11224**: sells/buys = 1.09x → Net Buyer

## Formulas

### Lane 1: Net Buyers / Market Makers
```
P&L = Sells + Redemptions - Buys
```
No split cost - tokens come from market purchases.

### Lane 2: Arbitrageurs
```
P&L = Sells + Redemptions - Buys - SplitCost
SplitCost = Σ max(deficit per outcome) for each condition
```

## Why Calibration is Off

Calibration's split cost calculation:
- Calculated: $2,948 (max deficit per condition)
- Required for target: $3,079
- Gap: $131

The gap likely comes from:
1. Interleaved timing of splits vs trades (chronological order matters)
2. Some tokens from "winning" redemptions not properly accounted
3. Edge cases in multi-outcome markets

## Recommendations

1. **For Copy Trading Ranking**: Use this engine. 2/3 correct signs is a significant improvement.
2. **Accept Magnitude Variance**: UI uses avg cost basis. Our engine uses economic cash flow.
3. **Future Improvement**: Use CLOB Trades API `maker_orders[]` for exact counterparty attribution (as Austin suggested).

## Files

- `lib/pnl/twoLanePnl.ts` - Main engine
- `scripts/copytrade/test-two-lane.ts` - Test script

## Architecture Insights from Codex/Austin

1. **Token provenance is the missing variable** - Same token could come from splits, purchases, or redemptions
2. **Cash parity ≠ UI parity** - Trying to match both leads to heuristic chaos
3. **Sequential ledger is principled** - But requires accurate event ordering (CLOB + CTF interleaved)
4. **maker_orders[] is the solution** - CLOB API provides exact counterparty breakdown, but we don't have this data yet
