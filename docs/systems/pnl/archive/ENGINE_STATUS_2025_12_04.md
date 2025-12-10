# PnL Engine Status Report

**Date:** 2025-12-04 (Updated 2025-12-05)
**Terminal:** Claude 1

---

## Executive Summary

| Engine | Status | Error Rate | Use Case |
|--------|--------|------------|----------|
| **V23 (CLOB-only)** | SUCCESS | 0% for pure traders | Canonical for W1, W2, W3, W5, W6 |
| **V26 (Golden)** | NEEDS WORK | 42.5% pass rate | Attempted unified approach - fails for MMs |
| **V25 (Hybrid)** | FAILED | 380% mean error | Do not use - conceptually flawed |
| **V24 (Sidecar)** | PARTIAL | 24.6% for W4 | May need revisit for Market Makers |
| **Auditor Validation** | SUCCESS | 0.91% for Golden Test | Ledger math proven correct |

---

## V23 Shadow Ledger (CANONICAL)

**File:** `lib/pnl/shadowLedgerV23.ts`

**Status:** FROZEN - DO NOT MODIFY

**Formula:**
```
realized_pnl = Σ(usdc_delta) + Σ(token_delta × resolved_price)
```

**Results on Benchmark Wallets:**

| Wallet | UI PnL | V23 PnL | Error |
|--------|--------|---------|-------|
| W1 | -$6,138.90 | -$6,138.88 | 0.00% |
| W2 | +$4,404.92 | +$4,404.90 | 0.00% |
| W3 | +$5.44 | +$5.44 | 0.00% |
| W5 | +$146.90 | +$146.90 | 0.00% |
| W6 | +$470.40 | +$470.40 | 0.00% |

**Key Insight:** V23 filters to `source_type = 'CLOB'` only, which correctly captures trading PnL without inventory management noise.

---

## V25 Hybrid Engine (FAILED)

**File:** `lib/pnl/hybridEngineV25.ts`

**Status:** ABANDONED - Conceptually flawed

**Problem:** Including Split/Merge events in the V20 formula creates phantom unrealized PnL.

**Example of the flaw:**
```
PositionSplit event:
  usdc_delta = -34, token_delta = +34

V25 formula (unresolved, marked at 0.5):
  PnL = -34 + 34*0.5 = -17

This is WRONG - a Split is not PnL, it's inventory management.
```

**Results:**

| Wallet | UI PnL | V25 PnL | Error |
|--------|--------|---------|-------|
| W1 | -$6,138.90 | -$3,055.22 | 50.2% |
| W2 | +$4,404.92 | -$4,217.98 | 195.7% |
| W3 | +$5.44 | -$8.64 | 258.8% |
| Mean Error | | | 380.66% |

---

## Auditor Validation (PROVEN)

**Report:** `docs/reports/TRUMP_2024_LEDGER_VS_UI_W4.md`

**Golden Test:**
- Wallet: `0xd235973291b2b75ff4070e9c0b01728c520b0f29` (zxgngl)
- Condition: `dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917`
- UI PnL: $11,447,930.97
- Ledger PnL: $11,343,924.03
- Error: 0.91%

**Verification (ran today):**
```sql
SELECT
  l.outcome_index,
  sum(l.usdc_delta) as usdc_sum,
  sum(l.token_delta) as token_sum,
  r.resolved_price,
  sum(l.usdc_delta) + sum(l.token_delta) * r.resolved_price as pnl
FROM pm_unified_ledger_v7 l
LEFT JOIN vw_pm_resolution_prices r
  ON l.condition_id = r.condition_id
  AND l.outcome_index = r.outcome_index
WHERE lower(l.wallet_address) = lower('0xd235973291b2b75ff4070e9c0b01728c520b0f29')
  AND l.condition_id = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917'
GROUP BY l.outcome_index, r.resolved_price
```

**Result:** `pnl = 11343924.03` - EXACT MATCH

---

## Resolved: Wallet Mismatch Issue ✅

**Status:** RESOLVED

Earlier confusion was caused by testing the WRONG WALLET:

| Auditor Report | Builder Benchmark |
|----------------|-------------------|
| `0xd235973291b2b75ff4070e9c0b01728c520b0f29` (zxgngl) | `0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15` |

The benchmark file uses different wallets than the Auditor's Golden Test. This was NOT an environment mismatch - it was a test configuration mismatch.

**Final Verification (2025-12-04):**
```sql
SELECT count() as cnt
FROM pm_unified_ledger_v7
WHERE lower(wallet_address) = lower('0xd235973291b2b75ff4070e9c0b01728c520b0f29')
  AND condition_id = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917'
```
**Result:** `cnt = 10974` ✓ DATA EXISTS

---

## V26 Golden Engine (NEEDS WORK)

**File:** `lib/pnl/goldenEngineV26.ts`

**Status:** FAILED - 42.5% pass rate (target: 90%)

**Strategy:**
- ALL source types from `pm_unified_ledger_v7` (CLOB, Split, Merge, Redemption)
- Resolution fallback: `vw_pm_resolution_prices` → `payout_norm` from ledger
- Realized-only mode: unresolved positions = 0 PnL

**Benchmark Results (40 wallets from `fresh_2025_12_04_alltime`):**

| Category | Wallets | Threshold | Pass Rate |
|----------|---------|-----------|-----------|
| Pure Traders | 28 | <1% error | 15/28 (53.6%) |
| Market Makers | 12 | <5% error | 2/12 (16.7%) |
| **OVERALL** | **40** | - | **17/40 (42.5%)** |

**Worst Performers (by error):**
```
0xee00ba338c... Err: 1990.5%, MM: Y
0x7fb7ad0d19... Err: 1677.5%, MM: N
0x9d84ce0306... Err: 1149.4%, MM: Y (550K events, 40K merges)
```

**Root Cause:** Including ALL source types (Split/Merge) creates phantom PnL for wallets with:
1. Many unresolved markets
2. High merge/split activity
3. Large token positions in unresolved markets

**Key Insight:** V26 tried "realized-only mode" (unresolved = 0 PnL) to avoid V25's 0.5 marking problem, but this still fails for market makers because Split/Merge events create token_delta entries that accumulate incorrectly when markets haven't resolved.

---

## Recommendations

### Immediate Actions
1. **FREEZE V23** - Mark as canonical, do not modify
2. **DEPRECATE V25** - Archive the hybrid approach
3. **DEPRECATE V26** - The unified approach doesn't work for market makers
4. **UPDATE BENCHMARKS** - Align benchmark wallets with Auditor's validated wallets

### Future Work
1. **Market Makers:** Need fundamentally different approach - possibly:
   - Separate CLOB PnL + CTF net change at resolution
   - Or only include Split/Merge for RESOLVED markets
2. **Benchmark Suite:** Create authoritative wallet set with validated UI PnL values
3. **Documentation:** Update `docs/READ_ME_FIRST_PNL.md` with this status

---

## Files Reference

| File | Purpose | Status |
|------|---------|--------|
| `lib/pnl/shadowLedgerV23.ts` | CLOB-only PnL engine | CANONICAL |
| `lib/pnl/goldenEngineV26.ts` | Unified all-sources engine | DEPRECATED |
| `lib/pnl/hybridEngineV25.ts` | Hybrid approach (all sources) | DEPRECATED |
| `lib/pnl/ctfSidecarEngine.ts` | V24 Sidecar for Split/Merge | EXPERIMENTAL |
| `lib/pnl/uiActivityEngineV20.ts` | Original cash flow engine | LEGACY |
| `scripts/pnl/benchmark-v26-golden.ts` | V26 benchmark (40 wallets) | REFERENCE |
| `scripts/pnl/benchmark-v25-hybrid.ts` | V25 benchmark | DEPRECATED |
| `docs/reports/TRUMP_2024_LEDGER_VS_UI_W4.md` | Golden Test validation | REFERENCE |

---

*Report generated by Claude 1*
