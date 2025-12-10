# Pure Trader Filter Test Report

**Date:** 2025-12-05
**Terminal:** Claude 1
**Script:** `scripts/pnl/test-trader-filter.ts`

---

## Executive Summary

**THEORY:** Achieve 100% V23 accuracy by excluding Market Makers (wallets with splits/merges > 0)

**VERDICT: NOT VALIDATED**

- Trader pass rate: 62.5% (target: 90%)
- Safe Pool size: 59% (target: 80%)
- 3 "pure traders" have >90% error despite 0 splits/merges

---

## STEP 1: Benchmark Validation (40 wallets)

### Classification Breakdown

| Type | Count | Definition |
|------|-------|------------|
| **TRADERS** | 24 | Splits=0, Merges=0 |
| **MARKET MAKERS** | 16 | Splits>0 OR Merges>0 |

### V23 Accuracy Results

| Category | Wallets | Threshold | Pass Rate | Mean Error | Median Error |
|----------|---------|-----------|-----------|------------|--------------|
| **TRADERS** | 24 | <1% | 15/24 (62.5%) | 14.07% | 0.18% |
| **MARKET MAKERS** | 16 | <5% | 11/16 (68.8%) | 6.87% | 3.74% |

### Full Results Table

| # | Wallet | UI PnL | V23 PnL | Error | Splits | Merges | Type | Action |
|---|--------|--------|---------|-------|--------|--------|------|--------|
| 1 | 0x56687bf447db | +$22,053,934 | +$22,029,973 | 0.11% | 0 | 2 | MM | EXCLUDE |
| 2 | 0x1f2dd6d473f3 | +$16,620,028 | +$16,578,003 | 0.25% | 0 | 21 | MM | EXCLUDE |
| 3 | 0x78b9ac44a6d7 | +$8,709,973 | +$8,705,078 | 0.06% | 0 | 0 | TRADER | INCLUDE |
| 4 | 0xd235973291b2 | +$7,807,266 | +$7,698,903 | 1.4% | 0 | 0 | TRADER | INCLUDE |
| 5 | 0x863134d00841 | +$7,532,410 | +$7,527,260 | 0.07% | 0 | 0 | TRADER | INCLUDE |
| 6 | 0x8119010a6e58 | +$6,083,643 | +$6,080,132 | 0.06% | 0 | 5 | MM | EXCLUDE |
| 7 | 0xe9ad918c7678 | +$5,942,685 | +$5,936,332 | 0.11% | 0 | 0 | TRADER | INCLUDE |
| 8 | 0x885783760858 | +$5,642,136 | +$5,634,964 | 0.13% | 0 | 0 | TRADER | INCLUDE |
| 9 | 0x23786fdad007 | +$5,147,999 | +$5,134,848 | 0.26% | 0 | 0 | TRADER | INCLUDE |
| 10 | 0xd0c042c08f75 | +$4,804,856 | +$4,800,671 | 0.09% | 0 | 0 | TRADER | INCLUDE |
| 11 | 0x94a428cfa4f8 | +$4,289,091 | +$4,337,209 | 1.1% | 0 | 0 | TRADER | INCLUDE |
| 12 | 0x16f91db25929 | +$4,049,827 | +$4,042,385 | 0.18% | 0 | 0 | TRADER | INCLUDE |
| 13 | 0x17db3fcd93ba | +$3,202,358 | +$3,278,320 | 2.4% | 0 | 1 | MM | EXCLUDE |
| 14 | 0x033a07b3de59 | +$3,115,550 | +$3,114,401 | 0.04% | 0 | 0 | TRADER | INCLUDE |
| 15 | 0xed2239a9150c | +$3,095,008 | +$3,092,635 | 0.08% | 0 | 1 | MM | EXCLUDE |
| 16 | 0x6a72f61820b2 | +$2,989,447 | +$3,101,199 | 3.7% | 0 | 184 | MM | EXCLUDE |
| 17 | 0xe74a4446efd6 | +$2,863,673 | +$124,967 | **95.6%** | 0 | 0 | TRADER | INCLUDE |
| 18 | 0x343d4466dc32 | +$2,604,548 | +$2,604,489 | 0.00% | 0 | 0 | TRADER | INCLUDE |
| 19 | 0x9d84ce0306f8 | +$2,443,014 | +$2,258,856 | 7.5% | 19 | 39,734 | MM | EXCLUDE |
| 20 | 0x82a1b239e7e0 | +$2,366,251 | +$17,487 | **100.7%** | 0 | 0 | TRADER | INCLUDE |
| 21 | 0x7fb7ad0d194d | +$2,266,615 | +$2,343,936 | 3.4% | 0 | 0 | TRADER | INCLUDE |
| 22 | 0xa9878e59934a | +$2,262,917 | +$2,148,067 | 5.1% | 0 | 43 | MM | EXCLUDE |
| 23 | 0x5bffcf561bca | +$2,240,496 | +$2,142,770 | 4.4% | 4 | 86 | MM | EXCLUDE |
| 24 | 0xb786b8b6335e | +$2,166,759 | +$2,194,577 | 1.3% | 0 | 1,652 | MM | EXCLUDE |
| 25 | 0xee00ba338c59 | +$2,128,489 | +$2,283,200 | 7.3% | 0 | 972 | MM | EXCLUDE |
| 26 | 0x2bf64b86b64c | +$2,093,363 | +$2,092,886 | 0.02% | 0 | 0 | TRADER | INCLUDE |
| 27 | 0x204f72f35326 | +$2,021,442 | +$1,999,605 | 1.1% | 0 | 0 | TRADER | INCLUDE |
| 28 | 0xd38b71f3e8ed | +$1,960,675 | +$1,530,065 | **22.0%** | 0 | 0 | TRADER | INCLUDE |
| 29 | 0x0562c423912e | +$1,903,941 | +$1,900,567 | 0.18% | 0 | 0 | TRADER | INCLUDE |
| 30 | 0x42592084120b | +$1,900,476 | +$191,421 | **110.1%** | 0 | 0 | TRADER | INCLUDE |
| 31 | 0xd7f85d0eb0fe | +$1,898,878 | +$1,898,464 | 0.02% | 1 | 1 | MM | EXCLUDE |
| 32 | 0x7058c8a7cec7 | +$1,849,975 | +$1,849,164 | 0.04% | 0 | 0 | TRADER | INCLUDE |
| 33 | 0xd31a2ea0b5f9 | +$1,766,594 | +$1,766,565 | 0.00% | 0 | 0 | TRADER | INCLUDE |
| 34 | 0x14964aefa2cd | +$1,742,493 | +$1,523,037 | 12.6% | 0 | 121 | MM | EXCLUDE |
| 35 | 0x3d1ecf169429 | +$1,712,369 | +$1,713,203 | 0.05% | 0 | 0 | TRADER | INCLUDE |
| 36 | 0x212954857f5e | +$1,685,688 | +$1,704,377 | 1.1% | 0 | 0 | TRADER | INCLUDE |
| 37 | 0x44c1dfe43260 | +$1,563,495 | +$1,506,634 | 3.6% | 50 | 345 | MM | EXCLUDE |
| 38 | 0x2005d16a84ce | +$1,550,541 | +$1,477,507 | 4.7% | 0 | 1,630 | MM | EXCLUDE |
| 39 | 0x461f3e886dca | +$1,496,847 | +$1,496,248 | 0.04% | 0 | 0 | TRADER | INCLUDE |
| 40 | 0x2f09642639ae | +$1,489,608 | +$642,332 | 56.9% | 0 | 99 | MM | EXCLUDE |

### CRITICAL: Worst "Pure Trader" Errors

These wallets have 0 splits AND 0 merges but still have massive V23 errors:

| Wallet | UI PnL | V23 PnL | Error |
|--------|--------|---------|-------|
| 0x42592084120b | +$1,900,476 | +$191,421 | **110.07%** |
| 0x82a1b239e7e0 | +$2,366,251 | +$17,487 | **100.74%** |
| 0xe74a4446efd6 | +$2,863,673 | +$124,967 | **95.64%** |
| 0xd38b71f3e8ed | +$1,960,675 | +$1,530,065 | 21.96% |
| 0x7fb7ad0d194d | +$2,266,615 | +$2,343,936 | 3.41% |

---

## STEP 2: Population Analysis (100 random wallets)

### Summary

| Category | Count | Percentage |
|----------|-------|------------|
| **Pure Traders** (Safe Pool) | 59 | 59.0% |
| **Market Makers** (Excluded) | 41 | 41.0% |

**Target: Safe Pool >80%** - **MISSED** (59% < 80%)

### Notable Market Makers

| Wallet | Splits | Merges |
|--------|--------|--------|
| 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e | 40,797,779 | 4,872,711 |
| 0x23cb796cf58bfa12352f0164f479deedbd50658e | 1 | 6,940 |
| 0xa3e22cd32aa9238ef7dbcfb4761e33b9eaa1fdf8 | 0 | 11,913 |

---

## Root Cause Analysis

### Why Some "Pure Traders" Have High Errors

The 3 wallets with >90% error despite 0 splits/merges suggest:

1. **V23 CLOB-only is missing PnL sources:**
   - These wallets may have significant PnL from PayoutRedemption events where CLOB activity was minimal
   - Or trades occurred through non-CLOB mechanisms not captured in the ledger

2. **Data gaps:**
   - Some CLOB trades may not be in `pm_unified_ledger_v7`
   - Resolution prices may be missing for some markets

3. **UI calculation differences:**
   - Polymarket UI may include unrealized PnL that V23 excludes
   - UI may use different resolution timing

---

## Conclusions

### Filter Theory: NOT VALIDATED

1. **Pass rate too low:** 62.5% of pure traders pass (target: 90%)
2. **Anomalies exist:** 3 wallets with 0 splits & 0 merges have >90% error
3. **Safe pool too small:** Only 59% of wallets qualify (target: 80%)

### Recommendations

1. **Investigate anomalous wallets** to find missing PnL sources
2. **Consider hybrid approach:** CLOB for trading + PayoutRedemption for resolution
3. **Do not deploy** the pure trader filter as a solution

---

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/pnl/test-trader-filter.ts` | Test script |
| `lib/pnl/shadowLedgerV23.ts` | V23 CLOB-only engine |
| `pm_unified_ledger_v7` | Source data table |
| `pm_ui_pnl_benchmarks_v1` | UI PnL benchmark data |

---

*Report generated by Claude 1*
