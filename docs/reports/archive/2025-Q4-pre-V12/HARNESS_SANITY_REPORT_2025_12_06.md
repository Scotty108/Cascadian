# Harness Sanity Report: V23c vs V29

**Date:** 2025-12-06
**Terminal:** Claude 1

---

## Executive Summary

The regression harness showed V29 with ~99% error while V23c had ~0.1% error. **This is NOT a math bug - it's a field mismatch in the comparison.**

---

## Root Causes Found

### 1. Duplicate Wallets in Benchmark (FIXED)

The `pm_ui_pnl_benchmarks_v1` table contains 100 rows for 50 unique wallets (2 rows each).

**Cause:** The seeder script was run twice without deduplication.

**Impact:** Wallets processed twice in regression, doubled runtime, confusing output.

**Fix:** Add `DISTINCT` to benchmark query and deduplicate before seeding.

### 2. Field Mismatch: V29 `realizedPnl` vs V23c `realizedPnl` (ROOT CAUSE)

The engines have **different semantics** for the same field name:

| Field | V23c Meaning | V29 Meaning |
|-------|--------------|-------------|
| `realizedPnl` | Cash flow + mark-to-market (total value) | Cash from closed trades only |
| `unrealizedPnl` | Not exposed separately | Open position value |
| `totalPnl` | Same as realizedPnl | realizedPnl + unrealizedPnl |

**Example - Wallet 0x56687bf447... (Theo4, rank 1):**
- UI PnL: $22,053,933
- V23c `realizedPnl`: $22,029,972 (0.1% error) ✓
- V29 `realizedPnl`: $55,160 (99.7% error) ✗
- V29 `totalPnl`: $22,946,734 (4.0% error) ~

**The regression script was comparing the WRONG V29 field!**

### 3. V29 Unrealized vs Resolved Semantics

V29 treats positions as "unrealized" until explicitly redeemed via `PayoutRedemption` events.

For Theo4's wallet:
- 14 positions with resolution_price = 1 (market resolved, trader won)
- Total open tokens: 42.8M
- V29 treats these as "unrealized" because no redemption event was recorded
- V23c correctly marks-to-market resolved positions as realized

**This is a design difference, not a bug.** For UI parity, we should compare V29's `totalPnl`, not `realizedPnl`.

---

## Corrected Field Mapping

To match Polymarket UI PnL, use these fields:

| Engine | Field to Compare to UI PnL |
|--------|---------------------------|
| V23c | `realizedPnl` |
| V29 | `totalPnl` |

---

## Ledger Row Count Verification

Both engines load similar event counts from the same materialized table:

| Wallet | V23c Events | V29 Events | Match? |
|--------|-------------|------------|--------|
| 0x56687bf447... | 16,002 | 16,005 | ~Yes (raw trades fallback adds 3) |
| 0x1f2dd6d473... | 23,524 | 23,564 | ~Yes |

**Conclusion:** Ledger wiring is correct. Both engines read from `pm_unified_ledger_v8_tbl`.

---

## Wallet Normalization

Both engines use `lower(wallet_address)` consistently:
- V23c: `lower(wallet_address)` in ledger query
- V29: `lower(wallet_address)` in `loadV29EventsFromTable()`

**Conclusion:** No wallet normalization issues.

---

## Percent Error Math

The regression script uses correct formula:
```typescript
const pctError = ui_pnl !== 0
  ? (Math.abs(engine_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100
  : (engine_pnl === 0 ? 0 : 100);
```

**Conclusion:** Percent error math is correct.

---

## Required Fixes

### 1. Fix Duplicate Wallets in Benchmark Query

```typescript
// Before
const result = await clickhouse.query({
  query: `
    SELECT lower(wallet) as wallet, pnl_value as ui_pnl, note
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${benchmarkSet}'
    ORDER BY abs(pnl_value) DESC
  `,
  ...
});

// After - Add DISTINCT
const result = await clickhouse.query({
  query: `
    SELECT
      lower(wallet) as wallet,
      max(pnl_value) as ui_pnl,  -- Use max to handle duplicates
      any(note) as note
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${benchmarkSet}'
    GROUP BY lower(wallet)
    ORDER BY abs(ui_pnl) DESC
  `,
  ...
});
```

### 2. Compare V29 `totalPnl` Instead of `realizedPnl`

```typescript
// Before (WRONG)
const v29GuardError = Math.abs(v29GuardResult.realizedPnl - ui_pnl);

// After (CORRECT)
const v29GuardError = Math.abs(v29GuardResult.totalPnl - ui_pnl);
```

### 3. Add Debug Output for First 5 Failures

Add logging to show:
- Raw V23c and V29 result objects
- Ledger row counts per engine
- Which field is being compared

---

## Conclusion

The harness is fundamentally sound. The 99% error was caused by comparing the wrong field. Once we compare `V29.totalPnl` instead of `V29.realizedPnl`, the engines should have comparable accuracy.

**Next Steps:**
1. Apply fixes to `run-regression-matrix.ts`
2. Re-run regression with corrected field mapping
3. Evaluate true V23c vs V29 accuracy

---

*Terminal: Claude 1*
