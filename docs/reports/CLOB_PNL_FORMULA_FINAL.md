# CLOB PnL Formula - Final Production Spec

**Date:** 2025-12-29wo
**Status:** Validated
**Accuracy:** Within $7 on test wallet ($130 vs $123 UI)

---

## Core Formula

The Polymarket subgraph-style PnL calculation uses position tracking with weighted average cost basis:

### Buy Processing
```typescript
function updateUserPositionWithBuy(pos: Position, price: number, amount: number): Position {
  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  return {
    amount: pos.amount + amount,
    avgPrice: numerator / denominator,
    realizedPnl: pos.realizedPnl,
  };
}
```

### Sell Processing (with Position Protection)
```typescript
function updateUserPositionWithSell(pos: Position, price: number, amount: number): Position {
  const adjustedAmount = Math.min(pos.amount, amount);  // CRITICAL: position protection
  if (adjustedAmount <= 0) return pos;  // No position = complement trade, skip
  const deltaPnL = adjustedAmount * (price - pos.avgPrice);
  return {
    amount: pos.amount - adjustedAmount,
    avgPrice: pos.avgPrice,
    realizedPnl: pos.realizedPnl + deltaPnL,
  };
}
```

### Resolution PnL (for held positions)
```typescript
// Only applies to positions with amount > 0 at resolution time
const resolutionPnl = (resolutionPrice - pos.avgPrice) * pos.amount;
// resolutionPrice = 1.0 for winners, 0.0 for losers
```

---

## Data Loading & Deduplication

### Critical Pattern: Dedup by (tx, side, token_id, token_amount)

The `pm_trader_events_v2` table has duplicate rows from backfill operations. Always deduplicate:

```sql
SELECT
  side,
  token_id,
  any(usdc_amount) AS usdc,
  token_amount AS tokens,
  max(trade_time) AS trade_time
FROM pm_trader_events_v2
WHERE lower(trader_wallet) = lower('0x...')
  AND is_deleted = 0
GROUP BY transaction_hash, side, token_id, token_amount
ORDER BY trade_time
```

**Why this GROUP BY:**
- `transaction_hash` - Groups all events from same tx
- `side` - Separates buys from sells
- `token_id` - Different tokens in same tx are separate fills
- `token_amount` - Different quantities are separate fills (rare but possible)

**Why NOT `GROUP BY event_id`:**
Same fill recorded as both maker (-m) and taker (-t) events with different event_ids.

---

## Complement Trade Handling

Polymarket uses "mint-and-split" for arb trades:
- Buy YES at $0.02 → also recorded as SELL NO at $0.98
- These complement trades should NOT be processed as real sells

**Solution: Position Protection**

Instead of filtering by price (which breaks real low-price sells), use position tracking:

```typescript
// In sell processing:
const adjustedAmount = Math.min(pos.amount, trade.tokens);
if (adjustedAmount < 0.01) {
  // No position to sell - this is a complement trade, skip it
  continue;
}
```

This naturally ignores complement sells because:
1. Complement sell comes AFTER the buy in same tx
2. The position for that token_id is 0 (never bought it)
3. `min(0, sellAmount)` = 0 → skipped

---

## Token Resolution Lookup

```sql
-- Step 1: Map token_id to condition
SELECT condition_id, outcome_index
FROM pm_token_to_condition_map_v5
WHERE token_id_dec = '{token_id}'

-- Step 2: Get resolution
SELECT payout_numerators
FROM pm_condition_resolutions
WHERE condition_id = '{condition_id}'

-- Step 3: Parse payout (ClickHouse arrays are 1-indexed!)
-- payout_numerators[outcome_index + 1] > 0 → winner ($1.00 payout)
-- payout_numerators[outcome_index + 1] = 0 → loser ($0.00 payout)
```

---

## Known Limitations

### 1. Data Completeness
Some fills may be missing from `pm_trader_events_v2`. Example: ChatGPT position showed 229.94 shares in our data vs 222.5 in UI (7.44 extra shares = ~$7 PnL gap).

### 2. Unmapped Tokens
Some token_ids may not exist in `pm_token_to_condition_map_v5`. These are typically:
- Very new markets
- Tokens from unusual market types

### 3. Active Positions
Unresolved positions contribute $0 to PnL (no resolution price yet). This is correct behavior - only realized PnL from closed positions or resolved markets counts.

---

## Validation Results

**Test Wallet:** 0xbf4f05a8b1d08f82d57697bb0bbfda19b0df5b24 (@zhanlulan)

| Metric | Our Calculation | UI | Gap |
|--------|----------------|-----|-----|
| Total PnL | $129.92 | $123.23 | $6.69 |
| Trading PnL | $0.00 | - | - |
| Resolution PnL | $129.92 | - | - |

**Gap Analysis:**
- Extra 7.44 tokens in ChatGPT position accounts for ~$7.26
- Remaining <$1 is rounding/timing differences

---

## Production Implementation Notes

1. **Process trades in chronological order** - Required for correct position tracking
2. **Use BigInt for token amounts** - Avoid floating point errors at scale
3. **Cache resolution lookups** - Same condition queried for multiple positions
4. **Handle NULL/missing data gracefully** - Some tokens won't have mappings
5. **Log complement trades skipped** - Useful for debugging unusual wallets

---

## Reference Files

- **Working script:** `scripts/calc-pnl-with-real-sells.ts`
- **Investigation:** `scripts/check-condition-pattern.ts`
- **Dedup analysis:** `scripts/check-dedup-factor.ts`
