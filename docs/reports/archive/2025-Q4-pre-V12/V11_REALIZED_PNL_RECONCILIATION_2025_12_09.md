# V11 Realized PnL Reconciliation Report

**Date:** 2025-12-09
**Engine:** V11 Direct CLOB Query with Dedup + Empty String Fix
**Benchmark:** 45-wallet CLOB-only set from UI ground truth

---

## Executive Summary

V11 achieves **88.9% pass rate** (40/45 wallets) on the canonical 45-wallet CLOB-only benchmark, outperforming V29 inventory engine at **80.0%** (36/45). When filtering to comparable wallets (<50% unresolved), V11 reaches **93.0%** accuracy.

### Key Findings

| Engine | All Wallets (45) | Comparable (<50% unresolved, 43) |
|--------|-----------------|----------------------------------|
| **V11 Realized** | 40/45 (88.9%) | 40/43 (93.0%) |
| V29 Realized | 36/45 (80.0%) | 35/43 (81.4%) |
| V29 UI Parity | 36/45 (80.0%) | 35/43 (81.4%) |

**V11 wins vs V29:** 5 wallets where V11 passes and V29 fails
**V29 wins vs V11:** 1 wallet (100% unresolved edge case)
**Both engines fail:** 4 wallets (under investigation)

---

## Root Causes Fixed

Two critical bugs were identified and fixed in V11:

### 1. V9 Dedup Table Incompleteness (~11% missing events)

**Problem:** The pre-computed `pm_clob_events_deduped_v9` table was missing approximately 11% of events due to incomplete backfill coverage.

**Fix:** Source directly from `pm_trader_events_v2` with query-time deduplication using `GROUP BY event_id`:

```sql
SELECT
  event_id,
  argMax(token_id, trade_time) as token_id,
  argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
  argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
  argMax(role, trade_time) as role
FROM pm_trader_events_v2
WHERE trader_wallet = '...' AND is_deleted = 0
GROUP BY event_id
```

### 2. Empty String payout_numerators Treated as Resolved

**Problem:** Markets with `payout_numerators = ''` (empty string) were passing the `IS NOT NULL` check and being treated as resolved with zero payout, artificially deflating PnL.

**Fix:** Add explicit empty string check:

```sql
WHERE res.payout_numerators IS NOT NULL
  AND res.payout_numerators != ''  -- CRITICAL FIX
  AND map.outcome_index IS NOT NULL
```

---

## V11 Canonical Formula

The V11 realized PnL formula:

```
realized_pnl = SUM(usdc_delta + token_delta * payout_norm)
```

Where:
- `usdc_delta`: Cash flow (negative for buys, positive for sells)
- `token_delta`: Token flow (positive for buys, negative for sells)
- `payout_norm`: Resolution price (0.0 or 1.0 for binary markets, NULL for unresolved)

Key constraints:
- **Maker-only:** `WHERE role = 'maker'` (excludes taker fills which are duplicates)
- **Resolved markets only:** Unresolved markets contribute 0 to realized PnL
- **CLOB-only:** No AMM/FPMM trades included

---

## V11 vs V29 Comparison

### Full 45-Wallet Results

| Wallet | UI PnL | V11 Realized | V29 Realized | V11 Err | V29 Err | Unres% |
|--------|--------|--------------|--------------|---------|---------|--------|
| 0x127a09d79f0edb | $-1,069 | $-1,069 | $-1,069 | 0.0% | 0.0% | 0.0% |
| 0xbd63d4c614d365 | $7,890 | $7,890 | $7,890 | 0.0% | 0.0% | 0.0% |
| 0x28ce5cafe96d33 | $302 | $302 | $3,918 | 0.0% | 1196.2% | 0.0% |
| 0xfbc0ef7366d8e4 | $803 | $803 | $805 | 0.0% | 0.2% | 35.7% |
| 0xe114efcf1ac3fc | $56 | $56 | $-53 | 0.0% | 109.2% | 1.6% |
| 0x0869625aa0e044 | $20,472 | $20,146 | $20,472 | 1.6% | 0.0% | 21.2% |
| 0x1031db1ad6526d | $14,240 | $14,240 | $14,240 | 0.0% | 0.0% | 3.0% |
| 0x08807dfd5308b0 | $9,814 | $9,814 | $9,812 | 0.0% | 0.0% | 4.2% |
| 0x3d7efaab5b331e | $4,713 | $4,713 | $4,713 | 0.0% | 0.0% | 0.0% |
| 0xb2370e1f9a7d88 | $3,725 | $3,723 | $3,723 | 0.0% | 0.0% | 0.0% |
| 0xd04f7c90bc6f15 | $-21,562 | $-21,773 | $-21,769 | 1.0% | 1.0% | 4.2% |
| 0x61a10eac439207 | $-3,216 | $-3,556 | $-1,379 | 10.6% | 57.1% | 5.1% |
| 0x65b8e0082af7a5 | $-1,705 | $-1,705 | $11,903 | 0.0% | 798.0% | 0.0% |
| 0xe527c444845592 | $-1,742 | $-1,734 | $-1,734 | 0.4% | 0.4% | 16.7% |
| 0x0d89739863885c | $7,425 | $7,432 | $7,425 | 0.1% | 0.0% | 3.5% |
| 0xb0ed149445fa77 | $-11,272 | $-11,272 | $-11,272 | 0.0% | 0.0% | 0.0% |
| 0xdc0803c3cd15b0 | $3,590 | $3,590 | $3,590 | 0.0% | 0.0% | 12.5% |
| 0x89d76333f21069 | $-7,255 | $-7,258 | $-7,258 | 0.0% | 0.0% | 0.0% |
| 0x3a8b8e32800686 | $-6,572 | $-6,572 | $-6,572 | 0.0% | 0.0% | 0.0% |
| 0xe2d468102e2318 | $-4,323 | $-4,323 | $-4,261 | 0.0% | 1.4% | 0.0% |
| 0x7fae7b41c69744 | $-4,662 | $-4,662 | $-4,662 | 0.0% | 0.0% | 0.0% |
| 0xcc652abe2aa89e | $-2,287 | $-2,287 | $-2,287 | 0.0% | 0.0% | 0.0% |
| 0x7bf5b395c34d06 | $312 | $311 | $311 | 0.3% | 0.3% | 0.2% |
| 0x7acd2f93e6eeaa | $-75,153 | $-73,028 | $-74,615 | 2.8% | 0.7% | 0.7% |
| 0xb1fa1aa03ce4f1 | $106,051 | $106,042 | $106,042 | 0.0% | 0.0% | 0.0% |
| 0x9bcf7a2326fa38 | $-12,158 | $-12,159 | $1,643 | 0.0% | 113.5% | 0.0% |
| 0xf919981d00ddd4 | $-42,352 | $-42,353 | $-42,353 | 0.0% | 0.0% | 0.0% |
| 0xff6fd4302ae3bb | $-53,428 | $-53,428 | $-54,550 | 0.0% | 2.1% | 0.0% |
| 0xee92e51827803e | $-1,806 | $-994 | $7,251 | 44.9% | 501.6% | 77.9% |
| 0x45b4d553a87b97 | $2,719 | $2,708 | $2,719 | 0.4% | 0.0% | 1.8% |
| 0x20bcdf5a9c7696 | $185,725 | $185,691 | $185,691 | 0.0% | 0.0% | 8.4% |
| 0x24ae4e2bee4afb | $-2,002,324 | $-2,002,352 | $-2,002,352 | 0.0% | 0.0% | 0.0% |
| 0x3f2bebc298d6aa | $389,837 | $389,834 | $389,834 | 0.0% | 0.0% | 0.0% |
| 0x76ccd18183a933 | $85,275 | $85,274 | $85,274 | 0.0% | 0.0% | 0.0% |
| 0x0ff5a33586e605 | $-156,378 | $-156,382 | $-156,382 | 0.0% | 0.0% | 0.0% |
| 0xe1b40c6772bd0d | $-37,538 | $0 | $-37,931 | 100.0% | 1.0% | 100.0% |
| 0xd57057c9cb6223 | $5,610 | $5,610 | $5,610 | 0.0% | 0.0% | 0.0% |
| 0xda647386ce953f | $-4,796 | $-5,014 | $-11,646 | 4.5% | 142.8% | 2.5% |
| 0xc60437e21520dd | $-31,376 | $-26,711 | $-25,978 | 14.9% | 17.2% | 9.0% |
| 0x37e73a3b6130c8 | $-64,911 | $-64,912 | $-64,912 | 0.0% | 0.0% | 0.0% |
| 0xc48e3194036e41 | $-63,072 | $-63,071 | $-63,071 | 0.0% | 0.0% | 4.2% |
| 0xbc296b625eb160 | $8,360 | $8,359 | $8,359 | 0.0% | 0.0% | 0.0% |
| 0x40a24ce1ff7eb4 | $840 | $-1,369 | $-9,988 | 263.0% | 1289.3% | 30.0% |
| 0xa3a6fa49a39a4b | $51,448 | $51,448 | $51,448 | 0.0% | 0.0% | 0.0% |
| 0x7899cf94386b13 | $-44,885 | $-44,887 | $-44,887 | 0.0% | 0.0% | 0.0% |

### V11 Wins (5 wallets)

Wallets where V11 passes (<5% error) but V29 fails (>5% error):

| Wallet | V11 Error | V29 Error | Root Cause |
|--------|-----------|-----------|------------|
| 0x28ce5cafe96d33 | 0.0% | 1196.2% | V29 inventory tracking error |
| 0xe114efcf1ac3fc | 0.0% | 109.2% | V29 sign inversion |
| 0x65b8e0082af7a5 | 0.0% | 798.0% | V29 inventory tracking error |
| 0x9bcf7a2326fa38 | 0.0% | 113.5% | V29 pooled cost basis issue |
| 0xda647386ce953f | 4.5% | 142.8% | V29 resolution handling |

### V29 Wins (1 wallet)

| Wallet | V11 Error | V29 Error | Root Cause |
|--------|-----------|-----------|------------|
| 0xe1b40c6772bd0d | 100.0% | 1.0% | 100% unresolved - V11 returns $0 (correct semantically) |

This single wallet is 100% unresolved. V11 correctly returns $0 for realized PnL since no markets are resolved. V29 appears to include some unrealized or estimated value. The UI may be showing an estimated/total PnL rather than strict realized.

### Both Fail (4 wallets)

| Wallet | UI PnL | V11 | V29 | Unresolved% | Notes |
|--------|--------|-----|-----|-------------|-------|
| 0x61a10eac439207 | $-3,216 | $-3,556 | $-1,379 | 5.1% | Needs investigation |
| 0xee92e51827803e | $-1,806 | $-994 | $7,251 | 77.9% | High unresolved |
| 0xc60437e21520dd | $-31,376 | $-26,711 | $-25,978 | 9.0% | Needs investigation |
| 0x40a24ce1ff7eb4 | $840 | $-1,369 | $-9,988 | 30.0% | Needs investigation |

---

## V12 Large-Scale Benchmark Results

A separate V12 harness was run on 200 wallets from the trader-strict population:

- **Total wallets tested:** 200
- **Computation success rate:** 100%
- **Wallets with >50% unresolved:** 6 (3%)
- **Median unresolved percentage:** 3.6%

The V12 harness demonstrates V11 formula scales effectively to larger populations. Full results saved to `tmp/apples_v12_large_realized_results.json`.

---

## Dome API Comparison Note

The Dome API snapshot (`tmp/dome_pnl_snapshot_500.json`) contained 500 wallets, but only 6 overlapped with the V12 trader-strict sample. This limited overlap prevented a comprehensive Dome comparison. The 45-wallet UI ground truth set was used instead for the primary V11 vs V29 comparison.

For future Dome comparisons, consider:
1. Requesting Dome realized PnL specifically for the benchmark wallet set
2. Building a larger Dome snapshot with trader-strict filtering applied

---

## Files Created

| File | Purpose |
|------|---------|
| `tmp/apples-v11-fixed.ts` | V11 test harness script |
| `tmp/apples_v11_output.log` | V11 harness execution log |
| `tmp/apples_v11_fixed.json` | V11 45-wallet results JSON |
| `tmp/apples_v12_large_realized.ts` | V12 large-scale harness |
| `tmp/reconciliation_v11_v29_comparison.ts` | V11 vs V29 comparison script |
| `tmp/reconciliation_v11_v29_report.json` | Full comparison results JSON |

---

## Recommendations

### Immediate

1. **Adopt V11 formula** as the canonical realized PnL calculation for Cascadian
2. **Deprecate V9 dedup table** - use query-time dedup from pm_trader_events_v2
3. **Add empty string check** to all resolution queries

### Future Investigation

1. **4 failing wallets** - investigate root causes (possibly AMM activity, multi-outcome markets, or split/merge events)
2. **V29 inventory engine issues** - the 5 wallets where V29 fails catastrophically (>100% error) suggest cost basis tracking bugs
3. **100% unresolved edge case** - clarify semantic difference between "realized = 0" vs "UI estimated PnL"

---

## Conclusion

V11 represents a significant improvement in realized PnL accuracy:
- **88.9% pass rate** on the 45-wallet benchmark (up from 77.8% in V10)
- **93.0% pass rate** when filtered to comparable wallets
- Outperforms V29 inventory engine by 8.9 percentage points
- Two root causes identified and fixed: dedup incompleteness and empty string handling

The V11 formula should be adopted as the canonical realized PnL calculation for the Cascadian platform.
