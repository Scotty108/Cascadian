# Polymarket PnL Subgraph - Definitive Guide

> **Source Analysis Date:** January 10, 2026
> **Repositories Analyzed:**
> - https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph
> - https://github.com/Polymarket/neg-risk-ctf-adapter
> - https://github.com/Polymarket/ctf-exchange
> - https://github.com/gnosis/conditional-tokens-contracts

---

## 1. Core Data Model (GraphQL Schema)

```graphql
type UserPosition @entity {
  id: ID!               # user + positionId
  user: String!         # wallet address (hex)
  tokenId: BigInt!      # ERC1155 token ID (position ID)
  amount: BigInt!       # tokens currently held
  avgPrice: BigInt!     # weighted average cost (scaled by COLLATERAL_SCALE)
  realizedPnl: BigInt!  # profits - losses (scaled)
  totalBought: BigInt!  # lifetime buys (for analytics only)
}
```

**Key insight**: Everything is tracked at the **position level** (user + tokenId), NOT at the condition level.

---

## 2. COLLATERAL_SCALE

```typescript
COLLATERAL_SCALE = 1_000_000  // 6 decimals, matching USDC
```

All prices are stored as integers scaled by 1M:
- `0.50` = `500_000`
- `0.75` = `750_000`
- `1.00` = `1_000_000`

---

## 3. Core PnL Formulas

### 3.1 updateUserPositionWithBuy

```typescript
const updateUserPositionWithBuy = (user, positionId, price, amount) => {
  const userPosition = loadOrCreateUserPosition(user, positionId);

  if (amount > 0) {
    // Weighted average price recalculation
    const numerator = userPosition.avgPrice * userPosition.amount + price * amount;
    const denominator = userPosition.amount + amount;
    userPosition.avgPrice = numerator / denominator;

    // Update amount
    userPosition.amount += amount;
    userPosition.totalBought += amount;
    userPosition.save();
  }
};
```

**Formula:**
```
newAvgPrice = (oldAvgPrice * oldAmount + buyPrice * buyAmount) / (oldAmount + buyAmount)
```

### 3.2 updateUserPositionWithSell

```typescript
const updateUserPositionWithSell = (user, positionId, price, amount) => {
  const userPosition = loadOrCreateUserPosition(user, positionId);

  // CRITICAL: Cap sell amount to position held
  const adjustedAmount = amount > userPosition.amount ? userPosition.amount : amount;

  // PnL = (sellPrice - avgPrice) * adjustedAmount / COLLATERAL_SCALE
  const deltaPnL = adjustedAmount * (price - userPosition.avgPrice) / COLLATERAL_SCALE;

  userPosition.realizedPnl += deltaPnL;
  userPosition.amount -= adjustedAmount;
  userPosition.save();
};
```

**Critical Rules:**
1. **Sells are capped to position held** - `min(sellAmount, currentPosition)`
2. **PnL = (sellPrice - avgPrice) * adjustedAmount**
3. **Only the adjusted amount counts** - excess sells are ignored

---

## 4. Event Handlers by Contract

### 4.1 ConditionalTokens Contract (Standard Markets)

| Event | Action | Price | Notes |
|-------|--------|-------|-------|
| `PositionSplit` | BUY both outcomes | $0.50 (500_000) | **Excludes** NegRiskAdapter & CTFExchange |
| `PositionsMerge` | SELL both outcomes | $0.50 (500_000) | **Excludes** NegRiskAdapter & CTFExchange |
| `PayoutRedemption` | SELL at resolution price | `payoutNumerators[i] * COLLATERAL_SCALE / payoutDenominator` | Realized after resolution |
| `ConditionPreparation` | Create condition | N/A | Only binary outcomes |
| `ConditionResolution` | Record payouts | N/A | Sets numerators/denominator |

**Exclusion Logic:**
```typescript
// In handlePositionSplit:
if (event.transaction.to == NEG_RISK_ADAPTER ||
    event.transaction.to == CTF_EXCHANGE) {
  return;  // Skip - these have their own handlers
}
```

### 4.2 CTFExchange Contract (CLOB Trading)

| Event | Action | Price Formula | Notes |
|-------|--------|---------------|-------|
| `OrderFilled` | BUY or SELL | `quoteAmount * COLLATERAL_SCALE / baseAmount` | Direct CLOB trades |

```typescript
const handleOrderFilled = (event) => {
  const order = parseOrderFilled(event);
  const price = order.quoteAmount * COLLATERAL_SCALE / order.baseAmount;

  if (order.tradeType == BUY) {
    updateUserPositionWithBuy(order.user, order.positionId, price, order.baseAmount);
  } else {
    updateUserPositionWithSell(order.user, order.positionId, price, order.baseAmount);
  }
};
```

### 4.3 NegRiskAdapter Contract

| Event | Action | Price | Notes |
|-------|--------|-------|-------|
| `PositionSplit` | BUY both outcomes | $0.50 | **Excludes** NEG_RISK_EXCHANGE |
| `PositionsMerge` | SELL both outcomes | $0.50 | **Excludes** NEG_RISK_EXCHANGE |
| `PositionsConverted` | Complex | See below | NO→YES conversion |
| `PayoutRedemption` | SELL at payout price | Calculated from numerators | Per outcome |

#### PositionConversion (Most Complex Handler)

```typescript
const handlePositionsConverted = (event) => {
  const negRiskEvent = NegRiskEvent.load(event.params.marketId);
  const questionCount = negRiskEvent.questionCount;
  const indexSet = event.params.indexSet;  // Bitmask of which questions

  let noCount = 0;
  let noPriceSum = BigInt.zero();

  // Phase 1: Sell NO tokens for questions IN the indexSet
  for (let i = 0; i < questionCount; i++) {
    if (indexSetContains(indexSet, i)) {
      const noPositionId = getNegRiskPositionId(marketId, i, NO_OUTCOME);
      const userPosition = loadOrCreateUserPosition(user, noPositionId);

      // Sell NO at average price
      updateUserPositionWithSell(user, noPositionId, userPosition.avgPrice, event.params.amount);

      noPriceSum += userPosition.avgPrice;
      noCount++;
    }
  }

  // Calculate average NO price and YES price
  const noPrice = noPriceSum / noCount;
  const yesPrice = computeNegRiskYesPrice(noPrice, noCount, questionCount);

  // Phase 2: Buy YES tokens for questions NOT in the indexSet
  for (let i = 0; i < questionCount; i++) {
    if (!indexSetContains(indexSet, i)) {
      const yesPositionId = getNegRiskPositionId(marketId, i, YES_OUTCOME);
      updateUserPositionWithBuy(user, yesPositionId, yesPrice, event.params.amount);
    }
  }
};
```

### 4.4 FPMM Contract (Legacy AMM)

| Event | Action | Price Formula |
|-------|--------|---------------|
| `FPMMBuy` | BUY | `investmentAmount / outcomeTokensBought` |
| `FPMMSell` | SELL | `returnAmount / outcomeTokensSold` |
| `FPMMFundingAdded` | BUY tokens + LP | Computed from pool state |
| `FPMMFundingRemoved` | SELL LP + BUY tokens | Computed from pool state |

---

## 5. Critical Functions

### 5.1 indexSetContains (0-indexed bitwise)

```typescript
// indexSet = 0b1010 (binary)
// index=0: 0b1010 & 0b0001 = 0 → false
// index=1: 0b1010 & 0b0010 = 2 → true
// index=2: 0b1010 & 0b0100 = 0 → false
// index=3: 0b1010 & 0b1000 = 8 → true

const indexSetContains = (indexSet: BigInt, index: u8): boolean => {
  return indexSet.bitAnd(BigInt.fromI32(1).leftShift(index)).gt(BigInt.zero());
};
```

**Key insight**: The index is **0-based**, not 1-based.

### 5.2 computeNegRiskYesPrice

```typescript
const computeNegRiskYesPrice = (noPrice, noCount, questionCount) => {
  return (noPrice * noCount - COLLATERAL_SCALE * (noCount - 1)) / (questionCount - noCount);
};
```

**Verified test cases:**
| noPrice | noCount | questionCount | yesPrice |
|---------|---------|---------------|----------|
| 750000 (0.75) | 3 | 5 | 125000 (0.125) |
| 730000 (0.73) | 1 | 6 | 146000 (0.146) |

**Derivation:**
```
yesPrice = (noPrice * noCount - COLLATERAL_SCALE * (noCount - 1)) / (questionCount - noCount)

Example 1:
= (750000 * 3 - 1000000 * 2) / (5 - 3)
= (2250000 - 2000000) / 2
= 125000 ✓

Example 2:
= (730000 * 1 - 1000000 * 0) / (6 - 1)
= 730000 / 5
= 146000 ✓
```

### 5.3 Position ID Computation

```typescript
// Standard market position ID
const getPositionId = (conditionId, outcomeIndex, isNegRisk) => {
  // Combines condition_id + outcome_index via keccak256
  // Returns uint256 as ERC1155 token ID
};

// Neg risk position ID (different formula)
const getNegRiskPositionId = (marketId, questionIndex, outcomeIndex) => {
  // Combines market_id + question_index + outcome_index
  // Returns uint256 as ERC1155 token ID
};
```

---

## 6. Key Invariants (Validation Checks)

### 6.1 Cash Flow Identity
For any closed position:
```
realizedPnl = totalSellProceeds - totalBuyCost
            = sum(sellPrice_i * sellAmount_i) - sum(buyPrice_j * buyAmount_j)
```

### 6.2 Position Balance
```
currentAmount = totalBought - totalSold
              = sum(buyAmount) - sum(adjustedSellAmount)
```
Where `adjustedSellAmount = min(sellAmount, positionAtTimeOfSell)`.

### 6.3 Average Price Monotonicity
After each buy:
```
newAvgPrice is between oldAvgPrice and buyPrice
```

### 6.4 Sell Cap Enforcement
```
adjustedAmount <= positionAmount (always)
```
This means **phantom sells are impossible** in the subgraph.

---

## 7. What Our Engine Must Do

### 7.1 Event Sources to Process

1. **pm_trader_events_v3** (CLOB fills) → OrderFilled
2. **pm_ctf_events** (splits, merges, conversions, redemptions) → ConditionalTokens + NegRiskAdapter
3. **pm_condition_resolutions_norm** (resolution prices) → For redemption pricing

### 7.2 Processing Order

Events MUST be processed in chronological order:
```
ORDER BY block_number ASC, log_index ASC
```

### 7.3 Exclusion Rules

| Event Source | Exclude When |
|--------------|--------------|
| ConditionalTokens.PositionSplit | `to == NegRiskAdapter` OR `to == CTFExchange` |
| ConditionalTokens.PositionsMerge | `to == NegRiskAdapter` OR `to == CTFExchange` |
| NegRiskAdapter.PositionSplit | `to == NegRiskExchange` |
| NegRiskAdapter.PositionsMerge | `to == NegRiskExchange` |

### 7.4 Price Calculations

| Event Type | Price Formula |
|------------|---------------|
| CLOB BUY/SELL | `usdc_amount / token_amount` |
| Split | `0.50` (constant) |
| Merge | `0.50` (constant) |
| Redemption | `payoutNumerators[outcomeIndex] / payoutDenominator` |
| Conversion (NO sell) | `userPosition.avgPrice` |
| Conversion (YES buy) | `computeNegRiskYesPrice(...)` |

---

## 8. Differences from Our Current Implementation

### 8.1 Sell Capping (CRITICAL)
**Subgraph**: Caps sells to `min(sellAmount, currentPosition)`
**Our engine**: May not be capping correctly, causing phantom sells

### 8.2 Conversion Handling (CRITICAL)
**Subgraph**: Sells NO tokens at avgPrice, buys YES tokens at computed yesPrice
**Our engine**: May not be tracking conversions correctly

### 8.3 Exclusion Filtering (CRITICAL)
**Subgraph**: Excludes specific contracts from generic handlers
**Our engine**: May be double-counting some events

### 8.4 indexSet Interpretation (CRITICAL)
**Subgraph**: 0-indexed bitwise (`1 << 0` = outcome 0)
**Our engine**: Was using 1-indexed in partition_index_sets

---

## 9. Implementation Checklist

- [ ] Implement proper sell capping: `adjustedAmount = min(sellAmount, currentPosition)`
- [ ] Process events in strict chronological order (block + log_index)
- [ ] Implement conversion handler with avgPrice sell + yesPrice buy
- [ ] Add exclusion filters for NegRiskAdapter and CTFExchange
- [ ] Fix indexSet to be 0-indexed bitwise
- [ ] Verify COLLATERAL_SCALE = 1_000_000
- [ ] Add invariant checks for validation

---

## 10. V1 Engine Gap Analysis

### What V1 Does:
1. **Aggregate-first SQL**: Groups by (tx_hash, condition_id, outcome_index, side), then sums
2. **Single data source**: Only uses `pm_trader_events_v3` (CLOB trades)
3. **Aggregate capping**: `WHEN sold > bought THEN sell_proceeds * (bought / sold)`
4. **No position state tracking**: No avgPrice per position
5. **No chronological processing**: All trades aggregated at once

### What Polymarket Subgraph Does:
1. **Event-by-event processing**: Each trade updates position state in chronological order
2. **Multiple data sources**:
   - ConditionalTokens (splits @ $0.50, merges @ $0.50, redemptions @ resolution price)
   - CTFExchange (CLOB trades @ computed price)
   - NegRiskAdapter (conversions, neg risk splits/merges/redemptions)
3. **Per-event capping**: `min(sellAmount, currentPosition)` at each sell
4. **Position-level avgPrice**: Weighted average updated on each buy
5. **Exclusion rules**: Prevents double-counting by filtering stakeholder addresses

### Critical Missing Components in V1:

| Component | V1 | Subgraph | Impact |
|-----------|-----|----------|--------|
| CTF Splits | ❌ Missing | ✅ BUY @ $0.50 | SPLIT_HEAVY wallets show $0 |
| CTF Merges | ❌ Missing | ✅ SELL @ $0.50 | Missing cash-out events |
| CTF Redemptions | ❌ Missing | ✅ SELL @ resolution | Missing settlement PnL |
| Position Conversions | ❌ Missing | ✅ Complex NO→YES | NEGRISK_HEAVY wallets fail |
| Chronological avgPrice | ❌ Aggregate | ✅ Per-event | Wrong cost basis |
| Event-level sell cap | ❌ Aggregate | ✅ Per-event | Phantom sells counted |

### Why SPLIT_HEAVY Fails:

The SPLIT_HEAVY wallet (`0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba`) has:
- **Zero CLOB trades** in pm_trader_events_v3
- **262K CTF events** (splits, merges, redemptions)
- V1 returns $0 because it only reads CLOB trades
- Actual PnL should be calculated from CTF events

### Why NEGRISK_HEAVY Fails:

Neg Risk wallets use position conversions where:
- NO tokens are sold at avgPrice
- YES tokens are bought at `computeNegRiskYesPrice()`
- V1 doesn't process these conversion events
- V1 sees internal adapter trades as real trades (double-counting)

---

## 11. Implementation Plan for V40

### Required Data Sources:

1. **pm_trader_events_v3** - CLOB trades (OrderFilled events)
2. **pm_ctf_events** - CTF events (splits, merges, conversions, redemptions)
3. **pm_condition_resolutions_norm** - Resolution prices
4. **pm_token_to_condition_map_v5** - Token ID to condition mapping
5. **pm_latest_mark_price_v1** - Current mark prices (for unrealized)

### Processing Algorithm:

```
1. Fetch all events for wallet (CLOB + CTF)
2. Sort by (block_number ASC, log_index ASC)
3. Initialize position state: Map<positionId, {amount, avgPrice, realizedPnl}>
4. For each event in order:
   a. Determine event type and handler
   b. Skip if stakeholder is excluded contract
   c. For BUY: update avgPrice with weighted average
   d. For SELL: cap to position, calculate deltaPnL, update
5. Sum all realizedPnl for final result
```

### Handler Mapping:

```typescript
// Event to handler mapping
const handlers = {
  'SPLIT': (event) => buyBothOutcomes(event, 0.50),
  'MERGE': (event) => sellBothOutcomes(event, 0.50),
  'REDEMPTION': (event) => sellAtResolution(event),
  'CONVERSION': (event) => convertNOtoYES(event),
  'CLOB_BUY': (event) => buy(event, event.price),
  'CLOB_SELL': (event) => sell(event, event.price),
};
```

---

## 12. Test Cases from Polymarket

### indexSetContains
```typescript
indexSet = 0b1010 (10 decimal)
// index 0: false
// index 1: true
// index 2: false
// index 3: true

indexSet = 16 (0b10000)
// index 0-3: false
// index 4: true
```

### computeNegRiskYesPrice
```typescript
// Test 1
noPrice = 750000, noCount = 3, questionCount = 5
// Result: 125000

// Test 2
noPrice = 730000, noCount = 1, questionCount = 6
// Result: 146000
```

---

## 11. Summary

The Polymarket PnL subgraph uses a **position-level ledger** with:
1. **Weighted average price** tracking on buys
2. **Sell capping** to prevent phantom sells
3. **Event-source-aware** exclusion rules
4. **0-indexed bitwise** indexSet interpretation
5. **Chronological processing** with block + log_index ordering

The key to matching Polymarket's numbers is implementing ALL of these rules correctly.
