# Leaderboard Example Queries

## Overview

This document provides executable SQL queries for common leaderboard and wallet metrics use cases.

**Last Updated:** 2025-11-11
**Version:** 1.0

---

## Query 1: Top 10 Whales by P&L

Get the top 10 wallets ranked by lifetime realized P&L.

**Use Case:** Display top performers on homepage

```sql
SELECT
  rank,
  wallet_address,
  realized_pnl,
  roi_pct,
  total_trades,
  markets_traded,
  win_rate
FROM default.whale_leaderboard
ORDER BY rank
LIMIT 10;
```

**Expected Row Count:** 10
**Performance:** <50ms

**Sample Output:**
| rank | wallet_address | realized_pnl | roi_pct | total_trades |
|------|---------------|--------------|---------|--------------|
| 1 | 0x4bfb41d5... | 3539088032.63 | 0.00 | 156789 |
| 2 | 0x... | ... | ... | ... |

---

## Query 2: Top 10 by Omega Ratio (Min 10 Trades)

Get wallets with best risk-adjusted performance (minimum 10 trades for significance).

**Use Case:** Find skilled traders (not just lucky ones)

```sql
SELECT
  rank,
  wallet_address,
  omega_ratio,
  sharpe_ratio,
  total_trades,
  win_rate,
  realized_pnl
FROM default.omega_leaderboard
WHERE total_trades >= 10
ORDER BY rank
LIMIT 10;
```

**Expected Row Count:** 10
**Performance:** <50ms

**Filter Logic:**
- Minimum 10 trades (statistical significance)
- omega_ratio IS NOT NULL
- Ranked by omega_ratio DESC

---

## Query 3: Wallet Metrics with Metadata JOIN

Get wallet metrics with optional metadata enrichment.

**Use Case:** Display wallet profile with market information

```sql
SELECT
  wm.wallet_address,
  wm.realized_pnl,
  wm.unrealized_payout,
  wm.realized_pnl + wm.unrealized_payout as total_pnl,
  wm.roi_pct,
  wm.total_trades,
  wm.markets_traded,
  wm.win_rate,
  wm.omega_ratio,
  wm.sharpe_ratio
FROM default.wallet_metrics wm
WHERE wm.wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND wm.time_window = 'lifetime';
```

**Expected Row Count:** 1
**Performance:** <10ms

**Note:** Metadata LEFT JOIN not available yet (no wallet_metadata table)

---

## Query 4: Export Leaderboard Snapshot (JSON Format)

Query pattern for exporting leaderboard data to JSON.

**Use Case:** API endpoint for leaderboard data

```sql
SELECT
  rank,
  wallet_address,
  realized_pnl,
  roi_pct,
  total_trades,
  markets_traded,
  win_rate,
  now() as exported_at
FROM default.whale_leaderboard
ORDER BY rank;
```

**Expected Row Count:** 50
**Performance:** <100ms

**Export Script:** `scripts/export-leaderboards-json.ts`

---

## Query 5: Trend Analysis (30d vs Lifetime)

Compare recent performance (30d) with lifetime performance.

**Use Case:** Identify hot/cold streaks

```sql
SELECT
  w30.wallet_address,
  w30.realized_pnl as pnl_30d,
  wlt.realized_pnl as pnl_lifetime,
  w30.realized_pnl - wlt.realized_pnl as pnl_change,
  w30.total_trades as trades_30d,
  wlt.total_trades as trades_lifetime,
  w30.win_rate as winrate_30d,
  wlt.win_rate as winrate_lifetime
FROM default.wallet_metrics w30
INNER JOIN default.wallet_metrics wlt
  ON w30.wallet_address = wlt.wallet_address
WHERE w30.time_window = '30d'
  AND wlt.time_window = 'lifetime'
  AND w30.total_trades >= 5
ORDER BY w30.realized_pnl DESC
LIMIT 20;
```

**Expected Row Count:** 20
**Performance:** <200ms

**Insights:**
- Wallets with positive `pnl_change`: Recent gains
- Wallets with `winrate_30d > winrate_lifetime`: Improving performance

---

## Query 6: Multi-Window Analysis

Get all time windows for a single wallet.

**Use Case:** Wallet detail page showing performance over time

```sql
SELECT
  time_window,
  realized_pnl,
  unrealized_payout,
  realized_pnl + unrealized_payout as total_pnl,
  roi_pct,
  win_rate,
  total_trades,
  markets_traded,
  omega_ratio,
  sharpe_ratio
FROM default.wallet_metrics
WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
ORDER BY
  CASE time_window
    WHEN '30d' THEN 1
    WHEN '90d' THEN 2
    WHEN '180d' THEN 3
    WHEN 'lifetime' THEN 4
  END;
```

**Expected Row Count:** 4 (one per window)
**Performance:** <10ms

**Sample Output:**
| time_window | realized_pnl | total_pnl | total_trades |
|-------------|--------------|-----------|--------------|
| 30d | 1234.56 | 1100.00 | 15 |
| 90d | 5678.90 | 4500.00 | 45 |
| 180d | 12345.67 | 10000.00 | 89 |
| lifetime | 210582.33 | -27558.71 | 523 |

---

## Query 7: Active Traders (30d Window)

Find wallets that are actively trading in the last 30 days.

**Use Case:** Identify current market participants

```sql
SELECT
  wallet_address,
  realized_pnl,
  total_trades,
  markets_traded,
  win_rate,
  calculated_at
FROM default.wallet_metrics
WHERE time_window = '30d'
  AND total_trades >= 10
ORDER BY total_trades DESC
LIMIT 50;
```

**Expected Row Count:** ≤50
**Performance:** <100ms

**Filter:** Minimum 10 trades in last 30 days

---

## Query 8: Diversification Analysis

Find wallets trading across many markets.

**Use Case:** Identify diversified traders

```sql
SELECT
  wallet_address,
  markets_traded,
  total_trades,
  realized_pnl,
  roi_pct,
  total_trades / markets_traded as avg_trades_per_market
FROM default.wallet_metrics
WHERE time_window = 'lifetime'
  AND markets_traded >= 20
ORDER BY markets_traded DESC
LIMIT 30;
```

**Expected Row Count:** ≤30
**Performance:** <100ms

**Insight:** High `markets_traded` indicates diversification strategy

---

## Query 9: High Win Rate Traders

Find wallets with exceptional win rates.

**Use Case:** Identify accurate predictors

```sql
SELECT
  wallet_address,
  win_rate,
  total_trades,
  realized_pnl,
  markets_traded
FROM default.wallet_metrics
WHERE time_window = 'lifetime'
  AND total_trades >= 20
  AND win_rate >= 0.70
ORDER BY win_rate DESC, total_trades DESC
LIMIT 25;
```

**Expected Row Count:** ≤25
**Performance:** <100ms

**Filter:**
- Minimum 20 trades (significance threshold)
- Win rate ≥70%

---

## Query 10: ROI Leaders

Get top performers by return on investment.

**Use Case:** Find efficient capital allocators

```sql
SELECT
  rank,
  wallet_address,
  roi_pct,
  realized_pnl,
  total_trades,
  markets_traded
FROM default.roi_leaderboard
WHERE total_trades >= 5
ORDER BY rank
LIMIT 10;
```

**Expected Row Count:** 10
**Performance:** <50ms

**Note:** ROI leaderboard already filters for valid ROI (≥-100%) and minimum 5 trades

---

## Performance Notes

### Index Usage

All queries leverage the primary index: `(wallet_address, time_window)`

**Fast Queries:**
- Single wallet lookup: <10ms
- Leaderboard views: <50ms
- Multi-wallet JOIN: <200ms

**Slow Queries (Avoid):**
- Full table scans without time_window filter
- Aggregations across all wallets without WHERE clause

### Query Optimization Tips

1. **Always filter by time_window** when possible
2. **Use leaderboard views** instead of querying wallet_metrics directly for rankings
3. **Limit result sets** - Add LIMIT clause to prevent large transfers
4. **Index-friendly JOINs** - JOIN on wallet_address for best performance

---

## Common Patterns

### Dashboard Widget Pattern

```sql
-- Top performers + recent activity
WITH top_whales AS (
  SELECT * FROM default.whale_leaderboard LIMIT 5
),
recent_activity AS (
  SELECT wallet_address, total_trades
  FROM default.wallet_metrics
  WHERE time_window = '30d' AND total_trades > 0
  ORDER BY total_trades DESC
  LIMIT 5
)
SELECT * FROM top_whales
UNION ALL
SELECT * FROM recent_activity;
```

### Wallet Comparison Pattern

```sql
SELECT
  wallet_address,
  time_window,
  realized_pnl,
  win_rate,
  total_trades
FROM default.wallet_metrics
WHERE wallet_address IN (
  '0xwallet1',
  '0xwallet2',
  '0xwallet3'
)
ORDER BY wallet_address, time_window;
```

---

## Export Queries

### CSV Export (Flat)

See: `scripts/export-wallet-metrics-csv.ts`

```sql
SELECT
  wallet_address,
  time_window,
  realized_pnl,
  unrealized_payout,
  roi_pct,
  win_rate,
  sharpe_ratio,
  omega_ratio,
  total_trades,
  markets_traded,
  calculated_at
FROM default.wallet_metrics
ORDER BY wallet_address, time_window;
```

**Output:** 3,693,596 rows (all wallets × all windows)

### JSON Export (Nested)

See: `scripts/export-wallet-metrics-json.ts`

Exports top 1,000 wallets by P&L in nested JSON format.

---

## References

- **Schema:** `docs/leaderboard-schema.md`
- **Metrics:** `docs/leaderboard-metrics.md`
- **API Guide:** `docs/leaderboard-api-integration.md`
