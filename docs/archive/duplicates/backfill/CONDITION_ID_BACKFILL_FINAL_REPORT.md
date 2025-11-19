# Condition ID Backfill Investigation - Final Report

**Date:** 2025-11-07
**Objective:** Determine if 77.4M missing condition_ids can be populated using metadata joins (avoiding blockchain scanning)

---

## Executive Summary

**FEASIBILITY: NO** - Metadata-only approach is NOT viable for the full 77.4M rows.

**Recovery Rate: 0.13%** (only ~100K of 77.4M trades can be recovered via current metadata)

**Root Cause:** The erc1155_transfers table only contains 291K rows, but there are 159M total trades. Most trades do not have corresponding ERC1155 transfer records in the current database.

---

## Investigation Findings

### 1. Missing Condition IDs

```sql
SELECT
  COUNT(*) as total_trades,
  countIf(condition_id IS NULL OR condition_id = '') as missing,
  round(missing / total_trades * 100, 2) as pct_missing
FROM trades_raw;
```

**Result:**
- Total trades: 159,574,259
- Missing condition_id: 77,435,673 (48.53%)
- Has condition_id: 82,138,586 (51.47%)

### 2. Available Junction Tables

| Table Name | Rows | Has Condition ID? | Join Key |
|-----------|------|-------------------|----------|
| `market_resolutions_final` | 224,396 | YES (condition_id_norm) | None directly to trades |
| `condition_market_map` | 151,843 | YES | market_id (but trades.market_id is all zeros) |
| `market_key_map` | 156,952 | YES | market_id (slug format) |
| `api_ctf_bridge` | 156,952 | YES | api_market_id |
| `ctf_token_map` | 41,130 | PARTIAL (many empty) | token_id |
| `erc1155_transfers` | 291,113 | NO (must extract) | tx_hash |

### 3. Critical Data Gaps

**Problem 1: market_id in trades_raw is unreliable**
```sql
SELECT
  countIf(market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as zero_market_ids,
  countIf(market_id != '0x0000000000000000000000000000000000000000000000000000000000000000') as valid_market_ids
FROM trades_raw
WHERE condition_id IS NULL OR condition_id = '';
```

**Result:**
- Zero market_ids: 76,676,173 (99.02%)
- Valid market_ids: 759,500 (0.98%)

**Problem 2: erc1155_transfers coverage is minimal**
```sql
SELECT COUNT(DISTINCT e.tx_hash) as matched
FROM (
  SELECT transaction_hash FROM trades_raw
  WHERE condition_id IS NULL OR condition_id = ''
  LIMIT 100000
) t
LEFT JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash);
```

**Result:**
- Sampled: 100,517 missing trades
- Matched to erc1155: 134 (0.13%)

**Problem 3: token_id extraction doesn't work**

The erc1155_transfers.token_id is stored as UInt256 (decimal), not hex. Even when converted to hex and extracted, it doesn't match condition_ids from trades with known values.

Validation test:
- Sample size: 38 trades with known condition_ids
- Exact matches after extraction: 0 (0%)

### 4. Alternative Data Sources Explored

**ctf_token_map:**
- Has 41,130 token mappings
- Many rows have EMPTY condition_id_norm
- Not comprehensive enough for 77M recovery

**market_key_map + api_ctf_bridge:**
- Only 156K markets covered
- No direct join path to trades (trades.market_id is unreliable)
- Would require slug matching which is error-prone

---

## Why Blockchain Scanning Was Originally Needed

The original approach to scan blockchain events was necessary because:

1. **CLOB fills** (trades) don't contain condition_id in the API response
2. **ERC1155 transfers** happen separately from CLOB fills
3. The link is only through:
   - Transaction hash (same tx contains both USDC transfer and ERC1155 transfer)
   - Token ID encoding (contains condition_id + outcome_index)

The erc1155_transfers table has only 291K rows because:
- This was likely a pilot/sample import
- Full backfill would require scanning ALL blocks from Polymarket's inception
- Previous estimate: 27 days to scan full blockchain history

---

## Alternative Approaches

### Option 1: Complete ERC1155 Backfill (RECOMMENDED)

**Strategy:** Finish the blockchain scanning for all ERC1155 transfers

**Estimated Time:** 18-27 days (based on previous pilot results)

**Steps:**
1. Resume scripts/phase2-full-erc1155-backfill-*.ts
2. Use 8-worker parallel processing
3. Checkpoint progress to resume if interrupted
4. Once complete, join via transaction_hash

**Recovery Rate:** ~95-98% (based on previous backfill analysis)

### Option 2: API-Based Recovery (FASTER but INCOMPLETE)

**Strategy:** Use Polymarket CLOB API's market metadata

**Estimated Time:** 2-4 hours

**Steps:**
1. Extract unique market identifiers from trades (where available)
2. Query Polymarket API for each market's condition_id
3. Backfill via UPDATE

**Recovery Rate:** ~10-20% (only works for trades with valid market_id or identifiable slugs)

### Option 3: Hybrid Approach (BALANCED)

**Strategy:** Combine API recovery + targeted blockchain scanning

**Estimated Time:** 4-9 hours

**Steps:**
1. Use API for markets with identifiable slugs (~15M trades)
2. Scan blockchain only for high-volume periods (last 6 months)
3. Leave historical long-tail unrecovered

**Recovery Rate:** ~60-70%

---

## Recommended Action Plan

Given the constraints:

**IF time is critical (< 9 hours required):**
- Use **Option 3: Hybrid Approach**
- Focus on recent high-value trades
- Accept 60-70% recovery rate

**IF data completeness is critical:**
- Use **Option 1: Complete ERC1155 Backfill**
- Allocate 18-27 days
- Achieve 95-98% recovery rate

**Quick Win (< 1 hour):**
- Recover the 759,500 trades that DO have valid market_ids
- Join to market_key_map → api_ctf_bridge → condition_id
- This gives you ~1% recovery immediately for testing

---

## Sample Quick Win Query

```sql
-- Step 1: Recover trades with valid market_id
CREATE TABLE trades_raw_partial_recovery ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp, trade_id)
AS
SELECT
  t.*,
  COALESCE(t.condition_id, c.condition_id) as condition_id_recovered
FROM trades_raw t
LEFT JOIN condition_market_map c ON t.market_id = c.market_id
WHERE t.market_id != '0x0000000000000000000000000000000000000000000000000000000000000000';

-- Estimated recovery: ~759,500 trades (0.98% of missing)
```

---

## Conclusion

**The metadata-only approach cannot populate 77.4M condition_ids.**

To recover the majority of missing condition_ids, you MUST either:
1. Complete the blockchain ERC1155 backfill (18-27 days)
2. Use Polymarket API with market slugs (2-4 hours, 10-20% recovery)
3. Hybrid: API + targeted blockchain scanning (4-9 hours, 60-70% recovery)

**The 0.13% recovery rate via current erc1155_transfers table is insufficient.**

---

## Files Generated During Investigation

- `/Users/scotty/Projects/Cascadian-app/investigate-condition-id-backfill.ts`
- `/Users/scotty/Projects/Cascadian-app/deep-dive-condition-id-backfill.ts`
- `/Users/scotty/Projects/Cascadian-app/final-backfill-feasibility-test.ts`
- `/Users/scotty/Projects/Cascadian-app/quick-coverage-test.ts`
- `/Users/scotty/Projects/Cascadian-app/investigate-token-id-format.ts`
- `/Users/scotty/Projects/Cascadian-app/CONDITION_ID_BACKFILL_FINAL_REPORT.md` (this file)
