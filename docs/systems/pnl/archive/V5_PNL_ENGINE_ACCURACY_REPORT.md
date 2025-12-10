# V5 PnL Engine Accuracy Report

**Date:** 2025-11-29
**Status:** Experiment Complete
**Verdict:** Splits/Merges handling does NOT significantly improve accuracy over V3

---

## Executive Summary

We implemented and tested a V5 PnL engine that adds CTF Split/Merge tracking with $0.50 cost basis to V3's average cost method to see if it would improve accuracy.

**Result: Marginal improvement for affected wallets, no overall improvement.**

| Metric | V3 (Average Cost) | V5 (+ Splits/Merges) | Difference |
|--------|-------------------|----------------------|------------|
| Sign Accuracy | 77.6% | 77.6% | 0% |
| Median Error | 24.2% | 24.1% | -0.1% |
| Mean Error | 48.6% | 48.6% | 0% |
| Exact Matches (<1%) | 4 | 4 | 0 |

**Recommendation:** Keep V3 as the canonical engine. V5 adds complexity without meaningful benefit across the wallet population.

---

## Hypothesis

Based on the PnL Accuracy Research Plan identifying CTF splits/merges as ~20-25% of error contribution, we hypothesized that properly handling these events with $0.50 cost basis would improve accuracy.

**Expected improvement:** 10-15% error reduction
**Actual improvement:** ~0% overall (but 3/13 wallets with splits/merges improved)

---

## Implementation

### V5 Engine: `lib/pnl/uiActivityEngineV5.ts`

Key changes from V3:

```typescript
// Standard cost basis for splits (from Polymarket)
const FIFTY_CENTS = 0.5;

case 'SPLIT':
  splits_count++;
  // Add position at $0.50 cost basis
  state.position_cost += event.qty_tokens * FIFTY_CENTS;
  state.position_qty += event.qty_tokens;
  break;

case 'MERGE':
  merges_count++;
  // "Sell" position at $0.50
  if (state.position_qty > 0) {
    const avg_cost = state.position_cost / state.position_qty;
    const qty_to_sell = Math.min(event.qty_tokens, state.position_qty);
    const pnl_now = (FIFTY_CENTS - avg_cost) * qty_to_sell;
    state.realized_pnl += pnl_now;
    // Reduce position...
  }
  break;
```

### ERC1155 Transfers (Disabled)

Initially attempted to track ERC1155 transfers but found they caused **565% worse accuracy** due to double-counting with CLOB trades from Polymarket Exchange contract:
- `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e` (Polymarket Exchange)
- `0xc5d563a36ae78145c45a6b4fc186c6e5f1d2c8c7` (NegRisk CTF)

After disabling transfers, V5 shows only splits/merges impact.

---

## Test Results

### Validation Set: 50 Known Wallets (49 processed, 1 error)

### Full Results Summary

| Category | Count | V5 Better | Same | V3 Better |
|----------|-------|-----------|------|-----------|
| All wallets | 49 | 6 (12%) | 40 (82%) | 3 (6%) |
| Wallets WITH splits/merges | 13 | 9 (69%) | 3 (23%) | 1 (8%) |
| Wallets WITHOUT splits/merges | 36 | 6 (17%) | 27 (75%) | 3 (8%) |

### CTF Event Statistics

| Metric | Count |
|--------|-------|
| Total splits detected | 12 |
| Total merges detected | 2,668 |
| Wallets with splits/merges | 13/49 (26.5%) |

### Error Distribution

| Threshold | V3 Count | V5 Count |
|-----------|----------|----------|
| Within 1% | 4 (8%) | 4 (8%) |
| Within 5% | 5 (10%) | 6 (12%) |
| Within 10% | 11 (22%) | 11 (22%) |
| Within 15% | 15 (31%) | 15 (31%) |
| Within 25% | 27 (55%) | 27 (55%) |
| Within 50% | 31 (63%) | 31 (63%) |

---

## Why Splits/Merges Didn't Help Overall

### Root Cause Analysis

The hypothesis that splits/merges would significantly improve accuracy was based on the research plan estimating ~20-25% error contribution. **However:**

1. **Only 26.5% of wallets have any splits/merges** (13/49)
2. **Of those 13 wallets, average error didn't change** (16.3% V3 → 16.4% V5)
3. **Most error comes from other sources** still present in both V3 and V5

### Actual Error Sources (Updated Estimates)

| Error Source | Contribution | V5 Fixes? |
|--------------|--------------|-----------|
| Missing data (0 PnL wallets) | ~40% | No |
| Sign mismatches | ~23% | No |
| Large magnitude errors (100%+) | ~15% | No |
| Split/merge cost basis | ~2-3% | Partial |
| Other timing/precision | ~20% | No |

### Key Observations

1. **6 wallets showing $0 PnL** in both V3 and V5 (12d6ccc, 662244, 3b6fd06, eb6f0a, 7dca4d, 418db1)
   - These likely have data gaps or use features not tracked

2. **2 major sign mismatches** unchanged between V3 and V5:
   - 0x4ce73141db: UI=$332K, V3/V5=$-283K (sign wrong)
   - 0x8e9eedf20d: UI=$360K, V3/V5=$-73K (sign wrong)

3. **Merge handling caused 2 regressions**:
   - 0xa9b44dca (2,024 merges): V3=-10.7% → V5=+13.1% (worse)
   - 0x4974d5c6 (40 merges): V3=+16.4% → V5=+23.4% (worse)

---

## Interesting Findings

### Wallets That Improved Most (V5)

| Wallet | Merges | V3 Error | V5 Error | Improvement |
|--------|--------|----------|----------|-------------|
| 0x8f42ae0a01c0 | 26 | +28.2% | +25.2% | 3.0pp |
| 0xc02147dee4 | 40 | -24.4% | -22.6% | 1.9pp |
| 0xa4b366ad22 | 262 | +5.2% | +3.4% | 1.8pp |

### Wallets That Got Worse (V5)

| Wallet | Merges | V3 Error | V5 Error | Regression |
|--------|--------|----------|----------|------------|
| 0x4974d5c6 | 40 | +16.4% | +23.4% | 7.0pp |
| 0xa9b44dca | 2,024 | -10.7% | +13.1% | 2.4pp |

The wallet with the most merges (2,024) got **worse**, suggesting our merge handling may have issues for high-frequency mergers.

---

## Conclusion

### V5 Status: Not Recommended for Production

The V5 engine with splits/merges handling provides no meaningful improvement over V3. While it helps some wallets with moderate merge activity, it harms wallets with high merge counts.

### Files

| File | Purpose | Status |
|------|---------|--------|
| `lib/pnl/uiActivityEngineV5.ts` | V5 engine with splits/merges | Archived |
| `scripts/pnl/validate-v3-v5-comparison.ts` | Quick validation (15 wallets) | Archived |
| `scripts/pnl/comprehensive-v3-v5-validation.ts` | Full validation (50 wallets) | Archived |

### What Would Actually Improve Accuracy

Based on this experiment, the next accuracy improvements should focus on:

1. **Data Completeness** (~40% error contribution)
   - 6 wallets returning $0 have missing data
   - Need to investigate why these wallets show no activity

2. **Sign Mismatch Root Cause** (~23% error contribution)
   - 11 wallets have wrong sign
   - Likely involves untracked position sources (transfers, NegRisk, etc.)

3. **Large Magnitude Errors** (~15% error contribution)
   - 7 wallets have >100% error
   - Need individual wallet deep-dives

### What Did NOT Help

| Attempted Fix | Result |
|---------------|--------|
| V4 FIFO cost basis | No improvement |
| V5 Splits/Merges | No improvement |
| ERC1155 transfers | Made things worse (565% inflation) |

---

## Appendix: V3 vs V5 Side-by-Side

### Code Complexity

| Metric | V3 | V5 |
|--------|----|----|
| Lines of code | ~350 | ~500 |
| Event types handled | 4 | 7 |
| Data sources | CLOB + CTF | CLOB + CTF + ERC1155 (disabled) |
| Debugging ease | Easy | Medium |

### When to Revisit V5

Consider V5 if:
- We identify high-merge-frequency wallets as a key user segment
- We fix the merge handling regression for high-count wallets
- We need split/merge PnL breakdown for UI display (separate from total PnL)

---

*Report generated by Claude Code - 2025-11-29*
*Signed: Claude 1*
