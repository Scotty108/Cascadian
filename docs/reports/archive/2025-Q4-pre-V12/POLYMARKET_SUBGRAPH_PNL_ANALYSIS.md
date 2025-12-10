# Polymarket Subgraph PnL Implementation Analysis

**Repository:** https://github.com/Polymarket/polymarket-subgraph
**Analysis Date:** 2025-12-06
**Focus:** PnL calculation formulas, inventory guard semantics, and position lifecycle

---

## Executive Summary

This report extracts the exact PnL calculation logic from Polymarket's official subgraph implementation. The analysis confirms critical implementation details including:

1. **CONFIRMED:** Inventory guard clamping on sells only (`adjustedAmount = min(amount, trackedPosition)`)
2. **CONFIRMED:** Realized PnL formula: `amount × (price - avgPrice) / COLLATERAL_SCALE`
3. **CONFIRMED:** Weighted average price updates on buys
4. **CONFIRMED:** PnL realized at trade time, not redemption
5. **CONFIRMED:** Uses 6-decimal precision (1e6 COLLATERAL_SCALE)

---

## 1. Inventory Guard Semantics

### File: `pnl-subgraph/src/utils/updateUserPositionWithSell.ts`

**CONFIRMED FORMULA:**

```typescript
const adjustedAmount = amount.gt(userPosition.amount)
  ? userPosition.amount
  : amount;
```

**Analysis:**
- **Clamps to tracked position:** `adjustedAmount = min(sellAmount, trackedPositionAmount)`
- **Applies ONLY to sells:** Buy operations have no clamping
- **Purpose:** Prevents PnL attribution for tokens obtained outside tracked events
- **Comment from code:** "that means the user obtained tokens outside of what we track and we don't want to give them PnL for the extra"

**Applies To:**
- ✅ Exchange OrderFilled (sell side)
- ✅ FPMM sells
- ✅ Position merges
- ✅ Redemptions
- ❌ NOT applied to buys, splits, or funding operations

---

## 2. Realized PnL Calculation

### File: `pnl-subgraph/src/utils/updateUserPositionWithSell.ts`

**CONFIRMED FORMULA:**

```typescript
// realizedPnl changes by
// d = amount * (price - avgPrice)
const deltaPnL = adjustedAmount
  .times(price.minus(userPosition.avgPrice))
  .div(COLLATERAL_SCALE);

// update realizedPnl
userPosition.realizedPnl = userPosition.realizedPnl.plus(deltaPnL);
```

**Mathematical Expression:**
```
ΔrealizedPnL = (adjustedAmount × (sellPrice - avgPrice)) / COLLATERAL_SCALE

realizedPnL_new = realizedPnL_old + ΔrealizedPnL
```

**Key Properties:**
- **When Realized:** At sell time (not at redemption or settlement)
- **Basis:** Uses `avgPrice` (weighted average cost basis)
- **Precision:** Divides by `COLLATERAL_SCALE` (1e6) to normalize from raw token amounts
- **Sign:** Positive if sellPrice > avgPrice (profit), negative otherwise (loss)
- **Cumulative:** Each sell adds to the running `realizedPnl` total

**Triggered By:**
1. Exchange OrderFilled (sell side)
2. FPMM FPMMSell events
3. PositionsMerge (both outcomes at FIFTY_CENTS)
4. PayoutRedemption (at resolution price)
5. NegRisk PositionsConverted (complex multi-outcome logic)

---

## 3. Average Price Updates

### File: `pnl-subgraph/src/utils/updateUserPositionWithBuy.ts`

**CONFIRMED FORMULA:**

```typescript
// update average price
// avgPrice = (avgPrice * userAmount + price * buyAmount)
// / (userAmount + buyAmount)
const numerator = userPosition.avgPrice
  .times(userPosition.amount)
  .plus(price.times(amount));
const denominator = userPosition.amount.plus(amount);
userPosition.avgPrice = numerator.div(denominator);
```

**Mathematical Expression:**
```
avgPrice_new = (avgPrice_old × amount_old + buyPrice × buyAmount) / (amount_old + buyAmount)
```

**Method:** Weighted average (NOT FIFO)
- Each buy recalculates the blended cost basis
- Old positions weighted by their quantity
- New purchases weighted by their quantity
- NEVER changes on sells (cost basis is static until new buys)

**Initial State:**
```typescript
// From loadOrCreateUserPosition.ts
userPosition.avgPrice = BigInt.zero();
```

**Edge Case Handling:**
- If `amount <= 0`, no update occurs (guarded by `if (amount.gt(BigInt.zero()))`)
- First buy: `avgPrice = buyPrice` (since old amount is zero)

---

## 4. Scaling Constants and Rounding

### File: `common/constants.template.ts`

**CONFIRMED CONSTANTS:**

```typescript
// USDC has 6 decimals
COLLATERAL_SCALE = BigInt.fromI32(10).pow(6)  // = 1,000,000

// Used for splits/merges (50% price)
FIFTY_CENTS = COLLATERAL_SCALE.div(BigInt.fromI32(2))  // = 500,000
```

**Precision Handling:**
- **Internal representation:** BigInt (arbitrary precision integers)
- **Price encoding:** dollars per share × COLLATERAL_SCALE
  - Example: $0.65/share = 650,000 (BigInt)
  - Example: $0.50/share = 500,000 (BigInt)
- **No explicit rounding:** Uses integer division (`.div()`)
  - Truncates fractional parts (rounds down)
- **Display vs Calculation:** Both use same precision (no separate display rounding)

**Price Calculation Examples:**

```typescript
// Exchange OrderFilled
const price = order.quoteAmount.times(COLLATERAL_SCALE).div(order.baseAmount);

// FPMM Buy
const price = event.params.investmentAmount
  .times(COLLATERAL_SCALE)
  .div(event.params.outcomeTokensBought);

// FPMM Sell
const price = event.params.returnAmount
  .times(COLLATERAL_SCALE)
  .div(event.params.outcomeTokensSold);

// Redemption
const price = payoutNumerators[outcomeIndex]
  .times(COLLATERAL_SCALE)
  .div(payoutDenominator);
```

---

## 5. Position Lifecycle

### Overview of Tracked Events

**Source:** `pnl-subgraph/notes.md`
> "Transfers outside of these 5 event type are *not* tracked."

**The 5 Tracked Event Types:**
1. Merges
2. Splits
3. Redemptions
4. Conversions (NegRisk only)
5. OrdersMatched (Exchange fills)

### Event Handling Details

#### A. PositionSplit

**Files:**
- `pnl-subgraph/src/ConditionalTokensMapping.ts`
- `pnl-subgraph/src/NegRiskAdapterMapping.ts`

**Logic:**
```typescript
// Treats as BUY for both outcomes at 50 cents
for (outcomeIndex = 0; outcomeIndex < 2; outcomeIndex++) {
  const positionId = condition.positionIds[outcomeIndex];
  updateUserPositionWithBuy(
    event.params.stakeholder,
    positionId,
    FIFTY_CENTS,
    event.params.amount,
  );
}
```

**PnL Impact:**
- ✅ Increases position amounts for both outcomes
- ✅ Updates avgPrice (blends in 50¢ purchase)
- ✅ Increases totalBought
- ❌ Does NOT trigger realized PnL

**Filter:** NegRiskAdapter skips splits from NEG_RISK_EXCHANGE to avoid double-counting

#### B. PositionsMerge

**Files:**
- `pnl-subgraph/src/ConditionalTokensMapping.ts`
- `pnl-subgraph/src/NegRiskAdapterMapping.ts`

**Logic:**
```typescript
// Treats as SELL for both outcomes at 50 cents
for (outcomeIndex = 0; outcomeIndex < 2; outcomeIndex++) {
  const positionId = condition.positionIds[outcomeIndex];
  updateUserPositionWithSell(
    event.params.stakeholder,
    positionId,
    FIFTY_CENTS,
    event.params.amount,
  );
}
```

**PnL Impact:**
- ✅ Decreases position amounts (with inventory guard)
- ✅ Realizes PnL: `amount × (0.50 - avgPrice) / 1e6`
- ❌ Does NOT update avgPrice (only sells update realized PnL)

**Filter:** NegRiskAdapter skips merges from NEG_RISK_EXCHANGE

#### C. PayoutRedemption

**Files:**
- `pnl-subgraph/src/ConditionalTokensMapping.ts`
- `pnl-subgraph/src/NegRiskAdapterMapping.ts`

**Standard CTF Logic:**
```typescript
const price = payoutNumerators[outcomeIndex]
  .times(COLLATERAL_SCALE)
  .div(payoutDenominator);

updateUserPositionWithSell(
  event.params.redeemer,
  positionId,
  price,
  amount,
);
```

**NegRisk Logic:**
```typescript
// Uses amounts array from event
const price = payoutNumerators[outcomeIndex]
  .times(COLLATERAL_SCALE)
  .div(payoutDenominator);

updateUserPositionWithSell(
  event.params.redeemer,
  positionId,
  price,
  amounts[outcomeIndex],
);
```

**PnL Impact:**
- ✅ Realizes PnL at resolution price
- ✅ Decreases position amounts to zero (typically)
- ❌ Does NOT update avgPrice

**Resolution Price:**
- Binary YES wins: price = 1.00 (1,000,000)
- Binary NO wins: price = 0.00 (0)
- Multi-outcome: price = payoutNumerator / payoutDenominator

#### D. PositionsConverted (NegRisk Only)

**File:** `pnl-subgraph/src/NegRiskAdapterMapping.ts`

**Complex Multi-Step Logic:**

```typescript
// 1. Calculate average NO price across questions
let noCount: i32 = 0;
let avgNoPrice = BigInt.zero();

for (let i: u8 = 0; i < questionCount; i++) {
  const yesPositionId = negRiskEvent.yesPositionIds[i];
  const noPositionId = negRiskEvent.noPositionIds[i];

  if (indexSetContains(indexSet, i)) {
    // This is a NO position
    noCount++;
    const userPosition = loadOrCreateUserPosition(stakeholder, noPositionId);
    avgNoPrice = avgNoPrice.plus(userPosition.avgPrice);
  }
}

if (noCount > 0) {
  avgNoPrice = avgNoPrice.div(BigInt.fromI32(noCount));
}

// 2. Compute YES price from NO prices
const yesPrice = computeNegRiskYesPrice(avgNoPrice, noCount, questionCount);

// 3. Process each question
for (let i: u8 = 0; i < questionCount; i++) {
  const yesPositionId = negRiskEvent.yesPositionIds[i];
  const noPositionId = negRiskEvent.noPositionIds[i];

  if (indexSetContains(indexSet, i)) {
    // Sell NO at its avg cost
    updateUserPositionWithSell(stakeholder, noPositionId, avgNoPrice, amount);

    // Buy YES at computed price
    updateUserPositionWithBuy(stakeholder, yesPositionId, yesPrice, amount);
  }
}
```

**YES Price Formula:**
```typescript
const computeNegRiskYesPrice = (
  noPrice: BigInt,
  noCount: i32,
  questionCount: i32,
): BigInt =>
  noPrice
    .times(BigInt.fromI32(noCount))
    .minus(COLLATERAL_SCALE.times(BigInt.fromI32(noCount - 1)))
    .div(BigInt.fromI32(questionCount - noCount));
```

**Mathematical Expression:**
```
yesPrice = (noPrice × noCount - COLLATERAL_SCALE × (noCount - 1)) / (questionCount - noCount)
```

**PnL Impact:**
- ✅ Realizes PnL on NO sells: `amount × (avgNoPrice - oldAvgPrice) / 1e6`
  - **Special:** Uses avgNoPrice (computed average) NOT market price
  - Result: Often ~zero PnL if positions were acquired at similar prices
- ✅ Updates avgPrice for new YES positions
- ✅ Complex accounting for multi-outcome conversions

#### E. OrderFilled (Exchange)

**File:** `pnl-subgraph/src/ExchangeMapping.ts`

**Trade Type Detection:**
```typescript
const side = event.params.makerAssetId.equals(BigInt.zero())
  ? TradeType.BUY
  : TradeType.SELL;
```

**Logic:**
- If `makerAssetId == 0` → BUY (maker provides USDC, receives tokens)
- If `makerAssetId != 0` → SELL (maker provides tokens, receives USDC)

**Price Calculation:**
```typescript
const price = order.quoteAmount.times(COLLATERAL_SCALE).div(order.baseAmount);
```

**BUY Mapping:**
```
account: maker
baseAmount: takerAmountFilled (tokens received)
quoteAmount: makerAmountFilled (USDC paid)
positionId: takerAssetId
```

**SELL Mapping:**
```
account: maker
baseAmount: makerAmountFilled (tokens sold)
quoteAmount: takerAmountFilled (USDC received)
positionId: makerAssetId
```

**PnL Impact:**
- ✅ BUY: Updates avgPrice, increases position, increases totalBought
- ✅ SELL: Realizes PnL, decreases position (with inventory guard)

#### F. FPMM Buy/Sell

**File:** `pnl-subgraph/src/FixedProductMarketMakerMapping.ts`

**FPMMBuy:**
```typescript
const price = event.params.investmentAmount
  .times(COLLATERAL_SCALE)
  .div(event.params.outcomeTokensBought);

updateUserPositionWithBuy(
  event.params.buyer,
  positionId,
  price,
  event.params.outcomeTokensBought,
);
```

**FPMMSell:**
```typescript
const price = event.params.returnAmount
  .times(COLLATERAL_SCALE)
  .div(event.params.outcomeTokensSold);

updateUserPositionWithSell(
  event.params.seller,
  positionId,
  price,
  event.params.outcomeTokensSold,
);
```

**PnL Impact:**
- ✅ Same as Exchange OrderFilled
- ✅ Fees NOT included in PnL (feeAmount field exists but not used in price)

---

## 6. Data Sources Used

### Indexed Contracts

**Source:** `pnl-subgraph/subgraph.template.yaml`

| Contract | Events Tracked | Purpose |
|----------|---------------|---------|
| **ConditionalTokens** | ConditionPreparation, ConditionResolution, PositionSplit, PositionsMerge, PayoutRedemption | Core CTF events for position lifecycle |
| **Exchange** | OrderFilled | CLOB trades (primary trading venue) |
| **NegRiskExchange** | OrderFilled | CLOB trades for negative risk markets |
| **NegRiskAdapter** | PositionSplit, PositionsMerge, PositionsConverted, PayoutRedemption, MarketPrepared, QuestionPrepared | NegRisk market operations |
| **FixedProductMarketMakerFactory** | FixedProductMarketMakerCreation | AMM pool creation |
| **FixedProductMarketMaker** (template) | FPMMBuy, FPMMSell, FPMMFundingAdded, FPMMFundingRemoved | AMM trades and liquidity |

### Event Field Reference

#### OrderFilled (Exchange/NegRiskExchange)
```
orderHash: bytes32 (indexed)
maker: address (indexed)
taker: address (indexed)
makerAssetId: uint256
takerAssetId: uint256
makerAmountFilled: uint256
takerAmountFilled: uint256
fee: uint256
```

#### PositionSplit (ConditionalTokens)
```
stakeholder: address (indexed)
collateralToken: address
parentCollectionId: bytes32 (indexed)
conditionId: bytes32 (indexed)
partition: uint256[]
amount: uint256
```

#### PositionSplit (NegRiskAdapter)
```
stakeholder: address (indexed)
conditionId: bytes32 (indexed)
amount: uint256
```

#### PositionsMerge (ConditionalTokens)
```
stakeholder: address (indexed)
collateralToken: address
parentCollectionId: bytes32 (indexed)
conditionId: bytes32 (indexed)
partition: uint256[]
amount: uint256
```

#### PositionsMerge (NegRiskAdapter)
```
stakeholder: address (indexed)
conditionId: bytes32 (indexed)
amount: uint256
```

#### PayoutRedemption (ConditionalTokens)
```
redeemer: address (indexed)
collateralToken: address (indexed)
parentCollectionId: bytes32 (indexed)
conditionId: bytes32
indexSets: uint256[]
payout: uint256
```

#### PayoutRedemption (NegRiskAdapter)
```
redeemer: address (indexed)
conditionId: bytes32 (indexed)
amounts: uint256[]
payout: uint256
```

#### PositionsConverted (NegRiskAdapter)
```
stakeholder: address (indexed)
marketId: bytes32 (indexed)
indexSet: uint256 (indexed)
amount: uint256
```

#### ConditionResolution (ConditionalTokens)
```
conditionId: bytes32 (indexed)
oracle: address (indexed)
questionId: bytes32 (indexed)
outcomeSlotCount: uint256
payoutNumerators: uint256[]
```

#### FPMMBuy (FixedProductMarketMaker)
```
buyer: address (indexed)
investmentAmount: uint256
feeAmount: uint256
outcomeIndex: uint256 (indexed)
outcomeTokensBought: uint256
```

#### FPMMSell (FixedProductMarketMaker)
```
seller: address (indexed)
returnAmount: uint256
feeAmount: uint256
outcomeIndex: uint256 (indexed)
outcomeTokensSold: uint256
```

### NOT Indexed

**Critical Limitation:** Direct ERC1155 Transfer events are NOT tracked
- Comment from notes.md: "Transfers outside of these 5 event type are *not* tracked."
- This creates the need for inventory guard (users can receive tokens via transfers)
- External transfers do NOT affect avgPrice or realizedPnl tracking

---

## 7. Schema Definition

### UserPosition Entity

**Source:** `pnl-subgraph/schema.graphql`

```graphql
type UserPosition @entity {
  id: ID!                    # User Address + Token ID
  user: String!              # User Address
  tokenId: BigInt!           # Token ID (position ID)
  amount: BigInt!            # Current holdings (running total)
  avgPrice: BigInt!          # Weighted average cost basis (scaled by 1e6)
  realizedPnl: BigInt!       # Cumulative realized P&L (scaled by 1e6)
  totalBought: BigInt!       # Total amount ever purchased (cumulative)
}
```

**Initial Values:**
```typescript
// From loadOrCreateUserPosition.ts
amount: BigInt.zero()
avgPrice: BigInt.zero()
realizedPnl: BigInt.zero()
totalBought: BigInt.zero()
```

**Field Relationships:**
- `amount` = sum of all buys - sum of all sells (with inventory guard)
- `avgPrice` = weighted average of all buy prices
- `realizedPnl` = sum of all `(sellPrice - avgPrice) × sellAmount / 1e6`
- `totalBought` = sum of all buy amounts (never decreases)

**Unrealized PnL (NOT stored):**
```
unrealizedPnl = amount × (currentPrice - avgPrice) / COLLATERAL_SCALE
```

**Total PnL (NOT stored):**
```
totalPnl = realizedPnl + unrealizedPnl
```

### Supporting Entities

#### Condition
```graphql
type Condition @entity {
  id: ID!                      # conditionId
  positionIds: [BigInt!]!      # tokenIds for each outcome
  payoutNumerators: [BigInt!]! # resolution payouts
  payoutDenominator: BigInt!   # payout denominator
}
```

#### FPMM
```graphql
type FPMM @entity {
  id: ID!                 # FPMM address
  conditionId: String!    # linked condition
}
```

#### NegRiskEvent
```graphql
type NegRiskEvent @entity {
  id: ID!                 # negRiskMarketId
  questionCount: Int!     # number of questions in market
}
```

---

## 8. Key Findings Summary

### Confirmed Implementation Details

| Aspect | Implementation | Status |
|--------|---------------|--------|
| **Inventory Guard** | `adjustedAmount = min(sellAmount, trackedPosition)` | ✅ CONFIRMED |
| **Applies To** | Sells only (not buys) | ✅ CONFIRMED |
| **Realized PnL** | `amount × (sellPrice - avgPrice) / 1e6` | ✅ CONFIRMED |
| **When Realized** | At sell time (not redemption) | ✅ CONFIRMED |
| **Avg Price Method** | Weighted average (not FIFO) | ✅ CONFIRMED |
| **Avg Price Update** | On buys only | ✅ CONFIRMED |
| **Precision** | 6 decimals (1e6 scale) | ✅ CONFIRMED |
| **Rounding** | Integer division (truncates) | ✅ CONFIRMED |
| **Split Treatment** | Buy both outcomes at $0.50 | ✅ CONFIRMED |
| **Merge Treatment** | Sell both outcomes at $0.50 | ✅ CONFIRMED |
| **Redemption** | Sell at resolution price | ✅ CONFIRMED |
| **Transfer Tracking** | Only 5 event types (not raw ERC1155) | ✅ CONFIRMED |

### Critical Business Logic

1. **Inventory Guard Purpose:**
   - Prevents PnL attribution for tokens acquired outside tracked events
   - User could receive tokens via direct ERC1155 transfers
   - Selling those tokens should not affect tracked PnL
   - Clamps sell amount to prevent negative positions

2. **Weighted Average (Not FIFO):**
   - Each buy recalculates blended cost basis
   - Simpler than FIFO queue management
   - Less accurate for tax purposes (FIFO preferred)
   - Easier for UI display (single avgPrice per position)

3. **PnL Realized at Sell Time:**
   - Redemptions are just sells at resolution price
   - Merges are sells at $0.50
   - Conversions sell at avgNoPrice (often ~zero PnL)
   - Total PnL = realized + (amount × (currentPrice - avgPrice) / 1e6)

4. **No Transfer Tracking:**
   - Only 5 event types tracked (see Section 5)
   - Direct ERC1155 transfers NOT indexed
   - Proxy wallet operations NOT tracked
   - This is why inventory guard is necessary

---

## 9. Code Reference Index

### Core Calculation Functions

| Function | File | Purpose |
|----------|------|---------|
| `updateUserPositionWithBuy` | `pnl-subgraph/src/utils/updateUserPositionWithBuy.ts` | Weighted avg price, increase position |
| `updateUserPositionWithSell` | `pnl-subgraph/src/utils/updateUserPositionWithSell.ts` | Realize PnL, inventory guard, decrease position |
| `loadOrCreateUserPosition` | `pnl-subgraph/src/utils/loadOrCreateUserPosition.ts` | Initialize position with zeros |

### Event Handlers

| Function | File | Events Handled |
|----------|------|---------------|
| `handleOrderFilled` | `pnl-subgraph/src/ExchangeMapping.ts` | Exchange/NegRiskExchange OrderFilled |
| `handleBuy` | `pnl-subgraph/src/FixedProductMarketMakerMapping.ts` | FPMM FPMMBuy |
| `handleSell` | `pnl-subgraph/src/FixedProductMarketMakerMapping.ts` | FPMM FPMMSell |
| `handlePositionSplit` | `pnl-subgraph/src/ConditionalTokensMapping.ts` | CTF PositionSplit |
| `handlePositionsMerge` | `pnl-subgraph/src/ConditionalTokensMapping.ts` | CTF PositionsMerge |
| `handlePayoutRedemption` | `pnl-subgraph/src/ConditionalTokensMapping.ts` | CTF PayoutRedemption |
| `handleConditionResolution` | `pnl-subgraph/src/ConditionalTokensMapping.ts` | CTF ConditionResolution |
| `handlePositionSplit` | `pnl-subgraph/src/NegRiskAdapterMapping.ts` | NegRisk PositionSplit |
| `handlePositionsMerge` | `pnl-subgraph/src/NegRiskAdapterMapping.ts` | NegRisk PositionsMerge |
| `handlePositionsConverted` | `pnl-subgraph/src/NegRiskAdapterMapping.ts` | NegRisk PositionsConverted |
| `handlePayoutRedemption` | `pnl-subgraph/src/NegRiskAdapterMapping.ts` | NegRisk PayoutRedemption |

### Utility Functions

| Function | File | Purpose |
|----------|------|---------|
| `parseOrderFilled` | `pnl-subgraph/src/utils/parseOrderFilled.ts` | Extract buy/sell from OrderFilled |
| `computeNegRiskYesPrice` | `pnl-subgraph/src/utils/computeNegRiskYesPrice.ts` | Calculate YES price from NO prices |
| `indexSetContains` | `common/utils/indexSetContains.ts` | Check if outcome in indexSet |
| `computePositionId` | `common/utils/ctf-utils.ts` | Calculate position ID |

### Constants

| Constant | File | Value |
|----------|------|-------|
| `COLLATERAL_SCALE` | `common/constants.template.ts` | `10^6` (1,000,000) |
| `FIFTY_CENTS` | `common/constants.template.ts` | `500,000` |
| `TradeType.BUY` | `common/constants.template.ts` | `0` |
| `TradeType.SELL` | `common/constants.template.ts` | `1` |

---

## 10. Comparison with Cascadian V17 Engine

### Similarities

1. **Realized PnL Formula:** Both use `amount × (sellPrice - avgPrice)`
2. **Precision:** Both use 6-decimal USDC precision
3. **Weighted Average:** Both blend cost basis on buys
4. **Sell-Time Realization:** PnL realized when selling, not redeeming

### Differences

| Aspect | Polymarket Subgraph | Cascadian V17 |
|--------|-------------------|---------------|
| **Inventory Guard** | ✅ Clamps sells to tracked position | ❓ Unknown (needs verification) |
| **Transfer Tracking** | ❌ Only 5 event types | ✅ Full ERC1155 ledger |
| **Data Source** | On-chain events (subgraph) | ClickHouse + CLOB fills |
| **Unrealized PnL** | Not stored (calculate on-demand) | ❓ Unknown (needs verification) |
| **FIFO vs Weighted** | Weighted average | ❓ Unknown (needs verification) |

### Recommendations for Cascadian

1. **Implement Inventory Guard:**
   ```typescript
   const adjustedAmount = Math.min(sellAmount, trackedPosition.amount);
   const deltaPnL = adjustedAmount * (sellPrice - avgPrice) / 1e6;
   ```

2. **Verify Transfer Coverage:**
   - If tracking full ERC1155 ledger, inventory guard may not be needed
   - If using CLOB fills only, MUST implement guard

3. **Document Weighted vs FIFO:**
   - Current V17 implementation method unclear
   - Weighted is simpler but less tax-accurate
   - FIFO requires queue management but more precise

4. **Test Edge Cases:**
   - Zero avgPrice on first sell (should not happen with proper init)
   - Negative avgPrice (impossible with BigInt zero init)
   - Sell amount > tracked amount (guard should prevent)

---

## 11. Next Steps

### Verification Tasks

1. **Check Cascadian Inventory Guard:**
   - Search codebase for `min(sellAmount, position)` pattern
   - Verify if implemented in V17 engine
   - Test with wallet that received external transfers

2. **Verify Weighted vs FIFO:**
   - Examine `scripts/pnl/` implementation
   - Check if avgPrice updated like subgraph
   - Compare with FIFO queue approach

3. **Test PnL Formulas:**
   - Use `test-v17-from-benchmark-table.ts`
   - Compare V17 output vs subgraph formula
   - Identify any discrepancies

4. **Audit Transfer Coverage:**
   - Check if `pm_erc1155_ledger` has all events
   - Verify split/merge/redemption coverage
   - Compare event count vs subgraph

### Implementation Tasks

1. **Add Inventory Guard (if missing):**
   ```sql
   -- In realized PnL calculation
   adjusted_amount = least(sell_amount, position_amount)
   delta_pnl = adjusted_amount * (sell_price - avg_price) / 1000000
   ```

2. **Document Cost Basis Method:**
   - Create `docs/systems/pnl/COST_BASIS_METHOD.md`
   - Explain weighted average vs FIFO
   - Document tax implications

3. **Add Edge Case Tests:**
   - Test external transfer handling
   - Test zero avgPrice scenario
   - Test oversell protection

---

## Appendix A: Complete Code Listings

### updateUserPositionWithBuy.ts (Complete)

```typescript
const updateUserPositionWithBuy = (
  user: Address,
  positionId: BigInt,
  price: BigInt,
  amount: BigInt,
): void => {
  const userPosition = loadOrCreateUserPosition(user, positionId);

  if (amount.gt(BigInt.zero())) {
    // update average price
    // avgPrice = (avgPrice * userAmount + price * buyAmount)
    // / (userAmount + buyAmount)
    const numerator = userPosition.avgPrice
      .times(userPosition.amount)
      .plus(price.times(amount));
    const denominator = userPosition.amount.plus(amount);
    userPosition.avgPrice = numerator.div(denominator);

    // update amount
    userPosition.amount = userPosition.amount.plus(amount);

    // update total bought
    userPosition.totalBought = userPosition.totalBought.plus(amount);

    userPosition.save();
  }
};
```

### updateUserPositionWithSell.ts (Complete)

```typescript
const updateUserPositionWithSell = (
  user: Address,
  positionId: BigInt,
  price: BigInt,
  amount: BigInt,
): void => {
  const userPosition = loadOrCreateUserPosition(user, positionId);

  // use userPosition amount if the amount is greater than the userPosition amount
  // that means the user obtained tokens outside of what we track
  // and we don't want to give them PnL for the extra
  const adjustedAmount = amount.gt(userPosition.amount)
    ? userPosition.amount
    : amount;

  // realizedPnl changes by
  // d = amount * (price - avgPrice)
  const deltaPnL = adjustedAmount
    .times(price.minus(userPosition.avgPrice))
    .div(COLLATERAL_SCALE);

  // update realizedPnl
  userPosition.realizedPnl = userPosition.realizedPnl.plus(deltaPnL);

  // update amount
  userPosition.amount = userPosition.amount.minus(adjustedAmount);
  userPosition.save();
};
```

### loadOrCreateUserPosition.ts (Complete)

```typescript
const loadOrCreateUserPosition = (
  user: Address,
  tokenId: BigInt,
): UserPosition => {
  const userPositionEntityId = getUserPositionEntityId(user, tokenId);
  let userPosition = UserPosition.load(userPositionEntityId);

  if (userPosition == null) {
    userPosition = new UserPosition(userPositionEntityId);
    userPosition.user = user.toHexString();
    userPosition.tokenId = tokenId;
    userPosition.avgPrice = BigInt.zero();
    userPosition.amount = BigInt.zero();
    userPosition.realizedPnl = BigInt.zero();
    userPosition.totalBought = BigInt.zero();
  }

  return userPosition;
};
```

### parseOrderFilled.ts (Complete)

```typescript
const parseOrderFilled = (event: OrderFilled): Order => {
  const side = event.params.makerAssetId.equals(BigInt.zero())
    ? TradeType.BUY
    : TradeType.SELL;

  return side == TradeType.BUY
    ? {
        account: event.params.maker,
        side: TradeType.BUY,
        baseAmount: event.params.takerAmountFilled,
        quoteAmount: event.params.makerAmountFilled,
        positionId: event.params.takerAssetId,
      }
    : {
        account: event.params.maker,
        side: TradeType.SELL,
        baseAmount: event.params.makerAmountFilled,
        quoteAmount: event.params.takerAmountFilled,
        positionId: event.params.makerAssetId,
      };
};
```

### computeNegRiskYesPrice.ts (Complete)

```typescript
const computeNegRiskYesPrice = (
  noPrice: BigInt,
  noCount: i32,
  questionCount: i32,
): BigInt =>
  noPrice
    .times(BigInt.fromI32(noCount))
    .minus(COLLATERAL_SCALE.times(BigInt.fromI32(noCount - 1)))
    .div(BigInt.fromI32(questionCount - noCount));
```

---

## Appendix B: Event Coverage Matrix

| Event Source | Event Type | Buy/Sell | Price | Tracked | Notes |
|-------------|-----------|----------|-------|---------|-------|
| Exchange | OrderFilled | Both | Quote/Base × 1e6 | ✅ | Primary CLOB |
| NegRiskExchange | OrderFilled | Both | Quote/Base × 1e6 | ✅ | NegRisk CLOB |
| FPMM | FPMMBuy | Buy | Investment/Tokens × 1e6 | ✅ | AMM buys |
| FPMM | FPMMSell | Sell | Return/Tokens × 1e6 | ✅ | AMM sells |
| CTF | PositionSplit | Buy | 0.50 (fixed) | ✅ | Both outcomes |
| CTF | PositionsMerge | Sell | 0.50 (fixed) | ✅ | Both outcomes |
| CTF | PayoutRedemption | Sell | Payout/Denom × 1e6 | ✅ | Resolution |
| NegRiskAdapter | PositionSplit | Buy | 0.50 (fixed) | ✅ | Both outcomes, filtered |
| NegRiskAdapter | PositionsMerge | Sell | 0.50 (fixed) | ✅ | Both outcomes, filtered |
| NegRiskAdapter | PayoutRedemption | Sell | Payout/Denom × 1e6 | ✅ | Resolution |
| NegRiskAdapter | PositionsConverted | Both | Complex (see Section 5.D) | ✅ | Multi-outcome |
| ERC1155 | Transfer | N/A | N/A | ❌ | Not tracked! |
| ERC1155 | TransferSingle | N/A | N/A | ❌ | Not tracked! |
| ERC1155 | TransferBatch | N/A | N/A | ❌ | Not tracked! |

---

**Report Prepared By:** Claude Opus 4.5
**Analysis Method:** Direct code extraction from GitHub repository
**Confidence Level:** CONFIRMED (all formulas extracted from source code)
**Repository Version:** As of 2025-12-06
**Repository Commit:** Latest main branch
