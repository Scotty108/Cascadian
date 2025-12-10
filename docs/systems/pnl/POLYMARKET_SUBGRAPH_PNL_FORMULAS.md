# Polymarket Subgraph PnL Formulas - Quick Reference

**Source:** https://github.com/Polymarket/polymarket-subgraph
**Status:** CONFIRMED from source code (2025-12-06)

---

## Core Formulas (CONFIRMED)

### 1. Inventory Guard (Sell Operations Only)

```typescript
// File: pnl-subgraph/src/utils/updateUserPositionWithSell.ts
const adjustedAmount = amount.gt(userPosition.amount)
  ? userPosition.amount
  : amount;
```

**Formula:**
```
adjustedAmount = min(sellAmount, trackedPositionAmount)
```

**Applies To:**
- ✅ All sell operations
- ❌ NOT applied to buys

**Purpose:** Prevents PnL attribution for tokens obtained outside tracked events (direct ERC1155 transfers)

---

### 2. Realized PnL Calculation

```typescript
// File: pnl-subgraph/src/utils/updateUserPositionWithSell.ts
const deltaPnL = adjustedAmount
  .times(price.minus(userPosition.avgPrice))
  .div(COLLATERAL_SCALE);

userPosition.realizedPnl = userPosition.realizedPnl.plus(deltaPnL);
```

**Formula:**
```
ΔrealizedPnL = (adjustedAmount × (sellPrice - avgPrice)) / 1,000,000

realizedPnL = realizedPnL_previous + ΔrealizedPnL
```

**When Triggered:**
- Exchange OrderFilled (sell side)
- FPMM FPMMSell
- PositionsMerge (at $0.50)
- PayoutRedemption (at resolution price)
- PositionsConverted (complex NegRisk logic)

---

### 3. Average Price Update (Buy Operations Only)

```typescript
// File: pnl-subgraph/src/utils/updateUserPositionWithBuy.ts
const numerator = userPosition.avgPrice
  .times(userPosition.amount)
  .plus(price.times(amount));
const denominator = userPosition.amount.plus(amount);
userPosition.avgPrice = numerator.div(denominator);
```

**Formula:**
```
avgPrice_new = (avgPrice_old × amount_old + buyPrice × buyAmount) / (amount_old + buyAmount)
```

**Method:** Weighted average (NOT FIFO)

**Properties:**
- Only updates on buys
- Never changes on sells
- First buy: avgPrice = buyPrice (since old amount is 0)

---

### 4. Position Amount Updates

**Buy Operations:**
```typescript
userPosition.amount = userPosition.amount.plus(amount);
userPosition.totalBought = userPosition.totalBought.plus(amount);
```

**Sell Operations:**
```typescript
userPosition.amount = userPosition.amount.minus(adjustedAmount);
```

**Formula:**
```
amount_new = amount_old + buyAmount  (on buy)
amount_new = amount_old - adjustedAmount  (on sell)

totalBought_new = totalBought_old + buyAmount  (never decreases)
```

---

## Price Calculations by Event Type

### Exchange OrderFilled

```typescript
// File: pnl-subgraph/src/ExchangeMapping.ts
const price = order.quoteAmount.times(COLLATERAL_SCALE).div(order.baseAmount);
```

**Formula:**
```
price = (quoteAmount × 1,000,000) / baseAmount
```
- quoteAmount = USDC amount
- baseAmount = token amount

### FPMM Buy

```typescript
// File: pnl-subgraph/src/FixedProductMarketMakerMapping.ts
const price = event.params.investmentAmount
  .times(COLLATERAL_SCALE)
  .div(event.params.outcomeTokensBought);
```

**Formula:**
```
price = (investmentAmount × 1,000,000) / outcomeTokensBought
```

### FPMM Sell

```typescript
const price = event.params.returnAmount
  .times(COLLATERAL_SCALE)
  .div(event.params.outcomeTokensSold);
```

**Formula:**
```
price = (returnAmount × 1,000,000) / outcomeTokensSold
```

### Redemption

```typescript
// File: pnl-subgraph/src/ConditionalTokensMapping.ts
const price = payoutNumerators[outcomeIndex]
  .times(COLLATERAL_SCALE)
  .div(payoutDenominator);
```

**Formula:**
```
price = (payoutNumerator × 1,000,000) / payoutDenominator
```
- Binary YES wins: payoutNumerator = 1, payoutDenominator = 1 → price = 1,000,000
- Binary NO wins: payoutNumerator = 0, payoutDenominator = 1 → price = 0

### Split/Merge

```typescript
// Fixed price for both outcomes
const price = FIFTY_CENTS;  // = 500,000
```

**Formula:**
```
price = 500,000  (always $0.50)
```

---

## Constants

```typescript
// File: common/constants.template.ts
COLLATERAL_SCALE = BigInt.fromI32(10).pow(6)  // = 1,000,000
FIFTY_CENTS = COLLATERAL_SCALE.div(BigInt.fromI32(2))  // = 500,000
```

**Values:**
- `COLLATERAL_SCALE = 1,000,000` (10^6 for USDC 6 decimals)
- `FIFTY_CENTS = 500,000` ($0.50 in scaled units)

---

## Initial Values

```typescript
// File: pnl-subgraph/src/utils/loadOrCreateUserPosition.ts
userPosition.amount = BigInt.zero();
userPosition.avgPrice = BigInt.zero();
userPosition.realizedPnl = BigInt.zero();
userPosition.totalBought = BigInt.zero();
```

**All fields initialize to 0:**
- `amount = 0`
- `avgPrice = 0`
- `realizedPnl = 0`
- `totalBought = 0`

---

## Unrealized PnL (Not Stored)

**Calculated on-demand:**
```
unrealizedPnl = (amount × (currentPrice - avgPrice)) / 1,000,000
```

**Total PnL:**
```
totalPnl = realizedPnl + unrealizedPnl
```

---

## Special Case: NegRisk PositionsConverted

```typescript
// File: pnl-subgraph/src/utils/computeNegRiskYesPrice.ts
const yesPrice = noPrice
  .times(BigInt.fromI32(noCount))
  .minus(COLLATERAL_SCALE.times(BigInt.fromI32(noCount - 1)))
  .div(BigInt.fromI32(questionCount - noCount));
```

**Formula:**
```
yesPrice = (noPrice × noCount - 1,000,000 × (noCount - 1)) / (questionCount - noCount)
```

**Process:**
1. Sell NO positions at `avgNoPrice` (average of user's NO positions)
2. Buy YES positions at computed `yesPrice`
3. Result: Often ~zero realized PnL (selling at cost basis)

---

## Trade Type Detection (Exchange)

```typescript
// File: pnl-subgraph/src/utils/parseOrderFilled.ts
const side = event.params.makerAssetId.equals(BigInt.zero())
  ? TradeType.BUY
  : TradeType.SELL;
```

**Logic:**
```
if makerAssetId == 0:
  → BUY (maker provides USDC, receives tokens)
else:
  → SELL (maker provides tokens, receives USDC)
```

---

## Events NOT Tracked

**From pnl-subgraph/notes.md:**
> "Transfers outside of these 5 event type are *not* tracked."

**The 5 tracked types:**
1. Merges
2. Splits
3. Redemptions
4. Conversions (NegRisk)
5. OrdersMatched (Exchange fills)

**NOT tracked:**
- Direct ERC1155 Transfer events
- ERC1155 TransferSingle
- ERC1155 TransferBatch
- Proxy wallet operations

**Impact:** This is WHY inventory guard is necessary!

---

## Key Differences from Other Approaches

| Aspect | Polymarket Subgraph | Common Alternative |
|--------|-------------------|-------------------|
| **Cost Basis** | Weighted average | FIFO |
| **Inventory Guard** | Clamps sells to tracked amount | None / full tracking |
| **PnL Realization** | At sell time | At redemption |
| **Transfer Tracking** | Only 5 event types | Full ERC1155 ledger |
| **Precision** | Integer division (truncates) | Floating point |

---

## Implementation Checklist for Cascadian

- [ ] Verify inventory guard implemented in V17
- [ ] Confirm weighted average vs FIFO method
- [ ] Test PnL formula matches: `(amount × (price - avgPrice)) / 1e6`
- [ ] Verify sell amount clamping to position amount
- [ ] Check if ERC1155 transfers need guard (or fully tracked)
- [ ] Test edge cases: zero avgPrice, oversell protection
- [ ] Document cost basis method for users
- [ ] Add unit tests for inventory guard

---

## Quick Formula Reference

```
# On Buy:
avgPrice_new = (avgPrice_old × amount_old + buyPrice × buyAmount) / (amount_old + buyAmount)
amount_new = amount_old + buyAmount
totalBought_new = totalBought_old + buyAmount
realizedPnl_new = realizedPnl_old  (unchanged)

# On Sell:
adjustedAmount = min(sellAmount, amount_old)
ΔrealizedPnl = (adjustedAmount × (sellPrice - avgPrice_old)) / 1,000,000
realizedPnl_new = realizedPnl_old + ΔrealizedPnl
amount_new = amount_old - adjustedAmount
avgPrice_new = avgPrice_old  (unchanged)
totalBought_new = totalBought_old  (unchanged)

# Unrealized PnL (calculated on-demand):
unrealizedPnl = (amount × (currentPrice - avgPrice)) / 1,000,000

# Total PnL:
totalPnl = realizedPnl + unrealizedPnl
```

---

**Source Files:**
- `pnl-subgraph/src/utils/updateUserPositionWithBuy.ts`
- `pnl-subgraph/src/utils/updateUserPositionWithSell.ts`
- `pnl-subgraph/src/utils/loadOrCreateUserPosition.ts`
- `common/constants.template.ts`

**Full Analysis:** See `docs/reports/POLYMARKET_SUBGRAPH_PNL_ANALYSIS.md`
