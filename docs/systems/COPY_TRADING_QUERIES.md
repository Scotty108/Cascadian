# Copy Trading Metrics - Query Examples

## Table: `pm_wallet_copy_trading_metrics_v1`

Pre-computed metrics for ~130K wallets active in the last 30 days with FIFO-based per-trade ROI.

---

## Finding Copy Trading Candidates

### 1. Best Copy Trading Candidates (Taker-Heavy, Active, Profitable)

```sql
SELECT
  wallet,
  total_trades,
  round(win_rate_pct, 1) as win_rate,
  round(expectancy_pct, 1) as expectancy,
  round(avg_win_roi_pct, 0) as avg_win,
  round(pct_wins_over_100, 0) as pct_big_wins,
  round(total_pnl_usd, 0) as pnl_usd,
  round(maker_pct, 0) as maker_pct,
  round(sold_early_pct, 0) as sold_early,
  last_trade_time
FROM pm_wallet_copy_trading_metrics_v1
WHERE maker_pct <= 30                          -- Taker-heavy (copyable)
  AND toDate(last_trade_time) >= today() - 3   -- Active last 3 days
  AND expectancy_pct > 0                       -- Positive expectancy
  AND pct_wins_over_100 > 20                   -- Has big wins
  AND total_trades >= 20                       -- Statistical significance
ORDER BY expectancy_pct DESC
LIMIT 50
```

### 2. Asymmetric Winners (Low Win Rate, Huge Wins)

These wallets lose often but win BIG when they win - perfect for the user's stated preference.

```sql
SELECT
  wallet,
  total_trades,
  round(win_rate_pct, 1) as win_rate,
  round(expectancy_pct, 1) as expectancy,
  round(avg_win_roi_pct, 0) as avg_win,
  round(avg_loss_roi_pct, 0) as avg_loss,
  round(win_loss_ratio, 1) as wl_ratio,
  round(pct_wins_over_500, 0) as pct_500_wins,
  round(total_pnl_usd, 0) as pnl_usd
FROM pm_wallet_copy_trading_metrics_v1
WHERE win_rate_pct < 40                        -- Lose more often
  AND avg_win_roi_pct > 300                    -- But wins are 3x+
  AND expectancy_pct > 0                       -- Still profitable overall
  AND total_trades >= 20
  AND maker_pct <= 50                          -- Not pure market maker
ORDER BY avg_win_roi_pct DESC
LIMIT 50
```

### 3. Consistent Winners (High Win Rate, Steady Gains)

```sql
SELECT
  wallet,
  total_trades,
  round(win_rate_pct, 1) as win_rate,
  round(expectancy_pct, 1) as expectancy,
  round(avg_roi_pct, 1) as avg_roi,
  round(roi_stddev_pct, 1) as volatility,
  round(total_pnl_usd, 0) as pnl_usd,
  trades_per_day
FROM pm_wallet_copy_trading_metrics_v1
WHERE win_rate_pct >= 60                       -- High win rate
  AND expectancy_pct > 10                      -- Decent expectancy
  AND roi_stddev_pct < 200                     -- Low volatility
  AND total_trades >= 30
  AND maker_pct <= 40
ORDER BY win_rate_pct DESC, expectancy_pct DESC
LIMIT 50
```

### 4. High Volume Profitable Traders

```sql
SELECT
  wallet,
  total_trades,
  round(total_volume_usd, 0) as volume,
  round(total_pnl_usd, 0) as pnl,
  round(total_pnl_usd / total_volume_usd * 100, 2) as roi_pct,
  round(expectancy_pct, 1) as expectancy,
  round(win_rate_pct, 1) as win_rate
FROM pm_wallet_copy_trading_metrics_v1
WHERE total_volume_usd > 10000                 -- High volume
  AND total_pnl_usd > 0                        -- Profitable
  AND expectancy_pct > 0
  AND total_trades >= 20
ORDER BY total_pnl_usd DESC
LIMIT 50
```

### 5. Active Traders Who Cut Losses (Take Profit/Stop Loss Users)

```sql
SELECT
  wallet,
  total_trades,
  round(sold_early_pct, 0) as sold_early,
  round(win_rate_pct, 1) as win_rate,
  round(expectancy_pct, 1) as expectancy,
  round(avg_win_roi_pct, 0) as avg_win,
  round(avg_loss_roi_pct, 0) as avg_loss,
  round(total_pnl_usd, 0) as pnl_usd
FROM pm_wallet_copy_trading_metrics_v1
WHERE sold_early_pct > 30                      -- Actively manages positions
  AND expectancy_pct > 0
  AND total_trades >= 20
  AND maker_pct <= 40
ORDER BY expectancy_pct DESC
LIMIT 50
```

---

## Analytics Queries

### Distribution of Expectancy

```sql
SELECT
  multiIf(
    expectancy_pct < -50, '< -50%',
    expectancy_pct < -20, '-50% to -20%',
    expectancy_pct < 0, '-20% to 0%',
    expectancy_pct < 20, '0% to 20%',
    expectancy_pct < 50, '20% to 50%',
    expectancy_pct < 100, '50% to 100%',
    '>= 100%'
  ) as expectancy_bucket,
  count() as wallets,
  round(avg(total_pnl_usd), 0) as avg_pnl
FROM pm_wallet_copy_trading_metrics_v1
GROUP BY expectancy_bucket
ORDER BY expectancy_bucket
```

### Maker vs Taker Performance

```sql
SELECT
  multiIf(
    maker_pct <= 20, 'Taker (0-20%)',
    maker_pct <= 50, 'Mixed (20-50%)',
    maker_pct <= 80, 'Maker-leaning (50-80%)',
    'Pure Maker (80%+)'
  ) as trader_type,
  count() as wallets,
  round(avg(expectancy_pct), 1) as avg_expectancy,
  round(avg(total_pnl_usd), 0) as avg_pnl,
  round(avg(win_rate_pct), 1) as avg_win_rate
FROM pm_wallet_copy_trading_metrics_v1
WHERE total_trades >= 10
GROUP BY trader_type
ORDER BY trader_type
```

### Activity Level Analysis

```sql
SELECT
  multiIf(
    trades_per_day < 1, '< 1/day',
    trades_per_day < 5, '1-5/day',
    trades_per_day < 20, '5-20/day',
    '>= 20/day'
  ) as activity_level,
  count() as wallets,
  round(avg(expectancy_pct), 1) as avg_expectancy,
  round(avg(win_rate_pct), 1) as avg_win_rate
FROM pm_wallet_copy_trading_metrics_v1
WHERE total_trades >= 10
GROUP BY activity_level
ORDER BY activity_level
```

---

## Single Wallet Lookup

```sql
SELECT *
FROM pm_wallet_copy_trading_metrics_v1
WHERE wallet = '0x...'
```

---

## Leaderboards

### Top 20 by Expectancy

```sql
SELECT wallet, total_trades, win_rate_pct, expectancy_pct, total_pnl_usd
FROM pm_wallet_copy_trading_metrics_v1
WHERE total_trades >= 20
ORDER BY expectancy_pct DESC
LIMIT 20
```

### Top 20 by Total PnL

```sql
SELECT wallet, total_trades, win_rate_pct, expectancy_pct, total_pnl_usd
FROM pm_wallet_copy_trading_metrics_v1
WHERE total_trades >= 20
ORDER BY total_pnl_usd DESC
LIMIT 20
```

### Top 20 by Win Rate (min 30 trades)

```sql
SELECT wallet, total_trades, win_rate_pct, expectancy_pct, total_pnl_usd
FROM pm_wallet_copy_trading_metrics_v1
WHERE total_trades >= 30
ORDER BY win_rate_pct DESC
LIMIT 20
```

---

## Table Schema Reference

| Column | Type | Description |
|--------|------|-------------|
| wallet | String | Wallet address |
| total_trades | UInt32 | Number of buy trades (tx_hash) |
| wins | UInt32 | Trades with positive ROI |
| losses | UInt32 | Trades with zero/negative ROI |
| win_rate_pct | Float32 | wins / total_trades × 100 |
| avg_roi_pct | Float32 | Average ROI across all trades |
| avg_win_roi_pct | Float32 | Average ROI of winning trades |
| avg_loss_roi_pct | Float32 | Average absolute ROI of losing trades |
| median_win_roi_pct | Float32 | Median ROI of winning trades |
| roi_stddev_pct | Float32 | Standard deviation of ROI |
| pct_wins_over_50 | Float32 | % of wins with >50% ROI |
| pct_wins_over_100 | Float32 | % of wins with >100% ROI |
| pct_wins_over_500 | Float32 | % of wins with >500% ROI |
| max_win_roi_pct | Float32 | Best single trade ROI |
| pct_losses_over_50 | Float32 | % of losses worse than -50% |
| pct_losses_over_90 | Float32 | % of losses worse than -90% |
| max_loss_roi_pct | Float32 | Worst single trade ROI |
| expectancy_pct | Float32 | (WinRate × AvgWin) - (LossRate × AvgLoss) |
| asinh_score | Float32 | Inverse hyperbolic sine of ROI (handles outliers) |
| win_loss_ratio | Float32 | avg_win_roi / avg_loss_roi |
| total_volume_usd | Float64 | Sum of all trade costs |
| total_pnl_usd | Float64 | Sum of all trade PnL |
| avg_trade_usd | Float32 | Average trade size |
| positions_traded | UInt32 | Unique condition_ids traded |
| first_trade_time | DateTime | Earliest trade in window |
| last_trade_time | DateTime | Most recent trade |
| days_active | UInt16 | Days between first and last trade |
| trades_per_day | Float32 | total_trades / days_active |
| maker_pct | Float32 | % of trades as maker |
| taker_pct | Float32 | % of trades as taker |
| sold_early_pct | Float32 | % of trades closed before resolution |
| computed_at | DateTime | When metrics were calculated |
