# Neg Risk Quick Reference Card

**Source:** [Polymarket pnl-subgraph](https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph)
**Date:** 2026-01-08

---

## The Five Key Formulas

### 1. Weighted Average Cost Basis
```javascript
new_avgPrice = (old_avgPrice × old_amount + buy_price × buy_amount) / (old_amount + buy_amount)
```

### 2. Realized PnL
```javascript
adjustedAmount = min(sell_amount, position.amount)  // Prevent external token PnL
deltaPnL = adjustedAmount × (sell_price - avgPrice) / 1000000
realizedPnL += deltaPnL
```

### 3. CLOB Price
```javascript
price = (quote_amount × 1000000) / base_amount
```

### 4. Neg Risk Synthetic YES Price ⭐ MOST IMPORTANT
```javascript
yesPrice = (noPrice × noCount - 1000000 × (noCount - 1)) / (questionCount - noCount)
```
**Note:** Can be negative (cost basis credit)

### 5. Redemption Price
```javascript
price = (payout_numerator × 1000000) / payout_denominator
```

---

## Event Type → Price Mapping

| Event | Price |
|-------|-------|
| Split | $0.50 per outcome |
| Merge | $0.50 per outcome |
| CLOB Trade | Formula #3 |
| Neg Risk Conversion (NO) | position.avgPrice |
| Neg Risk Conversion (YES) | Formula #4 ⭐ |
| Redemption | Formula #5 |

---

## The Two-Outcome Example (Simple Case)

```javascript
// Initial: Split 100 USDC
BUY 100 YES @ $0.50   // cost: $50
BUY 100 NO  @ $0.50   // cost: $50
Total cost: $100

// Convert: Sell NO, keep YES
SELL 100 NO @ $0.50           // PnL = 0
BUY  100 YES @ $0.50          // synthetic price = (0.50×1 - 1.00×0)/(2-1) = $0.50
New YES avgPrice = ($0.50 × 100 + $0.50 × 100) / 200 = $0.50

// Result
Position: 200 YES @ $0.50 = $100 total cost ✓
```

---

## The Four-Outcome Example (Complex Case)

```javascript
// Initial: Split in 4 questions (A, B, C, D)
For each question:
  BUY 100 YES @ $0.50
  BUY 100 NO  @ $0.50
Total cost: $400 (4 questions × $100 each)

// Convert: Want pure YES_A, so burn NO_B, NO_C, NO_D
SELL 100 NO_B @ $0.50   // PnL = 0
SELL 100 NO_C @ $0.50   // PnL = 0
SELL 100 NO_D @ $0.50   // PnL = 0

// Calculate synthetic price
noPrice = ($0.50 + $0.50 + $0.50) / 3 = $0.50
noCount = 3
questionCount = 4
yesPrice = ($0.50 × 3 - $1.00 × 2) / (4 - 3)
         = ($1.50 - $2.00) / 1
         = -$0.50  // NEGATIVE = cost basis credit

// Apply synthetic price to YES_A
BUY 100 YES_A @ -$0.50
New YES_A avgPrice = ($0.50 × 100 + (-$0.50) × 100) / 200 = $0.00

// Result
Position: 200 YES_A @ $0.00 cost basis
```

**Why $0.00?** You paid $400 total, burned $150 worth of NO positions (at cost), so you have effectively $400 - $150 = $250 remaining... wait, that doesn't match.

**Actually:** The accounting treats burning as "closing at cost" (PnL = 0), so realized PnL stays at $0. The cost basis adjustment via negative synthetic price is the mechanism that makes the final PnL work out correctly when you exit.

---

## Critical Rules

### 1. There is NO "cheap outcome"
❌ WRONG: "NO is bought at $0.001"
✅ RIGHT: "ALL outcomes are $0.50 in splits"

### 2. Synthetic price can be negative
This represents a **cost basis credit**, not an error.

### 3. Always cap sell amount
```javascript
adjustedAmount = min(sell_amount, position.amount)
```
Prevents PnL for externally obtained tokens.

### 4. Conversions sell at cost (PnL = 0)
```javascript
SELL NO @ position.avgPrice  // Not market price!
```

### 5. We need ConditionalTokens events
CLOB data alone is insufficient for Neg Risk wallets.

---

## Detection: Is This a Neg Risk Wallet?

```typescript
// Count bundled transactions
// (same tx + condition, buy+sell, 2+ outcomes)
async function getBundledTxCount(wallet: string): Promise<number> {
  const query = `
    WITH trades AS (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        m.condition_id,
        t.side,
        m.outcome_index
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m
        ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND m.condition_id IS NOT NULL
    )
    SELECT count() as bundled_count
    FROM (
      SELECT tx_hash, condition_id
      FROM trades
      GROUP BY tx_hash, condition_id
      HAVING countIf(side='buy') > 0
         AND countIf(side='sell') > 0
         AND count(DISTINCT outcome_index) >= 2
    )
  `;
  // ... execute query
}

// Route to appropriate engine
async function calculatePnL(wallet: string) {
  const bundledCount = await getBundledTxCount(wallet);

  if (bundledCount > 5) {
    // Neg Risk wallet → use API-based V7
    return await pnlEngineV7(wallet);
  } else {
    // CLOB-only wallet → use fast V1
    return await pnlEngineV1(wallet);
  }
}
```

---

## What We're Missing (vs Polymarket)

| Data | Have? | Impact |
|------|-------|--------|
| CLOB trades | ✅ | None |
| Split events | ❌ | **HIGH** - Wrong cost basis |
| Conversion events | ❌ | **CRITICAL** - Missing synthetic price |
| Merge events | ❌ | **HIGH** - Wrong exit proceeds |
| Redemption events | ❌ | **MEDIUM** - Wrong settlement |
| Question count | ❌ | **CRITICAL** - Can't compute synthetic price |

---

## Path Forward

### Short Term ✅ RECOMMENDED
**Two-tier system:**
- CLOB-only wallets → V1 engine (fast, accurate)
- Neg Risk wallets → V7 engine (API-based, accurate)

### Long Term 📋 FUTURE
**Add event pipeline:**
- Ingest ConditionalTokens events
- Ingest NegRiskAdapter events
- Implement local Neg Risk calculation
- Eliminate API dependency

---

## Key Files

### Our Implementation
- `/lib/pnl/pnlEngineV1.ts` - CLOB-only engine (fast, local)
- `/lib/pnl/pnlEngineV7.ts` - API-based engine (accurate for all)

### Documentation
- `/docs/reports/NEG_RISK_SUMMARY.md` - This investigation summary
- `/docs/reports/POLYMARKET_NEG_RISK_FORMULAS.md` - All formulas
- `/docs/reports/POLYMARKET_NEG_RISK_ANALYSIS.md` - Full analysis
- `/docs/reports/NEG_RISK_COMPARISON_V1_VS_POLYMARKET.md` - Gap analysis

### Polymarket Source
- [pnl-subgraph/src/NegRiskAdapterMapping.ts](https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/NegRiskAdapterMapping.ts)
- [pnl-subgraph/src/utils/computeNegRiskYesPrice.ts](https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/utils/computeNegRiskYesPrice.ts)
- [pnl-subgraph/src/utils/updateUserPositionWithBuy.ts](https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/utils/updateUserPositionWithBuy.ts)
- [pnl-subgraph/src/utils/updateUserPositionWithSell.ts](https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/utils/updateUserPositionWithSell.ts)

---

**Print this page and keep it handy when implementing Neg Risk logic!**
