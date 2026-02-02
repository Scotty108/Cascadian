# Copy Trading Leaderboard Methodology

**Version:** 21.6
**Last Updated:** February 2, 2026
**Author:** Austin + Claude

---

## Overview

This document describes the methodology for generating the copy trading leaderboard. The goal is to identify wallets that would be profitable to copy trade with equal-weight betting.

**CRITICAL CHANGE in v21.6:** All time-based metrics and filters are now calculated based on **ACTIVE TRADING DAYS**, not calendar days. This ensures fair comparison between traders with different activity patterns.

---

## Active Days Concept (NEW in v21.6)

### What Are Active Days?

An **active trading day** is any calendar day where the wallet made at least one trade.

| Period | Definition |
|--------|------------|
| All active days | Every day in the wallet's history with at least 1 trade |
| Last 14 active days | The most recent 14 days where the wallet traded |
| Last 7 active days | The most recent 7 days where the wallet traded |

### Why Active Days Matter

**Problem with calendar days:**
- Trader A: 100 trades over 10 days (10 trades/day)
- Trader B: 100 trades over 50 days (2 trades/day)
- Both have the same "trades per day" if A took 40 days off

**Solution with active days:**
- Trader A: 100 trades over 10 active days = 10 trades/active day
- Trader B: 100 trades over 50 active days = 2 trades/active day
- Now we compare actual trading intensity fairly

### Impact on Metrics

| Metric | Calendar Days | Active Days |
|--------|--------------|-------------|
| Daily Log Growth | `log_growth × trades_per_day` | `log_growth × trades_per_active_day` |
| Capital Required | Based on calendar span | Based on active days only |
| Winsorized ROC | May undervalue active traders | Fairly values trading intensity |

---

## Data Source

**Table:** `pm_trade_fifo_roi_v3_mat_unified`

| Column | Description |
|--------|-------------|
| wallet | Wallet address |
| condition_id | Market identifier |
| entry_time | When trade was opened |
| cost_usd | Amount bet in USD |
| pnl_usd | Profit/Loss in USD |
| roi | BROKEN - do not use |
| is_closed | 1 if position fully closed |
| resolved_at | When market resolved (NULL if unresolved) |
| is_short | 1 = bought NO tokens, 0 = bought YES tokens |

### Critical Notes

1. **The `roi` column is BROKEN** - especially for NO token positions (is_short=1). Always calculate ROI as `pnl_usd / cost_usd`.

2. **`is_short` doesn't mean shorting** - Polymarket doesn't have shorting. `is_short=1` means the wallet bought NO tokens.

3. **Deduplication required** - Use `GROUP BY tx_hash, wallet, condition_id, outcome_index` when counting trades.

4. **Realized PnL only** - Filter with `(resolved_at IS NOT NULL OR is_closed = 1)` to include:
   - Positions held to resolution
   - Positions closed before resolution (scalping)

---

## Filter Pipeline (v21.6)

All time-based filters (Steps 6-11) use **ACTIVE TRADING DAYS**, not calendar days.

| Step | Filter | Threshold | Rationale |
|------|--------|-----------|-----------|
| 1 | Trading days | > 5 | Minimum history |
| 2 | Market diversity | > 8 markets | Not one-trick |
| 3 | Trade count | > 30 trades | Statistical significance |
| 4 | Recent activity | Buy in last 5 calendar days | Still active (recency check) |
| 5 | Median bet size | > $10 | Serious traders |
| 6 | Winsorized ROC (all active days) | > 0 | Profitable return on capital |
| 7 | Winsorized ROC (14 active days) | > 0 | Recent ROC positive |
| 8 | Winsorized ROC (7 active days) | > 0 | Very recent ROC positive |
| 9 | Log Growth (all active days) | > 0 | Compounds profitably |
| 10 | Log Growth (14 active days) | > 0 | Recent compounding positive |
| 11 | Log Growth (7 active days) | > 0 | Very recent compounding positive |

### Filter Funnel (as of Feb 2, 2026)

```
xxx,xxx → Trading days > 5
xxx,xxx → Markets > 8
xxx,xxx → Trades > 30
xxx,xxx → Buy trade last 5 days
xxx,xxx → Median bet > $10
xxx,xxx → Winsorized ROC (all active) > 0
 16,325 → Winsorized ROC (14 active) > 0
 11,201 → Winsorized ROC (7 active) > 0
  3,737 → Log growth (all active) > 0
  3,514 → Log growth (14 active) > 0
  3,201 → Log growth (7 active) > 0 (FINAL)
```

### Why 11 Filters?

The additional filters (Steps 6-11) ensure wallets are profitable across **multiple time horizons**:

1. **All time positive** - Not just lucky recently
2. **14-day positive** - Not resting on historical gains
3. **7-day positive** - Actively profitable NOW

A wallet must pass ALL THREE time horizons for both Winsorized ROC and Log Growth to qualify.

---

## Metrics

### Winsorized ROC (Return on Capital)

**Formula:**
```
Winsorized ROC = (Winsorized EV × Total Trades) / Capital Required
```

**Where:**
- `Winsorized EV` = Expected value with ROI capped at 2.5th/97.5th percentile
- `Capital Required` = trades × avg_hold_time / (active_days × 1440 minutes)

**Why Winsorized?** Caps outliers at 2.5% and 97.5% percentiles to prevent single huge wins/losses from dominating.

**Why Active Days in Capital Required?** Using calendar days undervalues active traders who trade frequently in short bursts.

### Daily Log Growth

**Formula:**
```
Daily Log Growth = Log Growth Per Trade × Trades Per Active Day
Log Growth Per Trade = avg(ln(1 + max(ROI, -0.99)))
Trades Per Active Day = Total Trades / Active Trading Days
```

**Interpretation:**
- Captures compound growth if copying every trade sequentially
- A wallet with 5% log growth/trade and 10 trades/active day = 50% daily log growth

**Why Active Days?** Comparing "daily" growth is meaningless if one trader traded 5 days and another traded 50 days. Active days normalize for trading frequency.

### EV (Expected Value)

**Formula:**
```
EV = (win_rate × median_win_roi) - (loss_rate × |median_loss_roi|)
```

**Where:**
- `win_rate` = wins / total_trades
- `loss_rate` = 1 - win_rate
- `median_win_roi` = median(pnl_usd / cost_usd) for winning trades
- `median_loss_roi` = median(pnl_usd / cost_usd) for losing trades

**Interpretation:**
- EV = 10% → Expect $10 profit per $100 bet
- Uses median (robust to outliers) instead of mean

---

## Ranking Metric

**Primary Ranking:** `daily_log_growth_14d` (DESCENDING)

```
daily_log_growth_14d = log_growth_per_trade_14d × trades_per_active_day_14d
```

**Why this metric?**
1. **Log growth** captures compounding (not just averages)
2. **14 active days** balances recency with stability
3. **Per active day** normalizes for trading frequency

A trader who compounds 2% per trade with 5 trades per active day beats one who compounds 5% per trade with 1 trade per active day (10% vs 5% daily growth).

---

## Output Table

**Table:** `pm_copy_trading_leaderboard_v21`

### Lifetime Metrics

| Column | Type | Description |
|--------|------|-------------|
| wallet | String | Wallet address |
| daily_log_growth | Float | **Ranking metric (all time)** |
| daily_log_growth_14d | Float | **Ranking metric (14 active days)** |
| daily_log_growth_7d | Float | **Ranking metric (7 active days)** |
| winsorized_roc | Float | Winsorized Return on Capital (all time) |
| winsorized_roc_14d | Float | Winsorized ROC (14 active days) |
| winsorized_roc_7d | Float | Winsorized ROC (7 active days) |
| total_trades | Int | Total trade count |
| wins | Int | Winning trades |
| losses | Int | Losing trades |
| win_rate | Float | wins / total_trades |
| ev | Float | Expected value (decimal) |
| winsorized_ev | Float | Winsorized expected value |
| log_growth_per_trade | Float | avg(ln(1 + ROI)) |
| calendar_days | Int | Days between first and last trade |
| trading_days | Int | **Actual days with trades** |
| trades_per_day | Float | total_trades / calendar_days |
| trades_per_active_day | Float | **total_trades / trading_days** |
| total_pnl | Float | Lifetime profit in USD |
| total_volume | Float | Lifetime volume in USD |
| markets_traded | Int | Distinct markets traded |
| first_trade | DateTime | First trade timestamp |
| last_trade | DateTime | Last trade timestamp |
| avg_hold_time_minutes | Float | Average position hold time |

### 14-Day Metrics (Last 14 Active Days)

| Column | Type | Description |
|--------|------|-------------|
| total_trades_14d | Int | Trades in last 14 active days |
| wins_14d | Int | Wins in last 14 active days |
| losses_14d | Int | Losses in last 14 active days |
| win_rate_14d | Float | Win rate (14 active days) |
| ev_14d | Float | Expected value (14 active days) |
| winsorized_ev_14d | Float | Winsorized EV (14 active days) |
| log_growth_per_trade_14d | Float | Log growth per trade (14 active days) |
| trading_days_14d | Int | Actual trading days in period |
| trades_per_active_day_14d | Float | Trades per active day (14d) |
| total_pnl_14d | Float | PnL in last 14 active days |
| total_volume_14d | Float | Volume in last 14 active days |
| markets_traded_14d | Int | Markets traded (14 active days) |
| avg_hold_time_minutes_14d | Float | Average hold time (14 active days) |

### 7-Day Metrics (Last 7 Active Days)

| Column | Type | Description |
|--------|------|-------------|
| total_trades_7d | Int | Trades in last 7 active days |
| wins_7d | Int | Wins in last 7 active days |
| losses_7d | Int | Losses in last 7 active days |
| win_rate_7d | Float | Win rate (7 active days) |
| ev_7d | Float | Expected value (7 active days) |
| winsorized_ev_7d | Float | Winsorized EV (7 active days) |
| log_growth_per_trade_7d | Float | Log growth per trade (7 active days) |
| trading_days_7d | Int | Actual trading days in period |
| trades_per_active_day_7d | Float | Trades per active day (7d) |
| total_pnl_7d | Float | PnL in last 7 active days |
| total_volume_7d | Float | Volume in last 7 active days |
| markets_traded_7d | Int | Markets traded (7 active days) |
| avg_hold_time_minutes_7d | Float | Average hold time (7 active days) |
| refreshed_at | DateTime | When leaderboard was refreshed |

---

## Usage

### Refresh Leaderboard

```bash
# Via cron API
curl https://cascadian.vercel.app/api/cron/refresh-copy-trading-leaderboard-v21

# Or manually
npx tsx scripts/refresh-copytrading-leaderboard-v21.ts
```

### Query Top 50 by Daily Log Growth (14 Active Days)

```sql
SELECT
  wallet,
  round(daily_log_growth_14d * 100, 2) as daily_log_growth_14d_pct,
  round(daily_log_growth * 100, 2) as daily_log_growth_pct,
  trading_days,
  total_trades,
  round(winsorized_roc_14d, 2) as winsorized_roc_14d,
  round(total_pnl, 2) as total_pnl
FROM pm_copy_trading_leaderboard_v21
ORDER BY daily_log_growth_14d DESC
LIMIT 50
```

### Export to CSV

```bash
npx tsx scripts/custom-leaderboard-export.ts
```

Exports to `exports/custom-leaderboard-export-{timestamp}.csv` with all metrics.

---

## Cron Setup

To refresh daily at 6am UTC, add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-copy-trading-leaderboard-v21",
      "schedule": "0 6 * * *"
    }
  ]
}
```

---

## Validation Checklist

Before trusting results, verify:

1. [ ] ROI calculated as `pnl_usd / cost_usd` (not the `roi` column)
2. [ ] Both YES and NO positions included (is_short = 0 and 1)
3. [ ] Only realized PnL (resolved or closed positions)
4. [ ] Deduplication applied (GROUP BY tx_hash, wallet, condition_id, outcome_index)
5. [ ] Active days logic working (trades on same day count as 1 active day)
6. [ ] Spot check top wallets on polymarket.com/profile/{wallet}

---

## Known Issues

1. **Epoch timestamps in source data** - ~54K trades from 2023 have `resolved_at = 1970-01-01` due to source data issues. Safe hold time pattern handles this by treating as NULL.

2. **Small negative hold times** - Some trades have `resolved_at` slightly before `entry_time` (up to 5 minutes). These are treated as 1-minute hold times.

3. **Active days vs calendar days** - When comparing to other leaderboards, note that our metrics use active days, not calendar days.

---

## Changelog

### v21.6 (Feb 2, 2026)
- **MAJOR: Switched to ACTIVE TRADING DAYS for all time-based metrics**
  - "14d" now means "last 14 ACTIVE trading days" not "last 14 calendar days"
  - "7d" now means "last 7 ACTIVE trading days"
  - All filters and metrics recalculated based on active days
- **Added 3 new filters** (Steps 8-11):
  - Winsorized ROC (7 active days) > 0
  - Log growth (14 active days) > 0
  - Log growth (7 active days) > 0
- **Added 7-day metrics** to final output (all metrics now have all-time, 14d, and 7d versions)
- **Changed ranking metric** to `daily_log_growth_14d` (log_growth × trades_per_active_day)
- Final wallet count: ~3,200 (stricter but fairer filtering)

### v21.5 (Feb 1, 2026)
- Added quality and consistency scores for ranking wallets
- `quality_score` - geometric mean of EV and Log Return per active day
- `consistency_score` - min(quality_score, quality_score_14d)

### v21.4 (Feb 1, 2026)
- Added risk metrics (volatility, downside_deviation, sortino_ratio)

### v21.3 (Feb 1, 2026)
- Added Log Growth > 0 filter

### v21.2 (Feb 1, 2026)
- Fixed EV calculation for 100% win rate wallets
- Added ev_per_active_day metrics

### v21.1 (Feb 1, 2026)
- Changed recency filter from 5 days to 3 days

### v21 (Jan 31, 2026)
- Added trading_days and trades_per_active_day
- Added 14-day recency metrics

### v20 (Jan 30, 2026)
- Fixed ROI calculation
- Added EV Per Day metric
- Included NO token traders
