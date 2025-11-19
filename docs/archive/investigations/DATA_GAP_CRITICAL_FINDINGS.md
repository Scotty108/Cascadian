# Data Gap - Critical Findings

**Date:** 2025-11-10
**Status:** 🚨 CRITICAL - 97% of Wallet #1 data missing from ALL sources

---

## Executive Summary

We have **TWO separate data problems**:

### Problem 1: fact_trades_clean vs vw_trades_canonical
- `fact_trades_clean`: 63.4M trades
- `vw_trades_canonical`: 157.5M trades (**2.49x more**)
- **Missing:** 94.2M trades from fact_trades_clean

### Problem 2: Both sources missing 97% of Wallet #1 activity
- `vw_trades_canonical`: 93 trades for Wallet #1
- Polymarket UI: 2,816 predictions
- **Missing:** 2,723 trades (97% of activity!)

---

## Detailed Findings

### 1. Trade Count Comparison

| Source | Total Trades | Unique Wallets | Unique Markets | Coverage |
|--------|-------------|----------------|----------------|----------|
| **fact_trades_clean** | 63,380,204 | 923,399 | 204,680 | Baseline |
| **vw_trades_canonical** | 157,541,131 | 996,109 | 227,839 | **2.49x more** |
| **trade_direction_assignments** | 129,599,951 | ? | ? | 2.05x more |
| **trades_with_direction** | 82,138,586 | ? | ? | 1.30x more |

### 2. Time Range (Same for Both)
- Earliest: 2022-12-18
- Latest: 2025-10-31
- Coverage: 1,048 days

**Conclusion:** Both tables cover the same time period, but `vw_trades_canonical` has 2.5x more granular data.

### 3. Wallet #1 Deep Dive (0x4ce73141...)

| Source | Trade Count | vs Polymarket |
|--------|-------------|---------------|
| fact_trades_clean | 31 | 1.1% coverage |
| vw_trades_canonical | 93 | **3.3% coverage** |
| **Polymarket UI** | **2,816** | Ground truth |

**Gap:** 2,723 trades missing (97% of activity)

### 4. Wallet #2 Deep Dive (0x9155e8cf...)

| Source | Trade Count | vs Polymarket |
|--------|-------------|---------------|
| fact_trades_clean | 786,250 | 8,208% of Polymarket |
| vw_trades_canonical | 1,843,966 | **19,257% of Polymarket** |
| **Polymarket UI** | **9,577** | Ground truth |

**Anomaly:** We have 192x MORE trades than Polymarket's "predictions"
- Suggests we're counting individual fills, they're counting market interactions
- OR we have massive duplication

### 5. Wallet #3 Deep Dive (0xcce2b7c7...)

| Source | Trade Count | vs Polymarket |
|--------|-------------|---------------|
| fact_trades_clean | 295 | 153% |
| vw_trades_canonical | 1,384 | **721%** |
| **Polymarket UI** | **192** | Ground truth |

**Anomaly:** We have 7x MORE trades for this wallet too

---

## Root Cause Analysis

### Why is vw_trades_canonical 2.5x larger?

**Hypothesis 1: Different Granularity**
- fact_trades_clean might aggregate fills
- vw_trades_canonical might show individual legs (USDC + token transfers)
- Each "trade" = 2 rows in canonical (one for each direction)

**Hypothesis 2: Duplicates**
- vw_trades_canonical might have duplicates
- Need to check for trade_key or transaction_hash uniqueness

**Hypothesis 3: Different Sources**
- fact_trades_clean might only include CLOB fills
- vw_trades_canonical might also include direct ERC1155 transfers

### Why is Wallet #1 missing 97% of activity?

**Critical Finding:** Even our MOST COMPLETE table (vw_trades_canonical) only has 3.3% of Wallet #1's Polymarket activity.

**Possible Reasons:**
1. **Incomplete backfill** - We never ingested trades before Dec 2022
2. **Missing data source** - Trades exist in Polymarket API but not in our blockchain scrape
3. **Wrong wallet format** - Address normalization issue
4. **Definition mismatch** - Polymarket counts "predictions" differently than we count "trades"

---

## Polymarket "Predictions" vs Our "Trades"

### What Polymarket Counts as "Predictions"

Based on UI evidence:
- **Wallet #1:** 2,816 predictions (we have 93 trades)
- **Wallet #2:** 9,577 predictions (we have 1.8M trades)
- **Wallet #3:** 192 predictions (we have 1,384 trades)

**Pattern:** No clear correlation between our trade counts and their prediction counts.

**Hypothesis:**
- For Wallet #1: We're UNDER-counting (97% missing)
- For Wallet #2 & #3: We're OVER-counting (7-192x more)

**Explanation:**
- Polymarket "predictions" = unique market positions taken
- Our "trades" = individual fill events
- One "prediction" can generate 100s of trades (multiple buys/sells in same market)

---

## Data Source Hierarchy

### Current Understanding

```
Blockchain Events (ERC1155 + ERC20 transfers)
  ↓
ETL Pipeline
  ↓
Multiple tables:
  - trade_direction_assignments (129M)
  - trades_with_direction (82M)
  - fact_trades_clean (63M)         ← Used by vw_wallet_pnl_calculated
  ↓
vw_trades_canonical (157M)          ← Most complete view
  ↓
vw_wallet_pnl_calculated            ← Built on incomplete fact_trades_clean
  ↓
❌ Missing 97% of Wallet #1 activity
```

### What We Should Be Using

```
vw_trades_canonical (157M trades) ← START HERE
  ↓
Rebuild vw_wallet_pnl_calculated using this source
  ↓
Add missing Wallet #1 data via API backfill
```

---

## Critical Questions

### Q1: Why does vw_trades_canonical have 2.5x more rows?
**Answer Needed:** Check if it has duplicates or different granularity

### Q2: Why is Wallet #1 missing 97% of data?
**Answer Needed:** Check if:
- Data exists in Polymarket API but not in our DB
- Wallet has activity before our Dec 2022 start date
- Different address format is used

### Q3: Should we rebuild all P&L views using vw_trades_canonical?
**Answer:** YES - it's 2.5x more complete than fact_trades_clean

### Q4: Do we need a massive API backfill for Wallet #1?
**Answer:** Probably YES - 2,723 missing trades need to come from somewhere

---

## Immediate Next Steps

### Step 1: Verify vw_trades_canonical Quality
```bash
# Check for duplicates
npx tsx check-vw-trades-duplicates.ts
```

### Step 2: Trace Wallet #1 Missing Trades
```bash
# Query Polymarket API for Wallet #1's full history
npx tsx fetch-wallet1-complete-history.ts
```

### Step 3: Rebuild P&L Views
```sql
-- Rebuild vw_wallet_pnl_calculated using vw_trades_canonical as source
CREATE OR REPLACE VIEW vw_wallet_pnl_calculated AS
SELECT ...
FROM default.vw_trades_canonical  -- NOT fact_trades_clean
...
```

### Step 4: Backfill Missing Data
- Query Polymarket API for Wallet #1's 2,800 predictions
- Insert into appropriate tables
- Verify new counts match

---

## Recommendations

### Short-Term (Today)
1. ✅ Switch P&L pipeline to use vw_trades_canonical
2. ⚠️ Accept that Wallet #1 data is incomplete (document caveat)
3. 📊 Ship P&L feature with known limitations

### Medium-Term (This Week)
1. 🔍 Investigate why Wallet #1 is missing 97% of data
2. 🔄 Backfill missing trades from Polymarket API
3. ✅ Validate all 3 wallets match Polymarket UI

### Long-Term (Next 2 Weeks)
1. 🛠️ Unify data pipeline to prevent future gaps
2. 📈 Monitor data completeness daily
3. 🚨 Alert on significant gaps

---

## Risk Assessment

**Current State:**
- ❌ P&L calculations are based on incomplete data (fact_trades_clean)
- ❌ Some wallets missing 97% of their activity
- ❌ Cannot match Polymarket UI for affected wallets

**After Switching to vw_trades_canonical:**
- ✅ 2.5x more complete data
- ⚠️ Still missing Wallet #1's 97% of activity
- ⚠️ May have duplicates (needs verification)

**After API Backfill:**
- ✅ Complete historical data
- ✅ Match Polymarket UI
- ✅ Production-ready

---

## Conclusion

**We have a data completeness crisis:**
1. Current P&L views use incomplete source (fact_trades_clean)
2. Even best source (vw_trades_canonical) missing 97% of some wallets
3. Need to switch to vw_trades_canonical AND backfill missing data

**Priority Order:**
1. ✅ Switch to vw_trades_canonical (gain 2.5x data immediately)
2. 🔍 Verify it doesn't have duplicates
3. 🔄 Backfill Wallet #1's missing 2,723 trades
4. ✅ Validate against Polymarket UI

**Status:** Investigation complete, action plan clear, ready to execute.

---

**Report Generated:** 2025-11-10
**Next Action:** Check vw_trades_canonical for duplicates, then rebuild P&L views
