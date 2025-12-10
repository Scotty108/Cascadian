# Polymarket PnL Exact Formula - Deep Dive Research

**Date:** 2025-11-30
**Source:** Polymarket GitHub `polymarket-subgraph/pnl-subgraph/`
**Status:** Complete - Ready for V14 Implementation

---

## Executive Summary

After deep research into Polymarket's official GitHub repositories, we found the **EXACT formulas** used for PnL calculation. The core algorithm is:

```
BUY:  avgPrice = (avgPrice × existingQty + price × buyQty) / (existingQty + buyQty)
SELL: realizedPnl += min(sellQty, trackedQty) × (sellPrice - avgPrice) / 1e6
```

**Key insight:** The V3 engine formula is IDENTICAL to Polymarket's. The 13% gap must come from:
1. Missing split/merge events (we don't track these)
2. Price calculation differences (baseAmount vs quoteAmount ordering)
3. Position tracking scope (subgraph tracks from blockchain events, we track from API)

---

## Source Files Analyzed

| File | Purpose |
|------|---------|
| `pnl-subgraph/src/utils/updateUserPositionWithBuy.ts` | Buy formula |
| `pnl-subgraph/src/utils/updateUserPositionWithSell.ts` | Sell formula + realizedPnl |
| `pnl-subgraph/src/utils/loadOrCreateUserPosition.ts` | Position initialization |
| `pnl-subgraph/src/ExchangeMapping.ts` | CLOB OrderFilled handling |
| `pnl-subgraph/src/ConditionalTokensMapping.ts` | Splits, merges, redemptions |
| `pnl-subgraph/src/utils/parseOrderFilled.ts` | Order parsing logic |
| `common/constants.template.ts` | COLLATERAL_SCALE = 10^6 |

---

## Exact Formulas

### Constants
```typescript
COLLATERAL_SCALE = BigInt.fromI32(10).pow(6);  // 1,000,000 (USDC 6 decimals)
FIFTY_CENTS = COLLATERAL_SCALE / 2;             // 500,000
```

### UserPosition Entity
```graphql
type UserPosition @entity {
  id: ID!                    # user_tokenId
  user: String!
  tokenId: BigInt!
  amount: BigInt!            # Current token balance (in raw units)
  avgPrice: BigInt!          # Weighted average cost (scaled by 1e6)
  realizedPnl: BigInt!       # Cumulative realized PnL (in USDC raw)
  totalBought: BigInt!       # Cumulative tokens bought
}
```

### BUY Formula (`updateUserPositionWithBuy.ts`)
```typescript
if (amount > 0) {
  // Weighted average cost basis
  const numerator = avgPrice * existingAmount + price * buyAmount;
  const denominator = existingAmount + buyAmount;
  userPosition.avgPrice = numerator / denominator;

  // Update position
  userPosition.amount += amount;
  userPosition.totalBought += amount;
}
```

### SELL Formula (`updateUserPositionWithSell.ts`)
```typescript
// CRITICAL: Clamp to tracked position size
const adjustedAmount = sellAmount > userPosition.amount
  ? userPosition.amount
  : sellAmount;

// Calculate realized PnL
const deltaPnL = adjustedAmount * (sellPrice - avgPrice) / COLLATERAL_SCALE;

// Update state
userPosition.realizedPnl += deltaPnL;
userPosition.amount -= adjustedAmount;
```

### CLOB Trade Price Calculation (`ExchangeMapping.ts`)
```typescript
// Price = USDC per share (scaled)
const price = order.quoteAmount * COLLATERAL_SCALE / order.baseAmount;

if (order.side == BUY) {
  updateUserPositionWithBuy(account, positionId, price, baseAmount);
} else {
  updateUserPositionWithSell(account, positionId, price, baseAmount);
}
```

### Order Parsing (`parseOrderFilled.ts`)
```typescript
// Determine side: if maker gives USDC (assetId=0), it's a BUY
const side = makerAssetId == 0 ? BUY : SELL;

if (side == BUY) {
  return {
    account: maker,
    baseAmount: takerAmountFilled,   // Tokens received
    quoteAmount: makerAmountFilled,  // USDC spent
    positionId: takerAssetId,
  };
} else {
  return {
    account: maker,
    baseAmount: makerAmountFilled,   // Tokens sold
    quoteAmount: takerAmountFilled,  // USDC received
    positionId: makerAssetId,
  };
}
```

---

## Special Event Handling

### Position Split (USDC → YES + NO tokens)
```typescript
// Both outcomes get credited at $0.50
for (outcomeIndex in [0, 1]) {
  updateUserPositionWithBuy(stakeholder, positionId, FIFTY_CENTS, amount);
}
```
**Impact:** User splits $100 USDC → Gets 100 YES @ $0.50 avg + 100 NO @ $0.50 avg

### Position Merge (YES + NO tokens → USDC)
```typescript
// Both outcomes sold at $0.50
for (outcomeIndex in [0, 1]) {
  updateUserPositionWithSell(stakeholder, positionId, FIFTY_CENTS, amount);
}
```
**Impact:** PnL realized based on (0.50 - avgPrice) for each outcome

### PayoutRedemption (After Resolution)
```typescript
// Use ENTIRE tracked position
const amount = userPosition.amount;
const price = payoutNumerators[outcomeIndex] * COLLATERAL_SCALE / payoutDenominator;

updateUserPositionWithSell(redeemer, positionId, price, amount);
```
**Impact:** Winners redeem at ~$1, losers at ~$0. All tracked position is "sold".

### Excluded Events
- Events from `NEG_RISK_ADAPTER` (handled separately)
- Events from `EXCHANGE` (CLOB trades handled via OrderFilled)

---

## Comparison: V3 vs Polymarket Subgraph

| Aspect | V3 Engine | Polymarket Subgraph |
|--------|-----------|---------------------|
| **Buy Formula** | `position_cost += usdc; position_qty += tokens` | `avgPrice = weighted_avg(...)` |
| **Sell Formula** | `pnl = (price - avg_cost) × min(qty, position)` | `deltaPnl = adjustedAmount × (price - avgPrice) / 1e6` |
| **Clamping** | `Math.min(event.qty_tokens, state.position_qty)` | `amount > userPosition.amount ? userPosition.amount : amount` |
| **Price Source** | `usdc_amount / token_amount` from API | `quoteAmount × 1e6 / baseAmount` from OrderFilled |
| **Splits** | NOT TRACKED | Tracked at $0.50 |
| **Merges** | NOT TRACKED | Tracked at $0.50 |
| **Resolution** | Implicit PnL for remaining positions | Via PayoutRedemption events |

### KEY DIFFERENCES IDENTIFIED

1. **We don't track PositionSplit events**
   - When user splits USDC into YES+NO, we miss this
   - Subgraph credits both at $0.50

2. **We don't track PositionsMerge events**
   - When user merges YES+NO back to USDC, we miss this
   - Subgraph realizes PnL at $0.50

3. **Price calculation might differ**
   - We use `usdc_amount / token_amount` from Goldsky
   - Subgraph uses `quoteAmount × 1e6 / baseAmount` from raw event

4. **Redemption handling differs**
   - We calculate tokens_burned = payout_usdc / payout_price
   - Subgraph uses userPosition.amount (entire tracked balance)

---

## CRITICAL FINDING: Root Cause of 13% Gap (2025-11-30)

### Theo4 Analysis Results

**CTF Events for Theo4:**
- Splits: 0 (NONE)
- Merges: 2 ($7,668 USDC)
- Redemptions: 1 ($120,469 USDC)

**V3 PnL Breakdown:**
| Source | PnL |
|--------|-----|
| CLOB trades | -$49K |
| Redemptions | +$51K |
| **Resolution (implicit)** | **+$25M** |
| **TOTAL** | $25M |

**Key Test:**
- WITHOUT resolution losses: PnL = **$1,597** (essentially zero!)
- WITH resolution losses: PnL = **$25M** (13% over UI of $22M)

### THE INSIGHT

The subgraph ONLY calculates realizedPnl from:
1. CLOB sells
2. PayoutRedemption events

**It does NOT automatically realize unredeemed positions!**

But Theo4's UI shows $22M, meaning the **UI DOES include unredeemed resolved positions** somehow!

### How the UI Calculates It

The UI's $22M likely comes from:
1. **realizedPnl from subgraph** (just $1,597 from CLOB + redemptions)
2. PLUS **unrealized PnL calculation** for positions in resolved markets

The unrealized PnL formula would be:
```
unrealized = position_qty × payout_price - remaining_cost_basis
```

Where our V3 gets $25M but UI gets $22M (~13% lower).

### Possible Explanations for the ~$3M Difference

1. **Different cost basis tracking**
   - UI might use FIFO instead of average cost
   - FIFO can produce different results when selling partial positions

2. **Original cost basis source**
   - UI may have access to more complete trade history
   - Our Goldsky data might be missing early trades

3. **Resolution price precision**
   - UI might apply small adjustments to payout_numerators

4. **Mark-to-market at different times**
   - If UI calculated before full resolution was indexed

### Split/Merge Analysis
Theo4 has almost NO split/merge activity:
- 0 splits (ELIMINATED as gap cause)
- 2 merges for $7,668 (negligible)

**Splits/merges are NOT the gap source for this wallet.**

---

## V14 Implementation Plan

To match Polymarket exactly, V14 should:

1. **Add PositionSplit handling**
   - Query `pm_ctf_events` for `event_type = 'PositionSplit'`
   - Credit both outcomes at FIFTY_CENTS

2. **Add PositionsMerge handling**
   - Query `pm_ctf_events` for `event_type = 'PositionsMerge'`
   - Realize PnL at FIFTY_CENTS for both outcomes

3. **Use BigInt-style math**
   - Store avgPrice as integer (scaled by 1e6)
   - Use integer division to match subgraph precision

4. **Track position by token_id, not (condition, outcome)**
   - Subgraph uses `positionId` directly
   - This avoids mapping issues

5. **Verify price calculation**
   - Compare our price vs raw OrderFilled event prices
   - Check if Goldsky data has any transformation

---

## Next Steps

1. [ ] Check if Theo4 has split/merge events in `pm_ctf_events`
2. [ ] Implement V14 with split/merge handling
3. [ ] Use BigInt math throughout
4. [ ] Compare event-by-event with subgraph if possible
5. [ ] Test against multiple wallets

---

*Research by Claude Code - 2025-11-30*
