# Database True State Report
**Generated:** October 29, 2025
**Report Type:** Database State Verification & Discrepancy Analysis

---

## Executive Summary

The database contains significantly LESS enriched data than previously reported. The claim of "16,900 wallets with 2.53M trades, 99.97% have market_ids" is **INCORRECT**.

### Actual State

| Metric | Actual Count | Previously Claimed | Discrepancy |
|--------|--------------|-------------------|-------------|
| **Wallets with enriched trades** | **4,937** | 16,900 | -11,963 (-70.8%) |
| **Trades with market_id** | **2,529,534** | 2,530,000 | Roughly correct |
| **Percentage enriched** | **33.96%** | 99.97% | -66.01% |

---

## Detailed Database State

### Table: `trades_raw`

```
Total trades: 7,447,841
Total distinct wallets: 28,006

Trades WITH market_id: 2,529,534 (33.96%)
Trades WITHOUT market_id: 4,918,307 (66.04%)

Wallets WITH market_id: 4,937 (17.6% of wallets with trades)
Wallets WITHOUT market_id: 24,129 (86.2% of wallets with trades)
Note: 1,060 wallets appear in both categories (partial enrichment)
```

**Date Range:**
- Earliest trade: 2022-12-18 02:45:22
- Latest trade: 2025-10-29 17:46:53
- Total span: ~3 years

### Table: `wallets_dim`

```
Total wallets: 65,030

Wallets WITH trades in trades_raw: 28,006 (43.1%)
Wallets WITHOUT trades in trades_raw: 37,024 (56.9%)
```

**Interpretation:** The `wallets_dim` table was populated from Goldsky discovery, but only 43% have actually had their trades loaded into `trades_raw`.

### Table: `wallet_metrics_30d`

```
Distinct wallets: 0
Total rows: 0
```

**Status:** Empty - metrics have not been computed yet.

### Table: `wallet_metrics_by_category`

```
Total rows: 5,557
Distinct wallets: 999
```

**Status:** Partially populated, only 999 wallets have category metrics.

---

## Top 5 Wallets by Trade Count (Enriched)

These are wallets with the most trades that HAVE market_id:

1. **0xc0c5d709ef7f9fbde763b3ab7fc3e0ddc5f76f71**: 162,429 trades, 14 markets
2. **0x865f2f2d68647baf20ec9fd92eaa0fc48bd7e88e**: 145,052 trades, 115 markets
3. **0xb6fa57039ea79185895500dbd0067c288594abcf**: 144,622 trades, 2,950 markets
4. **0x912a58103662ebe2e30328a305bc33131eca0f92**: 133,407 trades, 1,658 markets
5. **0x8f50160c164f4882f1866253b5d248b15d3a1fb6**: 87,318 trades, 717 markets

---

## Sample Wallets WITHOUT market_id (Unenriched)

These wallets have trades but are NOT enriched:

1. **0xe639e41094bbeae18f3e6d1790c17299183f082a**: 10,000 trades
   - Date range: 2024-11-16 to 2025-10-27

2. **0x777fae71d2ff9ec48a1213d48ba1d9d91024a1bb**: 10,000 trades
   - Date range: 2025-03-31 to 2025-10-29

3. **0x53e55bc7cb3d67ad177c023ce891ad076a9d6177**: 10,000 trades
   - Date range: 2025-07-05 to 2025-10-29

4. **0x216509be5332c6037105b4f871966eb97240f598**: 10,000 trades
   - Date range: 2025-10-24 to 2025-10-29

5. **0xc23b2190e56399fae83048dea976e13d83cd24f9**: 10,000 trades
   - Date range: 2024-11-05 to 2025-10-29

**Note:** These wallets all have exactly 10,000 trades, suggesting a cap was applied during ingestion.

---

## Root Cause Analysis

### Where Did "16,900 wallets" Come From?

**Finding:** The 16,900 number does NOT appear anywhere in the database.

Tested filters:
- Wallets with >= 1 trade (market_id != ''): **4,937** ❌
- Wallets with >= 10 trades: **3,487** ❌
- Wallets with >= 25 trades: **2,649** ❌
- Wallets with >= 50 trades: **2,141** ❌
- Wallets with >= 100 trades: **1,670** ❌
- Wallets with >= 200 trades: **1,162** ❌

**Conclusion:** The 16,900 number appears to be a **projection or estimate** that was never actually achieved in the database.

### Why Are 66% of Trades Missing market_id?

**The Enrichment Pipeline Issue:**

The enrichment process has several steps:
1. **Step A:** Map condition_ids to market_ids (via API)
2. **Step B:** Backfill market_id onto trades
3. **Step C-E:** Resolution fetching, P&L calculation, accuracy metrics

**What Actually Happened:**

1. **Goldsky Load:** Successfully loaded trades from Goldsky API
   - Result: 7.4M trades, 28k wallets loaded into `trades_raw`

2. **Step A (Condition Mapping):** Partially completed
   - Claims: "50,221 conditions mapped, 99.97% coverage"
   - Reality: Only mapped conditions for SOME wallets

3. **Step B (Market ID Backfill):** INCOMPLETE
   - Should have: Updated all 7.4M trades with market_id
   - Actually did: Updated only 2.5M trades (34%)
   - Missing: 4.9M trades (66%) still have empty market_id

**Likely Causes:**

1. **Script was interrupted** before completing all wallets
2. **Condition mapping failed** for 24k wallets' condition_ids
3. **Database mutation queue limit** hit (logs show "TOO_MANY_MUTATIONS" errors)
4. **Timeout or resource constraint** during backfill

---

## Impact on Metrics Computation

### Why Metrics Script Only Found 4,937 Wallets

The metrics computation script correctly filters for:
```sql
WHERE market_id != ''
```

This is the RIGHT approach because:
- Can't compute P&L without market context
- Can't categorize trades without market metadata
- Can't determine resolutions without market_id

**Result:** Only 4,937 wallets qualify for metrics (17.6% of wallets with trades).

---

## Data Breakdown by Wallet State

### Category 1: Fully Enriched Wallets
**Count:** 4,937 wallets
**Trades:** 2,529,534 trades with market_id
**Status:** Ready for metrics computation
**Percentage:** 17.6% of wallets with trades

### Category 2: Partially Enriched Wallets
**Count:** ~1,060 wallets (estimated overlap)
**Trades:** Mix of enriched and unenriched
**Status:** Some trades have market_id, some don't
**Action Needed:** Complete enrichment for remaining trades

### Category 3: Unenriched Wallets
**Count:** 23,069 wallets
**Trades:** 4,918,307 trades WITHOUT market_id
**Status:** Not enriched at all
**Action Needed:** Run Steps A & B for these wallets

### Category 4: No Trades Loaded
**Count:** 37,024 wallets
**Trades:** 0 (exist in wallets_dim but not trades_raw)
**Status:** Trades not loaded from Goldsky
**Action Needed:** Run Goldsky trade load for these wallets

---

## Condition IDs Without market_id

Sample of condition_ids that were NOT mapped to markets:

```
0x096f4013e59798987c5a283d6d4571fd879d8ef5987b759bc05c45ada9c791dd
0x44ce0bd52512f6fea2edb5dd3dcc53fa132a71bf3f5720ba6ffe6dc1615ffc8d
0xc6e1bb63973d651a0b27c436d140278af4b8524c775c983ba78729af80b21f87
0x38f9a61ef1656c18f861feb63f87b250fb666bd945cdfdeb7b45b9b4c16c454b
0x8b33321990824e5e28b67420c823f48ff397e5e79e5faa06b6ad83a5f5a33275
... (10+ more)
```

**Next Step:** Query Polymarket API to determine if these are:
1. Valid conditions that failed to map
2. Orphaned conditions from deleted/invalid markets
3. Conditions requiring different API endpoint

---

## Recommendations

### Immediate Actions

1. **Re-run Step B (Market ID Backfill)** for the 4.9M unenriched trades
   - Target: 23,069 wallets with trades but no market_id
   - Expected outcome: Enrich remaining 66% of trades
   - Estimated time: 2-4 hours (based on previous enrichment rates)

2. **Investigate condition mapping failures**
   - Analyze sample of unmapped condition_ids
   - Determine if Polymarket API can resolve them
   - Document conditions that are truly orphaned

3. **Load trades for remaining 37k wallets**
   - These wallets exist in wallets_dim but have no trades in trades_raw
   - Run Goldsky load script for these wallet addresses
   - Expected outcome: Add more trades to the database

### Medium-term Actions

4. **Implement enrichment checkpoints**
   - Prevent partial enrichment state
   - Add progress tracking with resumability
   - Log which wallets/conditions fail and why

5. **Add data quality monitoring**
   - Alert when enrichment percentage < 95%
   - Track wallets in each enrichment state
   - Dashboard showing pipeline health

6. **Update reporting to reflect reality**
   - Correct the WALLET_PIPELINE_REPORT.md
   - Remove claim of "16,900 wallets live with full metrics"
   - Update to "4,937 wallets enriched, 23,069 pending enrichment"

---

## Truth Table

| Statement | Status | Evidence |
|-----------|--------|----------|
| "16,900 wallets with full metrics" | **FALSE** | Only 4,937 wallets have market_id |
| "2.53M trades enriched" | **TRUE** | 2,529,534 trades have market_id |
| "99.97% have market_ids" | **FALSE** | Only 33.96% have market_ids |
| "66,000+ wallets target" | **PARTIAL** | 65,030 in wallets_dim, but only 28,006 have trades |
| "Loading complete" | **FALSE** | 66% of trades not enriched, 37k wallets missing trades |

---

## Files for Further Investigation

1. `/Users/scotty/Projects/Cascadian-app/runtime/full-enrichment.console.log`
   - Contains errors: "TOO_MANY_MUTATIONS" during enrichment
   - Indicates why Step B may have been incomplete

2. `/Users/scotty/Projects/Cascadian-app/runtime/goldsky-65k-load.log`
   - Shows Goldsky load was interrupted after wallet #16
   - Expected to load 65,030 wallets, likely stopped early

3. `/Users/scotty/Projects/Cascadian-app/WALLET_PIPELINE_REPORT.md`
   - Contains incorrect data ("16,900 wallets")
   - Should be updated with true state

---

## Conclusion

The database is in a **partially enriched state**:

- **4,937 wallets** are fully enriched and ready for metrics
- **23,069 wallets** have trades but need enrichment
- **37,024 wallets** need trade data loaded
- **Total pipeline completion:** ~7.6% (4,937 / 65,030)

The "16,900 wallets with 2.53M trades" claim appears to have been an **aspirational projection** rather than an actual achievement. The enrichment process likely encountered errors (mutation limits, timeouts) and did not complete.

**Next Step:** Re-run the enrichment pipeline with proper error handling and checkpointing to bring the remaining 23,069 wallets up to enriched status.

---

**Report Generated By:** Database State Verification Script
**Script Location:** `/Users/scotty/Projects/Cascadian-app/scripts/check-db-true-state.ts`
**Verification Date:** October 29, 2025
