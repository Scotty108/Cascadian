# JOIN BUG ROOT CAUSE ANALYSIS - CRITICAL FINDINGS

## Executive Summary

**FINDING**: This is NOT a join bug. This is a **DATA GAP** issue.

- FixedString(64) is working correctly (no null-byte padding issues)
- Normalization is working correctly (all approaches give identical results)
- The 57k match rate is correct for the current data overlap

## The Real Issue

### Data Coverage Statistics

```
market_resolutions_final (with valid winners):
  - Total rows: 224,302
  - Unique condition_ids: 144,015

fact_trades_clean (non-empty condition_ids):
  - Total rows: 63,543,318
  - Unique condition_ids: 228,683

Current Join Overlap: 57,095 condition_ids
```

### The Gap Breakdown

**Missing from trades (in resolutions but not in trades):**
- 86,920 condition_ids
- These are resolved markets with NO trades in fact_trades_clean
- Possible reasons:
  - Markets that were created but never traded
  - Data ingestion gap (trades not collected for these markets)
  - Markets from before our data collection period

**Missing from resolutions (in trades but not in resolutions):**
- 171,588 condition_ids
- These are TRADED markets with NO resolution data
- This is the CRITICAL gap preventing PnL calculation
- Possible reasons:
  - Markets not yet resolved (still active)
  - Resolution data not collected/backfilled
  - Markets that won't resolve (invalid/cancelled)

## Impact on PnL

Current PnL calculation can only work for:
- **57,095 markets** (25% of resolved markets, 25% of traded markets)

To achieve full coverage, we need:
- **Backfill resolution data for 171,588 traded markets**
- This is 3x the current resolution dataset

## What's NOT Broken

✅ FixedString(64) joins work correctly
✅ Normalization logic is correct
✅ The 57k matches are accurate
✅ No data corruption or type mismatch issues

## What IS Broken

❌ Resolution data coverage is incomplete (only 25% of traded markets)
❌ ~171k actively traded markets cannot calculate PnL
❌ No systematic backfill of resolution data

## Recommended Actions

### Immediate (Fix Today)
1. **Verify active vs resolved status**
   - Check if the 171k are truly unresolved or just missing data
   - Query Polymarket API for resolution status

2. **Create normalized resolution view**
   - Still valuable for cleaner joins
   - `vw_market_resolutions_norm` with toString() normalization

### Short-term (Next Week)
3. **Backfill missing resolutions**
   - Query Polymarket API for the 171k missing condition_ids
   - Priority: Markets with highest trade volume
   - Estimated: 8-12 hours of API calls

4. **Implement ongoing resolution sync**
   - Automated job to fetch resolutions for all traded markets
   - Run daily to keep resolutions current

### Long-term (Next Month)
5. **Data quality monitoring**
   - Alert when resolution coverage drops below 90%
   - Track gap between traded markets and resolved markets

## Test Results

All normalization approaches tested (5 different methods):
- Current leftPad: 2,844,118 matched trades (57,095 CIDs)
- toString(): 2,844,118 matched trades (57,095 CIDs)
- CAST to String: 2,844,118 matched trades (57,095 CIDs)
- trimRight null bytes: 2,844,118 matched trades (57,095 CIDs)
- substring(64): 2,844,118 matched trades (57,095 CIDs)

**Result**: 0% improvement from normalization changes (as expected - not a normalization bug)

## Conclusion

User's hypothesis was incorrect. This is not a join bug caused by FixedString padding.

The real issue is **missing resolution data for 75% of traded markets**.

The join is working perfectly - we simply don't have the data to join.

Next step: Investigate if the 171k markets are:
- (A) Truly unresolved (still active)
- (B) Resolved but not collected
- (C) Invalid/cancelled markets

If (B), we need a major backfill effort (~3x current resolution data).
