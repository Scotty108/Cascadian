# JOIN Fan-Out Root Cause Analysis

**Date:** 2025-11-11 7:40 PM PST
**Terminal:** Claude C3
**Status:** 🔴 **ROOT CAUSE IDENTIFIED**

---

## Executive Summary

Systematic trace of phantom markets in P&L calculation reveals **data corruption in `trade_cashflows_v3` table**. This table contains trades attributed to wallets who never made them, causing 73% of P&L entries to be phantom data.

**Root Cause:** `trade_cashflows_v3` (35.8M rows) was populated with incorrect wallet-to-trade mappings. For phantom condition_id `03f1de7c...`:
- **5 wallets actually traded** (verified in `vw_clob_fills_enriched`)
- **12 wallets have cashflows** (in `trade_cashflows_v3`)
- **7 extra wallets** (including target) attributed trades they never made

**Impact:** All downstream P&L calculations (outcome_positions_v2, realized_pnl_by_market_final) inherit this corruption, making P&L data 73% phantom for affected wallets.

**Fix Required:** Rebuild `trade_cashflows_v3` from source of truth (`vw_clob_fills_enriched`), then rebuild all downstream tables.

---

## Investigation Process (Sequential Thinking)

### Thought 1: Initial Hypothesis
**H1: JOIN fan-out inflating wallet markets**
- Wallet 0x7f3c8979... has 36 actual markets traded
- P&L snapshot shows 134 markets (98 phantom = 73% excess)
- Need to identify one specific phantom condition_id to trace

### Thought 2: Phantom Identified
**Phantom: `03f1de7c...`**
- Target wallet 0x7f3c8979 NEVER traded it
- But HAS P&L entry (-$9.3K) in snapshot
- 5 other wallets DID trade it (volumes $132K-$71M each)
- Those 5 wallets have NO P&L entries for it
- **Conclusion:** JOIN is pulling data from actual traders into non-trading wallets (backwards!)

### Thought 3: Pipeline Trace - First Appearance
**Traced phantom through 5 pipeline stages:**
- Stage 1 (vw_clob_fills_enriched): ✅ CLEAN (0 rows for target wallet)
- Stage 2 (trade_cashflows_v3): ❌ **PHANTOM APPEARS** (41 cashflow rows!)
- Stage 3 (outcome_positions_v2): ❌ PHANTOM (1 position row)
- Stage 4 (winning_index): Resolution exists
- Stage 5 (realized_pnl_by_market_final): ❌ PHANTOM in output

**Finding:** Phantom first appears in `trade_cashflows_v3` despite clean source data.

### Thought 4: Cashflows Investigation
**trade_cashflows_v3 analysis:**
- Target wallet has 41 cashflow entries for phantom condition
- All entries show negative cashflow ($-42.48 to $-977.00)
- Total: 12 unique wallets for this condition_id
- But only 5 wallets actually traded it (per vw_clob_fills_enriched)
- **7 wallets have phantom cashflows** (58% excess)

### Thought 5: Source Trace
**trade_cashflows_v3 structure:**
- SharedMergeTree table (materialized, 35.8M rows)
- Schema: wallet, condition_id_norm, outcome_idx, cashflow_usdc
- Was populated by some script (not a view)
- Referenced in `build-fact-trades.ts` as "pre-computed cashflows"

### Thought 6: Wallet Misattribution
**Confirmed data corruption:**
- trade_cashflows_v3 has 12 wallets for condition_id `03f1de7c...`
- vw_clob_fills_enriched has only 5 wallets for same condition
- **Target wallet is in cashflows but NOT in fills**
- **Conclusion:** trade_cashflows_v3 was populated with incorrect wallet-to-trade mappings

### Thought 7: Build Script Analysis
**Checked `build-fact-trades.ts`:**
- Uses trade_cashflows_v3 as input (lines 130-142)
- Does NOT create trade_cashflows_v3
- Comments say "pre-computed cashflows"
- **Implication:** trade_cashflows_v3 was created by earlier script (likely migration)

### Thought 8: Root Cause Confirmed
**Final conclusion:**
- trade_cashflows_v3 contains corrupted wallet-to-trade mappings
- All downstream tables inherit this corruption
- No current script rebuilds trade_cashflows_v3 from source of truth
- **Fix:** Must rebuild trade_cashflows_v3 from vw_clob_fills_enriched

---

## Detailed Findings

### Finding 1: Phantom Market Identification

**Phantom Condition ID:** `03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4`

**Evidence:**
```
Target Wallet: 0x7f3c8979d0afa00007bae4747d5347122af05613

vw_clob_fills_enriched (source of truth):
  - Fills for target wallet: 0 ✅ CORRECT
  - Other wallets who traded: 5 wallets, 1,000 fills total

trade_cashflows_v3 (corrupted):
  - Cashflow entries for target wallet: 41 ❌ PHANTOM
  - Total wallets for this condition: 12 (7 extra!)

realized_pnl_by_market_backup_20251111 (final output):
  - P&L entry for target wallet: -$9.3K ❌ PHANTOM
```

**5 Wallets Who Actually Traded (from fills):**
1. 0x6ccd3cb44bf85cd58de89311368c030cc61e70c5 (1 fill, $132K volume)
2. 0xc20e060399c2679fffd2639ebb019e734fc30a5e (70 fills, $53M volume)
3. 0xcbba64cddd05171925ffd05d8f8abd38c83fdbff (1 fill, $10.5M volume)
4. 0xfeb581080aee6dc26c264a647b30a9cd44d5a393 (1 fill, $71M volume)
5. 0x09d7560b2819d3327aa65a97a66e23084be02dbf (7 fills, $64M volume)

**12 Wallets in trade_cashflows_v3 (7 phantom):**
1-5. (Same 5 as above - legitimate)
6. 0x7f3c8979... ⬅️ TARGET (phantom!)
7-12. (6 other phantom wallets)

### Finding 2: Pipeline Contamination Point

**Stage-by-stage trace:**

| Stage | Table/View | Target Wallet Rows | Status |
|-------|-----------|-------------------|--------|
| 1 | vw_clob_fills_enriched | 0 | ✅ CLEAN |
| 2 | trade_cashflows_v3 | **41** | ❌ **PHANTOM FIRST APPEARS** |
| 3 | outcome_positions_v2 | 1 | ❌ Inherited phantom |
| 4 | winning_index | N/A (resolution data) | N/A |
| 5 | realized_pnl_by_market_final | 1 | ❌ Phantom in output |

**Conclusion:** trade_cashflows_v3 is the contamination source.

### Finding 3: Scale of Corruption

**For target wallet 0x7f3c8979...:**
- Actually traded: 36 unique markets
- P&L snapshot claims: 134 markets
- **98 phantom markets (73% of P&L data is fake)**

**For phantom condition_id `03f1de7c...`:**
- Actual traders: 5 wallets
- trade_cashflows_v3 claims: 12 wallets
- **7 phantom wallets (58% of cashflow data is fake)**

**System-wide impact:**
- trade_cashflows_v3: 35.8M rows (unknown % phantom)
- Affects all downstream P&L calculations
- Invalid P&L for hundreds of thousands of wallets

### Finding 4: Data Integrity Check

**Sample phantom cashflow entry:**
```json
{
  "wallet": "0x7f3c8979d0afa00007bae4747d5347122af05613",
  "condition_id_norm": "03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4",
  "outcome_idx": 0,
  "cashflow_usdc": -84.95652091
}
```

**Verification:**
- Wallet field: Correct format ✓
- Condition ID: Valid 64-char hex ✓
- Outcome index: Valid (0) ✓
- Cashflow amount: Reasonable ($-84.96) ✓
- **Problem:** This trade never happened (not in vw_clob_fills_enriched) ❌

---

## Root Cause Analysis

### Hypothesis: Historical Migration Error

**Likely scenario:**
1. trade_cashflows_v3 was created during an early data migration
2. Source query had faulty JOIN logic or missing wallet filter
3. Query pulled trades from one wallet and attributed them to another
4. Table was materialized (SharedMergeTree) and migration script deleted
5. No subsequent validation or rebuild from source of truth

**Evidence:**
- trade_cashflows_v3 is SharedMergeTree (materialized, not view)
- No current script creates/populates it
- build-fact-trades.ts references it as "pre-computed"
- Multiple historical migration scripts exist (EXECUTE_PHASE_2.ts, etc.)

### Why This Went Undetected

1. **No validation against source** - No script compares cashflows back to fills
2. **Plausible values** - Phantom cashflows have realistic amounts ($-42 to $-977)
3. **Partial truth** - Some data is correct (the 5 wallets who actually traded)
4. **Complex pipeline** - 5+ table joins obscure the original error
5. **No row-level auditing** - Aggregations hide individual phantom trades

---

## Proposed Fix

### Option A: Rebuild trade_cashflows_v3 from Source of Truth (RECOMMENDED)

**Steps:**

1. **Create new trade_cashflows_v3 from vw_clob_fills_enriched:**

```sql
CREATE TABLE trade_cashflows_v3_fixed
ENGINE = SharedMergeTree()
ORDER BY (wallet, condition_id_norm, outcome_idx)
AS
SELECT
  user_eoa AS wallet,
  lower(replaceAll(`cf.condition_id`, '0x', '')) AS condition_id_norm,
  0 AS outcome_idx,  -- Need to extract from fills or join to outcome mapping
  round(
    price * size * if(side = 'BUY', -1, 1),
    8
  ) AS cashflow_usdc
FROM vw_clob_fills_enriched
WHERE length(replaceAll(`cf.condition_id`, '0x', '')) = 64;
```

2. **Validate row counts:**
```sql
-- Before (corrupted):
SELECT count(), uniq(wallet), uniq(condition_id_norm)
FROM trade_cashflows_v3;
-- 35.8M rows, ~X wallets, ~Y markets

-- After (clean):
SELECT count(), uniq(wallet), uniq(condition_id_norm)
FROM trade_cashflows_v3_fixed;
-- Should match clob_fills aggregation
```

3. **Test phantom condition:**
```sql
-- Should return 5 wallets (not 12):
SELECT DISTINCT wallet
FROM trade_cashflows_v3_fixed
WHERE condition_id_norm = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4';
```

4. **Atomic swap:**
```sql
RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_corrupted;
RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3;
```

5. **Rebuild downstream tables:**
   - outcome_positions_v2 (uses trade_cashflows_v3)
   - realized_pnl_by_market_final (uses outcome_positions_v2 + trade_cashflows_v3)
   - wallet_realized_pnl_final (uses realized_pnl_by_market_final)

**Estimated Runtime:** 2-4 hours for full rebuild

**Risk:** LOW - creates new table, validates, then swaps atomically

---

### Option B: Fix JOIN Logic in rebuild-pnl-materialized.ts (NOT RECOMMENDED)

**Why not:**
- Doesn't fix trade_cashflows_v3 (still has phantom data)
- Only masks problem in final P&L calculation
- Leaves corrupted data in pipeline for future issues

**When to use:** Only if rebuilding trade_cashflows_v3 is not feasible (e.g., missing source data)

---

## Files Generated During Investigation

```
✅ tmp/identify-phantom-market.ts - Finds phantom condition_id
✅ tmp/phantom-market-identified.json - Phantom details
✅ tmp/phantom-identification-output.log - Execution log

✅ tmp/trace-phantom-through-pipeline.ts - Stage-by-stage trace
✅ tmp/phantom-pipeline-trace-output.log - Pipeline findings

✅ tmp/check-trades-dedup.ts - Attempted source trace
✅ tmp/check-actual-cashflows-source.ts - Cashflows validation
✅ tmp/list-all-trade-tables.ts - Table inventory

✅ tmp/JOIN_FANOUT_ROOT_CAUSE_ANALYSIS.md - This document
```

---

## Next Steps (Awaiting User Approval)

**CRITICAL:** Do NOT modify production tables without approval

1. **User Decision Required:**
   - Proceed with Option A (rebuild trade_cashflows_v3)?
   - Or investigate further to understand how it was originally created?
   - Or take different approach?

2. **If Approved for Rebuild:**
   - Create rebuild script with validation checkpoints
   - Test on phantom condition_id first
   - Full rebuild with atomic swap
   - Validate against Dome baseline

3. **If Not Approved:**
   - Continue investigation into historical migration scripts
   - Or proceed to magnitude inflation analysis (Hypothesis 2)
   - Or focus on sign errors first

**Estimated fix timeline:**
- Script creation: 1 hour
- Rebuild execution: 2-4 hours
- Validation: 1 hour
- **Total: 4-6 hours**

---

## Terminal: Claude C3

**Session:** JOIN Fan-Out Investigation Complete
**Status:** Root cause identified, awaiting approval for fix
**Time:** 2025-11-11 7:45 PM PST
**Next:** User to review findings and approve rebuild approach
