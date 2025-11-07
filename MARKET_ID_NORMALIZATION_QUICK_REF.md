# Market ID Normalization - Quick Reference

## TL;DR

**Problem:** market_id exists in HEX and INTEGER formats → duplicate rows in GROUP BY → inflated P&L

**Solution:** Group by condition_id_norm only (remove market_id from views)

**Files:**
- Full plan: `/Users/scotty/Projects/Cascadian-app/MARKET_ID_NORMALIZATION_PLAN.md`
- SQL script: `/Users/scotty/Projects/Cascadian-app/scripts/migrate-market-id-normalization.sql`
- TS runner: `/Users/scotty/Projects/Cascadian-app/scripts/run-market-id-normalization.ts`
- Rollback: `/Users/scotty/Projects/Cascadian-app/scripts/rollback-market-id-normalization.ts`

---

## Quick Commands

### Run Migration (Interactive)
```bash
npx tsx scripts/run-market-id-normalization.ts
```

### Run Migration (Direct SQL)
```bash
cat scripts/migrate-market-id-normalization.sql | \
  docker compose exec -T clickhouse clickhouse-client \
    --host=localhost \
    --database=default
```

### Rollback (if needed)
```bash
npx tsx scripts/rollback-market-id-normalization.ts
```

### Manual Rollback (SQL)
```sql
DROP VIEW IF EXISTS outcome_positions_v2;
CREATE VIEW outcome_positions_v2 AS SELECT * FROM outcome_positions_v2_backup;

DROP VIEW IF EXISTS trade_cashflows_v3;
CREATE VIEW trade_cashflows_v3 AS SELECT * FROM trade_cashflows_v3_backup;
```

---

## What Gets Changed

### outcome_positions_v2 (View)

**Before:**
```sql
CREATE VIEW outcome_positions_v2 AS
SELECT
    lower(wallet_address) AS wallet,
    lower(market_id) AS market_id,  -- ❌ PROBLEM: HEX and INT mixed
    lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
    outcome_index AS outcome_idx,
    sum(if(side = 1, 1., -1.) * toFloat64(shares)) AS net_shares
FROM trades_dedup_mat
WHERE outcome_index IS NOT NULL
GROUP BY wallet, market_id, condition_id_norm, outcome_index;  -- ❌ DUPLICATES
```

**After:**
```sql
CREATE VIEW outcome_positions_v2 AS
SELECT
    lower(wallet_address) AS wallet,
    -- market_id REMOVED ✓
    lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
    outcome_index AS outcome_idx,
    sum(if(side = 1, 1., -1.) * toFloat64(shares)) AS net_shares
FROM trades_dedup_mat
WHERE outcome_index IS NOT NULL
  AND condition_id IS NOT NULL
  AND condition_id != ''
  AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
GROUP BY wallet, condition_id_norm, outcome_idx  -- ✓ NO DUPLICATES
HAVING abs(net_shares) > 0.0001;  -- ✓ FILTER ZEROS
```

### trade_cashflows_v3 (View)

**Before:**
```sql
CREATE VIEW trade_cashflows_v3 AS
SELECT
    lower(wallet_address) AS wallet,
    lower(market_id) AS market_id,  -- ❌ PROBLEM
    lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
    outcome_index AS outcome_idx,
    toFloat64(entry_price) AS px,
    toFloat64(shares) AS sh,
    round(toFloat64(entry_price) * toFloat64(shares) * if(side = 1, -1, 1), 8) AS cashflow_usdc
FROM trades_dedup_mat
WHERE outcome_index IS NOT NULL;
```

**After:**
```sql
CREATE VIEW trade_cashflows_v3 AS
SELECT
    lower(wallet_address) AS wallet,
    -- market_id REMOVED ✓
    lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
    outcome_index AS outcome_idx,
    toFloat64(entry_price) AS px,
    toFloat64(shares) AS sh,
    round(toFloat64(entry_price) * toFloat64(shares) * if(side = 1, -1, 1), 8) AS cashflow_usdc
FROM trades_dedup_mat
WHERE outcome_index IS NOT NULL
  AND condition_id IS NOT NULL
  AND condition_id != ''
  AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000';  -- ✓ FILTER INVALID
```

---

## Verification Checklist

After running migration, verify:

- [ ] All 7 checks show "PASS ✓"
- [ ] Row count reduced by 5-10% (deduplication worked)
- [ ] Sum of net_shares unchanged (±1% tolerance)
- [ ] Sum of cashflow_usdc unchanged (±1% tolerance)
- [ ] No NULL condition_ids
- [ ] JOIN to market_resolution_map works
- [ ] No duplicate positions per wallet+condition

---

## If Something Goes Wrong

### Rollback Procedure (30 seconds)

1. Run rollback script:
   ```bash
   npx tsx scripts/rollback-market-id-normalization.ts
   ```

2. Verify restoration:
   ```sql
   SELECT count() FROM outcome_positions_v2
   UNION ALL
   SELECT count() FROM outcome_positions_v2_backup;
   -- Counts should match
   ```

3. Clean up (optional):
   ```sql
   DROP VIEW outcome_positions_v2_backup;
   DROP VIEW trade_cashflows_v3_backup;
   ```

---

## Expected Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| outcome_positions_v2 rows | ~X | ~X * 0.90-0.95 | -5% to -10% |
| outcome_positions_v2 unique wallets | ~Y | ~Y | No change |
| outcome_positions_v2 sum(net_shares) | ~A | ~A | ±1% tolerance |
| trade_cashflows_v3 rows | ~B | ~B | No change |
| trade_cashflows_v3 sum(cashflow_usdc) | ~C | ~C | ±1% tolerance |

---

## How to Get market_id After Migration

If you need market_id in queries after migration:

```sql
-- JOIN to market_resolution_map to get market_id
SELECT
    o.wallet,
    o.condition_id_norm,
    o.outcome_idx,
    o.net_shares,
    m.market_id  -- ✓ Get market_id from mapping table
FROM outcome_positions_v2 AS o
LEFT JOIN market_resolution_map AS m
    ON lower(replaceAll(m.condition_id, '0x', '')) = o.condition_id_norm;
```

**Note:** This is optional. condition_id_norm is the true unique identifier.

---

## Troubleshooting

### "Backup views not found"
- Migration was not run yet, or
- Backups were manually deleted
- Solution: Cannot rollback, views are already in original state

### "Check X FAIL"
- Migration produced unexpected results
- Solution: Run rollback immediately, investigate root cause

### "Duplicate positions found"
- Deduplication didn't work properly
- Solution: Run rollback, check if condition_id has nulls/invalids

### "JOIN to market_resolution_map failed"
- condition_id normalization issue
- Solution: Check condition_id format in trades_dedup_mat

---

## Related Tables (Not Changed)

These tables reference market_id but don't need updates:

- `trades_dedup_mat` - Source table (kept as-is)
- `market_resolution_map` - Canonical mapping (kept as-is)
- `ctf_token_map` - Optional metadata (can be updated later)
- All other tables - No changes needed (will use condition_id for JOINs)

---

## Post-Migration Tasks

### Immediate (Within 1 Hour)
- [ ] Test P&L calculations
- [ ] Check dashboard queries
- [ ] Verify no errors in logs

### Short-Term (Within 24 Hours)
- [ ] Update daily-sync script if needed
- [ ] Document actual row count changes
- [ ] Monitor query performance

### Long-Term (Within 1 Week)
- [ ] Drop backup views (after confirming stability)
- [ ] Add regression tests
- [ ] Update dependent queries to remove market_id references

---

## Contact & Support

For issues or questions:
- See full plan: `MARKET_ID_NORMALIZATION_PLAN.md`
- Check migration logs in ClickHouse system tables
- Review verification query results
- Run rollback if critical issues found
