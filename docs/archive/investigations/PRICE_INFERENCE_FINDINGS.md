# Price-Based Resolution Inference: Investigation Findings

## Executive Summary

**Status:** ❌ **APPROACH NOT VIABLE** with current data structure

**Accuracy:** 30% (needs >90% to be useful)

**Root Cause:** market_candles_5m stores aggregated market prices, not individual outcome token prices

---

## What We Tested

### Theory
When a binary market resolves:
- Winning outcome token → $1.00
- Losing outcome token → $0.00

We hypothesized that final price data could infer resolutions for markets without payout vectors.

### Implementation
Used `market_resolutions_final` (218k rows) joined to `market_candles_5m` via `condition_market_map`

### Results
- **Accuracy:** 30% (6/20 correct predictions)
- **Found:** 50 markets with both resolution + price data
- **Coverage potential:** 70.5% of 151k priced markets show extreme prices (>0.95 or <0.05)

---

## Why It Failed

### Data Structure Issue

**market_candles_5m schema:**
```
market_id | bucket | open | high | low | close | volume
```

This stores **MARKET-LEVEL aggregated prices**, not individual outcome token prices.

For a binary market "Will Trump win?":
- market_candles_5m.close = aggregated market price (0-1)
- Does NOT show: YES token price vs NO token price separately

**Example failure:**
- Market resolved: YES wins (outcome_index = 0)
- Expected final price: 1.0
- Actual final price: 0.35
- **Why?** The "close" price is the market aggregate, not the YES token specifically

### What We Actually Need

**Option 1: Token-level price data**
```sql
condition_id | outcome_index | final_price | timestamp
```
Where each row = individual outcome token's price

**Option 2: Trade-level inference**
Use `fact_trades_clean` which HAS outcome_index + price:
```sql
SELECT
  cid,
  outcome_index,
  avg(price) as final_price
FROM fact_trades_clean
WHERE block_time > (SELECT max(block_time) - INTERVAL 24 HOUR FROM fact_trades_clean WHERE cid = ?)
GROUP BY cid, outcome_index
```

Then check:
- If outcome 0 final trades ≈ $1 AND outcome 1 ≈ $0 → YES won
- If outcome 0 ≈ $0 AND outcome 1 ≈ $1 → NO won

---

## Revised Approach: Trade-Based Resolution Inference

### Algorithm

1. **Find markets without resolutions**
2. **Get final 24h trades for each outcome**
3. **Calculate average trade price per outcome**
4. **Apply inference rules:**
   ```
   If outcome[0].avg_price > 0.95 AND outcome[1].avg_price < 0.05:
     → Winner = 0 (YES)

   If outcome[0].avg_price < 0.05 AND outcome[1].avg_price > 0.95:
     → Winner = 1 (NO)

   Confidence = min(abs(winner_price - 1.0), abs(loser_price - 0.0))
   ```

5. **Only accept if:**
   - Confidence >= 0.90 (final trades within $0.10 of expected)
   - At least 5 trades in final 24h
   - Market has been inactive for 7+ days (likely resolved)

### Estimated Coverage

From trade data analysis:
- 157M rows in `vw_trades_canonical`
- Can infer resolutions for markets with:
  - Recent trading activity (to get final prices)
  - Clear price convergence (one outcome → $1, other → $0)

**Conservative estimate:** 20-40% of the 171k markets without payouts could be recovered

---

## Implementation Status

### Completed
- ✅ Validated theory against known resolutions
- ✅ Identified data structure issue
- ✅ Found alternative data source (fact_trades_clean)

### Next Steps
1. Build trade-based resolution inference script
2. Validate accuracy on known resolutions (target: >90%)
3. If successful, create view `vw_resolutions_inferred_from_trades`
4. Insert high-confidence inferences into resolution tables

### SQL Preview
```sql
CREATE VIEW vw_resolutions_inferred_from_trades AS
WITH
final_trades AS (
  SELECT
    cid,
    outcome_index,
    avg(toFloat64(price)) as avg_price,
    count() as trade_count,
    max(block_time) as last_trade_time
  FROM fact_trades_clean
  WHERE block_time > (
    SELECT max(block_time) - INTERVAL 24 HOUR
    FROM fact_trades_clean ft2
    WHERE ft2.cid = fact_trades_clean.cid
  )
  GROUP BY cid, outcome_index
),
clear_winners AS (
  SELECT
    cid,
    outcome_index as winning_outcome,
    avg_price as confidence
  FROM final_trades
  WHERE avg_price > 0.95
    AND cid IN (
      SELECT cid FROM final_trades WHERE outcome_index != winning_outcome AND avg_price < 0.05
    )
    AND trade_count >= 5
)
SELECT
  cid as condition_id,
  winning_outcome,
  confidence,
  'trade_inference' as source
FROM clear_winners
WHERE confidence >= 0.90;
```

---

## Conclusion

**Price inference from market_candles_5m:** ❌ Not viable (30% accuracy)

**Trade inference from fact_trades_clean:** ⏳ Promising alternative, needs validation

**Recommendation:** Implement trade-based approach and re-test accuracy before deploying
