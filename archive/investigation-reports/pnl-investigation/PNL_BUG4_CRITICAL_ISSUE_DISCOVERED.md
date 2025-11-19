# P&L Bug #4 - CRITICAL ISSUE DISCOVERED

**Date**: 2025-11-11
**Terminal**: Claude 1
**Status**: ❌ **BLOCKED - Incorrect token mapping logic**

---

## Problem Summary

While validating P&L calculations after achieving 100% token mapping coverage, discovered that **`ctf_token_map` was populated with incorrect `condition_id` values**, causing -73% variance (vs <2% target).

---

## Root Cause Analysis

### What We Did Wrong:

In `scripts/populate-token-map-from-gamma.ts`, we populated `ctf_token_map` using:

```sql
SELECT
  token_id,
  lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,  -- ❌ WRONG!
  ROW_NUMBER() OVER (PARTITION BY condition_id ORDER BY outcome) - 1 as outcome_index
FROM gamma_markets
```

**The problem**: `gamma_markets.condition_id` is the **market's parent condition_id**, not the individual token's condition_id.

### Evidence:

From debug query on wallet `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`:

```
asset_id:       57397236409742675866794078969938882703997534789819796049243275890565527834954
token_id:       57397236409742675866794078969938882703997534789819796049243275890565527834954  ✅ Match
outcome_index:  1  ✅ Correct

ctm_cid (from ctf_token_map):     7ee5af3f3c1a3dc54082aaa1e4c73641d14a66c33ca7ce2ccb1642c787b7114a
cf_cid_norm (from clob_fills):    35a983283f4eab6e8649d1167e48bf05edba65e6a20efc5b46f4e56b331840e8
                                  ❌ MISMATCH!
```

The `condition_id_norm` values don't match, so when P&L validation tries to GROUP BY `condition_id_norm` from clob_fills and JOIN to `ctf_token_map`, it can't find matching outcome indices.

---

## Impact

### P&L Validation Results (FAILED):
- **Variance**: -73% (vs <2% target)
- **Calculated P&L**: $23,457.53
- **Expected (Dome)**: $87,030.51
- **Delta**: -$63,572.98

### Symptom in Validation Output:
```
TOP WINNERS:
 1. (unknown)... (outcome undefined, winner: No)  ❌ outcome_idx is undefined!
```

### Why It Fails:
The validation script groups by:
```sql
GROUP BY wallet, condition_id_norm, outcome_idx
```

But `condition_id_norm` comes from `clob_fills.condition_id` (the fill's market), while `outcome_idx` comes from `ctf_token_map` which has a **different** `condition_id_norm` (the parent market from gamma_markets).

Result: **No matching rows** → `outcome_idx` is undefined → P&L calculation collapses.

---

## The Correct Approach

### Option 1: Decode condition_id from token_id (ERC1155 Token Standard)

CTF tokens use ERC1155 encoding where the `token_id` embeds:
- `condition_id` (32 bytes / 256 bits)
- `outcome_index` (up to 256 values)

**Formula** (from Polymarket CTF contract):
```solidity
token_id = (condition_id << 8) | outcome_index
```

**Reverse decoding**:
```sql
condition_id = token_id >> 8  -- Right shift by 8 bits
outcome_index = token_id & 0xFF  -- Mask last 8 bits
```

**Correct population query**:
```sql
INSERT INTO ctf_token_map (token_id, condition_id_norm, outcome_index, source)
SELECT
  asset_id as token_id,
  lower(hex(bitShiftRight(toUInt256(asset_id), 8))) as condition_id_norm,  -- Decode from token_id
  toUInt8(bitAnd(toUInt256(asset_id), 255)) as outcome_index,               -- Last 8 bits
  'erc1155_decoded' as source
FROM clob_fills
WHERE asset_id NOT IN (SELECT token_id FROM ctf_token_map)
```

### Option 2: Use Dome API or Goldsky to fetch correct mappings

Fallback if ERC1155 decoding doesn't work due to ClickHouse type limitations.

---

## Next Steps (Recommended)

### Immediate (Unblock P&L validation):

1. **Clear incorrect ctf_token_map entries**:
   ```sql
   DELETE FROM ctf_token_map WHERE source = 'gamma_markets'
   ```

2. **Test ERC1155 decoding** on sample tokens:
   ```sql
   SELECT
     asset_id,
     lower(hex(bitShiftRight(toUInt256(asset_id), 8))) as decoded_cid,
     toUInt8(bitAnd(toUInt256(asset_id), 255)) as decoded_outcome_idx,
     lower(replaceAll(condition_id, '0x', '')) as fill_cid
   FROM clob_fills
   LIMIT 10
   ```
   Verify `decoded_cid` matches `fill_cid`.

3. **If ERC1155 decoding works**: Populate ctf_token_map using Option 1 query above

4. **If ClickHouse types are incompatible**: Fall back to Dome API backfill (dual-track approach in `DUAL_TRACK_BACKFILL_EXECUTION_GUIDE.md`)

5. **Re-run P&L validation**: `npx tsx scripts/validate-corrected-pnl-comprehensive-fixed.ts`

---

## Files Created This Session

### Scripts:
- **`scripts/populate-token-map-from-gamma.ts`** ❌ INCORRECT (used wrong condition_id source)
- **`scripts/validate-corrected-pnl-comprehensive-fixed.ts`** ✅ Fixed null safety, ready to use after fixing ctf_token_map
- **`scripts/debug-outcome-idx-join.ts`** ✅ Diagnostic tool (found the mismatch)

### Reports:
- **`PNL_BUG4_RESOLUTION_REPORT.md`** ⚠️ OUTDATED (claimed Bug #4 was resolved, but it wasn't)
- **`DUAL_TRACK_BACKFILL_EXECUTION_GUIDE.md`** ✅ Still valid (API backfill fallback if needed)
- **`PNL_BUG4_CRITICAL_ISSUE_DISCOVERED.md`** ✅ THIS FILE (current status)

---

## Questions for User

Before proceeding, need to confirm:

1. **Does ClickHouse support `bitShiftRight()` and `bitAnd()` on UInt256?**
   - If NO → Must use API backfill approach
   - If YES → Can use ERC1155 decoding (much faster)

2. **Acceptable to DROP and recreate `ctf_token_map`?**
   - Current table has 160,495 rows with incorrect `condition_id_norm`
   - Need to repopulate with correct logic

3. **Should we validate ERC1155 decoding first** before bulk population?
   - Test on 100 tokens
   - Verify decoded condition_id matches clob_fills.condition_id

---

## Summary

**Bug #4 is NOT resolved.** We achieved 100% coverage but with **incorrect data**. The `condition_id_norm` values in `ctf_token_map` don't match the actual market condition IDs from trades, causing P&L validation to fail catastrophically (-73% variance).

**Root cause**: Used `gamma_markets.condition_id` (parent market ID) instead of decoding the individual token's condition_id from its `token_id` value.

**Fix required**: Either decode condition_id from token_id via ERC1155 formula, or fetch correct mappings from Dome/Goldsky APIs.

---

**Terminal**: Claude 1
**Session**: P&L Validation - Bug #4 Critical Issue Discovered
**Date**: 2025-11-11
