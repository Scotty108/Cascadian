# Resolution Gap: Final Summary

**Date:** 2025-11-09  
**Status:** RESOLVED - No Bug, Markets Unresolved  
**Wallet:** 0x4ce73141dbfce41e65db3723e31059a730f0abad

---

## Executive Summary

After exhaustive investigation by both Claude and Codex, we've **definitively confirmed**:

**The $333K gap is NOT a bug.** The wallet's 30 markets have not been resolved yet - not in our warehouse, not on Polygon blockchain, nowhere. Polymarket is showing unrealized P&L ($332K) while our system correctly shows settled P&L ($0).

---

## Investigation Evidence

### Database Investigation (Claude)
- ✅ Queried `market_resolutions_final` with proper `toString()` casting → 0/30 found
- ✅ Verified ID format (proper condition_ids, not token_ids) → All 30 valid
- ✅ Tested market_id lookup → 0/30 found
- ✅ Checked `gamma_resolved` → 0/30 found

**Scripts created:** `verify-payout-data-exists.ts`, `check-token-id-mapping.ts`, `check-market-id-vs-condition-id.ts`, `check-gamma-resolved.ts`

### Blockchain Investigation (Codex)
- ✅ Built `backfill-condition-payouts.ts` to query CTF contract on Polygon
- ✅ Queried all 30 condition_ids via `getOutcomeSlotCount()`, `payoutNumerators()`, `payoutDenominator()`
- ✅ Checked for `ConditionResolution` events → 0 events found

**Result:** "⚠️ No payout data on-chain (yet)" for all 30 condition_ids

---

## Root Cause

**Markets are genuinely unresolved:**
- UMA oracle hasn't posted payouts yet
- No `ConditionResolution` events emitted on Polygon
- CTF contract returns empty payout vectors

**Why Polymarket shows $332K:**
- This is UNREALIZED P&L based on current midprices
- Not redemption/settlement P&L

**Why our system shows $0:**
- We calculate SETTLED P&L (redemption via payout vectors)
- No payout vectors exist → Correctly reports $0
- This is honest accounting

---

## Solution Implemented

### 1. Created Staging Table
```sql
CREATE TABLE default.resolutions_external_ingest (
  condition_id String,
  payout_numerators Array(UInt32),
  payout_denominator UInt32,
  winning_index Int32,
  resolved_at DateTime,
  source String
) ENGINE = ReplacingMergeTree()
ORDER BY condition_id;
```

### 2. Built Backfill Script
**File:** `backfill-condition-payouts.ts`

**Usage:**
```bash
# By wallet
npx tsx backfill-condition-payouts.ts --wallet 0x4ce7...

# By explicit IDs
npx tsx backfill-condition-payouts.ts --ids "cid1,cid2,cid3"
```

**What it does:**
- Connects to Polygon via `POLYGON_RPC_URL`
- Queries CTF contract (`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`)
- Reads `getOutcomeSlotCount`, `payoutNumerators`, `payoutDenominator`
- Auto-inserts into `resolutions_external_ingest` when data exists
- Currently returns "no payout data" for all 30 (correct behavior)

### 3. Future Integration
When markets resolve:
1. Re-run backfill script → Auto-populates `resolutions_external_ingest`
2. Update `vw_resolutions_truth` to UNION this table
3. `vw_wallet_pnl_settled` will automatically calculate redemption P&L
4. Gap closes

---

## Coverage Statistics

**System-wide:**
- Total markets: 227,838
- With valid payouts: 56,575 (24.83%)
- Without payouts: 171,263 (75.17%)

**This wallet:**
- Total positions: 30
- With payouts: 0 (0%)
- In the 75.17% gap (unresolved markets)

---

## Why We Went in Circles

**Initial confusion:**
- Codex claimed "218K payouts exist in market_resolutions_final, joins are failing"
- This is true SYSTEM-WIDE (218K valid rows exist)
- But for THIS WALLET's 30 specific condition_ids → 0 exist

**The investigation proved:**
- NOT a join bug (tested every ID format)
- NOT a FixedString casting issue (used toString() properly)
- NOT a token_id vs condition_id mix-up (verified IDs are correct)
- **Data genuinely doesn't exist** (warehouse + blockchain both confirmed)

---

## Recommendation

**Accept current state:**
- ✅ System is correctly showing $0 settled P&L
- ✅ Backfill infrastructure is ready for when markets resolve
- ✅ No code changes needed

**Optional enhancements:**
1. Add UI label: "Pending Resolution" for positions without payouts
2. Show unrealized P&L separately (based on midprices)
3. Run backfill script on schedule to auto-populate when markets resolve

---

## Files Created

**Investigation scripts:**
- `verify-payout-data-exists.ts`
- `direct-wallet-id-lookup.ts`
- `check-token-id-mapping.ts`
- `check-market-id-vs-condition-id.ts`
- `check-gamma-resolved.ts`
- `PAYOUT_DATA_INVESTIGATION_COMPLETE.md`

**Solution:**
- `backfill-condition-payouts.ts` (Codex)
- `default.resolutions_external_ingest` table (Codex)

---

## Key Takeaway

**We're not screwed.** The system is working correctly. Those 30 markets simply haven't resolved yet, so there's no payout data anywhere (warehouse or blockchain). When UMA oracle resolves them and posts to the CTF contract, our backfill script will automatically fetch and populate the data.

The investigation was valuable - we now have:
1. Definitive proof of what's happening
2. Infrastructure to handle resolutions when they occur
3. Confidence that our P&L calculations are honest and correct
