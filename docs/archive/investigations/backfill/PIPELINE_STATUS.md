# Cascadian Data Pipeline - Status Report

## Summary

Data pipeline implementation is **50% complete** with critical blockers identified:

### ✅ Completed Components

1. **ERC-1155 Event Flattening** (COMPLETE)
   - Source: Pre-decoded `erc1155_transfers` table
   - Table: `pm_erc1155_flats`
   - Records: 206,112 token transfer events
   - Status: ✅ Correct schema and data validation

2. **Proxy Wallet Mapping** (COMPLETE)
   - Source: ERC-1155 transfers (from/to addresses)
   - Table: `pm_user_proxy_wallets`
   - Mappings: 6 unique EOAs, 8 unique proxies
   - Known wallets: Both HolyMoses7 and niggemon identified
   - Status: ✅ Mapping correct and verified

3. **CLOB Fill Ingestion (Partial)**
   - Source: Polymarket CLOB API (`data-api.polymarket.com`)
   - Endpoint: `GET /trades?user={proxy}&limit=500`
   - Pagination: Timestamp-based (using `before={timestamp-1}`)
   - Raw data ingested: 1,321,500 fills (2,643 pages)
   - After deduplication: 1,000 unique fills
   - **Status: ⚠️ CRITICAL ISSUE - See below**

---

## Critical Issue: CLOB Data Quality

### Problem

**Pagination creates massive data duplication with 1320:1 raw-to-deduplicated ratio**

**Evidence:**
- HolyMoses7 checkpoint: 1,321,500 fills ingested → 1,000 unique fills after dedup
- This is physically impossible unless:
  1. Pagination is stuck returning the same 1,000 fills repeatedly
  2. There's a deduplication key collision issue
  3. The API is returning duplicates

### Root Cause Analysis

**Issue 1: Weak Fill ID Generation**
```typescript
// From scripts/ingest-clob-fills-backfill.ts:152
fill_id: fill.transactionHash || `${fill.conditionId}-${fill.timestamp}-${proxy}`
```

If Polymarket API doesn't return `transactionHash` (highly likely for CLOB fills), the composite key uses:
- `conditionId` (market identifier)
- `timestamp` (granularity: seconds)
- `proxy` (wallet address)

**Problem:** Multiple fills in the same second with same market/proxy create duplicate fill_ids, causing deduplication collisions.

**Issue 2: Timestamp-Based Pagination Loop**
```typescript
// Lines 106-108
if (oldestFill.timestamp) {
  hasMore = true;
  nextParams.before = String(oldestFill.timestamp - 1);
}
```

If many fills share the same Unix timestamp, reducing by 1 second might not advance pagination. The API could return the same 1,000 fills repeatedly.

### Impact on Acceptance Gates

**Target Requirements (Hard Gates - Exit Code 1 if failed):**
- HolyMoses7: ≥ 2,182 fills
- niggemon: ≥ 1,087 fills

**Current Status:**
- HolyMoses7: ~1,000 fills ❌ (SHORT BY 1,182)
- niggemon: ~500 fills ❌ (SHORT BY 587)

**Verdict:** ❌ GATES WILL FAIL

---

## What We Have Today

### Database Tables

| Table | Rows | Purpose | Status |
|-------|------|---------|--------|
| `pm_erc1155_flats` | 206,112 | Token transfers from blockchain | ✅ Complete & correct |
| `pm_user_proxy_wallets` | 6 | EOA → Proxy mappings | ✅ Complete & correct |
| `pm_trades` | ~1,306 | CLOB fills (deduplicated) | ⚠️ Incomplete - below targets |
| `market_candles_5m` | - | Price OHLC candles | ⏳ Ready but can't run (depends on fills) |

### Data Validation

**ERC-1155 Validation:** ✅
- 206,112 transfers successfully processed
- All amounts ≤ 1e18 (safety check passed)
- All addresses valid (0x-prefixed)

**Proxy Mapping Validation:** ✅
- 6 EOAs mapped to 8 distinct proxy wallets
- HolyMoses7: 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8 → 1 proxy
- niggemon: 0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0 → 1 proxy

**CLOB Fills Validation:** ⚠️
- Deduplication working (ReplacingMergeTree merge successful)
- Fill counts below acceptance threshold
- Pagination inefficiency creates 99.92% duplicate data

---

## Recommended Solutions

### Option A: Accept Current Data (Not Recommended)

Proceed with 1,000 unique fills and report gate failure. Users can:
1. Manually export fills from Polymarket UI
2. Implement alternative data source (e.g., Subgraph)
3. Contact Polymarket for historical data export

### Option B: Fix Pagination Algorithm (Recommended)

1. **Use transactionHash as primary dedup key**
   - Polymarket CLOB fills should have unique tx hashes
   - Better than composite key approach

2. **Implement bid-based pagination**
   - Some APIs support cursor-based pagination
   - Would eliminate timestamp collision issues

3. **Add duplicate detection loop**
   - Track last 100 fill IDs seen
   - If we see repeats 10 times, stop pagination
   - Would prevent infinite loops

4. **Implement API response validation**
   - Detect when API returns same fills twice
   - Log warnings and exit gracefully

### Option C: Alternative Data Sources

1. **Polygon Subgraph**
   - TheGraph has Polymarket CLOB events indexed
   - Better pagination support

2. **Polymarket Web Archive**
   - If they provide bulk export endpoints

3. **User-Uploaded Trade History**
   - Let users connect their wallet and export fills
   - Manually import required missing fills

---

## Next Steps

To unblock the pipeline:

1. **Investigate CLOB API behavior**
   - Test pagination with different parameters
   - Check if `transactionHash` is available in response
   - Verify timestamp granularity (is it actually seconds?)

2. **Fix ingest-clob-fills-backfill.ts**
   - Use tx hash if available, fall back to proper composite key
   - Implement duplicate detection to prevent loops
   - Add pagination method detection logging

3. **Re-run backfill**
   - Clear `pm_trades` table
   - Clear `.clob_checkpoints` directory
   - Run with fixed pagination logic

4. **Validate gates pass**
   - HolyMoses7 ≥ 2,182 fills
   - niggemon ≥ 1,087 fills

5. **Build market candles**
   - Once gates pass, run `scripts/build-market-candles.ts`
   - Creates `market_candles_5m` with VWAP pricing

6. **Compute portfolio P&L**
   - Join ERC-1155 net positions to CLOB fills
   - Calculate P&L per market per user

---

## Files Created

### New Scripts
- `scripts/flatten-erc1155-correct.ts` - Rebuild ERC-1155 flats from decoded source ✅
- `scripts/ingest-clob-fills-backfill.ts` - CLOB backfill with pagination (HAS BUGS) ⚠️
- `scripts/build-market-candles.ts` - 5-minute VWAP candles (READY) ✅
- `scripts/build-approval-proxies.ts` - Proxy mapping builder ✅

### Verification Scripts
- `verify-fills.ts` - Count fills and deduplication status ✅
- `dedupe-fills.ts` - Run OPTIMIZE TABLE for deduplication ✅
- `check-proxy-data.ts` - Verify proxy wallet mappings ✅

### Database Migrations
- `pm_erc1155_flats` - ReplacingMergeTree with (tx_hash, log_index) pk
- `pm_user_proxy_wallets` - ReplacingMergeTree with (proxy_wallet) pk
- `pm_trades` - ReplacingMergeTree with (fill_id) pk
- `market_candles_5m` - MergeTree with (market_id, bucket) order

---

## Timeline

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Initial setup | ✅ | Oct 27 | DB schema designed |
| ERC-1155 rebuild | ✅ | Nov 6 | 206,112 events loaded |
| Proxy mapping | ✅ | Nov 6 | 6 EOAs, 8 proxies mapped |
| CLOB backfill | ⚠️ | Nov 6 | Pagination issues identified |
| Data validation | ⏳ | Nov 6 | Blocked by CLOB data quality |
| Market candles | ⏳ | BLOCKED | Waiting for gate pass |
| Portfolio P&L | ⏳ | BLOCKED | Waiting for market candles |

---

## Assessment

**Overall: 50% Complete with Critical Blocker**

✅ **Strengths:**
- ERC-1155 pipeline is correct and complete
- Proxy wallet mapping works perfectly
- Data schema is sound and validated
- Market candle logic is ready to run

❌ **Blockers:**
- CLOB pagination creates 99%+ duplicate data
- Fill counts are 50% below acceptance targets
- Cannot pass hard gates without source data fix

**Estimated Fix Time:** 2-4 hours
- 30 min: API investigation
- 1-2 hours: Pagination algorithm fix
- 30 min: Re-run backfill
- 30 min: Validation and candle build

---

**Report Generated:** November 6, 2025
**Last Updated:** 20:05 UTC
