# Polymarket Subgraph PnL Formula

**Source:** https://github.com/Polymarket/polymarket-subgraph/tree/f5a074a5a3b7622185971c5f18aec342bcbe96a6/pnl-subgraph
**Date:** 2025-12-07
**Status:** Reference documentation

## Executive Summary

The Polymarket subgraph uses a **running average cost basis** approach for PnL calculation, NOT the simple "cash flow + final shares * resolution" formula we've been using.

### Key Insight: Negative Inventory Handling

The subgraph **explicitly handles negative inventory** by capping sells at tracked inventory:

```typescript
// from updateUserPositionWithSell.ts
const adjustedAmount = amount.gt(userPosition.amount)
  ? userPosition.amount  // Cap at what we tracked
  : amount;

// "that means the user obtained tokens outside of what we track
// and we don't want to give them PnL for the extra"
```

This means: **If you try to sell more than you bought (according to their tracking), they ignore the excess.** They explicitly acknowledge tokens can be obtained "outside of what we track" (transfers, etc).

---

## The Formula

### On Buy:
```typescript
// Weighted average cost basis
newAvgPrice = (avgPrice * currentAmount + buyPrice * buyAmount) / (currentAmount + buyAmount)
amount += buyAmount
totalBought += buyAmount
```

### On Sell:
```typescript
// Cap at tracked inventory
adjustedAmount = min(sellAmount, userPosition.amount)

// Realized PnL = amount * (sellPrice - avgCostBasis)
deltaPnL = adjustedAmount * (sellPrice - avgPrice) / COLLATERAL_SCALE

realizedPnl += deltaPnL
amount -= adjustedAmount
```

### Key Differences from Our V29 Formula

| Aspect | Polymarket Subgraph | Our V29 |
|--------|---------------------|---------|
| **Formula** | `realized = Σ(sellQty * (sellPrice - avgCostBasis))` | `cash_flow + final_shares * resolution_price` |
| **Negative inventory** | Caps at tracked inventory, ignores excess | Calculates with negative shares (causes huge errors) |
| **Unrealized** | Not stored (calculated separately) | Not included |
| **Resolution** | Treated as a sell at resolution price | Uses payout_norm * final_shares |

---

## Event Handling

### CLOB Trades (ExchangeMapping.ts)
```typescript
handleOrderFilled(event) {
  order = parseOrderFilled(event)
  price = quoteAmount * COLLATERAL_SCALE / baseAmount

  if (order.side == BUY) {
    updateUserPositionWithBuy(user, positionId, price, amount)
  } else {
    updateUserPositionWithSell(user, positionId, price, amount)
  }
}
```

### CTF Events (ConditionalTokensMapping.ts)

**Position Split** (minting shares with collateral):
- Treated as BUY at 50 cents per share for both outcomes
- Filters out NegRiskAdapter and CTFExchange to avoid double-counting

**Position Merge** (burning shares for collateral):
- Treated as SELL at 50 cents per share
- Same filtering

**Payout Redemption**:
```typescript
redemptionPrice = payoutNumerators[outcomeIndex] * COLLATERAL_SCALE / payoutDenominator
// Treats entire user balance as a sell at redemption price
updateUserPositionWithSell(user, positionId, redemptionPrice, userBalance)
```

---

## Price Rounding Issue

From your message:
> The discrepancy I found in the Polymarket UI was based on rounding. The UI is showing a rounded version of the price in cents, the subgraph data has sub-cent accuracy.

This means:
- Subgraph uses full precision (e.g., `0.713456789`)
- UI displays rounded (e.g., `$0.71`)
- When multiplied by large quantities, this causes visible differences

**Impact:** For 10,000 shares at $0.713 vs $0.71, difference is $30.

---

## Implications for Our Engine

### 1. We Need Running Inventory State
The subgraph maintains per-position state:
- `avgPrice` (weighted average cost basis)
- `amount` (current inventory)
- `realizedPnl` (cumulative)

We're currently doing stateless aggregation which can't compute this properly.

### 2. Negative Inventory = Ignore Excess Sells
When we see negative inventory, we should:
- NOT calculate PnL on the excess
- Flag it as "tokens obtained outside tracking"
- This explains why our errors were so large

### 3. Resolution is Just Another Sell
A redemption at resolution should be:
```
redemption_pnl = shares * (resolution_price - avg_cost_basis)
```

NOT:
```
position_pnl = cash_flow + shares * resolution_price  // Our current formula
```

---

## Recommended Changes

### Option A: Full State Machine (Accurate but Complex)
- Build running inventory per (wallet, condition_id, outcome_index)
- Calculate avgPrice on each buy
- Calculate realized PnL on each sell
- Match Polymarket exactly

### Option B: Simplified with Guards (Pragmatic)
Keep current formula but:
1. **Cap sells at buys** - Don't let running inventory go negative
2. **Flag data gaps** - When sells > buys, mark as "incomplete data"
3. **Use for tiering** - These wallets go to TIER_C

### Option C: Hybrid
- Use Option A for TIER_A wallets (enough data to compute properly)
- Use Option B guards for TIER_B/C wallets

---

## Files in Polymarket Subgraph

```
pnl-subgraph/src/
├── ConditionalTokensMapping.ts  # Handles splits, merges, redemptions
├── ExchangeMapping.ts           # Handles CLOB fills
├── FixedProductMarketMakerMapping.ts  # AMM (deprecated?)
├── NegRiskAdapterMapping.ts     # Multi-outcome markets
└── utils/
    ├── updateUserPositionWithBuy.ts   # Buy logic + avgPrice
    ├── updateUserPositionWithSell.ts  # Sell logic + PnL calc
    ├── loadOrCreateUserPosition.ts    # State management
    ├── parseOrderFilled.ts            # Event parsing
    └── ...
```

---

## Key Quotes from Code

From `updateUserPositionWithSell.ts`:
> "use userPosition amount if the amount is greater than the userPosition amount that means the user obtained tokens outside of what we track and we don't want to give them PnL for the extra"

This is exactly why our negative inventory wallets have huge PnL errors - we're crediting/debiting PnL for shares we never tracked being acquired.
