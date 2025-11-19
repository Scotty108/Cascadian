# Query Examples

Detailed examples for common Cascadian database queries.

---

## Wallet Analysis

### Example 1: Complete Wallet Performance
```sql
SELECT
  wallet_address,
  sum(total_trades) AS total_trades,
  sum(wins) AS wins,
  sum(losses) AS losses,
  sum(total_pnl) AS total_pnl,
  sum(total_volume) AS total_volume,
  wins / nullIf(wins + losses, 0) * 100 AS win_rate_percent,
  sum(total_pnl) / nullIf(sum(total_volume), 0) * 100 AS roi_percent
FROM wallet_metrics_daily
WHERE wallet_address = '0x1234567890abcdef'
GROUP BY wallet_address
```

### Example 2: Wallet Trading History
```sql
SELECT
  timestamp,
  market_id,
  side,
  shares,
  entry_price,
  usd_value,
  pnl,
  is_closed,
  transaction_hash
FROM trades_raw
WHERE wallet_address = '0x1234567890abcdef'
ORDER BY timestamp DESC
LIMIT 100
```

### Example 3: Wallet Performance Over Time
```sql
SELECT
  toStartOfMonth(date) AS month,
  sum(total_pnl) AS monthly_pnl,
  sum(wins) AS monthly_wins,
  sum(losses) AS monthly_losses,
  sum(total_volume) AS monthly_volume
FROM wallet_metrics_daily
WHERE wallet_address = '0x1234567890abcdef'
GROUP BY toStartOfMonth(date)
ORDER BY month DESC
```

### Example 4: Top Performing Wallets (Last 30 Days)
```sql
SELECT
  wallet_address,
  sum(total_pnl) AS pnl_30d,
  sum(wins) AS wins,
  sum(losses) AS losses,
  sum(total_volume) AS volume,
  wins / nullIf(wins + losses, 0) * 100 AS win_rate
FROM wallet_metrics_daily
WHERE date >= today() - INTERVAL 30 DAY
GROUP BY wallet_address
HAVING pnl_30d > 1000
ORDER BY pnl_30d DESC
LIMIT 50
```

---

## Market Analysis

### Example 5: Market Trading Activity
```sql
SELECT
  market_id,
  count(*) AS trade_count,
  count(DISTINCT wallet_address) AS unique_traders,
  sum(usd_value) AS total_volume,
  avg(usd_value) AS avg_trade_size,
  sum(shares) AS total_shares_traded
FROM trades_raw
WHERE market_id = '0xabcdef123456'
  AND timestamp >= now() - INTERVAL 7 DAY
GROUP BY market_id
```

### Example 6: Market Resolution Lookup
```sql
SELECT
  condition_id,
  market_slug,
  market_title,
  winning_index,
  payout_numerators,
  payout_denominator,
  resolved_at,
  outcome_text
FROM market_resolutions
WHERE lower(replaceAll(condition_id, '0x', '')) =
      lower(replaceAll('0xabcdef123456', '0x', ''))
```

### Example 7: Most Active Markets (24h)
```sql
SELECT
  market_id,
  count(*) AS trades,
  count(DISTINCT wallet_address) AS traders,
  sum(usd_value) AS volume
FROM trades_raw
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY market_id
ORDER BY volume DESC
LIMIT 20
```

---

## Position Analysis

### Example 8: Current Open Positions for Wallet
```sql
SELECT
  wallet_address,
  market_id,
  shares,
  entry_price,
  current_price,
  unrealized_pnl,
  (current_price - entry_price) / entry_price * 100 AS roi_percent
FROM wallet_positions
WHERE wallet_address = '0x1234567890abcdef'
  AND shares > 0
ORDER BY unrealized_pnl DESC
```

### Example 9: Largest Open Positions
```sql
SELECT
  wallet_address,
  market_id,
  shares,
  shares * current_price AS position_value_usd,
  unrealized_pnl
FROM wallet_positions
WHERE shares > 0
ORDER BY position_value_usd DESC
LIMIT 100
```

---

## PnL Calculations

### Example 10: Realized vs Unrealized PnL
```sql
SELECT
  wallet_address,
  realized_pnl,
  unrealized_pnl,
  total_pnl,
  unrealized_pnl / nullIf(total_pnl, 0) * 100 AS unrealized_percent
FROM fact_pnl
WHERE wallet_address = '0x1234567890abcdef'
```

### Example 11: PnL with Resolution Data
```sql
SELECT
  t.wallet_address,
  t.market_id,
  t.shares,
  t.entry_price,
  r.winning_index,
  t.shares * (arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - (t.shares * t.entry_price) AS calculated_pnl
FROM trades_raw t
JOIN market_resolutions r
  ON lower(replaceAll(t.market_id, '0x', '')) = lower(replaceAll(r.condition_id, '0x', ''))
WHERE t.wallet_address = '0x1234567890abcdef'
  AND t.is_closed = true
```

---

## Data Verification

### Example 12: Check Data Coverage
```sql
SELECT
  'trades_raw' AS table_name,
  count(*) AS total_rows,
  count(DISTINCT wallet_address) AS unique_wallets,
  count(DISTINCT market_id) AS unique_markets,
  min(timestamp) AS earliest_trade,
  max(timestamp) AS latest_trade,
  dateDiff('day', min(timestamp), max(timestamp)) AS coverage_days
FROM trades_raw

UNION ALL

SELECT
  'market_resolutions' AS table_name,
  count(*) AS total_rows,
  0 AS unique_wallets,
  count(DISTINCT condition_id) AS unique_markets,
  min(resolved_at) AS earliest_trade,
  max(resolved_at) AS latest_trade,
  dateDiff('day', min(resolved_at), max(resolved_at)) AS coverage_days
FROM market_resolutions
```

### Example 13: Find Missing Resolutions
```sql
-- Markets with trades but no resolution
SELECT
  t.market_id,
  count(*) AS trade_count,
  sum(t.usd_value) AS total_volume
FROM trades_raw t
LEFT JOIN market_resolutions r
  ON lower(replaceAll(t.market_id, '0x', '')) = lower(replaceAll(r.condition_id, '0x', ''))
WHERE r.condition_id IS NULL
  AND t.timestamp < now() - INTERVAL 30 DAY  -- Older than 30 days
GROUP BY t.market_id
ORDER BY total_volume DESC
LIMIT 100
```

### Example 14: Check for Duplicates
```sql
SELECT
  trade_id,
  count(*) AS duplicate_count
FROM trades_raw
GROUP BY trade_id
HAVING duplicate_count > 1
ORDER BY duplicate_count DESC
```

---

## Advanced Queries

### Example 15: Wallet Cohort Analysis
```sql
WITH first_trades AS (
  SELECT
    wallet_address,
    min(timestamp) AS first_trade_date,
    toStartOfMonth(min(timestamp)) AS cohort_month
  FROM trades_raw
  GROUP BY wallet_address
)
SELECT
  cohort_month,
  count(DISTINCT ft.wallet_address) AS cohort_size,
  count(DISTINCT CASE WHEN m.date >= cohort_month + INTERVAL 30 DAY THEN m.wallet_address END) AS retained_30d,
  count(DISTINCT CASE WHEN m.date >= cohort_month + INTERVAL 90 DAY THEN m.wallet_address END) AS retained_90d
FROM first_trades ft
LEFT JOIN wallet_metrics_daily m ON ft.wallet_address = m.wallet_address
GROUP BY cohort_month
ORDER BY cohort_month DESC
```

### Example 16: Market Momentum (Price Movement)
```sql
SELECT
  market_id,
  first_value(entry_price) OVER (PARTITION BY market_id ORDER BY timestamp ASC) AS opening_price,
  last_value(entry_price) OVER (PARTITION BY market_id ORDER BY timestamp ASC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS closing_price,
  (closing_price - opening_price) / opening_price * 100 AS price_change_percent,
  count(*) AS trade_count,
  sum(usd_value) AS volume
FROM trades_raw
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY market_id
ORDER BY price_change_percent DESC
```

### Example 17: Smart Money Following
```sql
-- Find markets where top wallets are heavily positioned
WITH top_wallets AS (
  SELECT wallet_address
  FROM fact_pnl
  WHERE total_pnl > 10000
  ORDER BY total_pnl DESC
  LIMIT 50
)
SELECT
  p.market_id,
  count(DISTINCT p.wallet_address) AS smart_money_count,
  sum(p.shares) AS total_shares,
  sum(p.shares * p.current_price) AS total_value_usd
FROM wallet_positions p
INNER JOIN top_wallets tw ON p.wallet_address = tw.wallet_address
WHERE p.shares > 0
GROUP BY p.market_id
HAVING smart_money_count >= 5  -- At least 5 top wallets
ORDER BY total_value_usd DESC
```

### Example 18: Volume Concentration Analysis
```sql
-- Which wallets account for most volume?
SELECT
  wallet_address,
  sum(usd_value) AS total_volume,
  sum(usd_value) / (SELECT sum(usd_value) FROM trades_raw WHERE timestamp >= now() - INTERVAL 30 DAY) * 100 AS volume_share_percent,
  count(*) AS trade_count
FROM trades_raw
WHERE timestamp >= now() - INTERVAL 30 DAY
GROUP BY wallet_address
ORDER BY total_volume DESC
LIMIT 100
```

---

## Search Queries

### Example 19: Search for Condition ID Across Tables
```sql
-- Find where a condition_id appears
WITH normalized_id AS (
  SELECT lower(replaceAll('0xABCDEF123456', '0x', '')) AS cid
)
SELECT 'trades_raw' AS table_name, count(*) AS occurrences
FROM trades_raw, normalized_id
WHERE lower(replaceAll(market_id, '0x', '')) = normalized_id.cid

UNION ALL

SELECT 'market_resolutions' AS table_name, count(*) AS occurrences
FROM market_resolutions, normalized_id
WHERE lower(replaceAll(condition_id, '0x', '')) = normalized_id.cid

UNION ALL

SELECT 'wallet_positions' AS table_name, count(*) AS occurrences
FROM wallet_positions, normalized_id
WHERE lower(replaceAll(market_id, '0x', '')) = normalized_id.cid
```

### Example 20: Search Tables by Column Name
```sql
-- Find all tables with a specific column
SELECT
  table,
  name AS column_name,
  type AS column_type
FROM system.columns
WHERE database = 'default'
  AND name LIKE '%pnl%'
ORDER BY table, name
```

---

## Performance Tips

### Use Proper Filters
```sql
-- ✅ GOOD - Uses partition and order keys
SELECT * FROM trades_raw
WHERE wallet_address = '0x...'
  AND timestamp >= '2024-01-01'
ORDER BY timestamp DESC
LIMIT 100

-- ❌ BAD - Scans entire table
SELECT * FROM trades_raw
WHERE transaction_hash LIKE '%abc%'
```

### Use Aggregations Efficiently
```sql
-- ✅ GOOD - Filter before aggregate
SELECT
  market_id,
  count(*) AS trades
FROM trades_raw
WHERE timestamp >= now() - INTERVAL 7 DAY
GROUP BY market_id

-- ❌ BAD - Aggregate then filter
SELECT
  market_id,
  count(*) AS trades
FROM trades_raw
GROUP BY market_id
HAVING max(timestamp) >= now() - INTERVAL 7 DAY
```

### Use LIMIT Wisely
```sql
-- ✅ GOOD - Limited exploratory query
SELECT * FROM trades_raw LIMIT 1000

-- ❌ BAD - Could return millions
SELECT * FROM trades_raw
```

---

## Common Patterns Reference

| Task | Pattern |
|------|---------|
| Wallet trades | `WHERE wallet_address = '0x...' ORDER BY timestamp DESC` |
| Recent activity | `WHERE timestamp >= now() - INTERVAL {N} {UNIT}` |
| Top performers | `GROUP BY ... ORDER BY sum(pnl) DESC LIMIT N` |
| Find resolution | `WHERE lower(replaceAll(condition_id, '0x', '')) = ...` |
| Count unique | `count(DISTINCT column)` |
| Win rate | `wins / nullIf(wins + losses, 0)` |
| ROI | `sum(pnl) / nullIf(sum(volume), 0) * 100` |
| Market volume | `sum(usd_value)` |
| Active traders | `count(DISTINCT wallet_address)` |

---

**Remember**: Always apply IDN (ID normalization) for condition_id joins, and CAR (ClickHouse Array Rule - 1-indexed) for array operations!
