# PATH B Analysis - NOT VIABLE

## Executive Summary

PATH B (Hybrid approach using USDC transfer proximity) is **NOT VIABLE** due to data mismatch between tables.

## Analysis Results

### 1. Data Availability
- **trades_raw**: 159M trades (77.4M missing condition_ids)
- **erc20_transfers_decoded**: 21M transfers
- **Time overlap**: NONE

### 2. Time Range Mismatch

**trades_raw**:
- First trade: 1970-01-01 00:00:00
- Last trade: 2025-10-26 17:29:47
- Time span: ~55 years (likely epoch 0 errors)

**erc20_transfers_decoded**:
- First transfer: 2025-11-08 02:01:02
- Last transfer: 2025-11-08 02:01:02
- Time span: SINGLE TIMESTAMP

**Conclusion**: The decoded table only contains data from November 8, 2025, while trades span historical data. Zero overlap means zero recovery possible.

### 3. Sample Test Results

**Test**: 1000 random missing trades checked for USDC proximity (±180s)
**Result**: 0 out of 1000 had matching transfers
**Coverage**: 0.0%

## Why PATH B Failed

1. **Incomplete decoded table**: Only 21M of 387M transfers are decoded
2. **Wrong time range**: Decoded table is Nov 8 only (today)
3. **No historical data**: Cannot match historical trades to today's transfers

## Alternative Paths Forward

### PATH A: Full blockchain scan (41M blocks)
- **Pros**: Complete coverage, definitive answer
- **Cons**: 12-24 hours runtime, expensive RPC calls
- **Status**: Original plan, still viable

### PATH C: Condition ID inference from market_id
- **Pros**: Fast (minutes), no RPC calls needed
- **Cons**: Only works if market_id → condition_id mapping exists
- **Status**: Need to investigate if mapping exists

### PATH D: Use erc20_transfers_staging directly
- **Pros**: 387M transfers, full historical coverage
- **Cons**: Need to decode topics/data on the fly, slower queries
- **Status**: Worth investigating

## Recommendation

1. **Immediate**: Check PATH C viability (market_id mapping)
2. **If PATH C fails**: Investigate PATH D (decode staging on the fly)
3. **Last resort**: Execute PATH A (full blockchain scan)

## Time Estimates

- **PATH C**: 15-30 minutes (if mapping exists)
- **PATH D**: 2-4 hours (decoding + matching)
- **PATH A**: 12-24 hours (full RPC scan)

## Files Created

- `/Users/scotty/Projects/Cascadian-app/path-b-sizing.ts`
- `/Users/scotty/Projects/Cascadian-app/path-b-quick-check.ts`
- `/Users/scotty/Projects/Cascadian-app/check-time-ranges.ts`
- `/Users/scotty/Projects/Cascadian-app/check-schemas.ts`

## Next Action

**User decision required**: Which path should we pursue?
- PATH C (fast, market_id mapping)
- PATH D (medium, decode staging)
- PATH A (slow, full blockchain scan)
