# Phase 2: Token Map Expansion - BLOCKER REPORT

**Date:** 2025-11-11
**Status:** ⚠️ **BLOCKED**
**Agent:** Claude 1 (Autonomous Execution)

---

## Executive Summary

**CANNOT REACH ≥95% COVERAGE** with available data sources.

### Current State
- **Fill coverage:** 35.4% (13.7M of 38.9M fills)
- **Volume coverage:** 33.28% ($4T of $12T USD)
- **Token coverage:** 16.81% (41,130 of 118,870 unique asset_ids)

### Blocker
**98,890 unmapped asset_ids** (83% of unique tokens) do not decode to valid condition_ids and no mapping table exists.

---

## Investigation Summary

### Phase 2 Objective
Expand `ctf_token_map` so every asset_id in `clob_fills` has a matching (condition_id_norm, outcome_index) entry, targeting ≥95% fill coverage.

### Baseline Metrics (Step 1)

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total unique asset_ids in clob_fills** | 118,870 | 100% |
| **Mapped in ctf_token_map** | 41,130 | 34.6% |
| **Unmapped tokens needed** | 98,890 | 83.2% |
| **Total fills** | 38,945,566 | 100% |
| **Mapped fills** | 13,786,948 | 35.4% |
| **Unmapped fills** | 25,158,618 | 64.6% |

**Gap to target:** Need to add 98,890 tokens to reach ≥95% coverage.

---

## Investigation Steps Performed

### ✅ Step 1: Analyzed ERC1155 Source Tables

**Tables checked:**
- `erc1155_transfers` - 61.4M rows, 264,899 unique tokens ❌ 0% match with clob_fills
- `pm_erc1155_flats` - Exists ❌ Not analyzed (ERC1155 mismatch)
- `erc1155_majority_vote` - Does not exist
- `erc1155_condition_map` - Exists ❌ Different token format

**Finding:** ERC1155 tables use **hex format with 0x prefix** (66 chars), while clob_fills uses **decimal format** (77-78 digits). These are DIFFERENT token sets.

**Token Format Comparison:**
- `clob_fills.asset_id`: `105392100504032111304...` (decimal, 77-78 digits)
- `erc1155_transfers.token_id`: `0x1d4a9d624270954105...` (hex with 0x, 66 chars)
- `ctf_token_map.token_id`: Mix of hex (17 rows) and decimal (41,113 rows)

### ✅ Step 2: Tested Decoder Pattern

**Hypothesis:** Unmapped asset_ids can be decoded like Phase 1 (decimal → hex → condition_id)

**Test:** Decoded 1,000 unmapped asset_ids using `lower(hex(toUInt256(asset_id)))`

**Result:**
- Decoded: 1,000
- Matched to `canonical_condition`: 27
- **Match rate: 2.7%** ❌

**Conclusion:** Unmapped asset_ids are NOT simple ERC1155 tokens that can be decoded.

### ✅ Step 3: Searched for Mapping Tables

**Candidates checked:**
- `clob_assets`, `clob_tokens`, `clob_token_map` - Do not exist
- `asset_condition_map`, `asset_token_map` - Do not exist
- `polymarket_assets`, `token_registry`, `asset_registry` - Do not exist
- `cascadian_clean.token_condition_market_map` - Exists but **100% empty** token_id_erc1155 column

**Finding:** No mapping table exists that bridges clob_fills.asset_id to condition_id_norm.

### ✅ Step 4: Volume Analysis (Critical Discovery)

**Question:** Maybe unmapped fills are low-volume/inactive markets?

**Findings:**

| Metric | Mapped | Unmapped | Mapped % |
|--------|--------|----------|----------|
| **Fill count** | 13,786,948 | 25,158,618 | 35.4% |
| **USD volume** | $4,018,532,635,054,488 | $8,054,573,699,586,085 | **33.28%** |

**Critical:** Unmapped fills represent **66.72% of trading volume** - NOT low-volume markets!

---

## Root Cause Analysis

### Why Can't We Map the Unmapped Asset_IDs?

**Evidence:**

1. **Format mismatch:**
   - clob_fills uses decimal format (77-78 digits)
   - ERC1155 tables use hex with 0x (66 chars)
   - These appear to be different identifier systems

2. **Decoding fails:**
   - Only 2.7% of decoded asset_ids exist in `canonical_condition`
   - 97.3% decode to condition_ids that don't exist in the database

3. **No mapping table:**
   - No table exists that maps clob_fills.asset_id → condition_id
   - `token_condition_market_map` exists but is 100% empty

4. **High-value markets:**
   - Unmapped fills represent 66.72% of volume
   - These are NOT inactive/test markets

### Hypothesis: Different Data Sources

**Likely scenario:** clob_fills.asset_id uses a CLOB-specific identifier system that doesn't directly correspond to ERC1155 token_ids.

**Possible sources:**
1. Polymarket CLOB API asset identifiers
2. Exchange-specific token IDs
3. Internal Polymarket market identifiers

---

## What Worked (Phase 1 Recap)

**Phase 1 backfill successfully:**
- Decoded 38,849 empty condition_id_norm values
- Achieved 100% coverage of existing ctf_token_map (41,130 rows)
- Increased fill coverage from 15% to 35.4%
- High validation rate: 99.9% match vs `canonical_condition`

**Why it worked:**
- ctf_token_map already contained the RIGHT tokens (in decimal format)
- We just needed to decode the existing token_ids to extract condition_ids
- The decoder pattern (decimal → hex) was validated against canonical_condition

---

## What Doesn't Work (Phase 2)

**Cannot expand ctf_token_map with available data because:**

1. ❌ Unmapped asset_ids don't decode to valid condition_ids (2.7% match)
2. ❌ No ERC1155 mapping exists (different token format)
3. ❌ No alternative mapping table found
4. ❌ Cannot achieve ≥90% validation rate (constraint)
5. ❌ Represents 67% of volume (cannot ignore)

---

## Attempted Approaches

### Approach 1: ERC1155 Blockchain Data
- **Action:** Check if unmapped asset_ids exist in `erc1155_transfers`
- **Result:** 0% match - Different token format (hex vs decimal)
- **Status:** ❌ Failed

### Approach 2: Decode Asset_IDs (Same as Phase 1)
- **Action:** Convert decimal asset_id to hex, check if valid condition_id
- **Result:** 2.7% match rate (way below 90% threshold)
- **Status:** ❌ Failed

### Approach 3: Find Mapping Table
- **Action:** Search for tables that map asset_id → condition_id
- **Result:** No usable mapping table exists
- **Status:** ❌ Failed

### Approach 4: Volume Filter (Maybe Low-Volume?)
- **Action:** Check if unmapped fills are negligible volume
- **Result:** 66.72% of volume is unmapped
- **Status:** ❌ Failed (cannot ignore)

---

## Data Needed to Unblock

To reach ≥95% coverage, we need ONE of the following:

### Option A: Polymarket CLOB API Mapping
- **What:** API endpoint or data dump that maps `clob_fills.asset_id` → `condition_id` + `outcome_index`
- **Why:** CLOB asset_ids appear to be Polymarket-specific identifiers
- **How:** Query Polymarket API or contact Polymarket team
- **Expected coverage:** 90-99%

### Option B: Historical Trading Data
- **What:** Export/dump of Polymarket trading data with full token metadata
- **Why:** May include the asset_id → token mapping
- **How:** Polymarket data exports, Dune Analytics, archive.org
- **Expected coverage:** 70-90%

### Option C: Reverse Engineering
- **What:** Analyze asset_id structure to find encoding pattern
- **Why:** Asset_ids might contain embedded condition_id or market_id
- **How:** Statistical analysis, pattern matching on known mappings
- **Expected coverage:** 20-50% (risky)

### Option D: Accept Current Coverage
- **What:** Proceed with 35.4% fill coverage / 33.28% volume coverage
- **Why:** May be sufficient for high-volume markets
- **How:** Filter P&L calculation to mapped fills only
- **Expected coverage:** 35.4% (below target)

---

## Sample Unmapped Asset_IDs

For reference, here are 10 unmapped asset_ids:

```
1. 105392100504032111304134821100444646936144151941404393276849684670593970547907
2. 102894439065827948528517742821392984534879642748379345137452173673949276014977
3. 56331120378768085083807049568748918263528811106383757925339269209247241825845
4. 34128948498964939853102398325306155688257269216438090996977511798069281111048
5. 114371001821164164902646439685427759853981924302906124203753724550487055672889
6. 20418249395528193802690805363653680152815570994555068696349565358020009181165
7. 35135409348165296533425769152169889177123033197141413836854440313087551126988
8. 90421200627469287880519613061929208554581143025038571108604080630495097434908
9. 106522989057330725781727137109968308404342521445681659314101363937153135946454
10. 54663117294022528385601661991520131323669248856526706218963217967937304019396
```

**Characteristics:**
- All decimal format
- 77-78 digits long
- Decode to hex condition_ids that don't exist in `canonical_condition`

---

## Recommendations

### Immediate Action Required

**User Decision:** Choose one of the following paths:

**Path A: Find External Data Source (Recommended)**
1. Contact Polymarket team for CLOB asset_id → token mapping
2. Check if Dune Analytics has this mapping
3. Search for data exports/dumps with full token metadata
4. **Time:** 1-7 days depending on data availability
5. **Success rate:** High (90-99% coverage likely)

**Path B: Accept Current Coverage**
1. Proceed with 35.4% fill coverage
2. Document limitation in P&L calculations
3. Filter dashboards to "high-confidence" markets only
4. **Time:** Immediate
5. **Success rate:** 35% coverage guaranteed

**Path C: Investigate Unmapped Asset_IDs**
1. Analyze asset_id structure for patterns
2. Check if Polymarket API can look up individual asset_ids
3. Reverse engineer the identifier system
4. **Time:** 2-5 days
5. **Success rate:** Low (20-50% coverage)

---

## Technical Details

### Query to Reproduce Findings

```sql
-- Baseline: Unique tokens
SELECT uniq(asset_id) AS unique_tokens
FROM clob_fills
WHERE asset_id != '';
-- Result: 118,870

-- Current coverage
SELECT
  countIf(asset_id IN (SELECT token_id FROM ctf_token_map)) as mapped,
  count() as total,
  round(mapped / total * 100, 2) as pct
FROM clob_fills
WHERE asset_id != '';
-- Result: 35.4%

-- Unmapped tokens
SELECT uniq(asset_id) as unmapped_tokens
FROM clob_fills
WHERE asset_id != ''
  AND asset_id NOT IN (SELECT token_id FROM ctf_token_map);
-- Result: 98,890

-- Volume coverage
SELECT
  sumIf(size, asset_id IN (SELECT token_id FROM ctf_token_map)) as mapped_vol,
  sum(size) as total_vol,
  round(mapped_vol / total_vol * 100, 2) as vol_pct
FROM clob_fills
WHERE asset_id != '';
-- Result: 33.28%

-- Decoder test
WITH unmapped AS (
  SELECT DISTINCT asset_id
  FROM clob_fills
  WHERE asset_id NOT IN (SELECT token_id FROM ctf_token_map)
  LIMIT 1000
)
SELECT
  countIf(
    lower(hex(toUInt256OrZero(asset_id))) IN (
      SELECT condition_id_norm FROM canonical_condition
    )
  ) / count() * 100 as match_pct
FROM unmapped;
-- Result: 2.7%
```

---

## Files Created

**Investigation scripts:**
- `scripts/phase2-baseline-metrics.ts`
- `scripts/phase2-analyze-erc1155-sources.ts`
- `scripts/phase2-token-format-analysis.ts`
- `scripts/phase2-find-clob-asset-source.ts`

**This report:**
- `/docs/operations/PHASE2_BLOCKER_REPORT.md`

---

## Next Steps (Awaiting User Decision)

**Cannot proceed autonomously** - requires external data source or user decision on coverage threshold.

**Options:**
1. **Provide data source** - If you have access to Polymarket CLOB asset mappings
2. **Accept 35% coverage** - Proceed with P&L on mapped fills only
3. **Investigate further** - Spend time reverse engineering asset_id structure
4. **Contact Polymarket** - Request official mapping data

---

**Status:** ⚠️ **BLOCKED - AWAITING USER DECISION**

**Signed:** Claude 1 (Main Terminal)
**Date:** 2025-11-11
