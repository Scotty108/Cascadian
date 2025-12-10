# Subgraph Reference Spec for UI PnL Parity

**Terminal:** Claude 2 (Secondary Research)
**Date:** 2025-12-06
**Purpose:** Definitive reference for implementing subgraph-equivalent PnL calculations

---

## Section A: UI PnL Semantics Hypothesis

### Confidence Level: HIGH (90%)

**The Key Insight:**

The Polymarket subgraph's `realizedPnl` field is updated **ONLY** when a `PayoutRedemption` event fires - NOT when `ConditionResolution` fires.

From `ConditionalTokensMapping.ts`:
```typescript
export function handleConditionResolution(event: ConditionResolution): void {
  // ONLY updates condition.payoutNumerators and payoutDenominator
  // Does NOT touch any UserPosition.realizedPnl
  condition.payoutNumerators = event.params.payoutNumerators;
  condition.payoutDenominator = event.params.payoutNumerators.reduce(...);
  condition.save();
}

export function handlePayoutRedemption(event: PayoutRedemption): void {
  // THIS is where realizedPnl is updated
  const amount = userPosition.amount;  // user redeems their ENTIRE tracked amount
  const price = payoutNumerators[outcomeIndex].times(COLLATERAL_SCALE).div(payoutDenominator);
  updateUserPositionWithSell(redeemer, positionId, price, amount);
}
```

### UI Semantics Hypothesis

| State | Subgraph `realizedPnl` | UI Display | Notes |
|-------|------------------------|------------|-------|
| Position open, market unresolved | Reflects closed trades only | Shows unrealized at mark price | Standard behavior |
| Position open, market **resolved but unredeemed** | **UNCHANGED** (still only closed trades) | **Shows as "realized" at resolution price** | **THE GAP** |
| Position redeemed | Updated with redemption PnL | Shows final realized | Match |

### Why the UI Shows Resolved-Unredeemed as "Realized"

The Polymarket UI likely computes display PnL as:

```
UI_PnL = subgraph.realizedPnl
       + SUM(position.amount * resolution_price - position.costBasis)
         FOR ALL resolved-but-unredeemed positions
```

This is exactly what V29's new `uiParityPnl` field calculates.

---

## Section B: Subgraph Reference Spec

### B.1: The 5 Tracked Event Types

| # | Event Type | Source | Effect |
|---|------------|--------|--------|
| 1 | **OrdersMatched** | Exchange, NegRiskExchange | Buy or Sell at trade price |
| 2 | **PositionSplit** | ConditionalTokens, NegRiskAdapter | Buy BOTH outcomes @ $0.50 |
| 3 | **PositionsMerge** | ConditionalTokens, NegRiskAdapter | Sell BOTH outcomes @ $0.50 |
| 4 | **PayoutRedemption** | ConditionalTokens, NegRiskAdapter | Sell at resolution price (full position) |
| 5 | **PositionsConverted** | NegRiskAdapter only | Convert NO→YES (complex pricing) |

**NOT Tracked:** Direct ERC1155 transfers, ERC20 transfers, airdrops, proxy wallet ops

### B.2: State Variables per UserPosition

```
UserPosition {
  id: string           // user_address + position_id
  user: string         // wallet address
  tokenId: BigInt      // position token ID
  amount: BigInt       // current holdings (can only decrease via guard)
  avgPrice: BigInt     // weighted average cost basis (scaled by 1e6)
  realizedPnl: BigInt  // cumulative realized P&L (scaled by 1e6)
  totalBought: BigInt  // lifetime purchase volume (diagnostic only)
}
```

### B.3: State Transitions

#### BUY (OrderFilled buy-side, Split, FPMM Buy)

```
IF amount > 0:
  avgPrice = (avgPrice * amount_old + price * buy_amount) / (amount_old + buy_amount)
  amount = amount_old + buy_amount
  totalBought = totalBought + buy_amount
  // realizedPnl: UNCHANGED
```

#### SELL (OrderFilled sell-side, Merge, FPMM Sell, Redemption)

```
adjustedAmount = MIN(sell_amount, amount)  // INVENTORY GUARD

deltaPnL = adjustedAmount * (price - avgPrice) / COLLATERAL_SCALE

realizedPnl = realizedPnl + deltaPnL
amount = amount - adjustedAmount
// avgPrice: UNCHANGED on sells
```

### B.4: Pricing by Event Type

| Event | Price Formula | Value |
|-------|---------------|-------|
| OrderFilled | `makerAmountFilled * 1e6 / takerAmountFilled` | Market price |
| PositionSplit | `FIFTY_CENTS` | 500,000 (fixed $0.50) |
| PositionsMerge | `FIFTY_CENTS` | 500,000 (fixed $0.50) |
| PayoutRedemption | `payoutNumerators[i] * 1e6 / payoutDenominator` | 0 or 1,000,000 |
| PositionsConverted | Complex NegRisk formula | Derived from avgNoPrice |

### B.5: Constants

```typescript
COLLATERAL_SCALE = 10^6  // 1,000,000
FIFTY_CENTS = 500,000    // $0.50 scaled
```

### B.6: Inventory Guard Rule (CRITICAL)

From `updateUserPositionWithSell.ts`:
```typescript
// use userPosition amount if the amount is greater than the userPosition amount
// that means the user obtained tokens outside of what we track
// and we don't want to give them PnL for the extra
const adjustedAmount = amount.gt(userPosition.amount)
  ? userPosition.amount
  : amount;
```

**Rule:** When selling, clamp to `MIN(sell_amount, tracked_position)`. Zero PnL for untracked tokens.

### B.7: Rounding

- **Internal:** BigInt (arbitrary precision integers)
- **Division:** Integer division truncates (rounds toward zero)
- **No explicit rounding:** Display rounding is frontend-only
- **Implication:** Our `Math.round(x * 100) / 100` for cents is acceptable

---

## Section C: Implementation Delta List

### C.1: V23c Deltas (If Adding Subgraph Mode)

| # | Change | Severity | Description |
|---|--------|----------|-------------|
| 1 | **Add inventory guard** | HIGH | `applyClobEvent` SELL path needs `adjustedTokens = min(tokensSold, position.quantity)` |
| 2 | **Track avgPrice per position** | MEDIUM | Currently uses cashFlow formula, not weighted avg |
| 3 | **Add resolved-unredeemed calculation** | HIGH | Same as V29's `uiParityPnl` |

### C.2: V29 Deltas (Current Status)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Inventory guard | ✅ DONE | Lines 224-234 |
| 2 | Weighted average cost | ⚠️ PARTIAL | Uses condition-level pooling, subgraph uses per-position |
| 3 | `uiParityPnl` field | ✅ DONE | Added in recent update |
| 4 | Resolved-unredeemed tracking | ✅ DONE | `resolvedUnredeemedPositions`, `resolvedUnredeemedValue` |

### C.3: Remaining V29 Investigation

| Item | Question | Test Method |
|------|----------|-------------|
| Per-position vs condition-level avgPrice | Does pooling affect accuracy? | Compare single-outcome vs multi-outcome wallets |
| Split/Merge pricing | Are we using $0.50 fixed? | Verify in ledger data |
| Resolution price calculation | `numerator / denominator` vs `numerator` | Check pm_condition_resolutions format |

### C.4: ClickHouse Source Mapping

| Subgraph Event | ClickHouse Source | Join Key |
|----------------|-------------------|----------|
| OrdersMatched | `pm_trader_events_v2` | event_id |
| PositionSplit | `pm_ctf_events` WHERE event_type='PositionSplit' | tx_hash |
| PositionsMerge | `pm_ctf_events` WHERE event_type='PositionsMerge' | tx_hash |
| PayoutRedemption | `pm_ctf_events` WHERE event_type='PayoutRedemption' | tx_hash |
| ConditionResolution | `pm_condition_resolutions` | condition_id |

**Unified Ledger:** `pm_unified_ledger_v8` already consolidates these with:
- `source_type` = 'CLOB' | 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption'
- `token_delta`, `usdc_delta` pre-computed
- `payout_norm` for resolution price

---

## Quick Reference: The Formula

```
# ON BUY:
avgPrice = (avgPrice × amount + buyPrice × buyAmount) / (amount + buyAmount)
amount += buyAmount

# ON SELL:
adjustedAmount = MIN(sellAmount, amount)
deltaPnL = adjustedAmount × (sellPrice - avgPrice) / 1e6
realizedPnl += deltaPnL
amount -= adjustedAmount

# UI DISPLAY (not stored in subgraph):
unrealizedPnl = amount × (currentPrice - avgPrice) / 1e6
totalPnl = realizedPnl + unrealizedPnl

# UI PARITY (for resolved-but-unredeemed):
uiParityPnl = realizedPnl + SUM(resolvedPosition.amount × resolutionPrice - costBasis)
```

---

## Conclusion

**V29's `uiParityPnl` is the correct metric for UI comparison.** It accounts for the semantic difference where:
- Subgraph `realizedPnl` only updates on actual redemption events
- UI displays resolved positions as "realized" before redemption

The regression harness should use `v29GuardUiParityPctError` as the primary accuracy metric.

---

**Signed:** Claude 2 (Terminal 2 - Secondary Research)
