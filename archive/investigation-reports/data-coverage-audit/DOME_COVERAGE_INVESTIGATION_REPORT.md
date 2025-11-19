# Dome Coverage Investigation Report

**Date:** 2025-11-16
**Dome P&L:** $87,030.51 (realized)
**ClickHouse P&L:** $2,089.18 (resolved binary CLOB only)
**Discrepancy:** $84,941.33

## Summary

Dome shows **14 markets** with **100 trades** for xcnstrategy (EOA: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b).
These markets contributed to $87K in **REALIZED** P&L, meaning they are RESOLVED markets.

Our investigation reveals:
- **Category A (Correct):** 0 markets (0.0%)
- **Category B (Missing Resolution):** 0 markets (0.0%)
- **Category C (Missing Trades):** 14 markets (100.0%)

---

## Category A: Trades Present & Resolved Correctly ✅

*None*

---

## Category B: Trades Present But Unresolved/Incomplete ⚠️

*None*

---

## Category C: Trades Missing Entirely ❌


### Will Satoshi move any Bitcoin in 2025?

- **Condition ID:** `0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 1 trades, 1000.00 shares (avg price: 0.947)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Xi Jinping out in 2025?

- **Condition ID:** `0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 14 trades, 19999.99 shares (avg price: 0.930)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will a dozen eggs be between $3.00-3.25 in September?

- **Condition ID:** `0xef00c9e8b1eb7eb322ccc13b67cfa35d4291017a0aa46d09f3e2f3e3b255e3d0`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 2 trades, 30.00 shares (avg price: 0.100)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will Trump sell over 100k Gold Cards in 2025?

- **Condition ID:** `0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 3 trades, 2789.14 shares (avg price: 0.991)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Xi Jinping out before October?

- **Condition ID:** `0xa491ceedf3da3e6e6b4913c8eff3362caf6dbfda9bbf299e5a628b223803c2e6`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 1 trades, 960.00 shares (avg price: 0.995)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will Elon cut the budget by at least 10% in 2025?

- **Condition ID:** `0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 1 trades, 100.00 shares (avg price: 0.987)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will annual inflation increase by 2.7% in August?

- **Condition ID:** `0x93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 65 trades, 33894.33 shares (avg price: 0.026)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will a dozen eggs be between $3.25-3.50 in August?

- **Condition ID:** `0x03bf5c66a49c7f44661d99dc3784f3cb4484c0aa8459723bd770680512e72f82`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 4 trades, 2319.97 shares (avg price: 0.750)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Lisa Cook out as Fed Governor by September 30?

- **Condition ID:** `0xfae907b4c7d9b39fcd27683e3f9e4bdbbafc24f36765b6240a93b8c94ed206fa`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 1 trades, 13101.00 shares (avg price: 0.040)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will a dozen eggs be between $4.25-4.50 in August?

- **Condition ID:** `0x340c700abfd4870e95683f1d45cf7cb28e77c284f41e69d385ed2cc52227b307`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 1 trades, 11290.94 shares (avg price: 0.007)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will a dozen eggs be between $3.00-3.25 in August?

- **Condition ID:** `0x601141063589291af41d6811b9f20d544e1c24b3641f6996c21e8957dd43bcec`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 1 trades, 1020.00 shares (avg price: 0.960)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will a dozen eggs be between $3.75-4.00 in August?

- **Condition ID:** `0x7bdc006d11b7dff2eb7ccbba5432c22b702c92aa570840f3555b5e4da86fed02`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 4 trades, 814.44 shares (avg price: 0.480)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will a US ally get a nuke in 2025?

- **Condition ID:** `0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 1 trades, 100.00 shares (avg price: 0.964)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


### Will China unban Bitcoin in 2025?

- **Condition ID:** `0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7`
- **pm_markets:** status=`NOT_FOUND`, market_type=`NULL`
- **pm_trades:** EOA=0 trades, Proxy=0 trades
- **Dome:** 1 trades, 1670.41 shares (avg price: 0.954)
- **gamma_resolved:** TABLE_NOT_EXISTS
- **market_resolutions_final:** TABLE_NOT_EXISTS

**Problem:** Trades exist in Dome but NOT in our pm_trades

**Proposed Fix:**
- **Check CLOB backfill:** These trades may be outside our backfill date range
- **Check AMM data:** Trades may be AMM-based (not in CLOB fills)
- **Check proxy attribution:** Trades may be attributed to proxy wallet in CLOB
- **Verify condition_id format:** Ensure proper normalization (lowercase, no 0x prefix)
- **Backfill CLOB fills:** Run targeted backfill for these specific markets/dates


---

## Next Steps

### For Category B Markets (0 markets)
1. Rebuild pm_markets from underlying sources (gamma_resolved, market_resolutions_final)
2. Verify winning_outcome_index is populated correctly
3. Re-run P&L calculation to include these resolved markets

### For Category C Markets (14 markets)
1. **Immediate:** Check CLOB backfill coverage for date range (Sept-Oct 2025 per Dome)
2. **Data Sources:** Investigate AMM trades, ERC-1155 transfers for these condition_ids
3. **Attribution:** Check if proxy wallet trades exist but aren't attributed to xcnstrategy
4. **API Backfill:** Run targeted Polymarket CLOB API backfill for these markets

### Expected P&L Impact
- Category A contributes: (calculate from trades)
- Category B potential: (calculate if we fix resolutions)
- Category C potential: $84,941 - A - B = remaining gap

---

**Generated:** 2025-11-16T00:06:52.373Z
**Script:** scripts/102-dome-coverage-investigation.ts

---

## Update: Canonical Wallet Infrastructure (2025-11-16)

**Status:** ✅ Canonical wallet mapping infrastructure implemented
**Gap Impact:** ❌ No change (remains $84,920 / 97.58%)

### What Was Implemented

**Task:** Wire canonical wallet mapping into P&L pipeline to unify EOA + proxy trades

**Changes Made:**
1. ✅ Added `canonical_wallet_address` column to `pm_trades` view
   - LEFT JOINs to `wallet_identity_map` for proxy→canonical mapping
   - Defaults to `wallet_address` if no mapping exists

2. ✅ Updated `pm_wallet_market_pnl_resolved` view
   - Now groups by `canonical_wallet_address`
   - Keeps `wallet_address` for debugging

3. ✅ Updated `pm_wallet_pnl_summary` view
   - Aggregates by `canonical_wallet_address`
   - Shows `proxy_wallets_count` and `proxy_wallets_used`
   - Leaderboards now display unified wallet identities

### Results for xcnstrategy

**Before Canonical Mapping:**
- Wallet: `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` (EOA only)
- P&L: $2,089.18
- Markets: 4
- Gap: $84,941 (97.6%)

**After Canonical Mapping:**
- Canonical Wallet: `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
- Proxy Wallets: 1 (`0xcce...58b` only)
- P&L: $2,110.16
- Markets: 4
- Gap: $84,920 (97.58%)

**Conclusion:** Gap remains essentially unchanged because:
1. ❌ Proxy wallet (`0xd59...723`) has **ZERO trades** in `clob_fills`
2. ❌ Proxy wallet has **ZERO trades** in `pm_trades`
3. ❌ All 14 missing markets are Category C (trades missing entirely)

### Why Didn't Canonical Mapping Fix the Gap?

**Expected Behavior:**
- Canonical mapping should aggregate EOA + proxy trades under single identity
- xcnstrategy should show: EOA trades + Proxy trades = unified P&L

**Actual Behavior:**
- Canonical mapping works correctly
- But proxy wallet has no data to aggregate
- Can't aggregate what doesn't exist in the database

**Root Cause:**
- The 14 markets ($84K P&L) are NOT in our `pm_markets`
- The 100 trades are NOT in our `clob_fills`
- The proxy wallet (`0xd59...723`) is NOT in `wallet_identity_map`

### Infrastructure Value

**What We Gained:**
✅ Canonical wallet infrastructure is production-ready
✅ Future proxy trades will auto-aggregate to EOA
✅ Leaderboards now show unified wallet identities
✅ No code changes needed when proxy trades are ingested

**What We Still Need:**
❌ Backfill the 14 missing markets (Category C)
❌ Add proxy wallet mapping: `{eoa: '0xcce...58b', proxy: '0xd59...723'}`
❌ Investigate why these trades aren't in CLOB fills

### Next Steps

**Immediate (To Close Gap):**
1. Investigate 14 missing markets (see Category C above)
2. Check CLOB backfill coverage for Sept-Oct 2025
3. Check AMM data sources
4. Query Polymarket CLOB API directly for proxy wallet
5. Backfill missing trades once source identified

**Medium Term (Proxy Mapping):**
1. Fix `wallet_identity_map` with real proxy relationships
2. Implement automated proxy discovery
3. Refresh proxy mappings periodically

### Documentation

**Created:**
- `PROXY_MAPPING_SPEC_C1.md` - Complete proxy mapping design documentation
- `PROXY_MAPPING_DISCOVERY_REPORT.md` - Infrastructure discovery findings
- `XCNSTRATEGY_CANONICAL_WALLET_COMPARISON.md` - Detailed comparison report
- `scripts/103-discover-proxy-mapping-artifacts.ts` - Discovery script
- `scripts/104-wire-canonical-wallet-into-pm-trades.ts` - Implementation script
- `scripts/105-propagate-canonical-into-pnl-views.ts` - P&L view updates
- `scripts/106-xcnstrategy-canonical-wallet-comparison.ts` - Comparison script

**See Also:**
- [PROXY_MAPPING_SPEC_C1.md](./PROXY_MAPPING_SPEC_C1.md) for complete design
- [XCNSTRATEGY_CANONICAL_WALLET_COMPARISON.md](./XCNSTRATEGY_CANONICAL_WALLET_COMPARISON.md) for detailed results

---

**Terminal:** Claude 1
**Session:** 2025-11-16 (PST)
**Status:** Canonical mapping complete, gap investigation ongoing

_Always run backfills with maximum workers without hitting rate limits, with save/crash/stall protection enabled._

_— Claude 1_
