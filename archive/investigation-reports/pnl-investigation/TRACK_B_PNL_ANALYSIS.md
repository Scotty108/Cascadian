# Track B PnL Analysis - Script 56 Results

**Date:** 2025-11-12
**Script:** 56-compare-track-b-pnl-vs-polymarket.ts
**Status:** Analysis Complete - Major Discrepancies Found

---

## Executive Summary

Our PnL validation against Polymarket's positions API reveals **complete mismatch**: 0% alignment across all 42 assets across 4 wallets. All comparisons show zero realized PnL from our calculations vs positive values from Polymarket's API.

This represents a critical issue that needs immediate attention before we can trust our data for Omega, Sharpe-like stats, or category-based scoring.

---

## Key Findings

### 1. Complete Realized PnL Mismatch (0/42 Assets)
- **Our calculations:** $0.00 realized PnL on all 42 assets
- **Polymarket API:** $1,145.66 total realized PnL
- **Match rate:** 0% (complete failure)

### 2. Complete Position Size Mismatch (0/42 Assets)
- **Our calculations:** All positions show 0.00 size
- **Polymarket API:** Varying position sizes (14.00 to 69,982.79)
- **Match rate:** 0% (complete failure)

### 3. Pattern Analysis
| Wallet | Assets | Our Realized | API Realized | Pattern |
|--------|--------|--------------|--------------|---------|
| `0x8a6276085b...` | 2 | $0.00 | $0.00 | ✅ Zero match
| `0x1e5d5cb258...` | 3 | $0.00 | $8.75 | ❌ API has gains
| `0x880b0cb887...` | 3 | $0.00 | -$0.17 | ❌ API has mixed
| `0xcce2b7c71f...` | 34 | $0.00 | $1,137.08 | ❌ API has significant gains

---

## Root Cause Analysis

### Root Cause: Zero Our Realized PnL
The fundamental issue is that **our calculation always returns $0.00 realized PnL** while Polymarket shows actual profits and losses. This suggests:

#### Likely Issues:
1. **Missing Resolution Data:** Our trades may not have proper resolution/payout data
2. **Incorrect Asset Mapping:** bridge between clob_fills and API assets may be broken
3. **Calculation Logic Bug:** Our FIFO logic may be fundamentally flawed
4. **Date Range Mismatch:** Our fixture data may be incomplete vs API time range

#### Evidence Supporting Root Cause #1 (Missing Resolution Data):
- Our `calculateAssetPnL()` function uses FIFO cost basis but **doesn't account for settlement/resolution**
- Track A validation worked because it had explicit resolution status (WON/LOST)
- Track B calculation assumes all trades are "open" position changes only

#### Evidence Supporting Root Cause #2 (Bridge Issue):
- All size comparisons also show 0.00 vs positive API values
- This suggests fundamental disconnect in asset identification
- Our trades may not match API asset IDs despite matching token IDs

---

## Technical Analysis

### Our Calculation Flow (Flawed):
```
clob_fills → group by asset_id → FIFO cost basis → position changes only
```

### Polymarket's Calculation Flow (Expected):
```
clob_fills → group by asset → FIFO cost basis → settlement/resolution → realized PnL
```

### Missing Critical Step:
```typescript
// In our calculateAssetPnL() function:
// We calculate: netSize, costBasis, realizedPnL from trades only
// We need to add: resolution payout = netSize * winning_outcome
// We need to add: settlement conditions (WON/LOST/OPEN check)
```

---

## Comparison with Track A Success

**Track A (Script 41):** ✅ Success with 90%+ matches
- **Key difference:** Used explicit resolution status from fixture
- **Key difference:** Had winning_index and resolved_at data
- **Key difference:** Applied payout logic: WON=netSize, LOST=0

**Track B (Script 56):** ❌ Complete failure
- **Key problem:** No resolution status or winning outcomes
- **Key problem:** Missing settlement/payout calculation
- **Key problem:** Only calculating position changes, not realized gains

---

## Action Items

### Immediate Fixes Required:
1. **Update calculateAssetPnL()** to include resolution/settlement logic
2. **Bridge asset IDs** between clob_fills and Polymarket API tokens
3. **Query resolution status** for each asset (WON/LOST/OPEN)
4. **Apply proper payout calculation** (winning positions get full payout)

### Next Steps:
1. Compare asset_id formats between our data and API responses
2. Query resolution status for each API position
3. Update the PnL calculation to include settlement logic
4. Re-run validation after fixes

---

## Recommendation

**Status:** ❌ **BLOCKED** - Cannot proceed with Track B validation until core logic is fixed.

**Priority:** P0 - This is a fundamental calculation error that invalidates all PnL metrics.

**Next Script:** Create script 56b to fix the PnL calculation logic and re-validate.

---

## Key Learning

**Critical Insight:** Track A validation succeeded because it had explicit resolution status. Track B is failing because we're only computing position changes, not actual realized gains from settled positions.

**Lesson:** Complete PnL calculation requires both:
1. Cost basis tracking (FIFO/weighted average)
2. Settlement logic based on market outcomes

**Missing in our system:** The bridge from position tracking to resolution-based settlement.

---

_— Claude 3
Track B PnL Analysis
Status: Root cause identified - Missing resolution/settlement logic_