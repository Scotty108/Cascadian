---
name: cron-status
description: Check cron health, pipeline freshness, and data staleness. Auto-use when user asks "how are the crons?", "is the data fresh?", "any stale tables?", "pipeline status", "what's failing?", "cron health", or mentions cron failures or stale data.
argument-hint: [cron-name or 'all']
---

# Cron Status Check

Quick health check for all Cascadian cron jobs and data pipeline freshness.

## When Invoked

Run the following checks in order:

### 1. Pipeline Freshness (Always Run)

Query ClickHouse (prefer MCP if available, otherwise `npx tsx`):

```sql
SELECT 'pm_canonical_fills_v4' as tbl, count() as rows, max(fill_timestamp) as latest
FROM pm_canonical_fills_v4
UNION ALL
SELECT 'pm_trade_fifo_roi_v3', count(), max(trade_time)
FROM pm_trade_fifo_roi_v3
UNION ALL
SELECT 'pm_condition_resolutions', count(), max(resolved_at)
FROM pm_condition_resolutions
UNION ALL
SELECT 'pm_token_to_condition_map_v5', count(), max(updated_at)
FROM pm_token_to_condition_map_v5
UNION ALL
SELECT 'pm_latest_mark_price_v1', count(), max(updated_at)
FROM pm_latest_mark_price_v1
UNION ALL
SELECT 'pm_copy_trading_leaderboard', count(), max(updated_at)
FROM pm_copy_trading_leaderboard
UNION ALL
SELECT 'pm_smart_money_cache', count(), max(updated_at)
FROM pm_smart_money_cache
```

### 2. Watermark Check

```sql
SELECT cron_name, last_run_at, rows_processed, status, error_message
FROM pm_ingest_watermarks_v1
ORDER BY last_run_at DESC
LIMIT 20
```

### 3. Data Quality Quick Check

```sql
SELECT
  (SELECT count() FROM pm_canonical_fills_v4 WHERE condition_id = '' OR condition_id IS NULL) as empty_conditions,
  (SELECT count() FROM pm_canonical_fills_v4 WHERE fill_timestamp > now() - INTERVAL 1 HOUR) as fills_last_hour,
  (SELECT count() FROM pm_trade_fifo_roi_v3 WHERE trade_time > now() - INTERVAL 4 HOUR) as fifo_last_4h
```

## Output Format

```
CRON HEALTH DASHBOARD - [timestamp PST]

PIPELINE FRESHNESS
  Table                          Rows          Latest              Status
  pm_canonical_fills_v4          X.XXB         YYYY-MM-DD HH:MM   [OK/STALE]
  pm_trade_fifo_roi_v3           XXXM          YYYY-MM-DD HH:MM   [OK/STALE]
  pm_condition_resolutions       XXXk          YYYY-MM-DD HH:MM   [OK/STALE]
  pm_token_to_condition_map_v5   XXXk          YYYY-MM-DD HH:MM   [OK/STALE]
  pm_latest_mark_price_v1        XXXk          YYYY-MM-DD HH:MM   [OK/STALE]
  pm_copy_trading_leaderboard    XX            YYYY-MM-DD HH:MM   [OK/STALE]
  pm_smart_money_cache           XXX           YYYY-MM-DD HH:MM   [OK/STALE]

STALENESS THRESHOLDS
  Canonical fills: STALE if > 20 min old
  FIFO positions:  STALE if > 3 hours old
  Token map:       STALE if > 20 min old
  Mark prices:     STALE if > 20 min old
  Leaderboard:     STALE if > 4 hours old
  Smart money:     STALE if > 25 hours old

DATA QUALITY
  Empty conditions:  [count] [OK if 0, WARNING if > 0]
  Fills last hour:   [count] [OK if > 0, WARNING if 0]
  FIFO last 4h:      [count] [OK if > 0, WARNING if 0]

RECENT WATERMARKS
  [cron_name]: [last_run] - [status] ([rows_processed] rows)

KNOWN ISSUES
  #11: WIO memory limits (sync-wio-positions)
  #14: Schema mismatch (update-wio-resolutions)
  #15: Missing column (refresh-wio-metrics)
```

## Thresholds

| Table | OK | Warning | Critical |
|-------|-----|---------|----------|
| Canonical fills | < 20 min | 20-60 min | > 1 hour |
| FIFO positions | < 3 hours | 3-6 hours | > 6 hours |
| Token map | < 20 min | 20-60 min | > 1 hour |
| Mark prices | < 20 min | 20-60 min | > 1 hour |
| Leaderboard | < 4 hours | 4-8 hours | > 8 hours |
| Smart money | < 25 hours | 25-48 hours | > 48 hours |
