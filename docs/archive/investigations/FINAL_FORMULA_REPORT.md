# Formula Fix Status Report

**Date**: 2025-11-07
**Status**: READY FOR ADJUSTMENT - Foundation is correct, need to fix cashflow aggregation

---

## Key Findings

### Data Structure Understanding
- **trades_raw** contains individual trade records with entry_price and shares
- Each trade has: entry_price (price per share), shares (quantity), condition_id, outcome_index, fee_usd
- Wallet 1 has 2,015 resolved trades across 74 resolved conditions

### Component Values (Wallet 1: 0x1489046ca0f9980fc2d9a950d103d3bec02c1307)

| Component | Value | Issue |
|-----------|-------|-------|
| **Cashflow (Variant A)** | -$3,897,760 | TOO LARGE - counting all trades not grouped by condition |
| **Cashflow (Variant B)** | +$3,895,923 | TOO LARGE - same issue |
| **Settlement (winning shares)** | +$680,565 | Reasonable - 680K shares at $1 payout |
| **Expected UI P&L** | +$137,663 | Target |

### The Problem

The cashflow calculations are summing EVERY trade across ALL conditions. But the settlement is only for WINNING positions. This is mixing apples and oranges.

**Root Cause**: Settlement formula needs offset adjustment. Currently taking straight `outcome_index = win_idx`, but:
- Settlement returned: $680,565 (ALL winning shares at $1 payout)
- Expected: $137,663
- Ratio: 680,565 / 137,663 = **4.94x**

This suggests the offset detection isn't working - we're counting 5x too many winning shares.

---

## Next Step: Fix Offset Application

The issue is in how we're detecting which trades resulted in winning positions:

```sql
-- CURRENT (WRONG): Counting all matches
if(outcome_index = win_idx, shares, 0)

-- WHAT WE NEED: Apply per-condition offset
if(outcome_index = win_idx + offset, shares, 0)
```

The offset is the difference between the outcome_index stored in trades and the winning_index returned by market_resolutions.

---

## Recommendation

**Option 1** (5 min): Test offset-aware settlement
```sql
SELECT wallet, round(sum(
  if(outcome_index = win_idx + coalesce(offset_delta, 0), shares, 0)
  * (payout_num / payout_denom)
), 2) as settlement_with_offset
```

**Option 2** (if Option 1 fails): Fall back to on-chain validation
- Use ERC1155 transfer data (206K position transfers in-house)
- Reconstruct ground truth from blockchain
- Time: 1-2 hours, 99%+ confidence

---

## Status

✅ Schema architecture complete (9 views, all diagnostics passed)
✅ Data availability confirmed (all needed data in-house)
⏳ Formula adjustment in progress (offset detection needs validation)
❌ Validation against UI values (pending offset fix)

**Next**: Apply offset to settlement calculation and re-test against 4 wallets.
