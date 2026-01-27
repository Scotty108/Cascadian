# Data Corruption Incident - January 2026

**Status:** CRITICAL - Active Data Emergency
**Discovered:** January 27, 2026
**Impact:** 177,933 wallets affected (~9% of platform), $1.76B in unmapped volume
**Root Cause:** Incremental update script using LEFT JOIN instead of INNER JOIN

---

## Executive Summary

A critical data integrity issue was discovered affecting **55.5 million fills** (9.1% of all CLOB data) from January 17-27, 2026. These fills were inserted into `pm_canonical_fills_v4` with empty `condition_id` values, causing:

- **Severely understated PnL calculations** (70-80% of trades missing from Jan 21-26)
- **Inaccurate leaderboard rankings** (all ROI, copy-trading, smart money boards compromised)
- **Broken wallet statistics** (win rates, ROI, profit factors all wrong)
- **Missing FIFO positions** (majority of recent trades not in `pm_trade_fifo_roi_v3`)

---

## Timeline

### Before Jan 17, 2026
- System functioning normally
- ~0% of fills had empty condition_ids
- Token map rebuild cron running every 10 minutes

### Jan 17, 2026 00:00 UTC - **THE BREAK**
- Empty fill percentage jumps from 0% → 9.65%
- 616,317 new markets synced on this day
- **Hypothesis:** Code deploy changed LEFT JOIN logic in incremental update script

### Jan 17-27, 2026 - **Progressive Degradation**
| Date | Empty % | Affected Volume | Status |
|------|---------|-----------------|--------|
| Jan 17 | 9.65% | $61M | Initial break |
| Jan 20 | 66.98% | $113M | Worsening |
| Jan 21 | 68.33% | $162M | Crisis level |
| Jan 22 | 72.88% | $194M | Accelerating |
| Jan 23 | 75.28% | $208M | Severe |
| Jan 24 | 76.85% | $277M | Critical |
| Jan 25 | 78.82% | $287M | Catastrophic |
| Jan 26 | **83.56%** | $260M | **Peak damage** |
| Jan 27 | 1.72% | $3.7M | Improvement (why?) |

---

## Root Cause Analysis

### The Bug

**File:** `scripts/cron/update-canonical-fills.ts:96`

**BROKEN CODE (current):**
```typescript
FROM pm_trader_events_v3 t
LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
WHERE t.block_number > ${startBlock}
  AND NOT (...)
```

**CORRECT CODE (backfill script):**
```typescript
FROM pm_trader_events_v3 t
JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
WHERE t.trade_time >= '${month.start}' AND t.trade_time < '${month.end}'
  AND m.condition_id != ''
  AND NOT (...)
```

### Key Differences

1. **LEFT JOIN vs INNER JOIN**
   - LEFT JOIN: Includes ALL trader events, even if token_id not in map
   - INNER JOIN: Only includes events with valid token mappings

2. **Missing Filter**
   - Broken: No filter on `m.condition_id != ''`
   - Correct: Explicitly filters out empty condition_ids

### Why It Happened

The incremental update script (runs every 5 min) was changed from INNER JOIN to LEFT JOIN, likely to "capture all trades" without realizing this would insert unmapped tokens with empty condition_ids.

The backfill script (runs once for historical data) still uses the correct INNER JOIN pattern.

---

## Impact Assessment

### Overall Data Corruption
```
Total Fills (all-time):     610,188,440
Empty Condition IDs:         55,516,358 (9.1%)
Affected Wallets:            177,933 (9.2% of all wallets)
Affected Volume:             $1.76 Billion
Time Range:                  Jan 17 - Jan 27, 2026
```

### By Source
```
CLOB:      55,488,766 empty (63.83% of Jan 17-27 CLOB fills)
NegRisk:       71,041 empty (64% of Jan 17-27 NegRisk)
CTF Token:          0 empty (working correctly)
CTF Cash:           0 empty (working correctly)
```

### Downstream Tables Affected

1. **pm_trade_fifo_roi_v3** - Missing 70-80% of Jan 17-27 positions
2. **All leaderboards** - Garbage data for last 10 days
3. **Wallet PnL calculations** - Severely understated
4. **Win rate metrics** - Completely inaccurate
5. **Copy trading scores** - Based on incomplete data

---

## Why Token Map Rebuild Didn't Help

The token map rebuild cron (`/api/cron/rebuild-token-map`) IS running successfully:
- Executes every 10 minutes
- 960 executions since Jan 15
- All reporting `status: "success"`

**BUT** the cron logs show:
```json
{
  "newFromMetadata": 0,
  "newFromPatch": 0,
  "coveragePct": 100
}
```

The rebuild is finding **0 new tokens** on each run because:
1. It only checks tokens that already traded (circular logic)
2. The `coveragePct: 100%` only measures tokens it knows about
3. It doesn't discover newly created market tokens until they're in trader_events

This created a **chicken-and-egg problem:**
- New sports markets created with new token_ids
- Tokens not in map yet when trades happen
- Incremental update inserts fills with empty condition_ids
- Token map rebuild doesn't add them because it's looking at wrong source

---

## Comprehensive Cleanup Plan

### Phase 1: Stop the Bleeding (10 minutes)

**Task 1.1:** Fix incremental update script
```bash
# Edit scripts/cron/update-canonical-fills.ts:96
- LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
+ JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
  WHERE t.block_number > ${startBlock}
+   AND m.condition_id != ''
    AND NOT (...)
```

**Task 1.2:** Deploy fix immediately
```bash
git add scripts/cron/update-canonical-fills.ts
git commit -m "fix: change LEFT JOIN to INNER JOIN in canonical fills update

CRITICAL FIX for data corruption issue affecting 55M fills.

- Change LEFT JOIN to INNER JOIN to match backfill script
- Add filter for m.condition_id != '' to exclude unmapped tokens
- Prevents insertion of fills with empty condition_ids

This fixes the Jan 17-27 data corruption incident where 70-80%
of fills were missing condition_ids due to incorrect JOIN logic.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

# Push to production immediately
git push origin main
# Verify deployment
```

**Estimated Time:** 10 minutes
**Impact:** Stops new corrupted data from being created

---

### Phase 2: Clean Corrupted Data (2-4 hours)

**Task 2.1:** Delete empty fills by partition
```sql
-- Delete Jan 2026 empty fills (largest batch)
ALTER TABLE pm_canonical_fills_v4
DELETE WHERE condition_id = ''
  AND toYYYYMM(event_time) = 202601;

-- Delete Feb 2026 empty fills
ALTER TABLE pm_canonical_fills_v4
DELETE WHERE condition_id = ''
  AND toYYYYMM(event_time) = 202602;

-- Delete any remaining empty fills from earlier months
ALTER TABLE pm_canonical_fills_v4
DELETE WHERE condition_id = ''
  AND toYYYYMM(event_time) < 202601;
```

**Task 2.2:** Verify deletion
```sql
SELECT
  count() as remaining_empty,
  countIf(condition_id = '') as should_be_zero
FROM pm_canonical_fills_v4;
```

**Estimated Time:** 2-4 hours (large deletes are slow)
**Impact:** Removes all corrupted data from canonical fills table

---

### Phase 3: Backfill Correct Data (3-6 hours)

**Task 3.1:** Run backfill for affected months
```bash
# Backfill Jan 2026 with correct JOIN logic
npx tsx scripts/backfill-canonical-fills-v4.ts --start=2026-01-01 --end=2026-02-01

# Backfill Feb 2026 (just in case)
npx tsx scripts/backfill-canonical-fills-v4.ts --start=2026-02-01 --end=2026-03-01
```

**Task 3.2:** Verify backfill results
```sql
SELECT
  toDate(event_time) as date,
  count() as total_fills,
  countIf(condition_id = '') as empty_fills,
  round(countIf(condition_id = '') * 100.0 / count(), 2) as pct_empty
FROM pm_canonical_fills_v4
WHERE source = 'clob'
  AND event_time >= '2026-01-17'
GROUP BY date
ORDER BY date DESC;

-- Should show 0% empty for all dates
```

**Estimated Time:** 3-6 hours
**Impact:** Restores all missing fills with proper condition_id mappings

---

### Phase 4: Rebuild Derived Tables (4-8 hours)

**Task 4.1:** Rebuild FIFO ROI table
```bash
# Delete Jan-Feb 2026 partitions
clickhouse-client --query "
ALTER TABLE pm_trade_fifo_roi_v3
DROP PARTITION 202601;

ALTER TABLE pm_trade_fifo_roi_v3
DROP PARTITION 202602;"

# Rebuild with corrected data
npx tsx scripts/build-trade-fifo-v4.ts --start=2026-01 --end=2026-03
```

**Task 4.2:** Refresh leaderboard tables
```bash
# Trigger smart money refresh
curl -X POST https://cascadian.vercel.app/api/cron/refresh-smart-money \
  -H "Authorization: Bearer ${CRON_SECRET}"

# Trigger copy trading leaderboard refresh
curl -X POST https://cascadian.vercel.app/api/cron/refresh-copy-trading-leaderboard \
  -H "Authorization: Bearer ${CRON_SECRET}"

# Refresh WIO scores
curl -X POST https://cascadian.vercel.app/api/cron/refresh-wio-scores \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

**Estimated Time:** 4-8 hours
**Impact:** All wallet statistics and leaderboards recalculated with correct data

---

### Phase 5: Verification (1 hour)

**Task 5.1:** Validate data integrity
```sql
-- Check 1: No empty condition_ids remain
SELECT count() FROM pm_canonical_fills_v4 WHERE condition_id = '';
-- Expected: 0

-- Check 2: Recent fill counts look reasonable
SELECT
  toDate(event_time) as date,
  count() as fills,
  count(DISTINCT wallet) as wallets
FROM pm_canonical_fills_v4
WHERE event_time >= '2026-01-17'
GROUP BY date
ORDER BY date DESC;
-- Should show consistent daily volumes

-- Check 3: FIFO ROI table has data
SELECT
  count() as positions,
  count(DISTINCT wallet) as wallets,
  sum(pnl_usd) as total_pnl
FROM pm_trade_fifo_roi_v3
WHERE resolved_at >= '2026-01-17';
-- Should show millions of positions
```

**Task 5.2:** Spot-check wallet PnL against Polymarket API
```bash
# Test wallet: 0xb17dd9cbcbccffba903c4eb378f024554521a597
npx tsx scripts/leaderboard/test-single-wallet.ts 0xb17dd9cbcbccffba903c4eb378f024554521a597

# Should now show ~$199 PnL + any previously missing positions
```

**Estimated Time:** 1 hour
**Impact:** Confirms all data is corrected and accurate

---

## Total Timeline

| Phase | Duration | Can Run Parallel? |
|-------|----------|-------------------|
| Phase 1: Fix Script | 10 min | No (must be first) |
| Phase 2: Clean Data | 2-4 hr | No (must delete before backfill) |
| Phase 3: Backfill | 3-6 hr | No (must complete before rebuild) |
| Phase 4: Rebuild | 4-8 hr | Yes (can run multiple crons in parallel) |
| Phase 5: Verify | 1 hr | No (must be last) |

**Minimum Total:** ~10-19 hours
**Maximum Total:** ~14-23 hours

**Recommended Schedule:**
- Start Phase 1: Immediately
- Start Phase 2: After Phase 1 deploy confirmed
- Start Phase 3: After Phase 2 completes
- Start Phase 4: After Phase 3 completes (can run overnight)
- Start Phase 5: Next morning after Phase 4 completes

---

## Prevention Measures

### 1. Add Integration Tests
Create test that verifies canonical fills update matches backfill behavior:
```typescript
// tests/canonical-fills-integration.test.ts
test('incremental update uses INNER JOIN like backfill', async () => {
  // Insert test trader event with unmapped token
  // Run incremental update
  // Verify fill was NOT inserted (should be filtered out)
});
```

### 2. Add Monitoring Alerts
```sql
-- Alert if empty condition_id percentage > 0.1%
CREATE MATERIALIZED VIEW pm_canonical_fills_health AS
SELECT
  toDate(event_time) as date,
  countIf(condition_id = '') * 100.0 / count() as pct_empty
FROM pm_canonical_fills_v4
WHERE event_time >= today() - INTERVAL 1 DAY
GROUP BY date;

-- Trigger alert if pct_empty > 0.1
```

### 3. Improve Token Map Rebuild
Change token map rebuild to proactively fetch from market metadata:
```typescript
// Instead of checking trader_events (circular logic)
// Directly query pm_market_metadata for new markets
INSERT INTO pm_token_to_condition_map_v5
SELECT token_id, condition_id, outcome_index, question, category
FROM (
  SELECT
    arrayJoin(token_ids) as token_id,
    condition_id,
    outcome_index,
    question,
    category
  FROM pm_market_metadata
  WHERE ingested_at >= now() - INTERVAL 1 HOUR
)
WHERE token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v5);
```

### 4. Code Review Checklist
- [ ] All canonical fills queries use INNER JOIN (not LEFT JOIN)
- [ ] All queries filter `m.condition_id != ''`
- [ ] Incremental update logic matches backfill logic
- [ ] Integration tests verify JOIN behavior

---

## Post-Incident Review Questions

1. **When did the LEFT JOIN change get deployed?**
   - Check git history around Jan 17, 2026
   - Identify who made the change and why

2. **Why didn't we catch this sooner?**
   - No monitoring on empty condition_id percentage
   - No alerts for data quality degradation
   - Manual spot-checks weren't frequent enough

3. **Why did Jan 27 improve to 1.72% empty?**
   - Investigate what changed on Jan 27
   - Was there a code rollback?
   - Did token map finally catch up?

4. **How many users noticed?**
   - Check for user complaints about incorrect PnL
   - Review support tickets from Jan 17-27

---

## Communication Plan

### Internal
- [x] Engineering team notified
- [ ] PM/Product team briefed on impact
- [ ] Timeline shared with stakeholders

### External (if needed)
- [ ] Draft user notification about data refresh
- [ ] Prepare explanation for leaderboard changes
- [ ] FAQ for wallet PnL discrepancies

---

## Document History

- **2026-01-27 21:11 UTC:** Initial incident documentation
- **Status:** Draft - cleanup plan not yet executed

---

## Next Steps

1. ✅ Document root cause and impact (COMPLETE)
2. ⏳ Execute Phase 1: Fix script
3. ⏳ Execute Phase 2-5: Data cleanup
4. ⏳ Post-incident review
5. ⏳ Implement prevention measures
