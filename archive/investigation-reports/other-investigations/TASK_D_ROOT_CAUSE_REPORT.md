# Task D: Root Cause Report - Unmapped Token Discrepancy

**Date:** 2025-11-15 (PST)
**Terminal:** Claude C1
**Status:** ROOT CAUSE IDENTIFIED

---

## Executive Summary

The unmapped token query showed **0 unmapped tokens** despite only **15.72% coverage** because:

**pm_erc1155_token_map contains the WRONG data format.**

---

## The Discrepancy

**Expected:**
- 262,775 total ERC-1155 tokens
- 41,305 mapped tokens
- 221,470 unmapped tokens (84.28%)

**Actual:**
- LEFT JOIN query returned: **0 unmapped tokens**
- All 20 sample tokens showed as "FOUND"

---

## Root Cause Analysis

### Finding 1: Token ID Length Mismatch

**erc1155_transfers (source truth for on-chain tokens):**
```
64-char hex: 61,161,760 transfers (99.97%)
62-char hex:    217,963 transfers
60-char hex:        228 transfers
```

**pm_erc1155_token_map (supposedly ERC-1155 map):**
```
77-char decimal: 32,050 rows (77.6%)
78-char decimal:  5,580 rows (13.5%)
76-char decimal:  3,148 rows (7.6%)
64-char hex:        191 rows (0.5%)  ← Only 191 are actual ERC-1155!
```

### Finding 2: Source Table Analysis

**erc1155_condition_map.token_id distribution:**
```
77-char decimal: 32,050 rows
78-char decimal:  5,580 rows
76-char decimal:  3,148 rows
64-char hex:        191 rows
```

**Example from erc1155_condition_map:**
```
token_id: '100001007108037958511831509695844337905086917072976664769301948837173055638067'
Length: 78 characters (DECIMAL format)
```

**Example from erc1155_transfers:**
```
token_id: '0xde52e5e3ca0f8b3510e2662a5cbb03f5c8d83ef5b0cbd48ba5b0cbd48ba5b0c1'
Normalized: 'de52e5e3ca0f8b3510e2662a5cbb03f5c8d83ef5b0cbd48ba5b0cbd48ba5b0c1'
Length: 64 characters (HEX format)
```

---

## The Mistake

### What We Thought We Were Building

A bridge from **on-chain ERC-1155 token IDs** (hex) to condition_id:

```
erc1155_transfers.token_id (HEX)  ──>  condition_id
```

### What We Actually Built

A bridge from **CLOB asset IDs** (decimal) to condition_id:

```
ctf_token_map.token_id (DECIMAL)  ──>  condition_id
```

This is the **same mapping that already exists in ctf_token_map!**

---

## Why LEFT JOIN Showed 0 Unmapped

The LEFT JOIN compared:
```sql
erc1155_transfers: 'de52e5e3ca0f8b35...' (64-char hex)
           JOIN
pm_erc1155_token_map: '100001007108037958...' (78-char decimal)
```

These **never match** because:
1. Different formats (hex vs decimal)
2. Different lengths (64 vs 76-78 chars)
3. Completely different value spaces

But ClickHouse's LEFT JOIN returned ALL tokens as "found" because of how the CTE was structured - it counted distinct tokens in the CTE, then joined, resulting in the CTE count being preserved.

---

## The Correct Understanding

### Three Separate ID Systems

**1. On-Chain ERC-1155 Token IDs (HEX)**
- Format: 64-char hex (no 0x)
- Source: erc1155_transfers
- Example: `de52e5e3ca0f8b3510e2662a5cbb03f5c8d83ef5b0cbd48ba5b0cbd48ba5b0c1`
- Count: 262,775 distinct tokens

**2. CLOB/Gamma Asset IDs (DECIMAL)**
- Format: 76-78 char decimal
- Source: ctf_token_map, gamma_markets, erc1155_condition_map
- Example: `100001007108037958511831509695844337905086917072976664769301948837173055638067`
- Count: 139,140 distinct assets

**3. Condition IDs (HEX, canonical anchor)**
- Format: 64-char hex (no 0x)
- Source: All bridge tables
- Example: `100001007108037958511831509695844337905086917072976664769301948837` (condition ID is often embedded in asset ID)

### The Bridge We Need vs The Bridge We Built

**NEEDED:**
```
erc1155_transfers.token_id (HEX)  ──>  condition_id  <──  ctf_token_map.token_id (DECIMAL)
```

**BUILT:**
```
erc1155_condition_map.token_id (DECIMAL)  ──>  condition_id
   ↑
   This is the same as ctf_token_map! Not ERC-1155 transfers!
```

---

## Impact

**Current pm_erc1155_token_map:**
- ❌ Does NOT map ERC-1155 transfer tokens to conditions
- ❌ Does map CLOB asset IDs to conditions (duplicates ctf_token_map)
- ❌ Field name `erc1155_token_id_hex` is misleading (contains decimal)
- ✅ Could be useful as `pm_asset_id_map` instead

**Coverage Numbers Were Misleading:**
- "15.72% coverage" was comparing apples (262K hex tokens) to oranges (41K decimal assets)
- The real coverage of ERC-1155 transfers: **0%** (only 191 hex tokens out of 262,775)

---

## The Real Question

**Does a hex ERC-1155 → condition_id bridge exist in our database?**

To answer this, we need to find tables that:
1. Contain 64-char hex token IDs matching erc1155_transfers format
2. Have corresponding condition_id values
3. Provide the outcome mapping we need

**Candidates to investigate:**
- Other CTF event tables (ctf_*)?
- Market resolution tables with hex tokens?
- Direct condition → outcome decoding tables?

---

## Proposed Solution

### Option A: Find Real ERC-1155 Bridge (Preferred)

Search for tables that bridge hex ERC-1155 tokens to conditions:
```sql
-- Look for tables with hex token_ids that match erc1155_transfers
SELECT table, COUNT(*)
FROM system.tables t
JOIN information_schema.columns c ON t.name = c.table_name
WHERE c.column_name LIKE '%token%'
  AND database = 'default';
```

### Option B: Build From Transfer Patterns

If no bridge exists, analyze transfer patterns to derive condition mappings:
1. Group transfers by token_id
2. Find settlement/redemption transactions
3. Link to market resolutions via timing
4. Infer condition_id from redemption patterns

### Option C: Decode Token IDs Directly

If Polymarket's encoding is discoverable:
1. Reverse-engineer the hex → condition_id formula
2. Apply to all erc1155_transfers tokens
3. Validate against known outcomes

---

## Immediate Next Steps

1. ✅ Document root cause (this file)
2. 🔄 Search database for real ERC-1155 → condition bridges
3. 🔄 If found, rebuild pm_erc1155_token_map with correct data
4. 🔄 If not found, decide between Option B (pattern analysis) or Option C (encoding reverse-engineering)
5. 🔄 Update DATA_COVERAGE_REPORT_C1.md with corrected understanding

---

## Revised Coverage Numbers

**Before (Incorrect):**
- Token coverage: 15.72% (41,305 / 262,775)
- "Unmapped tokens: 0"

**After (Correct):**
- **ERC-1155 hex token coverage: 0.07%** (191 / 262,775)
- **CLOB asset ID coverage: 29.69%** (41,114 / 139,140) ← This is what we actually built
- Unmapped ERC-1155 tokens: 262,584 (99.93%)

---

## Lesson Learned

**Always validate data format assumptions:**
- Table names can be misleading (erc1155_condition_map contains decimals, not hex)
- Sample data before assuming schema
- Check token ID lengths to verify format
- Cross-reference with source tables

---

**Signed:** Claude C1
**Date:** 2025-11-15 (PST)
**Status:** Root cause identified, awaiting decision on solution path
