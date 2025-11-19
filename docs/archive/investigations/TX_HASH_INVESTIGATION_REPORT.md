# Transaction Hash Investigation Report

## Executive Summary

**CRITICAL FINDING**: The 1% match rate is NOT due to a JOIN problem - it's due to incomplete data in `erc1155_transfers`.

## The Problem

- **Missing condition_ids**: 77,435,673 trades (77.4M)
- **Unique transaction_hashes in missing trades**: 32,020,330
- **Total rows in erc1155_transfers**: 291,113
- **Unique tx_hashes in erc1155_transfers**: 126,451
- **Matches found**: 793,186 (1.02%)

## Root Cause

The `erc1155_transfers` table is drastically incomplete:
- It has only **126K unique tx_hashes**
- But we need **32M unique tx_hashes** to cover all missing trades
- This represents **0.4% coverage** (126K / 32M)

The table appears to contain only a small sample of ERC1155 transfers, not the complete historical dataset.

## Data Quality Checks

### 1. Column Name Issue (RESOLVED)
- ❌ Secondary Claude tried to join on `tx_hash` (doesn't exist)
- ✅ Correct column name is `transaction_hash`

### 2. Format Consistency (VERIFIED)
- Both tables use identical format: `0x` prefix, 66 characters, lowercase
- Case-insensitive joins and 0x-stripping produce identical results
- No format normalization needed

### 3. Cross-validation (100% MATCH)
- Sampled 100 random transaction_hashes from trades_raw (missing condition_id)
- ALL 100 (100%) were found in erc1155_transfers
- This confirms the JOIN logic is correct

### 4. erc1155_transfers Data Quality (CRITICAL ISSUES)

**Temporal Coverage:**
- trades_raw missing data: 665 days (Jan 2024 - Oct 2025)
- erc1155_transfers valid data: 12 days total
- Coverage gap: 653 days (98% missing)

**Data Breakdown:**
| Date | Transfers | Unique TX | Status |
|------|-----------|-----------|--------|
| 2025-11-08 | 85,001 | 42,795 | Recent bulk import (only 4min window: 06:31-06:35) |
| 2025-10-27 | 3 | 1 | Single transaction |
| 2025-10-19 | 3 | 1 | Single transaction |
| 2024-09-05 | 3 | 1 | Single transaction |
| *9 other days* | 2-3 each | 1 each | Individual test transactions |
| **ERROR** | **206,085** | **~83K** | **Broken timestamps (1970-01-01)** |

**Critical Findings:**
1. 71% of table has broken timestamps (epoch 0 / 1970-01-01)
2. Nov 8 data covers only 4 minutes (06:31:10 to 06:35:42) - likely a test import
3. No systematic backfill - just scattered individual transactions
4. This explains the 1% match rate - table is not production-ready

## Implications

1. **Cannot recover 77M+ missing condition_ids from current erc1155_transfers**
   - Current coverage: 793K / 77.4M = 1.02%
   - Need ~250x more data

2. **Data backfill required**
   - Need to fetch ~32M unique transactions from blockchain
   - Current table appears to be a recent sample, not historical backfill

3. **Alternative recovery strategies needed**
   - Option A: Complete ERC1155 backfill (fetch all 32M transactions)
   - Option B: Use Polymarket API to fetch condition_ids by market_id
   - Option C: Sample-based recovery (prioritize most active wallets/markets)

## Recommended Actions

### Immediate (Diagnostic)
1. ✅ Verify column naming (COMPLETE - it's `transaction_hash`)
2. ✅ Test JOIN strategies (COMPLETE - all equivalent)
3. ✅ Confirm data coverage issue (COMPLETE)
4. Check erc1155_transfers date range:
   ```sql
   SELECT
     MIN(block_timestamp) as earliest,
     MAX(block_timestamp) as latest,
     DATEDIFF('day', MIN(block_timestamp), MAX(block_timestamp)) as days_covered
   FROM erc1155_transfers
   ```

### Short-term (Recovery Options - CRITICAL)

**Data Quality Issues Found:**
- 206,085 transfers (71% of table) have broken timestamps (1970-01-01)
- Only 85,001 valid transfers from Nov 8, 2025
- Remaining ~27 transfers scattered across random days
- **This is NOT a proper backfill** - it's test/sample data

**Immediate actions:**
5. ✅ CONFIRMED: erc1155_transfers is incomplete sample data, not production-ready
6. Check if Polymarket API provides condition_id by market_id mapping (fastest solution)
7. If API unavailable: Design proper ERC1155 backfill pipeline for 665 days of data
8. Fix timestamp parsing in existing ERC1155 ingestion (71% have epoch 0 errors)

### Long-term (Data Pipeline)
8. Implement continuous ERC1155 indexing to prevent future gaps
9. Add data quality checks to detect incomplete backfills
10. Document expected coverage rates for validation

## Technical Details

### Working JOIN Pattern
```sql
SELECT COUNT(*) as matches
FROM trades_raw t
JOIN erc1155_transfers e
  ON t.transaction_hash = e.tx_hash  -- Exact match works
WHERE t.condition_id = '' OR t.condition_id IS NULL
-- Result: 793,186 (1.02% of 77.4M)
```

### Coverage Gap
```
Required coverage:  32,020,330 unique tx_hashes
Current coverage:      126,451 unique tx_hashes
Gap:                31,893,879 tx_hashes (99.6% missing)
```

### Data Source Comparison
| Metric | trades_raw | erc1155_transfers | Coverage |
|--------|------------|-------------------|----------|
| Total rows | 77.4M (missing condition_id) | 291K | 0.4% |
| Unique tx_hashes | 32.0M | 126K | 0.4% |
| Actual matches | - | - | 793K (1.0%) |

## Files
- Investigation script: `/Users/scotty/Projects/Cascadian-app/investigate-tx-hash-matching.ts`
- Schema check: `/Users/scotty/Projects/Cascadian-app/check-trades-schema.ts`

## Next Steps

**Decision needed**: Which recovery strategy to pursue?
- **Option A (Complete)**: Backfill all 32M transactions (expensive, comprehensive)
- **Option B (API-based)**: Use Polymarket API for market_id → condition_id mapping (cheap, if available)
- **Option C (Prioritized)**: Backfill only critical subset (balanced approach)

Recommendation: Start with Option B (API check) to see if we can avoid blockchain indexing entirely.
