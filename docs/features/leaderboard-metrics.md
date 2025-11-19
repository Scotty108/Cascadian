# Leaderboard Metrics Definitions

## Overview

This document defines all metrics used in the wallet metrics materialization and leaderboard system.

**Last Updated:** 2025-11-11
**Version:** 1.0

---

## Core Metrics

### realized_pnl

**Name:** Realized Profit & Loss
**Formula:** `SUM(cashflow_usdc)` for all closed positions
**Units:** USD
**Range:** (-∞, +∞)
**Interpretation:** Higher is better

**Description:**
Sum of all cash flows from completed trades and redemptions. Positive values indicate profitable trading, negative values indicate losses.

**Calculation:**
```sql
SELECT
  sum(toFloat64(cashflow_usdc)) as realized_pnl
FROM default.trades_raw
WHERE wallet = :wallet_address
  AND block_time >= :date_start
  AND condition_id NOT LIKE '%token_%'
```

**Example:**
- Wallet with +$50,000: Profitable trader
- Wallet with -$5,000: Net loss trader
- Wallet with $0: Break-even or no closed positions

---

### unrealized_payout

**Name:** Unrealized Payout
**Formula:** `SUM(net_shares × payout_vector[winning_index + 1] / payout_denominator)`
**Units:** USD
**Range:** [0, +∞)
**Interpretation:** Higher is better

**Description:**
Value of open positions based on resolved market outcomes. Represents potential payout from positions that haven't been redeemed yet.

**Calculation:**
```sql
SELECT
  sum(
    toFloat64(net_shares) *
    arrayElement(mr.payout_numerators, mr.winning_index + 1) /
    toFloat64(mr.payout_denominator)
  ) as unrealized_payout
FROM (
  SELECT
    wallet,
    condition_id_norm,
    SUM(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares))) as net_shares
  FROM default.trades_raw
  WHERE block_time >= :date_start
  GROUP BY wallet, condition_id_norm
  HAVING net_shares != 0
) positions
INNER JOIN default.market_resolutions_final mr
  ON positions.condition_id_norm = mr.condition_id_norm
WHERE mr.payout_denominator != 0
```

**Note:** ClickHouse arrays are 1-indexed, hence `winning_index + 1`

---

### roi_pct

**Name:** Return on Investment Percentage
**Formula:** `((realized_pnl + unrealized_payout) / cost_basis) × 100`
**Units:** Percentage (%)
**Range:** [-100, +∞)
**Interpretation:** Higher is better

**Description:**
Percentage return on total capital deployed. Measures efficiency of capital usage.

**Edge Cases:**
- `cost_basis = 0` → ROI = NULL (no investment)
- Negative ROI → Loss
- ROI < -100% → Invalid (clamped to -100%)

**Example:**
- ROI = 50%: Gained 50% return on investment
- ROI = -25%: Lost 25% of investment
- ROI = 0%: Break-even

---

### win_rate

**Name:** Win Rate
**Formula:** `COUNT(markets where pnl > 0) / COUNT(resolved markets)`
**Units:** Decimal (0.0-1.0)
**Range:** [0, 1]
**Interpretation:** Higher is better

**Description:**
Proportion of markets where the wallet achieved positive P&L. Measures consistency of profitable trades.

**Calculation:**
```typescript
const wins = markets.filter(m => m.pnl > 0).length;
const total = markets.filter(m => m.resolved).length;
const win_rate = total > 0 ? wins / total : 0;
```

**Example:**
- 0.75 (75%): Won 3 out of 4 markets
- 0.50 (50%): Won half of markets
- 0.20 (20%): Won 1 out of 5 markets

---

### sharpe_ratio

**Name:** Sharpe Ratio (Annualized)
**Formula:** `(mean_daily_pnl / stddev_daily_pnl) × sqrt(252)`
**Units:** Dimensionless
**Range:** Typically [-5, 10]
**Interpretation:** Higher is better

**Description:**
Risk-adjusted return metric. Measures excess return per unit of volatility. Higher Sharpe ratio indicates better risk-adjusted performance.

**Calculation:**
```typescript
const dailyReturns = calculateDailyPnL(trades);
const mean = average(dailyReturns);
const stddev = standardDeviation(dailyReturns);
const sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(252) : 0;
```

**Interpretation:**
- Sharpe > 2: Excellent risk-adjusted returns
- Sharpe 1-2: Good returns for risk taken
- Sharpe 0-1: Modest returns relative to risk
- Sharpe < 0: Negative returns

**Edge Cases:**
- `stddev = 0` → Sharpe = 0 (no volatility)
- Valid range: [-5, 10] (extreme values capped)

---

### omega_ratio

**Name:** Omega Ratio
**Formula:** `SUM(gains) / SUM(losses)` where threshold τ = 0
**Units:** Dimensionless
**Range:** [0, +∞)
**Interpretation:** Higher is better

**Description:**
Ratio of total gains to total losses. Measures the probability-weighted ratio of gains versus losses.

**Calculation:**
```typescript
const gains = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
const losses = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
const omega = losses > 0 ? gains / losses : null;
```

**Interpretation:**
- Omega > 1: More gains than losses (profitable)
- Omega = 1: Gains equal losses (break-even)
- Omega < 1: More losses than gains (unprofitable)
- Omega = 0: No gains (only losses)

**Edge Cases:**
- `losses = 0` and `gains > 0` → Omega = NULL (undefined, only winning trades)
- `losses = 0` and `gains = 0` → Omega = NULL (no trades)

**Minimum Trades:** Leaderboard requires ≥10 trades for statistical significance

---

## Activity Metrics

### total_trades

**Name:** Total Trade Count
**Units:** Integer
**Range:** [0, +∞)
**Interpretation:** Higher indicates more activity

**Description:**
Total number of trades (BUY and SELL) executed by the wallet in the time window.

---

### markets_traded

**Name:** Unique Markets Traded
**Units:** Integer
**Range:** [0, +∞)
**Interpretation:** Higher indicates diversification

**Description:**
Number of unique markets (condition_ids) the wallet has traded in.

**Calculation:**
```sql
SELECT count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets_traded
FROM default.trades_raw
WHERE wallet = :wallet_address
  AND block_time >= :date_start
```

---

## Computed Metrics

### total_pnl

**Name:** Total Profit & Loss
**Formula:** `realized_pnl + unrealized_payout`
**Units:** USD
**Range:** (-∞, +∞)
**Interpretation:** Higher is better

**Description:**
Combined P&L from both closed and open positions. Represents total performance.

**Note:** Not materialized in `wallet_metrics` table; calculated on-demand via Group 1 calculator.

---

## Leaderboard Filters

### Whale Leaderboard

- **Metric:** realized_pnl
- **Min Trades:** None
- **Ordering:** DESC by realized_pnl, then by total_trades

### Omega Leaderboard

- **Metric:** omega_ratio
- **Min Trades:** 10
- **Filter:** omega_ratio IS NOT NULL
- **Ordering:** DESC by omega_ratio

### ROI Leaderboard

- **Metric:** roi_pct
- **Min Trades:** 5
- **Filter:** roi_pct >= -100%
- **Ordering:** DESC by roi_pct

---

## Edge Cases & NULL Handling

| Metric | NULL Condition | Fallback |
|--------|---------------|----------|
| realized_pnl | Never NULL | Default 0 |
| unrealized_payout | No open positions | Default 0 |
| roi_pct | cost_basis = 0 | NULL |
| win_rate | No resolved markets | Default 0 |
| sharpe_ratio | stddev = 0 | Default 0 |
| omega_ratio | losses = 0 | NULL |
| total_trades | Never NULL | Default 0 |
| markets_traded | Never NULL | Default 0 |

---

## Validation

### Baseline Wallet

**Address:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
**Expected Total P&L:** -$27,558.71
**Breakdown:**
- Realized P&L: $210,582.33
- Unrealized Payout: -$238,141.04
- Total: -$27,558.71

---

## References

- **Calculation Engine:** `lib/clickhouse/metrics-calculator.ts`
- **Test Coverage:** `tests/phase2/task-group-1.test.ts` (6 focused tests)
- **Schema:** `docs/leaderboard-schema.md`
