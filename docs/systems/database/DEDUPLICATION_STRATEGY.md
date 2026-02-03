# Systematic Deduplication Strategy

## Problem Statement

Three core tables have duplicates affecting data integrity and query performance:

| Table | Current Rows | Expected Rows | Duplication | Root Cause |
|-------|--------------|---------------|-------------|------------|
| pm_canonical_fills_v4 | 1.19B | 1.19B | 0% | ✅ FIXED (Feb 2026) |
| pm_trade_fifo_roi_v3 | 283M | 283M | 0% | ✅ FIXED (Feb 2026) - SharedReplacingMergeTree + OPTIMIZE FINAL |
| pm_trader_events_v2 | Unknown | Unknown | 2-3x | Legacy backfill issue (use GROUP BY event_id) |

**Current "solution":** Query-level CTEs with GROUP BY
- ❌ Not scalable (every query must remember)
- ❌ Not safe (easy to forget)
- ❌ Not fast (GROUP BY overhead on every query)
- ❌ Not maintainable (60+ files to update)

## Permanent Solution: Four-Layer Defense

### Layer 1: Materialized Views (Production Reads)

Create deduplicated materialized views for all production queries:

```sql
-- Canonical fills - deduplicated by fill_id
CREATE MATERIALIZED VIEW pm_canonical_fills_v4_deduped
ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMM(event_time)
ORDER BY (wallet, condition_id, outcome_index, event_time, fill_id)
AS
SELECT
  fill_id,
  any(event_time) as event_time,
  any(block_number) as block_number,
  any(tx_hash) as tx_hash,
  wallet,
  condition_id,
  outcome_index,
  any(tokens_delta) as tokens_delta,
  any(usdc_delta) as usdc_delta,
  any(source) as source,
  any(is_self_fill) as is_self_fill,
  any(is_maker) as is_maker,
  max(_version) as _version
FROM pm_canonical_fills_v4
GROUP BY fill_id, wallet, condition_id, outcome_index;

-- FIFO trades - deduplicated by position
CREATE MATERIALIZED VIEW pm_trade_fifo_roi_v3_deduped
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(resolved_at)
ORDER BY (wallet, condition_id, outcome_index, entry_time)
AS
SELECT
  wallet,
  condition_id,
  outcome_index,
  any(tx_hash) as tx_hash,
  any(entry_time) as entry_time,
  any(tokens) as tokens,
  any(cost_usd) as cost_usd,
  any(tokens_sold_early) as tokens_sold_early,
  any(tokens_held) as tokens_held,
  any(exit_value) as exit_value,
  any(pnl_usd) as pnl_usd,
  any(roi) as roi,
  any(pct_sold_early) as pct_sold_early,
  any(is_maker) as is_maker,
  any(resolved_at) as resolved_at,
  any(is_short) as is_short
FROM pm_trade_fifo_roi_v3
GROUP BY wallet, condition_id, outcome_index;

-- Trader events - deduplicated by event_id
CREATE MATERIALIZED VIEW pm_trader_events_v2_deduped
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(trade_time)
ORDER BY (trader_wallet, condition_id, event_time)
AS
SELECT
  event_id,
  trader_wallet,
  condition_id,
  any(side) as side,
  any(usdc_amount) as usdc_amount,
  any(token_amount) as token_amount,
  any(trade_time) as trade_time,
  any(event_time) as event_time,
  any(is_deleted) as is_deleted
FROM pm_trader_events_v2
GROUP BY event_id, trader_wallet, condition_id;
```

**Advantages:**
- ✅ Zero query overhead (reads from clean data)
- ✅ Auto-updating (materialized on insert)
- ✅ Safe (impossible to query wrong table with proper naming)
- ✅ Fast (deduplicated once at write time)

### Layer 2: Aggressive Merge Settings

Force frequent merges to minimize duplicate window:

```sql
-- pm_canonical_fills_v4
ALTER TABLE pm_canonical_fills_v4 MODIFY SETTING
  merge_with_ttl_timeout = 3600,           -- Merge every hour
  max_bytes_to_merge_at_max_space_in_pool = 150GB,  -- Larger merges
  number_of_free_entries_in_pool_to_lower_max_size_of_merge = 0;

-- pm_trade_fifo_roi_v3 (after rebuild)
ALTER TABLE pm_trade_fifo_roi_v3 MODIFY SETTING
  merge_with_ttl_timeout = 1800,           -- Merge every 30 min
  max_bytes_to_merge_at_max_space_in_pool = 100GB;
```

### Layer 3: Application-Level Prevention

**For pm_canonical_fills_v4:**
- Keep overlap window (necessary for data integrity)
- Rely on ReplacingMergeTree + materialized view

**For pm_trade_fifo_roi_v3:**
- Fixed cron to check ALL time (not just 48h window)
- Rebuild eliminates existing duplicates
- Monitor for new duplicates

**For pm_trader_events_v2:**
- No longer updated (legacy data)
- Use _deduped view for all queries

### Layer 4: Monitoring & Alerting

Daily cron to detect duplicate drift:

```sql
-- Check duplication rates
WITH stats AS (
  SELECT
    'canonical_fills_v4' as table_name,
    COUNT(*) as total_rows,
    uniqExact(fill_id) as unique_keys,
    round((total_rows - unique_keys) * 100.0 / total_rows, 2) as dup_pct
  FROM pm_canonical_fills_v4
  WHERE event_time >= now() - INTERVAL 7 DAY

  UNION ALL

  SELECT
    'trade_fifo_roi_v3' as table_name,
    COUNT(*) as total_rows,
    COUNT(DISTINCT (wallet, condition_id, outcome_index)) as unique_keys,
    round((total_rows - unique_keys) * 100.0 / total_rows, 2) as dup_pct
  FROM pm_trade_fifo_roi_v3
  WHERE resolved_at >= now() - INTERVAL 7 DAY
)
SELECT * FROM stats WHERE dup_pct > 5.0;  -- Alert if >5% duplicates
```

## Migration Plan

### Phase 1: Create Materialized Views (1 hour)
1. Create pm_canonical_fills_v4_deduped
2. Create pm_trade_fifo_roi_v3_deduped
3. Create pm_trader_events_v2_deduped
4. Wait for initial population

### Phase 2: Update All Queries (2 hours)
1. Global find/replace in codebase:
   - `FROM pm_canonical_fills_v4` → `FROM pm_canonical_fills_v4_deduped`
   - `FROM pm_trade_fifo_roi_v3` → `FROM pm_trade_fifo_roi_v3_deduped`
   - `FROM pm_trader_events_v2` → `FROM pm_trader_events_v2_deduped`
2. Remove all GROUP BY fill_id / event_id CTEs (no longer needed)
3. Test critical endpoints

### Phase 3: Configure Merge Settings (10 min)
1. Apply aggressive merge settings to source tables
2. Trigger manual OPTIMIZE for immediate cleanup

### Phase 4: Deploy Monitoring (30 min)
1. Create monitor-table-duplicates cron
2. Add Discord alerts for duplicate drift
3. Add dashboard metrics

### Phase 5: Cleanup (after 7 days)
1. Verify 0 queries use source tables
2. Consider dropping source tables or making them write-only

## Performance Impact

**Before (Query-level CTEs):**
```sql
-- Every query pays GROUP BY cost
WITH deduped AS (
  SELECT ... GROUP BY fill_id  -- Scans all fills, groups, aggregates
)
SELECT ... FROM deduped
```
- 278M rows scanned → grouped → 78M rows → queried
- ~3-5 seconds per query

**After (Materialized Views):**
```sql
-- Direct query on clean data
SELECT ... FROM pm_trade_fifo_roi_v3_deduped
```
- 78M rows scanned directly
- ~100-300ms per query
- **15-50x faster**

## Storage Impact

| Table | Source Size | View Size | Overhead |
|-------|-------------|-----------|----------|
| pm_canonical_fills_v4 | 91GB | ~76GB | +76GB |
| pm_trade_fifo_roi_v3 | 18GB | ~5GB | +5GB |
| pm_trader_events_v2 | Unknown | ~10GB | +10GB |
| **TOTAL** | - | - | **+91GB** |

**Cost:** ~$15/month additional storage
**Benefit:** 15-50x query performance + zero maintenance

## Rollback Plan

If materialized views cause issues:
1. Views are independent - can drop without affecting source
2. Revert queries to use source tables
3. Re-add GROUP BY CTEs if needed

## Long-Term Maintenance

**Monthly:**
- Review duplicate rates dashboard
- Verify merge settings are effective

**Quarterly:**
- Optimize tables manually if part count exceeds 100
- Review storage usage vs benefit

**Annually:**
- Consider rebuilding source tables from views
- Evaluate if views can become primary tables
