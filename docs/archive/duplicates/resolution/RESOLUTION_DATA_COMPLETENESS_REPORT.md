# Resolution Data Completeness Assessment

**Date:** November 10, 2025
**Assessment Duration:** 45 minutes
**Database:** ClickHouse Cloud (default database)
**Analyst:** Claude Code Agent

---

## Executive Summary

### The Bottom Line

**Current Resolution Coverage: 24.83%** (56,575 / 227,839 traded markets)
**Volume Coverage: 5.08%** ($1.48B / $29.16B)
**Status:** ❌ CRITICAL - Backfill required before P&L calculations

### Key Findings

1. ✅ **Resolution data exists** - 218,325 rows in `market_resolutions_final`
2. ❌ **Coverage is insufficient** - Only 24.83% of traded markets have resolutions
3. ⚠️  **Volume bias** - High-volume markets are severely under-represented (5% coverage)
4. ✅ **Data quality is good** - All resolution records have valid payout vectors
5. 🔄 **Multiple sources exist** - blockchain (74K), bridge_clob (77K), onchain (57K), gamma (6K)

---

## Detailed Findings

### 1. Resolution Table Inventory

| Table | Rows | Unique Markets | Quality |
|-------|------|---------------|---------|
| `market_resolutions_final` | 218,325 | 157,319 | ✅ 100% have winning_index |
| | | | ✅ 100% have payout vectors |
| `resolutions_external_ingest` | 132,912 | 132,912 | ✅ 100% valid (blockchain) |

**Key Insight:** `market_resolutions_final` is the consolidated resolution table, containing data from multiple sources.

### 2. Traded Markets Baseline

| Metric | Count |
|--------|-------|
| **Unique traded markets** | 227,839 |
| **Total trades** | 157,541,131 |
| **Total trading volume** | $29.16 billion |

**Data Source:** `vw_trades_canonical` (canonical trade view)

### 3. Coverage Analysis

#### Market Count Coverage

| Metric | Count | Percentage |
|--------|-------|------------|
| Total traded markets | 227,839 | 100% |
| Markets with resolutions | 56,575 | **24.83%** |
| Missing resolutions | 171,264 | **75.17%** |

#### Volume-Weighted Coverage

| Metric | Volume | Percentage |
|--------|--------|------------|
| Total trading volume | $29.16B | 100% |
| Volume with resolutions | $1.48B | **5.08%** |
| Missing volume | $27.68B | **94.92%** |

**Critical Finding:** Volume coverage (5.08%) is dramatically worse than market count coverage (24.83%), indicating that **large, high-volume markets disproportionately lack resolution data**.

### 4. Resolution Source Breakdown

| Source | Markets | Percentage | Notes |
|--------|---------|-----------|-------|
| bridge_clob | 77,097 | 49.0% | Bridge data from CLOB |
| blockchain | 74,216 | 47.2% | On-chain ConditionResolution events |
| onchain | 57,103 | 36.3% | On-chain data (alternative source) |
| gamma | 6,290 | 4.0% | Gamma API data |
| rollup | 3,195 | 2.0% | Rollup data |
| (empty) | 423 | 0.3% | Missing source attribution |
| ranked_onchain | 1 | 0.0% | Experimental source |

**Note:** Total exceeds 100% because `market_resolutions_final` contains 218K rows for 157K unique markets (some markets have multiple resolution records from different sources).

### 5. Source Overlap Analysis

**Comparison: market_resolutions_final vs resolutions_external_ingest**

| Metric | Count |
|--------|-------|
| MRF unique markets | 157,319 |
| REI unique markets | 132,912 |
| Overlap | 132,912 (100% of REI) |
| MRF only | 24,407 |
| REI only | 0 |

**Finding:** All blockchain resolution events in `resolutions_external_ingest` are already included in `market_resolutions_final`. The 24,407 additional markets in MRF come from other sources (bridge_clob, gamma, etc.).

### 6. Data Quality Assessment

**Sample of 10 random resolutions:**

✅ All samples have valid `payout_numerators` (e.g., `[1,0]` or `[0,1]`)
✅ All samples have valid `payout_denominator` (typically `1`)
✅ All samples have `winning_index` assigned
⚠️  Some samples missing `winning_outcome` text (empty string)
⚠️  Some samples have invalid `resolved_at` timestamps (1970-01-01)

**Conclusion:** Resolution data is structurally valid for P&L calculations, though metadata (outcome names, timestamps) has some gaps.

---

## Gap Analysis

### What Markets Are Missing?

**171,264 markets (75.17%) lack resolution data**

Based on previous analysis (see EXECUTIVE_SUMMARY_RESOLUTION_COVERAGE.md), these break down as:

| Age Category | Markets | % of Missing | Likely Status |
|-------------|---------|-------------|---------------|
| 90+ days old | ~71,000 | 41.5% | **Definitely resolved** (backfill priority) |
| 30-90 days old | ~60,000 | 35.1% | Likely resolved |
| <30 days old | ~40,000 | 23.4% | May still be open |

### Why Are They Missing?

Based on documentation review:

1. **API limitations** - Polymarket public API does NOT expose payout data
   - Confirmed via RESOLUTION_DATA_FINAL_STATUS.md
   - All API endpoints tested (gamma, CLOB) return `payout_numerators: null`

2. **Blockchain events only** - Current resolution data comes primarily from:
   - On-chain ConditionResolution events (132,912 markets)
   - Bridge/CLOB derived data (77,097 markets)
   - Some Gamma API metadata (6,290 markets)

3. **Markets never resolved** - Some percentage are genuinely unresolved
   - Long-term predictions (years)
   - Abandoned markets
   - Sports seasons in progress
   - Elections not yet held

---

## Data Source Investigation

### What We've Tried (Per Documentation)

According to RESOLUTION_DATA_FINAL_STATUS.md (Nov 9, 2025):

**✅ WORKS - Blockchain Resolution Events**
- Source: Polygon CTF contract `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`
- Method: `ConditionResolution` event logs
- Coverage: 132,912 events captured
- Status: COMPLETE (all historical events fetched)

**❌ DOES NOT WORK - Polymarket Public API**
- Endpoints tested:
  - `https://gamma-api.polymarket.com/markets?closed=true`
  - `https://gamma-api.polymarket.com/markets?active=false`
  - `https://clob.polymarket.com/markets`
- Finding: All return market metadata but `payout_numerators` is always NULL
- Result: Cannot backfill from public API

**⚠️ UNKNOWN - Private/Authenticated API**
- Polymarket UI shows resolution data, so it exists somewhere
- May require authentication or special access
- Not investigated (out of scope)

### Resolution Tables in Database

| Table | Purpose | Status |
|-------|---------|--------|
| `market_resolutions_final` | ✅ PRIMARY SOURCE | Consolidated resolutions from all sources |
| `resolutions_external_ingest` | ✅ ACTIVE | Blockchain ConditionResolution events |
| `api_markets_staging` | ⚠️ METADATA ONLY | Market info without resolutions |
| `gamma_markets` | ⚠️ METADATA ONLY | Market info without resolutions |
| `staging_resolutions_union` | ❓ UNCLEAR | 544,475 rows - needs investigation |
| `resolution_candidates` | ❓ UNCLEAR | 424,095 rows - needs investigation |

**Action Item:** Investigate `staging_resolutions_union` and `resolution_candidates` - these tables have more rows than `market_resolutions_final` and may contain additional resolution data.

---

## Impact on P&L Calculations

### Current State

**From previous analysis (see EXECUTIVE_SUMMARY_RESOLUTION_COVERAGE.md):**

- Total positions: 14,373,470
- Positions with resolutions: 1,708,058
- **Position-level coverage: 11.88%**

### Why Position Coverage (11.88%) < Market Coverage (24.83%)?

**Volume distribution matters:**
- Some wallets have MANY positions in unresolved markets
- Heavy traders concentrated in markets without resolutions
- When weighted by position count: 11.88%
- When weighted by market count: 24.83%
- When weighted by dollar volume: 5.08%

**Interpretation:** The largest, most actively traded markets are the ones missing resolution data.

---

## Recommendations

### Option A: Accept Current Reality ✅ RECOMMENDED (Short-term)

**Action:** Ship P&L feature with 24.83% coverage as baseline

**Rationale:**
- Many markets genuinely haven't resolved yet
- All available on-chain resolution data is already captured
- No public API exists for backfilling

**Implementation:**
```sql
-- Realized P&L (markets with resolutions)
SELECT
  wallet_address,
  sum(realized_pnl) as total_realized
FROM vw_wallet_pnl_calculated
WHERE payout_denominator > 0  -- Has resolution data
GROUP BY wallet_address

-- Unrealized P&L (use current market prices)
SELECT
  wallet_address,
  sum(shares * current_price - cost_basis) as unrealized_pnl
FROM positions p
LEFT JOIN market_candles_5m c ON p.condition_id = c.condition_id
WHERE p.payout_denominator IS NULL  -- No resolution yet
GROUP BY wallet_address
```

**User Experience:**
```
Wallet P&L Summary:
  Realized P&L:    $12,450  (from 1,234 resolved positions)
  Unrealized P&L:  $3,200   (from 8,756 open positions)
  Total Estimated: $15,650

Note: 24.8% of markets have resolved. Unrealized P&L based on current prices.
```

### Option B: Investigate Additional Tables 🔍 RECOMMENDED (Immediate)

**Action:** Examine `staging_resolutions_union` and `resolution_candidates`

**Queries to run:**
```sql
-- Check staging_resolutions_union coverage
WITH traded AS (
  SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
  FROM vw_trades_canonical
  WHERE condition_id_norm != ''
)
SELECT
  count(DISTINCT sru.condition_id) as sru_markets,
  count(DISTINCT t.cid) as traded_markets,
  count(DISTINCT CASE WHEN t.cid IS NOT NULL THEN sru.condition_id END) as overlap
FROM staging_resolutions_union sru
LEFT JOIN traded t ON lower(replaceAll(sru.condition_id, '0x', '')) = t.cid

-- Check resolution_candidates coverage
SELECT
  count(*) as total_rows,
  count(DISTINCT condition_id) as unique_markets,
  countIf(winning_index >= 0) as has_winner
FROM resolution_candidates
```

**Potential Impact:** If these tables contain additional valid resolutions for traded markets, coverage could jump from 24.83% to 40-60%.

### Option C: Unrealized P&L System 🔧 RECOMMENDED (Medium-term)

**Action:** Build comprehensive unrealized P&L calculation

**Data Source:** `market_candles_5m` (8M rows of price data)

**Benefits:**
- Provides complete P&L picture (realized + unrealized)
- Useful even when markets resolve (tracks real-time P&L)
- Already have the price data

**Effort:** Moderate (2-4 hours to implement and test)

### Option D: Manual High-Value Curation ❌ NOT RECOMMENDED

**Effort:** 10-20 hours
**Return:** Low (maybe 100-500 markets)
**Verdict:** Too much manual work for minimal coverage gain

### Option E: Wait for Market Resolutions ⏰ PARTIAL SOLUTION

**Reality Check:** Many markets are genuinely unresolved
- Sports seasons: months to years
- Elections: scheduled events
- Long-term predictions: years

**Action:** Continue monitoring blockchain for new ConditionResolution events

**Script:** `fetch-blockchain-payouts-optimized.ts` (already exists, per docs)

---

## Action Plan

### Immediate (Today)

1. **Investigate staging_resolutions_union and resolution_candidates** (30 min)
   ```bash
   npx tsx - << 'EOF'
   # Quick check script
   # See "Option B" queries above
   EOF
   ```

2. **Sample 100 missing markets manually** (15 min)
   - Pick 100 random markets from missing set
   - Check Polymarket UI: are they actually resolved?
   - Quantify: what % are truly unresolved vs missing data

3. **Review documentation conflicts** (15 min)
   - START_HERE_MARKET_RESOLUTIONS.md claims "100% coverage"
   - RESOLUTION_COVERAGE_DEFINITIVE_TRUTH.md shows 24.83%
   - Reconcile and mark outdated docs

### Short-term (This Week)

4. **Build unrealized P&L views** (2-4 hours)
   - Join positions with `market_candles_5m`
   - Calculate unrealized P&L using latest prices
   - Add to wallet P&L summary

5. **Add resolution monitoring** (1-2 hours)
   - Schedule daily blockchain event fetching
   - Alert when new resolutions detected
   - Auto-update `market_resolutions_final`

### Medium-term (This Month)

6. **Investigate private API access** (if needed)
   - Contact Polymarket about authenticated endpoint
   - Check if they expose payout data to partners
   - Explore TheGraph or other indexers

7. **Build resolution inference system** (4-8 hours)
   - Detect resolutions from redemption events
   - Infer outcomes from final price movements
   - Cross-validate with blockchain events
   - See: REDEMPTION_BASED_RESOLUTION_DETECTION.md

---

## Files Created

1. **assess-resolution-completeness.ts** - Initial assessment (failed due to schema mismatch)
2. **resolution-completeness-final.ts** ✅ - Working assessment script
3. **check-resolution-overlap.ts** ✅ - Source overlap and volume analysis
4. **RESOLUTION_DATA_COMPLETENESS_REPORT.md** (this file)

---

## Key Metrics Summary

| Metric | Value |
|--------|-------|
| **Traded Markets** | 227,839 |
| **Markets with Resolutions** | 56,575 (24.83%) |
| **Missing Resolutions** | 171,264 (75.17%) |
| **Total Volume** | $29.16B |
| **Resolved Volume** | $1.48B (5.08%) |
| **Resolution Sources** | 6 (blockchain, bridge_clob, onchain, gamma, rollup, other) |
| **Data Quality** | ✅ Good (100% have valid payout vectors) |
| **Metadata Quality** | ⚠️ Fair (some missing outcome names/timestamps) |

---

## Answers to Your Questions

### 1. Which is the canonical/authoritative source?

**Answer:** `market_resolutions_final` is the canonical source. It consolidates data from:
- Blockchain ConditionResolution events (132,912 markets)
- Bridge/CLOB derived data (77,097 markets)
- On-chain data via alternative pipelines (57,103 markets)
- Gamma API (6,290 markets)
- Other sources (rollup, etc.)

**Confidence:** HIGH - This table has the most comprehensive coverage and is actively maintained.

### 2. What % of traded markets have resolutions?

**Answer:** 24.83% (56,575 / 227,839 markets)

**But:** Volume-weighted coverage is only 5.08%, meaning large markets are missing.

**Confidence:** HIGH - Verified through direct SQL queries.

### 3. Are there gaps in recent months (unresolved markets)?

**Answer:** YES - 75% of markets lack resolution data.

**Breakdown (from documentation):**
- ~71,000 markets (90+ days old) - definitely should be resolved
- ~60,000 markets (30-90 days) - likely resolved
- ~40,000 markets (<30 days) - may still be open

**Confidence:** MEDIUM - Breakdown is estimated from previous analysis, needs verification.

### 4. Do we need MORE resolution data?

**Answer:** DEPENDS on your coverage target.

**If target = 25% coverage:** ✅ NO - Current data is sufficient
**If target = 50% coverage:** ⚠️  MAYBE - Check staging_resolutions_union first
**If target = 75% coverage:** ❌ YES - Need backfill or alternative sources
**If target = 95% coverage:** ❌ YES - Definitely need additional sources

**Next Steps:**
1. Check `staging_resolutions_union` and `resolution_candidates` (could add 15-40%)
2. If still insufficient, explore resolution inference from redemption events
3. Accept that some % are genuinely unresolved (markets still open)

### 5. Are APIs/sources still valid/accessible?

**Per RESOLUTION_DATA_FINAL_STATUS.md:**

✅ **Blockchain (ConditionResolution events)** - ACTIVE and COMPLETE
❌ **Polymarket Public API** - Does NOT expose payout data
✅ **Bridge/CLOB data** - Already captured (77K markets)
⚠️  **Gamma API** - Provides metadata, not resolutions (6K markets)
❓ **Private/Authenticated API** - Unknown, not investigated

**Recommendation:** Continue using blockchain as primary source. Investigate `staging_resolutions_union` for additional coverage.

---

## Conclusion

**Resolution data completeness: 24.83% (market count) or 5.08% (volume)**

This is **NOT sufficient** for comprehensive P&L calculations, but **IS sufficient** for:
- Demo/MVP with caveats
- Partial leaderboards (top wallets with resolved positions)
- Realized P&L tracking

**Recommended path forward:**

1. ✅ **Immediate:** Investigate staging_resolutions_union (30 min)
2. ✅ **Short-term:** Add unrealized P&L using market prices (2-4 hours)
3. ⚠️  **Medium-term:** Build resolution inference from redemptions (4-8 hours)
4. ⏰ **Ongoing:** Monitor blockchain for new resolutions (automated)

**Do NOT add to backfill checklist IF:** You accept 25% coverage + unrealized P&L
**DO add to backfill checklist IF:** You need 50%+ coverage for production

---

**Assessment Complete**
**Total Time:** 45 minutes
**Confidence Level:** HIGH (verified through direct database queries)
**Recommendation:** Check `staging_resolutions_union` first before deciding on backfill strategy
