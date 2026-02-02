# Copytrading Leaderboard Implementation Plan v21.6

## Overview

Create a copytrading leaderboard ranked by **Daily Log Growth** using ACTIVE TRADING DAYS for all time-based metrics.

**Key Concept:** All metrics and filters use ACTIVE TRADING DAYS, not calendar days, to fairly compare traders with different activity patterns.

---

## Data Source

**Table:** `pm_trade_fifo_roi_v3_mat_unified`
- ~290M trades total
- Each row = one completed position with:
  - `entry_time` - when trade was entered
  - `resolved_at` - when trade exited (Nullable)
  - `cost_usd` - dollars committed
  - `pnl_usd` - profit/loss in USD
  - `condition_id` - market identifier
  - `tx_hash` - unique trade identifier
  - `is_closed` - 1 if position fully closed
  - `is_short` - 1 if bought NO tokens

---

## Filter Pipeline (11 Steps)

All time-based filters (Steps 6-11) use **ACTIVE TRADING DAYS**.

| Step | Filter | Threshold | Rationale |
|------|--------|-----------|-----------|
| 1 | Trading days | > 5 | Minimum history |
| 2 | Market diversity | > 8 markets | Not one-trick |
| 3 | Trade count | > 30 trades | Statistical significance |
| 4 | Recent activity | Buy in last 5 calendar days | Still active |
| 5 | Median bet size | > $10 | Serious traders |
| 6 | Winsorized ROC (all active days) | > 0 | Profitable ROC lifetime |
| 7 | Winsorized ROC (14 active days) | > 0 | Profitable ROC recent |
| 8 | Winsorized ROC (7 active days) | > 0 | Profitable ROC very recent |
| 9 | Log Growth (all active days) | > 0 | Compounds profitably |
| 10 | Log Growth (14 active days) | > 0 | Compounds recently |
| 11 | Log Growth (7 active days) | > 0 | Compounds very recently |

### Filter Funnel (Feb 2, 2026)

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

---

## Active Days Implementation

### Step 1: Create Active Days Lookup Table

```sql
CREATE TABLE tmp_wallet_active_dates ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
SELECT
  wallet,
  toDate(entry_time) as trade_date,
  row_number() OVER (PARTITION BY wallet ORDER BY toDate(entry_time) DESC) as date_rank
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE wallet IN (SELECT wallet FROM tmp_step5)
  AND (resolved_at IS NOT NULL OR is_closed = 1)
  AND cost_usd > 0
GROUP BY wallet, toDate(entry_time)
```

### Step 2: Create Period Lookup Tables

```sql
-- Last 14 active days
CREATE TABLE tmp_last_14_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
SELECT wallet, trade_date FROM tmp_wallet_active_dates WHERE date_rank <= 14

-- Last 7 active days
CREATE TABLE tmp_last_7_active_days ENGINE = MergeTree() ORDER BY (wallet, trade_date) AS
SELECT wallet, trade_date FROM tmp_wallet_active_dates WHERE date_rank <= 7
```

### Step 3: Filter by Joining with Active Days

```sql
-- Example: Step 10 - Log growth (14 active days) > 0
SELECT t.wallet, avg(log1p(greatest(t.pnl_usd / t.cost_usd, -0.99))) as log_growth_14d
FROM pm_trade_fifo_roi_v3_mat_unified t
INNER JOIN tmp_last_14_active_days a ON t.wallet = a.wallet AND toDate(t.entry_time) = a.trade_date
INNER JOIN tmp_step9 s ON t.wallet = s.wallet
WHERE (t.resolved_at IS NOT NULL OR t.is_closed = 1)
  AND t.cost_usd > 0
GROUP BY t.wallet
HAVING log_growth_14d > 0
```

---

## Ranking Metric

**Primary Ranking:** `daily_log_growth_14d` (DESCENDING)

```sql
daily_log_growth_14d = log_growth_per_trade_14d × trades_per_active_day_14d

-- Where:
log_growth_per_trade_14d = avg(log1p(greatest(pnl_usd / cost_usd, -0.99)))
trades_per_active_day_14d = total_trades_14d / trading_days_14d
```

---

## Key Metrics Formulas

### Winsorized ROC

```sql
Winsorized ROC = (Winsorized EV × Total Trades) / Capital Required

-- Winsorized EV: Expected value with ROI capped at 2.5th/97.5th percentile
Winsorized EV = (win_rate × median_win_roi_capped) - (loss_rate × |median_loss_roi_capped|)

-- Capital Required (ACTIVE DAYS version)
Capital Required = trades × avg_hold_time / (active_days × 1440)
```

### Safe Hold Time Pattern

```sql
-- Handles epoch timestamps, small negatives, and large negatives
avg(
  CASE
    WHEN resolved_at < '1971-01-01' THEN NULL  -- Epoch timestamp corruption
    WHEN resolved_at < entry_time AND dateDiff('minute', resolved_at, entry_time) <= 5 THEN 1  -- Small negative (treat as 1 min)
    WHEN resolved_at < entry_time THEN NULL  -- Large negative (bad data)
    ELSE greatest(dateDiff('minute', entry_time, resolved_at), 1)  -- Normal case
  END
) as avg_hold_time_minutes
```

### Daily Log Growth

```sql
daily_log_growth = log_growth_per_trade × trades_per_active_day

-- Where:
log_growth_per_trade = avg(log1p(greatest(pnl_usd / cost_usd, -0.99)))
trades_per_active_day = total_trades / trading_days
```

---

## Output Files

### 1. Cron Job (Auto-Refresh)
`/src/app/api/cron/refresh-copy-trading-leaderboard-v21/route.ts`
- Runs daily at 6am UTC
- Updates `pm_copy_trading_leaderboard_v21` table

### 2. Manual Export Script
`/scripts/custom-leaderboard-export.ts`
- Run: `npx tsx scripts/custom-leaderboard-export.ts`
- Outputs: `exports/custom-leaderboard-export-{timestamp}.csv`

### 3. Documentation
`/docs/COPYTRADING_LEADERBOARD_METHODOLOGY.md`
- Full methodology and changelog

---

## Implementation Status

| Component | Status |
|-----------|--------|
| Filter Pipeline (11 steps) | COMPLETE |
| Active Days Lookup Tables | COMPLETE |
| Winsorized ROC Calculation | COMPLETE |
| Daily Log Growth Ranking | COMPLETE |
| 7-Day Metrics | COMPLETE |
| Cron Job | COMPLETE |
| Export Script | COMPLETE |
| Documentation | COMPLETE |

---

## Changelog

### v21.6 (Feb 2, 2026)
- Switched to ACTIVE TRADING DAYS for all time-based metrics
- Added Steps 8-11 (Winsorized ROC 7d, Log growth 14d/7d)
- Added 7-day metrics to output
- Changed ranking to `daily_log_growth_14d`
- Final wallet count: ~3,200

### v21.5-21.1
- Quality/consistency scores
- Risk metrics (Sortino, volatility)
- Log Growth filter
- EV per active day fixes
