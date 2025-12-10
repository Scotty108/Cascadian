# Unified PnL Scorecard - 2025-12-07

> **TERMINAL 1 FINAL DELIVERABLE**
> Resolves the validation drift between parallel threads and establishes production cohorts.

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Best Realized Engine** | V11 |
| **Ship-Ready Cohort** | `transfer_free` |
| **Pass Rate (Ship Cohort)** | 71.0% (71/100 wallets) |
| **Coverage** | 482 wallets with Dome benchmarks |

### Key Findings

1. **V11 significantly outperforms V29** for realized PnL against Dome benchmarks
   - V11: 51.6% overall pass rate
   - V29: 31.5% overall pass rate

2. **Transfer-free wallets are most reliable** for copy-trading
   - 71% pass rate with V11
   - These wallets have no ERC1155 transfers that could confuse CLOB-only calculations

3. **Large PnL wallets have lower accuracy** due to:
   - More complex trading histories
   - Higher likelihood of mixed source types
   - Potential transfer activity

---

## Engine Comparison: V11 vs V29

### V11 (Recommended for Production)

```
Formula: cash_flow + final_shares * resolution_price (unresolved = 0)
Source:  lib/pnl/engines/v11/realizedPnlEngine.ts
```

| Cohort | Passed | Total | Pass Rate |
|--------|--------|-------|-----------|
| transfer_free | 71 | 100 | **71.0%** |
| large_pnl | 65 | 137 | 47.4% |
| **Overall** | **95** | **184** | **51.6%** |

### V29 (Not Recommended)

```
Formula: Full event ledger approach with inventory tracking
Source:  lib/pnl/engines/v29/inventoryGuardEngine.ts
```

| Cohort | Passed | Total | Pass Rate |
|--------|--------|-------|-----------|
| transfer_free | 35 | 100 | 35.0% |
| large_pnl | 28 | 137 | 20.4% |
| **Overall** | **58** | **184** | **31.5%** |

### Why V11 Wins

1. **Simpler formula** = fewer edge cases
2. **Aligns better with Dome's methodology**
3. **More predictable failure modes** (mostly sign disagreements or data gaps)

---

## PnL Taxonomy Resolution

This framework resolves the Claude 1 vs Claude 2 terminology drift:

### Canonical Definitions

| Term | Definition | Engine |
|------|------------|--------|
| **realized_pnl** | PnL from resolved positions only | V11 (production) |
| **unrealized_pnl** | PnL from open positions (mark-to-market) | Future work |
| **total_pnl** | realized + unrealized | UI shows this |
| **dome_realized** | Dome API's realizedPnL field | Benchmark source |

### UI PnL Mapping

The Polymarket UI displays **total PnL** (realized + unrealized), not just realized.
This explains discrepancies when comparing our realized-only engine to UI snapshots.

**For copy-trading leaderboards:**
- We ship **realized PnL first** (V11)
- Unrealized to be added in Phase 2

---

## Cohort Definitions

### Ship Now: `transfer_free`

```sql
-- No ERC1155 transfers means CLOB trades only
SELECT wallet FROM wallets
WHERE erc1155_transfer_count = 0
```

- **100 wallets** in validation set
- **71% pass rate** with V11
- **Best for copy-trading** (simplest activity patterns)

### Future Cohorts (Not Ready)

| Cohort | Status | Issue |
|--------|--------|-------|
| clob_only | 0.2% of wallets | Too restrictive |
| trader_strict | 0.2% of wallets | Too restrictive |
| large_pnl | 47% pass rate | Too many failures |
| clean_large_traders | 0% of wallets | No matches with current filters |

---

## Validation Thresholds (Unified)

All validation scripts now use these shared thresholds:

```typescript
// lib/pnl/validationThresholds.ts

// For large PnL (|benchmark| >= $200)
percentage_threshold: 6%  // Allow up to 6% relative error

// For small PnL (|benchmark| < $200)
absolute_threshold: $10   // Allow up to $10 absolute error

// Special cases
sign_disagreement: FAIL   // One positive, one negative = auto-fail
both_zero: PASS           // If both are ~$0, pass
```

---

## Production Recommendation

### Phase 1: Ship Now

**Cohort:** `transfer_free` wallets only
**Engine:** V11 realized PnL
**Expected Accuracy:** ~71%

**Exclusions for v1:**
- Wallets with ERC1155 transfers
- Wallets with known split/merge activity
- Markets with AMM-only activity

### Phase 2: Coverage Expansion

1. Investigate 29% failure cases:
   - Sign disagreements (likely data timing issues)
   - Large errors (likely missing resolution data)

2. Add unrealized PnL:
   - Mark-to-market calculation
   - Requires live price feeds

3. Expand to more cohorts:
   - Once failure patterns are understood

---

## Files Created/Modified

### New Files

| File | Purpose |
|------|---------|
| `docs/reports/PNL_TAXONOMY.md` | Canonical PnL definitions |
| `lib/pnl/validationThresholds.ts` | Shared threshold logic |
| `scripts/pnl/build-cohort-manifest.ts` | Cohort classification |
| `scripts/pnl/run-unified-scorecard.ts` | Single validation entrypoint |

### Modified Files

| File | Change |
|------|--------|
| `scripts/pnl/validate-v11-vs-dome-no-transfers.ts` | Uses shared thresholds |
| `scripts/pnl/validate-v29-vs-dome-no-transfers.ts` | Uses shared thresholds |

---

## How to Run

```bash
# 1. Build cohort manifest (required first time)
npx tsx scripts/pnl/build-cohort-manifest.ts --limit=500 --dome-only

# 2. Run unified scorecard
npx tsx scripts/pnl/run-unified-scorecard.ts \
  --cohorts=transfer_free,large_pnl \
  --limit=100

# 3. View results
cat docs/reports/unified_scorecard.md
```

---

## Resolving Claude 1 vs Claude 2 Conflict

The two terminals had drifted with different validation approaches:

| Issue | Resolution |
|-------|------------|
| Different thresholds | Unified in `validationThresholds.ts` |
| Different cohort definitions | Single manifest via `build-cohort-manifest.ts` |
| V11 vs V29 debate | **V11 wins** on Dome benchmark accuracy |
| UI vs Dome benchmark | Dome for realized, UI includes unrealized |
| Which cohort to ship | **transfer_free** with 71% pass rate |

---

## Next Steps

1. **Integrate V11 into API endpoints** for leaderboard
2. **Add cohort filter** to wallet queries (`WHERE transfer_free = true`)
3. **Monitor failure cases** for patterns
4. **Phase 2:** Add unrealized PnL calculation

---

*Generated: 2025-12-07T08:37:07.784Z*
*Scorecard JSON: tmp/unified_scorecard.json*
*Cohort Manifest: tmp/pnl_cohort_manifest.json*
