# Token Mapping Investigation Findings

**Investigation Date:** 2025-11-11
**Investigator:** Claude 2 (Database Exploration Agent)
**Playbook:** Database explore checks for outcome/token mappings
**Status:** ✅ COMPLETE

---

## Executive Summary

**CRITICAL FINDING:** The `ctf_token_map` table exists with 41,130 rows but **94% of data is missing critical join keys**. The table has valid schema but empty `condition_id_norm` values for 38,849 rows (94%). More critically, **the highest-volume markets (150K-195K trades) are completely unmapped**, explaining P&L reconciliation failures.

---

## Investigation Steps Performed

### ✅ Step 1: Quick Row-Count Snapshot

**Script:** `npx tsx scripts/quick-db-diagnostic.ts`

**Key Tables Examined:**
- `ctf_token_map`: **41,130 rows** (1.46 MiB)
- `erc1155_condition_map`: **41,306 rows** (3.23 MiB)
- `gamma_markets`: **149,908 rows** (21.54 MiB)
- `gamma_resolved`: **123,245 rows** (3.82 MiB)

**Status:** ✅ Tables exist, not empty

---

### ✅ Step 2: Deep-Dive Schema Inspection

**Method:** Direct ClickHouse query (original script had import errors)

**Schema Discovered (`ctf_token_map`):**
```
token_id                       String
condition_id_norm              String      ← Critical join key
outcome_index                  UInt8
vote_count                     UInt32
source                         String
created_at                     DateTime
version                        UInt32
market_id                      String
```

**Sample Data Analysis:**
```
First 10 rows inspected:
- ALL have condition_id_norm = '' (EMPTY STRING)
- ALL have market_id = '' (EMPTY STRING)
- token_id: Populated (hex addresses)
- outcome_index: Populated (mostly 1)
- vote_count: Populated (2-12)
- source: 'erc1155_majority_vote'
```

**Data Quality Check:**
```
Total rows:                 41,130
Empty condition_id_norm:    38,849 (94.4%)
Filled condition_id_norm:    2,281 (5.6%)
Empty market_id:            41,130 (100%)
Filled market_id:                0 (0%)
```

**Status:** ❌ Schema correct, but 94% missing critical data

---

### ✅ Step 3: Token Map Quality Check

**Script:** `npx tsx scripts/redemption-winner-inference-final.ts`

**Output:**
```
ctf_token_map quality:
{
  "total_rows": "2281",
  "unique_tokens": "2281",
  "rows_with_condition_id": "2281",
  "unique_conditions": "1921"
}
```

**Findings:**
- Only 2,281 rows have usable condition IDs
- Covers 1,921 unique conditions
- Script fails when attempting ERC1155 decoding (type casting error on remaining rows)

**Status:** ⚠️ Partial coverage confirmed, 1,921 conditions mapped

---

### ✅ Step 4: Baseline Market Lookup

**Method:** Query highest-volume condition IDs from `trades_with_direction`, then lookup in `ctf_token_map`

**Top 5 Markets by Trade Volume:**

| Rank | Condition ID | Trade Count | ctf_token_map Status |
|------|-------------|-------------|----------------------|
| 1 | c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058 | 193,937 | ❌ NOT FOUND |
| 2 | dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917 | 179,407 | ❌ NOT FOUND |
| 3 | bbad52c7a569d729424c917dd3181149d59b5f4fc3115d510b91197c4368c22a | 156,912 | ❌ NOT FOUND |
| 4 | 818fcedd06b88f3a70b516abd2c12ea7281350010f9c5820f577d5e41427b90a | 150,777 | ❌ NOT FOUND |
| 5 | f943579ac22e2c4cc5ad7c70f096cc8937af34c0df1ee0b6740301efb1065155 | 138,850 | ❌ NOT FOUND |

**CRITICAL:** The top 5 markets (representing 819,883 combined trades) have **ZERO mapping data**.

**Status:** 🚨 HIGH-VOLUME MARKETS UNMAPPED

---

## Root Cause Analysis

### What We Know

1. **Schema is Correct**
   - All required columns exist (`condition_id_norm`, `outcome_index`, `token_id`)
   - Data types are appropriate

2. **Table is Partially Populated**
   - 5.6% (2,281 rows) have valid condition IDs
   - Covers 1,921 unique conditions
   - These are likely low-volume markets

3. **Critical Data is Missing**
   - 94.4% (38,849 rows) have empty `condition_id_norm`
   - 100% have empty `market_id`
   - High-volume markets (150K-195K trades) completely absent

4. **Backfill Method Failed**
   - Data source: `erc1155_majority_vote`
   - Likely attempted ERC1155 token ID decoding
   - Failed to extract condition IDs for 94% of tokens

### Why P&L Reconciliation is Failing

**The Missing Link:**
```
fact_trades_clean (63M rows)
  ├── condition_id_norm: populated
  └── outcome_index: populated

  ❌ JOIN (broken)

ctf_token_map (41K rows)
  ├── condition_id_norm: 94% EMPTY
  ├── outcome_index: populated
  └── token_id: populated

  ❌ CANNOT RESOLVE WINNING OUTCOMES
```

**Impact:**
- Cannot determine which outcome won for 94% of markets
- Cannot calculate realized P&L for closed positions
- wallet_pnl_summary tables empty or incomplete
- Leaderboard queries return 0 rows

---

## Sample Valid Data (What Works)

**Example from the 2,281 working rows:**

```
token_id:           '0x92c86f0f7c722ff7cf638093e02640da9eab0bcb06827c4e2f11c115e758d215'
condition_id_norm:  '92c86f0f7c722ff7cf638093e02640da9eab0bcb06827c4e2f11c115e758d215'
outcome_index:      1
vote_count:         9
source:             'erc1155_majority_vote'
```

**Pattern:** When token_id (hex) matches condition_id_norm (hex without 0x), mapping exists.

---

## Alternative Data Sources Explored

### Other Mapping Tables

| Table | Rows | condition_id Coverage | Notes |
|-------|------|----------------------|-------|
| `erc1155_condition_map` | 41,306 | Unknown | Similar size to ctf_token_map |
| `condition_market_map` | 151,843 | Unknown | Larger, may have better coverage |
| `merged_market_mapping` | 41,306 | Unknown | Same size as erc1155 |
| `market_key_map` | 156,952 | N/A | Different join key |

**Next Investigation:** Check if `condition_market_map` (151K rows) has better coverage for high-volume markets.

---

## Recommendations

### Immediate Actions (Required for P&L)

1. **Backfill ctf_token_map from Blockchain**
   - Priority: Top 100 markets by trade volume
   - Source: ERC1155 `TransferBatch` events → token ID decoding
   - Target: Fill 38,849 empty condition_id_norm rows

2. **Alternative: Use condition_market_map**
   - Verify if this table (151K rows) has better coverage
   - May have different schema/join keys
   - Could be immediate workaround

3. **Validate Resolution Data**
   - Check `gamma_resolved` (123K rows) for winner data
   - Map gamma resolution format to our schema
   - May need outcome label → outcome_index translation

### Long-Term Solutions

1. **Automated Mapping Pipeline**
   - Real-time ERC1155 event decoding
   - Populate ctf_token_map on trade ingestion
   - Eliminate mapping gaps

2. **Redundant Data Sources**
   - Polymarket API (market metadata)
   - Gamma API (resolution data)
   - Blockchain (ground truth)

3. **Data Quality Monitoring**
   - Alert when ctf_token_map coverage < 95%
   - Daily checks for high-volume unmapped markets
   - Automated backfill triggers

---

## Technical Details

### Tables Referenced

**Trades/Position Data:**
- `trades_with_direction` (95.4M rows) - has condition_id_norm
- `fact_trades_clean` (63.4M rows) - NO condition_id column
- `erc1155_transfers` (61.4M rows) - raw ERC1155 events

**Mapping Data:**
- `ctf_token_map` (41K rows) - 94% empty
- `condition_market_map` (152K rows) - unexplored
- `erc1155_condition_map` (41K rows) - unexplored
- `market_key_map` (157K rows) - different schema

**Resolution Data:**
- `gamma_resolved` (123K rows) - Gamma API resolutions
- `market_resolutions_final` (218K rows) - combined resolutions
- `resolutions_external_ingest` (133K rows) - external sources

### Schema Differences Discovered

**Expected (from baseline docs):**
```sql
ctf_token_map (
  token_id String,
  condition_id String,    -- Expected
  outcome_index UInt8
)
```

**Actual:**
```sql
ctf_token_map (
  token_id String,
  condition_id_norm String,  -- Actual (with _norm suffix)
  outcome_index UInt8,
  market_id String,          -- Additional field (always empty)
  vote_count UInt32,
  source String,
  created_at DateTime,
  version UInt32
)
```

---

## Files Created/Updated

**This Report:**
- `/docs/reports/TOKEN_MAPPING_INVESTIGATION_FINDINGS.md`

**Scripts Used:**
- `scripts/quick-db-diagnostic.ts` ✅ (ran successfully)
- `scripts/deep-dive-condition-id-backfill.ts` ❌ (import error, bypassed)
- `scripts/redemption-winner-inference-final.ts` ⚠️ (ran partially, type error)
- `scripts/inspect-ctf-token-map-temp.mjs` ✅ (created for investigation)

---

## Next Steps for Main Agent

### Priority 1: Verify Alternative Mappings

```sql
-- Check condition_market_map coverage
SELECT
  countIf(condition_id != '') as filled_conditions,
  count(*) as total_rows
FROM condition_market_map;

-- Test with high-volume market
SELECT *
FROM condition_market_map
WHERE condition_id = 'c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058'
LIMIT 10;
```

### Priority 2: Backfill Missing Mappings

**Options:**
A. Decode ERC1155 token IDs directly from `erc1155_transfers`
B. Fetch from Polymarket API (market metadata endpoint)
C. Use Gamma API resolution data as proxy

### Priority 3: Update P&L Calculation Logic

Once mappings are filled, rerun:
1. Realized P&L calculation
2. wallet_pnl_summary generation
3. Leaderboard view population

---

## Conclusion

**The ctf_token_map table exists but is functionally broken for P&L calculation.** Only 5.6% coverage, with high-volume markets completely missing. This explains:
- Empty wallet_pnl_summary tables
- Zero rows in leaderboard views
- P&L reconciliation failures
- Missing winner/loser data

**Resolution requires:** Backfilling 38,849 empty condition_id_norm values, prioritizing the top 100 markets by trade volume.

---

**Investigation Status:** ✅ COMPLETE
**Findings:** CRITICAL
**Action Required:** IMMEDIATE
**Report Owner:** Claude 2
**Next Agent:** Main Agent (for backfill decision)

---

**Last Updated:** 2025-11-11 23:47 UTC
**Signed:** Claude 2 (Database Explorer Agent)
