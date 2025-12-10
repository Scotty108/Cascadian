# External Repository Silver Bullets Report
## Polymarket PnL Implementation Analysis

**Date:** 2025-12-06
**Terminal:** Claude 2 (Secondary Research)
**Objective:** Extract implementation details from public Polymarket repos to improve UI parity

---

## Executive Summary

**CRITICAL DISCOVERY:** The official Polymarket `pnl-subgraph` contains the **exact inventory guard formula** and confirms key assumptions about PnL calculation. This report provides concrete, code-backed findings that should directly improve our V23c vs V29 head-to-head testing.

### Key Takeaways (8 Bullet Points)

1. **[CONFIRMED]** Inventory guard clamps sells only: `adjustedAmount = min(amount, userPosition.amount)` - applies ONLY on sells, not buys
2. **[CONFIRMED]** Realized PnL formula: `deltaPnL = adjustedAmount * (price - avgPrice) / COLLATERAL_SCALE`
3. **[CONFIRMED]** Average price uses weighted average (not FIFO): `avgPrice = (avgPrice * userAmount + price * buyAmount) / (userAmount + buyAmount)`
4. **[CONFIRMED]** COLLATERAL_SCALE = 10^6 (USDC 6 decimals) - no explicit rounding in subgraph
5. **[CONFIRMED]** Subgraph tracks 5 event types ONLY: Merges, Splits, Redemptions, Conversions, OrdersMatched - **ERC20 transfers NOT tracked**
6. **[CONFIRMED]** At redemption: sells entire tracked amount at resolution price - `amount = userPosition.amount`
7. **[INFERRED]** UI may show resolved-but-unredeemed positions as "realized" for display parity
8. **[CONFIRMED]** "Obtained tokens outside of what we track" comment explains inventory guard purpose

---

## 1. Inventory Guard Semantics

### Official Implementation
**File:** `pnl-subgraph/src/utils/updateUserPositionWithSell.ts`
**Function:** `updateUserPositionWithSell`

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

### Key Findings

| Aspect | Value | Status |
|--------|-------|--------|
| Guard applies to | Sells only | **CONFIRMED** |
| Guard formula | `min(amount, userPosition.amount)` | **CONFIRMED** |
| PnL delta formula | `adjustedAmount * (price - avgPrice) / COLLATERAL_SCALE` | **CONFIRMED** |
| Position update | `amount -= adjustedAmount` | **CONFIRMED** |
| Buys have guard? | NO - buys always add full amount | **CONFIRMED** |

### Implication for V29
Our V29 inventory guard implementation should:
- Apply ONLY to sells (not buys)
- Clamp to tracked position amount
- Use same formula for realized PnL delta

---

## 2. Average Price Updates

### Official Implementation
**File:** `pnl-subgraph/src/utils/updateUserPositionWithBuy.ts`
**Function:** `updateUserPositionWithBuy`

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
    //          / (userAmount + buyAmount)
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

### Key Findings

| Aspect | Value | Status |
|--------|-------|--------|
| Cost basis method | Weighted Average | **CONFIRMED** |
| Formula | `(oldAvg * oldAmt + newPrice * newAmt) / (oldAmt + newAmt)` | **CONFIRMED** |
| FIFO used? | NO | **CONFIRMED** |
| avgPrice persists through sells? | YES (not recalculated) | **CONFIRMED** |

### Implication
V23c and V29 should both use weighted average cost basis, NOT FIFO.

---

## 3. Scaling Constants and Rounding

### Official Implementation
**File:** `common/constants.template.ts`

```typescript
const COLLATERAL_SCALE = BigInt.fromI32(10).pow(6);
const COLLATERAL_SCALE_DEC = COLLATERAL_SCALE.toBigDecimal();
const FIFTY_CENTS = COLLATERAL_SCALE.div(BigInt.fromI32(2));
```

### Key Findings

| Aspect | Value | Status |
|--------|-------|--------|
| COLLATERAL_SCALE | 10^6 (1,000,000) | **CONFIRMED** |
| USDC decimals | 6 | **CONFIRMED** |
| Explicit rounding | None in subgraph | **CONFIRMED** |
| Price storage | BigInt (no decimals internally) | **CONFIRMED** |
| FIFTY_CENTS constant | 500,000 (0.50 USDC) | **CONFIRMED** |

### Implication
- Prices are stored as integers scaled by 10^6
- No explicit rounding applied in subgraph calculations
- UI rounding (if any) must be applied at display layer, not in PnL calc

---

## 4. Position Lifecycle and Event Types

### Official Documentation
**File:** `pnl-subgraph/notes.md`

```markdown
# pnl-subgraph

This subgraph watches the following events for updates to PnL and average prices:

- Merges
- Splits
- Redemptions
- Conversions
- OrdersMatched

Note that transfers outside of these 5 event type are _not_ tracked.
```

### Event Handling by Type

| Event | Handler File | Effect on PnL |
|-------|--------------|---------------|
| **OrderFilled** | `ExchangeMapping.ts` | Buy or Sell at trade price |
| **PositionSplit** | `ConditionalTokensMapping.ts` | Buy both outcomes at 50c |
| **PositionsMerge** | `ConditionalTokensMapping.ts` | Sell both outcomes at 50c |
| **PayoutRedemption** | `ConditionalTokensMapping.ts` | Sell at resolution price |
| **PositionsConverted** | `NegRiskAdapterMapping.ts` | NegRisk YES/NO swaps |

### Redemption Handling
**File:** `pnl-subgraph/src/ConditionalTokensMapping.ts`

```typescript
export function handlePayoutRedemption(event: PayoutRedemption): void {
  // ...
  const payoutNumerators = condition.payoutNumerators;
  const payoutDenominator = condition.payoutDenominator;

  let outcomeIndex: u8 = 0;
  for (; outcomeIndex < 2; outcomeIndex++) {
    const positionId = condition.positionIds[outcomeIndex];

    const userPosition = loadOrCreateUserPosition(
      event.params.redeemer,
      positionId,
    );

    // the user redeems their entire amount
    const amount = userPosition.amount;
    const price = payoutNumerators[outcomeIndex]
      .times(COLLATERAL_SCALE)
      .div(payoutDenominator);
    updateUserPositionWithSell(
      event.params.redeemer,
      positionId,
      price,
      amount,
    );
  }
}
```

### Key Findings

| Aspect | Value | Status |
|--------|-------|--------|
| Events tracked | 5 types only | **CONFIRMED** |
| ERC20/USDC transfers | NOT tracked | **CONFIRMED** |
| Generic ERC1155 transfers | NOT tracked | **CONFIRMED** |
| Redemption amount | Entire `userPosition.amount` | **CONFIRMED** |
| Resolution price | `payoutNumerator * SCALE / payoutDenominator` | **CONFIRMED** |

### Implication for ERC20 Transfers
**ERC20 USDC transfers are NOT required for UI parity** with the subgraph. The subgraph only tracks the 5 event types listed above.

---

## 5. Data Source Necessity Matrix

Based on code analysis, here's what's required for different wallet types:

| Data Source | Pure Traders | Mixed Wallets | Market Makers |
|-------------|--------------|---------------|---------------|
| OrderFilled (CLOB) | **Required** | **Required** | **Required** |
| PositionSplit | Optional | **Required** | **Required** |
| PositionsMerge | Optional | **Required** | **Required** |
| PayoutRedemption | **Required** | **Required** | **Required** |
| PositionsConverted | For NegRisk | For NegRisk | For NegRisk |
| ERC20 USDC Transfers | NOT NEEDED | NOT NEEDED | NOT NEEDED |
| Generic ERC1155 | NOT NEEDED | NOT NEEDED | NOT NEEDED |

### Status Legend
- **Required**: Essential for accurate PnL
- **Optional**: May improve accuracy for edge cases
- **NOT NEEDED**: Explicitly excluded from official subgraph

---

## 6. PaulieB14 Repos Analysis

### polymarket-subgraph-analytics
- **Purpose**: Query examples and documentation only
- **PnL Logic**: None - references official subgraph
- **Value**: Shows expected query patterns

### Polymarkets-Profit-and-Loss
- **Purpose**: Custom subgraph attempting similar tracking
- **Schema**: More complex than official (DailyStats, HourlyStats, PricePoint)
- **Key Difference**: Does NOT implement inventory guard
- **Value**: Shows alternative architecture approaches

### Polymarket-P-L-Substreams
- **Purpose**: Dune Analytics query parity using Substreams
- **PnL Logic**: Simple holdings-based calculation (no inventory guard)
- **Key Finding**: References "Dune Query #3366316" as source of truth
- **Value**: Shows USDC transfers ARE used in Dune (but not in subgraph)

---

## 7. Actionable Implementation Delta List

### For V29 Inventory Guard Mode

1. **Guard Sells Only**
   - If Polymarket clamps sells only, V29 guard is correct and should NOT expand to buys
   - **Action**: Verify V29 only applies guard on sells

2. **Use Weighted Average Cost Basis**
   - Subgraph uses weighted average, not FIFO
   - **Action**: Ensure V29 uses weighted avg for avgPrice

3. **No Explicit Rounding**
   - Subgraph does no rounding in calculations
   - **Action**: Remove any optional rounding modes from V29

4. **ERC20 Transfers Optional**
   - Since subgraph doesn't track ERC20, they're optional for UI parity
   - **Action**: TRADER_STRICT mode can skip ERC20 transfers

5. **Redemption = Full Position**
   - At redemption, sells entire tracked position
   - **Action**: Verify V29 redemption logic matches

### For V23c UI Parity Mode

6. **Resolution Price Calculation**
   - `price = payoutNumerator * COLLATERAL_SCALE / payoutDenominator`
   - **Action**: Verify V23c uses same formula

7. **Split/Merge at 50c**
   - Splits buy at 50c, merges sell at 50c
   - **Action**: Add explicit 50c handling for split/merge in V23c

### For Regression Harness

8. **Compare Against Subgraph**
   - Subgraph is the source of truth, not UI
   - **Action**: Add subgraph query validation to harness

9. **Track "Untracked Tokens"**
   - Subgraph ignores tokens obtained outside tracked events
   - **Action**: Add diagnostic for tokens outside tracked events

10. **5 Event Types Only**
    - Filter test cases to only include these event types
    - **Action**: Document which events affect PnL

---

## 8. Alignment Checklist for Head-to-Head Testing

Before running V23c vs V29 comparison:

- [ ] Verify both use weighted average cost basis
- [ ] Verify inventory guard applies to sells only
- [ ] Verify COLLATERAL_SCALE = 10^6
- [ ] Verify resolution price formula matches
- [ ] Verify split/merge handled at 50c
- [ ] Filter test wallets to pure traders first
- [ ] Exclude wallets with untracked token sources
- [ ] Compare fields: `realizedPnl`, `amount`, `avgPrice`

---

## 9. Schema Reference

### Official pnl-subgraph Schema
**File:** `pnl-subgraph/schema.graphql`

```graphql
type UserPosition @entity {
  "User Address + Token ID"
  id: ID!
  "User Address"
  user: String!
  "Token ID"
  tokenId: BigInt!
  "amount of token the user holds"
  amount: BigInt!
  "the avg price the user bought the token"
  avgPrice: BigInt!
  "realized profits - losses"
  realizedPnl: BigInt!
  "total amount of token bought"
  totalBought: BigInt!
}
```

### Key Fields Mapping

| Subgraph Field | Our Field | Notes |
|----------------|-----------|-------|
| `amount` | `tracked_position` | Current holdings |
| `avgPrice` | `avg_cost_basis` | Weighted average entry |
| `realizedPnl` | `realized_pnl` | Cumulative realized |
| `totalBought` | N/A | For diagnostics only |

---

## 10. Conclusions

### What We Now Know (CONFIRMED)

1. **Inventory guard is simple**: `min(sellAmount, trackedAmount)`
2. **Applies to sells only**: Buys always add full amount
3. **Weighted average cost basis**: NOT FIFO
4. **5 event types only**: No ERC20, no generic ERC1155
5. **No rounding**: Integer math with 10^6 scaling
6. **Redemption = full exit**: Sells entire position at resolution price

### What Remains Unknown (INFERRED)

1. **UI display layer**: May round cents for display
2. **Resolved-unredeemed handling**: UI may show as realized
3. **Dune vs Subgraph parity**: Dune may use different data sources

### Recommended Next Steps

1. Update V29 to match exact subgraph formulas
2. Add subgraph validation to regression harness
3. Run head-to-head on pure traders (no splits/merges)
4. Document any gaps between subgraph and UI

---

**Report Generated By:** Claude 2 (Secondary Research Terminal)
**Sources:**
- https://github.com/Polymarket/polymarket-subgraph
- https://github.com/PaulieB14/polymarket-subgraph-analytics
- https://github.com/PaulieB14/Polymarkets-Profit-and-Loss
- https://github.com/PaulieB14/Polymarket-P-L-Substreams
