---
name: data-health
description: Quick data quality and integrity check. Auto-use when user asks "is the data ok?", "check data quality", "any data issues?", "how's the pipeline?", "verify data integrity", "run a health check", "check row counts", or after any recovery or FIFO rebuild operation.
---

# Data Health Check

Fast data quality verification across the entire pipeline.

## Quick Health Queries

Run all of these (combine into a single query if possible):

### 1. Row Count Verification
```sql
SELECT
  'pm_canonical_fills_v4' as tbl, count() as rows FROM pm_canonical_fills_v4
UNION ALL
SELECT 'pm_trade_fifo_roi_v3', count() FROM pm_trade_fifo_roi_v3
UNION ALL
SELECT 'pm_condition_resolutions', count() FROM pm_condition_resolutions
UNION ALL
SELECT 'pm_token_to_condition_map_v5', count() FROM pm_token_to_condition_map_v5
UNION ALL
SELECT 'pm_trader_events_v3', count() FROM pm_trader_events_v3
```

Expected ranges:
- Canonical fills: ~1.19B (growing)
- FIFO positions: ~283M (growing)
- Resolutions: ~411k (growing)
- Token map: ~500k (rebuilt hourly)

### 2. Corruption Indicators
```sql
SELECT
  countIf(condition_id = '' OR condition_id IS NULL) as empty_conditions,
  countIf(fill_timestamp IS NULL) as null_timestamps,
  countIf(wallet = '' OR wallet IS NULL) as empty_wallets,
  countIf(usdc_amount = 0 AND token_amount = 0) as zero_amounts
FROM pm_canonical_fills_v4
WHERE fill_timestamp > now() - INTERVAL 7 DAY
```

All should be 0 or very close to 0.

### 3. FIFO Coverage
```sql
SELECT
  countIf(is_closed = 1) as closed_positions,
  countIf(is_closed = 0) as open_positions,
  round(closed_positions / (closed_positions + open_positions) * 100, 1) as closed_pct,
  count(DISTINCT wallet) as unique_wallets,
  count(DISTINCT condition_id) as unique_conditions
FROM pm_trade_fifo_roi_v3
```

### 4. Recent Activity (Last 24h)
```sql
SELECT
  toStartOfHour(fill_timestamp) as hour,
  count() as fills,
  count(DISTINCT wallet) as wallets,
  round(sum(usdc_amount) / 1e6, 0) as volume_usd
FROM pm_canonical_fills_v4
WHERE fill_timestamp > now() - INTERVAL 24 HOUR
  AND source != 'negrisk'
GROUP BY hour
ORDER BY hour DESC
LIMIT 12
```

### 5. Resolution Coverage
```sql
SELECT
  countIf(resolved_at > now() - INTERVAL 7 DAY) as resolved_this_week,
  countIf(resolved_at > now() - INTERVAL 30 DAY) as resolved_this_month,
  count() as total_resolutions
FROM pm_condition_resolutions
```

## Output Format

```
DATA HEALTH REPORT - [timestamp PST]

ROW COUNTS
  Table                          Rows          Expected       Status
  pm_canonical_fills_v4          X.XXB         ~1.19B         [OK/LOW/HIGH]
  pm_trade_fifo_roi_v3           XXXM          ~283M          [OK/LOW/HIGH]
  pm_condition_resolutions       XXXk          ~411k          [OK/LOW/HIGH]
  pm_token_to_condition_map_v5   XXXk          ~500k          [OK/LOW/HIGH]

CORRUPTION CHECK (last 7 days)
  Empty condition_ids:  [count] [OK if 0]
  Null timestamps:      [count] [OK if 0]
  Empty wallets:        [count] [OK if 0]
  Zero amounts:         [count] [OK if low]

FIFO HEALTH
  Total Positions:    [count]
  Closed:             [count] ([X]%)
  Open:               [count] ([X]%)
  Unique Wallets:     [count]
  Unique Conditions:  [count]

RECENT ACTIVITY (24h hourly)
  Hour    Fills    Wallets   Volume
  [HH]    [X]k     [X]k     $[X]M
  ...

RESOLUTIONS
  This Week:  [count]
  This Month: [count]
  Total:      [count]

OVERALL STATUS: [HEALTHY / DEGRADED / CRITICAL]
```

## Status Thresholds

| Check | Healthy | Degraded | Critical |
|-------|---------|----------|----------|
| Empty conditions | 0 | 1-100 | > 100 |
| Fills last hour | > 1000 | 100-1000 | < 100 |
| FIFO coverage | > 95% | 90-95% | < 90% |
| Wallet count | > 600k | 500-600k | < 500k |
