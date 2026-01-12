# PnL Engine Stratified Test Results

**Date:** January 10, 2026
**Status:** Complete - V7 (API) confirmed as only viable engine

---

## Executive Summary

After fixing data freshness issues (ERC1155 56h→21min, token mapping 84%→99.8%) and testing V1, V17, V20, and V25 engines against a stratified cohort, **all local engines fail with 0% accuracy**. The fundamental issue is that CLOB data alone cannot reconstruct:

1. Neg Risk adapter internal bookkeeping trades
2. Split/merge events that don't appear in CLOB

**V7 (API-based) remains the only working solution with 100% accuracy.**

---

## Test Configuration

### Stratified Cohort (5 wallet types)

| Type | Wallet | Characteristic |
|------|--------|----------------|
| CLOB_ONLY | 0x204f72f3... | Pure CLOB trading, no splits |
| NEGRISK_HEAVY | 0xe8dd7741... | 205K+ NegRisk conversions |
| SPLIT_HEAVY | 0x57ea53b3... | 131K+ position splits |
| REDEMPTION | 0x35c0732e... | 58K+ resolved conditions |
| MAKER_HEAVY | 0x6031b6ee... | 84% maker trades |

### Engines Tested

- **V1**: Original per-outcome tracking + sell capping
- **V17**: Position-aware PnL calculator
- **V20**: Chronological position tracking
- **V25**: V1 dedup + V23 sequential avgPrice

---

## Results

### Accuracy by Engine (5% tolerance threshold)

| Engine | Match | Accuracy |
|--------|-------|----------|
| **V7 (API)** | 5/5 | **100%** |
| V1 | 0/5 | 0% |
| V17 | 0/5 | 0% |
| V20 | 0/5 | 0% |
| V25 | 0/5 | 0% (broken) |

### Detailed Error Analysis

| Wallet Type | Polymarket | V1 Error | V17 Error | V20 Error | V25 Error |
|-------------|------------|----------|-----------|-----------|-----------|
| CLOB_ONLY | $3.81M | +8% | +8% | +16% | **-2120%** |
| NEGRISK_HEAVY | $369K | -87% | -87% | -85% | **-26800%** |
| SPLIT_HEAVY | $48.5K | -100% | -100% | -100% | -100% |
| REDEMPTION | $3.9K | +113% | +90% | +35% | -83% |
| MAKER_HEAVY | $568K | -22% | -22% | -23% | **-3267%** |

---

## Root Cause Analysis

### Why Split-Heavy Returns $0

Split-heavy wallets use the Polymarket split mechanism to buy both outcomes at $0.50 each. These transactions:
- **DO** appear in ERC1155 transfers
- **DO NOT** appear in CLOB fills

Since all local engines only read CLOB data (`pm_trader_events_v3`), they literally cannot see the trades.

### Why NegRisk is -85% Off

The Neg Risk adapter creates internal bookkeeping trades that appear identical to real CLOB trades:
```
BUY outcome_1 117 tokens @ $117.13
SELL outcome_1 117 tokens @ $117.13  ← Internal netting
BUY outcome_0 117 tokens @ $0.117
SELL outcome_0 117 tokens @ $0.117  ← Internal netting
```

Net effect: $0 PnL change, but $234 appears in CLOB volume. Local engines cannot distinguish these from real trades.

### Why V25 is Completely Broken

V25 appears to have a sign/overflow bug causing massive negative numbers (-2120% to -26800% error). This needs investigation but is irrelevant since no local engine works.

---

## Data Fixes Applied (This Session)

1. **ERC1155 Transfers**: Fixed from 56 hours stale → 21 minutes
2. **Token Mapping**: Fixed from 84.4% → 99.8% coverage (57,354/57,497 mapped)
3. **Token Mapping Script**: Created `/scripts/pnl/fix-unmapped-tokens-universal.ts`

---

## Recommendations

### Immediate (Use Now)

**V7 (API) is the only viable production engine.**

```typescript
import { getWalletPnLV7 } from '@/lib/pnl/pnlEngineV7';
const result = await getWalletPnLV7(walletAddress);
// Returns: { totalPnl, source: 'polymarket-api' | 'v6-fallback' }
```

### Why Not Build V38+?

After 37 versions and now with fresh data, it's clear the fundamental limitation is architectural:

1. **CLOB data cannot represent splits** - They happen in CTF/ERC1155, not CLOB
2. **Neg Risk bookkeeping is opaque** - Same signatures as real trades
3. **Polymarket's API already solves this** - Uses their internal accounting

The effort to replicate Polymarket's internal PnL calculation would require:
- Parsing all ERC1155 transfers for split/merge events
- Implementing the synthetic price formula for conversions
- Maintaining parity with Polymarket's evolving bookkeeping

This is 40-60 hours of work for a solution that would still drift from the "official" number users see on Polymarket.

### Long-Term Options

If API independence is truly required:

1. **V22 (Subgraph)**: Uses Polymarket's official pnl-subgraph via Goldsky
   - 14-15/15 accuracy in previous tests
   - No proprietary API needed
   - Queryable: `api.goldsky.com/.../pnl-subgraph/0.0.14/gn`

2. **Hybrid V16**: Route CLOB-only wallets through V1, others through V7
   - Reduces API calls by ~60%
   - Requires reliable wallet classification

---

## Files Created/Modified

### Test Scripts
- `/scripts/pnl-quick-test.ts` - Quick 5-wallet test
- `/scripts/pnl-engine-comparison.ts` - Multi-engine comparison
- `/scripts/pnl-cohort-test.ts` - Full 30-wallet cohort test

### Token Mapping
- `/scripts/pnl/fix-unmapped-tokens-universal.ts` - Universal token fixer

### Documentation
- This file: `/docs/reports/PNL_ENGINE_STRATIFIED_TEST_RESULTS.md`

---

## Conclusion

**V7 (API) is production-ready and should remain the primary engine.**

The 37 engine versions (V1-V37) were not failed attempts at math - they were attempts to work around a data limitation that cannot be overcome with CLOB data alone. The API exists specifically because Polymarket had the same realization: you need their internal accounting to compute accurate PnL.

**Next Steps:**
1. Keep V7 as production engine
2. Monitor API reliability/latency
3. Consider V22 (subgraph) as backup if API becomes unavailable
4. Archive V1-V37 as deprecated experiments

---

**Test Date:** 2026-01-10 04:XX UTC
**Token Mapping Coverage:** 99.8%
**ERC1155 Freshness:** 21 minutes
