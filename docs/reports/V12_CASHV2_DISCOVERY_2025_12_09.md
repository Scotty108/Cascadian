# V12CashV2 Discovery Report - CLOB Dedup & PositionsMerge Fix

**Date:** 2025-12-09
**Terminal:** Claude 1
**Status:** Critical bug fix identified and implemented

## Executive Summary

Investigation of the V12 Dual Benchmark results (8% Synthetic pass rate, 6% Cash pass rate vs Dome) uncovered **two critical bugs** in the V12Cash calculator:

1. **CLOB duplicates in V8 ledger** - 1.5-2.1x inflation per wallet
2. **Missing PositionsMerge source type** - CTF complete-set redemptions not counted

These bugs caused V12Cash to show massive negative values when the true cash flow was positive.

## Bug Details

### Bug 1: CLOB Duplicates (1.5-2.1x inflation)

The `pm_unified_ledger_v8_tbl` CLOB data has duplicates per wallet:

```
Wallet 0xe62d...:
- Total CLOB rows: 43,304
- Unique event_ids: 28,469
- Duplicate ratio: 1.52x
```

**Impact:**
- Raw CLOB sum: -$3,718,812
- Deduped CLOB sum: -$1,780,944
- **Inflation: $1,937,868 (109% overcounted)**

### Bug 2: Missing PositionsMerge

V12Cash only counted `CLOB` + `PayoutRedemption` but missed `PositionsMerge`:

```
Source types for wallet 0xe62d...:
- CLOB: 43,304 events, -$3.72M raw / -$1.78M deduped
- PayoutRedemption: 769 events, +$282K
- PositionsMerge: 732 events, +$2.12M  ← NOT COUNTED!
- PositionSplit: 7 events, -$108
```

`PositionsMerge` represents CTF complete-set redemptions (redeeming both YES and NO tokens for USDC).

## Before vs After (Wallet 0xe62d...)

| Metric | V12Cash (old) | V12CashV2 (fixed) | Dome API |
|--------|--------------|-------------------|----------|
| CLOB | -$3,718,812 | -$1,780,944 (deduped) | - |
| PayoutRedemption | +$282,273 | +$279,093 | - |
| PositionsMerge | $0 (missing) | +$2,123,664 | - |
| **Total** | **-$3,436,539** | **+$621,813** | +$71,046 |

## V12CashV2 Formula

```sql
WITH
  -- Dedupe CLOB events by event_id
  clob_deduped AS (
    SELECT event_id, any(usdc_delta) as usdc_delta
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower({wallet})
      AND source_type = 'CLOB'
    GROUP BY event_id
  ),
  -- Non-CLOB events (PayoutRedemption, PositionsMerge)
  non_clob AS (
    SELECT source_type, usdc_delta
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower({wallet})
      AND source_type IN ('PayoutRedemption', 'PositionsMerge')
  )
SELECT
  sum(clob_deduped.usdc_delta) +
  sum(non_clob.usdc_delta) as realized_cash
```

## Files Modified

- **`lib/pnl/realizedPnlV12Cash.ts`**
  - Added `calculateRealizedPnlV12CashV2()` with:
    - CLOB deduplication via `GROUP BY event_id`
    - PositionsMerge included in cash sources
    - Case-insensitive wallet matching

## Remaining Gap Analysis

V12CashV2 shows +$621,813 vs Dome's +$71,046 for wallet 0xe62d...

Possible explanations:
1. **Time period mismatch** - Dome may use different date ranges
2. **Additional filters** - Dome may exclude certain conditions/markets
3. **Source type definitions** - PositionsMerge handling differs
4. **Different wallets** - Multiple wallets starting with 0xe62d in system

## Recommendations

1. **Re-run dual benchmark** with V12CashV2 to measure improved pass rate
2. **Investigate PositionsMerge semantics** - may need sign convention check
3. **Verify wallet address matching** in benchmark dataset

## Next Steps

- Update benchmark script to use `calculateRealizedPnlV12CashV2`
- Run full 50-wallet benchmark
- Compare V12CashV2 pass rate vs old V12Cash (expected: significant improvement)
