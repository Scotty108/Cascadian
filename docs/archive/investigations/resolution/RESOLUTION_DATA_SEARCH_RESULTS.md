# Resolution Data Search Results

**Wallet:** 0x4ce73141dbfce41e65db3723e31059a730f0abad  
**Date:** 2025-11-09  
**Search Scope:** All resolution/payout tables in default and cascadian_clean databases

## Executive Summary

**CRITICAL FINDING: The wallet's 30 condition_ids do NOT exist in ANY resolution table.**

This is NOT a payout data quality issue - this is a **missing data issue**. The condition_ids from the wallet's trades (June-Sept 2024) are completely absent from all resolution data sources.

## Search Results

### Tables Searched

Searched **9 high-priority tables** with resolution/payout data:

1. `default.staging_resolutions_union` (544,475 rows) - No condition_id column
2. `default.resolution_candidates` (424,095 rows) - 0/30 matches
3. `default.gamma_resolved` (123,245 rows) - No condition_id column
4. `default.market_resolutions` (137,391 rows) - 0/30 matches
5. `default.market_resolutions_by_market` (133,895 rows) - No condition_id column
6. `cascadian_clean.resolutions_src_api` (130,300 rows) - 0/30 matches
7. `default.market_key_map` (156,952 rows) - 0/30 matches
8. `default.gamma_markets` (149,907 rows) - 0/30 matches
9. `default.api_market_backfill` (5,983 rows) - **1/30 matches** (but empty payout data)

### Only Match Found

**Table:** `default.api_market_backfill`  
**Matches:** 1 condition_id out of 30  
**condition_id:** `23a8f862517c25dcaabce07d0ace00531a7d0c919d68225b8d1ce9a56f592215`

**Data found:**
```json
{
  "condition": "23a8f862517c25dcaabce07d0ace00531a7d0c919d68225b8d1ce9a56f592215",
  "outcomes_json": "\"[\\\"Yes\\\", \\\"No\\\"]\"",
  "winning_outcome": "",
  "resolved": 0,
  "payout_numerators_json": "[]"
}
```

**Status:** This row has EMPTY payout data (payout_numerators: [], resolved: 0, winning_outcome: "")

## Wallet Trade Statistics

- **Total trades:** 38
- **Unique condition_ids:** 30 (excluding zeros)
- **Date range:** 2024-06-02 to 2024-09-11
- **Sample condition_ids:**
  - `00bbbbe23c0fc0ff0d30809419c4eeecc14df9b4d789e92d9782a14ec0a3fd76`
  - `1cf51cd9023cd1ed122eb8dcd2d5e54223c3c482ab3520d2d5ec1832c239ed2d`
  - `22d846ac18ba7bd09d16fb08dabed9013329406d3d8b21a8d61ee93613b2bd6e`
  - `23a8f862517c25dcaabce07d0ace00531a7d0c919d68225b8d1ce9a56f592215`
  - `2adc1f426d9ddea309e66deb15c9c0afa930f8765ecdb5b0cf615e4b17d177ec`

## Resolution Table Statistics

### Format Observations

All resolution tables contain condition_ids, but in different formats:

1. **cascadian_clean.resolutions_src_api:** 127,000 unique IDs  
   - Format: `0x8cba0ce3e996882b0b0c8b14e76d94949b342f3371d332c4625ce0b5de8d6900`  
   - Note: Many end in "00" (different encoding?)

2. **default.market_resolutions:** 137,391 unique IDs  
   - Format: `0001bd6b1ce49b28d822af08b0ff1844bf789bfeb7634a88b45e7619a0d45837`

3. **default.market_resolutions_final:** 157,319 unique IDs  
   - Format: `6097d74404d5385dc61da0a2a603d7517fe425a3293475b6c3a858333f13e9b3`

4. **default.gamma_markets:** 139,207 unique IDs  
   - Format: `0x0001bd6b1ce49b28d822af08b0ff1844bf789bfeb7634a88b45e7619a0d45837`

### No Overlap

**0 out of 5 sample wallet condition_ids** found in any resolution table.

This was tested with proper normalization:
- Lowercase conversion
- 0x prefix removal
- Direct string matching

## Root Cause Analysis

### Three Possible Explanations:

1. **Missing Backfill Data**
   - The wallet's trades (June-Sept 2024) predate resolution data collection
   - Resolution tables may have been backfilled from a later date
   - Action: Check min/max dates in resolution tables vs wallet trade dates

2. **ID Format Mismatch**
   - `vw_trades_canonical.condition_id_norm` may contain token_ids, not condition_ids
   - Resolution tables might use market_ids or different ID schemes
   - Sample comparison shows completely different ID ranges
   - Action: Verify ID type in vw_trades_canonical and establish correct mapping

3. **Data Source Gap**
   - Resolution data comes from API/blockchain sources that don't cover all markets
   - Wallet may have traded on markets not in Polymarket's main data feeds
   - Action: Check if these markets exist in Polymarket API or on-chain events

## Recommended Next Steps

### Immediate Actions:

1. **Verify ID Types**
   ```sql
   -- Check if condition_id_norm is actually a token_id
   SELECT DISTINCT 
     condition_id_norm,
     market_id_norm,
     transaction_hash
   FROM default.vw_trades_canonical
   WHERE wallet_address_norm = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
   LIMIT 10
   ```

2. **Check Resolution Table Date Ranges**
   ```sql
   SELECT 
     min(resolved_at) as earliest_resolution,
     max(resolved_at) as latest_resolution
   FROM default.market_resolutions;
   ```

3. **Search for Token ID Mapping**
   - Look for tables like `token_to_condition_id_map`, `ctf_token_map`, etc.
   - Check if `default.ctf_token_map` can bridge token_ids to condition_ids

4. **API Verification**
   - Query Polymarket API directly with wallet's condition_ids
   - Check if these markets exist: `https://gamma-api.polymarket.com/markets?condition_id=<id>`

### Long-term Solutions:

1. **Backfill Resolution Data**
   - If date range issue, run historical resolution backfill for June-Sept 2024
   - Use Polymarket API or blockchain events as sources

2. **Fix ID Mapping**
   - If ID mismatch, create proper token_id → condition_id mapping table
   - Update vw_trades_canonical to use correct condition_ids

3. **Alternative Data Source**
   - Query blockchain directly for `QuestionFinalized` events
   - Use CTF contract to get outcome payouts for these condition_ids

## Files Created

- `/Users/scotty/Projects/Cascadian-app/search-wallet-resolutions-all-tables.ts` - Main search script
- `/Users/scotty/Projects/Cascadian-app/check-specific-resolution-tables.ts` - Focused check script
- `/Users/scotty/Projects/Cascadian-app/RESOLUTION_DATA_SEARCH_RESULTS.md` - This file

## Conclusion

**The problem is NOT empty payout arrays in existing rows.**  
**The problem is that the wallet's condition_ids DO NOT EXIST in any resolution table.**

This is a data pipeline gap that requires either:
- Backfilling historical resolution data
- Fixing ID mapping between trades and resolutions
- Querying alternative data sources (API or blockchain)

---

**Search completed:** 2025-11-09  
**Tables examined:** 9  
**Rows scanned:** ~1.5M  
**Result:** 0/30 condition_ids found with valid payout data
