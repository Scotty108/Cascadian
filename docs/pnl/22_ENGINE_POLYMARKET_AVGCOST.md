# Engine: Polymarket-Accurate Weighted Average (polymarket_avgcost_v1)

**Version:** v1
**Status:** NEW - Matches Polymarket subgraph specification
**Files:** `lib/pnl/polymarketAccurateEngine.ts`
**Source:** https://github.com/Polymarket/polymarket-subgraph/tree/f5a074a5a3b7622185971c5f18aec342bcbe96a6/pnl-subgraph

---

## Algorithm

### Event Sources

| Event | Source Table | PnL Treatment |
|-------|-------------|---------------|
| OrderFilled (CLOB) | pm_trader_events_v2 | Buy/Sell at trade price |
| PositionSplit | pm_ctf_events | BUY at $0.50 |
| PositionsMerge | pm_ctf_events | SELL at $0.50 |
| PayoutRedemption | pm_ctf_events | SELL at resolution price |

### Position State

Per Polymarket's schema:

```typescript
interface PositionState {
  tokenId: string;
  amount: number;      // Current token balance
  avgPrice: number;    // Weighted average cost (0-1)
  realizedPnl: number; // Cumulative realized PnL
  totalBought: number; // Total tokens ever bought
}
```

### Buy Logic (Weighted Average)

```typescript
function updatePositionWithBuy(position, amount, price) {
  if (amount <= 0) return position;

  // Weighted average cost basis
  const numerator = position.avgPrice * position.amount + price * amount;
  const denominator = position.amount + amount;
  const newAvgPrice = numerator / denominator;

  return {
    ...position,
    amount: position.amount + amount,
    avgPrice: newAvgPrice,
    totalBought: position.totalBought + amount,
  };
}
```

### Sell Logic (Clamped)

```typescript
function updatePositionWithSell(position, amount, price) {
  // CRITICAL: Cap at tracked position balance
  const adjustedAmount = Math.min(amount, position.amount);

  if (adjustedAmount <= 0) return position;

  // Realized PnL = shares × (sell price - avg cost)
  const deltaPnl = adjustedAmount * (price - position.avgPrice);

  return {
    ...position,
    amount: position.amount - adjustedAmount,
    realizedPnl: position.realizedPnl + deltaPnl,
  };
}
```

---

## Key Differences from Previous Engines

| Aspect | maker_fifo_v1 | v19b_v1 | polymarket_avgcost_v1 |
|--------|---------------|---------|----------------------|
| Cost basis | FIFO | Cash flow | **Weighted Average** |
| Trades | Maker only | CLOB only | **All OrderFilled** |
| Splits | ❌ | ❌ | ✅ at $0.50 |
| Merges | ❌ | ❌ | ✅ at $0.50 |
| Redemptions | ❌ | ❌ | ✅ at resolution |
| Sell clamp | ❌ | ❌ | ✅ to position.amount |

---

## Data Loading Queries

### CLOB Trades

```sql
WITH deduped AS (
  SELECT
    event_id,
    any(token_id) as token_id,
    any(side) as side,
    any(token_amount) / 1000000.0 as tokens,
    any(usdc_amount) / 1000000.0 as usdc,
    any(trade_time) as trade_time
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) = lower('0x...')
    AND is_deleted = 0
  GROUP BY event_id
)
SELECT * FROM deduped ORDER BY trade_time
```

### CTF Events

```sql
SELECT
  event_type,
  condition_id,
  toFloat64(amount_or_payout) / 1000000.0 as amount,
  event_timestamp
FROM pm_ctf_events
WHERE lower(user_address) = lower('0x...')
  AND is_deleted = 0
ORDER BY event_timestamp
```

---

## Processing Order

1. Load all CLOB trades (deduped)
2. Load all CTF events
3. Combine and sort by timestamp
4. Process in chronological order:
   - BUY → update avgPrice via weighted average
   - SELL → realize PnL, clamp to position.amount

---

## Expected Improvements

Based on Polymarket's algorithm:
- Taker trades now included → no more "ghost buys"
- Splits/merges tracked → correct cost basis for all acquisitions
- Sell clamping → no "free money" from untracked tokens
- Weighted average → matches UI calculation method

---

## Validation Required

Before using for exports:

1. [ ] Playwright UI truth extraction working
2. [ ] 20+ wallet spot check passes
3. [ ] Pass rate ≥80% within ±10% of UI
4. [ ] No false positives (positive engine, negative UI)

---

## Usage

```typescript
import { computePolymarketPnl } from '@/lib/pnl/polymarketAccurateEngine';

const result = await computePolymarketPnl('0x1234...');
console.log(result.realizedPnl);
console.log(result.unrealizedPnl);
console.log(result.totalPnl);
```

Or via router:

```typescript
import { computePnL } from '@/lib/pnl/engineRouter';

const result = await computePnL(wallet, 'polymarket_avgcost_v1');
```
