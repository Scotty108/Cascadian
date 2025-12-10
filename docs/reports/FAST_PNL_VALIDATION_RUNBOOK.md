# Fast PnL Validation Runbook

**Date:** 2025-12-06
**Purpose:** Tight test → fix → retest loop for PnL engine development
**Runtime:** < 2 minutes for 13-20 wallets

---

## Prerequisites

- ✅ Batch preload infrastructure (V23C + V29)
- ✅ UI truth loader with confidence levels
- ✅ Wallet benchmarks in `tmp/safe_trader_strict_wallets_2025_12_06.json`
- ⚠️  **API Limitation:** Polymarket Gamma API endpoints are not publicly available
  - Cannot fetch live snapshots via API
  - Must use existing benchmark files or manual Playwright scraping

---

## Quick Start (3 Commands)

### 1. Run V23C vs V29 Comparison
```bash
npx tsx scripts/pnl/compare-v23c-v29-fast.ts \
  --wallets-file=tmp/safe_trader_strict_wallets_2025_12_06.json \
  --limit=13 \
  --output=tmp/v23c_vs_v29_comparison.json
```

**Runtime:** ~9 seconds
**Output:** `tmp/v23c_vs_v29_comparison.json`

**What it does:**
- Loads 13 SAFE_TRADER_STRICT wallets
- Batch preloads events + prices for both engines
- Computes PnL using V23C (UI oracle) and V29 (inventory guard)
- Reports median/P90 errors and winner breakdown

### 2. Check Outliers (Optional)
```bash
npx tsx scripts/pnl/recheck-outliers-live.ts tmp/v23c_vs_v29_comparison.json
```

**Runtime:** 10-15 seconds for 10 wallets
**Output:** Console verdict breakdown

**Limitation:** This script attempts to use the Gamma API which returns 404 for all wallets. Consider this step **non-functional** until API access is restored.

### 3. V29-Only Validation (Recommended)
```bash
npx tsx scripts/pnl/validate-v29-on-trader-strict-sample-v2.ts \
  --use-fast-sample=true \
  --limit=20 \
  --concurrency=6 \
  --wallet-timeout-ms=20000
```

**Runtime:** ~30-60 seconds
**Output:** JSONL checkpoint file + summary

**What it does:**
- Validates V29 against simple cash flow baseline
- Uses batch preload for speed
- JSONL checkpointing for resume capability

---

## Configuration

### Truth Source Selection

**Default:** JSON file fallback (V2 table does not exist)

```bash
# Use V2 table (falls back to JSON if table missing)
--truth=v2

# Use V1 table (not recommended - has accuracy issues)
--truth=v1 --allow-v1-fallback

# Use live snapshot (requires manual Playwright scraping)
--truth=live --live-snapshot=tmp/snapshot.json
```

### Wallet Sample Selection

**Available Samples:**
- `tmp/safe_trader_strict_wallets_2025_12_06.json` - 13 wallets with UI benchmarks
- `tmp/trader_strict_sample_v2_fast.json` - 100+ wallets (no benchmarks)

**Recommendation:** Use `safe_trader_strict_wallets_2025_12_06.json` for fast iterations.

---

## Expected Output

### Comparison Summary (13 wallets)
```
Total Wallets: 13
Winner Breakdown:
  🟢 V23C Wins: 3 (23.1%)
  🔵 V29 Wins:  4 (30.8%)
  ⚪ Ties:      6 (46.2%)

Absolute Error USD (V29):
  Median: +$7.4K
  P90:    +$853.4K

Performance:
  Total Time: 9018ms
    Preload: 8894ms
    Calculation: 124ms
```

### Files Created
- `tmp/v23c_vs_v29_comparison.json` - Full wallet-by-wallet results
- Console output with summary statistics

---

## Workflow

### Fast Iteration Loop
```bash
# 1. Make engine changes
vim lib/pnl/inventoryEngineV29.ts

# 2. Run comparison
npx tsx scripts/pnl/compare-v23c-v29-fast.ts --limit=13

# 3. Analyze results
cat tmp/v23c_vs_v29_comparison.json | jq '.[] | select(.abs_error_usd_v29 > 1000)'

# 4. Repeat
```

### Deep Forensic Debugging
```bash
# Identify worst wallet
cat tmp/v23c_vs_v29_comparison.json | \
  jq -r 'sort_by(.abs_error_usd_v29) | reverse | .[0] | .wallet'

# Investigate specific wallet
npx tsx scripts/pnl/debug-wallet-v29.ts --wallet=0x...
```

---

## Limitations & Workarounds

### 1. No Live API Access
**Problem:** Polymarket Gamma API returns 404
**Impact:** Cannot fetch fresh UI PnL snapshots
**Workaround:**
- Use existing JSON benchmarks from December 6th
- Manual Playwright scraping if fresh data needed
- V2 benchmark table creation (requires manual scraping)

### 2. V2 Benchmark Table Missing
**Problem:** `pm_ui_pnl_benchmarks_v2` does not exist
**Impact:** Falls back to JSON files (medium confidence)
**Workaround:**
- Create V2 table with manual scraping:
  ```sql
  CREATE TABLE pm_ui_pnl_benchmarks_v2 (
    wallet String,
    pnl_value Float64,
    benchmark_set String,
    captured_at DateTime,
    confidence String
  ) ENGINE = MergeTree()
  ORDER BY (benchmark_set, wallet);
  ```

### 3. Small Sample Size
**Problem:** Only 13 wallets with verified benchmarks
**Impact:** Limited statistical significance
**Workaround:**
- Expand sample with manual Playwright runs
- Focus on forensic debugging of outliers

---

## Troubleshooting

### "Live truth mode requires liveSnapshotPath"
**Cause:** `--truth=live` without `--live-snapshot`
**Fix:** Either provide snapshot path or use `--truth=v2`

### "No UI benchmarks available"
**Cause:** Wallet file doesn't contain `uiPnL` field
**Fix:** Use `safe_trader_strict_wallets_2025_12_06.json` which has benchmarks

### "Unknown table pm_ui_pnl_benchmarks_v2"
**Cause:** V2 table not created
**Effect:** Falls back to JSON files (expected behavior)
**Fix:** Not required - JSON fallback works fine

---

## Performance Targets

| Metric | Target | Actual (13 wallets) |
|--------|--------|---------------------|
| Total runtime | < 15s | 9s ✅ |
| Preload time | < 10s | 8.9s ✅ |
| Calculation time | < 1s | 0.12s ✅ |
| Per-wallet avg | < 1s | 0.69s ✅ |

---

## Next Steps After Validation

### If V29 Median Error > $10K
1. Identify top 5 worst wallets
2. Run forensic debugging on each
3. Check for common patterns (splits/merges/transfers)
4. Update engine logic
5. Re-run comparison

### If V29 Median Error < $10K
1. Expand to 50-wallet sample
2. Check for outliers > P90
3. Document known edge cases
4. Consider engine ready for production

---

## Reference

**Key Scripts:**
- `scripts/pnl/compare-v23c-v29-fast.ts` - Head-to-head comparison
- `scripts/pnl/validate-v29-on-trader-strict-sample-v2.ts` - V29 validation
- `scripts/pnl/recheck-outliers-live.ts` - Outlier verification (non-functional)
- `lib/pnl/uiTruthLoader.ts` - Truth source loader
- `lib/pnl/v29BatchLoaders.ts` - Batch preload (V29)
- `lib/pnl/v23cBatchLoaders.ts` - Batch preload (V23C)

**Documentation:**
- `docs/reports/PNL_TESTING_INFRASTRUCTURE_HARDENING_2025_12_06.md`
- `docs/reports/LIVE_TRUTH_INTEGRATION_2025_12_06.md`

---

**Last Updated:** 2025-12-06
**Terminal:** Claude 2
