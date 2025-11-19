# P&L Reconciliation - Step 2: Data Completeness & Join Coverage Analysis

**Date:** 2025-11-06
**Snapshot:** 2025-10-31 23:59:59
**Status:** ❌ CRITICAL DATA QUALITY ISSUES IDENTIFIED

## Executive Summary

The analysis reveals **critical data quality issues** that prevent accurate P&L reconciliation:

- **Condition ID Coverage:** Only 48-49% of fills have populated condition_ids
- **Resolution Data Join Coverage:** 0-3.34% of fills can be matched to resolution data
- **Market ID Issues:** Sample missing fills show NULL or undefined market_ids
- **Overall Assessment:** **FAIL** - Coverage is <5%, far below the 95% target

## Target Wallets Analyzed

1. **HolyMoses7**: `0xa4b366ad22fc0d06f1e934ff468e8922431a87b8`
2. **niggemon**: `0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0`

## Detailed Results

### Wallet 1: HolyMoses7

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Total fills | 8,484 | - | - |
| Fills with condition_id | 4,131 (48.69%) | 95%+ | ❌ FAIL |
| Direct match to resolutions | 0 (0.00%) | 95%+ | ❌ FAIL |
| Bridge match via canonical | 0 (0.00%) | 95%+ | ❌ FAIL |
| Snapshot fills (Oct 31) | 8,484 (100%) | - | - |
| Snapshot coverage | 0 (0.00%) | 95%+ | ❌ FAIL |

**Sample Missing Fills:**
```
1. 2025-10-29 19:07:07 | Market: NULL | Condition: NULL | NO 529.77 @ 1.00
2. 2025-10-29 19:07:07 | Market: NULL | Condition: NULL | NO 9980.00 @ 1.00
3. 2025-10-29 18:00:27 | Market: NULL | Condition: NULL | NO 132.30 @ 1.00
4. 2025-10-29 18:00:27 | Market: NULL | Condition: NULL | NO 1294.69 @ 1.00
5. 2025-10-29 18:00:27 | Market: NULL | Condition: NULL | NO 2468.16 @ 1.00
```

### Wallet 2: niggemon

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Total fills | 16,472 | - | - |
| Fills with condition_id | 8,137 (49.40%) | 95%+ | ❌ FAIL |
| Direct match to resolutions | 550 (3.34%) | 95%+ | ❌ FAIL |
| Bridge match via canonical | 550 (3.34%) | 95%+ | ❌ FAIL |
| Snapshot fills (Oct 31) | 16,472 (100%) | - | - |
| Snapshot coverage | 550 (3.34%) | 95%+ | ❌ FAIL |

**Sample Missing Fills:**
```
1. 2025-10-31 05:00:31 | Market: NULL | Condition: 0x6271...61b5 | NO 436.67 @ 0.97
2. 2025-10-31 03:20:27 | Market: NULL | Condition: 0x6271...61b5 | NO 200.00 @ 0.97
3. 2025-10-30 22:53:47 | Market: NULL | Condition: 0x6271...61b5 | NO 1821.33 @ 0.97
4. 2025-10-30 19:00:27 | Market: NULL | Condition: 0xf508...0c24 | NO 100.00 @ 0.04
5. 2025-10-30 19:00:27 | Market: NULL | Condition: NULL | NO 96.00 @ 1.00
```

## Step-by-Step Analysis

### Step 2A: Condition ID Completeness
**Test:** Count fills with non-empty condition_id in `trades_raw`

- **HolyMoses7:** 4,131 / 8,484 = 48.69% ❌
- **niggemon:** 8,137 / 16,472 = 49.40% ❌

**Finding:** Only ~49% of fills have condition_ids populated. This indicates:
1. Historical data may be missing condition_ids
2. Data pipeline may not be enriching all trades
3. Some trades may predate condition_id tracking

### Step 2B: Direct Join Coverage to market_resolutions_final
**Test:** Join `trades_raw.condition_id` → `market_resolutions_final.condition_id_norm`

- **HolyMoses7:** 0 / 8,484 = 0.00% ❌
- **niggemon:** 550 / 16,472 = 3.34% ❌

**Finding:** Even when condition_ids exist, they rarely match resolution data. This suggests:
1. Markets have not been resolved yet
2. Resolution data is incomplete
3. Condition_id normalization mismatch

### Step 2C: Market Bridge Join Coverage
**Test:** Use `canonical_condition` as bridge: `trades_raw.market_id` → `canonical_condition.market_id` → `market_resolutions_final.condition_id_norm`

- **HolyMoses7:** 0 / 8,484 = 0.00% (no improvement) ❌
- **niggemon:** 550 / 16,472 = 3.34% (no improvement) ❌

**Finding:** The canonical_condition bridge provides **zero improvement**. This indicates:
1. market_id values in trades_raw are NULL or don't match canonical_condition
2. canonical_condition table may be incomplete

### Step 2D: Snapshot Filtering
**Test:** Apply timestamp filter `<= 2025-10-31 23:59:59` and recount coverage

- **HolyMoses7:** All 8,484 fills are before snapshot (100%)
  - Coverage at snapshot: 0 (0.00%) ❌
- **niggemon:** All 16,472 fills are before snapshot (100%)
  - Coverage at snapshot: 550 (3.34%) ❌

**Finding:** The snapshot date is in the future (Oct 31, 2025), so all trades qualify. Coverage remains critically low.

## Root Cause Analysis

### Primary Issues

1. **Missing condition_ids (51% of fills)**
   - Half of all fills lack condition_id data
   - Cannot join to resolution tables without condition_id
   - May be historical data or pipeline gap

2. **Missing market_ids**
   - Sample fills show "Market: undefined"
   - Prevents use of canonical_condition bridge
   - Critical for fallback resolution lookups

3. **Incomplete resolution data**
   - `market_resolutions_final` has 224K rows
   - But only matches 0-3% of trades
   - Either markets are unresolved or condition_ids don't match

### Data Architecture Issues

| Table | Rows | Join Key | Coverage |
|-------|------|----------|----------|
| `trades_raw` | ~25K (2 wallets) | condition_id, market_id | Source |
| `canonical_condition` | 152K | condition_id_norm | ? |
| `market_resolutions_final` | 224K | condition_id_norm | 0-3.34% |
| `winning_index` | 137K | condition_id_norm | Not tested |

**Gap:** The `canonical_condition` → `market_resolutions_final` join only covers 2,991 conditions (2% overlap).

## Recommendations

### Immediate Actions

1. **Fix trades_raw data quality**
   ```sql
   -- Investigate missing market_ids
   SELECT
     count(*) as total,
     countIf(market_id IS NULL OR market_id = '') as missing_market_id,
     countIf(condition_id IS NULL OR condition_id = '') as missing_condition_id
   FROM trades_raw
   WHERE wallet_address IN (
     '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
     '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
   );
   ```

2. **Backfill missing identifiers**
   - Use Polymarket API to fetch market_id and condition_id for historical trades
   - Cross-reference with ERC1155 transfers to derive condition_ids
   - Validate against transaction hashes

3. **Expand resolution data coverage**
   - Sync more markets into `market_resolutions_final`
   - Check if unresolved markets need to be excluded from P&L
   - Verify condition_id normalization is consistent

### Alternative Approaches

Since direct condition_id joins fail, consider:

1. **Use transaction hash lookups**
   - Join via `transaction_hash` to ERC1155 transfers
   - Derive condition_id from token_id

2. **Fallback to market-level attribution**
   - If exact outcome unknown, use market-level data
   - Mark as "unresolved" with realized PNL only

3. **Exclude unresolved positions**
   - For snapshot P&L, only include resolved positions
   - Document unrealized P&L separately

## Next Steps

**STOP P&L reconciliation until data quality is fixed.**

Required actions before Step 3:
1. ✅ Complete this analysis (done)
2. ❌ Fix missing market_ids in trades_raw
3. ❌ Backfill missing condition_ids
4. ❌ Verify resolution data coverage
5. ❌ Re-run this analysis and confirm >95% coverage

## Technical Notes

### ClickHouse FixedString Gotcha
`market_resolutions_final.condition_id_norm` is `FixedString(64)`. When LEFT JOIN returns no match, the field contains 64 null bytes (`\0`), not SQL NULL. Must check with:
```sql
-- Wrong (always true)
if(mrf.condition_id_norm IS NOT NULL, 1, 0)

-- Correct
if(replaceAll(mrf.condition_id_norm, '\0', '') != '', 1, 0)
```

### Query Used
See `/Users/scotty/Projects/Cascadian-app/scripts/verify-pnl-coverage.ts` for full query logic.

---

**Analysis Script:** `/Users/scotty/Projects/Cascadian-app/scripts/verify-pnl-coverage.ts`
**Generated:** 2025-11-06 by Claude Code
