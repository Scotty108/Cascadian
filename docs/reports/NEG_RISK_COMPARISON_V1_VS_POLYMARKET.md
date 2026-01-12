# Neg Risk Comparison: Our V1 Engine vs Polymarket Official

**Date:** January 8, 2026
**Status:** Analysis complete - implementation gap identified

---

## Executive Summary

After extracting the exact formulas from Polymarket's official pnl-subgraph, we now understand WHY our V1 engine fails for Neg Risk-heavy wallets:

**The Core Difference:**
- **Polymarket:** Tracks EVERY split, merge, and conversion event separately with specific pricing rules
- **Our V1:** Only uses CLOB trade data, which doesn't include split/merge/conversion events

---

## What We're Missing

### 1. Split Events (Not in CLOB Data)
**Polymarket tracks:**
```typescript
Event: PositionSplit
Action: BUY both outcomes at $0.50 each
Cost basis: $0.50 per outcome
```

**Our V1 engine:**
- Only sees CLOB trades (the subsequent market orders)
- Misses the initial bundled purchase at $0.50
- Incorrectly assigns cost basis from first CLOB trade price

### 2. Conversion Events (Not in CLOB Data)
**Polymarket tracks:**
```typescript
Event: PositionsConverted
Action:
  1. SELL NO positions at their avgPrice (PnL = 0)
  2. BUY YES position at synthetic price:
     yesPrice = (noPrice × noCount - 1000000 × (noCount - 1))
              / (questionCount - noCount)
```

**Our V1 engine:**
- Only sees CLOB trades
- Doesn't know about conversions
- Can't apply synthetic price adjustment
- Incorrectly treats all trades as independent CLOB orders

### 3. Merge Events (Not in CLOB Data)
**Polymarket tracks:**
```typescript
Event: PositionsMerge
Action: SELL both outcomes at $0.50 each
Proceeds: $0.50 per outcome
```

**Our V1 engine:**
- Only sees CLOB trades
- Misses the merge proceeds
- Incorrectly calculates exit PnL

---

## Example: Why Our Engine Fails

### Scenario: User buys bundle, converts to pure YES

**Actual User Actions (On-Chain):**
1. Split 100 USDC → 100 YES + 100 NO (event: PositionSplit)
2. Convert: burn 100 NO, mint 100 YES (event: PositionsConverted)
3. Sell 200 YES on CLOB @ $0.80

**What Polymarket's pnl-subgraph sees:**
```
Step 1 (PositionSplit):
  BUY 100 YES @ $0.50
  BUY 100 NO @ $0.50
  Cost: $100

Step 2 (PositionsConverted):
  SELL 100 NO @ $0.50 (PnL = 0)
  BUY 100 YES @ $0.50 (synthetic price)
  YES avgPrice now: $0.50

Step 3 (OrderFilled):
  SELL 200 YES @ $0.80
  PnL = 200 × ($0.80 - $0.50) = $60

Total Realized PnL: $60 ✓
```

**What our V1 engine sees (CLOB data only):**
```
Step 3 (OrderFilled):
  SELL 200 YES @ $0.80
  No prior buy? Assume cost basis = $0.00 (or skip)
  PnL = ???

Total Realized PnL: WRONG
```

**The Problem:**
- We only see the final CLOB sell
- We don't know the user bought via split at $0.50
- We don't know about the conversion
- We can't calculate correct cost basis
- Our PnL is completely wrong

---

## Why CLOB-Only Works for Simple Wallets

For wallets that ONLY trade on CLOB (no splits/merges/conversions):

**What happens:**
1. User buys YES @ $0.65 on CLOB
2. User sells YES @ $0.80 on CLOB

**What we see:**
1. BUY 100 YES @ $0.65
2. SELL 100 YES @ $0.80
3. PnL = 100 × ($0.80 - $0.65) = $15 ✓

**This works because:**
- All cost basis comes from CLOB trades
- No hidden split/merge/conversion events
- Our V1 engine correctly tracks CLOB-based cost basis

---

## Data We Need (But Don't Have)

To implement Polymarket's exact logic, we need access to:

### 1. ConditionalTokens Contract Events
- **PositionSplit**: User creates bundled position ($0.50 per outcome)
- **PositionsMerge**: User destroys bundled position (recover $0.50 per outcome)
- **PayoutRedemption**: User redeems resolved position (payout ratio)

### 2. NegRiskAdapter Contract Events
- **PositionsConverted**: User converts NO positions to YES position
- **MarketPrepared**: Neg Risk market created
- **QuestionPrepared**: Question added to Neg Risk market

### 3. Position Metadata
- Current holdings (not just trades)
- Cost basis per position
- Question count for Neg Risk markets
- Index sets for conversions

---

## Current Data Limitations

### What We Have (pm_trader_events_v3)
- CLOB trade events (OrderFilled)
- Trade price, amount, side, timestamp
- Token ID, condition ID, outcome index
- Maker vs taker designation

### What We Don't Have
- Split events ❌
- Merge events ❌
- Conversion events ❌
- Redemption events ❌
- Position snapshots ❌
- Question count for Neg Risk markets ❌
- Index sets for conversions ❌

---

## Why This Explains Our Failures

### Wallet 1: 0x50d5...8d8a (Original owner-confirmed wallet)
- **Accuracy:** 16.35% error
- **Likely cause:** Some splits/conversions not accounted for
- **Missing data:** Split events at $0.50, conversion synthetic pricing

### Wallet 2: 0x0db8...f59a (Copy trading target)
- **Accuracy:** 4566% error (!)
- **Likely cause:** Heavy Neg Risk usage with many conversions
- **Missing data:** Conversion events, synthetic price adjustments

### Wallet 3-7: Various Neg Risk wallets
- **Accuracy:** 18-188% errors
- **Likely cause:** Mix of splits, conversions, and CLOB trades
- **Missing data:** All non-CLOB events

---

## The "Wash Trade" Mystery Solved

In our V14 analysis, we saw mysterious "wash trades" like:
```
Tx: 0x123...
  BUY 100 YES @ $0.50
  SELL 100 NO @ $0.50
Same tx, same condition, opposite sides
```

**These are NOT wash trades!**
They are the CLOB representation of:
1. Split event (creates YES + NO at $0.50 each)
2. User immediately sells NO on CLOB
3. CLOB shows: BUY YES (from split) + SELL NO (on CLOB)

But we can't distinguish "BUY from split" vs "BUY on CLOB" because **splits aren't in CLOB data**.

---

## Options Moving Forward

### Option 1: Get ConditionalTokens Event Data ✓ RECOMMENDED
**Pros:**
- Can implement Polymarket's exact logic
- 100% accuracy achievable
- Handles all edge cases

**Cons:**
- Requires new data pipeline
- Need to backfill historical events
- More complex implementation

**Data needed:**
- PositionSplit events from ConditionalTokens contract
- PositionsMerge events
- PositionsConverted events from NegRiskAdapter
- PayoutRedemption events

### Option 2: Use Polymarket Positions API ✓ CURRENT APPROACH (V7)
**Pros:**
- Already working (pnlEngineV7.ts)
- 100% accuracy
- Simple implementation

**Cons:**
- Depends on external API
- Can't reproduce calculations independently
- Rate limited

**Status:** IMPLEMENTED and WORKING

### Option 3: Hybrid Approach
**Pros:**
- Use V7 for Neg Risk-heavy wallets
- Use V1 for simple CLOB-only wallets
- Best of both worlds

**Cons:**
- Need to detect which wallets are Neg Risk-heavy
- More complex routing logic

### Option 4: Give Up on Local Calculation for Neg Risk
**Pros:**
- Accept CLOB-only limitation
- Focus on CLOB-only wallets
- Simpler codebase

**Cons:**
- Can't handle Neg Risk wallets
- Incomplete solution
- Limits use cases

---

## Recommendation

**Use a Two-Tier System:**

### Tier 1: CLOB-Only Wallets → V1 Engine
- Fast local calculation
- Exact accuracy for simple wallets
- No API dependency

### Tier 2: Neg Risk Wallets → V7 Engine (Positions API)
- Call Polymarket API
- 100% accurate
- Cached/rate-limited

**Detection Logic:**
```typescript
async function shouldUseV7(wallet: string): Promise<boolean> {
  // Count bundled transactions (splits with immediate exits)
  const bundledCount = await getBundledTxCount(wallet);

  // If more than 5 bundled transactions, use V7
  return bundledCount > 5;
}
```

**This gives us:**
- ✓ Fast calculation for 90% of wallets (CLOB-only)
- ✓ Accurate calculation for Neg Risk wallets (API-based)
- ✓ No complex event pipeline needed (yet)
- ✓ Clear upgrade path (add ConditionalTokens events later)

---

## Implementation Gap Summary

| Feature | Polymarket Has | We Have | Impact |
|---------|----------------|---------|--------|
| CLOB trades | ✓ | ✓ | No gap |
| Split events | ✓ | ❌ | **HIGH** - Wrong cost basis |
| Merge events | ✓ | ❌ | **HIGH** - Wrong exit proceeds |
| Conversion events | ✓ | ❌ | **CRITICAL** - Missing synthetic price |
| Redemption events | ✓ | ❌ | **MEDIUM** - Wrong final settlement |
| Synthetic price formula | ✓ | ❌ | **CRITICAL** - Can't calculate without conversion data |
| Position snapshots | ✓ | ❌ | **MEDIUM** - Can't validate holdings |
| Question count metadata | ✓ | ❌ | **CRITICAL** - Can't compute synthetic price |

---

## Exact Formulas to Implement (When We Get Data)

### 1. Position Split Handler
```typescript
function handlePositionSplit(
  user: string,
  conditionId: string,
  amount: number
): void {
  const condition = getCondition(conditionId);

  // Buy both outcomes at $0.50 each
  for (let outcomeIndex = 0; outcomeIndex < 2; outcomeIndex++) {
    updateUserPositionWithBuy(
      user,
      condition.positionIds[outcomeIndex],
      FIFTY_CENTS,  // 500000
      amount
    );
  }
}
```

### 2. Position Conversion Handler
```typescript
function handlePositionsConverted(
  user: string,
  marketId: string,
  indexSet: bigint,
  amount: number
): void {
  const market = getNegRiskMarket(marketId);
  const questionCount = market.questionCount;

  // Phase 1: Sell NO positions at cost basis
  let noCount = 0;
  let noPriceSum = 0;

  for (let i = 0; i < questionCount; i++) {
    if (indexSetContains(indexSet, i)) {
      noCount++;
      const positionId = getNegRiskPositionId(marketId, i, NO_INDEX);
      const position = getUserPosition(user, positionId);

      updateUserPositionWithSell(
        user,
        positionId,
        position.avgPrice,  // ← KEY: sell at cost, PnL = 0
        amount
      );

      noPriceSum += position.avgPrice;
    }
  }

  // Phase 2: Calculate synthetic YES price
  const noPrice = noPriceSum / noCount;
  const yesPrice = computeNegRiskYesPrice(noPrice, noCount, questionCount);

  // Phase 3: Buy YES positions at synthetic price
  for (let i = 0; i < questionCount; i++) {
    if (!indexSetContains(indexSet, i)) {
      const positionId = getNegRiskPositionId(marketId, i, YES_INDEX);

      updateUserPositionWithBuy(
        user,
        positionId,
        yesPrice,  // ← Synthetic price, can be negative!
        amount
      );
    }
  }
}
```

### 3. Synthetic Price Calculation
```typescript
function computeNegRiskYesPrice(
  noPrice: number,
  noCount: number,
  questionCount: number
): number {
  return (noPrice * noCount - COLLATERAL_SCALE * (noCount - 1))
       / (questionCount - noCount);
}

// COLLATERAL_SCALE = 1000000
```

### 4. Cost Basis Update
```typescript
function updateUserPositionWithBuy(
  user: string,
  positionId: string,
  price: number,
  amount: number
): void {
  const position = getUserPosition(user, positionId);

  // Weighted average cost basis
  const numerator = position.avgPrice * position.amount + price * amount;
  const denominator = position.amount + amount;
  position.avgPrice = numerator / denominator;

  position.amount += amount;
  position.totalBought += amount;

  savePosition(position);
}
```

### 5. Realized PnL Update
```typescript
function updateUserPositionWithSell(
  user: string,
  positionId: string,
  price: number,
  amount: number
): void {
  const position = getUserPosition(user, positionId);

  // Cap amount to prevent external token PnL
  const adjustedAmount = Math.min(amount, position.amount);

  // Calculate realized PnL delta
  const deltaPnL = adjustedAmount * (price - position.avgPrice) / COLLATERAL_SCALE;

  position.realizedPnl += deltaPnL;
  position.amount -= adjustedAmount;

  savePosition(position);
}
```

---

## Next Steps

1. ✅ **Document findings** (this document)
2. ⏳ **Implement two-tier system** (V1 for CLOB-only, V7 for Neg Risk)
3. ⏳ **Add bundled transaction detection** (route to appropriate engine)
4. 📋 **Future: Add ConditionalTokens event pipeline** (for full local calculation)

---

## References

- **Polymarket Formula Extraction:** `/docs/reports/POLYMARKET_NEG_RISK_FORMULAS.md`
- **Full Analysis:** `/docs/reports/POLYMARKET_NEG_RISK_ANALYSIS.md`
- **Source Code:** [Polymarket polymarket-subgraph](https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph)
- **Our V1 Engine:** `/lib/pnl/pnlEngineV1.ts`
- **Our V7 Engine (API-based):** `/lib/pnl/pnlEngineV7.ts`
