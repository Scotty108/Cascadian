# Copy Trading Leaderboard Methodology

**Version:** 21
**Last Updated:** January 31, 2026
**Author:** Austin + Claude

---

## Overview

This document describes the methodology for generating the copy trading leaderboard. The goal is to identify wallets that would be profitable to copy trade with equal-weight betting.

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
| roi | ⚠️ BROKEN - do not use |
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

## Filter Pipeline

Filters are applied in order of compute cost (cheapest first):

| Step | Filter | Threshold | Rationale |
|------|--------|-----------|-----------|
| 1 | Recent activity | ≥1 trade in last 5 days | Only active traders |
| 2 | Wallet age | First trade ≥8 days ago | Enough history |
| 3 | Market diversity | ≥8 distinct markets | Not one-trick |
| 4 | Trade count | >50 trades | Statistical significance |
| 5 | Median bet size | ≥$10 | Serious traders |
| 6 | Median ROI | ≥5% | Consistent profitability |
| 7 | EV | >0 | Positive expected value |

### Filter Funnel (as of Jan 31, 2026)

```
184,386 → Active last 5 days
139,997 → Age ≥8 days
118,294 → ≥8 markets
 52,865 → >50 trades
 40,169 → Median bet ≥$10
  4,731 → Median ROI ≥5%
  3,214 → EV >0 ✓ (FINAL)
```

---

## Metrics

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

### Log Return %/Day

**Formula:**
```
Log Growth Per Trade = avg(ln(1 + pnl_usd/cost_usd))
Trades Per Day = total_trades / active_days
Log Return %/Day = Log Growth Per Trade × Trades Per Day × 100
```

**Interpretation:**
- Captures compound growth if copying every trade sequentially
- A wallet with 5% log growth/trade and 20 trades/day = 100% log return/day

**Why log returns?**
- 10 trades at +10% each compounds to (1.10)^10 = 2.59x
- Not 1 + 10×0.10 = 2.0x
- Log transform captures this: 10 × ln(1.10) = 0.953, e^0.953 = 2.59x

### EV Per Day

**Formula:**
```
EV Per Day = EV × Trades Per Day × 100
```

**Interpretation:**
- Expected profit % per day if betting $1 per trade
- Combines trade quality (EV) with velocity (trades/day)

**EV Per Day vs Log Return Per Day:**
- EV uses **median** (robust to outliers)
- Log Return uses **average** (sensitive to big wins/losses)
- A wallet can have positive EV/Day but negative Log Return/Day if occasional huge losses tank the average

---

## Output Table

**Table:** `pm_copy_trading_leaderboard_v21`

### Lifetime Metrics

| Column | Type | Description |
|--------|------|-------------|
| wallet | String | Wallet address |
| total_trades | Int | Total trade count |
| wins | Int | Winning trades |
| losses | Int | Losing trades |
| win_rate | Float | wins / total_trades |
| ev | Float | Expected value (decimal) |
| log_growth_per_trade | Float | avg(ln(1 + ROI)) |
| calendar_days | Int | Days between first and last trade |
| trading_days | Int | **Actual days with trades** (NEW in v21) |
| trades_per_day | Float | total_trades / calendar_days |
| trades_per_active_day | Float | **total_trades / trading_days** (NEW in v21) |
| log_return_pct_per_day | Float | Compound daily return % (calendar) |
| log_return_pct_per_active_day | Float | **Compound return % per active day** (NEW in v21) |
| ev_per_day | Float | EV × trades_per_day × 100 |
| total_pnl | Float | Lifetime profit in USD |
| total_volume | Float | Lifetime volume in USD |
| markets_traded | Int | Distinct markets traded |
| first_trade | DateTime | First trade timestamp |
| last_trade | DateTime | Last trade timestamp |

### 14-Day Recency Metrics (NEW in v21)

| Column | Type | Description |
|--------|------|-------------|
| total_trades_14d | Int | Trades in last 14 days |
| wins_14d | Int | Wins in last 14 days |
| losses_14d | Int | Losses in last 14 days |
| win_rate_14d | Float | Win rate in last 14 days |
| ev_14d | Float | EV in last 14 days |
| log_growth_per_trade_14d | Float | Log growth per trade (14d) |
| calendar_days_14d | Int | Calendar span of 14d trades |
| trading_days_14d | Int | Actual trading days in last 14 days |
| trades_per_day_14d | Float | Trades per calendar day (14d) |
| trades_per_active_day_14d | Float | Trades per active day (14d) |
| log_return_pct_per_day_14d | Float | Log return %/day (14d, calendar) |
| log_return_pct_per_active_day_14d | Float | Log return %/active day (14d) |
| ev_per_day_14d | Float | EV per day (14d) |
| total_pnl_14d | Float | PnL in last 14 days |
| total_volume_14d | Float | Volume in last 14 days |
| markets_traded_14d | Int | Markets traded in last 14 days |
| refreshed_at | DateTime | When leaderboard was refreshed |

---

## Usage

### Refresh Leaderboard

```bash
npx tsx scripts/refresh-copytrading-leaderboard-v21.ts
```

### Query Top 50 by Log Return Per Active Day

```sql
SELECT
  wallet,
  round(log_return_pct_per_active_day, 2) as log_ret_active,
  round(log_return_pct_per_day, 2) as log_ret_calendar,
  trading_days,
  calendar_days,
  round(total_pnl, 2) as total_pnl,
  round(total_pnl_14d, 2) as pnl_14d
FROM pm_copy_trading_leaderboard_v21
ORDER BY log_return_pct_per_active_day DESC
LIMIT 50
```

### Query Hot Wallets (Recent Performance)

```sql
SELECT
  wallet,
  total_trades_14d,
  round(win_rate_14d * 100, 1) as win_rate_14d_pct,
  round(ev_14d * 100, 2) as ev_14d_pct,
  round(log_return_pct_per_active_day_14d, 2) as log_ret_active_14d,
  round(total_pnl_14d, 2) as pnl_14d,
  round(total_pnl, 2) as lifetime_pnl
FROM pm_copy_trading_leaderboard_v21
WHERE total_trades_14d >= 10
  AND total_pnl_14d > 0
ORDER BY log_return_pct_per_active_day_14d DESC
LIMIT 50
```

### Find Consistent Performers (Lifetime + Recent)

```sql
SELECT
  wallet,
  round(ev * 100, 2) as ev_lifetime_pct,
  round(ev_14d * 100, 2) as ev_14d_pct,
  round(log_return_pct_per_active_day, 2) as log_ret_lifetime,
  round(log_return_pct_per_active_day_14d, 2) as log_ret_14d,
  round(total_pnl, 0) as lifetime_pnl,
  round(total_pnl_14d, 0) as pnl_14d
FROM pm_copy_trading_leaderboard_v21
WHERE ev > 0.1               -- 10%+ lifetime EV
  AND ev_14d > 0.05          -- 5%+ recent EV
  AND total_pnl_14d > 0      -- Profitable recently
ORDER BY ev_14d DESC
LIMIT 50
```

---

## Cron Setup

To refresh daily, add to `vercel.json`:

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

This refreshes at 6am UTC daily.

---

## Validation Checklist

Before trusting results, verify:

1. [ ] ROI calculated as `pnl_usd / cost_usd` (not the `roi` column)
2. [ ] Both YES and NO positions included (is_short = 0 and 1)
3. [ ] Only realized PnL (resolved or closed positions)
4. [ ] Deduplication applied (GROUP BY tx_hash, wallet, condition_id, outcome_index)
5. [ ] Spot check top wallets on polymarket.com/profile/{wallet}

---

## Known Issues

1. **Extreme log returns** - Some wallets have very high log return %/day due to high-frequency trading. This is mathematically correct but may not be practically achievable.

2. **EV vs Log Return divergence** - Wallets with positive EV but negative log return have consistent small wins but occasional huge losses.

3. **Stale data** - The source table (`pm_trade_fifo_roi_v3_mat_unified`) refreshes every 2 hours. Leaderboard may lag.

---

## Changelog

### v21 (Jan 31, 2026)
- **Removed Total PnL ≥ 0 filter** - PnL calculation was unreliable, now using EV > 0 as final filter
- Added `trading_days` - actual count of days with trades (not calendar span)
- Added `trades_per_active_day` - trades divided by actual trading days
- Added `log_return_pct_per_active_day` - log return based on active trading days
- Added full 14-day recency metrics for all key measurements
- Helps identify wallets that are "hot" vs "cooling off"
- Increased wallet count from ~2,700 to ~3,200 by removing PnL filter

### v20 (Jan 30, 2026)
- Fixed ROI calculation (use pnl_usd/cost_usd, not broken roi column)
- Added EV Per Day metric
- Fixed Log Return %/Day formula (sequential compounding)
- Included NO token traders (is_short=1)
- Documented full methodology

### v19
- Used broken `roi` column (incorrect for NO positions)
- Excluded is_short=1 wallets incorrectly
