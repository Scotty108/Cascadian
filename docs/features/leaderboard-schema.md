# Leaderboard Schema Documentation

## Overview

This document describes the schema for the wallet metrics materialization and leaderboard views in Phase 2.

**Last Updated:** 2025-11-11
**Schema Version:** 1.0

---

## Tables

### `wallet_metrics`

Primary materialized table containing wallet performance metrics across multiple time windows.

**Engine:** ReplacingMergeTree(updated_at)
**Order Key:** (wallet_address, time_window)
**Partition By:** time_window
**Primary Key:** (wallet_address, time_window)

#### Schema

| Column | Type | Description | Default | Nullable |
|--------|------|-------------|---------|----------|
| `wallet_address` | String | Wallet address (lowercase, checksummed) | - | NO |
| `time_window` | Enum8 | Time window: '30d', '90d', '180d', 'lifetime' | - | NO |
| `realized_pnl` | Float64 | Realized profit/loss from closed positions (USD) | 0 | NO |
| `unrealized_payout` | Float64 | Unrealized payout from open positions (USD) | 0 | NO |
| `roi_pct` | Float64 | Return on investment percentage | 0 | NO |
| `win_rate` | Float64 | Win rate (0.0-1.0) | 0 | NO |
| `sharpe_ratio` | Float64 | Risk-adjusted return metric | 0 | NO |
| `omega_ratio` | Float64 | Gain/loss ratio metric | 0 | NO |
| `total_trades` | UInt32 | Total number of trades | 0 | NO |
| `markets_traded` | UInt32 | Number of unique markets traded | 0 | NO |
| `calculated_at` | DateTime | Timestamp when metrics were calculated | now() | NO |
| `updated_at` | DateTime | Timestamp of last update (version column) | now() | NO |

#### Time Windows

- **30d**: Last 30 days (rolling window)
- **90d**: Last 90 days (rolling window)
- **180d**: Last 180 days (rolling window)
- **lifetime**: All time (block_time >= 2022-06-01)

#### Row Count

- **Total rows:** 3,693,596 (923,399 wallets × 4 windows)
- **Unique wallets:** 923,399
- **Date range:** 2022-06-01 to present

---

## Views

### `whale_leaderboard`

Top 50 wallets ranked by lifetime realized P&L.

**Query Pattern:**
```sql
SELECT
  ROW_NUMBER() OVER (ORDER BY realized_pnl DESC, total_trades DESC) as rank,
  *
FROM (
  SELECT wallet_address, realized_pnl, roi_pct, total_trades, markets_traded, win_rate
  FROM default.wallet_metrics
  WHERE time_window = 'lifetime'
  ORDER BY realized_pnl DESC, total_trades DESC
  LIMIT 50
) as top_wallets
```

**Columns:**
- `rank` (UInt64): Sequential ranking 1-50
- `wallet_address` (String): Wallet address
- `realized_pnl` (Float64): Total realized P&L (USD)
- `roi_pct` (Float64): ROI percentage
- `total_trades` (UInt32): Number of trades
- `markets_traded` (UInt32): Markets traded
- `win_rate` (Float64): Win rate

### `omega_leaderboard`

Top 50 wallets ranked by omega ratio (min 10 trades).

**Query Pattern:**
```sql
SELECT
  ROW_NUMBER() OVER (ORDER BY omega_ratio DESC) as rank,
  *
FROM (
  SELECT wallet_address, omega_ratio, sharpe_ratio, total_trades, win_rate, realized_pnl
  FROM default.wallet_metrics
  WHERE time_window = 'lifetime'
    AND omega_ratio IS NOT NULL
    AND total_trades >= 10
  ORDER BY omega_ratio DESC
  LIMIT 50
) as top_wallets
```

**Filters:**
- Minimum 10 trades (statistical significance)
- Non-NULL omega_ratio

### `roi_leaderboard`

Top 50 wallets ranked by ROI percentage (min 5 trades).

**Query Pattern:**
```sql
SELECT
  ROW_NUMBER() OVER (ORDER BY roi_pct DESC) as rank,
  *
FROM (
  SELECT wallet_address, roi_pct, realized_pnl, total_trades, markets_traded
  FROM default.wallet_metrics
  WHERE time_window = 'lifetime'
    AND roi_pct >= -100
    AND total_trades >= 5
  ORDER BY roi_pct DESC
  LIMIT 50
) as top_wallets
```

**Filters:**
- Minimum 5 trades
- ROI >= -100% (valid range)

---

## Indexing Strategy

### Primary Indexes

1. **wallet_metrics:** (wallet_address, time_window)
   - Enables fast lookup by wallet + window
   - Supports efficient window-specific queries

### Query Performance

| Query Type | Target | Actual |
|------------|--------|--------|
| Leaderboard lookup | <100ms | <50ms |
| Single wallet metrics | <10ms | <5ms |
| Time window aggregation | <200ms | <100ms |

---

## Data Quality Gates

### Coverage

- **Wallets:** 100% of wallets from trades_raw (2022-06-01+)
- **Windows:** All 4 windows populated for every wallet
- **Completeness:** No NULL values in critical metric columns

### Validation

- **P&L Parity:** Baseline wallet sum = -$27,558.71 (verified)
- **Row Count:** 923,399 × 4 = 3,693,596 rows (exact match)
- **Sequential Rankings:** Leaderboard ranks are sequential 1-50

---

## Maintenance

### Refresh Schedule

- **Current:** Manual refresh via scripts
- **Planned:** Daily automated refresh (30-minute incremental updates)

### Rebuild Pattern

```typescript
// Full rebuild (atomic)
// 1. Create temp table with new data
// 2. Verify row counts and P&L parity
// 3. RENAME tables atomically
// 4. Drop old table

// See: scripts/rebuild-wallet-metrics-complete.ts
```

---

## Migration History

### v1.0 (2025-11-11)

- Initial schema
- 4 time windows (30d, 90d, 180d, lifetime)
- 12 metric columns
- ReplacingMergeTree with updated_at version column

---

## References

- **Source Table:** `default.trades_raw`
- **Date Filter:** block_time >= '2022-06-01'
- **Calculation Engine:** `lib/clickhouse/metrics-calculator.ts`
- **Rebuild Script:** `scripts/rebuild-wallet-metrics-complete.ts`
