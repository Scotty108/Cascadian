# 🚨 CRITICAL FINDINGS: Data Disconnect Between Resolutions and Fills

**Date:** 2025-11-12
**Agent:** Claude 2
**Status:** BLOCKER IDENTIFIED - Requires User Decision

---

## Executive Summary

Successfully implemented the user's 3-step resolution timestamp enrichment, achieving 100% timestamp coverage in `market_resolutions_norm`. However, investigation revealed **zero overlap** between resolution data and traded fill data - they reference completely different sets of markets.

**Bottom Line:** Cannot build valid fixture for P&L validation because resolution data and fill data are disjoint datasets.

---

## What We Accomplished

### ✅ Completed Successfully

1. **Built `resolution_timestamps` table** (132,912 rows)
   - Source: `resolutions_external_ingest`
   - Aggregated earliest `resolved_at` per `condition_id_norm`

2. **Enriched `market_resolutions_norm` view**
   - Used `coalesce(mr.resolved_at, rt.resolved_at)` for fallback
   - Achieved 100% timestamp coverage (218,325 resolutions)

3. **Validated join mechanics**
   - Normalized condition_id format (64-char lowercase hex)
   - Joins execute without errors
   - Token decode path works correctly

---

## The Critical Problem

### Data Disconnect Evidence

**Script 21: Resolution-Fill Overlap Check**
```
Valid resolutions: 214,744
Fills with valid resolutions: 0
Unique conditions: 0
```

**Script 22: Condition ID Comparison**

| Source | Sample Condition IDs | Count |
|--------|---------------------|-------|
| **Resolutions** | `0000bd14c46a76b3...`<br>`000149d7a2971f4b...`<br>`0001bd6b1ce49b28...` | 214,744 |
| **Traded Assets** | `0022100819470a08...`<br>`0032354f52a721b1...`<br>`0025b61101d1612a...` | 116,546 |
| **Overlap** | — | **0** |

### Why Earlier Scripts Showed "100% Overlap"

**Script 14 claimed:**
> "100% of 116,546 traded assets have resolved_at"

**Reality:**
- The LEFT JOIN succeeded (found rows in resolutions table)
- But matched **different** condition_ids than those traded
- Result: Epoch timestamps (`1970-01-01`) indicating NULL data

---

## Root Cause Analysis

### Hypothesis 1: Different Time Periods
**Tested:** Queried fills from 2024-2025, resolutions from multiple sources
**Result:** No temporal mismatch - data is from same period
**Conclusion:** ❌ Not a time period issue

### Hypothesis 2: Format Mismatch
**Tested:** Both datasets use 64-char normalized condition_ids
**Result:** Format is identical
**Conclusion:** ❌ Not a format issue

### Hypothesis 3: Different Market Sets ✅
**Tested:** Direct comparison of condition_id values
**Result:** Zero matches between resolution and fill condition_ids
**Conclusion:** ✅ **Resolutions and fills reference completely different markets**

---

## Why This Happened

### Possible Explanations

**Option A: Incomplete Data Ingestion**
- Resolution data was backfilled for different markets than fill data
- `resolutions_external_ingest` all timestamped `2025-11-10 03:32:19` (backfill date)
- May have been a test/sample backfill that didn't match production fills

**Option B: Multiple Market Ecosystems**
- Different CTF deployments or market protocols
- Resolution data from one ecosystem, fills from another
- Would require checking contract addresses and deployment history

**Option C: Data Pipeline Misconfiguration**
- Resolution ingestion targeting different condition_id space
- Token map and fills correctly paired, but resolutions from wrong source
- Would need to audit data pipeline configuration

---

## Impact Assessment

### Cannot Complete Track A ❌

**Original Objectives:**
- ✅ Fix join mechanics → DONE
- ✅ Normalize condition_ids → DONE
- ✅ Enrich timestamps → DONE (but wrong dataset)
- ❌ Build 15-row fixture → BLOCKED
- ❌ Compute resolution P&L → BLOCKED
- ❌ Run Checkpoints A-D → BLOCKED

**Grade:** B → D (Technical implementation correct, but fundamentally wrong data)

---

## Scripts Created This Session

**Infrastructure (Working):**
1. `01-create-normalized-views.ts` - Created normalized views
2. `12-create-resolution-timestamps.ts` - Built timestamp table
3. `13-update-resolutions-view.ts` - Enriched view with coalesce

**Diagnostics (Revealed Problem):**
4. `10-find-event-tables.ts` - Discovered 51 event tables
5. `11-inspect-event-schemas.ts` - Inspected table schemas
6. `14-verify-traded-resolution-overlap.ts` - Claimed 100% (misleading)
7. `15-build-fixture-enriched.ts` - Built 10-row fixture (all epoch timestamps)
8. `16-find-open-positions.ts` - Found 0 truly open positions
9. `17-debug-epoch-timestamps.ts` - Discovered epoch issue
10. `18-check-fixture-condition-timestamps.ts` - No data for fixture conditions
11. `19-build-valid-fixture.ts` - Header overflow (81M rows processed)
12. `20-build-valid-fixture-optimized.ts` - Built 0 positions (no overlap)
13. `21-investigate-resolution-fill-overlap.ts` - **0 fills with valid resolutions**
14. `22-diagnose-condition-id-mismatch.ts` - **Confirmed 0 matches**

---

## Recommendations

### Option 1: Find Correct Resolution Source (RECOMMENDED)

**Action:** Investigate alternative resolution tables that match traded condition_ids

**Steps:**
1. Sample 100 condition_ids from traded fills
2. Search ALL database tables for these condition_ids
3. Identify which table(s) have matching resolution data
4. Rebuild `resolution_timestamps` from correct source

**Expected Tables to Check:**
- `gamma_resolved` (123,245 rows) - Check if these match fills
- `resolution_candidates` (424,095 rows) - Alternative resolution source
- Any `*_resolutions*` or `*_outcomes*` tables
- Check if `market_resolutions_final` itself has matches (without enrichment)

**Script to Run:**
```sql
-- Take sample of traded condition_ids
WITH traded_sample AS (
  SELECT DISTINCT cm.condition_id_norm
  FROM clob_fills cf
  INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
  LIMIT 100
)
-- Search all tables for these condition_ids
SELECT * FROM gamma_resolved WHERE cid IN (SELECT * FROM traded_sample);
SELECT * FROM resolution_candidates WHERE condition_id_norm IN (SELECT * FROM traded_sample);
SELECT * FROM market_resolutions_final WHERE condition_id_norm IN (SELECT * FROM traded_sample);
```

---

### Option 2: Use Original Resolution Data

**Action:** Check if `market_resolutions_final` (without enrichment) has matches

**Hypothesis:** Original table might have data for traded markets, enrichment pulled wrong data

**Steps:**
1. Query `market_resolutions_final` directly (not the enriched view)
2. Join with traded condition_ids
3. If matches found, don't use `resolution_timestamps` enrichment

---

### Option 3: Pivot to Unrealized P&L Validation

**Action:** Skip resolution P&L validation, focus on mark-to-market

**Pros:**
- Unblocked immediately
- Tests different code path
- Still validates position tracking

**Cons:**
- Defers main objective
- Doesn't validate resolution logic

---

### Option 4: Build Synthetic Test Data

**Action:** Manually create resolution records for traded condition_ids

**Pros:**
- Can create perfect test fixture
- Validates P&L calculation logic

**Cons:**
- Doesn't validate real data pipeline
- Manual work required
- Doesn't solve production issue

---

## Questions for User

1. **Is `resolutions_external_ingest` the correct source?**
   - All timestamps are `2025-11-10 03:32:19` (backfill date)
   - Condition_ids don't match traded fills

2. **Should we use `gamma_resolved` or other tables instead?**
   - Need to check which table has resolution data for traded markets

3. **Is this a known data quality issue?**
   - Has resolution data been fully backfilled for all traded markets?

4. **What's the priority?**
   - Fix data pipeline first, then validate P&L?
   - Or use synthetic data to validate P&L logic, fix pipeline separately?

---

## Next Steps (Pending User Direction)

### If Option 1 (Find Correct Source):
```bash
# Create diagnostic to search all tables
npx tsx 23-search-all-tables-for-traded-conditions.ts
```

### If Option 2 (Use Original Data):
```bash
# Test market_resolutions_final without enrichment
npx tsx 23-test-original-resolutions.ts
```

### If Option 3 (Pivot to Unrealized):
```bash
# Build unrealized P&L fixture
npx tsx 23-build-unrealized-pnl-fixture.ts
```

### If Option 4 (Synthetic Data):
```bash
# Create synthetic resolution records
npx tsx 23-populate-synthetic-resolutions.ts
```

---

## Key Learnings

### 1. "100% Coverage" Can Be Misleading
Earlier diagnostics showed 100% timestamp coverage and 100% join success, but didn't verify the data was for the **correct markets**. Always validate data semantics, not just join mechanics.

### 2. Epoch Timestamps Are a Red Flag
When seeing `1970-01-01 00:00:00`, immediately investigate - it usually means NULL data from a failed LEFT JOIN, not actual resolution dates.

### 3. Different Datasets Can Be Valid Individually
- Resolution enrichment worked perfectly (132K resolutions, all have timestamps)
- Token map and fills join correctly (116K traded assets)
- But they reference different market sets

### 4. Sample and Validate Early
Should have sampled actual condition_id values from both sources in script 14, not just counted rows.

---

## Files Generated

**Working Infrastructure:**
- `resolution_timestamps` table in database (wrong dataset)
- `market_resolutions_norm` view (enriched but wrong dataset)
- `fixture_enriched.json` (10 positions, all epoch timestamps)
- `fixture_valid.json` (0 positions)

**Documentation:**
- `SESSION_CONTINUATION_SUMMARY.md` - Progress before discovering issue
- `CRITICAL_DATA_DISCONNECT_FINDINGS.md` - This file

---

**STATUS:** Awaiting user decision on which option to pursue.

**Session Grade:** B → D
- Technical implementation: A (all code works correctly)
- Data validation: F (fundamental dataset mismatch)
- Overall: D (cannot proceed without resolving data issue)

---

_— Claude 2
Final Status: BLOCKED - Requires user input to resolve data disconnect_
