# Polymarket Official PnL Algorithm

**Source:** https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph

This is the **actual algorithm** used by Polymarket's pnl-subgraph. Not a guess, not an approximation.

---

## Core Data Model

### UserPosition Entity
```graphql
type UserPosition {
  id: String!           # user + tokenId
  user: String!         # wallet address
  tokenId: String!      # outcome token
  amount: BigInt!       # current position size
  avgPrice: BigInt!     # weighted average entry price
  realizedPnl: BigInt!  # cumulative realized P&L
  totalBought: BigInt!  # cumulative tokens purchased
}
```

---

## Event Processing

### 1. ORDER_MATCHED (CLOB Trade)

**On BUY:**
```
price = quoteAmount * COLLATERAL_SCALE / baseAmount

avgPrice = (avgPrice * existingAmount + price * buyAmount) / (existingAmount + buyAmount)
amount = amount + buyAmount
totalBought = totalBought + buyAmount
```

**On SELL:**
```
adjustedAmount = min(sellAmount, trackedAmount)  // Cap to prevent phantom gains

deltaPnl = adjustedAmount * (sellPrice - avgPrice) / COLLATERAL_SCALE
realizedPnl = realizedPnl + deltaPnl
amount = amount - adjustedAmount
```

### 2. POSITION_SPLIT (Minting via CTF)

Treated as **BUY at $0.50** for BOTH outcomes:
```
price = FIFTY_CENTS  // 500000 in 6-decimal scale
// Calls updateUserPositionWithBuy for each outcome
```

### 3. POSITIONS_MERGE (Burning via CTF)

Treated as **SELL at $0.50** for BOTH outcomes:
```
price = FIFTY_CENTS  // 500000 in 6-decimal scale
// Calls updateUserPositionWithSell for each outcome
```

### 4. PAYOUT_REDEMPTION (After Resolution)

Treated as **SELL at payout price**:
```
payoutDenominator = sum(payoutNumerators)
price = payoutNumerators[outcomeIndex] * COLLATERAL_SCALE / payoutDenominator

// For winning outcome: price = 1.0 (1000000)
// For losing outcome: price = 0.0 (0)

deltaPnl = amount * (price - avgPrice) / COLLATERAL_SCALE
realizedPnl = realizedPnl + deltaPnl
amount = 0  // Position fully redeemed
```

---

## Constants

```typescript
COLLATERAL_SCALE = 1_000_000  // 10^6 for USDC decimals
FIFTY_CENTS = 500_000         // Used for split/merge events
```

---

## Critical Details

### 1. Capped Sells
If a user tries to sell more than their tracked `amount`, the subgraph CAPS the PnL calculation:
```
adjustedAmount = min(sellAmount, trackedAmount)
```

This prevents crediting gains on tokens received via transfer (not from tracked buys).

### 2. Average Price Weighting
The avgPrice is a **running weighted average** across all buys:
```
newAvgPrice = (oldAvgPrice * oldAmount + newPrice * newAmount) / (oldAmount + newAmount)
```

### 3. Split/Merge at 50 Cents
When you split USDC into YES+NO tokens, it's recorded as buying BOTH at $0.50 each.
When you merge YES+NO back to USDC, it's recorded as selling BOTH at $0.50 each.

This is key: **splits and merges do NOT immediately generate realized PnL** because buy price = sell price = $0.50.

### 4. Redemption Price
Winner outcome: `price = 1.0` (because payoutNumerator = 1, denominator = 1)
Loser outcome: `price = 0.0` (because payoutNumerator = 0)

So if you bought winner at $0.60, redeeming gives:
```
deltaPnl = amount * (1.0 - 0.60) = +0.40 per token
```

If you bought loser at $0.40, redeeming gives:
```
deltaPnl = amount * (0.0 - 0.40) = -0.40 per token
```

---

## Why Our Ledger Matches for Retail

For retail wallets (mostly long-only, no external transfers):
1. Every buy is tracked → avgPrice is accurate
2. Every sell is against tracked amount → no capping
3. Redemptions calculate correctly

Formula simplifies to:
```
realizedPnl ≈ sum(usdc_delta) from all trades + redemptions
```

Which is exactly what our ledger-based approach does.

---

## Why Operators Diverge

For operators/MMs:
1. Tokens may arrive via transfer (not tracked as buy) → avgPrice = 0
2. Selling these tokens gets capped → understated gains
3. Complex position management → avgPrice drifts from true cost

This is a **data completeness issue**, not a formula issue.

---

## How to Achieve Full Parity

To match Polymarket exactly:

1. **Track ALL buys** (CLOB + Split events)
2. **Maintain running avgPrice** per (wallet, tokenId)
3. **Track amount** per position
4. **Cap sells** to tracked amount
5. **Process events in timestamp order**

The V11_POLY engine already does most of this. The remaining gap is:
- Missing Split/Merge events in some markets
- ERC1155 transfers creating "phantom" inventory

---

*Extracted from Polymarket/polymarket-subgraph on 2025-11-29*
