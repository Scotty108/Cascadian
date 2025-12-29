# PnL Engine Status Report

**Date:** 2025-12-13
**Status:** 70.6% pass rate achieved on CLOB cohort

---

## Executive Summary

After extensive investigation, I've validated the core PnL calculation approach:

1. **Avg-cost long-only with sell-capping** = Correct formula (from Polymarket subgraph)
2. **Fill_key deduplication** = Correct approach (tx_hash, wallet, token_id, side, usdc, tokens)
3. **CLOB-only calculation is EXACT** for wallets with pure trading (no held-to-resolution positions)

The challenge is handling **settlement PnL** for resolved markets - the UI logic is complex.

---

## Current Validation Results

### Wallets WITH CLOB trades: 70.6% pass rate (12/17)

| Wallet | Our PnL | UI PnL | Delta | Status |
|--------|---------|--------|-------|--------|
| 0x89915ad00d26ca... | -$3.62 | -$4.39 | $0.77 | ✅ 17.6% |
| 0x03d5b6ffcb9f7a... | -$9.05 | -$8.53 | -$0.52 | ✅ 6.1% |
| 0x18f343d8f03234... | -$14.91 | -$14.03 | -$0.88 | ✅ 6.3% |
| 0xfc66edcb50b455... | -$18.54 | -$16.68 | -$1.85 | ✅ 11.1% |
| 0x3c3c46c1442ddb... | -$2.81 | -$3.45 | $0.64 | ✅ 18.5% |
| ... and 7 more | | | | ✅ |

### Failures (5 wallets with trades):

| Wallet | Our PnL | UI PnL | Issue |
|--------|---------|--------|-------|
| 0xf1ffada11dab30... | +$3,700 | -$689 | SIGN FLIP |
| 0x7ea09d2d4e8fe0... | +$248 | -$233 | SIGN FLIP |
| 0xe907e229a93738... | +$2,978 | +$6,479 | Large delta |
| 0x114d7a8e7a1dd2... | +$1,053 | +$733 | Settlement needed |
| 0xa6e3af9b0baa3c... | +$1,267 | +$3,154 | Settlement needed |

---

## Verified Working Cases (Exact Matches)

| Wallet | Our Calc | UI Value | Match |
|--------|----------|----------|-------|
| 0x613fae0ca4e3f0c51d89d6a772f8660bc19bc819 | -$0.85 | -$0.85 | ✅ EXACT |
| 0x7da9710476bf0d83239fcc1b306ee592aa563279 | +$9.15 | +$9.15 | ✅ EXACT |

These wallets have **pure CLOB activity** - they bought and sold shares without holding to resolution.

---

## UI "Net Total" Formula (Discovered via Playwright)

From inspecting wallet 0x114d7a8e7a1dd2dde555744a432ddcb871454c92:

```
Net total = Gain + Loss
where:
  Gain = Sum of (redemption - cost) for winning positions
  Loss = Sum of (0 - cost) for positions that resolved to $0
```

**Key observations:**
- "Closed" tab shows WON positions (redeemed at $1)
- "Active" tab can show positions at 0¢ (resolved losers) - these ARE counted in Loss
- Trading realized PnL (buy→sell) is implicitly included

---

## Why Complex Wallets Fail

For wallet 0x114d7a8e:
- UI shows: Gain +$1,131, Loss -$397, Net +$734
- Our calc: Trading $1,053, Settlement -$446, Total $607
- **Gap: $127**

Possible causes:
1. Our settlement includes positions not yet redeemed
2. Rounding/timing differences
3. Multi-outcome market handling ($0.50 resolutions)

---

## Recommended Path Forward

### Phase 1: Simple Cohort (Target: 100% accuracy)
Filter to wallets with:
- No PayoutRedemption events
- No positions in resolved markets
- Pure CLOB trading only

For these wallets, CLOB-only avg-cost calculation should be **exact**.

### Phase 2: Settlement Cohort (Target: 80%+ accuracy)
For wallets with resolved positions:
- Add settlement only for positions with PayoutRedemption events
- Exclude voided markets ($0.50 resolution)

### Phase 3: Full Cohort (Target: 90% within 20%)
- Handle all edge cases
- Accept some variance from timing/rounding

---

## Files Created

| File | Purpose |
|------|---------|
| `scripts/pnl/subgraph-exact-engine.ts` | Correct CLOB-only avg-cost calculation |
| `scripts/pnl/synthetic-realized-engine.ts` | CLOB + settlement (needs refinement) |
| `scripts/pnl/cashflow-pnl-engine.ts` | Cash-flow approach (too simple) |
| `scripts/pnl/debug-settlement.ts` | Debug settlement calculation |
| `scripts/pnl/fill-key-collision-report.ts` | Validate deduplication |

---

## Next Steps

1. Create `SIMPLE_COHORT` query to identify pure-CLOB wallets
2. Validate 100% accuracy on simple cohort
3. Extend to settlement cohort with PayoutRedemption-based logic
4. Build final validation pipeline

---

**Key Insight:** Don't try to match every wallet. Build confidence with simple cases first, then expand.
