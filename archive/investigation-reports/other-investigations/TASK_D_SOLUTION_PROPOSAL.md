# Task D: Solution Proposal - ERC-1155 Bridge

**Date:** 2025-11-15 (PST)
**Terminal:** Claude C1
**Status:** Root cause identified, solution proposed

---

## Summary of Findings

### Root Cause (CONFIRMED)

The unmapped token discrepancy was caused by **format mismatch**:
- `pm_erc1155_token_map` contains **decimal asset IDs** (76-78 chars)
- `erc1155_transfers` contains **hex ERC-1155 tokens** (64 chars)
- These are **two different ID systems** that don't overlap

### Available Bridge Tables

**Table 1: `legacy_token_condition_map`**
- Format: HEX (64-char, matches erc1155_transfers) ✅
- Coverage: **6.5%** (17,069 / 262,775 tokens)
- Mapping: token_id = condition_id (1:1, no outcome encoding)
- Quality: 100% match rate for tokens it covers
- Use case: Legacy/old markets

**Table 2: `erc1155_condition_map`**
- Format: DECIMAL (76-78 char, CLOB/asset IDs) ❌
- Coverage: **29.7%** of decimal assets (not ERC-1155)
- Mapping: asset_id → condition_id
- Quality: Good for CLOB world, wrong format for on-chain
- Use case: CLOB/Gamma integration (separate from ERC-1155)

### Coverage Reality Check

**ERC-1155 Hex Token Coverage:**
```
legacy_token_condition_map:    6.5%   (17K / 262K)
Other hex bridge tables:       0%     (none found)
Total real ERC-1155 coverage:  6.5%
```

**CLOB Decimal Asset Coverage:**
```
erc1155_condition_map:        29.7%   (41K / 139K)
ctf_token_map:               100.0%   (139K / 139K)
Total decimal asset coverage: 100%    (already covered by ctf_token_map)
```

---

## Proposed Solution: Hybrid Approach

### Strategy

Build **two separate mapping tables** for the two ID systems:

**1. pm_erc1155_token_map (HEX tokens → conditions)**
- Source: `legacy_token_condition_map` (6.5% coverage)
- Format: 64-char hex (matches erc1155_transfers)
- Purpose: On-chain blockchain verification
- Limitation: Only covers 6.5% of tokens

**2. pm_asset_id_map (DECIMAL assets → conditions)**
- Source: `erc1155_condition_map` or just use `ctf_token_map` directly
- Format: 76-78 char decimal (matches gamma_markets.tokens)
- Purpose: CLOB/Gamma integration
- Coverage: 29.7% (or 100% if using ctf_token_map)

### Rationale

1. **Separation of concerns**: On-chain (hex) and CLOB (decimal) are different systems
2. **Transparency**: Clearly document what we can and cannot map
3. **Pragmatic**: Use the 6.5% we have rather than waiting for perfect data
4. **Expandable**: Can add more sources as discovered

---

## Implementation Plan

### Step 1: Rebuild pm_erc1155_token_map (Correct Format)

**Source:** `legacy_token_condition_map`

**Script:** `77-rebuild-pm-erc1155-token-map-hex.ts`

```sql
-- Clear incorrect data
TRUNCATE TABLE pm_erc1155_token_map;

-- Rebuild with correct HEX format
INSERT INTO pm_erc1155_token_map
SELECT
  lower(replaceAll(ltcm.token_id, '0x', '')) as erc1155_token_id_hex,
  lower(replaceAll(ltcm.condition_id, '0x', '')) as condition_id,

  -- Outcome info (unknown for 1:1 mapping)
  0 as outcome_index,
  '' as outcome_label,

  -- Metadata
  ltcm.question,
  ltcm.market_slug,

  -- Event metadata from erc1155_transfers
  min(et.block_number) as first_seen_block,
  min(et.block_timestamp) as first_seen_timestamp,
  argMin(et.tx_hash, et.block_number) as first_seen_tx,

  -- Source tracking
  'legacy_token_condition_map' as mapping_source,
  90 as mapping_confidence,  -- High confidence for direct mapping

  now() as created_at,
  now() as updated_at

FROM legacy_token_condition_map ltcm
LEFT JOIN erc1155_transfers et
  ON lower(replaceAll(et.token_id, '0x', '')) = lower(replaceAll(ltcm.token_id, '0x', ''))
WHERE ltcm.token_id != ''
  AND ltcm.condition_id != ''
GROUP BY
  ltcm.token_id,
  ltcm.condition_id,
  ltcm.question,
  ltcm.market_slug;
```

**Expected Result:**
- 17,069 HEX token mappings
- 6.5% coverage of erc1155_transfers
- Correct format (64-char hex)

### Step 2: Create pm_asset_id_map (Separate Table)

**Option A:** Create new table for decimal assets
**Option B:** Just reference `ctf_token_map` directly (it already has this data)

**Recommendation:** Use Option B (reference existing table) to avoid duplication.

### Step 3: Expand HEX Coverage (Future)

**Potential sources to investigate:**
1. CTF event tables (settlement, redemption) - may have outcome-specific tokens
2. Transfer pattern analysis - group by condition via timing/amounts
3. Polymarket API - request token→condition mapping data
4. Reverse-engineering - test encoding formulas against known markets

**Estimated additional coverage:**
- CTF events: +10-20% (optimistic)
- Pattern analysis: +5-10%
- API data: Unknown
- Reverse-engineering: High effort, uncertain payoff

---

## Coverage Expectations

### After Step 1 (Immediate)

**pm_erc1155_token_map (HEX):**
```
Coverage:        6.5%   (17,069 / 262,775)
Format:          Correct (64-char hex)
Use case:        Blockchain verification (limited)
Status:          ✅ Usable but incomplete
```

**CLOB Asset Mapping (DECIMAL):**
```
Coverage:        100%   (use ctf_token_map directly)
Format:          Correct (76-78 char decimal)
Use case:        CLOB/Gamma integration
Status:          ✅ Complete
```

### After Step 3 (Future Expansion)

**Optimistic Target:**
```
pm_erc1155_token_map:  15-30%  (via CTF events + pattern analysis)
Still incomplete, but useful for subset analysis
```

**Realistic Target:**
```
pm_erc1155_token_map:  10-15%  (incremental improvements)
Document gaps, continue searching for better sources
```

---

## Recommendation to User

### Immediate Action (This Session)

1. ✅ Acknowledge that **full ERC-1155 hex→condition bridge does not exist** in our database
2. ✅ Rebuild `pm_erc1155_token_map` with **correct HEX format** using `legacy_token_condition_map`
3. ✅ Accept **6.5% coverage** as baseline for hex tokens
4. ✅ Use `ctf_token_map` directly for decimal asset mappings (100% coverage)
5. ✅ Update documentation to reflect two-ID-system reality

### Next Steps (Future Sessions)

1. Investigate CTF event tables for additional hex token mappings
2. Analyze transfer patterns to infer condition mappings
3. Consider reaching out to Polymarket for official token mapping data
4. Document known gaps and workarounds for affected features

### Impact on Roadmap

**Blocked (until more data):**
- ❌ Comprehensive blockchain verification (only 6.5% verifiable)
- ❌ Full volume audits (93.5% gap)
- ❌ Complete settlement tracking

**Unblocked (with current data):**
- ✅ CLOB/Gamma integration (100% via ctf_token_map)
- ✅ Limited blockchain verification (6.5% of tokens)
- ✅ P&L for CLOB trades (not dependent on hex mapping)
- ✅ Smart money analysis (CLOB-based)

**Workaround:**
- Focus analytics on CLOB data (100% coverage)
- Use ERC-1155 for supplementary validation where available (6.5%)
- Document that blockchain coverage is incomplete

---

## Decision Required

**Do you want me to:**

**Option A:** Proceed with hybrid approach (6.5% hex + 100% decimal)?
- Rebuild pm_erc1155_token_map with correct HEX format
- Document limitations
- Move forward with CLOB-focused analytics

**Option B:** Investigate further before proceeding?
- Deep-dive into CTF event tables
- Attempt reverse-engineering
- Delay implementation until better source found

**Option C:** Abandon ERC-1155 hex bridge entirely?
- Focus exclusively on CLOB/decimal data (100% coverage)
- Skip blockchain verification features
- Remove pm_erc1155_token_map table

---

**My Recommendation:** **Option A** (hybrid approach)
- Pragmatic: Use the 6.5% we have
- Transparent: Document gaps clearly
- Expandable: Can add more sources later
- Unblocking: Allows progress on CLOB analytics (main use case)

---

**Signed:** Claude C1
**Date:** 2025-11-15 (PST)
**Awaiting user decision to proceed**
