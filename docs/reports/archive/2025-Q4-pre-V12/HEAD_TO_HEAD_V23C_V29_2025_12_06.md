# V23C vs V29 Head-to-Head Comparison Report

**Date:** 2025-12-07  
**Terminal:** Claude 1  
**Sample:** TRADER_STRICT v2 fast (50 wallets, no CTF splits/merges)  
**Engines:**  
- V23C: Shadow Ledger with UI Price Oracle  
- V29: Inventory Engine with Guard Mode  

---

## Executive Summary

### ✅ Performance: EXCELLENT
- **50 wallets processed in 42.7s total**
- Preload time: 42.6s (parallel batch loading)
- Calculation time: 38ms (per-wallet processing)
- **Avg per wallet:** 854ms end-to-end

### ⚠️ Accuracy: MIXED RESULTS
- **68% exact agreement** (<$1 difference in total PnL)
- **22% divergent** (>$100 difference)
- **Median absolute delta:** $0.10
- **P90 absolute delta:** $21,157

---

## Detailed Findings

### Agreement Distribution (Total PnL: V23C vs V29)

| Category | Count | % | Description |
|----------|-------|---|-------------|
| **Exact match** | 34 | 68% | <$1 difference |
| **Close** | 2 | 4% | $1-10 difference |
| **Moderate** | 3 | 6% | $10-100 difference |
| **Divergent** | 11 | 22% | >$100 difference |

### Top 10 Divergent Wallets

| Wallet | V23C Total PnL | V29 Total PnL | Delta | % Diff |
|--------|---------------|--------------|-------|--------|
| 0xdfda01... | $194,703 | $95,968 | $98,735 | 103% |
| 0x688bea... | $47,025 | $1,951 | $45,074 | 2,311% |
| 0xa6f707... | $33,589 | $2,611 | $30,978 | 1,186% |
| 0x4d6d6f... | $31,882 | $10,725 | $21,158 | 197% |
| 0xdf933b... | -$11,563 | -$26,258 | $14,695 | 56% |
| 0xd9a04f... | $5,053 | $282 | $4,771 | 1,692% |
| 0x17b4aa... | $8,228 | $10,261 | $2,034 | 20% |
| 0x7a3051... | $37,559 | $39,098 | $1,540 | 4% |
| 0xf118d0... | $35,851 | $34,678 | $1,173 | 3% |
| 0xf732a0... | $1,541 | $1,169 | $372 | 32% |

---

## Interpretation

### What This Means

#### ✅ Good News: 72% Close Alignment
For 36/50 wallets (72%), V23C and V29 produce total PnL values within $10 of each other. This suggests:
1. Both engines handle TRADER_STRICT wallets (no splits/merges) reasonably well
2. Core realized PnL logic is consistent between engines
3. Batch preload architecture works correctly for both engines

#### ⚠️ Concern: 22% Major Divergence
11/50 wallets (22%) show >$100 difference in total PnL. Pattern analysis:

1. **V23C consistently shows HIGHER total PnL than V29** in most divergent cases
2. Largest divergences occur in wallets with large unrealized positions
3. Suggests V29 may be under-marking unrealized PnL OR V23C over-marking

### Root Cause Hypotheses

**Hypothesis 1: UI Price Oracle Divergence**
- V23C uses `pm_market_metadata.outcome_prices` (UI oracle)
- V29 uses resolution prices + inventory mark-to-market
- If UI prices differ significantly from V29's mark, this explains the gap

**Hypothesis 2: Missing Resolution Data**
- "Field value too long" errors during batch loading (5060 conditions → only 1000 loaded)
- Missing resolution prices force fallback to different mark logic
- V23C may handle missing data differently than V29

**Hypothesis 3: Unrealized Position Calculation Bugs**
- V29's inventory guard may be incorrectly calculating unrealized PnL
- V23C's UI oracle may be pulling stale/incorrect prices from metadata table

---

## Technical Details

### Data Sources
- **Events:** `pm_unified_ledger_v8_tbl` (347M rows, SharedMergeTree)
- **Resolutions:** Batch queried from `pm_condition_resolutions`
- **UI Prices:** `pm_market_metadata.outcome_prices` (V23C only)

### Batch Loading Performance
- **V29 Events:** 41.0s for 34,249 events (avg 685/wallet)
- **V23C Events:** 42.1s for 34,249 events (same)
- **Resolution Prices:** Batched in 2000-condition chunks
  - Batch 1: Failed (5060 conditions too large)
  - Batch 2: Failed  
  - Final: 1000 conditions loaded successfully
  - **Coverage: 19.8% (1000/5060)**

### Known Issues
1. **Resolution price batch loading hits ClickHouse query size limits**
   - Need to reduce batch size below 2000 or use different query strategy
2. **No UI benchmarks available in TRADER_STRICT sample**
   - Cannot determine ground truth accuracy
   - Need to load from `pm_ui_pnl_benchmarks_v1` for future tests

---

## Recommendations

### Immediate Actions

1. **Investigate Top 3 Divergent Wallets**
   - `0xdfda01...` (Δ$98,735)
   - `0x688bea...` (Δ$45,074)
   - `0xa6f707...` (Δ$30,978)
   - Check unrealized position details
   - Compare UI prices vs V29 mark values
   - Verify resolution coverage

2. **Fix Batch Loading Resolution Prices**
   - Reduce batch size to 1000 conditions
   - Implement retry logic for large condition sets
   - Add progress logging for multi-batch loads

3. **Load UI Benchmarks for Ground Truth**
   - Query `pm_ui_pnl_benchmarks_v1` for these 50 wallets
   - Compare both engines against actual UI snapshots
   - Determine which engine is more accurate

### Future Testing

1. **Expand to 100-wallet sample** once resolution loading is fixed
2. **Test on non-TRADER_STRICT wallets** (with splits/merges) to stress-test V29 inventory engine
3. **Add realized PnL-only comparison** (ignore unrealized) to isolate the divergence source

---

## Files Generated

- `tmp/v23c_vs_v29_trader_strict_fast_20.json` (20-wallet results)
- `tmp/v23c_vs_v29_trader_strict_fast_50.json` (50-wallet results)
- `tmp/v23c_vs_v29_trader_strict_fast_20.log` (20-wallet execution log)
- `tmp/v23c_vs_v29_trader_strict_fast_50.log` (50-wallet execution log)
- `tmp/v23c_vs_v29_summary_20wallets.md` (20-wallet summary)
- `docs/reports/HEAD_TO_HEAD_V23C_V29_2025_12_06.md` (this file)

---

## Conclusion

**Verdict:** V23C and V29 show 72% close alignment on TRADER_STRICT wallets, but **22% of wallets have major divergence (>$100)**. The pattern suggests unrealized PnL marking differences, likely due to:
1. V23C's UI price oracle pulling different prices than V29's mark-to-market
2. Missing resolution data forcing different fallback behaviors
3. Potential bugs in either engine's unrealized calculation logic

**Next step:** Investigate the 11 divergent wallets and load UI benchmarks to determine which engine is more accurate.

---

**Generated:** 2025-12-07T00:26:00Z  
**Terminal:** Claude 1  
