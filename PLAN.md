# Copytrading Leaderboard Implementation Plan

## Overview
Create a Top 50 copytrading leaderboard ranked by **Log Growth Per Day** using the last 90 days of data from `pm_trade_fifo_roi_v3_mat_unified_2d_test`.

## Data Source Analysis

**Table:** `pm_trade_fifo_roi_v3_mat_unified_2d_test`
- ~24M trades in 90-day window
- ~34K unique wallets
- Each row = one completed position with:
  - `entry_time` - when trade was entered
  - `resolved_at` - when trade exited (Nullable)
  - `cost_usd` - dollars committed
  - `roi` - return on investment (decimal, e.g., 0.5 = 50%)
  - `pnl_usd` - profit/loss in USD
  - `condition_id` - market identifier
  - `tx_hash` - unique trade identifier

---

## Implementation Steps

### Step 1: Filter to 90-day window
```sql
WHERE entry_time >= now() - INTERVAL 90 DAY
  AND is_closed = 1  -- Only completed positions
```

### Step 2: Wallet filtering criteria (aggregated in 90D)
| Filter | Requirement | Column/Calculation |
|--------|-------------|-------------------|
| Trade count | > 30 trades | `count()` |
| Markets traded | > 7 markets | `countDistinct(condition_id)` |
| Win rate | > 40% | `100 * sum(pnl_usd > 0) / count()` |
| Median ROI | > 10% | `median(roi * 100)` |
| Median bet size | > $5 | `median(cost_usd)` |

### Step 3: Winsorize ROI at 95th percentile
For each wallet, cap `roi` at the wallet's 95th percentile to remove outliers.

### Step 4: Copier Simulation (Core Logic)

**Simulation Parameters:**
- Initial bankroll: `B_0 = $100`
- Bet size: `$2` (constant, > $1 as required)
- Auto-redeem: proceeds return immediately to free cash

**Event Stream Construction:**
For each trade, create 2 events:
1. `(entry_time, 'BUY', tx_hash, roi)`
2. `(resolved_at, 'SELL', tx_hash, roi)`

**Simulation Rules:**
- **On BUY:** If `cash >= 2`, then `cash -= 2`, add position
- **On SELL:** Close position, `cash += 2 * (1 + roi)`

**Output per wallet:**
- `B_T` = Final bankroll
- `trades_copied` = Number of BUYs executed
- `trades_skipped` = Number of BUYs skipped (insufficient cash)
- `first_event_time`, `last_event_time`

### Step 5: Calculate Ranking Metric

```
LogGrowthPerDay = ln(B_T / B_0) / max(1, days_active)

where days_active = (last_event_time - first_event_time) / 86400
```

### Step 6: Output Columns (Top 50)

| # | Column | Description |
|---|--------|-------------|
| 1 | wallet | Wallet Address |
| 2 | log_growth_per_day | Ranking metric (DESC) |
| 3 | simulated_return_pct_day | `(B_T/B_0 - 1) * 100 / days_active` |
| 4 | roi_pct_day | Avg daily ROI from actual trades |
| 5 | trades_per_day | `total_trades / days_active` |
| 6 | final_bankroll | `B_T` |
| 7 | trades_copied | Count of successful copies |
| 8 | trades_skipped | Count of skipped (no cash) |
| 9 | edge_per_trade | Expected value per trade |
| 10 | compounding_score | Measure of reinvestment efficiency |
| 11 | win_rate_pct | Win rate (0-100) |
| 12 | median_roi_pct | Median ROI % (winsorized) |
| 13 | last_trade_date | Date of most recent trade |

---

## ClickHouse Implementation Strategy

### Challenge: Event-level simulation in SQL
ClickHouse doesn't have procedural loops, but we can use `arrayFold` or `arrayReduce` with a custom accumulator.

### Approach: Array-based simulation

```sql
WITH
  -- Step 1: Get qualifying wallets with their trades
  wallet_trades AS (
    SELECT
      wallet,
      groupArray((toFloat64(entry_time), 1, roi, tx_hash)) as buys,  -- (time, type=1=buy, roi, id)
      groupArray((toFloat64(resolved_at), 0, roi, tx_hash)) as sells -- (time, type=0=sell, roi, id)
    FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
    WHERE entry_time >= now() - INTERVAL 90 DAY
      AND is_closed = 1
      AND resolved_at IS NOT NULL
    GROUP BY wallet
    HAVING count() > 30  -- more filters...
  ),

  -- Step 2: Create sorted event stream
  event_stream AS (
    SELECT
      wallet,
      arraySort(x -> x.1, arrayConcat(buys, sells)) as events
    FROM wallet_trades
  ),

  -- Step 3: Simulate with arrayFold
  simulation AS (
    SELECT
      wallet,
      arrayFold(
        (acc, event) -> (
          -- acc: (cash, positions_map, trades_copied, trades_skipped)
          -- event: (time, type, roi, tx_hash)
          -- Complex state management here...
        ),
        events,
        (100.0, [], 0, 0)  -- initial state
      ) as final_state
    FROM event_stream
  )
```

**Complexity:** ClickHouse's `arrayFold` has limitations with complex state (maps).

### Alternative: TypeScript simulation script

Given the complexity of tracking multiple open positions per wallet, a TypeScript script may be cleaner:

```typescript
// For each qualifying wallet:
// 1. Fetch all trades in 90D
// 2. Create event stream (buy/sell events)
// 3. Simulate with position tracking
// 4. Calculate metrics
```

---

## Recommended Implementation Path

### Option A: Pure ClickHouse (complex but fast)
- Use nested arrays and tuple state in `arrayFold`
- Single query, no round-trips
- Harder to debug

### Option B: Hybrid (recommended)
1. **ClickHouse:** Filter wallets and compute basic metrics (win rate, median ROI, etc.)
2. **TypeScript:** Run copier simulation per qualifying wallet
3. **Output:** Combine and rank

### Option C: Simplified ClickHouse simulation
Since we bet $2 on every trade regardless of position overlaps:
- Ignore position tracking complexity
- Assume we always have cash (no skipping)
- `B_T = B_0 + sum(2 * roi)` for all trades
- This overcounts but gives relative ranking

---

## Key Calculations

### Win Rate
```sql
100.0 * countIf(pnl_usd > 0) / count() as win_rate_pct
```

### Median ROI (winsorized)
```sql
median(least(roi, quantile(0.95)(roi))) * 100 as median_roi_pct_winsorized
```

### Edge per Trade
```sql
avg(roi) as edge_per_trade  -- or expectancy calculation
```

### Compounding Score
```sql
-- Ratio of final bankroll to simple sum of returns
ln(B_T / B_0) / ln(1 + sum(roi * 2/100))  -- approximate
```

---

## Next Steps

1. ✅ Understand table schema
2. ✅ Validate filter criteria produce reasonable wallet count
3. ⬜ Implement Option B (Hybrid) or Option C (Simplified)
4. ⬜ Test on sample wallets
5. ⬜ Run full leaderboard generation
6. ⬜ Format output table

---

## Sample Query: Filter Qualifying Wallets

```sql
SELECT
    wallet,
    count() as trade_count,
    countDistinct(condition_id) as markets_traded,
    100.0 * countIf(pnl_usd > 0) / count() as win_rate,
    median(abs(cost_usd)) as median_bet_size,
    median(roi * 100) as median_roi_pct,
    sum(pnl_usd) as total_pnl,
    min(entry_time) as first_trade,
    max(entry_time) as last_trade
FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
WHERE entry_time >= now() - INTERVAL 90 DAY
  AND is_closed = 1
GROUP BY wallet
HAVING trade_count > 30
   AND markets_traded > 7
   AND win_rate > 40
   AND median_roi_pct > 10
   AND median_bet_size > 5
ORDER BY total_pnl DESC
LIMIT 100
```
