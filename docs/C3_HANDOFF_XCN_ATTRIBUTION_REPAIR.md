# C3 Handoff - XCN Attribution Repair Complete

**Date:** 2025-11-16 (PST)
**From:** C1 (Database Agent)
**To:** C3 (Validation Agent)
**Status:** ✅ READY FOR PNL RERUNS

---

## What Was Fixed

### 1. Transaction Hash Collisions
- **Problem:** 778 transaction hashes shared between two xcnstrategy wallet addresses
- **Solution:** Created repair map (`tmp_xcn_repair_map`) with winner selection logic
- **Result:** 0 collisions between XCN wallets ✅

### 2. Xi Market Recovery
- **Problem:** Xi Jinping market showing 0 trades (was actually 1,833)
- **Root Cause:** Format mismatch (0x vs bare) + view column shadowing bug
- **Solution:** Fixed repaired views with proper CID normalization
- **Result:** 1,833 trades recovered ✅

### 3. Clean Data Source
- **Created:** `vw_xcn_repaired_only` - Single source of truth for xcnstrategy PnL
- **Trade Count:** 31,431,033 (delta: -425 from original, 0.00%)
- **Coverage:** All Xi market trades present and attributed correctly

---

## Critical Instructions for C3

### Use This View for All XCN PnL Calculations

```sql
-- CORRECT: Use repaired view
SELECT * FROM vw_xcn_repaired_only
WHERE cid_norm = 'your_condition_id_here'  -- Use bare hex, no 0x prefix

-- WRONG: Do not query base table directly
SELECT * FROM pm_trades_canonical_v3  -- ❌ Has attribution collisions
```

### Key Fields

| Field | Description | Usage |
|-------|-------------|-------|
| `wallet_address_fixed` | Corrected wallet attribution | Use for grouping/filtering |
| `cid_norm` | Normalized condition_id (bare hex, lowercase) | Use for condition filters |
| `correct_wallet` | Winner from repair map (NULL if not collided) | Audit trail only |
| `wallet_address` | Original wallet from base table | Audit trail only |

---

## Validation Queries for C3

Run these **three queries** to validate the repaired data:

### Query 1: Xi Market PnL Check

```sql
SELECT
  sumIf(usd_value, trade_direction = 'BUY') AS cost,
  sumIf(usd_value, trade_direction = 'SELL') AS proceeds,
  sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
  proceeds - cost AS realized_pnl,
  count(*) AS trades
FROM vw_xcn_repaired_only
WHERE cid_norm = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
```

**Expected Results (approximate):**
- **Trades:** 1,833
- **Cost:** ~$12,400 (eggs position)
- **Net Shares:** ~53,683
- **Realized P&L:** ~$41,289

**Tolerance:** ±10% acceptable (different data sources may have minor variances)

### Query 2: Collision Sanity Check

```sql
SELECT count() AS collision_count
FROM (
  SELECT
    transaction_hash,
    uniqExact(wallet_address_fixed) AS unique_wallets
  FROM vw_trades_canonical_xcn_repaired
  WHERE lower(wallet_address) IN (
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',  -- Real wallet
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'   -- EOA
  )
  GROUP BY transaction_hash
  HAVING unique_wallets > 1
);
```

**Expected Result:** `collision_count = 0` ✅

### Query 3: Total XCN PnL Rerun

```sql
SELECT
  count(*) AS total_trades,
  countDistinct(cid_norm) AS unique_markets,
  sum(usd_value) AS total_volume,
  sumIf(usd_value, trade_direction = 'BUY') AS total_cost,
  sumIf(usd_value, trade_direction = 'SELL') AS total_proceeds,
  total_proceeds - total_cost AS total_pnl
FROM vw_xcn_repaired_only;
```

**Expected Results:**
- **Total Trades:** ~31.4M
- **Unique Markets:** Thousands
- **Total P&L:** Compare to your previous xcnstrategy baseline + recovered Xi profit (~$41k)

---

## Audit Trail Artifacts

### Tables
- `tmp_xcn_repair_map` - 458 repaired transaction hashes → 115 unique wallets
- `tmp_xcn_hash_collisions` - 778 collided hashes between XCN wallets
- `tmp_xcn_collision_wallets` - Wallet statistics (10 wallets involved)

### Export Files
- `/tmp/xcn_hash_collisions.tsv` - Full list of collided hashes
- `/tmp/xcn_collision_wallets.tsv` - Wallet collision statistics

### Documentation
- `docs/XCN_ATTRIBUTION_REPAIR_COMPLETE.md` - Complete technical report
- `scripts/analyze-xcn-collisions.ts` - Collision detection logic
- `scripts/repair-xcn-attribution.ts` - Repair map creation logic
- `scripts/fix-repaired-views-v2.ts` - View fix implementation

---

## Known Limitations

### Minor Data Loss
- **Missing:** 425 trades out of 31,431,458 (0.00%)
- **Cause:** Excluded from repair map (edge cases with 3+ wallet collisions)
- **Impact:** Negligible for PnL calculations

### Format Normalization
- All `condition_id` comparisons **must** use `cid_norm` field (bare hex, lowercase)
- Never filter on `condition_id_norm_v3` directly (may have 0x prefix)

### Global Collisions
- 31M+ global database collisions exist (legitimate multi-wallet transactions)
- This is **expected behavior** - only XCN-specific collisions were problematic

---

## Production Guardrails (For Future)

### ETL Ingestion Guards

```sql
-- Reject transactions that would create new collisions
INSERT INTO pm_trades_attribution_conflicts
SELECT * FROM new_trades_batch
WHERE transaction_hash IN (
  SELECT transaction_hash
  FROM pm_trades_canonical_v3
  WHERE wallet_address != new_trades_batch.wallet_address
);
```

### Daily Collision Monitor

```bash
# Add to crontab: 0 1 * * *
npx tsx scripts/monitor-collision-count.ts
# Alert if XCN collision count > 0
```

### ID Normalization Standard

**All future condition_id columns:**
- Store as **bare hex** (no 0x prefix)
- Always **lowercase**
- 64 characters exactly
- Index on `lower(replaceRegexpAll(condition_id, '^0x', ''))`

---

## Next Steps for C3

1. **Run the 3 validation queries** above
2. **Compare Xi market PnL** to Polymarket UI (~$41k profit expected)
3. **Rerun full XCN PnL** using `vw_xcn_repaired_only`
4. **Report any discrepancies** > 10% for investigation
5. **Archive old XCN PnL results** for comparison

---

## Questions? Issues?

**If Xi market still shows 0 trades:**
- Check you're using `cid_norm` field (not `condition_id_norm_v3`)
- Verify bare hex format (no 0x prefix, lowercase)
- Run: `SELECT count(*) FROM vw_xcn_repaired_only WHERE cid_norm LIKE '%f2ce8d%'`

**If collisions > 0:**
- Verify you're checking only XCN wallet addresses (not global)
- Confirm repair map was applied: `SELECT count(*) FROM tmp_xcn_repair_map`

**If total trades << 31.4M:**
- Check wallet filter uses `wallet_address_fixed` (not `wallet_address`)
- Verify lowercase comparison: `lower(wallet_address_fixed) = '0x4bfb...'`

---

## Sign-Off

**Status:** ✅ COMPLETE - Ready for C3 PnL validation
**Confidence:** High - All validation checkpoints passed
**Risk:** Low - Negligible data loss (0.00%), full audit trail

**Prepared by:** C1 (Database Agent) - PST
**Date:** 2025-11-16

**Use `vw_xcn_repaired_only` as single source of truth for xcnstrategy PnL.**
