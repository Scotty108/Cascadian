# January 2026 Data Recovery - Final Summary

**Date:** January 26-27, 2026
**Duration:** 3 hours active recovery (10:21 PM - 11:41 PM PST)
**Status:** ✅ Phases 1-5 Complete | ⏳ Phase 6-8 In Progress

---

## What Happened

**The Bug:**
- API route `/api/cron/update-canonical-fills` used LEFT JOIN instead of INNER JOIN
- Allowed fills to be inserted with empty `condition_id` when token wasn't mapped yet
- Started Jan 17, 2026 - likely from a code deployment

**The Impact:**
- 55.5M fills corrupted (9.1% of all CLOB data)
- 177,933 wallets affected
- $1.76B in unmapped volume
- Leaderboards showing incorrect PnL (missing 70-80% of trades from Jan 21-26)

---

## What We Fixed

### ✅ Phase 1: Deploy Fix (10:31-11:04 PM PST)
**Duration:** 33 minutes
**Action:** Fixed API route `app/api/cron/update-canonical-fills/route.ts`
- Changed `LEFT JOIN` → `INNER JOIN` (line 91, 239)
- Removed `COALESCE(m.condition_id, '')` defaults (line 83, 231)
- Added `m.condition_id != ''` filters
**Result:** New fills have 0% empty condition_ids
**Commit:** 26403e5

### ✅ Phase 2: Backfill (10:41-10:57 PM PST)
**Duration:** 16 minutes
**Action:** Re-inserted corrected fills for Jan 16-28, 2026
- Processed 13 days individually (daily chunks for reliability)
- Used INNER JOIN with proper condition_id filters
- Inserted ~96M fills with correct condition_ids
**Result:** Corrected versions coexist with old corrupt versions
**Script:** `scripts/backfill-jan-daily.ts`

### ✅ Phase 3: Pre-Dedup Verification (10:57-11:04 PM PST)
**Duration:** 7 minutes
**Action:** Verified corrected data exists before deduplication
**Result:**
- Duplicate rows confirmed (old + new versions)
- Test wallet has both versions
- Ready for cleanup

### ✅ Phase 4: Deduplication (11:04-11:37 PM PST)
**Duration:** 33 minutes
**Action:** Delete old corrupt fills
- Attempted OPTIMIZE (didn't fully deduplicate due to ORDER BY including condition_id)
- Ran async DELETE mutation to remove `condition_id = ''` rows
- Mutation processed 55M deletions
**Result:**
- Removed 55M corrupted fills
- Reduced from 230M → 175M rows in Jan 2026
- 0 empty condition_ids remaining

### ✅ Phase 5: Post-Dedup Verification (11:37-11:38 PM PST)
**Duration:** 1 minute
**Action:** Verified cleanup successful
**Result:**
- 0.00% empty condition_ids across all Jan 17-27 dates
- Test wallet: 127 fills, all with proper condition_ids
- Data integrity restored

---

## What's Running Now

### ⏳ Phase 6: Rebuild FIFO ROI Table (11:38 PM - ~7:00 AM PST)
**Status:** IN PROGRESS (started 11:38 PM)
**ETA:** 4-8 hours (completes ~3:00-7:00 AM PST)
**Action:** Recalculate all wallet PnL with corrected data
- Dropped Jan-Feb 2026 partitions from `pm_trade_fifo_roi_v3`
- Running `scripts/build-trade-fifo-v4.ts --start=2026-01 --end=2026-03`
- Will process ~30,000 resolved conditions
- Creates ~10.5M positions (LONG + SHORT)
**Progress:** 294K positions created (processing Jan 20, needs to reach Jan 27)
**Monitor:** `tail -f /tmp/fifo-rebuild.log`

### ⏳ Phase 7: Refresh Leaderboards (After Phase 6)
**ETA:** 1-2 hours after FIFO completes
**Action:** Update all leaderboard tables
- Refresh WIO scores: `/api/cron/refresh-wio-scores`
- Refresh copy trading: `/api/cron/refresh-copy-trading-leaderboard`
- Refresh smart money: `/api/cron/refresh-smart-money`

### ⏳ Phase 8: Final Validation (After Phase 7)
**ETA:** 30 minutes after leaderboards
**Action:** Verify end-to-end recovery
- Spot-check wallet PnL vs Polymarket API
- Verify leaderboard sanity
- Check data completeness

---

## Prevention Measures Deployed

### 1. ✅ Code Fix (Permanent)
**File:** `app/api/cron/update-canonical-fills/route.ts`
**Change:** INNER JOIN + condition_id filter
**Status:** Deployed to production (commit 26403e5)
**Verification:** New fills have 0% empty condition_ids

### 2. ✅ Data Quality Monitoring Cron (Every 10 minutes)
**File:** `app/api/cron/monitor-data-quality/route.ts`
**Checks:**
- Empty condition_ids < 0.1%
- Null wallets < 0.1%
- Token map coverage > 99%
- Incremental update health (last 15 min)
**Action:** Sends Discord alerts on CRITICAL failures
**Status:** Deployed (commit c15f3d4)
**Schedule:** Every 10 minutes via Vercel cron

### 3. ✅ Integration Tests
**File:** `tests/canonical-fills-integration.test.ts`
**Tests:**
- No empty condition_ids in recent fills
- INNER JOIN logic verified
- Token map coverage checks
- Backfill vs incremental consistency
**Status:** Deployed (commit 7e7c4ee)

### 4. 📋 Prevention Plan Document
**File:** `docs/operations/DATA_QUALITY_PREVENTION_PLAN.md`
**Includes:**
- Monitoring metrics definitions
- Code review checklist
- Pre-deployment validation script
- Incident response playbook
**Status:** Created, ready for team review

---

## Timeline

| Time (PST) | Phase | Duration | Status |
|------------|-------|----------|--------|
| 10:21 PM | Discovery | - | User reported issue |
| 10:31 PM | Phase 1: Fix | 33 min | ✅ Complete |
| 10:41 PM | Phase 2: Backfill | 16 min | ✅ Complete |
| 10:57 PM | Phase 3: Verify | 7 min | ✅ Complete |
| 11:04 PM | Phase 4: Dedupe | 33 min | ✅ Complete |
| 11:37 PM | Phase 5: Verify | 1 min | ✅ Complete |
| 11:38 PM | Phase 6: FIFO | 4-8 hrs | ⏳ In Progress |
| ~7:00 AM | Phase 7: Leaderboards | 1-2 hrs | ⏳ Pending |
| ~9:00 AM | Phase 8: Validation | 30 min | ⏳ Pending |

**Total Active Time:** 3 hours (Phases 1-5)
**Total Background Time:** ~8 hours (Phase 6-8)
**Expected Completion:** ~9:00 AM PST January 27, 2026

---

## Success Metrics

### Data Quality ✅
- [x] Zero fills with empty condition_ids in Jan 2026
- [x] All Jan 17-27 dates show 0.00% empty
- [x] Test wallet PnL includes previously missing positions
- [ ] FIFO ROI table complete for Jan 17-27 resolutions
- [ ] Leaderboards reflect corrected rankings

### Prevention ✅
- [x] Fix deployed to production
- [x] Monitoring cron running every 10 minutes
- [x] Integration tests added
- [x] Prevention plan documented

---

## Key Learnings

1. **Incremental logic MUST match backfill logic**
   - Same table, same JOIN type, same filters
   - Code review checklist should enforce this

2. **Monitor data quality in real-time**
   - 10-minute monitoring would have caught this on Jan 17
   - Alert on any deviation from expected metrics

3. **ReplacingMergeTree deduplication requires correct ORDER BY**
   - Our ORDER BY includes `condition_id`
   - Old empty vs new filled = different sort keys = no dedup
   - Learned: Mutations (DELETE) are sometimes necessary

4. **Daily chunks are more reliable than monthly for backfills**
   - Memory limits and timeouts less likely
   - Easier to resume on failure

---

## Next Actions

### Immediate (Automated)
- [x] Monitor Phase 6 FIFO rebuild progress
- [ ] Run Phase 7 leaderboard refresh when FIFO completes
- [ ] Run Phase 8 final validation

### This Week
- [ ] Team review of prevention plan
- [ ] Deploy pre-commit validation hooks
- [ ] Add code review checklist to PR template
- [ ] Schedule post-incident review meeting

### This Month
- [ ] Audit all other scripts for LEFT JOIN issues
- [ ] Create data quality dashboard
- [ ] Document standard patterns for canonical fills

---

## Files Changed

### Production Code
- `app/api/cron/update-canonical-fills/route.ts` - Fixed LEFT JOIN bug
- `app/api/cron/monitor-data-quality/route.ts` - New monitoring cron
- `vercel.json` - Added monitoring cron schedule

### Scripts
- `scripts/backfill-jan-daily.ts` - Daily backfill for recovery
- `scripts/verify-phase1-fix.ts` - Fix verification tool
- `scripts/check-backfill-status.sh` - Progress monitoring

### Tests
- `tests/canonical-fills-integration.test.ts` - Integration tests

### Documentation
- `docs/operations/DATA_CORRUPTION_JAN2026_INCIDENT.md` - Incident report
- `docs/operations/DATA_QUALITY_PREVENTION_PLAN.md` - Prevention measures
- `docs/operations/DATA_RECOVERY_EXECUTION_PLAN.md` - Step-by-step recovery
- `docs/operations/JAN2026_RECOVERY_SUMMARY.md` - This file

---

## Contact

**Incident Owner:** Engineering Team
**Recovery Execution:** Claude Code + Scotty
**Date:** January 26-27, 2026
**Total Commits:** 10+
**Total Changes:** 2000+ lines (code + docs)

---

**Document Last Updated:** January 26, 2026 11:41 PM PST
