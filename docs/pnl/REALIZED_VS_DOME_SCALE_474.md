# Realized PnL vs Dome - Scale Validation (474 Wallets)

**Generated:** 2025-12-08
**Terminal:** Claude 2 (Parallel Dome Validation Track)

## Executive Summary

**Key Finding:** V29's `realizedPnl` includes `resolvedUnredeemedValue` (paper gains from resolved-but-unredeemed positions). Dome's realized PnL **only counts actual cash events** (CLOB sells + redemptions).

**Formula to match Dome:**
```
DomeLikeRealized = V29.realizedPnl - V29.resolvedUnredeemedValue
```

## Dome API Definition (from docs)

> "This API tracks realized gains only - from either confirmed sells or redeems. **We do not realize a gain/loss until a finished market is redeemed.**"
>
> — https://docs.domeapi.io/api-reference/endpoint/get-wallet-pnl

## Validation Results

### Comparison: Full V29 vs Cash-Only V29

| Metric | Full V29 (with resolved) | Cash-Only V29 | Improvement |
|--------|--------------------------|---------------|-------------|
| Pass Rate (5%) | 35.7% | **39.5%** | +10.6% |
| Pass Rate ($10) | 33.3% | **34.8%** | +4.5% |
| Median % Error | 32.26% | **17.56%** | -45.5% |
| Median $ Error | $378.06 | **$130.29** | -65.5% |

### Scale

- **Wallets Tested:** 474 (high-confidence Dome benchmarks)
- **Events Processed:** 1,790,275
- **Conditions with Resolutions:** 59,451

### Top Improvements

Wallets where Cash-Only formula dramatically reduces error:

| Wallet | Dome | Full V29 | Cash-Only | Unredeemed | Improvement |
|--------|------|----------|-----------|------------|-------------|
| 0x70f5e4... | $252 | -$1,824 | $665 | -$2,489 | 659% |
| 0xd49ed5... | $2,406 | $37,214 | $25,625 | $11,589 | 481% |
| 0xf2689a... | -$2,439 | -$12,610 | -$2,495 | -$10,115 | 415% |
| 0xb2fa44... | $6,545 | -$12,984 | $6,545 | -$19,529 | 298% |

## Understanding the Discrepancy

### Why V29 includes resolvedUnredeemedValue

V29 was designed for **UI parity** with Polymarket's dashboard:

> "Polymarket showcases historical unrealized PnL" — Dome docs

The Polymarket UI shows "profit" when a market resolves in your favor, even before redemption. V29 captures this by adding `resolvedUnredeemedValue` to `realizedPnl`.

### Why Dome excludes it

Dome's API is for **actual realized gains** - money that has actually hit your wallet:

- **CLOB sell** = USDC received immediately
- **Redemption** = USDC received when claiming winning shares
- **Resolved but unredeemed** = NOT counted (no actual cash yet)

## Recommendations

### For Dome Parity

Use this formula when comparing to Dome:
```typescript
const domeLikeRealized = v29Result.realizedPnl - v29Result.resolvedUnredeemedValue;
```

### For UI Parity

Use V29's `uiParityPnl` which includes resolved unredeemed value (matches Polymarket dashboard).

### For Leaderboards

Depends on use case:
- **Conservative/Tax-like:** Use cash-only (Dome-like)
- **UI-match:** Use uiParityPnl

## Remaining Gap Analysis

Even with cash-only formula, we're at ~40% pass rate. Remaining discrepancies likely due to:

1. **Proxy wallet attribution** - Some trades attributed differently
2. **CTF (split/merge) handling** - Complex multi-token operations
3. **Historical data gaps** - Missing early trades
4. **Rounding/precision** - Floating point differences

### Next Steps to Improve

1. Filter to CLOB_ONLY wallets (no CTF activity) - expect higher accuracy
2. Investigate worst outliers for systematic patterns
3. Compare event counts between our data and Dome

## Technical Details

### Source Code
- Validation script: `scripts/pnl/validate-v29-cash-only-vs-dome.ts`
- V29 Engine: `lib/pnl/inventoryEngineV29.ts`
- Dome Client: `lib/pnl/domeClient.ts`

### Data Sources
- Dome benchmark: `tmp/dome_realized_500_2025_12_07.json`
- V29 events: `pm_unified_ledger_v8_tbl`
- Resolution prices: `vw_pm_resolution_prices`

### V29 Internal Structure

```typescript
interface V29Result {
  realizedPnl: number;          // Cash events + resolvedUnredeemedValue
  unrealizedPnl: number;         // Unresolved positions at mark price
  resolvedUnredeemedValue: number; // Paper gains from resolved markets
  uiParityPnl: number;          // = realizedPnl + resolvedUnredeemedValue
}
```

**Note:** V29's `realizedPnl` output already includes `resolvedUnredeemedValue` (see line 575 of inventoryEngineV29.ts). This is confusing naming - internally `totalRealizedPnl` is pure cash events, but the returned `realizedPnl` adds resolved unredeemed.

## Conclusion

**Confirmed:** V29's realized PnL definition differs from Dome's by including paper gains from resolved-but-unredeemed positions.

**Action:** To match Dome, subtract `resolvedUnredeemedValue` from V29's `realizedPnl`.

**Impact:** This reduces median error from 32% to 17% and increases pass rate by ~4 percentage points.

**Remaining Work:** The ~40% pass rate suggests other factors at play. CLOB-only wallets (no CTF activity) will likely show higher accuracy.
