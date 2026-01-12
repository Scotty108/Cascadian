# PnL Incremental Update Cron Jobs

## Overview

After the initial backfill, run these jobs to keep data fresh.

## Scripts

### 1. `update-canonical-fills.ts`

Incrementally updates `pm_canonical_fills_v4` from source tables.

**Run every 5 minutes:**
```bash
*/5 * * * * cd /path/to/Cascadian-app && npx tsx scripts/cron/update-canonical-fills.ts >> /var/log/pnl-update.log 2>&1
```

**What it does:**
1. Reads watermarks for each source (CLOB, CTF, NegRisk)
2. Queries new events since watermark - overlap (30 min)
3. Inserts new canonical fills (ReplacingMergeTree handles dedup)
4. Updates watermarks
5. Refreshes positions and summary tables

**Manual run:**
```bash
npx tsx scripts/cron/update-canonical-fills.ts
```

**Force refresh derived tables:**
```bash
npx tsx scripts/cron/update-canonical-fills.ts --force-refresh
```

## Table Dependencies

```
pm_trader_events_v3 ──┐
pm_ctf_split_merge_expanded ──┼──> pm_canonical_fills_v4 ──> pm_wallet_positions_v4 ──> pm_wallet_summary_v4
vw_negrisk_conversions ───────┘
```

## Watermarks

The system maintains watermarks in `pm_ingest_watermarks_v1`:

```sql
SELECT * FROM pm_ingest_watermarks_v1 FINAL
```

## Monitoring

Check last update times:
```sql
SELECT source, last_event_time, rows_processed, updated_at
FROM pm_ingest_watermarks_v1 FINAL
ORDER BY updated_at DESC
```

Check data freshness:
```sql
SELECT
  max(event_time) as latest_fill,
  dateDiff('minute', max(event_time), now()) as minutes_behind
FROM pm_canonical_fills_v4
```

## Recovery

If incremental fails, re-run backfill for affected time range:
```bash
npx tsx scripts/backfill-canonical-fills-v4.ts
```

Or truncate and full rebuild:
```sql
TRUNCATE TABLE pm_canonical_fills_v4;
-- Then run backfill script
```
