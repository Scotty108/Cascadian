# Copytrading Leaderboard Documentation

## Overview

This document describes the methodology for generating the copytrading leaderboard ranked by **Daily Log Growth** using wallet trading data.

## Current Version: v24

**Last Updated:** 2026-02-03

## Data Source

- **Table:** `pm_trade_fifo_roi_v3_mat_unified`
- **Trade Type:** Closed trades only (`is_closed = 1`, `resolved_at IS NOT NULL`)
- **Position Type:** Long positions only (`cost_usd > 0`)

---

## Ranking Metric

**Daily Log Growth (14d)** is the primary ranking metric:

```
Daily Log Growth = Log Growth Per Trade × Trades Per Active Day
```

Where:
- `Log Growth Per Trade` = `avg(log1p(max(pnl_usd / cost_usd, -0.99)))`
- `Trades Per Active Day` = `total_trades / trading_days` (days with at least 1 trade)

### Why Log Growth?

Log growth properly accounts for compounding and asymmetric returns:
- A +50% followed by -50% = -25% net (not 0%)
- Log growth captures this: `log(1.5) + log(0.5) = -0.29` (negative)
- EV treats this as 0%, which is incorrect for compounding

---

## Filter Pipeline (v24)

### Step 1: Markets > 10
Keep only wallets that traded more than 10 unique markets (condition_ids).
```sql
HAVING countDistinct(condition_id) > 10
```
**Purpose:** Ensure diversification, filter out single-market specialists.

### Step 2: Buy Trade in Last 5 Days
At least one trade in the last 5 calendar days.
```sql
WHERE entry_time >= now() - INTERVAL 5 DAY
```
**Purpose:** Ensure wallet is still actively trading.

### Step 3: Average Bet > $10
Average trade size (cost_usd) must exceed $10.
```sql
HAVING avg(cost_usd) > 10
```
**Purpose:** Filter out micro-traders, ensure meaningful position sizes.

### Step 4: Log Growth Per Trade (All Time) > 10%
Lifetime log growth per trade must exceed 10%.
```sql
HAVING avg(log1p(greatest(pnl_usd / cost_usd, -0.99))) > 0.10
```
**Purpose:** Ensure wallet has sustained positive edge.

### Step 5: Log Growth Per Trade (14d) > 10%
Log growth per trade over last 14 active trading days must exceed 10%.
```sql
HAVING avg(log1p(greatest(pnl_usd / cost_usd, -0.99))) > 0.10
```
**Purpose:** Ensure recent performance is also strong.

---

## ROI Winsorization (2.5%/97.5%)

To reduce the impact of outliers, ROI values are capped at the 2.5th and 97.5th percentile for each wallet:

```sql
-- Calculate percentile bounds per wallet
quantile(0.025)(pnl_usd / cost_usd) AS roi_floor
quantile(0.975)(pnl_usd / cost_usd) AS roi_ceiling

-- Apply cap to each trade for EV calculation
least(greatest(roi, roi_floor), roi_ceiling) AS winsorized_roi
```

### Winsorized Metrics Provided:

**Lifetime:**
- `winsorized_ev` - Expected value with outliers capped
- `roi_floor` (2.5th percentile)
- `roi_ceiling` (97.5th percentile)

**14-Day:**
- `winsorized_ev_14d`
- `roi_floor_14d`
- `roi_ceiling_14d`

**7-Day:**
- `winsorized_ev_7d`
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

### Ranking Metrics
| Column | Formula | Description |
|--------|---------|-------------|
| `daily_log_growth` | `log_growth_per_trade × trades_per_active_day` | Lifetime daily compound rate |
| `daily_log_growth_14d` | `log_growth_per_trade_14d × trades_per_active_day_14d` | **Primary ranking metric** |
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

### v24 (2026-02-03) - Current
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
/api/cron/refresh-copy-trading-leaderboard-v24
Schedule: 15 */2 * * * (every 2 hours at :15)
```

### Manual Refresh
```bash
curl -X GET "https://your-domain/api/cron/refresh-copy-trading-leaderboard-v24" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Query the Leaderboard
```sql
SELECT *
FROM pm_copy_trading_leaderboard_v24
ORDER BY daily_log_growth_14d DESC
LIMIT 50
```

---

## Output Table

**Table:** `pm_copy_trading_leaderboard_v24`
**Engine:** ReplacingMergeTree()
**Order By:** wallet

---

## Related Files

- `src/app/api/cron/refresh-copy-trading-leaderboard-v24/route.ts` - Cron API route
- `vercel.json` - Cron schedule configuration
- `pm_trade_fifo_roi_v3_mat_unified` - Source table (FIFO trade data)
