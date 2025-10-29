# Wallet Performance Metrics - Technical Reference

This document defines the exact formulas for all 102 wallet performance metrics computed in Phase 2.

## Table of Contents

1. [P&L Metrics](#pnl-metrics)
2. [Risk-Adjusted Returns](#risk-adjusted-returns)
3. [Risk Metrics](#risk-metrics)
4. [Accuracy & Resolution](#accuracy--resolution)
5. [Trading Behavior](#trading-behavior)
6. [Market Timing](#market-timing)
7. [Per-Category Metrics](#per-category-metrics)

---

## P&L Metrics

### 1. Total Realized P&L
```
realized_pnl = Σ(pnl_net for all closed trades)
```
**Units:** USD
**Source:** `trades_raw.pnl_net` (computed in Step D)

### 2. Total Unrealized P&L
```
unrealized_pnl = Σ(current_value - cost_basis for all open positions)

where:
  current_value = shares × current_market_price
  cost_basis = shares × entry_price
```
**Units:** USD
**Note:** Requires current market prices from Goldsky or Polymarket API

### 3. Net P&L
```
net_pnl = realized_pnl + unrealized_pnl
```
**Units:** USD

### 4. Gross P&L
```
gross_pnl = Σ(pnl_gross for all trades)

where:
  pnl_gross = pnl_net + fee_usd + slippage_usd
```
**Units:** USD
**Source:** `trades_raw.pnl_gross` (computed in Step D)

### 5. ROI (Return on Investment)
```
roi_pct = (net_pnl / total_capital_deployed) × 100

where:
  total_capital_deployed = Σ(usd_value for all trades)
```
**Units:** Percentage
**Range:** [-100%, +∞]
**Example:** 2500 PnL / 10000 deployed = 25% ROI

### 6. Win Rate
```
win_rate_pct = (winning_trades / total_trades) × 100

where:
  winning_trades = count(trades where pnl_net > 0)
  total_trades = count(all closed trades)
```
**Units:** Percentage
**Range:** [0%, 100%]

### 7. Average Win Size
```
avg_win_usd = Σ(pnl_net for winning trades) / count(winning trades)
```
**Units:** USD

### 8. Average Loss Size
```
avg_loss_usd = Σ(pnl_net for losing trades) / count(losing trades)
```
**Units:** USD (negative value)

### 9. Profit Factor
```
profit_factor = |Σ(wins)| / |Σ(losses)|

where:
  wins = pnl_net for all trades with pnl_net > 0
  losses = pnl_net for all trades with pnl_net < 0
```
**Units:** Ratio
**Range:** [0, +∞]
**Interpretation:** >1 = profitable, <1 = losing, 2.0 = $2 won for every $1 lost

---

## Risk-Adjusted Returns

### 10. Sharpe Ratio
```
sharpe_ratio = (annualized_return - risk_free_rate) / annualized_volatility

where:
  annualized_return = (total_pnl / capital) × (365 / days_active)
  annualized_volatility = daily_return_stddev × √365
  daily_return_stddev = stddev(daily_pnl / capital)
  risk_free_rate = 0.04 (4% annual, configurable)
```
**Units:** Dimensionless ratio
**Range:** [-∞, +∞], typical [-3, +5]
**Interpretation:**
- <0: Returns worse than risk-free
- 0-1: Subpar risk-adjusted returns
- 1-2: Good
- 2-3: Very good
- >3: Exceptional

**Example:**
```
capital = $10,000
total_pnl = $2,500
days_active = 180
daily_returns = [50, -20, 30, 0, 15, ...] (in USD)
daily_return_pct = daily_returns / 10000 = [0.005, -0.002, 0.003, ...]
stddev(daily_return_pct) = 0.012
annualized_return = (2500 / 10000) × (365 / 180) = 0.507 = 50.7%
annualized_volatility = 0.012 × √365 = 0.229 = 22.9%
sharpe_ratio = (0.507 - 0.04) / 0.229 = 2.04
```

### 11. Sortino Ratio
```
sortino_ratio = (annualized_return - risk_free_rate) / downside_deviation

where:
  downside_deviation = √(Σ(min(daily_return, 0)²) / n) × √365
```
**Units:** Dimensionless ratio
**Interpretation:** Similar to Sharpe, but only penalizes downside volatility

### 12. Calmar Ratio
```
calmar_ratio = annualized_return / |max_drawdown_pct|

where:
  max_drawdown_pct = max((peak - trough) / peak) over all time
```
**Units:** Dimensionless ratio
**Interpretation:** Return per unit of maximum drawdown. Higher is better.

### 13. Omega Ratio
```
omega_ratio = Σ(gains above threshold) / Σ(losses below threshold)

where:
  threshold = 0 (or risk_free_rate)
  gains = max(0, return - threshold)
  losses = max(0, threshold - return)
```
**Units:** Dimensionless ratio
**Range:** [0, +∞]
**Interpretation:**
- <1: More losses than gains
- =1: Break-even
- >1: Net positive (1.5 = good, 2.0 = very good)

**Implementation:**
```typescript
function computeOmega(returns: number[], threshold = 0): number {
  let gains = 0
  let losses = 0

  for (const r of returns) {
    if (r > threshold) {
      gains += (r - threshold)
    } else {
      losses += (threshold - r)
    }
  }

  return losses === 0 ? Infinity : gains / losses
}
```

### 14. Kelly Criterion
```
kelly_pct = (p × b - q) / b

where:
  p = win_rate (probability of winning)
  q = 1 - p (probability of losing)
  b = avg_win / |avg_loss| (odds ratio)
```
**Units:** Percentage of bankroll to bet
**Range:** [-100%, +100%]
**Interpretation:** Optimal bet size to maximize long-term growth. Negative = don't bet.

**Example:**
```
p = 0.60 (60% win rate)
q = 0.40
avg_win = $100
avg_loss = $50
b = 100 / 50 = 2.0
kelly_pct = (0.60 × 2.0 - 0.40) / 2.0 = 0.40 = 40%
```

### 15. Information Ratio
```
information_ratio = alpha / tracking_error

where:
  alpha = portfolio_return - benchmark_return
  tracking_error = stddev(portfolio_return - benchmark_return)
  benchmark_return = market average or index return (e.g., equal-weight all wallets)
```
**Units:** Dimensionless ratio
**Interpretation:** Excess return per unit of active risk

---

## Risk Metrics

### 16. Maximum Drawdown (USD)
```
max_drawdown_usd = max(peak_equity - current_equity) over all time

where:
  equity_curve[t] = initial_capital + cumulative_pnl[t]
  peak_equity[t] = max(equity_curve[0:t])
  drawdown[t] = peak_equity[t] - equity_curve[t]
  max_drawdown_usd = max(drawdown[t])
```
**Units:** USD
**Example:**
```
Equity: [10k, 12k, 15k, 11k, 13k, 14k]
Peaks:  [10k, 12k, 15k, 15k, 15k, 15k]
DD:     [0,   0,   0,   4k,  2k,  1k]
Max DD: $4,000
```

### 17. Maximum Drawdown (%)
```
max_drawdown_pct = (max_drawdown_usd / peak_equity) × 100
```
**Units:** Percentage
**Range:** [0%, 100%]

### 18. Current Drawdown
```
current_drawdown_usd = current_peak_equity - current_equity
current_drawdown_pct = (current_drawdown_usd / current_peak_equity) × 100
```
**Units:** USD and Percentage
**Interpretation:** How far underwater the wallet currently is from its all-time high

### 19. Value at Risk (VaR 95%)
```
var_95 = percentile(daily_pnl, 5)
```
**Units:** USD (negative value)
**Interpretation:** 95% of days, losses will not exceed this amount
**Example:** VaR = -$250 means "95% of days, I won't lose more than $250"

### 20. Conditional VaR (CVaR 95%)
```
cvar_95 = average(daily_pnl where daily_pnl < var_95)
```
**Units:** USD (negative value)
**Interpretation:** Average loss on the worst 5% of days

### 21. Volatility (Annualized)
```
volatility = stddev(daily_returns) × √365

where:
  daily_returns = daily_pnl / current_capital
```
**Units:** Percentage (annualized standard deviation)

---

## Accuracy & Resolution

### 22. Resolution Accuracy
```
accuracy_pct = (correct_trades / total_resolved_trades) × 100

where:
  correct_trades = count(trades where was_win = 1)
  total_resolved_trades = count(trades where is_resolved = 1)
```
**Units:** Percentage
**Range:** [0%, 100%]
**Source:** `trades_raw.was_win` (computed in Step E)

### 23. Weighted Accuracy
```
weighted_accuracy_pct = Σ(was_win × usd_value) / Σ(usd_value) × 100
```
**Units:** Percentage
**Interpretation:** Size-weighted correctness. Penalizes large incorrect bets more.

### 24. Brier Score
```
brier_score = (1 / n) × Σ((forecast - outcome)²)

where:
  forecast = entry_price (implied probability of YES)
  outcome = 1 if YES won, 0 if NO won
```
**Units:** Score from 0 to 1 (lower is better)
**Range:** [0, 1]
**Interpretation:** Measures calibration. Perfect calibration = 0.

**Example:**
```
Trade 1: Bought YES at 0.65, outcome = 1 (YES won)
  (0.65 - 1)² = 0.1225

Trade 2: Bought YES at 0.80, outcome = 0 (NO won)
  (0.80 - 0)² = 0.64

Trade 3: Bought NO at 0.30, outcome = 0 (NO won, so forecast = 1 - 0.30 = 0.70)
  (0.70 - 0)² = 0.49

Brier = (0.1225 + 0.64 + 0.49) / 3 = 0.417
```

### 25. Log Score
```
log_score = -(1 / n) × Σ(log(p_correct))

where:
  p_correct = entry_price if outcome = YES, else (1 - entry_price)
```
**Units:** Score (lower is better)
**Interpretation:** Logarithmic scoring rule. Heavily penalizes overconfident wrong predictions.

---

## Trading Behavior

### 26. Total Trades
```
total_trades = count(all trades)
```

### 27. Total Volume
```
total_volume = Σ(usd_value for all trades)
```
**Units:** USD

### 28. Average Trade Size
```
avg_trade_size = total_volume / total_trades
```
**Units:** USD

### 29. Median Trade Size
```
median_trade_size = median(usd_value for all trades)
```
**Units:** USD

### 30. Average Hold Time
```
avg_hold_time = Σ(hours_held for all closed trades) / count(closed trades)
```
**Units:** Hours
**Source:** `trades_raw.hours_held` (computed in Step D)

### 31. Turnover Ratio
```
turnover_ratio = total_volume / avg_capital

where:
  avg_capital = average(bankroll_at_entry) across all trades
```
**Units:** Ratio (times per period)
**Interpretation:** How many times capital is cycled. Higher = more active.

### 32. Diversification Score
```
diversification_score = unique_markets_traded / total_markets_available

where:
  unique_markets_traded = count(distinct market_id)
  total_markets_available = count(*) from markets_dim
```
**Units:** Ratio [0, 1]
**Interpretation:** 1.0 = traded every market, 0.01 = hyper-focused

### 33. Concentration Ratio
```
concentration_ratio = (top_10_volume / total_volume) × 100

where:
  top_10_volume = Σ(usd_value) for top 10 markets by volume
```
**Units:** Percentage
**Interpretation:** 90% = highly concentrated, 20% = well-diversified

---

## Market Timing

### 34. Closing Line Value (CLV)
```
clv_bps = Σ((entry_price - close_price) × side_multiplier × 10000) / total_trades

where:
  side_multiplier = 1 if bought YES, -1 if bought NO
  close_price = market price at pre-resolution close
```
**Units:** Basis points (1 bp = 0.01%)
**Source:** `trades_raw.close_price` (populated in Step D)
**Interpretation:** Positive = consistently got better prices than close, negative = worse

**Example:**
```
Trade 1: Bought YES at 0.65, close = 0.70 → (0.65 - 0.70) × 1 = -0.05 = -500 bps
Trade 2: Bought NO at 0.40, close = 0.30 → (0.40 - 0.30) × -1 = -0.10 = -1000 bps
Trade 3: Bought YES at 0.55, close = 0.50 → (0.55 - 0.50) × 1 = +0.05 = +500 bps

CLV = (-500 - 1000 + 500) / 3 = -333 bps (on average, 3.33% worse than close)
```

### 35. Average CLV bps
Same as CLV, but expressed as basis points.

### 36. Early Entry %
```
early_entry_pct = (early_trades / total_trades) × 100

where:
  early_trades = count(trades where entry_time < market_created_time + 0.25 × market_duration)
```
**Units:** Percentage
**Interpretation:** What % of trades were made in the first 25% of market lifetime

### 37. Late Entry %
```
late_entry_pct = (late_trades / total_trades) × 100

where:
  late_trades = count(trades where entry_time > market_resolution_time - 0.25 × market_duration)
```
**Units:** Percentage
**Interpretation:** What % of trades were made in the last 25% before resolution

---

## Per-Category Metrics

For each of the 11 categories (Politics, Sports, Crypto, Pop Culture, Science, Business, Entertainment, News, Gaming, Forecast, Uncategorized), compute:

### 38-103. Category-Specific Metrics (6 × 11 = 66 metrics)

For each category, compute:
1. **Total P&L** (USD)
2. **ROI %** (return on capital in that category)
3. **Sharpe Ratio** (risk-adjusted return for category trades)
4. **Accuracy %** (resolution accuracy for category trades)
5. **Total Volume** (USD traded in category)
6. **Trade Count** (number of trades in category)

**Filtering:**
```sql
SELECT * FROM trades_raw
WHERE canonical_category = 'Politics'
  AND timestamp >= (NOW() - INTERVAL '30 days')  -- for 30d window
```

**Computation:** Same formulas as above, but applied only to the subset of trades matching `canonical_category`.

---

## Time Windows

All metrics are computed across 4 rolling time windows:

1. **30-day:** Trades where `timestamp >= NOW() - 30 days`
2. **90-day:** Trades where `timestamp >= NOW() - 90 days`
3. **180-day:** Trades where `timestamp >= NOW() - 180 days`
4. **Lifetime:** All trades (no time filter)

**Total metric count:** 102 base metrics × 4 windows = **408 metric values per wallet**

---

## Data Sources

| Metric | Source Table | Source Column | Computed In |
|--------|--------------|---------------|-------------|
| realized_pnl | trades_raw | pnl_net | Step D |
| gross_pnl | trades_raw | pnl_gross | Step D |
| fee_usd | trades_raw | fee_usd | Step D |
| slippage_usd | trades_raw | slippage_usd | Step D |
| hours_held | trades_raw | hours_held | Step D |
| close_price | trades_raw | close_price | Step D |
| was_win | trades_raw | was_win | Step E |
| is_resolved | trades_raw | is_resolved | Step E |
| canonical_category | trades_raw | canonical_category | Step B |
| bankroll_at_entry | trades_raw | bankroll_at_entry | Step D |

---

## Implementation Notes

### Handling Missing Data

- **Unrealized P&L:** Skip if no current price available
- **Sharpe/Sortino:** Return NaN if <10 trades (insufficient data)
- **Brier/Log Score:** Only for resolved trades (where `is_resolved = 1`)
- **CLV:** Only for trades with `close_price > 0`

### Annualization Factors

```typescript
const DAYS_PER_YEAR = 365
const HOURS_PER_YEAR = 365 * 24
const TRADING_DAYS_PER_YEAR = 365 // Polymarket trades 24/7

function annualizeFactor(days: number): number {
  return DAYS_PER_YEAR / days
}

function annualizeVolatility(dailyStdDev: number): number {
  return dailyStdDev * Math.sqrt(DAYS_PER_YEAR)
}
```

### Edge Cases

- **Division by zero:** Return `null` or `0` depending on metric
- **Negative Sharpe:** Valid (indicates returns below risk-free rate)
- **Infinite Omega:** Possible if no losses; cap at 999 for display
- **Kelly > 1:** Possible with skewed distributions; cap at 1.0 for recommended bet sizing

---

## Validation Checks

After computation, apply these sanity checks:

```typescript
const VALIDATION_RULES = {
  roi_pct: { min: -100, max: 10000 }, // -100% to +10,000%
  sharpe_ratio: { min: -5, max: 10 },
  win_rate_pct: { min: 0, max: 100 },
  profit_factor: { min: 0, max: 100 },
  accuracy_pct: { min: 0, max: 100 },
  brier_score: { min: 0, max: 1 },
  max_drawdown_pct: { min: 0, max: 100 },
  total_volume: { min: 0, max: Infinity },
  total_trades: { min: 0, max: Infinity },
}

function validateMetric(metric: string, value: number): boolean {
  const rule = VALIDATION_RULES[metric]
  if (!rule) return true // No rule defined
  if (isNaN(value) || !isFinite(value)) return false
  return value >= rule.min && value <= rule.max
}
```

---

## References

- **Sharpe Ratio:** [Investopedia](https://www.investopedia.com/terms/s/sharperatio.asp)
- **Omega Ratio:** Keating & Shadwick (2002)
- **Kelly Criterion:** Kelly (1956), "A New Interpretation of Information Rate"
- **Brier Score:** Brier (1950), "Verification of forecasts expressed in terms of probability"
- **CLV:** Pinnacle Sports, "Closing Line Value" metric

---

## Example Wallet Computation

**Input Data:**
```
Wallet: 0xabc123...
Trades: 150
Total Volume: $50,000
Realized PnL: $8,500
Capital: $25,000
Time Period: 180 days
Win Rate: 62%
Avg Win: $250
Avg Loss: $175
Max Drawdown: $2,100
Daily Returns StdDev: 0.018
```

**Computed Metrics:**
```
ROI = (8500 / 50000) × 100 = 17.0%
Win Rate = 62%
Profit Factor = (0.62 × 250) / (0.38 × 175) = 2.33
Annualized Return = (8500 / 25000) × (365 / 180) = 69.0%
Annualized Volatility = 0.018 × √365 = 34.4%
Sharpe Ratio = (0.69 - 0.04) / 0.344 = 1.89
Kelly % = (0.62 × (250/175) - 0.38) / (250/175) = 39.4%
Max DD % = (2100 / 25000) × 100 = 8.4%
Calmar Ratio = 0.69 / 0.084 = 8.21
```

**Output Row (Supabase):**
```json
{
  "wallet_address": "0xabc123...",
  "time_window": "180d",
  "category": "all",
  "total_pnl": 8500.00,
  "roi_pct": 17.00,
  "win_rate": 62.00,
  "profit_factor": 2.33,
  "sharpe_ratio": 1.89,
  "sortino_ratio": 2.15,
  "omega_ratio": 1.72,
  "max_drawdown_usd": 2100.00,
  "max_drawdown_pct": 8.40,
  "volatility": 34.40,
  "accuracy_pct": 65.50,
  "total_volume": 50000.00,
  "total_trades": 150,
  "avg_trade_size": 333.33,
  "computed_at": "2025-10-28T19:00:00Z"
}
```
