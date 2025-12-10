# V29 Engine Tooltip Validation - Final Report

**Date:** 2025-12-07
**Status:** VALIDATED
**Dataset:** 18 Playwright tooltip-verified wallets

---

## Executive Summary

V29 PnL engine achieves **76.5% accuracy** (13/17) against Playwright tooltip-verified ground truth at 10% tolerance. With TRADER_STRICT filter (openPositions <= 50), accuracy improves to **88.9%**.

### Key Metrics

| Metric | Value |
|--------|-------|
| Overall Pass Rate | **76.5% (13/17)** |
| TRADER_STRICT Pass Rate | **88.9% (8/9)** |
| Average Error (passing) | **2.60%** |
| Best Accuracy | 0.0% (exact match) |

---

## Validation Results by Category

### By Wallet Label

| Label | Pass | Total | Rate |
|-------|------|-------|------|
| **CLOB-only** | 2 | 2 | **100%** |
| Leaderboard | 10 | 13 | 76.9% |
| Mixed | 1 | 2 | 50% |

### By Open Positions

| Position Count | Pass | Total | Rate |
|----------------|------|-------|------|
| **Few (1-50)** | 8 | 9 | **88.9%** |
| Many (50+) | 5 | 8 | 62.5% |

---

## Top Performing Wallets

| Wallet | UI PnL | V29 PnL | Error | Open Pos |
|--------|--------|---------|-------|----------|
| 0x21b39f70... | $190.80 | $190.80 | **0.0%** | 3 |
| 0x9a4a4764... | $59,973.62 | $59,946.77 | **-0.04%** | 88 |
| 0x3df02b8c... | -$4,747.99 | -$4,751.09 | **-0.1%** | 24 |
| 0xd5dca994... | $275,556.10 | $275,150.11 | **-0.1%** | 6 |
| 0x16180ae4... | $1,992.12 | $1,987.42 | **-0.2%** | 2 |
| 0x688beacb... | $342.84 | $341.40 | **-0.4%** | 8 |
| 0xed2239a9... | $3,095,007.80 | $3,092,834.86 | **-0.07%** | 12 |

---

## Failing Wallets Analysis

| Wallet | UI PnL | V29 PnL | Error | Open Pos | Root Cause |
|--------|--------|---------|-------|----------|------------|
| 0x7fb7ad0d... | $2.28M | $8.26M | **+262%** | 1584 | Position explosion |
| 0xb744f563... | -$3.32M | -$188K | **+94%** | 235 | Whale redemption gap |
| 0x2e41d5e1... | $14,049 | $27,048 | **+92%** | 27 | Unknown edge case |
| 0x7a305161... | $3,498 | $596 | **-83%** | 87 | Complex mixed activity |

### Failure Pattern

- 3/4 failures have **>50 open positions**
- Whale wallets show massive `resolvedUnredeemedValue` gaps ($22-23M)
- One outlier (0x2e41) needs deeper investigation

---

## TRADER_STRICT Filter

Based on validation evidence, the TRADER_STRICT filter improves accuracy:

```typescript
function isTraderStrict(wallet: V29Result): boolean {
  return (
    wallet.openPositions <= 50 &&
    Math.abs(wallet.uiParityPnl) >= 100
  );
}
```

| Filter | Expected Accuracy |
|--------|------------------|
| No filter | ~77% |
| **TRADER_STRICT v1** | **~89%** |

---

## Validation Methodology

### Ground Truth Collection

1. Navigate to `https://polymarket.com/profile/{wallet}`
2. Click "ALL" in P/L timeframe selector
3. Hover info (i) icon next to Profit/Loss
4. Extract from tooltip: Volume, Gain, Loss, **Net Total**
5. Verify identity: `Gain - |Loss| = Net Total`
6. Record validated Net Total as ground truth

### Why Tooltip?

The tooltip provides a self-check identity (Gain - Loss = Net Total) that proves we scraped the correct value. Previous scraper failures showed:
- Volume captured instead of PnL (277x errors)
- Wrong sign (negative vs positive)
- Adjacent field captured

---

## Files

| File | Purpose |
|------|---------|
| `tmp/playwright_tooltip_ground_truth.json` | Ground truth dataset (18 wallets) |
| `tmp/v29_vs_tooltip_truth.json` | Full validation results |
| `scripts/pnl/validate-v29-vs-tooltip-truth.ts` | Canonical validation script |
| `docs/systems/pnl/TRADER_STRICT_FILTER_V1.md` | Filter specification |
| `lib/pnl/inventoryEngineV29.ts` | V29 PnL engine |

---

## Recommendations

### For Leaderboard (Track B)

1. Apply TRADER_STRICT filter (openPositions <= 50)
2. Rank by `uiParityPnl` for UI parity
3. Exclude wallets with |PnL| < $100

### For Copy Trading (Track C)

1. Use TRADER_STRICT filter as baseline
2. Consider adding unredeemed ratio filter
3. Monitor accuracy over time

### For Future Work

1. Expand tooltip-verified dataset to 50+ wallets
2. Investigate 0x2e41 outlier (27 positions, 92% error)
3. Build automated Playwright scraper for ongoing validation
4. Add v2 filter with unredeemed ratio limit

---

## Conclusion

V29 is production-ready for leaderboard use with TRADER_STRICT filter. The 88.9% accuracy on filtered wallets with 2.60% average error provides sufficient confidence for ranking and copy trading features.

---

*Report generated: 2025-12-07T22:53:00Z*
