# P&L Investigation: Next Steps Summary

**Date**: November 10, 2025
**Status**: Ready to execute Option B (API mapping build)

---

## Investigation Summary

### What We Accomplished ✅

1. **Identified Root Cause**: Token ID vs Condition ID mismatch
   - Trade data uses ERC-1155 token hashes (e.g., `9ff5bc5e...`)
   - Resolution data uses canonical condition IDs (e.g., `000294b1...`)

2. **Improved Global Coverage**: 0% → 11.88%
   - Updated P&L views to UNION both resolution sources
   - Applied ID normalization (lowercase + remove "0x")
   - Successfully resolved 1.7M out of 14.4M positions

3. **Discovered "Two Eras" Architecture**:
   - **Modern Era** (June 2024+): 11.88% coverage, IDs in `token_condition_market_map`
   - **Legacy Era** (Pre-June 2024): 0% coverage, IDs NOT in mapping table
   - Wallet 0x9155e8cf is a legacy wallet

4. **Verified Resolution Data Availability**:
   - 218,228 markets in `market_resolutions_final`
   - 132,912 markets in `resolutions_external_ingest`
   - **Total: 351,140 resolved markets** ready to use

---

## Current Blockers

### Wallet 0x9155e8cf (Test Wallet)

- **Trades**: 1,843,966 trades across 17,137 unique markets
- **Coverage**: 0% (0 resolved positions)
- **Expected P&L**: $110,440.13 (per Polymarket UI)
- **Actual P&L**: $0 (blocked by ID mismatch)

### Root Cause

None of the wallet's 17,137 condition IDs exist in:
- `cascadian_clean.token_condition_market_map` (only has modern era IDs)
- `default.api_markets_staging` (only has 161K markets, missing 144K)
- Any other existing mapping table

---

## Solution: Option B - Build Mapping from Polymarket API

### Phase 1: Build ID Mapping (Est. 30-60 min)

**Goal**: Create `default.legacy_token_condition_map` table with mappings for wallet 0x9155e8cf

**Steps**:
1. Extract wallet's 17,137 unique condition IDs
2. Query Polymarket CLOB API: `GET /markets?condition_id={id}`
3. For each market, store:
   - `token_id` (from trade data): `9ff5bc5e...`
   - `condition_id` (from API response): canonical condition ID
   - `market_slug`, `question` (for reference)
4. Insert into ClickHouse table

**API Rate Limits**:
- Polymarket API: ~100 requests/second
- Estimated time: 17,137 IDs / 100 per sec = ~3 minutes
- Plus processing time: ~30-60 min total

### Phase 2: Update P&L Views (Est. 15 min)

**Goal**: Modify `vw_wallet_pnl_calculated` to use the mapping

**Current Logic**:
```sql
FROM vw_trades_canonical t
LEFT JOIN (resolutions UNION ALL ...) r
  ON lower(replaceAll(t.condition_id_norm, '0x', '')) = lower(r.cid)
```

**New Logic**:
```sql
FROM vw_trades_canonical t
LEFT JOIN legacy_token_condition_map m
  ON lower(replaceAll(t.condition_id_norm, '0x', '')) = m.token_id
LEFT JOIN (resolutions UNION ALL ...) r
  ON COALESCE(m.condition_id, lower(replaceAll(t.condition_id_norm, '0x', ''))) = lower(r.cid)
```

This allows:
- Modern era trades: Direct join to resolutions (existing 11.88%)
- Legacy era trades: Map through `legacy_token_condition_map` first

### Phase 3: Verify & Test (Est. 15 min)

**Tests**:
1. Wallet 0x9155e8cf coverage: 0% → 50-60%
2. Wallet 0x9155e8cf P&L: $0 → $110,440.13 (approx)
3. Global coverage: 11.88% → 50-60%
4. Test 2-3 other legacy wallets for coverage improvement

---

## Files Created During Investigation

### Diagnostic Scripts
- `diagnose-join-mismatch.ts` - Found ID format mismatch
- `investigate-cid-format.ts` - Analyzed condition ID formats
- `calculate-actual-overlap.ts` - Measured table overlaps
- `debug-wallet-0x9155.ts` - Wallet-specific coverage analysis
- `diagnose-id-formats.ts` - Tested ID normalization strategies
- `find-real-mapping.ts` - Found 31% coverage with vw_trades_canonical
- `search-for-mapping-tables.ts` - Searched for existing mappings
- `verify-all-findings.ts` - Comprehensive verification

### Fix Scripts
- `fix-pnl-views-include-external-ingest.ts` - Added resolutions_external_ingest
- `fix-pnl-views-with-normalization.ts` - Applied ID normalization (achieved 11.88%)

### Documentation
- `PNL_INVESTIGATION_SUMMARY.md` - Full investigation report
- `PNL_INVESTIGATION_NEXT_STEPS.md` - This file

---

## Success Criteria

### Minimum Viable Success
- ✅ Wallet 0x9155e8cf coverage > 40%
- ✅ Wallet 0x9155e8cf P&L within 20% of expected ($88K-$132K)
- ✅ Global coverage > 40%

### Target Success
- 🎯 Wallet 0x9155e8cf coverage > 50%
- 🎯 Wallet 0x9155e8cf P&L within 10% of expected ($99K-$121K)
- 🎯 Global coverage > 50%

### Stretch Goals
- 🚀 Coverage > 60%
- 🚀 P&L accuracy within 5%
- 🚀 Support all legacy wallets (not just 0x9155e8cf)

---

## Risk Assessment

### Low Risk
- ✅ API is accessible and documented
- ✅ We have existing API client code (`lib/polymarket/client.ts`)
- ✅ P&L calculation logic already works (proven by 11.88% coverage)

### Medium Risk
- ⚠️ API rate limits (mitigated: batch requests, add delays)
- ⚠️ API might not return all condition IDs (fallback: use different endpoint)

### Known Issues
- ❌ Some markets might not be in API (archived/delisted)
- ❌ May need to handle different API response formats

---

## Next Immediate Action

**Execute**: Build the mapping script (`build-legacy-token-mapping.ts`)

**Command**:
```bash
npx tsx build-legacy-token-mapping.ts
```

**Expected Output**:
- CSV file with mappings
- ClickHouse table created
- Progress: "Mapped 17,137 / 17,137 condition IDs (100%)"

Then proceed to Phase 2: Update P&L views
