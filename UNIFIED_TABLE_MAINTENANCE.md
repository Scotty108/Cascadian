# Unified Table Maintenance Guide

## Current Status

**Table:** `pm_trade_fifo_roi_v3_mat_unified`
- **Last Entry:** Jan 29, 01:09:56 (36 hours stale as of now)
- **Total Rows:** 295.6M
- **Unique Wallets:** 272k
- **Mix:** Both resolved AND unresolved positions

## Data Pipeline (Currently Working)

| Component | Schedule | Status | Purpose |
|-----------|----------|--------|---------|
| Token Mappings | Every 10 min | ✅ Active | `rebuild-token-map` → `pm_token_to_condition_map_v5` |
| Fix Unmapped | Daily 4am | ✅ Active | `fix-unmapped-tokens` → Gamma API fallback |
| CLOB Fills | Every 10 min | ✅ Active | `update-canonical-fills` → `pm_canonical_fills_v4` |
| ERC1155 | Every 30 min | ✅ Active | `sync-erc1155` → blockchain transfers |
| Resolved FIFO | Every 2 hours | ✅ Active | `refresh-fifo-trades` → `pm_trade_fifo_roi_v3_deduped` |

## Missing: Unified Table Refresh

The 10-day unified table has **no automatic refresh mechanism**. It was built once manually and is now static.

### What's Working
- ✅ **Source data** is fresh (CLOB fills, ERC1155, token maps)
- ✅ **Resolved positions** are updated every 2 hours → `pm_trade_fifo_roi_v3_deduped`

### What's Missing
- ❌ **Unresolved positions** - No incremental updates
- ❌ **Unified merge** - No cron to combine resolved + unresolved

## Quick Manual Refresh (When Needed)

Until the automated cron is working, run this SQL manually when you need fresh data:

```sql
-- 1. Insert newly resolved positions (last 48 hours)
INSERT INTO pm_trade_fifo_roi_v3_mat_unified
SELECT *
FROM pm_trade_fifo_roi_v3_deduped
WHERE resolved_at >= now() - INTERVAL 48 HOUR;

-- 2. Optimize/deduplicate
OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL;
```

**Runtime:** ~2-3 minutes
**Coverage:** Captures all new resolutions, but not new unresolved positions

## Full Rebuild (Weekly Recommended)

For complete freshness including unresolved positions:

```bash
# Option 1: Single worker (slow but safe)
npx tsx scripts/build-unified-10day-single.ts

# Option 2: Parallel workers (fast)
npx tsx scripts/build-unified-10day-orchestrate.ts
```

**Runtime:**
- Single worker: 8-10 hours
- 3 workers: 2-3 hours

**When to use:**
- Weekly maintenance window
- After major data pipeline changes
- When unresolved position data is critical

## Automated Solution (In Progress)

### Created Files
1. `/app/api/cron/refresh-unified-incremental/route.ts` - Cron endpoint
2. `/scripts/refresh-unified-incremental.ts` - Standalone script
3. `/scripts/refresh-unified-simple.ts` - Simplified version

### Added to vercel.json
```json
{
  "path": "/api/cron/refresh-unified-incremental",
  "schedule": "0 5 * * *"
}
```

### Status: **Blocked**

**Issue:** ClickHouse Cloud limitations:
- TEMPORARY tables don't work as expected
- Correlated subqueries not supported in WHERE/IN clauses
- Need to refactor using LEFT JOIN anti-pattern

### Next Steps for Automation
1. Rewrite queries using LEFT JOIN instead of NOT IN
2. Remove temp table dependency
3. Test with 1-hour lookback first
4. Deploy to cron once stable

## Workaround for Leaderboard

Your copytrading leaderboard (`copytrade-leaderboard-90d-top50-bankroll1000.csv`) is based on this table.

**Current approach:**
- Table is 36 hours stale → leaderboard shows data up to Jan 29 01:09
- For weekly/daily leaderboards, this lag is acceptable

**If you need real-time data:**
1. Run the quick manual refresh SQL above (2-3 min)
2. Re-run your leaderboard script: `npx tsx scripts/analysis/copytrade-leaderboard-90d.ts`

## Monitoring

Check table freshness:
```sql
SELECT
  max(entry_time) as latest_entry,
  max(resolved_at) as latest_resolution,
  dateDiff('hour', max(entry_time), now()) as hours_stale
FROM pm_trade_fifo_roi_v3_mat_unified;
```

Alert if `hours_stale > 48`.

## Summary

**Short term (Today):**
- Use manual SQL refresh when needed (2-3 min)
- Table is current enough for weekly leaderboards

**Medium term (This Week):**
- Fix automated cron job (rewrite queries)
- Deploy daily 5am refresh

**Long term (Ongoing):**
- Weekly full rebuild for validation
- Monitor for drift/duplicates
- Add pruning for data > 10 days old
