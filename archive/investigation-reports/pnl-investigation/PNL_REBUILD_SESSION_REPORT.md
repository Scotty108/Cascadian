# P&L Rebuild Session Report - ERC1155 Implementation

**Date**: 2025-11-12
**Terminal**: Claude 1
**Status**: 🔨 **IN PROGRESS** - Phases 1-4 Complete, Issues Identified

---

## Executive Summary

Attempted to rebuild P&L pipeline using ERC1155 blockchain data to recover the $52K gap identified in investigation. **Phases 1-4 completed successfully** but results show **new issues** requiring investigation before proceeding.

### Current Results

| Metric | CLOB Baseline | Blockchain (New) | Dome Target | Status |
|--------|---------------|------------------|-------------|--------|
| **P&L** | $34,990.56 | **$9,866.55** | $87,030.51 | ❌ Worse than CLOB |
| **Markets** | 43 | **30** | Unknown | ❌ Missing 13 markets |
| **Variance** | -59.8% | **-88.7%** | Target: <2% | ❌ Higher variance |

---

## What We Accomplished

### ✅ Phase 1: Backup & Safety (COMPLETE)
- Backed up test wallet P&L baseline ($34,990.56)
- Backed up 43 positions
- Saved view definitions
- **Verified data availability**: 249 ERC1155 transfers vs 194 CLOB fills (55 missing transactions confirmed)

### ✅ Phase 2: ERC1155 Position Tracking (COMPLETE - WITH ISSUES)
- Created `outcome_positions_v2_blockchain` view
- Successfully converted hex token_ids to decimal for joining with `ctf_token_map`
- **Result**: 25 positions found (vs 43 from CLOB)
- **Issue**: Missing 18 positions despite having more blockchain data

**Key Discovery**: Token ID format mismatch required conversion:
```sql
toString(reinterpretAsUInt256(reverse(unhex(substring(t.token_id, 3)))))
```

### ✅ Phase 3: Hybrid Cashflow Calculation (COMPLETE - PARTIAL DATA)
- Created `trade_cashflows_v3_blockchain` view
- Hybrid approach: ERC1155 positions + CLOB prices where available
- **Result**: 25 cashflow entries, $3,880.60 total
- **Coverage**: Only 4/25 entries have CLOB pricing (21 missing prices)

### ✅ Phase 4: P&L Calculation (COMPLETE - INCORRECT RESULTS)
- Created `realized_pnl_by_market_blockchain` view
- Fixed outcome label mapping (Yes=0, No=1, Up=0, Down=1, etc.)
- **Result**: $9,866.55 total P&L across 30 markets
- **Issue**: P&L is LOWER than CLOB baseline, not higher

---

## Critical Issues Identified

### Issue 1: Duplicate Entries
```
Top 10 results show duplicates:
- Row 6 & 7: a0811c97f529... identical
- Row 8 & 9: c7599c7b33b6... identical
```
**Impact**: Inflating market count but may be canceling out in totals

### Issue 2: Missing Markets
- Blockchain shows 25 positions
- CLOB shows 43 positions
- Current view shows 30 entries (with duplicates)
- **Missing**: 13-18 markets depending on how duplicates are handled

### Issue 3: Missing Cashflow Data
- Only 4/25 entries have CLOB pricing
- 21 entries have $0 cashflow
- **Root Cause**: CLOB fills don't cover all ERC1155 transfers

### Issue 4: Lower P&L Than CLOB
- Expected: ERC1155 would ADD missing $52K
- Actual: ERC1155 REMOVED $25K from baseline
- **This suggests formula or data mapping issues**

---

## Root Cause Analysis

### Why Are We Missing Markets?

**Hypothesis 1**: Token ID Conversion Issues
- The `reinterpretAsUInt256` conversion works for samples
- But may fail for certain token formats
- Need to check conversion success rate

**Hypothesis 2**: Self-Transfer Filter Too Aggressive
```sql
WHERE t.to_address != t.from_address  -- May exclude valid trades
```

**Hypothesis 3**: Outcome Index Mismatches
- Binary mapping (Yes=0, No=1) works for common cases
- May fail for multi-outcome or categorical markets
- Sports markets (Celtics, Thunder, etc.) not handled

### Why Is P&L Lower?

**Hypothesis 1**: Missing Cashflow = Negative Impact
- Positions without CLOB pricing get $0 cashflow
- Formula: `cashflow + shares` means these positions only count shares
- If many losing positions, this REDUCES P&L

**Hypothesis 2**: Duplicate Counting
- Duplicates may be creating offsetting entries
- Need to investigate GROUP BY in position calculation

**Hypothesis 3**: Incomplete Data in ERC1155
- ERC1155 may not capture all position types
- Settlement redemptions may not be included
- Direct transfers may be missing

---

## Files Created

### Phase Scripts
- ✅ `scripts/phase1-backup-critical-data.ts` - Backup script
- ✅ `scripts/phase2-build-erc1155-positions.ts` - Position tracking
- ✅ `scripts/phase3-build-hybrid-cashflow.ts` - Cashflow calculation
- ✅ `scripts/phase4-rebuild-pnl.ts` - P&L calculation

### Debug Scripts
- ✅ `scripts/debug-erc1155-conversion.ts` - Hex conversion testing
- ✅ `scripts/debug-position-changes.ts` - CTE flow analysis
- ✅ `scripts/debug-token-id-join.ts` - Token ID format debugging
- ✅ `scripts/test-hex-parsing.ts` - Hex parsing methods
- ✅ `scripts/analyze-outcome-mapping.ts` - Outcome label mapping

### Views Created
- ✅ `outcome_positions_v2_blockchain` - ERC1155-based positions
- ✅ `trade_cashflows_v3_blockchain` - Hybrid cashflow
- ✅ `realized_pnl_by_market_blockchain` - P&L calculation

### Backups
- ✅ `tmp/pnl_baseline_20251112T061723.json` - Current P&L
- ✅ `tmp/positions_baseline_20251112T061723.json` - Current positions
- ✅ `tmp/view_definitions_20251112T061723.json` - View DDL

---

## Recommendations

### Immediate (Before Phase 5)

**DO NOT PROCEED to Phase 5 validation until issues are resolved.**

1. **Investigate Duplicates**
   - Query `outcome_positions_v2_blockchain` directly to check for duplicates
   - Add DISTINCT or GROUP BY to eliminate duplicates
   - Verify why same condition_id + outcome_idx appears multiple times

2. **Analyze Missing Markets**
   - Compare CLOB markets vs ERC1155 markets (condition_id lists)
   - Identify which 18 markets are missing from blockchain view
   - Check if missing markets have transfers in erc1155_transfers

3. **Fix Cashflow Attribution**
   - For ERC1155-only positions (no CLOB data), use settlement price
   - Implement fallback: `if(cashflow = 0, net_shares * 0.5, cashflow + net_shares)`
   - Or join with price history to get entry/exit prices

4. **Validate Outcome Mapping**
   - Check non-binary markets (sports, categorical)
   - Build comprehensive outcome label → index mapping table
   - Handle edge cases beyond Yes/No/Up/Down

### Alternative Approach

**Consider reverting to CLOB with targeted fixes:**
- Keep CLOB as primary data source (proven $34,990.56 baseline)
- Identify specific missing 55 transactions
- Add only those specific transactions to supplement CLOB
- This would be faster and lower risk than full ERC1155 rebuild

---

## Decision Point

**Option A**: Fix ERC1155 Implementation
- **Time**: 4-8 hours additional debugging
- **Risk**: HIGH - multiple unknowns
- **Upside**: Complete blockchain data coverage

**Option B**: Targeted CLOB Supplement
- **Time**: 2-3 hours to identify + add missing transactions
- **Risk**: MEDIUM - working from proven baseline
- **Upside**: Faster path to $87K target

**Option C**: Hybrid Approach
- Use CLOB for markets where it works (43 markets, $34,990.56)
- Use ERC1155 only for the 55 missing transactions
- **Time**: 3-4 hours
- **Risk**: MEDIUM
- **Upside**: Best of both worlds

---

## Next Steps

**STOP HERE** and decide on approach before proceeding:

1. Review this report
2. Choose Option A, B, or C
3. If Option A: Debug duplicates and missing markets
4. If Option B: Identify the 55 missing CLOB transactions
5. If Option C: Build targeted supplement pipeline

**Do not proceed to Phase 5 validation with current -88.7% variance.**

---

**Terminal**: Claude 1
**Session**: P&L Rebuild - ERC1155 Implementation
**Status**: Paused for review
**Generated**: 2025-11-12 (PST)
