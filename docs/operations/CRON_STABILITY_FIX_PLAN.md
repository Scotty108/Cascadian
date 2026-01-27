# Cron Stability Fix Plan

**Date:** January 27, 2026
**Status:** Ready for Implementation
**Owner:** TBD
**Priority:** High (Operational Stability)

---

## Executive Summary

Multiple cron jobs are experiencing failures due to:
1. **Memory limit errors** - ClickHouse queries exceeding 10.80 GiB limit
2. **Schema mismatches** - Queries referencing missing tables/columns
3. **Timeout issues** - Long-running cleanup operations

These issues are causing:
- Repeated cron failures (every 2-4 hours)
- Application downtime (5-11 minute outages)
- Stale dashboard data (WIO positions, metrics, scores)

**Impact:** Operational only - no data corruption or integrity issues.

---

## Issue 1: Memory Limit Errors (PRIORITY: HIGH)

### Affected Crons

| Cron | Frequency | Failure Rate | Impact |
|------|-----------|--------------|--------|
| `sync-wio-positions` | Hourly | ~50% | WIO positions stale, app downtime |
| `refresh-wio-metrics` | Every 2h | ~25% | WIO metrics dashboard stale |
| `cleanup-duplicates` | Daily | ~50% | Timeout errors, cleanup incomplete |
| `update-canonical-fills` | Every 10m | Was failing Jan 25-26 | Fixed by LEFT JOIN bug fix |

### Root Cause

ClickHouse queries are hitting the 10.80 GiB memory limit during aggregation operations. This is a hard limit imposed by the cloud instance.

### Investigation Steps

#### Step 1: Analyze `sync-wio-positions` Memory Usage

**File:** `app/api/cron/sync-wio-positions/route.ts`

1. Read the full file to understand the query
2. Identify the memory-heavy operations:
   - Large aggregations (GROUP BY, SUM, COUNT)
   - Window functions (PARTITION BY)
   - Large JOINs
   - Full table scans
3. Check the query execution plan:
   ```sql
   EXPLAIN PIPELINE
   SELECT ... (paste full query from route.ts)
   ```

**Key questions:**
- How many rows is it processing?
- What's the time window? (e.g., processing all-time data vs last 30 days)
- Are there proper indexes on join keys?

#### Step 2: Analyze `refresh-wio-metrics` Memory Usage

**File:** `app/api/cron/refresh-wio-metrics/route.ts`

Same investigation approach as Step 1.

#### Step 3: Analyze `cleanup-duplicates` Timeout

**File:** `app/api/cron/cleanup-duplicates/route.ts`

1. Check what table it's running OPTIMIZE on
2. Check table size:
   ```sql
   SELECT
     table,
     formatReadableSize(sum(bytes)) as size,
     count() as parts
   FROM system.parts
   WHERE table = 'pm_canonical_fills_v4' AND active
   GROUP BY table
   ```
3. Check if OPTIMIZE is necessary or can be replaced with smaller operations

### Solution Options

#### Option A: Batch Processing (Recommended)

Break queries into smaller time windows.

**Example for `sync-wio-positions`:**

Instead of:
```sql
SELECT ... FROM pm_canonical_fills_v4
WHERE event_time > watermark
```

Use daily chunks:
```sql
-- Loop through days
FOR day IN (SELECT DISTINCT toDate(event_time) FROM ... WHERE event_time > watermark) {
  INSERT INTO wio_positions_v1
  SELECT ... FROM pm_canonical_fills_v4
  WHERE toDate(event_time) = day
}
```

**Pros:**
- Lower memory per query
- More reliable
- Can resume on failure

**Cons:**
- Longer total runtime
- More complex code

#### Option B: Incremental Watermarks with Smaller Windows

Reduce the `SLICE_HOURS` parameter from current value to smaller chunks.

**Current:** `SLICE_HOURS = 6` (processes 6 hours at once)
**Recommended:** `SLICE_HOURS = 1` (process 1 hour at once)

**Files to modify:**
- `app/api/cron/sync-wio-positions/route.ts` - Line ~19

**Pros:**
- Simple change
- Reduces memory per query

**Cons:**
- May not be enough if single hour is still too large

#### Option C: Materialized Views (Long-term)

Pre-aggregate data into materialized views to reduce query complexity.

**Example:**
```sql
CREATE MATERIALIZED VIEW wio_positions_daily_mv
ENGINE = AggregatingMergeTree()
ORDER BY (wallet, market_id, toDate(event_time))
AS
SELECT
  wallet,
  market_id,
  toDate(event_time) as date,
  sumState(usdc_delta) as total_usdc,
  sumState(tokens_delta) as total_tokens
FROM pm_canonical_fills_v4
GROUP BY wallet, market_id, date
```

**Pros:**
- Much faster queries
- Lower memory usage
- Scalable long-term solution

**Cons:**
- Requires careful planning
- More complex to maintain
- Takes time to implement

#### Option D: Request Memory Increase

Contact ClickHouse cloud provider to increase memory limit from 10.80 GiB to 20-30 GiB.

**Pros:**
- No code changes needed
- Quick fix

**Cons:**
- Higher cost
- Doesn't solve scalability issue
- May hit limits again as data grows

### Recommended Approach

**Immediate (Week 1):**
1. Implement Option B (reduce SLICE_HOURS) for quick win
2. Implement Option A (batch processing) for `sync-wio-positions`

**Short-term (Week 2-3):**
1. Implement Option A for `refresh-wio-metrics`
2. Investigate Option D (memory increase) as backup

**Long-term (Month 1-2):**
1. Design and implement Option C (materialized views)
2. Refactor all heavy crons to use pre-aggregated data

---

## Issue 2: Schema Mismatch - `update-wio-resolutions` (PRIORITY: MEDIUM)

### Error

```
Missing columns: 'wio_positions_v2.side' 'wio_positions_v2.market_id' while processing query
```

### Root Cause

The cron queries `wio_positions_v2` but:
- The table may not exist (renamed to `wio_positions_v1`?)
- The table exists but has different column names
- The table schema changed in a migration

### Investigation Steps

#### Step 1: Check if Table Exists

```sql
SELECT table, engine
FROM system.tables
WHERE database = 'default' AND table LIKE '%wio_position%'
```

Expected results:
- `wio_positions_v1` exists
- `wio_positions_v2` does NOT exist (likely)

#### Step 2: Check Current Schema

```sql
DESCRIBE TABLE wio_positions_v1
```

Expected columns (from error message):
- `side` (or similar: `position_side`, `outcome_side`, etc.)
- `market_id` (or similar: `condition_id`, `market_condition_id`, etc.)

#### Step 3: Compare with Cron Query

**File:** `app/api/cron/update-wio-resolutions/route.ts` (Lines ~86-153)

The query references `wio_positions_v2.side` and `wio_positions_v2.market_id`.

**Check:**
1. What table name is used? (v1 vs v2)
2. What column names are used?
3. Do they match the actual schema?

### Solution

#### Fix 1: Update Table Name

If `wio_positions_v2` doesn't exist but `wio_positions_v1` does:

**File:** `app/api/cron/update-wio-resolutions/route.ts`

Change all references from:
```sql
FROM wio_positions_v2 p
```

To:
```sql
FROM wio_positions_v1 p
```

#### Fix 2: Update Column Names

If column names don't match, update the query to use correct names.

**Common mappings:**
- `wio_positions_v2.side` → `wio_positions_v1.outcome_side` or `position_side`
- `wio_positions_v2.market_id` → `wio_positions_v1.condition_id` or `market_condition_id`

**Example:**
```sql
-- OLD (broken)
WHERE wio_positions_v2.side = 'YES'

-- NEW (fixed)
WHERE wio_positions_v1.outcome_side = 'YES'
```

#### Fix 3: Verify No Other References

Search for all references to `wio_positions_v2`:
```bash
grep -r "wio_positions_v2" app/api/cron/
grep -r "wio_positions_v2" lib/
grep -r "wio_positions_v2" scripts/
```

Update all references to use the correct table name.

### Testing

After fix:

1. Run the cron manually:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://cascadian.vercel.app/api/cron/update-wio-resolutions
   ```

2. Check for errors in response

3. Verify positions were updated:
   ```sql
   SELECT count() FROM wio_positions_v1 WHERE is_resolved = 1
   ```

---

## Issue 3: Schema Mismatch - `refresh-wio-metrics` (PRIORITY: MEDIUM)

### Error

```
No such column composite_score in table default.wio_wallet_scores_v1
```

### Root Cause

The cron queries `wio_wallet_scores_v1.composite_score` but the column doesn't exist in the table.

Possible causes:
- Column was renamed in a migration
- Query is outdated (references old schema)
- Column was never created but query expects it

### Investigation Steps

#### Step 1: Check Current Schema

```sql
DESCRIBE TABLE wio_wallet_scores_v1
```

Look for:
- Does `composite_score` exist?
- Are there similar columns? (e.g., `total_score`, `final_score`, `weighted_score`)

#### Step 2: Check Cron Query

**File:** `app/api/cron/refresh-wio-metrics/route.ts`

Find where `composite_score` is referenced:
1. Is it in SELECT clause?
2. Is it in WHERE/ORDER BY clause?
3. What's it used for?

#### Step 3: Check Related Tables

```sql
-- Check if composite_score exists in other WIO tables
SELECT table, name, type
FROM system.columns
WHERE database = 'default'
  AND table LIKE '%wio%'
  AND name LIKE '%score%'
```

This will show all score-related columns in WIO tables.

### Solution

#### Option A: Add Missing Column

If `composite_score` should exist but is missing:

```sql
ALTER TABLE wio_wallet_scores_v1
ADD COLUMN composite_score Float64 DEFAULT 0
```

Then populate it:
```sql
ALTER TABLE wio_wallet_scores_v1
UPDATE composite_score = (formula here)
WHERE 1=1
```

#### Option B: Update Query to Use Correct Column

If the column was renamed:

**File:** `app/api/cron/refresh-wio-metrics/route.ts`

Change:
```sql
-- OLD
SELECT composite_score FROM wio_wallet_scores_v1

-- NEW
SELECT total_score AS composite_score FROM wio_wallet_scores_v1
```

#### Option C: Remove Composite Score Logic

If composite_score is no longer used:

**File:** `app/api/cron/refresh-wio-metrics/route.ts`

Remove all references to `composite_score` from the query.

### Recommended Approach

1. **Check schema** - Determine what columns actually exist
2. **Check other WIO crons** - See how they calculate/reference scores
3. **Align with pattern** - Use the same column names/logic as other WIO crons
4. **Update query** - Fix the cron to match actual schema

### Testing

After fix:

1. Run the cron manually:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://cascadian.vercel.app/api/cron/refresh-wio-metrics
   ```

2. Check for errors in response

3. Verify metrics were updated:
   ```sql
   SELECT count(), max(updated_at)
   FROM wio_wallet_scores_v1
   ```

---

## Issue 4: General WIO System Health Check

### Investigation

Run a comprehensive health check on all WIO tables and crons.

#### Step 1: List All WIO Tables

```sql
SELECT
  table,
  engine,
  total_rows,
  formatReadableSize(total_bytes) as size
FROM system.tables
WHERE database = 'default' AND table LIKE '%wio%'
```

#### Step 2: Check Data Freshness

```sql
-- For tables with timestamps
SELECT
  'wio_positions_v1' as table,
  max(ts_open) as latest
FROM wio_positions_v1

UNION ALL

SELECT
  'wio_wallet_scores_v1' as table,
  max(updated_at) as latest
FROM wio_wallet_scores_v1

-- Add more WIO tables as needed
```

#### Step 3: List All WIO Crons

```bash
grep -l "wio" app/api/cron/*/route.ts
```

Expected crons:
- `sync-wio-positions`
- `update-wio-resolutions`
- `refresh-wio-metrics`
- `refresh-wio-scores`
- `refresh-wio-snapshots`
- `capture-wio-anchor-prices`
- `update-price-snapshots`

#### Step 4: Check Cron Dependencies

Create a dependency graph:
1. Which crons read from WIO tables?
2. Which crons write to WIO tables?
3. What's the dependency chain?

**Example:**
```
pm_canonical_fills_v4
  ↓
sync-wio-positions (writes to wio_positions_v1)
  ↓
update-wio-resolutions (updates wio_positions_v1)
  ↓
refresh-wio-scores (writes to wio_wallet_scores_v1)
  ↓
refresh-wio-metrics (reads from wio_wallet_scores_v1)
```

### Recommendations

1. **Document WIO architecture** - Create a diagram showing all tables, crons, and data flow
2. **Standardize naming** - Ensure all WIO tables use consistent naming (v1, v2, etc.)
3. **Add monitoring** - Create health checks specifically for WIO system
4. **Test end-to-end** - Verify a wallet's journey from trade → position → score → metric

---

## Implementation Plan

### Phase 1: Investigation (Day 1)

**Goal:** Understand the current state and root causes

1. ✅ Audit all cron files for data integrity bugs (COMPLETED)
2. Run all investigation queries from Issues 1-4 above
3. Document findings in a spreadsheet:
   - Cron name
   - Current status (working/failing)
   - Root cause if failing
   - Proposed solution
   - Estimated effort

**Owner:** Investigation Agent
**Deliverable:** Investigation Report document

### Phase 2: Quick Wins (Day 2-3)

**Goal:** Fix schema mismatches and reduce immediate failures

1. Fix `update-wio-resolutions` schema mismatch (Issue 2)
2. Fix `refresh-wio-metrics` schema mismatch (Issue 3)
3. Reduce `SLICE_HOURS` in `sync-wio-positions` (Issue 1, Option B)
4. Test all fixes on production

**Owner:** Implementation Agent
**Deliverable:**
- Fixed cron files
- Test results
- Monitoring for 24 hours

### Phase 3: Memory Optimization (Day 4-7)

**Goal:** Implement batch processing to solve memory issues

1. Refactor `sync-wio-positions` with daily batching (Issue 1, Option A)
2. Refactor `refresh-wio-metrics` with batching if needed
3. Optimize `cleanup-duplicates` or disable if not needed
4. Test on staging environment first
5. Deploy to production with monitoring

**Owner:** Implementation Agent
**Deliverable:**
- Refactored cron files
- Performance benchmarks
- 48-hour stability report

### Phase 4: Long-term Stability (Week 2-4)

**Goal:** Prevent future issues and improve observability

1. Design materialized views for WIO aggregations (Issue 1, Option C)
2. Add WIO-specific health checks to monitoring
3. Document WIO system architecture
4. Create runbook for common WIO issues
5. Consider memory upgrade (Issue 1, Option D) if needed

**Owner:** Architecture Agent
**Deliverable:**
- Materialized view designs
- Monitoring dashboard
- Architecture documentation
- Runbook

---

## Success Criteria

### Phase 2 (Quick Wins)
- ✅ `update-wio-resolutions` runs without schema errors
- ✅ `refresh-wio-metrics` runs without schema errors
- ✅ `sync-wio-positions` failure rate < 10% (down from 50%)

### Phase 3 (Memory Optimization)
- ✅ `sync-wio-positions` failure rate = 0%
- ✅ All WIO crons complete within memory limits
- ✅ Application uptime > 99.9% (no cron-induced downtime)

### Phase 4 (Long-term Stability)
- ✅ Materialized views implemented and tested
- ✅ WIO monitoring dashboard live
- ✅ Zero cron failures for 7+ consecutive days
- ✅ Query performance improved by 50%+

---

## Rollback Plan

If any fix causes issues:

1. **Immediate rollback:**
   ```bash
   git revert <commit-hash>
   git push
   ```

2. **Disable problematic cron:**
   - Comment out from `vercel.json` schedule
   - Deploy

3. **Manual intervention:**
   - Run queries manually via ClickHouse client
   - Use scripts instead of cron until fixed

---

## Monitoring & Validation

### After Each Phase

1. **Check Discord alerts** - No new cron failures
2. **Check ClickHouse logs:**
   ```sql
   SELECT * FROM system.query_log
   WHERE event_time > now() - INTERVAL 1 HOUR
     AND exception != ''
   ORDER BY event_time DESC
   ```

3. **Check data freshness:**
   ```sql
   -- From JAN2026_RECOVERY_SUMMARY.md monitoring pattern
   SELECT
     'wio_positions_v1' as table,
     max(ts_open) as latest,
     dateDiff('minute', max(ts_open), now()) as minutes_old
   FROM wio_positions_v1
   ```

4. **Check uptime:**
   - UptimeRobot dashboard
   - Should show 100% uptime (no 5-11 minute outages)

---

## Files to Modify

### Phase 2 (Quick Wins)
- `app/api/cron/update-wio-resolutions/route.ts`
- `app/api/cron/refresh-wio-metrics/route.ts`
- `app/api/cron/sync-wio-positions/route.ts` (SLICE_HOURS only)

### Phase 3 (Memory Optimization)
- `app/api/cron/sync-wio-positions/route.ts` (major refactor)
- `app/api/cron/refresh-wio-metrics/route.ts` (batch processing)
- `app/api/cron/cleanup-duplicates/route.ts` (optimize or disable)

### Phase 4 (Long-term)
- New files for materialized views
- `docs/operations/WIO_ARCHITECTURE.md` (new)
- `docs/operations/WIO_RUNBOOK.md` (new)

---

## Questions for Product/Engineering

Before starting implementation, clarify:

1. **Memory budget:** Can we request a ClickHouse memory increase? What's the cost?
2. **WIO priority:** How critical is the WIO system? Should it be top priority?
3. **Downtime tolerance:** Can we disable WIO crons temporarily while fixing?
4. **Data retention:** How far back does WIO need to process? (all-time vs last 90 days?)
5. **Materialized views:** Are we comfortable with the complexity of maintaining MVs?

---

## Risks & Mitigation

### Risk 1: Fixes Break Existing Functionality
**Mitigation:**
- Test on staging first
- Deploy during low-traffic hours
- Have rollback plan ready

### Risk 2: Memory Issues Persist After Fixes
**Mitigation:**
- Have Option D (memory upgrade) approved beforehand
- Design Phase 3 solutions to work within current limits

### Risk 3: Schema Changes Break Other Code
**Mitigation:**
- Search codebase for all references before changing schemas
- Update all API routes, scripts, and tests
- Add schema migration tests

---

## Contact & Escalation

**Implementation Agent:** TBD
**Technical Lead:** TBD
**On-Call:** Check Discord #engineering

**Escalation path:**
1. Implementation Agent tries fixes
2. If blocked > 2 hours → Technical Lead
3. If production impact → Page On-Call

---

**Document Version:** 1.0
**Last Updated:** January 27, 2026
**Next Review:** After Phase 2 completion
