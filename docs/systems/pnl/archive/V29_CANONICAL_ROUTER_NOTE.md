# V29 Canonical Router - Design Note

**Date:** 2025-12-06
**Terminal:** Claude 1 (Main Terminal)
**Status:** Production Ready

---

## Summary

V29 UiParity is now the **canonical PnL engine** for Cascadian production. This document describes the router architecture that connects the V8 ledger, V29 engine, cohort classifier, and UI display.

---

## Decision: V29 UiParity is Canonical

Based on HEAD_TO_HEAD_V23C_V29_2025_12_06.md benchmark results:

| Engine | Pass <1% | Pass <5% | Median Error |
|--------|----------|----------|--------------|
| V23c | 20% | 20% | 38.9% |
| **V29 UiParity** | **57%** | **67%** | **0.33%** |

V29 UiParity outperforms V23c on every metric. V23c/V23d are now **research/backup engines only**, not production.

---

## Architecture

```
┌─────────────────┐
│ pm_unified_     │
│ ledger_v8_tbl   │  (Materialized table with V5 token map)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ V29 Inventory   │
│ Engine          │  (lib/pnl/inventoryEngineV29.ts)
│                 │  - Inventory guard (clamps phantom sells)
│                 │  - Condition-level cost basis pooling
│                 │  - UI parity mode
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ V29CanonicalPnL │  (getV29CanonicalPnL function)
│                 │  - Clean interface for production
│                 │  - Data health metrics
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Cohort          │
│ Classifier      │  (lib/pnl/cohortClassifier.ts)
│                 │  - SAFE / MODERATE / RISKY / SUSPECT
│                 │  - Uses tags + error % + data health
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ PnL Router      │  (lib/pnl/pnlRouter.ts)
│                 │  - getWalletPnlDisplay()
│                 │  - Display labels
│                 │  - Confidence scores
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ UI / API        │
└─────────────────┘
```

---

## Cohort Classification

| Cohort | Criteria | UI Action |
|--------|----------|-----------|
| **SAFE** | TRADER_STRICT + <3% error + no data issues | Show PnL confidently |
| **MODERATE** | MIXED + <5% error | Show with "estimate" label |
| **RISKY** | MAKER_HEAVY | Show with disclaimer |
| **SUSPECT** | Timeouts, inventory mismatch, missing resolutions | Hide PnL |

### Precedence Rules (highest to lowest)

1. **SUSPECT** - Data quality issues always take precedence
   - Timeout during processing
   - Inventory mismatch > 0
   - Missing resolutions > 0
   - Negative inventory positions > 0
   - Error >= 10%
   - isDataSuspect tag

2. **RISKY** - Market makers
   - isMakerHeavy tag

3. **SAFE** - High-confidence traders
   - isTraderStrict tag
   - Error < 3%
   - No splits/merges
   - No data issues

4. **MODERATE** - Everything else that passes basic checks
   - MIXED or TRADER_STRICT that didn't qualify for SAFE
   - Error < 5%

---

## Key Files

| File | Purpose |
|------|---------|
| `lib/pnl/inventoryEngineV29.ts` | V29 engine + `getV29CanonicalPnL()` |
| `lib/pnl/cohortClassifier.ts` | Cohort classification logic |
| `lib/pnl/pnlRouter.ts` | Production router API |
| `scripts/pnl/test-pnl-router.ts` | Test script for router |
| `scripts/pnl/run-regression-matrix.ts` | Regression harness |

---

## API Usage

### Basic Usage

```typescript
import { getWalletPnlDisplay } from '@/lib/pnl/pnlRouter';

const display = await getWalletPnlDisplay(walletAddress, {
  includeDebug: true,  // Optional: include debug info
});

// Use in UI
if (display.shouldDisplay) {
  showPnL(display.displayPnL, display.displayLabel);
} else {
  showHiddenMessage(display.displayLabel);
}
```

### Response Structure

```typescript
interface WalletPnlDisplay {
  wallet: string;
  canonicalEngine: 'V29_UIPARITY';
  cohort: 'SAFE' | 'MODERATE' | 'RISKY' | 'SUSPECT';
  cohortReason: string;
  displayPnL: number;      // 0 if SUSPECT
  displayLabel: string;    // e.g., "PnL (precise)"
  confidence: number;      // 0-1
  shouldDisplay: boolean;  // false for SUSPECT
  debug?: { ... };         // Optional debug info
}
```

### Display Labels by Cohort

| Cohort | Display Label |
|--------|---------------|
| SAFE | "PnL (precise)" |
| MODERATE | "PnL (estimate)" |
| RISKY | "PnL (maker mode - volatile)" |
| SUSPECT | "PnL hidden - data suspect" |

---

## Extending the Router

### Adding New Data Sources

The router is isolated from data source details. To add a new source:

1. Update `pm_unified_ledger_v8` view to include new data
2. Materialize into `pm_unified_ledger_v8_tbl`
3. Router automatically picks up changes

### Adding New Cohorts

1. Add cohort to `WalletCohort` type in `cohortClassifier.ts`
2. Add classification logic in `classifyCohort()`
3. Add display label in `getCohortDisplayLabel()`
4. Update test script with representative wallets

### Tuning Thresholds

All thresholds are in `cohortClassifier.ts`:

```typescript
const THRESHOLDS = {
  SAFE_ERROR_PCT: 3,           // Max error for SAFE
  MODERATE_ERROR_PCT: 5,        // Max error for MODERATE
  SUSPECT_ERROR_PCT: 10,        // Error that triggers SUSPECT
  // ...
};
```

---

## Testing

```bash
# Run router test
npx tsx scripts/pnl/test-pnl-router.ts

# Run full regression
npx tsx scripts/pnl/run-regression-matrix.ts --set=fresh_2025_12_06
```

---

## V23c/V23d Status

**DO NOT USE V23c/V23d FOR PRODUCTION.**

They remain in the codebase for:
- Research/comparison
- Backup if V29 has issues
- Historical reference

The regression harness still runs both for comparison, but production code should only call `getWalletPnlDisplay()`.

---

## Related Documentation

- [HEAD_TO_HEAD_V23C_V29_2025_12_06.md](../../reports/HEAD_TO_HEAD_V23C_V29_2025_12_06.md) - Benchmark results
- [V23C_V29_COHORT_SUMMARY_2025_12_06.md](../../reports/V23C_V29_COHORT_SUMMARY_2025_12_06.md) - Detailed analysis
- [V29_NEGATIVE_INVENTORY_NOTE.md](./V29_NEGATIVE_INVENTORY_NOTE.md) - Inventory guard details
- [WALLET_DATA_HEALTH_SCHEMA.md](./WALLET_DATA_HEALTH_SCHEMA.md) - Data health metrics

---

**Terminal:** Claude 1 (Main Terminal)
