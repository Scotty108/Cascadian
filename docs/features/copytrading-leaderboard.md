# Copytrading Leaderboard Documentation

## Overview

This document describes the methodology for generating a Top 50 copytrading leaderboard ranked by **LogGrowthPerDay** using wallet trading data from the last 90 days.

## Data Source

- **Table:** `pm_trade_fifo_roi_v3_mat_unified`
- **Time Window:** Last 90 days
- **Trade Type:** Closed trades only (`is_closed = 1`, `resolved_at IS NOT NULL`)
- **Position Type:** Long positions only (`cost_usd > 0`)

## Ranking Metric

**LogGrowthPerDay** is the primary ranking metric:

```
LogGrowthPerDay = ln(B_T / B_0) / max(1, days_active)
```

Where:
- `B_0` = Initial bankroll ($1,000)
- `B_T` = Final bankroll after simulation
- `days_active` = Days between first and last trade in the 90-day window

---

## Filter Pipeline (Steps 1-8)

### Step 1: Restrict to Last 90 Days
```sql
WHERE entry_time >= now() - INTERVAL 90 DAY
  AND cost_usd > 0        -- Long positions only
  AND is_closed = 1       -- Resolved trades only
  AND resolved_at IS NOT NULL
```

### Step 2: > 35 Trades
Keep only wallets with more than 35 total trades in the 90-day window.
```sql
HAVING count() > 35
```

### Step 3: > 8 Markets Traded
Keep only wallets that traded more than 8 unique markets (condition_ids).
```sql
HAVING uniqExact(condition_id) > 8
```

### Step 4: Active in Last 10 Days
At least one trade in the last 10 days.
```sql
HAVING max(entry_time) >= now() - INTERVAL 10 DAY
```

### Step 5: > 5 Days Wallet Age
Wallet must have been active for more than 5 days (time between first and last trade).
```sql
HAVING dateDiff('day', min(entry_time), max(entry_time)) > 5
```

### Step 6: Win Rate > 30%
Win rate calculated as wins / (wins + losses) where:
- Win: `roi > 0`
- Loss: `roi <= 0`
```sql
HAVING wins * 100.0 / (wins + losses) > 30
```

### Step 7: Median ROI > 20%
Median ROI across all trades must exceed 20%.
```sql
HAVING median(roi) > 0.20
```

### Step 8: Median Bet Size > $10
Median trade size (cost_usd) must exceed $10.
```sql
HAVING median(cost_usd) > 10
```

---

## ROI Winsorization (Step 9)

To reduce the impact of outliers, ROI values are capped at the 95th percentile for each wallet:

```sql
-- Calculate p95 per wallet
quantile(0.95)(roi) AS roi_p95

-- Apply cap to each trade
least(roi, roi_p95) AS winsorized_roi
```

### Additional Metrics Computed:
- **Median Win ROI:** `medianIf(roi, roi > 0)` - Median ROI among winning trades
- **Median Loss Magnitude:** `medianIf(abs(roi), roi <= 0)` - Median absolute ROI among losing trades

---

## Copytrading Simulation (Step 10)

### Simulation Parameters
| Parameter | Value | Description |
|-----------|-------|-------------|
| `bet_size` | $2.00 | Fixed amount per copied trade |
| `initial_bankroll` | $1,000 | Starting capital |
| `auto_redeem` | Enabled | Proceeds immediately available |

### Simulation Logic

**Event-Based Model:**
Each trade generates two events:
1. **BUY** at `entry_time`: Cash decreases by `bet_size`
2. **SELL** at `resolved_at`: Cash increases by `bet_size * (1 + roi)`

**Event Processing (Chronological Order):**
```
For each event in time order:
  If BUY:
    If cash >= bet_size:
      cash -= bet_size
      open_positions += 1
      trades_copied += 1
    Else:
      trades_skipped += 1

  If SELL:
    If open_positions > 0:
      cash += bet_size * (1 + winsorized_roi)
      open_positions -= 1
```

### No-Skip Guarantee

We verified that with sufficient initial bankroll ($1,000,000), **all 1,249 qualified wallets have 0 trades skipped**. This proves the simulation can copy all trades with adequate capital.

### Mathematical Equivalence

With fixed `bet_size` and no trades skipped, the simulation result equals:
```
FinalBankroll = InitialBankroll + bet_size * SUM(winsorized_roi)
```

This is used for efficient calculation since the event-based simulation produces identical results when no trades are skipped.

---

## Output Columns (Step 12)

| # | Column | Formula | Description |
|---|--------|---------|-------------|
| 1 | Wallet Address | `wallet` | Full wallet address |
| 2 | LogGrowthPerDay | `ln(final/initial) / days` | **Ranking metric** |
| 3 | Sim Return %/day | `((final/initial) - 1) * 100 / days` | Daily percentage return |
| 4 | ROI %/day | `(sum_roi/trades) * 100 * trades_per_day` | Total ROI % per day |
| 5 | Trades/day | `total_trades / days_active` | Trading frequency |
| 6 | FinalBankroll | `initial + bet_size * sum_roi` | Ending balance |
| 7 | TradesCopied | `total_trades` | Number of trades copied |
| 8 | TradesSkipped | `0` | Skipped trades (verified 0) |
| 9 | Edge/trade | `win_rate * med_win - loss_rate * med_loss` | Expected value per trade |
| 10 | CompoundingScore | `LogGrowthPerDay * trades_per_day` | Growth rate adjusted for frequency |
| 11 | Win Rate % | `wins / (wins + losses) * 100` | Win percentage |
| 12 | Median ROI % | `median(winsorized_roi) * 100` | Median return (capped at p95) |
| 13 | Last Trade | `max(entry_time)` | Most recent trade date |

---

## Filter Funnel Results (as of 2026-01-29)

| Step | Filter | Wallets Remaining |
|------|--------|-------------------|
| 1 | Last 90 days | 215,202 |
| 2 | > 35 trades | 74,449 |
| 3 | > 8 markets | 69,734 |
| 4 | Active in 10 days | 62,909 |
| 5 | > 5 days age | 58,502 |
| 6 | Win rate > 30% | 45,964 |
| 7 | Median ROI > 20% | 3,545 |
| 8 | Median bet > $10 | **1,249** |

---

## Important Notes

### Why Only Closed Trades?
- Open positions have unknown outcomes
- Including them would require mark-to-market assumptions
- Closed trades provide definitive ROI values

### Why Winsorize at p95?
- Prevents single outlier trades from dominating rankings
- More robust measure of consistent performance
- Standard practice in financial analysis

### Why Fixed $2 Bet Size?
- Normalizes comparison across wallets
- Represents minimum practical trade size (> $1)
- Eliminates bet-sizing skill from ranking (focuses on trade selection)

### Compounding Clarification
With fixed bet size, "compounding" refers to **cash flow management** (auto-redeem returns cash immediately for new trades), not position-size scaling. The simulation verifies sufficient capital to never skip trades.

---

## Usage

Run the leaderboard script:
```bash
npx tsx scripts/copytrading-leaderboard.ts
```

Output files:
- `copytrading_leaderboard_top50_v2.csv` - CSV export
- Console output with summary statistics

---

## Related Files

- `scripts/copytrading-leaderboard.ts` - Main leaderboard script
- `lib/clickhouse/client.ts` - ClickHouse connection
- `pm_trade_fifo_roi_v3_mat_unified` - Source table (FIFO trade data)
