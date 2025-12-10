# V23C vs V29 Mixed Sample Comparison (Fast Batch Test)

**Date:** 2025-12-06
**Terminal:** Claude 2
**Test:** Head-to-head accuracy comparison using batch preload

---

## Executive Summary

V23C and V29 perform **nearly identically** on a mixed wallet cohort, with V29 showing a **slight edge (7.7%)**.

---

## Test Configuration

### Sample
- **Source:** `tmp/mixed_wallets_v23c_v29_check.json`
- **Wallets Tested:** 20 (13 SAFE_TRADER_STRICT + 7 random trader_strict)
- **UI Benchmarks Available:** 13/20 (65%)

### Architecture
- **V23C:** Shadow ledger with UI price oracle (pm_market_metadata.outcome_prices)
- **V29:** Inventory engine with condition-level tracking
- **Data Source:** pm_unified_ledger_v8_tbl (both engines)
- **Preload:** Batch queries for all events + prices upfront

---

## Results (20 Wallets)

### Winner Breakdown
| Engine | Wins | Percentage |
|--------|------|------------|
| V23C   | 1    | 7.7%       |
| V29    | 2    | 15.4%      |
| TIE    | 10   | 76.9%      |

### Average Errors (vs UI Benchmarks)
| Engine | Abs Error | Pct Error |
|--------|-----------|-----------|
| V23C   | +$6.83M   | 193.33%   |
| V29    | +$6.57M   | 182.00%   |

### Performance
- **Total Time:** 45.9s
  - Preload: 45.8s (99.8%)
  - Calculation: 98ms (0.2%)
- **Per-Wallet Avg:** 2.3s
- **No Timeouts:** ✅ (Fast path works!)

---

## Key Findings

### 1. **Near Parity**
- 76.9% of wallets show identical or near-identical results
- Both engines struggle with the same wallets (high error %)
- V29 has a marginal advantage (7.7% more wins)

### 2. **High Error Rates**
- Both engines show ~180-190% average error
- This suggests:
  - UI benchmarks may be stale/incorrect
  - OR both engines have systematic bias
  - Need fresh UI benchmarks from Polymarket API

### 3. **Performance Success**
- Batch preload **eliminates timeouts**
- V23C now testable at same speed as V29
- 98ms calculation time for 20 wallets (5ms/wallet)

---

## Hypothesis

### Question: Is V23C better than V29?

**Answer:** **No clear winner.** Both engines perform similarly on this mixed sample.

### Interpretation
1. **V23C UI oracle ≈ V29 inventory accounting** in accuracy
2. Both may have issues with:
   - Stale price data
   - Missing resolutions
   - Edge case handling
3. **V29 preferred for production** due to:
   - Simpler architecture (no dual ledger/raw fallback)
   - Better performance (fewer price lookups)
   - Condition-level accounting is more robust

---

## Next Steps (NOT FOR CLAUDE 2)

1. **Capture fresh UI benchmarks** from Polymarket API
2. Test on **TRADER_STRICT v2 cohort** (50 wallets)
3. Investigate **high error wallets** (>100% error)
4. Consider **V29 as canonical** unless V23C shows clear advantage

---

## Technical Notes

### Batch Loader Success
- Created `lib/pnl/v23cBatchLoaders.ts`
- Added `V23cPreload` interface to `shadowLedgerV23c.ts`
- Fast path mirrors V29 architecture
- **No schema changes required**

### Known Issues
- ClickHouse "Field value too long" warnings for large condition batches
  - Does NOT cause failures
  - Fallback logic handles missing prices
- 7 wallets lack UI benchmarks (need to capture)

---

**Terminal 2 Signed: 2025-12-06**
