# Polymarket Neg Risk Formulas - Quick Reference

**Source:** [Polymarket polymarket-subgraph](https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph)
**Date:** January 8, 2026

---

## Constants

```javascript
COLLATERAL_SCALE = 1000000  // Represents $1.00 in 6-decimal USDC
FIFTY_CENTS = 500000        // Represents $0.50
```

---

## Core Formulas

### 1. Weighted Average Cost Basis

```javascript
new_avgPrice = (old_avgPrice × old_amount + buy_price × buy_amount)
             / (old_amount + buy_amount)
```

**Used when:** Buying additional tokens of a position you already hold

---

### 2. Realized PnL on Sell

```javascript
// Cap amount to prevent external token PnL
adjustedAmount = min(sell_amount, position.amount)

// Calculate PnL delta
deltaPnL = adjustedAmount × (sell_price - avgPrice) / COLLATERAL_SCALE

// Update cumulative realized PnL
realizedPnL = realizedPnL + deltaPnL

// Reduce position
amount = amount - adjustedAmount
```

**Key Protection:** Only credit PnL for tokens we tracked being bought

---

### 3. CLOB Trade Price

```javascript
price = (quote_amount × COLLATERAL_SCALE) / base_amount
```

**Example:**
Buy 100 shares for 65 USDC
→ price = (65 × 1,000,000) / 100 = 650,000 = $0.65 per share

---

### 4. Neg Risk Synthetic YES Price

**THE CRITICAL FORMULA for bundled trades:**

```javascript
yesPrice = (noPrice × noCount - COLLATERAL_SCALE × (noCount - 1))
         / (questionCount - noCount)
```

**Parameters:**
- `noPrice` = Average cost basis of NO positions being converted (from userPosition.avgPrice)
- `noCount` = Number of NO positions being converted
- `questionCount` = Total number of questions/outcomes in Neg Risk market

**Example 1:** 2-outcome market (standard case)
```javascript
noPrice = 500000      // $0.50
noCount = 1
questionCount = 2

yesPrice = (500000 × 1 - 1000000 × 0) / (2 - 1)
         = 500000 / 1
         = 500000  // $0.50
```

**Example 2:** 3-outcome market
```javascript
noPrice = 500000      // $0.50
noCount = 2
questionCount = 3

yesPrice = (500000 × 2 - 1000000 × 1) / (3 - 2)
         = (1000000 - 1000000) / 1
         = 0  // $0.00
```

**Example 3:** 4-outcome market
```javascript
noPrice = 500000      // $0.50
noCount = 3
questionCount = 4

yesPrice = (500000 × 3 - 1000000 × 2) / (4 - 3)
         = (1500000 - 2000000) / 1
         = -500000  // -$0.50 (NEGATIVE price = cost basis credit)
```

**Note:** Negative prices are CORRECT. They represent a cost basis adjustment.

---

### 5. Redemption Price

```javascript
price = (payoutNumerators[outcomeIndex] × COLLATERAL_SCALE) / payoutDenominator
```

**Example:** Binary market resolves YES
- YES: price = 100 × 1,000,000 / 100 = 1,000,000 = $1.00
- NO: price = 0 × 1,000,000 / 100 = 0 = $0.00

---

## Event-Specific Pricing Table

| Event Type | Price Formula | Example |
|------------|--------------|---------|
| **Position Split** | FIFTY_CENTS for each outcome | $0.50 |
| **Position Merge** | FIFTY_CENTS for each outcome | $0.50 |
| **CLOB Trade** | quote_amount × 1000000 / base_amount | Buy 100 @ 65 USDC = $0.65 |
| **Neg Risk Conversion (NO)** | userPosition.avgPrice | $0.50 (typical) |
| **Neg Risk Conversion (YES)** | Synthetic formula (see #4) | Varies by noCount |
| **Redemption** | payout_numerator × 1000000 / payout_denominator | $1.00 (winning) or $0.00 (losing) |

---

## Neg Risk Conversion Flow

**What happens when you convert in a 2-outcome Neg Risk market:**

### Initial State (after split)
```
Split 100 USDC:
  → BUY 100 YES @ $0.50 (cost: $50)
  → BUY 100 NO @ $0.50 (cost: $50)
Total cost: $100
```

### Conversion (bundle to pure position)
```
Convert: Sell NO, keep YES:
  1. SELL 100 NO @ $0.50
     - deltaPnL = 100 × ($0.50 - $0.50) = $0
     - NO position → 0

  2. Calculate synthetic YES price:
     - noPrice = $0.50
     - noCount = 1
     - questionCount = 2
     - yesPrice = ($0.50 × 1 - $1.00 × 0) / (2 - 1) = $0.50

  3. BUY 100 YES @ $0.50
     - new avgPrice = ($0.50 × 100 + $0.50 × 100) / 200 = $0.50
     - YES position: 200 @ $0.50
```

### Result
```
Final position: 200 YES @ $0.50 cost basis
Net cost: $100 (paid $100, recovered $0)
```

---

## Key Implementation Rules

### 1. Cost Basis is ALWAYS $0.50 for Splits
**There is NO "cheap outcome bought at $0.001"** in Polymarket's accounting!
- ALL outcomes in a bundle are recorded at $0.50 each
- This is the TRUE cost basis from the user's perspective
- The synthetic price formula handles value recovery automatically

### 2. Selling at Cost Basis → Zero PnL
```javascript
deltaPnL = amount × (avgPrice - avgPrice) / 1000000 = 0
```
This is used in Neg Risk conversions to "close out" NO positions without affecting PnL.

### 3. Synthetic Price Can Be Negative
This represents a **cost basis credit** when you recover more value than expected.

### 4. Cap Sell Amount to Position Size
```javascript
adjustedAmount = min(sell_amount, position.amount)
```
This prevents crediting PnL for tokens obtained outside tracked events.

---

## Common Scenarios

### Scenario 1: Simple Neg Risk Trade (2-outcome)
1. Buy bundle: YES @ $0.50, NO @ $0.50 → cost $1.00
2. Convert: Sell NO @ $0.50 (PnL=$0), Buy YES @ $0.50
3. Result: 2 YES @ $0.50 avg = $1.00 total cost ✓

### Scenario 2: Buy Bundle, Sell High Side, Hold Low Side
1. Buy bundle: YES @ $0.50, NO @ $0.50 → cost $1.00
2. CLOB sell YES @ $0.90 → realize $0.40 profit
3. Hold NO @ $0.50 cost basis
4. If NO wins, redeem @ $1.00 → realize $0.50 profit
5. Total PnL: $0.90 ✓

### Scenario 3: Buy on CLOB (no bundling)
1. CLOB buy YES @ $0.75 → cost $0.75
2. CLOB sell YES @ $0.85 → realize $0.10 profit
3. Simple cost basis tracking, no synthetic prices needed ✓

---

## When to Use Each Formula

| Situation | Formula |
|-----------|---------|
| Tracking cost basis for new buys | Weighted average (#1) |
| Calculating PnL on sells | Realized PnL formula (#2) |
| Processing CLOB trades | CLOB price formula (#3) |
| Processing Neg Risk conversions | Synthetic YES price (#4) |
| Processing redemptions | Redemption price (#5) |
| Processing splits/merges | Use FIFTY_CENTS constant |

---

## Critical Notes

1. **UserPosition Schema:**
   - `amount`: Current holdings
   - `avgPrice`: Weighted average cost basis
   - `realizedPnl`: Cumulative realized PnL
   - `totalBought`: Cumulative purchases (for tracking)

2. **Unrealized PnL** (not in subgraph, calculated client-side):
   ```javascript
   unrealizedPnL = amount × (current_price - avgPrice) / COLLATERAL_SCALE
   ```

3. **Total PnL:**
   ```javascript
   totalPnL = realizedPnL + unrealizedPnL
   ```

---

## References

- **Full Analysis:** `/docs/reports/POLYMARKET_NEG_RISK_ANALYSIS.md`
- **Source Code:** [Polymarket polymarket-subgraph](https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph)
- **Key Files:**
  - `pnl-subgraph/src/NegRiskAdapterMapping.ts` - Neg Risk conversion handler
  - `pnl-subgraph/src/utils/computeNegRiskYesPrice.ts` - Synthetic price formula
  - `pnl-subgraph/src/utils/updateUserPositionWithBuy.ts` - Cost basis update
  - `pnl-subgraph/src/utils/updateUserPositionWithSell.ts` - Realized PnL calculation
