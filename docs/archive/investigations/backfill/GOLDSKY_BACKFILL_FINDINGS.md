# Goldsky Backfill Investigation - Final Findings

## Executive Summary

**Original Problem:** Wallet `0x4ce73141dbfce41e65db3723e31059a730f0abad` shows $332K P&L on Polymarket but $0 in our system.

**Hypothesis:** Missing payout vectors causing zero P&L calculations.

**Finding:** ❌ **Hypothesis REJECTED**. We already have comprehensive payout coverage.

---

## Data Coverage Analysis

### Current State

| Source | Unique Conditions | Date Range | Notes |
|--------|------------------|------------|-------|
| `market_resolutions_final` | 157,319 | 1970-2027 | From blockchain backfill |
| `resolutions_external_ingest` | 8,685 | Nov 9, 2025 | From Goldsky API |
| **Overlap** | 8,541 | - | 98.3% of Goldsky data already exists |
| **Net New from Goldsky** | 144 | - | Only 0.17% unique contribution |
| **Total Unique Payouts** | **157,463** | - | ✅ **Matches Dune Analytics** |

### Dune Analytics Baseline

- Expected resolved markets: 130,000 - 150,000
- Our coverage: 157,463 unique conditions
- **Status: ✅ EXCEEDS BASELINE** (+7K to +27K conditions)

---

## Root Cause Analysis

### What We Learned

1. **Goldsky has pagination limits** - Cannot skip beyond ~8,685 conditions
2. **Goldsky data is SUBSET of blockchain data** - 98.3% overlap means Goldsky is not the primary source
3. **Blockchain backfill already captured comprehensive data** - 157K conditions from on-chain events
4. **Payout coverage is NOT the issue** - We have more data than Dune Analytics baseline

### Why Goldsky Didn't Help

- Goldsky Subgraph indexes on-chain events (same source as our blockchain backfill)
- Our blockchain backfill is more comprehensive (157K vs 8.6K)
- Goldsky only added 144 net new conditions (0.09% improvement)

---

## Technical Discoveries

### ClickHouse Array Bug

**Issue:** ClickHouse Node.js client cannot insert decimal Float64 arrays using `JSONEachRow` format.

**Symptom:**
```
ClickHouseError: Cannot read array from text, expected comma or end of array, found '.'
```

**Root Cause:** Table was created with `Array(UInt32)` instead of `Array(Float64)`, truncating decimals to 0.

**Fix:**
1. Recreated table with `Array(Float64)`
2. Used raw INSERT queries instead of `client.insert()` with JSONEachRow
3. Manual array serialization: `[${array.join(',')}]`

### Data Insights

- Only ~3% of Polymarket payouts have decimal values (e.g., `[0.54, 0.46]`)
- Most payouts are binary: `[1, 0]` or `[0, 1]`
- `market_resolutions_final` contains blockchain-sourced payouts (more comprehensive)
- Goldsky Subgraph has subset of blockchain data

---

## Next Steps - Real P&L Issue

Since payout coverage is comprehensive, the $332K discrepancy must be caused by:

### Hypothesis 2: Trade-to-Condition Mapping Issue

**Check:**
1. Do wallet's trades have `condition_id` populated?
2. Are trades joining correctly to `market_resolutions_final`?
3. Are there zero-ID trades or malformed condition IDs?

### Hypothesis 3: Position Lifecycle Calculation

**Check:**
1. Are positions being aggregated correctly from trades?
2. Is the FIFO calculation working for cost basis?
3. Are redemptions being tracked?

### Hypothesis 4: P&L View Join Bug

**Check:**
1. Are `vw_wallet_pnl_*` views joining on normalized condition_ids?
2. Is there a FixedString casting issue?
3. Are resolution timestamps causing join mismatches?

---

## Files Created

1. `backfill-all-goldsky-payouts.ts` - Goldsky backfill script (fixed for decimals)
2. `create-resolutions-table.ts` - Table creation with Float64 arrays
3. `investigate-goldsky-data.ts` - Data overlap analysis
4. `test-goldsky-format.ts` - API response format testing
5. `test-insert-payout.ts` - ClickHouse array insertion testing
6. `test-fixed-insertion.ts` - Decimal array insertion validation

---

## Conclusions

✅ **Payout coverage is SOLVED** - 157K unique payouts exceed Dune Analytics baseline
❌ **P&L discrepancy still EXISTS** - Root cause is NOT missing payout data
🔍 **Next investigation** - Focus on trade matching, position calculation, or P&L view joins

**Recommendation:** Trace wallet `0x4ce7` trades through the full P&L calculation pipeline to find where $332K is being lost.
