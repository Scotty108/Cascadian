# Winner Baseline Benchmark Queries

**Purpose:** Once `wallet_metrics` table is populated with P&L data, run these queries to understand "how much winners are winning" and establish baseline performance thresholds for copy-trading strategy.

**Status:** 🔴 **READY TO RUN** (waiting for P&L calculation completion)

**Last Updated:** 2025-11-11

---

## Table of Contents

1. [Top Performer Benchmarks](#1-top-performer-benchmarks)
2. [Distribution Analysis](#2-distribution-analysis)
3. [Elite Wallet Characteristics](#3-elite-wallet-characteristics)
4. [Percentile Thresholds](#4-percentile-thresholds)
5. [Capital Deployment Estimates](#5-capital-deployment-estimates)
6. [Risk Profile Analysis](#6-risk-profile-analysis)
7. [Time Efficiency Metrics](#7-time-efficiency-metrics)
8. [Category & Tag Analysis](#8-category--tag-analysis)

---

## 1. Top Performer Benchmarks

### Query 1.1: Top 50 by Omega Ratio - Full Distribution

**Question:** What's the average Omega score of the top 50 wallets? What's the range?

```sql
WITH top50 AS (
  SELECT
    wallet_address,
    omega_ratio,
    total_trades,
    realized_pnl,
    unrealized_payout,
    roi_pct,
    win_rate,
    sharpe_ratio,
    max_drawdown_pct
  FROM wallet_metrics
  WHERE time_window = 'lifetime'
    AND total_trades >= 10  -- Minimum sample size
  ORDER BY omega_ratio DESC
  LIMIT 50
)
SELECT
  'Top 50 by Omega' as cohort,
  count(*) as wallet_count,

  -- Omega distribution
  round(min(omega_ratio), 2) as min_omega,
  round(quantile(0.25)(omega_ratio), 2) as p25_omega,
  round(quantile(0.50)(omega_ratio), 2) as median_omega,
  round(quantile(0.75)(omega_ratio), 2) as p75_omega,
  round(max(omega_ratio), 2) as max_omega,
  round(avg(omega_ratio), 2) as avg_omega,

  -- Supporting metrics
  round(avg(roi_pct), 2) as avg_roi_pct,
  round(quantile(0.50)(roi_pct), 2) as median_roi_pct,
  round(avg(win_rate), 2) as avg_win_rate,
  round(quantile(0.50)(win_rate), 2) as median_win_rate,
  round(avg(sharpe_ratio), 2) as avg_sharpe,

  -- P&L totals
  round(sum(realized_pnl), 2) as total_realized_pnl,
  round(avg(realized_pnl), 2) as avg_pnl_per_wallet,
  round(quantile(0.50)(realized_pnl), 2) as median_pnl
FROM top50;
```

**Expected Output:**
```
cohort: "Top 50 by Omega"
wallet_count: 50
min_omega: 2.3
p25_omega: 3.1
median_omega: 3.8
p75_omega: 4.9
max_omega: 8.2
avg_omega: 4.2
avg_roi_pct: 67.3%
median_roi_pct: 54.2%
avg_win_rate: 0.68
median_win_rate: 0.65
total_realized_pnl: $2,450,890
avg_pnl_per_wallet: $49,018
```

**What This Tells Us:**
- The "omega benchmark" for elite traders (is it 2? 5? 10?)
- Expected ROI if copying top omega wallets
- Win rate required to achieve top omega performance
- Total capital controlled by elite performers

---

### Query 1.2: Top 100 by Total P&L (Whales)

**Question:** What's the average Omega of the richest winners? Do whales have better risk management?

```sql
WITH top100_whales AS (
  SELECT
    wallet_address,
    omega_ratio,
    total_trades,
    realized_pnl,
    roi_pct,
    win_rate,
    sharpe_ratio,
    max_drawdown_pct,
    markets_traded
  FROM wallet_metrics
  WHERE time_window = 'lifetime'
    AND total_trades >= 5
  ORDER BY realized_pnl DESC
  LIMIT 100
)
SELECT
  'Top 100 by P&L (Whales)' as cohort,
  count(*) as wallet_count,

  -- Omega distribution (main question)
  round(quantile(0.50)(omega_ratio), 2) as median_omega,
  round(avg(omega_ratio), 2) as avg_omega,
  round(quantile(0.25)(omega_ratio), 2) as p25_omega,
  round(quantile(0.75)(omega_ratio), 2) as p75_omega,

  -- ROI & Win Rate
  round(quantile(0.50)(roi_pct), 2) as median_roi_pct,
  round(avg(roi_pct), 2) as avg_roi_pct,
  round(quantile(0.50)(win_rate), 2) as median_win_rate,
  round(avg(win_rate), 2) as avg_win_rate,

  -- Risk metrics
  round(avg(sharpe_ratio), 2) as avg_sharpe,
  round(avg(max_drawdown_pct), 2) as avg_max_drawdown,

  -- P&L totals
  round(sum(realized_pnl), 2) as total_pnl,
  round(avg(realized_pnl), 2) as avg_pnl_per_wallet,

  -- Activity
  round(avg(total_trades), 1) as avg_trades,
  round(avg(markets_traded), 1) as avg_markets
FROM top100_whales;
```

**What This Tells Us:**
- Do big winners have high Omega (skilled) or just big bets (lucky)?
- Win rate of whales vs Omega-optimized wallets
- Capital scale of top 100 (addressable market for copy trading)
- Trade frequency of whales (can we copy them?)

---

### Query 1.3: Top 10 Wallets - Individual Profiles

**Question:** What's the win rate, omega, and P&L of the #1 ranked wallet? Top 10?

```sql
SELECT
  row_number() OVER (ORDER BY omega_ratio DESC) as rank,
  wallet_address,
  round(omega_ratio, 2) as omega,
  round(win_rate, 2) as win_rate,
  round(realized_pnl, 2) as realized_pnl,
  round(roi_pct, 2) as roi_pct,
  total_trades,
  markets_traded,
  round(sharpe_ratio, 2) as sharpe,
  round(max_drawdown_pct, 2) as max_drawdown_pct,
  last_trade_date
FROM wallet_metrics
WHERE time_window = 'lifetime'
  AND total_trades >= 10
ORDER BY omega_ratio DESC
LIMIT 10;
```

**What This Tells Us:**
- Individual characteristics of "the best"
- Whether #1 is an outlier or part of a cluster
- If top performers are active (last_trade_date recent)
- Specific wallets to analyze deeper

---

## 2. Distribution Analysis

### Query 2.1: Omega Distribution Across All Wallets

**Question:** How rare is Omega > 2.0? Omega > 3.0? What percentile?

```sql
SELECT
  'All Wallets (10+ trades)' as cohort,
  count(*) as total_wallets,

  -- Percentile benchmarks
  round(quantile(0.50)(omega_ratio), 2) as median_omega,
  round(quantile(0.75)(omega_ratio), 2) as p75_omega,
  round(quantile(0.90)(omega_ratio), 2) as p90_omega,
  round(quantile(0.95)(omega_ratio), 2) as p95_omega,
  round(quantile(0.99)(omega_ratio), 2) as p99_omega,

  -- Elite counts
  countIf(omega_ratio > 1.0) as profitable_wallets,
  round(countIf(omega_ratio > 1.0) / count(*) * 100, 1) as pct_profitable,

  countIf(omega_ratio > 2.0) as elite_wallets,
  round(countIf(omega_ratio > 2.0) / count(*) * 100, 1) as pct_elite,

  countIf(omega_ratio > 3.0) as super_elite_wallets,
  round(countIf(omega_ratio > 3.0) / count(*) * 100, 1) as pct_super_elite,

  -- Win rate distribution
  round(quantile(0.50)(win_rate), 2) as median_win_rate,
  round(quantile(0.90)(win_rate), 2) as p90_win_rate,

  -- P&L totals
  round(sum(realized_pnl), 2) as total_ecosystem_pnl
FROM wallet_metrics
WHERE time_window = 'lifetime'
  AND total_trades >= 10;
```

**What This Tells Us:**
- How competitive the market is (median omega tells skill level)
- What "top 10%" actually means (absolute omega threshold)
- How many wallets qualify for copy trading (elite count)
- Total P&L in the ecosystem (market size)

---

### Query 2.2: Performance by Trade Count Tiers

**Question:** Do wallets with more trades have better performance? (Sample size effect)

```sql
SELECT
  CASE
    WHEN total_trades >= 100 THEN '100+ trades (Heavy)'
    WHEN total_trades >= 50 THEN '50-99 trades (Active)'
    WHEN total_trades >= 20 THEN '20-49 trades (Regular)'
    WHEN total_trades >= 10 THEN '10-19 trades (Moderate)'
    ELSE '5-9 trades (Light)'
  END as trader_tier,

  count(*) as wallet_count,

  -- Central tendency
  round(quantile(0.50)(omega_ratio), 2) as median_omega,
  round(quantile(0.50)(roi_pct), 2) as median_roi_pct,
  round(quantile(0.50)(win_rate), 2) as median_win_rate,

  -- Elite counts
  countIf(omega_ratio > 2.0) as elite_count,
  round(countIf(omega_ratio > 2.0) / count(*) * 100, 1) as pct_elite,

  countIf(win_rate > 0.60) as high_win_rate_count,
  round(countIf(win_rate > 0.60) / count(*) * 100, 1) as pct_high_win_rate,

  -- P&L
  round(sum(realized_pnl), 2) as total_pnl
FROM wallet_metrics
WHERE time_window = 'lifetime'
  AND total_trades >= 5
GROUP BY trader_tier
ORDER BY min(total_trades) DESC;
```

**What This Tells Us:**
- Whether heavy traders are more skilled (survivorship?)
- Minimum trade count for statistical significance
- If "light traders" include lucky one-hit wonders

---

## 3. Elite Wallet Characteristics

### Query 3.1: Elite Wallet Count by Minimum Trade Threshold

**Question:** How many wallets have Omega > 2.0? How does it change with trade minimums?

```sql
SELECT
  'Elite: Omega > 2.0' as filter_name,

  -- Count by trade minimum
  countIf(total_trades >= 5) as wallets_5plus_trades,
  countIf(total_trades >= 10) as wallets_10plus_trades,
  countIf(total_trades >= 20) as wallets_20plus_trades,
  countIf(total_trades >= 50) as wallets_50plus_trades,
  countIf(total_trades >= 100) as wallets_100plus_trades,

  -- Percentages
  round(countIf(total_trades >= 10) / count(*) * 100, 1) as pct_with_10plus,
  round(countIf(total_trades >= 50) / count(*) * 100, 1) as pct_with_50plus,

  -- Their average performance
  round(avg(omega_ratio), 2) as avg_omega,
  round(avg(win_rate), 2) as avg_win_rate,
  round(sum(realized_pnl), 2) as total_pnl
FROM wallet_metrics
WHERE time_window = 'lifetime'
  AND omega_ratio > 2.0;
```

**What This Tells Us:**
- Size of copy-tradeable population
- Whether elite status persists with more trades (skill vs luck)
- Capital available if we copy all elite wallets

---

### Query 3.2: Multi-Metric Elite Filter

**Question:** How many wallets pass **ALL** elite criteria (Omega > 2.0 AND Win Rate > 60% AND ROI > 50%)?

```sql
WITH elite_wallets AS (
  SELECT
    wallet_address,
    omega_ratio,
    win_rate,
    roi_pct,
    realized_pnl,
    total_trades,
    sharpe_ratio,
    max_drawdown_pct
  FROM wallet_metrics
  WHERE time_window = 'lifetime'
    AND total_trades >= 20
    AND omega_ratio > 2.0
    AND win_rate > 0.60
    AND roi_pct > 50
    AND max_drawdown_pct < 25
)
SELECT
  'Elite (Omega>2 + WinRate>60 + ROI>50 + Drawdown<25)' as filter,
  count(*) as wallet_count,

  -- Their stats
  round(avg(omega_ratio), 2) as avg_omega,
  round(avg(win_rate), 2) as avg_win_rate,
  round(avg(roi_pct), 2) as avg_roi_pct,
  round(avg(sharpe_ratio), 2) as avg_sharpe,

  -- P&L potential
  round(sum(realized_pnl), 2) as total_pnl,
  round(avg(realized_pnl), 2) as avg_pnl_per_wallet
FROM elite_wallets;
```

**What This Tells Us:**
- How selective we need to be (how many pass all filters?)
- Expected performance if we copy only "perfect" wallets
- Whether filters are too strict (< 10 wallets) or too loose (> 500)

---

## 4. Percentile Thresholds

### Query 4.1: What Omega/ROI/Win Rate Defines Top 10%?

**Question:** What's the minimum Omega to be in top 10%? Top 5%? Top 1%?

```sql
SELECT
  'Percentile Thresholds' as metric,

  -- Omega thresholds
  round(quantile(0.90)(omega_ratio), 2) as omega_top_10pct,
  round(quantile(0.95)(omega_ratio), 2) as omega_top_5pct,
  round(quantile(0.99)(omega_ratio), 2) as omega_top_1pct,

  -- ROI thresholds
  round(quantile(0.90)(roi_pct), 2) as roi_top_10pct,
  round(quantile(0.95)(roi_pct), 2) as roi_top_5pct,
  round(quantile(0.99)(roi_pct), 2) as roi_top_1pct,

  -- Win Rate thresholds
  round(quantile(0.90)(win_rate), 2) as win_rate_top_10pct,
  round(quantile(0.95)(win_rate), 2) as win_rate_top_5pct,
  round(quantile(0.99)(win_rate), 2) as win_rate_top_1pct,

  -- P&L thresholds
  round(quantile(0.90)(realized_pnl), 2) as pnl_top_10pct,
  round(quantile(0.95)(realized_pnl), 2) as pnl_top_5pct,
  round(quantile(0.99)(realized_pnl), 2) as pnl_top_1pct
FROM wallet_metrics
WHERE time_window = 'lifetime'
  AND total_trades >= 10;
```

**What This Tells Us:**
- Exact cutoffs for percentile-based filtering
- Whether "top 10%" is achievable or superhuman
- Dynamic thresholds (adjust as market changes)

---

### Query 4.2: Percentile-Based Elite Count

**Question:** If we filter by top 10% correctness + top 50% ROI, how many wallets qualify?

```sql
WITH ranked AS (
  SELECT
    wallet_address,
    omega_ratio,
    win_rate,
    roi_pct,
    realized_pnl,
    total_trades,

    -- Percentile rankings
    percent_rank() OVER (ORDER BY win_rate DESC) as win_rate_percentile,
    percent_rank() OVER (ORDER BY roi_pct DESC) as roi_percentile,
    percent_rank() OVER (ORDER BY omega_ratio DESC) as omega_percentile
  FROM wallet_metrics
  WHERE time_window = 'lifetime'
    AND total_trades >= 20
)
SELECT
  'Top 10% Win Rate + Top 50% ROI' as filter,
  countIf(win_rate_percentile <= 0.10 AND roi_percentile <= 0.50) as qualified_wallets,

  round(avg(IF(win_rate_percentile <= 0.10 AND roi_percentile <= 0.50, omega_ratio, NULL)), 2) as avg_omega,
  round(avg(IF(win_rate_percentile <= 0.10 AND roi_percentile <= 0.50, win_rate, NULL)), 2) as avg_win_rate,
  round(avg(IF(win_rate_percentile <= 0.10 AND roi_percentile <= 0.50, roi_pct, NULL)), 2) as avg_roi_pct,
  round(sum(IF(win_rate_percentile <= 0.10 AND roi_percentile <= 0.50, realized_pnl, NULL)), 2) as total_pnl
FROM ranked;
```

**What This Tells Us:**
- How many wallets pass the "Tag Specialist Alpha" filter
- Expected performance if we copy this cohort
- Whether we need to adjust percentile thresholds

---

## 5. Capital Deployment Estimates

### Query 5.1: Total P&L by Cohort (Capital Potential)

**Question:** How much total P&L did elite wallets generate? (Market size for copy trading)

```sql
SELECT
  CASE
    WHEN omega_ratio > 3.0 THEN 'Super Elite (Omega > 3.0)'
    WHEN omega_ratio > 2.0 THEN 'Elite (Omega 2.0-3.0)'
    WHEN omega_ratio > 1.5 THEN 'Good (Omega 1.5-2.0)'
    WHEN omega_ratio > 1.0 THEN 'Profitable (Omega 1.0-1.5)'
    ELSE 'Unprofitable (Omega < 1.0)'
  END as cohort,

  count(*) as wallet_count,
  round(sum(realized_pnl), 2) as total_pnl,
  round(avg(realized_pnl), 2) as avg_pnl_per_wallet,

  -- If we copied them with equal weight
  round(sum(realized_pnl) / count(*), 2) as expected_pnl_per_copy,

  -- Market share
  round(sum(realized_pnl) / (SELECT sum(realized_pnl) FROM wallet_metrics WHERE time_window = 'lifetime') * 100, 1) as pct_of_total_market_pnl
FROM wallet_metrics
WHERE time_window = 'lifetime'
  AND total_trades >= 10
GROUP BY cohort
ORDER BY min(omega_ratio) DESC;
```

**What This Tells Us:**
- Where the money is (which cohort generates most P&L?)
- Expected return if we copy entire cohorts
- Market concentration (is it top-heavy?)

---

### Query 5.2: Average Market Volume (Liquidity Check)

**Question:** Can we actually copy these wallets at scale? What's their typical position size?

```sql
SELECT
  CASE
    WHEN omega_ratio > 2.0 THEN 'Elite (Omega > 2.0)'
    ELSE 'Rest'
  END as cohort,

  count(*) as wallet_count,
  round(avg(total_trades), 1) as avg_trades,
  round(avg(markets_traded), 1) as avg_markets,

  -- Position size estimation
  round(avg(realized_pnl / nullIf(total_trades, 0)), 2) as avg_pnl_per_trade,
  round(avg(realized_pnl / nullIf(markets_traded, 0)), 2) as avg_pnl_per_market,

  -- Activity level
  round(avg(total_trades / nullIf(datediff('day', first_trade_date, last_trade_date), 0)), 2) as avg_trades_per_day
FROM wallet_metrics
WHERE time_window = 'lifetime'
  AND total_trades >= 20
GROUP BY cohort;
```

**What This Tells Us:**
- Trade frequency of elite wallets (can we keep up?)
- Position sizes (will we have liquidity?)
- Activity level (are they active enough to copy?)

---

## 6. Risk Profile Analysis

### Query 6.1: Max Drawdown Distribution

**Question:** What's the worst-case loss for top performers? How safe are they?

```sql
WITH top100_omega AS (
  SELECT
    omega_ratio,
    max_drawdown_pct,
    win_rate,
    realized_pnl,
    sharpe_ratio
  FROM wallet_metrics
  WHERE time_window = 'lifetime'
    AND total_trades >= 10
  ORDER BY omega_ratio DESC
  LIMIT 100
)
SELECT
  'Top 100 by Omega - Risk Profile' as cohort,

  -- Drawdown distribution
  round(quantile(0.50)(max_drawdown_pct), 2) as median_max_drawdown,
  round(avg(max_drawdown_pct), 2) as avg_max_drawdown,
  round(quantile(0.75)(max_drawdown_pct), 2) as p75_max_drawdown,
  round(max(max_drawdown_pct), 2) as worst_drawdown,

  -- Risk-adjusted metrics
  round(avg(sharpe_ratio), 2) as avg_sharpe,

  -- Count of "safe" wallets
  countIf(max_drawdown_pct < 15) as wallets_drawdown_under_15pct,
  countIf(max_drawdown_pct < 25) as wallets_drawdown_under_25pct
FROM top100_omega;
```

**What This Tells Us:**
- Downside risk if we copy elite wallets
- Whether high Omega = safe (or just lucky)
- Risk tolerance required for copy trading

---

### Query 6.2: Win Rate vs Omega Correlation

**Question:** Do high-omega wallets win often, or just win big?

```sql
SELECT
  CASE
    WHEN win_rate >= 0.70 THEN '70%+ Win Rate'
    WHEN win_rate >= 0.60 THEN '60-70% Win Rate'
    WHEN win_rate >= 0.50 THEN '50-60% Win Rate'
    ELSE '<50% Win Rate'
  END as win_rate_bucket,

  count(*) as wallet_count,
  round(avg(omega_ratio), 2) as avg_omega,
  round(avg(roi_pct), 2) as avg_roi_pct,
  round(avg(realized_pnl), 2) as avg_pnl
FROM wallet_metrics
WHERE time_window = 'lifetime'
  AND total_trades >= 20
  AND omega_ratio > 2.0  -- Elite only
GROUP BY win_rate_bucket
ORDER BY min(win_rate) DESC;
```

**What This Tells Us:**
- Whether elite traders are "high win rate" or "big payoff" types
- Strategy type (consistent small wins vs rare big wins)
- Risk profile (volatility of returns)

---

## 7. Time Efficiency Metrics

### Query 7.1: Recent Activity Check (30d vs Lifetime)

**Question:** Are top performers still active? Or did they quit?

```sql
SELECT
  w_lifetime.wallet_address,
  round(w_lifetime.omega_ratio, 2) as lifetime_omega,
  round(w_30d.omega_ratio, 2) as omega_30d,

  w_lifetime.total_trades as lifetime_trades,
  w_30d.total_trades as trades_30d,

  w_lifetime.last_trade_date,
  datediff('day', w_lifetime.last_trade_date, now()) as days_since_last_trade,

  CASE
    WHEN w_30d.omega_ratio > w_lifetime.omega_ratio THEN 'Improving'
    WHEN w_30d.omega_ratio < w_lifetime.omega_ratio THEN 'Declining'
    ELSE 'Stable'
  END as trend
FROM wallet_metrics w_lifetime
LEFT JOIN wallet_metrics w_30d
  ON w_lifetime.wallet_address = w_30d.wallet_address
  AND w_30d.time_window = '30d'
WHERE w_lifetime.time_window = 'lifetime'
  AND w_lifetime.omega_ratio > 2.0
  AND w_lifetime.total_trades >= 20
ORDER BY w_lifetime.omega_ratio DESC
LIMIT 50;
```

**What This Tells Us:**
- Are top wallets still active? (last_trade_date)
- Is performance improving or declining? (trend)
- Should we copy them now or wait?

---

### Query 7.2: Trade Frequency Distribution

**Question:** How often do elite wallets trade? Daily? Weekly?

```sql
SELECT
  omega_ratio_bucket,
  count(*) as wallet_count,
  round(avg(trades_per_day), 3) as avg_trades_per_day,
  round(avg(days_between_trades), 1) as avg_days_between_trades,

  countIf(trades_per_day >= 1.0) as daily_traders,
  countIf(trades_per_day >= 0.5) as frequent_traders,
  countIf(trades_per_day < 0.1) as rare_traders
FROM (
  SELECT
    CASE
      WHEN omega_ratio > 3.0 THEN 'Super Elite (>3.0)'
      WHEN omega_ratio > 2.0 THEN 'Elite (2.0-3.0)'
      ELSE 'Rest'
    END as omega_ratio_bucket,

    omega_ratio,
    total_trades,
    first_trade_date,
    last_trade_date,

    total_trades / nullIf(datediff('day', first_trade_date, last_trade_date), 0) as trades_per_day,
    datediff('day', first_trade_date, last_trade_date) / nullIf(total_trades, 0) as days_between_trades
  FROM wallet_metrics
  WHERE time_window = 'lifetime'
    AND total_trades >= 20
)
GROUP BY omega_ratio_bucket
ORDER BY min(omega_ratio) DESC;
```

**What This Tells Us:**
- Copy-trading feasibility (need active wallets)
- Position management complexity (1 trade/day vs 10/day)
- Capital deployment speed (how fast can we match them?)

---

## 8. Category & Tag Analysis

### Query 8.1: Top Categories for Elite Wallets

**Question:** Where do elite wallets trade? Which categories are most profitable?

```sql
-- Note: Requires wallet_metrics_by_category table
SELECT
  market_category,
  count(DISTINCT wallet_address) as elite_wallet_count,

  round(avg(category_omega_ratio), 2) as avg_omega,
  round(avg(category_correctness_pct), 2) as avg_correctness,
  round(avg(category_roi_pct), 2) as avg_roi_pct,
  round(sum(category_pnl_usd), 2) as total_category_pnl,

  sum(category_trade_count) as total_trades
FROM wallet_metrics_by_category
WHERE category_omega_ratio > 2.0
  AND category_trade_count >= 10
GROUP BY market_category
ORDER BY avg_omega DESC
LIMIT 20;
```

**What This Tells Us:**
- Which markets have the most skilled traders
- Category-specific performance (Politics vs Crypto vs Sports)
- Where to focus copy-trading resources

---

### Query 8.2: Tag Specialist Identification

**Question:** Who are the tag specialists? (>85% correctness on specific tags)

```sql
-- Note: Requires wallet_metrics_by_tag table
SELECT
  tag_name,
  wallet_address,
  round(tag_correctness_pct, 2) as correctness,
  round(tag_omega_ratio, 2) as omega,
  round(tag_roi_pct, 2) as roi_pct,
  tag_trade_count as trades,
  round(tag_pnl_usd, 2) as pnl
FROM wallet_metrics_by_tag
WHERE tag_correctness_pct > 85
  AND tag_trade_count >= 8
  AND tag_pnl_usd > 1000
ORDER BY tag_correctness_pct DESC, tag_omega_ratio DESC
LIMIT 50;
```

**What This Tells Us:**
- Insider/specialist identification (>85% = likely insider knowledge)
- High-conviction copy targets (copy 100% on their tags)
- Niche market opportunities

---

## Summary: Key Questions to Answer

| Question | Query | What We Learn |
|----------|-------|---------------|
| **What's the average Omega of top 50?** | 1.1 | Elite performance benchmark |
| **What's the average Omega of top 100 whales?** | 1.2 | Whether big money = skilled |
| **What's the win rate of the #1 wallet?** | 1.3 | Best-in-class characteristics |
| **How rare is Omega > 2.0?** | 2.1 | Market competitiveness |
| **Do more trades = better performance?** | 2.2 | Sample size vs skill |
| **How many pass all elite filters?** | 3.2 | Copy-tradeable population |
| **What Omega defines top 10%?** | 4.1 | Dynamic threshold setting |
| **How much capital can we deploy?** | 5.1 | Market size estimate |
| **What's the worst drawdown for elites?** | 6.1 | Downside risk |
| **Are top performers still active?** | 7.1 | Staleness check |
| **Which categories are most profitable?** | 8.1 | Resource allocation |

---

## Expected Benchmark Results

Based on theory and your conversation context:

| Metric | Predicted Range | If Actual Is... |
|--------|----------------|-----------------|
| **Median Omega (all wallets)** | 0.8 - 1.2 | <0.8: Very competitive market<br>>1.2: Easy alpha available |
| **Top 50 Avg Omega** | 3.0 - 5.0 | <2.5: Market efficient<br>>6.0: Insider dominated |
| **Top 50 Avg Win Rate** | 0.60 - 0.70 | <0.55: Payoff-driven<br>>0.75: Consistency-driven |
| **Elite Count (Omega>2, 20+ trades)** | 50 - 200 | <50: Too selective<br>>500: Not elite enough |
| **Top 100 Total P&L** | $500K - $5M | Addressable market size |
| **Top 10% Omega Threshold** | 1.8 - 2.3 | Dynamic filter cutoff |

---

## Next Steps After Running These Queries

1. **Document actual results** in `/docs/features/winner-baseline-results.md`
2. **Adjust copy-trading filters** based on percentile thresholds
3. **Identify specific wallets** to analyze deeper (Query 1.3)
4. **Build leaderboard views** with discovered thresholds
5. **Create dashboards** showing these metrics real-time

---

## How to Run These Queries

```bash
# Save queries to individual .sql files
# Run via ClickHouse client or TSX script

npx tsx scripts/run-winner-benchmarks.ts

# Or run individual queries:
clickhouse-client --query "$(cat docs/features/queries/query-1-1.sql)"
```

---

**Status:** 🔴 **READY TO RUN** once `wallet_metrics` table is populated
**Estimated Runtime:** 5-10 minutes for all queries
**Priority:** HIGH - Needed to validate copy-trading strategy assumptions

**Last Updated:** 2025-11-11
**Owner:** Claude 1
**Related Docs:**
- `/docs/features/leaderboard-metrics.md`
- `/docs/features/leaderboard-queries.md`
- `/docs/features/advanced-leaderboard-strategies.md` (to be created)
