# P&L Table Rebuild Plan

**Date:** 2025-11-11
**Status:** ⏸️  AWAITING USER APPROVAL
**Root Cause:** Sign error in `scripts/rebuild-pnl-materialized.ts:56`

---

## Summary

After diagnosing the P&L discrepancy, identified root cause as sign inversion in the formula. The current formula SUBTRACTS winning shares when it should ADD them.

**Fix:** Change `-` to `+` on line 56 of `scripts/rebuild-pnl-materialized.ts`

---

## Rebuild Steps (DO NOT EXECUTE YET)

### Pre-Flight Checks

1. ✅ **Backup current table**
   ```sql
   CREATE TABLE realized_pnl_by_market_final_backup_20251111
   ENGINE = MergeTree()
   ORDER BY (wallet, condition_id_norm)
   AS SELECT * FROM realized_pnl_by_market_final;
   ```

2. ✅ **Document current row counts**
   ```sql
   SELECT
     'realized_pnl_by_market_final' as table_name,
     COUNT(*) as row_count,
     COUNT(DISTINCT wallet) as unique_wallets,
     SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as positive_pnl_count,
     SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as negative_pnl_count
   FROM realized_pnl_by_market_final;
   ```
   Expected: ~13.7M rows, ~740K unique wallets

---

### Implementation Steps

#### Step 1: Update Script

**File:** `scripts/rebuild-pnl-materialized.ts`
**Line:** 56

```typescript
// CHANGE FROM:
round(
  sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx),
  2
) AS realized_pnl_usd

// CHANGE TO:
round(
  sum(toFloat64(c.cashflow_usdc)) + sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx),
  2
) AS realized_pnl_usd
```

#### Step 2: Create Fixed Table (Using CREATE→RENAME Pattern)

```bash
# Run the rebuild script with new formula
npx tsx scripts/rebuild-pnl-materialized.ts
```

This will:
1. DROP existing `realized_pnl_by_market_final` (⚠️  backed up in step 1)
2. CREATE new `realized_pnl_by_market_final` with corrected formula
3. CREATE downstream tables: `wallet_realized_pnl_final`, `wallet_pnl_summary_final`

**Runtime estimate:** 5-10 minutes for 13.7M rows

#### Step 3: Verify Fixed Table

```sql
-- Check row counts match backup
SELECT
  COUNT(*) as new_count,
  (SELECT COUNT(*) FROM realized_pnl_by_market_final_backup_20251111) as backup_count,
  COUNT(*) - (SELECT COUNT(*) FROM realized_pnl_by_market_final_backup_20251111) as delta
FROM realized_pnl_by_market_final;

-- Verify P&L sign flip (should see many more positive values)
SELECT
  SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as positive_count,
  SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as negative_count,
  positive_count - negative_count as net_positive
FROM realized_pnl_by_market_final;
```

#### Step 4: Re-run Validation

```bash
npx tsx scripts/validate-pnl-vs-dome.ts
```

**Success Criteria:**
- 14/14 wallets within 1% error ✅
- If fails: Investigate magnitude issue (Step 5)

---

### Step 5: Address Magnitude Issues (If Needed)

If validation still fails after sign fix, investigate:

1. **Check winning_index coverage**
   ```sql
   SELECT
     COUNT(DISTINCT f.condition_id) as markets_with_fills,
     COUNT(DISTINCT w.condition_id_norm) as markets_with_winners,
     (COUNT(DISTINCT w.condition_id_norm) * 100.0 / COUNT(DISTINCT f.condition_id)) as coverage_pct
   FROM clob_fills f
   LEFT JOIN winning_index w ON f.condition_id = w.condition_id_norm;
   ```

2. **Verify net_shares calculation**
   - Check if `outcome_positions_v2` correctly calculates final positions
   - Verify shares represent actual payout value (shares × $1/share for binary markets)

3. **Review fee handling**
   - Check if `trade_cashflows_v3` includes or excludes fees
   - Verify against Polymarket fee structure

---

### Rollback Plan (If Needed)

If rebuild fails or validation doesn't pass:

```sql
-- Restore from backup
DROP TABLE realized_pnl_by_market_final;

CREATE TABLE realized_pnl_by_market_final
ENGINE = MergeTree()
ORDER BY (wallet, condition_id_norm)
AS SELECT * FROM realized_pnl_by_market_final_backup_20251111;

-- Verify restoration
SELECT COUNT(*) FROM realized_pnl_by_market_final;
```

---

## Expected Outcomes

### Before Fix
- 13/14 wallets showing massive losses (negative P&L)
- 1/14 wallets barely positive (+$32K vs expected +$138K)
- Average error: >100%

### After Fix (Sign Flip Only)
- Most wallets flip to positive P&L
- Wallet `0x7f3c8979...`: -177% error → -23% error ✅
- Other wallets: Still magnitude issues (6-15x too large)

### After Full Fix (Sign + Magnitude)
- 14/14 wallets within 1% error ✅
- Ready for leaderboard launch ✅

---

## Approval Checklist

Before executing this plan, user must approve:

- ✅ Root cause analysis reviewed and accepted
- ✅ Sign fix is correct (change `-` to `+`)
- ✅ Backup strategy is acceptable
- ✅ Rollback plan is clear
- ✅ Validation criteria defined (<1% error on all 14 wallets)
- ✅ Magnitude investigation plan if needed

**⏸️  AWAITING APPROVAL FROM USER (Claude 1)**

---

## Post-Rebuild Tasks

Once validation passes:

1. Delete backup table (after 7-day retention):
   ```sql
   DROP TABLE realized_pnl_by_market_final_backup_20251111;
   ```

2. Update leaderboard queries to use corrected P&L

3. Run full wallet metrics refresh:
   ```bash
   npx tsx scripts/refresh-wallet-metrics.ts
   ```

4. Deploy leaderboard to production

5. Document lesson learned in `docs/operations/NEVER_DO_THIS_AGAIN.md`

---

## References

- Root cause analysis: `tmp/ROOT_CAUSE_ANALYSIS_PNL_DISCREPANCY.md`
- Bug location: `scripts/rebuild-pnl-materialized.ts:56`
- Validation script: `scripts/validate-pnl-vs-dome.ts`
- Baseline data: `docs/archive/mg_wallet_baselines.md`
