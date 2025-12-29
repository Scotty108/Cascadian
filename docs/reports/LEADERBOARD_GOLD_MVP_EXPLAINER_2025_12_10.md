# Leaderboard Gold MVP Explainer

**Terminal:** Terminal 3
**Date:** 2025-12-10
**Status:** COMPLETE

---

## Summary

`vw_leaderboard_gold_mvp_v1` is a filtered view of top-performing wallets with anti-false-positive guards. It surfaces **532 wallets** from a base universe of 9,841 that pass rigorous quality filters.

---

## Filter Funnel

| Stage | Wallets | Filter Applied |
|-------|---------|----------------|
| Base universe | 9,841 | 200+ events, 30+ resolved markets, 90+ active days, positive PnL |
| PnL >= $50K | 1,098 | Material PnL threshold |
| + Age >= 90 days | 1,098 | No new accounts (already enforced) |
| + Losing days >= 5 | 698 | Has experienced losses |
| + Biggest day <= 40% | 583 | No single lucky bet |
| + Omega >= 1.2 | **532** | Gains exceed losses by 20%+ |

---

## Why Each Guard Exists

| Guard | Threshold | Rationale |
|-------|-----------|-----------|
| `realized_pnl >= 50000` | $50K | Filter noise; focus on material performance |
| `losing_days >= 5` | 5 days | Ensures wallet has experienced adversity; not just lucky |
| `biggest_day_pct_of_total <= 40` | 40% | Prevents single-bet winners from polluting rankings |
| `omega_proxy >= 1.2` | 1.2x | Gains must exceed losses by at least 20% |
| `wallet_age_days >= 90` | 90 days | No flash-in-the-pan accounts |

---

## Key Metrics

| Metric | Description |
|--------|-------------|
| `realized_pnl` | Cumulative realized profit/loss from resolved markets |
| `omega_proxy` | sum(gains) / abs(sum(losses)) — higher = more consistent wins |
| `sortino_day_proxy` | Daily mean PnL / downside deviation — risk-adjusted return |
| `omega_day_proxy` | Same as omega but computed from daily buckets |
| `wallet_age_days` | Days since first trade |
| `losing_days` | Number of days with negative PnL |
| `biggest_day_pct_of_total` | Largest single day as % of total PnL |
| `roi_pct` | PnL / volume * 100 — basic ROI |

---

## Warnings

### High Omega with Low PnL
Extremely high Omega (>100) often indicates small sample size:
- Wallet may have only a few resolved markets
- One or two wins dominate the ratio
- **Recommendation:** Cross-reference with `losing_days` and `total_buckets`

### Sparse Losing-Day Inflation
Some wallets show inflated metrics due to:
- Few total trading days
- Long periods of inactivity
- **Recommendation:** Check `wallet_age_days` vs `active_days` ratio

---

## Category Distribution

| Category | Wallets | Avg PnL | Total PnL |
|----------|---------|---------|-----------|
| other | 176 | $470K | $82.7M |
| sports | 119 | $569K | $67.7M |
| politics | 108 | $381K | $41.1M |
| crypto | 98 | $336K | $32.9M |
| macro | 31 | $368K | $11.4M |

---

## Query Examples

### Top 100 by PnL

```sql
SELECT wallet, realized_pnl, omega_proxy, sortino_day_proxy, wallet_age_days, top_category
FROM vw_leaderboard_gold_mvp_v1
ORDER BY realized_pnl DESC
LIMIT 100;
```

### Top 100 by Omega

```sql
SELECT wallet, realized_pnl, omega_proxy, losing_days, biggest_day_pct_of_total, wallet_age_days
FROM vw_leaderboard_gold_mvp_v1
ORDER BY omega_proxy DESC
LIMIT 100;
```

### Top 100 by Sortino/day

```sql
SELECT wallet, realized_pnl, sortino_day_proxy, omega_proxy, losing_days
FROM vw_leaderboard_gold_mvp_v1
ORDER BY sortino_day_proxy DESC
LIMIT 100;
```

### Category Winners

```sql
SELECT top_category, wallet, realized_pnl, omega_proxy, sortino_day_proxy
FROM vw_leaderboard_gold_mvp_v1
ORDER BY top_category, realized_pnl DESC;
```

### Filter by Category

```sql
SELECT wallet, realized_pnl, omega_proxy, sortino_day_proxy
FROM vw_leaderboard_gold_mvp_v1
WHERE top_category = 'sports'
ORDER BY realized_pnl DESC
LIMIT 50;
```

---

## View Definition

```sql
CREATE OR REPLACE VIEW vw_leaderboard_gold_mvp_v1 AS
WITH battle_stats AS (
  SELECT
    wallet,
    countIf(realized_pnl_delta < 0) AS losing_days,
    countIf(realized_pnl_delta > 0) AS winning_days,
    count() AS total_buckets,
    max(realized_pnl_delta) AS biggest_single_day_pnl,
    min(realized_pnl_delta) AS worst_single_day_pnl,
    avg(realized_pnl_delta) AS mu_day,
    if(countIf(realized_pnl_delta < 0) >= 5,
       sqrt(avgIf(pow(realized_pnl_delta, 2), realized_pnl_delta < 0)),
       1000000) AS downside_dev_day,
    sumIf(realized_pnl_delta, realized_pnl_delta > 0) AS sum_gains,
    abs(sumIf(realized_pnl_delta, realized_pnl_delta < 0)) AS sum_losses
  FROM pm_wallet_pnl_timeseries_daily_v1
  GROUP BY wallet
),
daily_risk AS (
  SELECT
    wallet,
    losing_days,
    winning_days,
    total_buckets,
    biggest_single_day_pnl,
    worst_single_day_pnl,
    mu_day,
    downside_dev_day,
    sum_gains,
    sum_losses,
    if(downside_dev_day > 0, mu_day / downside_dev_day, 0) AS sortino_day_proxy,
    if(sum_losses > 0, sum_gains / sum_losses, sum_gains) AS omega_day_proxy
  FROM battle_stats
)
SELECT
  lb.wallet,
  lb.realized_pnl,
  lb.sortino_proxy,
  lb.omega_proxy,
  lb.consistency_proxy,
  dr.sortino_day_proxy,
  dr.omega_day_proxy,
  dr.mu_day AS avg_daily_pnl,
  lb.active_days,
  dateDiff('day', toDate(lb.first_ts), today()) AS wallet_age_days,
  lb.resolved_markets,
  lb.total_events,
  lb.top_category,
  lb.realized_pnl_top_category,
  lb.max_drawdown_pct,
  lb.first_ts,
  lb.last_ts,
  dr.losing_days,
  dr.winning_days,
  dr.total_buckets,
  round(dr.biggest_single_day_pnl, 2) AS biggest_single_day_pnl,
  round(dr.worst_single_day_pnl, 2) AS worst_single_day_pnl,
  round((dr.biggest_single_day_pnl * 100.0) / lb.realized_pnl, 1) AS biggest_day_pct_of_total,
  if(lb.total_volume_usdc > 0, (lb.realized_pnl / lb.total_volume_usdc) * 100, 0) AS roi_pct
FROM vw_leaderboard_v1 AS lb
INNER JOIN daily_risk AS dr ON lb.wallet = dr.wallet
WHERE
  lb.realized_pnl >= 50000
  AND dr.losing_days >= 5
  AND ((dr.biggest_single_day_pnl * 100.0) / lb.realized_pnl) <= 40
  AND lb.omega_proxy >= 1.2
  AND dateDiff('day', toDate(lb.first_ts), today()) >= 90
ORDER BY lb.sortino_proxy DESC, lb.realized_pnl DESC;
```

---

## Sample Output

### Top 10 by PnL

| Wallet | PnL | Omega | Sortino/day | Age | Losing Days | Category |
|--------|-----|-------|-------------|-----|-------------|----------|
| 0x4bfb...982e | $22.9M | 1.2 | 0.04 | 1115 | 514 | other |
| 0x204f...e14 | $6.6M | 2.5 | 0.33 | 123 | 44 | other |
| 0xd38b...029 | $6.1M | 2.5 | 0.39 | 109 | 36 | sports |
| 0xee00...ea1 | $5.1M | 1.7 | 0.14 | 484 | 173 | sports |
| 0xdbad...a9c | $4.9M | 2.1 | 0.18 | 524 | 47 | other |

### Top 5 by Omega

| Wallet | PnL | Omega | Losing Days | Age |
|--------|-----|-------|-------------|-----|
| 0x8c20...d4f | $52K | 1196.5 | 7 | 230 |
| 0xd1c7...d2b | $142K | 128.7 | 7 | 398 |
| 0xf247...216 | $518K | 85.6 | 14 | 143 |
| 0x5f4d...be0 | $116K | 49.0 | 23 | 132 |
| 0xca85...bf2 | $437K | 48.8 | 14 | 398 |

---

## Lane Note

**Terminal 3 owns:** Leaderboard integrity, anti-false-positive guards, wallet age
**Terminal 2 owns:** UI Total parity validation

Do not compare Gold realized/synthetic against Polymarket profile-page UI PnL — that is a definition mismatch. Terminal 3's Gold view uses internal canonical data only.

---

## Files

| File | Purpose |
|------|---------|
| `vw_leaderboard_gold_mvp_v1` | ClickHouse view (532 wallets) |
| `vw_leaderboard_v1` | Base leaderboard (9,841 wallets) |
| `pm_wallet_pnl_timeseries_daily_v1` | Daily PnL buckets |
| `pm_wallet_leaderboard_universe_v1` | Universe table |
