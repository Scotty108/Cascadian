# Terminal 2: Tier A UI Confidence at Scale

**Date:** 2025-12-09
**Terminal:** 2 (Scaling & Hardening)
**Status:** Phase 1 Complete - Validation Infrastructure Ready

---

## Executive Summary

Terminal 2 work established UI tooltip truth scraping infrastructure and ran initial V12 validation against scraped values. **Key finding: V12 Synthetic Realized PnL shows 40% pass rate against UI tooltip truth at 10% tolerance on pilot sample.**

---

## Completed Tasks

### 1. Tier A Sampling Plan
- Generated 200 top-volume + 200 random Tier A wallet samples
- Files created:
  - `tmp/tierA_ui_tooltip_sample_top_volume_200.json`
  - `tmp/tierA_ui_tooltip_sample_random_200.json`
  - `tmp/tierA_ui_tooltip_sample_combined_400.json`

### 2. Playwright Tooltip Scraping (Pilot)
- Scraped 5 high-volume wallets via Playwright MCP
- Output: `tmp/ui_tooltip_truth_tierA_pilot10.json`
- Metrics captured per wallet:
  - Volume traded
  - Gain
  - Loss
  - Net total

### 3. V12 Tooltip Validator
- Created `scripts/pnl/validate-v12-against-tooltip-truth.ts`
- Uses production V12 engine from `lib/pnl/realizedPnlV12.ts`
- Compares V12 realized PnL vs UI "Net total"

---

## Pilot Validation Results

| Wallet | UI Net Total | V12 Realized | Delta | Unres% | Pass (10%) |
|--------|-------------|--------------|-------|--------|------------|
| 0xb744f56... | -$1,381,142 | -$185,277 | 86.6% | 7.3% | FAIL |
| 0x204f72f... | +$2,449,508 | +$2,513,833 | 2.6% | 3.9% | PASS |
| 0x42592084... | +$560,126 | +$636,556 | 13.6% | 1.6% | FAIL |
| 0x16b29c50... | -$1,374,264 | -$1,290,152 | 6.1% | 5.7% | PASS |
| 0x63274ff0... | -$38,569 | -$19,292 | 50.0% | 70.6% | FAIL |

**Summary:**
- Pass Rate: 40% (2/5) at 10% tolerance
- Comparable Failures: 2 (wallets with <50% unresolved)
- Non-comparable: 1 (wallet 5 has 70.6% unresolved)

---

## Background Process Results

### 2000-Wallet Benchmark (Completed)
- 100% successful computations
- 84% comparable (<50% unresolved)
- 48.9% profitable, 51.1% unprofitable
- Total PnL: $4.4M
- File: `tmp/v12_tierA_benchmark_2000_2025_12_09.json`

### Low-B Tier A Gating (Completed)
- 120,347 eligible wallets
- $4.6B total CLOB volume
- 371 avg events per wallet
- File: `tmp/lowB_tierA_wallets_2025_12_09.json`

### Metrics Layer Views (Partially Complete)
- 6 views created but verification timed out
- Views: omega_ratio, pnl_by_category, win_loss_stats, etc.

### Regression Check (Failed)
- Gold set vs V12: Only 7% pass rate
- Indicates formula drift or baseline mismatch

---

## Discrepancy Analysis

### Wallet 1 (0xb744f5...) - Massive 86.6% Gap
- UI: -$1,381,142
- V12: -$185,277
- Unresolved: 7.3%
- **Root cause:** Unknown - requires deep investigation
- Hypothesis: UI may include unrealized PnL or use different data source

### Wallet 3 (0x425920...) - 13.6% Gap
- UI: +$560,126
- V12: +$636,556
- V12 is HIGHER than UI - unusual
- Could be fee treatment or rounding differences

### Wallet 5 (0x63274f...) - Expected Gap
- 70.6% unresolved - expected to differ
- Many open positions reduce realized PnL accuracy

---

## Recommended Next Steps

### Immediate (Critical)
1. **Deep-dive wallet 1 (0xb744f5)** - Understand 86.6% gap despite low unresolved
2. **Check if UI includes unrealized** - Compare gain/loss components
3. **Expand pilot to 20 wallets** - Get statistically significant sample

### Short-term
4. **Scale tooltip scraping** - Automate for full 400-wallet sample
5. **Create tier-specific pass rates** - Top 50 vs random may differ
6. **Document acceptable deviation thresholds**

### For Copy-Trading Gate
7. **Define "Tier A Verified"** criteria based on validation results
8. **Lock regression gates** once pass rate reaches target (80%+)
9. **Build monitoring dashboard** for ongoing accuracy tracking

---

## Files Created This Session

```
scripts/pnl/
├── generate-tierA-tooltip-samples.ts   # Generate wallet samples
├── scrape-tierA-tooltip-truth.ts       # Scraping framework
├── batch-scrape-tierA-tooltips.ts      # Batch manager with progress
└── validate-v12-against-tooltip-truth.ts # V12 validation harness

tmp/
├── tierA_ui_tooltip_sample_top_volume_200.json
├── tierA_ui_tooltip_sample_random_200.json
├── tierA_ui_tooltip_sample_combined_400.json
├── ui_tooltip_truth_tierA_pilot10.json   # 5 scraped wallets
├── ui_tooltip_scrape_progress_top200.json
├── v12_tooltip_validation_results.json
├── v12_tierA_benchmark_2000_2025_12_09.json
└── lowB_tierA_wallets_2025_12_09.json
```

---

## Conclusion

Terminal 2 successfully established:
1. Automated UI tooltip scraping infrastructure
2. V12 validation harness against scraped truth
3. 2000-wallet benchmark baseline
4. 120K+ wallet gated universe

**Key Blocker:** V12 shows significant discrepancies vs UI tooltip truth (40% pass rate). Before promoting Tier A Verified sub-tier, must investigate and resolve the root cause of the gaps, particularly for wallet 0xb744f5 which shows 86.6% deviation despite only 7.3% unresolved positions.
