# Copytrading Leaderboard Documentation

## Overview

This document describes the methodology for generating the copytrading leaderboard ranked by **Cost-Weighted Daily Log Growth** using wallet trading data.

## Current Version: v25

**Last Updated:** 2026-02-03

## Data Source

- **Table:** `pm_trade_fifo_roi_v3_mat_unified`
- **Trade Type:** Closed trades only (`is_closed = 1`, `resolved_at IS NOT NULL`)
- **Position Type:** Long positions only (`is_short = 0`, `cost_usd > 0`)

### Why Exclude Shorts?

**CRITICAL:** The `is_short = 1` positions in our FIFO tables are **data artifacts**, not real Polymarket short positions.

**Background:** Our FIFO cron only uses CLOB data (`source = 'clob'`). When a wallet:
1. Deposits $1 collateral → gets 1 YES + 1 NO token via CTF split
2. Sells the YES token on CLOB

The FIFO cron sees: 0 buys, 1 sell → net = -1 → `is_short = 1`

**Reality:** The wallet legitimately obtained the YES token via CTF. Polymarket's official PnL subgraph explicitly caps sells to tracked buys and ignores "extra" tokens:

```typescript
// From Polymarket's pnl-subgraph
// "we don't want to give them PnL for the extra"
const adjustedAmount = amount.gt(userPosition.amount)
  ? userPosition.amount
  : amount;
```

Our PnL V1 engine handles this correctly by including CTF sources. The 34M "shorts" are excluded from leaderboard calculations.

---

## Ranking Metric

**Cost-Weighted Winsorized Daily Log Growth (14d)** is the primary ranking metric:

```
CW Daily Log Growth = CW Winsorized Log Growth Per Trade × Trades Per Active Day
```

Where:
- `CW Winsorized Log Growth` = Cost-weighted average of winsorized log returns
- `Trades Per Active Day` = `total_trades / trading_days` (days with at least 1 trade)

### Why Cost-Weighted?

Simple average log growth treats all trades equally, which allows "penny lottery" trades to dominate:
- A $0.36 trade with 10x return contributes as much as a $10,000 trade
- Analysis found **24.3%** of v24 wallets had >50% of log return from penny trades
- **604 wallets** passed raw >10% filter but had NEGATIVE cost-weighted log growth

Cost-weighting ensures larger trades have proportionally larger impact on the ranking metric.

### Formula

```sql
-- v25: Cost-weighted winsorized log growth
sum(cost_usd * log1p(greatest(
  least(pnl_usd / cost_usd, roi_ceiling),    -- Cap at 97.5%
  greatest(roi_floor, -0.99)                  -- Floor at 2.5%
))) / sum(cost_usd) as cw_winsorized_log_growth
```

---

## Filter Pipeline (v25)

### Step 1: Markets > 10
Keep only wallets that traded more than 10 unique markets (condition_ids).
```sql
WHERE is_short = 0  -- Exclude artifacts
HAVING countDistinct(condition_id) > 10
```
**Purpose:** Ensure diversification, filter out single-market specialists.

### Step 2: Buy Trade in Last 5 Days
At least one trade in the last 5 calendar days.
```sql
WHERE entry_time >= now() - INTERVAL 5 DAY
  AND is_short = 0
```
**Purpose:** Ensure wallet is still actively trading.

### Step 3: Median Bet > $10 (CHANGED from v24)
Median trade size (cost_usd) must exceed $10.
```sql
HAVING quantile(0.5)(cost_usd) > 10
```
**Purpose:** Filter out micro-traders. Median is more robust to outliers than average.

### Step 4: CW Winsorized Log Growth (All Time) > 10% (CHANGED from v24)
Cost-weighted winsorized log growth must exceed 10%.
```sql
HAVING sum(cost_usd * log1p(greatest(
  least(pnl_usd / cost_usd, roi_ceiling),
  greatest(roi_floor, -0.99)
))) / sum(cost_usd) > 0.10
```
**Purpose:** Ensure wallet has sustained positive edge when properly weighted.

### Step 5: CW Winsorized Log Growth (14d) > 10% (CHANGED from v24)
Same calculation over last 14 active trading days.
**Purpose:** Ensure recent performance is also strong.

---

## ROI Winsorization (2.5%/97.5%)

To reduce the impact of outliers, ROI values are capped at the 2.5th and 97.5th percentile for each wallet:

```sql
-- Calculate percentile bounds per wallet
quantile(0.025)(pnl_usd / cost_usd) AS roi_floor
quantile(0.975)(pnl_usd / cost_usd) AS roi_ceiling

-- Apply cap to each trade
least(greatest(roi, roi_floor), roi_ceiling) AS winsorized_roi
```

### Winsorized Metrics Provided:

**Lifetime:**
- `winsorized_ev` - Expected value with outliers capped
- `cw_winsorized_log_growth` - Cost-weighted winsorized log growth (NEW in v25)
- `roi_floor` (2.5th percentile)
- `roi_ceiling` (97.5th percentile)

**14-Day:**
- `winsorized_ev_14d`
- `cw_winsorized_log_growth_14d` (NEW in v25)
- `roi_floor_14d`
- `roi_ceiling_14d`

**7-Day:**
- `winsorized_ev_7d`
- `cw_winsorized_log_growth_7d` (NEW in v25)
- `roi_floor_7d`
- `roi_ceiling_7d`

---

## Active Days Definition

**Important:** All time-based metrics use ACTIVE TRADING DAYS, not calendar days.

- **Active Day:** A day with at least 1 completed trade
- **"14d":** Last 14 ACTIVE trading days (may span more than 14 calendar days)
- **"7d":** Last 7 ACTIVE trading days

This provides fair comparison between:
- Daily traders (14d = ~14 calendar days)
- Weekly traders (14d = ~14 weeks)

---

## Output Columns

### Ranking Metrics (v25)
| Column | Formula | Description |
|--------|---------|-------------|
| `cw_winsorized_daily_log_growth` | `cw_winsorized_log_growth × trades_per_active_day` | Lifetime CW daily compound rate |
| `cw_winsorized_daily_log_growth_14d` | `cw_winsorized_log_growth_14d × trades_per_active_day_14d` | **Primary ranking metric** |
| `cw_winsorized_daily_log_growth_7d` | `cw_winsorized_log_growth_7d × trades_per_active_day_7d` | 7-day CW daily compound rate |

### Legacy Ranking Metrics (for comparison)
| Column | Formula | Description |
|--------|---------|-------------|
| `daily_log_growth` | `log_growth_per_trade × trades_per_active_day` | Lifetime daily compound rate |
| `daily_log_growth_14d` | `log_growth_per_trade_14d × trades_per_active_day_14d` | v24 ranking metric |
| `daily_log_growth_7d` | `log_growth_per_trade_7d × trades_per_active_day_7d` | 7-day daily compound rate |

### Lifetime Metrics
| Column | Description |
|--------|-------------|
| `total_trades` | Total number of completed trades |
| `wins` / `losses` | Win/loss count |
| `win_rate` | Win percentage (0-1 scale) |
| `ev` | Expected value per trade |
| `winsorized_ev` | EV with ROI capped at 2.5%/97.5% |
| `roi_floor` / `roi_ceiling` | 2.5th/97.5th percentile ROI bounds |
| `log_growth_per_trade` | Average log(1 + ROI) per trade |
| `cw_winsorized_log_growth` | Cost-weighted winsorized log growth (NEW in v25) |
| `calendar_days` | Days between first and last trade |
| `trading_days` | Distinct days with at least 1 trade |
| `trades_per_day` | trades / calendar_days |
| `trades_per_active_day` | trades / trading_days |
| `total_pnl` | Total profit/loss in USD |
| `total_volume` | Total volume traded in USD |
| `markets_traded` | Unique markets (condition_ids) |
| `avg_bet_size` / `median_bet_size` | Bet size statistics |
| `first_trade` / `last_trade` | Trade date range |
| `avg_hold_time_minutes` | Average position hold time |

### 14-Day Metrics
All lifetime metrics with `_14d` suffix, calculated over last 14 active trading days.

### 7-Day Metrics
All lifetime metrics with `_7d` suffix, calculated over last 7 active trading days.

---

## Version History

### v25 (2026-02-03) - Current
- **CRITICAL:** Excludes `is_short = 1` positions (CLOB-only artifacts, not real shorts)
- Changed ranking metric to cost-weighted winsorized log growth
- Changed bet filter from average to median (Step 3)
- Changed log growth filters from simple average to cost-weighted winsorized (Steps 4-5)
- Added `cw_winsorized_log_growth` and `cw_winsorized_daily_log_growth` metrics
- Fixes penny lottery trade domination issue

### v24 (2026-02-03)
- Changed filter: Markets > 10 (was > 9)
- Changed filter: Average bet > $10 (was median bet)
- Changed filter: Log growth > 10% (was > 0)
- Added winsorization bounds to output (roi_floor, roi_ceiling)
- Simplified to 5-step filter pipeline

### v21.8 (2026-02-01)
- 7-step filter with trading days, markets, trades, recency, median bet, log growth filters
- Used active trading days for all metrics

### v20 (2026-01-29)
- Added log_return_pct_per_active_day
- Added 14-day recency metrics

---

## Usage

### Cron Job (Production)
The leaderboard refreshes automatically every 2 hours via Vercel cron:
```
/api/cron/refresh-copy-trading-leaderboard-v25
Schedule: 30 */2 * * * (every 2 hours at :30)
```

### Manual Refresh
```bash
curl -X GET "https://your-domain/api/cron/refresh-copy-trading-leaderboard-v25" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Query the Leaderboard
```sql
SELECT *
FROM pm_copy_trading_leaderboard_v25
ORDER BY cw_winsorized_daily_log_growth_14d DESC
LIMIT 50
```

---

## Output Table

**Table:** `pm_copy_trading_leaderboard_v25`
**Engine:** ReplacingMergeTree()
**Order By:** wallet

---

## Related Files

- `src/app/api/cron/refresh-copy-trading-leaderboard-v25/route.ts` - Cron API route
- `vercel.json` - Cron schedule configuration
- `pm_trade_fifo_roi_v3_mat_unified` - Source table (FIFO trade data)
