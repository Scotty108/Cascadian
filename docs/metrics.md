# Wallet Performance Metrics

This document defines the 102 wallet metrics tracked across 4 time windows.

## Time Windows

All metrics are computed across these time periods:
- **30d**: Last 30 days
- **90d**: Last 90 days
- **180d**: Last 180 days
- **lifetime**: All historical data

## Metric Categories

### 1. Basic P&L Metrics (12 metrics = 3 × 4 windows)

**Metrics:**
- `total_pnl_usd` - Total realized profit/loss in USD
- `total_volume_usd` - Total trading volume in USD
- `roi_pct` - Return on investment percentage

**Formulas:**
```sql
total_pnl_usd = SUM(realized_pnl_usd)
total_volume_usd = SUM(usd_value)
roi_pct = (total_pnl_usd / total_volume_usd) * 100
```

### 2. Resolution Accuracy Metrics (8 metrics = 2 × 4 windows)

**Metrics:**
- `resolution_accuracy_pct` - Percentage of correct predictions
- `conviction_score` - Weighted accuracy by position size

**Formulas:**
```sql
resolution_accuracy_pct = AVG(won) * 100
  WHERE won = 1 if final_side === resolved_outcome, else 0

conviction_score = SUM(won * net_shares) / SUM(net_shares)
  Range: 0.0 to 1.0 (higher = better conviction)
```

### 3. Sharpe Ratio (4 metrics = 1 × 4 windows)

**Definition:** Risk-adjusted return, measuring excess return per unit of volatility.

**Formula:**
```
Sharpe = (Average Daily Return - Risk-Free Rate) / Std Dev of Daily Returns

Where:
- Daily Return = (day_end_portfolio_value - day_start_portfolio_value) / day_start_portfolio_value
- Risk-Free Rate = 0.0 (assumed for crypto prediction markets)
- Std Dev = Standard deviation of daily returns
```

**Interpretation:**
- `< 0`: Negative returns
- `0 - 1`: Subpar performance
- `1 - 2`: Good performance
- `2 - 3`: Very good performance
- `> 3`: Exceptional performance

**SQL Sketch:**
```sql
WITH daily_returns AS (
  SELECT
    wallet_address,
    DATE(timestamp) as trade_date,
    SUM(realized_pnl_usd) as daily_pnl
  FROM trades_raw
  WHERE timestamp >= NOW() - INTERVAL 30 DAY
  GROUP BY wallet_address, trade_date
)
SELECT
  wallet_address,
  AVG(daily_pnl) / STDDEV_POP(daily_pnl) as sharpe_ratio_30d
FROM daily_returns
GROUP BY wallet_address
```

### 4. Omega Ratio (4 metrics = 1 × 4 windows)

**Definition:** Probability-weighted ratio of gains vs losses relative to a threshold.

**Formula:**
```
Omega = SUM(MAX(return - threshold, 0)) / SUM(MAX(threshold - return, 0))

Where:
- threshold = 0 (target return, typically 0% for break-even)
- return = individual trade P&L
```

**Interpretation:**
- `< 1`: Expected losses exceed gains
- `= 1`: Break-even
- `> 1`: Expected gains exceed losses
- `> 2`: Strong positive expectancy

**SQL Sketch:**
```sql
WITH trade_returns AS (
  SELECT
    wallet_address,
    realized_pnl_usd,
    GREATEST(realized_pnl_usd, 0) as gains,
    GREATEST(-realized_pnl_usd, 0) as losses
  FROM trades_raw
  WHERE is_resolved = 1
    AND timestamp >= NOW() - INTERVAL 30 DAY
)
SELECT
  wallet_address,
  SUM(gains) / NULLIF(SUM(losses), 0) as omega_ratio_30d
FROM trade_returns
GROUP BY wallet_address
```

### 5. Kelly Criterion (4 metrics = 1 × 4 windows)

**Definition:** Optimal bet sizing based on win rate and average win/loss ratio.

**Formula:**
```
Kelly % = (win_rate * avg_win - (1 - win_rate) * avg_loss) / avg_win

Where:
- win_rate = winning_trades / total_trades
- avg_win = AVG(pnl WHERE pnl > 0)
- avg_loss = ABS(AVG(pnl WHERE pnl < 0))
```

**Interpretation:**
- `< 0`: Negative expectancy, should not bet
- `0 - 0.10`: Low edge, bet 0-10% of bankroll
- `0.10 - 0.25`: Moderate edge, bet 10-25%
- `> 0.25`: Strong edge (or overconfidence)

**SQL Sketch:**
```sql
WITH trade_outcomes AS (
  SELECT
    wallet_address,
    countIf(realized_pnl_usd > 0) as winning_trades,
    count() as total_trades,
    avgIf(realized_pnl_usd, realized_pnl_usd > 0) as avg_win,
    abs(avgIf(realized_pnl_usd, realized_pnl_usd < 0)) as avg_loss
  FROM trades_raw
  WHERE is_resolved = 1
    AND timestamp >= NOW() - INTERVAL 30 DAY
  GROUP BY wallet_address
)
SELECT
  wallet_address,
  (winning_trades / total_trades * avg_win -
   (1 - winning_trades / total_trades) * avg_loss) / avg_win as kelly_pct_30d
FROM trade_outcomes
```

### 6. Maximum Drawdown (4 metrics = 1 × 4 windows)

**Definition:** Largest peak-to-trough decline in cumulative P&L.

**Formula:**
```
Max Drawdown = (Trough Value - Peak Value) / Peak Value * 100

Process:
1. Calculate cumulative P&L at each trade
2. Track running maximum (peak)
3. Calculate drawdown at each point: (cumulative - peak) / peak
4. Return minimum (most negative) drawdown
```

**Interpretation:**
- `-5%`: Shallow drawdown, low volatility
- `-10% to -20%`: Moderate drawdown, typical
- `-30% to -50%`: Deep drawdown, high risk
- `> -50%`: Severe drawdown, possible ruin

**SQL Sketch:**
```sql
WITH cumulative_pnl AS (
  SELECT
    wallet_address,
    timestamp,
    SUM(realized_pnl_usd) OVER (
      PARTITION BY wallet_address
      ORDER BY timestamp
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) as cum_pnl
  FROM trades_raw
  WHERE is_resolved = 1
    AND timestamp >= NOW() - INTERVAL 30 DAY
),
running_max AS (
  SELECT
    wallet_address,
    timestamp,
    cum_pnl,
    MAX(cum_pnl) OVER (
      PARTITION BY wallet_address
      ORDER BY timestamp
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) as peak_pnl
  FROM cumulative_pnl
),
drawdowns AS (
  SELECT
    wallet_address,
    (cum_pnl - peak_pnl) / NULLIF(ABS(peak_pnl), 0) * 100 as drawdown_pct
  FROM running_max
  WHERE peak_pnl != 0
)
SELECT
  wallet_address,
  MIN(drawdown_pct) as max_drawdown_pct_30d
FROM drawdowns
GROUP BY wallet_address
```

### 7. Category-Specific Metrics (70 metrics = 14 × 5 categories)

**Categories:**
- Politics
- Crypto
- Sports
- Pop Culture
- Business & Finance
- (Plus 3 more from canonical mapping)

**Per-Category Metrics (14 metrics each):**
- `category_pnl_usd` - Total P&L in this category
- `category_volume_usd` - Total volume in this category
- `category_roi_pct` - ROI for this category
- `category_resolution_accuracy_pct` - Accuracy in this category
- `category_trade_count` - Number of trades
- `category_win_rate_pct` - Percentage of winning trades
- `category_avg_position_size_usd` - Average position size
- `category_sharpe_ratio` - Risk-adjusted return
- `category_omega_ratio` - Gain/loss ratio
- `category_kelly_pct` - Optimal bet sizing
- `category_max_drawdown_pct` - Worst decline
- `category_total_markets` - Markets traded
- `category_avg_hold_time_hours` - Average holding period
- `category_volume_pct` - % of total volume

**Note:** Only computed for lifetime window (not per time window) to reduce cardinality.

## Metric Tables

### `wallet_metrics_summary`

**Columns:**
```sql
CREATE TABLE wallet_metrics_summary (
  wallet_address String,
  window String,  -- '30d', '90d', '180d', 'lifetime'

  -- Basic P&L
  total_pnl_usd Float64,
  total_volume_usd Float64,
  roi_pct Float64,

  -- Resolution Accuracy
  resolution_accuracy_pct Float64,
  conviction_score Float64,

  -- Risk Metrics
  sharpe_ratio Float64,
  omega_ratio Float64,
  kelly_pct Float64,
  max_drawdown_pct Float64,

  -- Activity
  trade_count UInt32,
  markets_traded UInt32,
  win_rate_pct Float64,

  -- Timestamps
  computed_at DateTime,

  PRIMARY KEY (wallet_address, window)
) ENGINE = MergeTree()
ORDER BY (wallet_address, window)
```

### `wallet_metrics_by_category`

**Columns:**
```sql
CREATE TABLE wallet_metrics_by_category (
  wallet_address String,
  canonical_category String,

  -- Category-specific metrics (lifetime only)
  category_pnl_usd Float64,
  category_volume_usd Float64,
  category_roi_pct Float64,
  category_resolution_accuracy_pct Float64,
  category_trade_count UInt32,
  category_win_rate_pct Float64,
  category_avg_position_size_usd Float64,
  category_sharpe_ratio Float64,
  category_omega_ratio Float64,
  category_kelly_pct Float64,
  category_max_drawdown_pct Float64,
  category_total_markets UInt32,
  category_avg_hold_time_hours Float64,
  category_volume_pct Float64,

  -- Timestamps
  computed_at DateTime,

  PRIMARY KEY (wallet_address, canonical_category)
) ENGINE = MergeTree()
ORDER BY (wallet_address, canonical_category)
```

## Implementation Notes

1. **Incremental Updates**: Metrics should be recomputed daily via overnight orchestrator
2. **Null Handling**: Return NULL for metrics where denominator is 0 or insufficient data
3. **Performance**: Use materialized views or pre-aggregated tables for common queries
4. **Data Quality**: Require minimum trade count (e.g., 10 trades) before computing ratios
5. **Category Filtering**: Only compute category metrics for categories with >= 5 trades

## Query Examples

### Top 10 Wallets by 30-Day Sharpe Ratio
```sql
SELECT
  wallet_address,
  sharpe_ratio,
  total_pnl_usd,
  resolution_accuracy_pct
FROM wallet_metrics_summary
WHERE window = '30d'
  AND trade_count >= 10
ORDER BY sharpe_ratio DESC
LIMIT 10
```

### Best Category for a Wallet
```sql
SELECT
  canonical_category,
  category_roi_pct,
  category_resolution_accuracy_pct,
  category_trade_count
FROM wallet_metrics_by_category
WHERE wallet_address = '0xABC...'
  AND category_trade_count >= 5
ORDER BY category_roi_pct DESC
LIMIT 1
```

### High-Conviction Politics Traders
```sql
SELECT
  wallet_address,
  category_resolution_accuracy_pct,
  category_volume_usd,
  category_kelly_pct
FROM wallet_metrics_by_category
WHERE canonical_category = 'Politics'
  AND category_trade_count >= 20
  AND category_resolution_accuracy_pct >= 70
ORDER BY category_volume_usd DESC
LIMIT 25
```

## References

- **Sharpe Ratio**: Sharpe, W. F. (1966). "Mutual Fund Performance". Journal of Business.
- **Omega Ratio**: Keating & Shadwick (2002). "A Universal Performance Measure". Journal of Performance Measurement.
- **Kelly Criterion**: Kelly, J. (1956). "A New Interpretation of Information Rate". Bell System Technical Journal.
- **Drawdown**: Magdon-Ismail et al. (2004). "On the Maximum Drawdown of a Brownian Motion".
