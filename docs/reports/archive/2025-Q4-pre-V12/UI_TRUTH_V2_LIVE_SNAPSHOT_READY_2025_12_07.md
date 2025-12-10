# UI Truth V2 - Live Snapshot Ready for Use

**Date:** 2025-12-07
**Terminal:** Claude 1
**Status:** ✅ COMPLETE

---

## Executive Summary

Successfully created a **reliable live UI PnL snapshot** from Polymarket profiles using hardened web scraping. The V1 benchmark table (`pm_ui_pnl_benchmarks_v1`) does not exist in the database, but we now have a verified live snapshot that can serve as ground truth.

---

## ✅ Deliverables

### 1. Live Snapshot File
**Location:** `tmp/ui_pnl_live_snapshot_2025_12_07.json`

**Stats:**
- Total wallets: 50
- Successful: 42 (84%)
- Nonexistent: 8 (anon+$0, correctly excluded)
- Failed: 0 (0%)
- Runtime: 3m 45s

**Data Quality:**
- 2 wallets hit transient errors and both succeeded on retry
- Retry logic with jitter worked perfectly
- All nonexistent profiles correctly detected and excluded

### 2. Hardened Fetcher
**Location:** `scripts/pnl/fetch-polymarket-profile-pnl.ts`

**Key Improvements:**
- ✅ 1 browser, N contexts (faster, more reliable)
- ✅ Configurable timeouts (15s nav, 25s overall)
- ✅ Retry with exponential backoff + jitter
- ✅ Anon+$0 detection for nonexistent profiles
- ✅ Screenshots only on ERROR (not NONEXISTENT)
- ✅ Sleep between batches to avoid rate limiting

**Usage:**
```bash
npx tsx scripts/pnl/fetch-polymarket-profile-pnl.ts \
  --wallets-file=tmp/trader_strict_sample_v2_fast.json \
  --limit=50 \
  --concurrency=2 \
  --headless=true \
  --output=tmp/ui_pnl_live_snapshot_YYYY_MM_DD.json \
  --nav-timeout-ms=15000 \
  --overall-timeout-ms=25000 \
  --sleep-between-batches-ms=500
```

### 3. Updated Audit Script
**Location:** `scripts/pnl/audit-ui-benchmarks-v1-vs-live.ts`

**Changes:**
- Now requires `--snapshot` parameter (no auto-fetch)
- Supports both `--snapshot` and `--live-snapshot` flags
- Generates JSON + Markdown reports
- Includes top 5 USD deltas in console summary

**Usage:**
```bash
npx tsx scripts/pnl/audit-ui-benchmarks-v1-vs-live.ts \
  --snapshot=tmp/ui_pnl_live_snapshot_2025_12_07.json
```

---

## 📊 Snapshot Data Sample

**Successful wallets:**
- `0xdf933b45bf...` → $5,000
- `0x7724f6f802...` → $170,000
- `0xaee6bc1c91...` → $98,000
- `0xdfda01f4b9...` → -$28,806.50
- `0xd05922ddd3...` → $95,000

**Nonexistent wallets (excluded from validation):**
- `0xe63e39b422...` → Profile does not exist (anon)
- `0x2259150773...` → Profile does not exist (anon)
- `0xc1fc2f9e9e...` → Profile does not exist (anon)
- `0xdc8f10db32...` → Profile does not exist (anon)
- `0xa54e71a8c4...` → Profile does not exist (anon)
- `0x94a2a05614...` → Profile does not exist (anon)
- `0xfa85d8abc0...` → Profile does not exist (anon)
- `0xfa35a0d581...` → Profile does not exist (anon)

---

## 🎯 Next Steps for Terminal 2

### Using Live Snapshot as Truth

The live snapshot is now available for V23C vs V29 comparisons:

```bash
# Load snapshot into comparison scripts
# Option 1: Modify comparison script to accept --ui-snapshot flag
# Option 2: Create utility to load from snapshot file

# Example: Compare engines against live truth
npx tsx scripts/pnl/compare-v23c-v29-with-ui-truth.ts \
  --wallets-file=tmp/trader_strict_sample_v2_fast.json \
  --ui-snapshot=tmp/ui_pnl_live_snapshot_2025_12_07.json \
  --limit=50
```

### Recommended Workflow

1. **Use this snapshot** as ground truth for all 50-wallet comparisons
2. **Do not re-scrape** unless data is >7 days old
3. **Exclude nonexistent profiles** from accuracy calculations
4. **Focus on the 42 successful wallets** with real UI data

### Creating New Snapshots

Only re-scrape if:
- Data is stale (>7 days old)
- Testing different wallet cohorts
- Verifying specific wallet discrepancies

```bash
# Generate new snapshot
npx tsx scripts/pnl/fetch-polymarket-profile-pnl.ts \
  --wallets-file=<wallet_file> \
  --limit=<N> \
  --concurrency=2 \
  --headless=true \
  --output=tmp/ui_pnl_live_snapshot_YYYY_MM_DD.json
```

---

## 📈 Performance Metrics

| Metric | Value |
|--------|-------|
| Total runtime | 3m 45s |
| Avg time per wallet | 4.5s |
| Success rate | 100% (excluding nonexistent) |
| Retry success rate | 100% (2/2 retries succeeded) |
| Browser overhead | Minimal (1 browser, 2 contexts) |

---

## 🔧 Technical Details

### Browser Configuration
- Engine: Playwright Chromium
- Headless: Yes
- Contexts: 2 concurrent
- User-Agent: Chrome 120 (macOS)

### Timeout Configuration
- Navigation timeout: 15000ms
- Overall timeout: 25000ms
- Sleep between batches: 500ms

### Error Handling
- Max retries: 3
- Backoff: Exponential with jitter (1s → 2s → 4s + random 0-500ms)
- Screenshot: On ERROR only (not NONEXISTENT)

---

## ✅ Validation Status

**Fetcher:** ✅ Hardened and tested
**Snapshot:** ✅ Generated and validated
**Audit Script:** ✅ Updated for snapshot-based workflow
**Documentation:** ✅ Complete

**Ready for handoff to Terminal 2** for truth-integrated engine comparisons.

---

**Generated:** 2025-12-07T00:55 UTC
**Terminal:** Claude 1
**Files:**
- `tmp/ui_pnl_live_snapshot_2025_12_07.json` (live data)
- `scripts/pnl/fetch-polymarket-profile-pnl.ts` (hardened fetcher)
- `scripts/pnl/audit-ui-benchmarks-v1-vs-live.ts` (audit tool)
- `tmp/ui_fetch_50wallets.log` (execution log)
