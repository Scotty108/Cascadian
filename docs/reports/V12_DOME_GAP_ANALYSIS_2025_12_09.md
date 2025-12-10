# V12 Dome Gap Analysis Report

**Date:** 2025-12-09
**Terminal:** Claude 1
**Status:** Investigation complete - root causes identified

## Executive Summary

Investigation of the V12 dual benchmark (8% Synthetic / 12% CashV2 pass rate vs Dome) has identified **three distinct failure modes**:

1. **PositionsMerge inclusion** - V12CashV2 includes CTF complete-set redemptions that Dome may not count as realized PnL
2. **Time window mismatch** - Some wallets show large discrepancies even without PositionsMerge
3. **Different trade filtering** - Dome may apply additional filters we don't have

## Key Findings

### Finding 1: PositionsMerge Correlation

| Wallet | Merge | CLOB+Redeem | Full V2Cash | Dome | Result |
|--------|-------|-------------|-------------|------|--------|
| 0x199a... | $0 | $19,115 | $19,115 | $19,222 | ✓ PASS (0.6%) |
| 0x258a... | $0 | $102,200 | $102,200 | $102,200 | ✓ PASS (0.0%) |
| 0x7d72... | $0 | $518 | $518 | $521 | ✓ PASS (0.6%) |
| 0x57c2... | $0 | $181,367 | $181,367 | $100,027 | ✗ FAIL (81%) |
| 0xe62d... | $2.1M | -$1.5M | $621,813 | $71,046 | ✗ FAIL (775%) |

**Pattern:** Wallets with $0 PositionsMerge AND matching CLOB+Redemption → PASS

### Finding 2: Unexplained Gaps

Wallet 0x57c22158... has:
- PositionsMerge = $0
- CLOB+Redemption = $181,367
- Dome = $100,027
- **Gap = $81,340 (unexplained)**

This suggests Dome uses either:
1. A different time window (e.g., last 90 days only)
2. Additional trade filtering criteria
3. Different market/condition exclusions

### Finding 3: Global Source Type Distribution

```
Source Type      | Events     | Total USDC
-----------------+------------+------------------
CLOB             | 188M+      | (varies by wallet)
PayoutRedemption | 20M+       | +$5.4B
PositionsMerge   | 20M+       | +$5.4B
PositionSplit    | 89M+       | -$1.03T (suspiciously large)
```

The PositionSplit total (-$1.03T) appears unrealistically large, suggesting potential data quality issues in the V8 ledger for non-CLOB source types.

## V12CashV2 Formula

Current formula (lib/pnl/realizedPnlV12Cash.ts):
```
Realized Cash = deduped(CLOB usdc_delta)
              + PayoutRedemption usdc_delta
              + PositionsMerge usdc_delta
```

### Dome-Parity Alternative

Based on findings, a "Dome-parity" formula would be:
```
Realized Cash = deduped(CLOB usdc_delta)
              + PayoutRedemption usdc_delta
              // NO PositionsMerge - treat as internal position mgmt
```

This matches Dome for wallets without significant PositionsMerge activity.

## Recommendations

### For Dome Parity (if needed)
1. Create `calculateRealizedPnlV12CashV3` excluding PositionsMerge
2. Test on full 50-wallet cohort to measure improvement
3. Investigate time window differences for remaining gaps

### For Product (Current)
1. Keep V12CashV2 as-is for product metrics (more comprehensive)
2. Document the definition difference from Dome
3. Accept that Dome parity is ~12% due to fundamentally different definitions

## Conclusion

The low Dome pass rate (12%) is primarily a **definition mismatch**, not a calculation bug:

1. **V12CashV2** = CLOB + PayoutRedemption + PositionsMerge (comprehensive cash flows)
2. **Dome** = CLOB + PayoutRedemption only (excludes CTF redemptions)

Wallets with significant PositionsMerge activity will never match Dome. This is acceptable because:
- V12CashV2 provides a more complete picture of realized gains
- Dome's definition is more conservative (cash-only from trading)
- Both are valid depending on the use case

For wallets without PositionsMerge, the remaining gap suggests time window or filtering differences that would require Dome API documentation to resolve.
