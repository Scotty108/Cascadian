# V27b Inventory Engine Benchmark Report

**Date:** 2025-12-05
**Terminal:** Claude 1
**Script:** `scripts/pnl/benchmark-v27b-inventory.ts`

---

## Executive Summary

**VERDICT: V27b FAILS - DATA GAP ISSUE**

| Metric | V27b Inventory | V23 CLOB-only |
|--------|---------------|---------------|
| Pass Rate | 42.5% | 62.5% |
| Median Error | 44.16% | 0.65% |
| Mean Error | 294.83% | 11.19% |
| 500%+ Error Wallets | 8 | 0 |

**Root Cause:** `pm_unified_ledger_v7` has **incomplete CLOB buy data** for wallets with PayoutRedemption events.

---

## V27b Design (Pure Inventory Math)

**State Machine Approach:**
- Track inventory per (conditionId, outcomeIndex)
- BUY: `quantity += tokens`, `costBasis += |usdc|`
- SELL: `realizedPnL += Revenue - COGS`, reduce inventory
- PayoutRedemption = Final Sell (not double-counted)

**Formula:**
```
For each trade:
  avgCost = costBasis / quantity
  realizedPnL += usdc_delta - (avgCost * tokensSold)
```

**File:** `lib/pnl/inventoryEngineV27b.ts`

---

## Benchmark Results (40 Wallets)

### Pass Rates by Category

| Category | Wallets | Threshold | V27b Pass | V23 Pass |
|----------|---------|-----------|----------|----------|
| Pure Traders | 28 | <1% | 53.6% | 64.3% |
| Market Makers | 12 | <5% | 16.7% | 58.3% |
| **OVERALL** | **40** | - | **42.5%** | **62.5%** |

### 500%+ Error Wallets (Critical Failures)

| Wallet | UI PnL | V27b PnL | Error | Redemption USDC |
|--------|--------|----------|-------|-----------------|
| 0xee00ba338c59 | $2.13M | $43.40M | 1939% | $69.06M |
| 0x7fb7ad0d194d | $2.27M | $36.86M | 1526% | $62.62M |
| 0x9d84ce0306f8 | $2.44M | $37.26M | 1425% | $8.52M |
| 0x2f09642639ae | $1.49M | $12.47M | 737% | $19.61M |
| 0x2005d16a84ce | $1.55M | $12.44M | 702% | $13.58M |
| 0x461f3e886dca | $1.50M | $11.15M | 645% | $22.31M |
| 0x204f72f35326 | $2.02M | $14.62M | 623% | $22.53M |
| 0xa9878e59934a | $2.26M | $13.58M | 500% | $18.05M |

---

## Root Cause Analysis: CTF OUTCOME INDEX MISMATCH

### The Problem

For wallet `0x461f3e886dca`:
```
Total CLOB cash: -$20.8M (spent buying tokens)
Total Redemption cash: +$22.3M (received from redemptions)
Expected PnL: $22.3M - $20.8M = $1.5M ✓ (matches UI!)
V27b PnL: $11.1M ✗ (7x too high)
```

### Investigation: Position `e00860de118b|idx0`

```
Condition: e00860de118b829b4ff1917ba7e6b47073c0dbc1beed11a9375b562e6121f2be

=== ALL OUTCOME INDICES FOR THIS CONDITION ===
  idx=0, PayoutRedemption: 1 events, tokens=-1,111,633, usdc=+$1,111,633
  idx=1, CLOB: 94 events, tokens=+1,111,633, usdc=-$580,945
```

**THE BUG:** The CLOB buys are on `outcome_index=1` (YES tokens), but PayoutRedemption is on `outcome_index=0` (winning outcome)!

This is **CORRECT** Polymarket CTF behavior:
- When you buy YES tokens via CLOB → outcome_index=1, token_delta > 0
- When YES wins and you redeem → outcome_index=0 (winner), token_delta < 0

### Why V27b Over-Reports

1. V27b tracks inventory per (condition_id, **outcome_index**)
2. Cost basis is built on idx=1 (CLOB buys)
3. Redemption happens on idx=0 (no cost basis here!)
4. V27b sees redemption as pure profit: Revenue - 0 = Revenue
5. Result: V27b PnL ≈ Total Redemption USDC (wrong)

### Why V23 Works Better

V23 CLOB-only approach:
- Only includes CLOB trades
- Ignores PayoutRedemption entirely
- For wallets with complete CLOB data: accurate
- For wallets with missing CLOB data: underreports (not catastrophically wrong)

---

## Data Gap Evidence

For the bad wallet `0x461f3e886dca`:

| Source Type | Count | USDC Sum |
|-------------|-------|----------|
| CLOB | 4,095 | -$20.8M |
| PayoutRedemption | 125 | +$22.3M |

But when we trace individual positions:
- Many PayoutRedemption events have **no matching CLOB buys**
- The CLOB events are recorded under different condition_ids
- Or the CLOB events are simply missing from pm_unified_ledger_v7

---

## Recommendations

### Option 1: V28 Condition-Level Inventory (RECOMMENDED)

**The Fix:** Track inventory at **condition-level**, not outcome-level.

```typescript
// V27b: Per-outcome tracking (BROKEN)
Map<conditionId|outcomeIndex, Position>

// V28: Per-condition tracking (CORRECT)
Map<conditionId, ConditionPosition>

interface ConditionPosition {
  conditionId: string;
  totalCostBasis: number;      // Sum across ALL outcomes
  totalQuantity: number;        // Sum across ALL outcomes
  realizedPnl: number;
  outcomeQuantities: Map<number, number>;  // For diagnostics
}
```

**V28 Rules:**
1. BUY on any outcome → Add to condition-level cost basis
2. SELL on any outcome → Realize PnL using condition-level avgCost
3. PayoutRedemption → Same as SELL (uses pooled cost basis)

**Why This Works:**
- Cost basis from idx=1 CLOB buys is pooled with idx=0
- Redemption on idx=0 uses the pooled cost basis
- PnL = Revenue - (avgCost × tokens) works correctly

### Option 2: Stay with V23 (Current)
V23 CLOB-only remains the best performing engine (62.5% pass rate).
V23 avoids the outcome index issue by ignoring redemptions entirely.

### Option 3: Cash Flow Only (Simplest)
For resolved markets: `PnL = Sum(all usdc_delta)` across all source types.
This sidesteps inventory math entirely but loses granularity.

---

## Success Criteria (FAILED)

| Criteria | Target | V27b Result | Status |
|----------|--------|-------------|--------|
| Market Makers < 5% error | >80% pass | 16.7% pass | ✗ FAIL |
| No 500%+ redemption errors | 0 failures | 8 failures | ✗ FAIL |
| Overall > 80% pass rate | >80% | 42.5% | ✗ FAIL |

---

## Files Reference

| File | Purpose |
|------|---------|
| `lib/pnl/inventoryEngineV27b.ts` | V27b Pure Inventory Engine |
| `lib/pnl/shadowLedgerV23.ts` | V23 CLOB-only (CANONICAL) |
| `scripts/pnl/benchmark-v27b-inventory.ts` | V27b benchmark script |
| `pm_unified_ledger_v7` | Unified ledger (has data gaps) |

---

*Report generated by Claude 1*
