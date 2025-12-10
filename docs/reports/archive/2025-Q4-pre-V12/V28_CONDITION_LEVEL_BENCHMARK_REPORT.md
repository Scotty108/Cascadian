# V28 Condition-Level Inventory Engine Benchmark Report

**Date:** 2025-12-05
**Terminal:** Claude 1
**Script:** `scripts/pnl/benchmark-v28-condition-level.ts`

---

## Executive Summary

**VERDICT: V28 FAILS - CONDITION-LEVEL POOLING MAKES THINGS WORSE**

| Metric | V28 Condition-Level | V27b Per-Outcome | V23 CLOB-only |
|--------|---------------------|------------------|---------------|
| Pass Rate | 20.0% | 42.5% | 62.5% |
| Median Error | 87.99% | 44.16% | 0.65% |
| Mean Error | 627.81% | 294.83% | 11.19% |
| 500%+ Error Wallets | 15 | 8 | 0 |

**Root Cause:** Condition-level pooling is incorrect. The problem is NOT outcome index mismatch - it's that `pm_unified_ledger_v7` includes PayoutRedemption USDC that V23 correctly excludes.

---

## V28 Design (Condition-Level Pooling)

**Hypothesis:**
V27b tracked per-outcome, causing cost basis mismatch:
- CLOB buys on idx=1 → cost basis on idx=1
- PayoutRedemption on idx=0 → no cost basis to apply

**V28 Fix Attempt:**
- Pool cost basis at CONDITION level, not outcome level
- All buys on any outcome contribute to pooled avgCost
- All sells/redemptions on any outcome use pooled avgCost

**Formula:**
```
For each condition:
  avgCost = totalCostBasis / totalQuantity (pooled across all outcomes)
  realizedPnL = revenue - (avgCost * tokensSold)
```

**File:** `lib/pnl/inventoryEngineV28.ts`

---

## Benchmark Results (40 Wallets)

### Pass Rates by Category

| Category | Wallets | Threshold | V28 Pass | V23 Pass |
|----------|---------|-----------|----------|----------|
| Pure Traders | 28 | <1% | 28.6% | 64.3% |
| Market Makers | 12 | <5% | 0.0% | 58.3% |
| **OVERALL** | **40** | - | **20.0%** | **62.5%** |

### 500%+ Error Wallets (Critical Failures)

| Wallet | UI PnL | V28 PnL | Error | Redemption USDC |
|--------|--------|---------|-------|-----------------|
| 0x9d84ce0306f8 | $2.44M | $90.78M | 3616% | $8.52M |
| 0x204f72f35326 | $2.02M | $58.05M | 2772% | $22.53M |
| 0x7fb7ad0d194d | $2.27M | $59.67M | 2532% | $62.62M |
| 0x5bffcf561bca | $2.24M | $57.37M | 2461% | $12.22M |
| 0x2005d16a84ce | $1.55M | $31.79M | 1950% | $13.58M |
| 0x461f3e886dca | $1.50M | $27.26M | 1721% | $22.31M |
| 0xee00ba338c59 | $2.13M | $32.15M | 1410% | $69.21M |
| 0x212954857f5e | $1.69M | $24.11M | 1330% | $15.43M |
| 0x2f09642639ae | $1.49M | $21.28M | 1329% | $19.61M |
| 0xb786b8b6335e | $2.17M | $23.97M | 1006% | $11.83M |
| 0x6a72f61820b2 | $2.99M | $31.26M | 946% | $31.22M |
| 0x44c1dfe43260 | $1.56M | $14.74M | 843% | $22.60M |
| 0x42592084120b | $1.90M | $15.84M | 734% | $5.30M |
| 0xd38b71f3e8ed | $1.96M | $11.87M | 506% | $10.34M |
| 0x14964aefa2cd | $1.74M | $10.54M | 505% | $10.60M |

---

## Why V28 Failed

### The Wrong Diagnosis

V27b diagnosis claimed:
> CLOB buys on idx=1, redemption on idx=0 - cost basis mismatch

This suggested condition-level pooling would fix it.

### The Real Problem

V28 made things WORSE because:

1. **PayoutRedemption USDC is the problem, not the solution**
   - PayoutRedemption includes USDC that was already counted in CLOB trades
   - Including it at ALL (per-outcome or condition-level) causes double-counting

2. **V23 CLOB-only works because it excludes PayoutRedemption entirely**
   - V23 only counts: cash spent buying + cash received selling + (tokens × resolution price)
   - V23 does NOT count redemption cash flows

3. **Condition-level pooling makes double-counting worse**
   - V27b: Some redemptions on idx=0 had no cost basis → partial double-count
   - V28: ALL redemptions have cost basis → but still adds redemption USDC → full double-count

### The Correct Solution

**Do NOT include PayoutRedemption in inventory math.**

For resolved markets, there are only two correct approaches:

**Option A: CLOB-only (V23)**
```
PnL = cash_flow_from_CLOB + (final_tokens × resolution_price)
```

**Option B: Pure Cash Flow (for fully resolved)**
```
PnL = Sum(all usdc_delta) across all source types
```
- This works because redemption USDC = tokens × resolution_price
- No need to add resolution pricing on top

**Option C: Hybrid**
```
If position fully redeemed (tokens = 0):
  PnL = Sum(all usdc_delta)  # Pure cash flow
Else:
  PnL = Sum(CLOB usdc_delta) + (remaining_tokens × resolution_price)
```

---

## Success Criteria (FAILED)

| Criteria | Target | V28 Result | Status |
|----------|--------|------------|--------|
| Market Makers < 5% error | >80% pass | 0.0% pass | ✗ FAIL |
| No 500%+ redemption errors | 0 failures | 15 failures | ✗ FAIL |
| Overall > 80% pass rate | >80% | 20.0% | ✗ FAIL |

---

## Recommendations

### 1. **Stay with V23 CLOB-only (CANONICAL)**
V23 remains the best performing engine at 62.5% pass rate.

### 2. **Investigate V23 failures**
25% of wallets fail V23. These may have:
- Missing CLOB data
- Split/Merge activity not captured in CLOB
- Multi-leg trades across conditions

### 3. **Do NOT pursue inventory math with PayoutRedemption**
Both V27b and V28 prove that including PayoutRedemption breaks PnL calculations.

### 4. **Consider Pure Cash Flow for resolved markets**
For wallets with complete resolution data, pure cash flow might work:
```sql
SELECT sum(usdc_delta) as pnl
FROM pm_unified_ledger_v7
WHERE wallet_address = '0x...'
  AND condition_id IN (SELECT condition_id FROM resolved_markets)
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `lib/pnl/inventoryEngineV28.ts` | V28 Condition-Level Engine (FAILED) |
| `lib/pnl/inventoryEngineV27b.ts` | V27b Per-Outcome Engine (FAILED) |
| `lib/pnl/shadowLedgerV23.ts` | V23 CLOB-only (CANONICAL) |
| `scripts/pnl/benchmark-v28-condition-level.ts` | V28 benchmark script |

---

## Lessons Learned

1. **CTF outcome index mismatch was a red herring**
   - The real issue is PayoutRedemption being included at all

2. **Inventory math doesn't work with PayoutRedemption**
   - PayoutRedemption USDC is not "revenue" - it's a closing of the position
   - Including it as revenue always causes over-reporting

3. **V23's simplicity is its strength**
   - CLOB trades + resolution pricing = accurate PnL
   - No need for complex inventory tracking

---

*Report generated by Claude 1*
