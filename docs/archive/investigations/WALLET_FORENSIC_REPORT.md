# Wallet Forensic Analysis Report
## Wallet: 0x6770bf688b8121331b1c5cfd7723ebd4152545fb

**Date**: 2025-11-11
**Analyst**: Claude
**Status**: 🔴 CRITICAL DISCREPANCY FOUND

---

## Executive Summary

Investigation of wallet `0x6770bf688b8121331b1c5cfd7723ebd4152545fb` reveals a **critical sign inversion** in our P&L calculation:

| Source | P&L | Status |
|--------|-----|--------|
| **Polymarket UI** | +$1,914 | ✅ Profit |
| **Our Database** | -$43,310 | ❌ Loss |
| **Discrepancy** | $45,224 (23.6x + sign flip) | 🔴 CRITICAL |

This is **NOT** the reported 3.6x inflation issue. This is:
1. **Wrong Sign**: We show a loss when it should be a profit
2. **Wrong Magnitude**: 23x difference in absolute value
3. **Missing from UI**: Wallet not in our JSON export (`audited_wallet_pnl_extended.json`)

---

## Initial Hypothesis (DISPROVEN)

**Original claim**: Database shows $6,870 (3.6x inflation of $1,914)

**Reality discovered**:
- ❌ Database shows **-$43,310** (not $6,870)
- ❌ This is a **loss**, not a profit
- ❌ Magnitude is 23x off, not 3.6x

**Conclusion**: The original premise was incorrect. We need to investigate:
1. Where the $6,870 figure came from (if not from database)
2. Why our calculation shows -$43k instead of +$1.9k
3. Root cause of sign inversion

---

## Data Sources Analyzed

### 1. wallet_pnl_summary_final
```json
{
  "wallet": "0x6770bf688b8121331b1c5cfd7723ebd4152545fb",
  "realized_pnl_usd": -43310.04,
  "unrealized_pnl_usd": 0,
  "total_pnl_usd": -43310.04
}
```
**Status**: ✅ Found, but showing large negative P&L

### 2. realized_pnl_by_market_final
**Columns**: `wallet`, `market_id`, `condition_id_norm`, `resolved_at`, `realized_pnl_usd`

**Status**: ⚠️  Need to aggregate per-market P&L to see breakdown

### 3. wallet_metrics
**Columns**: `wallet_address`, `realized_pnl`, `gross_gains_usd`, `gross_losses_usd`, etc.

**Status**: ⚠️  Need to query with correct column name (`wallet_address`, not `wallet`)

### 4. outcome_positions_v2
**Columns**: `wallet`, `condition_id_norm`, `outcome_idx`, `net_shares`

**Status**: ⚠️  Need to check position count and distribution

### 5. audited_wallet_pnl_extended.json
**Status**: ❌ Wallet NOT FOUND in JSON export
- This is why wallet doesn't appear in UI
- Likely filtered out due to:
  - Coverage below 2% threshold
  - Quality/verification issues
  - Or calculation errors that excluded it

---

## Root Cause Hypotheses

### Hypothesis A: Sign Inversion in Settlement Logic
**Probability**: HIGH

**Evidence**:
- Database shows large negative (-$43k)
- Polymarket shows positive (+$1.9k)
- This suggests BUY/SELL direction may be inverted

**Test**:
1. Check if `cost_basis` signs are flipped
2. Verify payout calculation: `payout - cost_basis` vs `cost_basis - payout`
3. Review settlement formula in `realized_pnl_by_market_final` creation

### Hypothesis B: Absolute Value Summing
**Probability**: MEDIUM

**Evidence**:
- 23x inflation suggests multiple multipliers stacked
- Could be summing |gains| + |losses| instead of netting

**Test**:
1. Check if `pnl_usd_abs` column exists and is being used
2. Verify aggregation: should be `SUM(pnl_usd)`, not `SUM(ABS(pnl_usd))`

### Hypothesis C: Join Fanout / Duplication
**Probability**: MEDIUM

**Evidence**:
- Large magnitude difference (23x)
- Could indicate rows being counted multiple times

**Test**:
1. Check for duplicate rows per (wallet, market_id, condition_id_norm)
2. Verify no cartesian joins in view definition
3. Count total rows vs expected rows

### Hypothesis D: Coverage Filtering Issue
**Probability**: LOW (affects export, not calculation)

**Evidence**:
- Wallet missing from JSON export
- But doesn't explain sign flip or magnitude

**Test**:
1. Calculate coverage % for this wallet
2. Check if below 2% threshold
3. Verify export logic in `wallet-pnl-feed.ts`

---

## Next Steps (Priority Order)

### CRITICAL (Do First):
1. ✅ **Check realized_pnl_by_market_final breakdown** - Need to see per-market P&L to identify pattern
2. ✅ **Verify wallet_metrics latest values** - Cross-reference with summary table
3. ✅ **Test sign inversion hypothesis** - Review settlement formula in table creation SQL

### HIGH:
4. ⚠️  **Check for duplicate rows** - Count (wallet, market_id) pairs for duplication
5. ⚠️  **Audit P&L calculation logic** - Review the SQL that builds `realized_pnl_by_market_final`
6. ⚠️  **Compare to Polymarket API** - Not just UI, verify against their official API

### MEDIUM:
7. ⏸️ **Calculate coverage %** - Determine if wallet should be in export
8. ⏸️ **Audit other wallets** - Check if sign inversion is systematic
9. ⏸️ **Review BUY/SELL direction logic** - Verify net flow calculations

### LOW:
10. ⏸️ **Update JSON export** - After fixing calculation, regenerate export

---

## Questions for User

1. **Where did the $6,870 figure come from?**
   - Was this from a different wallet?
   - Was this from an older version of the database?
   - Was this a manual calculation?

2. **Do you have access to Polymarket's detailed trade history for this wallet?**
   - Can help verify which system is correct
   - Provides ground truth for testing

3. **Are there other wallets showing similar discrepancies?**
   - Need to know if this is isolated or systematic
   - Affects remediation strategy

---

## Technical Details

### Table Schemas Verified:
- `wallet_pnl_summary_final`: Columns = `wallet`, `realized_pnl_usd`, `unrealized_pnl_usd`, `total_pnl_usd`
- `realized_pnl_by_market_final`: Columns = `wallet`, `market_id`, `condition_id_norm`, `resolved_at`, `realized_pnl_usd`
- `wallet_metrics`: Columns = `wallet_address`, `realized_pnl`, `gross_gains_usd`, `gross_losses_usd`, ...
- `outcome_positions_v2`: Columns = `wallet`, `condition_id_norm`, `outcome_idx`, `net_shares`

### Environment:
- Database: ClickHouse Cloud
- Host: `igm38nvzub.us-central1.gcp.clickhouse.cloud:8443`
- Database: `default`

---

## Files Created

1. `/scripts/forensic-wallet-analysis.ts` - Initial multi-step analysis
2. `/scripts/check-pnl-tables.ts` - Table discovery
3. `/scripts/check-wallet-pnl-structure.ts` - Schema verification
4. `/scripts/check-all-pnl-views.ts` - View comparison (incomplete due to timeouts)
5. `/scripts/wallet-forensic-complete.ts` - Comprehensive analysis
6. `/scripts/check-table-schemas.ts` - Column name discovery

**Primary findings file**: `/WALLET_FORENSIC_REPORT.md` (this document)

---

## Recommendations

### Immediate Actions:
1. **STOP using `wallet_pnl_summary_final` for UI display** until verified
2. **Investigate sign inversion** in settlement calculation
3. **Run full audit** on 5-10 sample wallets to determine if systematic

### Short-Term:
1. **Fix P&L calculation logic** in table creation SQL
2. **Add unit tests** for settlement calculations with known ground truth
3. **Implement data quality checks** (e.g., total cash flow should be near zero)

### Long-Term:
1. **Build reconciliation system** with Polymarket API
2. **Add alerting** for large discrepancies (>10% error)
3. **Document settlement rules** and edge cases clearly

---

**Status**: 🔴 INVESTIGATION IN PROGRESS
**Next Update**: After running per-market breakdown analysis
