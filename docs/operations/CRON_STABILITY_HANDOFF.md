# Cron Stability Issues - Handoff Document

**Date:** January 27, 2026
**Status:** Ready for Implementation
**Handoff From:** Recovery Agent (Jan 26-27 data corruption fix)
**Handoff To:** TBD Implementation Agent

---

## Context

During the January 2026 data corruption recovery, we discovered several operational issues with cron jobs that are **separate from the data corruption** but need attention:

1. Multiple crons hitting ClickHouse memory limits (10.80 GiB)
2. Schema mismatches causing cron failures
3. Application downtime from cron-induced crashes

These are **operational/stability issues**, not data integrity bugs. The data corruption issue has been fixed.

---

## What's Complete (Data Corruption Recovery)

✅ **Fixed the data corruption issue:**
- Root cause: LEFT JOIN bug in `update-canonical-fills` allowing empty condition_ids
- Fixed: Changed to INNER JOIN + added validation
- Backfilled: Corrected 96M fills for Jan 16-28
- Cleaned: Removed 55.5M corrupted fills
- Monitoring: Deployed data quality monitoring cron (every 10 min)

✅ **Verified no other data corruption issues:**
- Audited all 35 cron files
- Only `update-canonical-fills` had the bug
- All other crons are safe from data corruption

⏳ **In Progress (Automated):**
- FIFO ROI rebuild for Jan 2026 (~5:00 AM completion)
- Leaderboard refresh (auto-queued after FIFO)
- Final validation (auto-queued after leaderboards)
- **ETA:** Full recovery complete by ~7:00 AM PST

---

## What Needs Your Attention (Cron Stability)

### Issue Summary

| Issue | Crons Affected | Priority | ETA |
|-------|----------------|----------|-----|
| Memory limit errors | sync-wio-positions, refresh-wio-metrics, cleanup-duplicates | HIGH | 3-7 days |
| Schema mismatch | update-wio-resolutions | MEDIUM | 1 day |
| Missing column | refresh-wio-metrics | MEDIUM | 1 day |

### Detailed Plan

**See:** `docs/operations/CRON_STABILITY_FIX_PLAN.md`

This document contains:
- Full investigation steps (with exact SQL queries to run)
- Multiple solution options for each issue
- Implementation phases (Day 1-7, Week 2-4)
- Testing procedures
- Rollback plans
- Success criteria

---

## Quick Start Guide

### Step 1: Read the Plan (15 min)

Open `docs/operations/CRON_STABILITY_FIX_PLAN.md` and read:
- Executive Summary
- Issue 1 (Memory limits) - Investigation Steps
- Issue 2 (update-wio-resolutions) - Investigation Steps
- Issue 3 (refresh-wio-metrics) - Investigation Steps

### Step 2: Run Investigation Queries (30 min)

Copy-paste the SQL queries from the plan document into ClickHouse to understand current state:

```sql
-- Check which WIO tables exist
SELECT table, engine FROM system.tables WHERE table LIKE '%wio%'

-- Check wio_positions schema
DESCRIBE TABLE wio_positions_v1

-- Check wio_wallet_scores schema
DESCRIBE TABLE wio_wallet_scores_v1

-- Check memory usage patterns
SELECT ... (from plan document)
```

### Step 3: Start with Quick Wins (Day 1-2)

Fix the schema mismatches first - these are simple fixes:
1. Fix `update-wio-resolutions` table/column references
2. Fix `refresh-wio-metrics` missing column
3. Test both crons manually

**See:** Plan document Phase 2 (Quick Wins)

### Step 4: Tackle Memory Issues (Day 3-7)

Implement batch processing for memory-heavy crons:
1. Reduce SLICE_HOURS in `sync-wio-positions`
2. Implement daily batching if needed
3. Monitor for 48 hours

**See:** Plan document Phase 3 (Memory Optimization)

---

## Key Files

### Documentation
- **Main plan:** `docs/operations/CRON_STABILITY_FIX_PLAN.md` ← START HERE
- **Recovery summary:** `docs/operations/JAN2026_RECOVERY_SUMMARY.md`
- **Data corruption incident:** `docs/operations/DATA_CORRUPTION_JAN2026_INCIDENT.md`

### Cron Files to Modify
- `app/api/cron/sync-wio-positions/route.ts` - Memory optimization
- `app/api/cron/update-wio-resolutions/route.ts` - Schema fix
- `app/api/cron/refresh-wio-metrics/route.ts` - Schema fix + memory optimization
- `app/api/cron/cleanup-duplicates/route.ts` - Timeout fix

### Monitoring
- Discord #alerts channel - Cron failure notifications
- UptimeRobot dashboard - App downtime tracking
- ClickHouse `system.query_log` - Query performance

---

## Tasks Created

Three tasks are waiting in the task list:

| Task # | Title | Priority | File |
|--------|-------|----------|------|
| #11 | Fix sync-wio-positions memory limit error | HIGH | CRON_STABILITY_FIX_PLAN.md Issue 1 |
| #14 | Fix schema mismatch in update-wio-resolutions | MEDIUM | CRON_STABILITY_FIX_PLAN.md Issue 2 |
| #15 | Fix missing composite_score in refresh-wio-metrics | MEDIUM | CRON_STABILITY_FIX_PLAN.md Issue 3 |

---

## Success Criteria

You'll know you're done when:

✅ **Quick Wins (Phase 2):**
- `update-wio-resolutions` runs without errors
- `refresh-wio-metrics` runs without errors
- `sync-wio-positions` failure rate drops from 50% to <10%

✅ **Memory Optimization (Phase 3):**
- All WIO crons complete within memory limits
- Zero cron-induced application downtime
- Discord shows no memory limit errors for 48+ hours

✅ **Validation:**
- WIO positions data is fresh (<10 minutes old)
- WIO metrics dashboard loads without errors
- All WIO leaderboards show current data

---

## Important Notes

### Do NOT Break the Recovery

The FIFO rebuild and leaderboard refresh are running in the background. **Do not:**
- Restart ClickHouse
- Drop any tables (especially `pm_trade_fifo_roi_v3`)
- Modify `pm_canonical_fills_v4`
- Touch any recovery-related files

### Check Recovery Status First

Before starting, verify the recovery is complete:

```bash
# Check if FIFO rebuild is done
ps aux | grep "build-trade-fifo-v4"

# Check auto-completion progress
tail -f /tmp/recovery-auto-complete.log

# Should show "RECOVERY COMPLETE"
```

### Test on Staging First

If you have a staging environment:
1. Deploy fixes to staging first
2. Run manual tests
3. Monitor for 24 hours
4. Then deploy to production

### Rollback Plan

If anything breaks:
```bash
git revert <commit-hash>
git push
```

Or disable the cron in `vercel.json` until fixed.

---

## Questions?

If blocked or need clarification:
1. Check the detailed plan document first
2. Search previous Discord alerts for patterns
3. Ask in #engineering channel
4. Escalate to technical lead if blocked >2 hours

---

## Estimated Timeline

**Quick Wins (Phase 2):** 1-2 days
- Day 1: Investigation + schema fixes
- Day 2: Testing + monitoring

**Memory Optimization (Phase 3):** 3-5 days
- Day 3-4: Implement batch processing
- Day 5: Testing + monitoring

**Long-term (Phase 4):** 2-4 weeks (optional)
- Materialized views design + implementation

**Total:** 1-2 weeks for stable cron system

---

## Final Checklist Before Starting

- [ ] Read `CRON_STABILITY_FIX_PLAN.md` (full document)
- [ ] Verify recovery is complete (`tail -f /tmp/recovery-auto-complete.log`)
- [ ] Have access to ClickHouse (test with `SELECT 1`)
- [ ] Have access to deploy (test with `vercel --version`)
- [ ] Have CRON_SECRET environment variable
- [ ] Discord notifications are working
- [ ] Created tracking task/ticket for this work

---

**Handoff Complete**

Recovery Agent is signing off. The data corruption is fixed and monitored. The remaining work is operational stability improvements.

Good luck! 🚀

---

**Document Version:** 1.0
**Date:** January 27, 2026
**Next Review:** After Phase 2 completion
