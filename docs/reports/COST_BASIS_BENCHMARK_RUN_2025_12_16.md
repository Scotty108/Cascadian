# Cost Basis Benchmark Run - December 16, 2025

**Date:** 2025-12-16
**Benchmark Set:** fresh_dec16_2025 (9 wallets)
**Status:** Complete

## Summary

Tested the new cost-basis PnL engine against the December 16 benchmark set with two configurations:
1. **Maker-only:** Matches V6 approach
2. **Maker+taker with sell capping:** Full CLOB trades with Polymarket-style inventory capping

### Key Finding

**Maker-only achieves best UI parity:**
- 7/9 (78%) wallets within 1% error
- 9/9 (100%) wallets within 10% error
- Median absolute error: 0.3%

## Maker-Only Cost Basis Results

| Wallet | UI PnL | Cost Basis PnL | Error |
|--------|--------|----------------|-------|
| 0x56687bf4... | $22.05M | $22.03M | **-0.1%** |
| 0x1f2dd6d4... | $16.62M | $16.58M | **-0.3%** |
| 0x78b9ac44... | $8.71M | $8.71M | **-0.1%** |
| 0x863134d0... | $7.53M | $7.53M | **-0.1%** |
| 0x8119010a... | $6.08M | $6.08M | **-0.1%** |
| 0x23786fda... | $5.15M | $5.13M | **-0.3%** |
| 0xd38b71f3... | $2.52M | $2.54M | **0.8%** |
| 0xe74a4446... | $0.18M | $0.19M | 6.4% |
| 0x91463565... | -$0.02M | -$0.02M | 5.1% |

**Summary Stats:**
- Within 1% error: 7/9 (78%)
- Within 10% error: 9/9 (100%)
- Median absolute error: 0.3%
- External sells: 0 tokens (by definition, maker trades don't cap)
- Capped sell events: 5 (minor maker sells)

## Maker+Taker Cost Basis Results (with Sell Capping)

| Wallet | UI PnL | Cost Basis PnL | Error | External Sells |
|--------|--------|----------------|-------|----------------|
| 0x56687bf4... | $22.05M | $25.00M | 13.4% | 15.5M |
| 0x1f2dd6d4... | $16.62M | $18.69M | 12.5% | 7.3M |
| 0x78b9ac44... | $8.71M | $9.64M | 10.6% | 7.7M |
| 0x863134d0... | $7.53M | $7.91M | 5.1% | 6.3M |
| 0x8119010a... | $6.08M | $5.81M | -4.5% | 2.2M |
| 0x23786fda... | $5.15M | $5.70M | 10.8% | 3.0M |
| 0xd38b71f3... | $2.52M | $3.19M | 26.6% | 18.6M |
| 0xe74a4446... | $0.18M | $0.19M | 4.9% | 2.6M |
| 0x91463565... | -$0.02M | -$0.02M | -4.8% | 0.2M |

**Summary Stats:**
- Within 1% error: 0/9 (0%)
- Within 10% error: 4/9 (44%)
- Median absolute error: 10.6%
- Total external sells: **63.21M tokens**
- Total capped sell events: 11,864

## Negative Balance Check

Both configurations produce **0 negative balances**, confirming:
1. Sell capping is working correctly
2. No inventory over-sell bugs

## Capped Sells Analysis

Total capped sells across all wallets: **63.21M tokens**

This represents tokens sold in CLOB that were acquired through non-CLOB sources:
- PositionSplit (minting both outcomes by locking collateral)
- ERC-1155 transfers from other wallets
- PositionMerge operations
- Other CTF mechanisms

The high capped-sell rate explains why maker+taker produces higher PnL than UI - we're counting taker buys that add to positions, but the corresponding taker sells from external inventory are capped.

## Comparison: Maker-Only vs Maker+Taker

| Wallet | Maker Err | Full Err | Better |
|--------|-----------|----------|--------|
| 0x56687b.. | -0.1% | 13.4% | Maker |
| 0x1f2dd6.. | -0.3% | 12.5% | Maker |
| 0x78b9ac.. | -0.1% | 10.6% | Maker |
| 0x863134.. | -0.1% | 5.1% | Maker |
| 0x811901.. | -0.1% | -4.5% | Maker |
| 0x23786f.. | -0.3% | 10.8% | Maker |
| 0xd38b71.. | 0.8% | 26.6% | Maker |
| 0xe74a44.. | 6.4% | 4.9% | **Full** |
| 0x914635.. | 5.1% | -4.8% | Full |

Maker-only wins for 7/9 wallets.

## Conclusion

**Maker-only cost basis is the production-ready approach:**

1. **Best accuracy:** 78% within 1% error vs 0% for full
2. **Stable behavior:** No artificial inflation from untracked inventory
3. **Matches V6:** Cost basis confirms V6's cash-flow formula is equivalent

The two wallets where full performs slightly better (0xe74a44, 0x914635) are small-PnL wallets where the absolute difference is minor.

## Files Used

- `lib/pnl/costBasisEngineV1.ts` - Cost basis engine with sell capping
- `scripts/pnl/benchmark-cost-basis-dec16.ts` - Benchmark runner
- Output saved to `/tmp/cost_basis_benchmark.out`

## Recommendation

**Ship V6 (maker-only) as production baseline.** The cost-basis engine validates this approach and provides diagnostic capabilities (external_sell tracking) for future investigation of taker-primary wallets.
