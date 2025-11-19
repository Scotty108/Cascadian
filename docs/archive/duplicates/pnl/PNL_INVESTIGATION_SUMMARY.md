# P&L Verification Investigation Summary

**Date:** November 9, 2025  
**Investigation Goal:** Verify P&L calculations against Polymarket's official numbers for wallet `0x9155e8cf81a3fb557639d23d43f1528675bcfcad`

---

## Expected vs Actual Results

### Polymarket Ground Truth
- **Predictions:** 9,561
- **All-Time P&L:** $110,440.13
- **Biggest Win:** $3,881.34
- **Current Positions:** $2,812.86

### Our Calculation Results
- **Total trades:** 786,250 ✅
- **Markets traded:** 17,136 ❌ (expected: 9,561)
- **Resolved markets:** 0 ❌❌❌ (CRITICAL)
- **Total P&L:** $0 ❌ (expected: $110,440.13)

---

## Root Cause Analysis

### Issue #1: Complete Data Isolation (CRITICAL)

**Global Market Coverage:**
- Markets in `fact_trades_clean`: **204,680**
- Markets in `api_markets_staging`: **161,180** (recently backfilled)
- **Overlap: 60,143 (29.4%)**
- **Missing: 144,537 markets (70.6%)**

**Wallet-Specific Coverage:**
- Wallet's traded markets: **17,136**
- In `api_markets_staging`: **0 (0.0%)**
- **100% of wallet's trades are on "orphan" markets**

### Issue #2: Temporal Anomaly

All wallet trades dated in the **future**:
- Oct 2025: 5,760 markets, 233,102 trades
- Sept 2025: 4,876 markets, 150,203 trades  
- Aug 2025: 5,396 markets, 329,879 trades

Example: Top traded market has 1,256 trades all on **Oct 14, 2025** between 06:27-07:34.

### Issue #3: No Resolution Data Overlap

**Zero matches found:**
- Wallet's top traded CID: `767bbb22f6d36ab5533f662312322cc6f507717d72f884545708f20047cf50eb`
- Searched in `market_resolutions_final`: 0 matches
- Searched in `resolutions_external_ingest`: 0 matches
- Searched in `api_markets_staging`: 0 matches

---

## Diagnosis

The P&L calculation failure is caused by a **fundamental data architecture issue**:

1. **Trade data exists** (`fact_trades_clean` has 786K trades for this wallet)
2. **Market metadata is missing** (0% of traded markets exist in `api_markets_staging`)
3. **Resolution data unavailable** (cannot calculate P&L without market outcomes)

### Possible Explanations

**Theory #1: Wrong Data Source**
- `fact_trades_clean` may not be the correct table for CLOB trades
- CID field might represent something other than `condition_id`
- Need to verify trade data pipeline architecture

**Theory #2: Date/Timestamp Bug**
- All trades dated 9 months in the future (Oct 2025 vs current Nov 2024)
- Suggests Unix timestamp conversion issue (seconds vs milliseconds)
- Could affect market matching if dates are used as filters

**Theory #3: Market ID System Mismatch**
- CLOB uses different IDs than Gamma API
- The 144,537 "orphan" markets may use token IDs instead of condition IDs
- Need to build a mapping between token IDs and condition IDs

**Theory #4: API Incomplete**
- Gamma API only returns 161K markets, but 204K are actively traded
- Missing 43.5K markets may be:
  - Archived/delisted markets
  - CLOB-only markets not exposed via API
  - Markets using old contract versions

---

## Data Quality Issues Found

1. ✅ **Schema mismatches FIXED:**
   - `maker` → `wallet_address`
   - `side` → `direction`
   - `size` → `shares`

2. ❌ **Market metadata gap:**
   - 144,537 traded markets missing from `api_markets_staging`
   - Recent backfill of 161K markets did NOT fix the gap

3. ❌ **Temporal data corruption:**
   - All wallet trades dated 9 months in the future
   - Suggests systematic date parsing issue

4. ❌ **Zero resolution coverage:**
   - None of wallet's 17K traded markets have resolution data
   - Cannot calculate P&L without outcomes

---

## Files Created During Investigation

1. `verify-pnl-against-polymarket.ts` - Main P&L verification script
2. `find-active-wallet.ts` - Find wallets with trade data
3. `check-fact-trades-clean-schema.ts` - Verify table schema
4. `diagnose-join-failure.ts` - Investigate join failures
5. `check-wallet-trade-timing.ts` - Analyze trade timing
6. `calculate-actual-overlap.ts` - Measure market overlap
7. `investigate-cid-format.ts` - Investigate CID field meaning
8. `check-table-counts.ts` - Compare market counts across tables

---

## Next Steps to Fix

### Immediate Actions (High Priority)

1. **Fix Timestamp Issues:**
   - Investigate `fact_trades_clean` data ingestion
   - Check if timestamps are in seconds vs milliseconds
   - Re-parse dates if needed

2. **Verify Trade Data Source:**
   - Confirm `fact_trades_clean` is the correct table
   - Check if there are other trade tables (CLOB-specific)
   - Review data pipeline architecture

3. **Build Token→Condition ID Mapping:**
   - ERC1155 token IDs may be the actual trade identifiers
   - Need to map token IDs to condition IDs
   - Cross-reference with blockchain events

### Medium Priority

4. **Backfill Missing Markets:**
   - Fetch the 144,537 missing markets via alternative methods:
     - Direct CLOB API queries
     - Blockchain event parsing
     - Historical archive data

5. **Fetch Resolution Data:**
   - Once markets are identified, backfill outcomes
   - Sources: blockchain events, CLOB API, historical snapshots

### Long-Term Solutions

6. **Redesign Data Pipeline:**
   - Ensure trade ingestion captures complete market metadata
   - Add validation: reject trades without corresponding markets
   - Implement continuous market discovery from trade activity

---

## Current Status

**Blocked on:** Understanding the fundamental disconnect between trade data (fact_trades_clean) and market metadata (api_markets_staging).

**Cannot proceed with P&L verification until:**
1. Temporal anomaly is resolved (future dates fixed)
2. Market metadata gap is filled (144K missing markets)
3. Resolution data is available for traded markets

---

## Questions for User

1. Is `fact_trades_clean` the correct source for CLOB trade data?
2. Should trades be dated in Oct 2025, or is this a known timestamp bug?
3. Are there alternative market metadata sources besides Gamma API?
4. Is there a token_id→condition_id mapping table we should be using?
5. Should we pivot to using a different test wallet with better data coverage?

