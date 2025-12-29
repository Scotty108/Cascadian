# PnL Missing Egg Markets - Investigation Findings

**Status:** 🔴 DATA GAPS IDENTIFIED
**Date:** 2025-11-24
**Terminal:** Claude 3

---

## Executive Summary

Investigated two specific egg market discrepancies totaling **$40,630 missing PnL**:

1. **"More than $6.00 in March"** - **$25,528.83 MISSING** (100%)
2. **"Below $4.50 in May"** - **$15,101.59 SHORT** (36.6%)

### Root Causes Identified

**Issue 1: COMPLETE INGESTION GAP**
- Market has token mapping ✅
- **ZERO trades in pm_trader_events_v2 for ANY wallet** 🔴
- This entire market is missing from our trade data

**Issue 2: PARTIAL DATA OR CALCULATION ISSUE**
- Market has token mapping ✅
- Trades exist ✅
- But PnL is 36-40% lower than expected
- Discrepancy between view ($26,187.88) and recomputation ($24,924.15)

---

## Issue 1: "More than $6.00 in March" - COMPLETE INGESTION GAP

### Market Details

**Condition ID:** `8e02dc3233cf073a64a9f0466ef8ddbe1f984e4b87eacfd1b8d10c725e042f39`
**Question:** "Will egg prices be more than $6.00 in March?"
**Expected PnL (UI):** $25,528.83
**Our PnL:** $0.00
**Gap:** **-$25,528.83 (100% missing)**

### Investigation Results

**Token Mapping:** ✅ EXISTS

```
Token 1:
  token_id: 24188195709025027610491226911088365960360769853291797481630030463817481647242
  outcome_index: 0

Token 2:
  token_id: 85740447002786770424229462671713422219713013675320888152717278640531856100853
  outcome_index: 1
```

**Trade Coverage:**
- Trades for ALL wallets: **0** 🔴
- Trades for our wallet: **0** 🔴

### Diagnosis

🔴 **CRITICAL INGESTION GAP**

This market is **completely missing** from `pm_trader_events_v2`. The tokens are mapped, but there are:
- No trades for ANY wallet
- No trades in the entire system for these token_ids

### Next Steps

1. Check if these trades exist in raw blockchain data (Goldsky/Subgraph)
2. Verify if token_ids are correct in mapping table
3. Re-ingest trades for these specific token_ids
4. Estimate total system-wide missing volume for this market

---

## Issue 2: "Below $4.50 in May" - 36-40% PnL SHORTFALL

### Market Details

**Condition ID:** `ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2`
**Question:** "Will a dozen eggs be below $4.50 in May?"
**Expected PnL (UI):** $41,289.47
**Our PnL (view):** $26,187.88
**Our PnL (recomputed):** $24,924.15
**Gap:** **-$15,101.59 to -$16,365.32 (36-40%)**

### Investigation Results

**Token Mapping:** ✅ EXISTS

```
Token 1:
  token_id: 72016524934977102644827669188692754213186711249642025547408896104495709692655
  outcome_index: 0 (loser)

Token 2:
  token_id: 67667008497414096390814617189575286283198684685498957861337980942501422593237
  outcome_index: 1 (WINNER)
```

**Resolution:** `[0, 1]`
**Winner:** outcome_index = 1 ✅

**Wallet Trades by Outcome:**

| Outcome | Total Shares | USDC Spent | Fee | Net Shares (directional) |
|---------|-------------|------------|-----|--------------------------|
| 0 (loser) | 1,263.73 | $964.05 | $0.00 | **-1,263.73** (sold) |
| 1 (winner) | 32,937.37 | $7,713.54 | $0.00 | **+32,937.37** (bought) |

**Final Position:**
- Trade cash: **-$6,749.49**
- Final shares: **31,673.64** (outcome 1 - winner)
- Resolved price: **1.0**
- Resolution cash: **$31,673.64**
- **Realized PnL: $24,924.15**

### Discrepancies Found

**1. View vs Recomputation**
- `vw_pm_realized_pnl_v2`: $26,187.88
- Direct recomputation: $24,924.15
- **Difference: $1,263.73** (exactly matches outcome 0 shares!)

This suggests the view might be incorrectly including outcome 0 shares in the final calculation.

**2. Our Calculation vs UI**
- Our best calculation: $24,924.15 to $26,187.88
- UI shows: $41,289.47
- **Gap: $15,101.59 to $16,365.32 (36-40%)**

### Diagnosis

⚠️  **PARTIAL DATA OR METHODOLOGY ISSUE**

Possible causes:
1. **Missing trades** - We have 49 trade rows, but UI might have more
2. **Fee handling** - Our fees are $0.00, UI might include different fees
3. **Outcome aggregation** - View might be incorrectly aggregating outcomes
4. **Different data source** - UI uses different blockchain data

The $1,263.73 discrepancy between view and recomputation is suspicious and needs investigation.

### Next Steps

1. Verify trade count - does UI show more than 49 trades?
2. Check if view is correctly aggregating by outcome
3. Investigate why final_shares (31,673.64) differs from net_shares for outcome 1 (32,937.37)
4. Check if there are additional trades for this market not captured

---

## System-Wide Impact

### Total Identified Gaps

| Market | Gap | % of UI | Type |
|--------|-----|---------|------|
| "More than $6 March" | -$25,528.83 | 100% | **COMPLETE INGESTION GAP** |
| "Below $4.50 May" | -$15,101.59 | 36% | **PARTIAL DATA/CALC ISSUE** |
| **TOTAL** | **-$40,630.42** | | |

### Overall PnL Gap Analysis

**UI shows (4 egg wins):** $78,380.86
**Our calculation:** $42,806.64
**Total gap:** -$35,574.22

**Explained by identified issues:**
- Issue 1 (complete gap): -$25,528.83
- Issue 2 (partial gap): -$15,101.59
- **Total explained: -$40,630.42**

Wait, that's MORE than our total gap! This suggests the other two markets ($3.25-3.50 Aug/Jul) are actually OVER-reported in our system compared to UI.

### Reconciliation

Let me recalculate:

**From UI per-market audit:**
1. "below $4.50 May": Our $26,187.88 vs UI $41,289.47 = **-$15,101.59**
2. "more than $6 March": Our $0.00 vs UI $25,528.83 = **-$25,528.83**
3. "$3.25-3.50 August": Our $6,946.99 vs UI $5,925.46 = **+$1,021.53**
4. "$3.25-3.50 July": Our $9,671.77 vs UI $5,637.10 = **+$4,034.67**

**Net gap:** -$15,101.59 - $25,528.83 + $1,021.53 + $4,034.67 = **-$35,574.22** ✅

This matches our total gap exactly!

---

## Conclusions

### What We Know ✅

1. **Issue 1 is a COMPLETE ingestion gap**
   - Market metadata exists
   - Token mapping exists
   - **Zero trades in pm_trader_events_v2**
   - Needs immediate backfill

2. **Issue 2 is a PARTIAL data or calculation issue**
   - Trades exist
   - Calculation seems correct
   - But 36% short of UI value
   - Likely missing trades or different methodology

3. **Other two markets OVER-report**
   - August market: +17% ($1,021)
   - July market: +71% ($4,034)
   - These offset some of the gap

### What We Need To Do 🔴

1. **URGENT: Backfill "more than $6 March" market**
   - Investigate why token_ids have zero trades
   - Check raw blockchain data
   - Re-ingest trades for these token_ids
   - This will recover $25,528.83

2. **Investigate "below $4.50 May" shortfall**
   - Check trade count (UI vs our 49 rows)
   - Fix view aggregation discrepancy ($1,263.73)
   - Verify all trades are captured
   - This could recover $15,101.59

3. **Investigate over-reporting markets**
   - Why do August/July show higher PnL?
   - Are we double-counting trades?
   - Or is UI methodology different?

### Impact on Overall Gap

**Current gap to UI:** $58,596 (on $96,000 total)

**If we fix Issue 1:** Gap reduces by $25,528 → **$33,068 remaining**
**If we fix Issue 2:** Gap reduces by $15,101 → **$17,967 remaining**
**If both fixed:** Gap reduces by $40,630 → **$17,966 remaining**

The remaining ~$18K gap would then be:
- Different calculation methodology
- Other missing markets
- Data source differences

---

## Next Actions

**Immediate (Priority 1):**
1. Investigate why token_ids for "more than $6 March" have zero trades
2. Check Goldsky/Subgraph for trades on these token_ids
3. Backfill missing trades

**Short Term (Priority 2):**
1. Debug view aggregation for "below $4.50 May" ($1,263 discrepancy)
2. Verify trade completeness for this market
3. Compare trade count with UI

**Medium Term (Priority 3):**
1. Investigate August/July over-reporting
2. Add data quality checks for trade ingestion
3. Document PnL calculation methodology differences

---

## Related Documentation

- [PNL_V2_INTERNAL_RECONCILIATION.md](./PNL_V2_INTERNAL_RECONCILIATION.md)
- [PNL_V2_CTF_AND_GAP_ANALYSIS.md](./PNL_V2_CTF_AND_GAP_ANALYSIS.md)
- [PNL_V1_NULLABLE_FIX_SUMMARY.md](./PNL_V1_NULLABLE_FIX_SUMMARY.md)

---

**Terminal:** Claude 3
**Date:** 2025-11-24
**Status:** 🔴 DATA GAPS IDENTIFIED - ACTION REQUIRED
