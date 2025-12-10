# V11 P/L Engine Root Cause Analysis

**Date:** 2025-12-07
**Status:** Root cause identified - CTF events MUST be included

## Executive Summary

V11 engine systematically **overcounts P/L by 13-51%** compared to Polymarket UI because it:
1. Auto-resolves positions based on market resolution status
2. Ignores actual PayoutRedemption events that track when users actually redeem winnings
3. Does NOT include PositionSplit/PositionsMerge events that affect cost basis

## Key Findings

### Test Case 1: @kinfolk (CLOB-only wallet)
| Metric | Value |
|--------|-------|
| V11 P/L | $5,594 |
| UI P/L | $4,906 |
| Difference | +$688 (+14%) |
| CTF Events | 0 |
| CLOB Trades | 230,826 |

**Analysis:** Even with 0 CTF events, V11 overcounts by 14%. This suggests the auto-resolution logic is problematic.

### Test Case 2: ca6859f3c... (Heavy redemption wallet)
| Metric | Value |
|--------|-------|
| V11 P/L | $309,105 |
| UI P/L | $204,655 |
| Difference | +$104,450 (+51%) |
| PayoutRedemptions | 26,391 |
| Redemption Value | $11.9M |
| CLOB Volume | $21.8M |

**Analysis:** With heavy redemption activity, the overcount is massive (51%). V11 is likely double-counting resolution gains.

## Root Cause: Auto-Resolution Double Counting

V11's resolution logic (lines 341-370 in `uiActivityEngineV11.ts`):
```typescript
// V11 adds resolution P/L for positions with remaining amount
if (pos.amount > 0.01) {
  const resolution = this.resolutionCache?.get(pos.condition_id);
  if (resolution) {
    const payout = resolution.payout_numerators[pos.outcome_index];
    const resolutionPnL = (payout - pos.avgPrice) * pos.amount;
    additionalPnL += resolutionPnL;  // <-- This is double-counting!
  }
}
```

**The Problem:**
1. V11 sees a position has shares in a resolved market
2. V11 calculates and adds resolution P/L: `(payout - avgPrice) * amount`
3. BUT the wallet may have ALREADY received this value via PayoutRedemption
4. Result: P/L is counted twice

**Polymarket Subgraph Behavior:**
- Only realizes P/L from **actual events**: CLOB sells, PayoutRedemption
- Does NOT auto-resolve positions
- Cost basis tracking includes PositionSplit (@ $0.50) and PositionsMerge (@ $0.50)

## Recommendations

### Short Term: Use UI Benchmarks
For immediate copy-trade leaderboard needs, use `pm_ui_pnl_benchmarks_v1` table values scraped from Polymarket UI.

### Medium Term: Build V12 Engine
A V12 engine should:

1. **Remove auto-resolution logic** - Don't calculate implicit resolution P/L
2. **Process PayoutRedemption events** - Only count resolution P/L when redemption occurs
3. **Include PositionSplit/Merge** - Update cost basis when splits/merges occur
4. **Use proper event ordering** - Process all events (CLOB + CTF) in timestamp order

### V12 Event Processing Order

```
For each wallet:
  1. Load ALL events:
     - CLOB trades from pm_trader_events_v2
     - CTF events from pm_ctf_events (Split, Merge, PayoutRedemption)

  2. Sort by timestamp

  3. Process each event:
     - BUY (CLOB): avgPrice = weighted_avg(avgPrice, amount, price, qty)
     - SELL (CLOB): deltaPnL = min(qty, amount) * (price - avgPrice)
     - PositionSplit: avgPrice = $0.50 for both outcomes
     - PositionsMerge: deltaPnL at $0.50 for both outcomes
     - PayoutRedemption: deltaPnL = amount * (payoutPrice - avgPrice)
```

## Supporting Data

### CLOB Deduplication Works Correctly
V11 properly deduplicates CLOB trades using `GROUP BY event_id`. This is NOT the cause of overcounting.

### Position Value Mismatch
| Wallet | V11 Position Value | UI Position Value |
|--------|-------------------|-------------------|
| @kinfolk | $9,761 (resolved) | $4,509 (active) |

V11 thinks positions are "resolved winning" when UI shows them as "active". This confirms V11's resolution detection is incorrect.

## Files Referenced
- `lib/pnl/uiActivityEngineV11.ts` - V11 engine with auto-resolution bug
- `docs/systems/pnl/POLYMARKET_PNL_EXACT_FORMULA.md` - Correct Polymarket formula
- `pm_ctf_events` - CTF event data (splits, merges, redemptions)
- `pm_trader_events_v2` - CLOB trade data

## Conclusion

**V11 is NOT production-ready.** The auto-resolution logic causes systematic overcounting.

To match Polymarket UI P/L:
1. ✅ Use cost-basis tracking (V11 does this)
2. ✅ Round prices to cents (V11 does this)
3. ❌ Remove auto-resolution (V11 fails here)
4. ❌ Include CTF events (V11 fails here)
5. ❌ Only count PayoutRedemption, not implicit resolution (V11 fails here)

The answer to "Do we need CTF events?" is **YES, absolutely**. Even for wallets with 0 CTF events, V11's auto-resolution logic overcounts. For wallets with redemptions, the overcount can exceed 50%.
