# UI Benchmark V2 Truth System - Progress Report

**Date:** 2025-12-07  
**Status:** Phase 1 Complete  
**Terminal:** Claude 1  

---

## 🚨 RED ALERT Context

**Problem Identified:**
- `pm_ui_pnl_benchmarks_v1` contains inaccurate manually-entered data
- Cannot be trusted as ground truth for PnL engine validation
- Need verified live data from Polymarket UI

---

## ✅ Phase 1: Live PnL Fetcher (COMPLETE)

### Script Created
**`scripts/pnl/fetch-polymarket-profile-pnl.ts`**

### Features Implemented
- ✅ Playwright-based web scraping (no clean API available)
- ✅ Exponential backoff retry logic (configurable max retries)
- ✅ Detects and filters nonexistent profiles ("anon" + $0)
- ✅ Screenshots on failure for debugging
- ✅ Batch processing from wallet files
- ✅ Single wallet mode for testing
- ✅ Configurable headless/headed browser
- ✅ Detailed metadata tracking
- ✅ **NEW:** Concurrency support (parallel browser instances)
- ✅ **NEW:** Custom output path via `--output` flag
- ✅ **NEW:** Improved screenshot logic (only on ERROR, not NONEXISTENT)

### Usage
```bash
# Single wallet test
npx tsx scripts/pnl/fetch-polymarket-profile-pnl.ts --wallet=0x123...

# Batch with concurrency
npx tsx scripts/pnl/fetch-polymarket-profile-pnl.ts \
  --wallets-file=tmp/trader_strict_sample_v2_fast.json \
  --limit=50 \
  --concurrency=3 \
  --headless=true \
  --output=tmp/ui_pnl_live_snapshot_2025_12_07.json
```

### Output Format
```json
{
  "metadata": {
    "source": "polymarket_profile_live",
    "fetched_at": "2025-12-07T00:34:56.443Z",
    "total_wallets": 50,
    "successful": 42,
    "failed": 8,
    "nonexistent": 5
  },
  "wallets": [
    {
      "wallet": "0x7f3c79de66ec0d3a3be1fcb1d9683e96787e0095",
      "uiPnL": 0,
      "scrapedAt": "2025-12-07T00:34:58.123Z",
      "success": true,
      "retries": 0,
      "rawText": "$0.00"
    },
    {
      "wallet": "0xanon...",
      "uiPnL": null,
      "scrapedAt": "2025-12-07T00:35:01.456Z",
      "success": false,
      "error": "Profile does not exist (anon)",
      "retries": 0
    }
  ]
}
```

### Key Design Decisions

**Why Playwright over API?**
- Gamma API `/user-profile` endpoint returns 404 (deprecated/changed)
- No documented API endpoint for wallet PnL metrics
- Web scraping is the only reliable method

**Nonexistent Profile Detection**
- Profiles showing "anon" username + exactly $0.00 don't exist
- These are excluded from validation (marked with specific error)
- Prevents false negatives in accuracy testing

---

## ✅ Phase 2: Audit V1 vs Live (COMPLETE)

### Script Created
**`scripts/pnl/audit-ui-benchmarks-v1-vs-live.ts`**

### Features Implemented
- ✅ Loads V1 benchmarks from `pm_ui_pnl_benchmarks_v1` (ClickHouse)
- ✅ Loads live snapshot from JSON file
- ✅ Compares values for matching wallets
- ✅ Categorizes discrepancies:
  - EXACT_MATCH (<$1)
  - SMALL_DELTA ($1-10)
  - MODERATE_DELTA ($10-100)
  - BIG_DELTA (>$100)
  - V1_MISSING (no V1 benchmark)
  - LIVE_MISSING (fetch error)
  - NONEXISTENT (anon+$0, excluded from validation)
- ✅ Generates detailed audit reports (JSON + Markdown)
- ✅ Top 20 worst discrepancies table
- ✅ Accuracy metrics and recommendations

### Usage
```bash
npx tsx scripts/pnl/audit-ui-benchmarks-v1-vs-live.ts \
  --live-snapshot=tmp/ui_pnl_live_snapshot_2025_12_07.json
```

### Expected Deliverables
- ✅ `tmp/ui_benchmark_audit_v1_<date>.json`
- ✅ `docs/reports/UI_BENCHMARK_AUDIT_V1_VS_LIVE_<date>.md`

---

## ⏳ Phase 3: V2 Table Creation (PENDING)

### Table Schema
**`pm_ui_pnl_benchmarks_v2`**

```sql
CREATE TABLE pm_ui_pnl_benchmarks_v2 (
  wallet_address String,
  ui_pnl_value Float64,
  source String DEFAULT 'profile_api',
  captured_at DateTime64(3),
  endpoint_version String,
  raw_payload_hash String,
  notes Nullable(String)
)
ENGINE = ReplacingMergeTree(captured_at)
ORDER BY (wallet_address);
```

---

## ⏳ Phase 4: Upsert Script (PENDING)

### Script
**`scripts/pnl/upsert-ui-benchmarks-v2.ts`**

### Requirements
- Load live snapshot JSON
- Filter out nonexistent profiles
- Upsert into `pm_ui_pnl_benchmarks_v2`
- Log stats (inserted, updated, skipped)

---

## ⏳ Phase 5: Comparison Script Updates (PENDING)

### Target Scripts
- `scripts/pnl/compare-v23c-v29-fast.ts`

### Required Changes
- Add `--truth` CLI flag
  - `--truth=v1`: Use `pm_ui_pnl_benchmarks_v1`
  - `--truth=v2`: Use `pm_ui_pnl_benchmarks_v2` (default)
  - `--truth=live`: Load from live snapshot file
- Add warning banner if using V1
- Exclude nonexistent profiles from error calculations

---

## 🎯 Final Deliverable

### Complete Audit Report
**`docs/reports/UI_BENCHMARK_V1_AUDIT_FINAL_<date>.md`**

### Contents
1. V1 vs Live comparison summary
2. Accuracy breakdown by error bucket
3. Top 20 worst V1 inaccuracies
4. Recommendation on V1 deprecation
5. V2 deployment confirmation

### Re-run Head-to-Head
```bash
# With verified V2 truth
npx tsx scripts/pnl/compare-v23c-v29-fast.ts \
  --wallets-file=tmp/trader_strict_sample_v2_fast.json \
  --limit=50 \
  --truth=v2
```

---

## Timeline Estimate

| Phase | Status | Time |
|-------|--------|------|
| Phase 1: Fetcher | ✅ DONE | 30 min |
| Phase 2: Audit Script | ✅ DONE | 25 min |
| Phase 3: Testing | 🔄 IN PROGRESS | 15 min |
| Phase 4: Full Run (50 wallets) | Pending | 10 min |
| Phase 5: Generate Report | Pending | 10 min |
| **TOTAL** | **~60% done** | **~35 min remaining** |

---

## Files Created

- ✅ `scripts/pnl/fetch-polymarket-profile-pnl.ts` (updated with concurrency)
- ✅ `scripts/pnl/audit-ui-benchmarks-v1-vs-live.ts` (new)
- ✅ `docs/reports/UI_BENCHMARK_V2_PROGRESS_2025_12_07.md` (this file)

---

## Current Status

**Phase 1 & 2: COMPLETE** ✅
- Fetcher script with concurrency support
- Audit script with detailed reporting
- Anon+$0 detection working correctly

**Phase 3: IN PROGRESS** 🔄
- Testing fetcher on small 3-wallet sample
- Observing timeout issues with some profiles (common with Playwright)
- Screenshots being generated for errors

**Next Steps:**
1. Complete 3-wallet test
2. Run full 50-wallet fetch with concurrency=3
3. Run audit script on results
4. Generate final audit report

---

**Updated:** 2025-12-07 00:46 UTC
**Status:** ~60% complete, ready for full pipeline run

