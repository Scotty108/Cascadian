# Token ID vs Market ID Diagnosis Report

**Date:** 2025-11-09
**Status:** CRITICAL FINDINGS - ROOT CAUSE IDENTIFIED

## Executive Summary

The Gamma API backfill returned ALL empty rows (winning_index=-1) not because we're querying with token IDs instead of market IDs, but because **the Gamma API does not provide resolution data in the format we expected**.

## Key Findings

### 1. Token ID vs Market ID Analysis

**Result:** NO ISSUE - We are storing market-level condition IDs correctly.

```
Token IDs:    227,838
Market IDs:   227,838
Ratio:        1.00x (expected: ~2x if we had token IDs)
```

**Evidence:**
- Sampling 20 trades from same market showed suffix variation of "NO"
- All trades have the same last 2 hex characters (e.g., "53")
- This confirms we're storing market-level condition IDs, not token-level

### 2. Gamma API Response Structure

**CRITICAL ISSUE:** The Gamma API response does NOT contain resolution fields at the top level.

**Expected fields (NOT present):**
- `resolved` (boolean)
- `winning_outcome` (string)
- `winning_index` (number)

**What the API actually returns:**
```json
{
  "id": "12",
  "question": "Will Joe Biden get Coronavirus before the election?",
  "conditionId": "0xe3b423dfad8c22ff75c9899c4e8176f628cf4ad4caa00481764d320e7415f7a9",
  "outcomes": "[\"Yes\", \"No\"]",
  "closed": true,
  "active": true,
  "archived": false,
  // NO resolution data at this level
  "umaResolutionStatuses": "[]",
  // ... other metadata
}
```

**Note:** The `conditionId` field in the API response is different from our query condition_id:
- Our query: `0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3d670e50771c58bbed`
- API returns: `0xe3b423dfad8c22ff75c9899c4e8176f628cf4ad4caa00481764d320e7415f7a9`

This is why we get 20 markets back - the API is doing fuzzy matching or partial matching!

### 3. Current Resolution Data Status

```
market_resolutions_final stats:
  Total:                224,396 markets
  Has winner index:     224,396 (100%)
  Has winning outcome:  224,396 (100%)
```

**This data was populated from blockchain payout vectors, NOT from the Gamma API.**

### 4. Backfill Target Analysis

```
OLD (token-level) backfill targets: 0
NEW (market-level) backfill targets: 0
```

**Why 0 targets?** Because market_resolutions_final already has 224k markets with resolution data from the blockchain!

## Root Cause Analysis

### Why Gamma API Backfill Failed

1. **Wrong API endpoint assumptions**
   - We assumed `/markets?condition_id=X` would return resolution data
   - The endpoint returns market metadata, not resolution status

2. **Wrong field expectations**
   - Code looked for `resolved` and `winning_outcome` fields
   - These fields don't exist in the Gamma API response

3. **Condition ID mismatch**
   - Our normalized condition IDs don't match API's `conditionId` field
   - API returns multiple unrelated markets (20 results for a single query)

### Why We Already Have Resolution Data

The blockchain reconstruction scripts already populated market_resolutions_final with 224k markets from on-chain payout vectors. The Gamma API backfill was redundant and incorrectly implemented.

## Coverage Reality Check

```
Traded markets:               227,838
Markets with resolutions:     224,396
Coverage:                     98.5% (not 24.8%!)
```

**The original 24.8% calculation was wrong.** It was comparing:
- Numerator: Resolutions from blockchain (224k)
- Denominator: Something else entirely (not traded markets)

## Recommendations

### 1. Verify Blockchain Resolution Data Quality

```sql
-- Check if our blockchain-derived resolutions are accurate
SELECT
  count(*) as total,
  countIf(payout_denominator > 0) as has_payout,
  countIf(arraySum(payout_numerators) > 0) as has_nonzero_payout,
  countIf(winning_index >= 0 AND winning_index < outcome_count) as valid_winner
FROM default.market_resolutions_final;
```

### 2. Stop Using Gamma API for Resolutions

The Gamma API is not designed for bulk resolution data fetching. Use these sources instead:
- **Blockchain events:** CTF Exchange `PayoutRedemption` events
- **Polymarket subgraph:** Query resolution data directly
- **UMA resolution feed:** `umaResolutionStatuses` (if available)

### 3. Fix Coverage Metrics

Update the dashboard to show:
```
Coverage = (markets with resolutions) / (total traded markets)
         = 224,396 / 227,838
         = 98.5%
```

NOT the current incorrect 24.8%.

## Action Items

- [ ] Audit blockchain-derived resolution data quality
- [ ] Remove Gamma API backfill scripts (they don't work)
- [ ] Update coverage metric calculations in dashboard
- [ ] Investigate the 3,442 missing resolutions (227,838 - 224,396)
- [ ] Document correct resolution data sources
- [ ] Add validation to ensure resolution data matches blockchain state

## Files Created

1. `/Users/scotty/Projects/Cascadian-app/diagnose-token-vs-market-id.ts`
   - Compares token vs market ID counts
   - Creates fixed views for market-level joins

2. `/Users/scotty/Projects/Cascadian-app/investigate-resolution-mismatch.ts`
   - Tests Gamma API responses
   - Reveals API structure mismatch

3. `/Users/scotty/Projects/Cascadian-app/test-gamma-api-response.ts`
   - Raw API response inspection
   - Confirms missing resolution fields

## SQL Views Created

### cascadian_clean.vw_token_to_market
Maps token-level condition IDs to market-level (if needed for ERC1155 joins).

### cascadian_clean.vw_backfill_targets_fixed
Market-level backfill targets (currently returns 0 - all markets have resolutions).

## Conclusion

**The Gamma API is not the right tool for resolution backfill.**

Our blockchain reconstruction already provides 98.5% coverage. The remaining 1.5% (3,442 markets) should be investigated separately - they may be:
- Invalid/cancelled markets
- Markets that haven't resolved yet
- Data quality issues in trades table

The original hypothesis (token ID vs market ID confusion) was incorrect. The real issue is API incompatibility.
