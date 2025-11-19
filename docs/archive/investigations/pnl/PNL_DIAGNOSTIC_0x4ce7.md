# P&L Diagnostic Report - Wallet 0x4ce7

## Executive Summary

**Wallet:** `0x4ce73141dbfce41e65db3723e31059a730f0abad`
**Polymarket API Shows:** $320.47 cash P&L (top 10 redeemable positions only)
**Our System Shows:** $0 (suspected issue)

**Resolution Data Status:** ✅ 157K conditions available (exceeds baseline)
**Problem Location:** Unknown - investigating trade matching, position aggregation, or P&L view joins

---

## Step 1: Resolution Coverage ✅ COMPLETE

**Results:**
- `market_resolutions_final`: 157,319 unique conditions
- `resolutions_external_ingest`: 8,685 conditions (98.3% overlap)
- **Total unique:** 157,463 conditions
- **Status:** EXCEEDS Dune Analytics baseline (130-150K)

**Conclusion:** Missing payout data is NOT the issue.

---

## Step 2: API Baseline - Top 5 Condition IDs

| Rank | Condition ID | Cash P&L | Outcome | Size (shares) |
|------|--------------|----------|---------|---------------|
| 1 | `a744830d0000a092e0151db9be472b5d79ab2f0a04aaba32fb92d6be49cbb521` | $112.85 | Yes (0) | 6,815.75 |
| 2 | `2923317435d66ebeb9647378734dd4f5c74633992309eefa19cbf3a6bff5b647` | $42.90 | Yes (0) | 173 |
| 3 | `5b101d490585239f971ef762218842b6e56c01ee1044e2a553a2a0e09ff1a204` | $42.90 | Yes (0) | 173 |
| 4 | `02f6db63e887e13e41c16246ca2d7c2d4c8bba5292cb3f82c1abc488ec3f5def` | $42.90 | Yes (0) | 173 |
| 5 | `1b82732ec6cfdd41beb8dbbe434a5e94c852bae6ecbf13118187bac4db7863cf` | $26.25 | Yes (0) | 2,624.65 |

**Total from top 5:** $267.80 cash P&L

---

## Step 3: Database Investigation (NEXT)

### Questions to Answer:

1. **Do we have trades for these 5 conditions in our database?**
   - Check `vw_trades_canonical` or equivalent
   - Expected: Should find trades matching these condition_ids

2. **Are condition_ids properly normalized (64-char lowercase hex)?**
   - Check for 0x prefix issues
   - Check for empty/zero IDs
   - Verify length consistency

3. **Do trades join to resolutions successfully?**
   - Query: trades LEFT JOIN vw_resolutions_truth
   - Check match rate
   - Identify unmatched conditions

4. **Are positions aggregated correctly from trades?**
   - Check `vw_positions_canonical` or equivalent
   - Verify FIFO cost basis calculation
   - Confirm share counts match API

5. **Do P&L views show correct values?**
   - Check `vw_wallet_pnl_settled` or equivalent
   - Compare calculated P&L vs API baseline
   - Identify where values drop to zero

---

## Next Actions

1. ✅ Run Step 1 (Resolution Coverage) - COMPLETE
2. ✅ Get API Baseline - COMPLETE
3. ⏭️  **Query database for top 5 conditions** - IN PROGRESS
4. ⏭️  Compare database P&L vs API for same conditions
5. ⏭️  Identify exact join/calculation where values are lost
6. ⏭️  Document root cause and fix

---

## Files Created

- `step1-verify-resolution-coverage.ts` - Resolution data verification
- `test-data-api-integration.ts` - API baseline (reused)
- `runtime/api-baseline.log` - API results for comparison
- `GOLDSKY_BACKFILL_FINDINGS.md` - Resolution coverage analysis
