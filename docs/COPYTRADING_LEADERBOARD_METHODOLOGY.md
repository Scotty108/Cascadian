# Copy Trading Leaderboard Methodology

**Version:** 20
**Last Updated:** January 30, 2026
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
| 8 | Total PnL | ≥0 | Lifetime profitable |

### Filter Funnel (as of Jan 30, 2026)

```
1.93M total wallets
  ↓ Active last 5 days
204,618 wallets
  ↓ Age ≥8 days
160,869 wallets
  ↓ ≥8 markets
139,778 wallets
  ↓ >50 trades
104,139 wallets
  ↓ Median bet ≥$10
80,373 wallets
  ↓ Median ROI ≥5%
7,514 wallets
  ↓ EV >0
5,398 wallets
  ↓ Total PnL ≥0
4,563 wallets (0.24% of total)
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

**Table:** `pm_copy_trading_leaderboard_v20`

| Column | Type | Description |
|--------|------|-------------|
| wallet | String | Wallet address |
| total_trades | Int | Total trade count |
| wins | Int | Winning trades |
| losses | Int | Losing trades |
| win_rate | Float | wins / total_trades |
| ev | Float | Expected value (decimal) |
| log_growth_per_trade | Float | avg(ln(1 + ROI)) |
| trades_per_day | Float | total_trades / active_days |
| log_return_pct_per_day | Float | Compound daily return % |
| ev_per_day | Float | EV × trades_per_day × 100 |
| active_days | Int | Days between first and last trade |
| total_pnl | Float | Lifetime profit in USD |
| total_volume | Float | Lifetime volume in USD |
| first_trade | DateTime | First trade timestamp |
| last_trade | DateTime | Last trade timestamp |
| refreshed_at | DateTime | When leaderboard was refreshed |

---

## Usage

### Refresh Leaderboard

```bash
npx tsx scripts/refresh-copytrading-leaderboard-v20.ts
```

### Query Top 50 by EV Per Day

```sql
SELECT
  wallet,
  round(ev_per_day, 2) as ev_per_day_pct,
  round(ev * 100, 2) as ev_pct,
  round(trades_per_day, 1) as trades_per_day,
  round(win_rate * 100, 1) as win_rate_pct,
  round(total_pnl, 2) as total_pnl
FROM pm_copy_trading_leaderboard_v20
ORDER BY ev_per_day DESC
LIMIT 50
```

### Query Top 50 by Log Return Per Day

```sql
SELECT
  wallet,
  round(log_return_pct_per_day, 2) as log_return_pct_per_day,
  round(log_growth_per_trade * 100, 4) as log_growth_per_trade_pct,
  round(trades_per_day, 1) as trades_per_day,
  round(win_rate * 100, 1) as win_rate_pct,
  round(total_pnl, 2) as total_pnl
FROM pm_copy_trading_leaderboard_v20
ORDER BY log_return_pct_per_day DESC
LIMIT 50
```

---

## Cron Setup

To refresh daily, add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-copy-trading-leaderboard-v20",
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

### v20 (Jan 30, 2026)
- Fixed ROI calculation (use pnl_usd/cost_usd, not broken roi column)
- Added EV Per Day metric
- Fixed Log Return %/Day formula (sequential compounding)
- Included NO token traders (is_short=1)
- Documented full methodology

### v19
- Used broken `roi` column (incorrect for NO positions)
- Excluded is_short=1 wallets incorrectly
