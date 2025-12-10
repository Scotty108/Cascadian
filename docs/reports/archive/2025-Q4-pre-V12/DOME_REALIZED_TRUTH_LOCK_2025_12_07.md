# Dome Realized PnL Truth Lock

**Date:** 2025-12-07  
**Terminal:** Claude 1  
**Status:** ⚠️ CRITICAL FINDINGS - Dome has incomplete coverage

---

## Executive Summary

Successfully integrated Dome API for realized PnL validation, but discovered **critical limitation**: Many high-activity wallets return $0 realized PnL from Dome, indicating incomplete data coverage.

**Key Finding:** Dome is **NOT suitable as sole ground truth** for realized PnL validation due to data gaps.

---

## Dome API Definition

### Extraction Rule

**Endpoint:** `GET /v1/polymarket/wallet/pnl/{wallet}?granularity=all`

**Response Structure:**
```json
{
  "wallet_addr": "0x...",
  "granularity": "all",
  "start_time": <unix_timestamp>,
  "end_time": <unix_timestamp>,
  "pnl_over_time": [
    {
      "timestamp": <unix_timestamp>,
      "pnl_to_date": <number>
    }
  ]
}
```

**Extraction Logic:**
- Take the **last entry** in `pnl_over_time[]` array
- Extract `pnl_to_date` as realized PnL
- This value represents **cumulative realized PnL** from all closed positions

### Scope

Per Dome documentation:
> "This endpoint tracks realized gains from confirmed sells or market redemptions, not unrealized PnL like Polymarket's dashboard displays."

**Confirmed:** Dome's `pnl_to_date` measures **realized-only** PnL (excludes open positions).

---

## Critical Findings: Data Coverage Gaps

### Test Cohorts

**Small Cohort** (20 wallets from TRADER_STRICT):
- ✅ 100% success rate
- File: `tmp/dome_realized_small_20_2025_12_07.json`
- Sample values: -$26,875, $444, -$18, $42,104, etc.
- **All wallets returned valid data**

**Big Cohort** (20 worst divergent wallets from V23C vs V29):
- ✅ 100% success rate
- File: `tmp/dome_realized_big_20_2025_12_07.json`
- **⚠️ 15/20 wallets (75%) returned $0.00 realized PnL**
- Only 3 wallets had non-zero values:
  - `0xd69be738...`: -$252,768 ✅
  - `0xdf933b45...`: -$26,876 ✅
  - `0x7724f6f8...`: -$5.38 ✅

### Evidence of Incomplete Coverage

Top divergent wallets that Dome reports as $0:
- `0xdfda01f4...`: Dome=$0 | V23C=$194,703 | V29=$95,968 ❌
- `0x688bea86...`: Dome=$0 | V23C=$47,025 | V29=$1,951 ❌
- `0xa6f70071...`: Dome=$0 | V23C=$33,589 | V29=$2,611 ❌
- `0x4d6d6f05...`: Dome=$0 | V23C=$31,882 | V29=$10,725 ❌

**Pattern:** Wallets with largest V23C/V29 discrepancies have **no Dome data**.

---

## Root Cause Analysis

### Hypothesis: Dome Data Pipeline Lags

Dome's API response includes `start_time` and `end_time` fields:

**Wallets with $0 realized PnL:**
- start_time: `1609459200` (2021-01-01 00:00:00 UTC)
- end_time: `1765069925` (2025-12-07 01:12:05 UTC)

**Wallets with valid data:**
- start_time: `1738825908` (recent activity)
- end_time: `1765069926` (current)

**Interpretation:**
- Dome returns default/placeholder values for wallets without processed data
- `start_time=2021-01-01` suggests Dome hasn't ingested these wallet's trades
- Possible reasons:
  1. Dome only processes wallets above volume threshold
  2. Dome backfill incomplete for older wallets
  3. Dome excludes certain market types or contracts

---

## Implications for Validation

### ❌ Dome Cannot Be Sole Truth Source

**Reason:** 75% of high-divergence wallets have no Dome data.

Using Dome as ground truth would:
1. **Exclude most problematic wallets** from validation
2. **Hide V29 accuracy issues** on wallets that matter most
3. **Create false confidence** in engine accuracy

### ✅ Dome Can Supplement UI Truth

**Recommended Use:**
- Use Dome for wallets that **have non-zero realized PnL**
- Combine with UI scraping for comprehensive coverage
- Flag wallets where Dome=$0 but V29≠$0 for investigation

---

## Truth Hierarchy (Revised)

**For Phase 1 Realized PnL Validation:**

1. **Primary Truth:** Polymarket UI Profile PnL (via `fetch-polymarket-profile-pnl.ts`)
   - Pros: Complete coverage, matches user-visible values
   - Cons: Includes unrealized, requires web scraping

2. **Secondary Truth:** Dome API `pnl_to_date` (via `fetch-dome-realized-pnl.ts`)
   - Pros: Clean API, realized-only, fast
   - Cons: Incomplete coverage (75% gaps for high-divergence wallets)

3. **Tertiary Truth:** V23C Shadow Ledger
   - Pros: Full ClickHouse coverage
   - Cons: May have UI oracle staleness issues

**Strategy:** Use UI PnL as ground truth, cross-validate with Dome where available.

---

## Snapshot Files

**Small Cohort (20 wallets):**
- Input: `tmp/dome_small_20.json`
- Output: `tmp/dome_realized_small_20_2025_12_07.json`
- Stats: 20/20 wallets with valid data

**Big Cohort (20 worst divergent wallets):**
- Input: `tmp/dome_big_20.json`
- Output: `tmp/dome_realized_big_20_2025_12_07.json`
- Stats: 5/20 wallets with valid data, 15/20 = $0.00

---

## Implementation Status

### ✅ Complete

1. **Dome Client:** `lib/pnl/domeClient.ts`
   - Endpoint: `/v1/polymarket/wallet/pnl/{wallet}?granularity=all`
   - Extraction: Last `pnl_over_time[].pnl_to_date`
   - Caching: In-memory per session
   - Security: Reads `DOME_API_KEY` from env only

2. **Fetch Script:** `scripts/pnl/fetch-dome-realized-pnl.ts`
   - Single wallet: `--wallet=0x...`
   - Batch mode: `--wallets-file` + `--limit` + `--concurrency`
   - Output: JSON snapshot with metadata

3. **Test Results:**
   - Small cohort: 100% success (20/20)
   - Big cohort: 100% API success, 25% data coverage (5/20 non-zero)

### 🚧 Recommendations for Terminal 2

**DO NOT rely on Dome alone for realized PnL validation.**

Instead:
1. Use UI PnL snapshot from Terminal 1 (`tmp/ui_pnl_live_snapshot_2025_12_07.json`)
2. Cross-reference Dome data where available
3. Flag wallets with Dome=$0 as "incomplete coverage"
4. Focus V29 accuracy investigation on wallets with **both** UI and Dome data

---

## Conclusion

**Truth Lock Statement:**

> For Phase 1 realized PnL validation, we treat **Polymarket UI Profile PnL** as primary ground truth, with Dome API `pnl_to_date` as supplementary validation where coverage exists. Dome's incomplete data coverage (75% gaps for high-divergence wallets) prevents it from serving as sole truth source.

**Data Quality Alert:**
- Dome API is production-ready for technical integration
- Dome data is **incomplete** for validation purposes
- UI scraping remains necessary for comprehensive validation

---

**Generated:** 2025-12-07T01:15 UTC  
**Terminal:** Claude 1  
**Files:**
- `tmp/dome_realized_small_20_2025_12_07.json`
- `tmp/dome_realized_big_20_2025_12_07.json`
- `lib/pnl/domeClient.ts`
- `scripts/pnl/fetch-dome-realized-pnl.ts`
