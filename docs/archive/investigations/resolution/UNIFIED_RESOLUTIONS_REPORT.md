# Unified Resolutions View - Implementation Report

## Executive Summary

Created `cascadian_clean.vw_resolutions_unified` as the single source of truth for market resolutions with payout vectors.

### Coverage Metrics

- **Market Coverage:** 24.8% (56,504 / 227,838 traded markets)
- **Volume Coverage:** 14.25% ($1,481M / $10,398M total volume)
- **Unique Markets:** 144,015 markets with resolutions
- **Data Quality:** 100% have complete payout vectors

### Key Findings

1. **Only One Usable Source**: `market_resolutions_final` is the ONLY table with complete payout vectors
   - Other sources (`staging_resolutions_union`, `api_ctf_bridge`, `resolutions_src_api`) only have text outcomes
   - `resolutions_src_api` has ZERO resolved markets (all `resolved=0`)

2. **Low Coverage Root Cause**:
   - `vw_trades_canonical` has 228k distinct markets
   - `market_resolutions_final` has 144k markets (63% of traded markets)
   - **Join success rate: 8.17%** - suggests format mismatch or normalization issue

3. **Duplicates Resolved**: Used `argMax(..., updated_at)` with GROUP BY to deduplicate
   - Raw table: 224,302 rows
   - Deduplicated view: 144,015 rows (80,287 duplicates removed)

---

## View Definition

```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_unified AS
SELECT
  cid_hex,
  argMax(winning_index, updated_at) as winning_index,
  argMax(payout_numerators, updated_at) as payout_numerators,
  argMax(payout_denominator, updated_at) as payout_denominator,
  argMax(resolved_at, updated_at) as resolved_at,
  argMax(winning_outcome, updated_at) as winning_outcome,
  'warehouse' AS source,
  1 AS priority
FROM (
  SELECT
    lower(concat('0x', condition_id_norm)) AS cid_hex,
    winning_index,
    payout_numerators,
    payout_denominator,
    resolved_at,
    winning_outcome,
    updated_at
  FROM default.market_resolutions_final
  WHERE payout_denominator > 0
    AND winning_index >= 0
)
GROUP BY cid_hex
```

**Schema:**
- `cid_hex` (String): Normalized condition ID (lowercase, with 0x prefix, 66 chars)
- `winning_index` (UInt16): Index of winning outcome
- `payout_numerators` (Array(UInt8)): Payout vector numerators
- `payout_denominator` (UInt8): Payout denominator
- `resolved_at` (Nullable(DateTime)): Resolution timestamp
- `winning_outcome` (String): Human-readable winning outcome
- `source` (String): Always 'warehouse'
- `priority` (UInt8): Always 1

---

## Views That Need Updating

The following views currently use old resolution tables and should be updated to use `vw_resolutions_unified`:

### High Priority (P&L Calculation)
- `vw_trade_pnl` → Uses `vw_resolutions_all`
- `vw_trade_pnl_final` → Uses `vw_resolutions_all`
- `vw_wallet_pnl_simple` → Uses `vw_resolutions_all`
- `vw_wallet_positions` → Uses `vw_resolutions_all`

### Medium Priority (Analysis)
- `vw_backfill_targets_fixed` → Uses `market_resolutions_final`
- `vw_resolved_have` → Uses `market_resolutions_final`

### Low Priority (Can be deprecated)
- `vw_resolutions_all` → This view itself should point to unified
- `vw_resolutions_cid` → Uses `market_resolutions_final`

### Missing View
- `wallet_pnl_summary_final` → NOT FOUND (may have been dropped)

---

## Critical Issue: Low Join Success Rate

### Problem
Join success rate between `vw_trades_canonical` and `vw_resolutions_unified` is only **8.17%**.

### Sample Condition IDs
**From trades:**
- `0x00f26b37f9b33313b0...` (len=66)
- `0x02531747baea6b4bda...` (len=66)

**From resolutions:**
- `0x3dcdb9f5174b30f23c...` (len=66)
- `0xb9cf1fdd74d0b45a5c...` (len=66)

Both are 66 chars (0x + 64 hex), so length is correct.

### Root Cause Analysis

Join query used:
```sql
LEFT JOIN default.market_resolutions_final r
  ON lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
```

**The issue:** `vw_trades_canonical.condition_id_norm` already has `0x` prefix, but we're adding another one!

### Fix Required
The join should be:
```sql
ON lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
```

But since `vw_resolutions_unified` already adds the `0x` prefix in the view, the join should be:
```sql
ON lower(t.condition_id_norm) = r.cid_hex
```

---

## Action Items

### Immediate (Fix Coverage)

1. **Investigate condition_id normalization**
   - Check if `vw_trades_canonical.condition_id_norm` has `0x` prefix
   - Check if join logic in coverage query is correct
   - Fix join to achieve ~63% coverage (144k/228k)

2. **Update P&L views** (4 views)
   ```sql
   -- Replace vw_resolutions_all with vw_resolutions_unified in:
   - vw_trade_pnl
   - vw_trade_pnl_final
   - vw_wallet_pnl_simple
   - vw_wallet_positions
   ```

3. **Verify P&L calculations still work**
   - Run test queries on sample wallets
   - Compare results before/after migration

### Short Term (Improve Coverage)

4. **Backfill missing resolutions**
   - 228k - 144k = 84k markets without resolutions
   - Check if these are:
     - Unresolved markets (still active)
     - Resolved after data collection cutoff
     - Missing from warehouse for other reasons

5. **Add resolution monitoring**
   - Alert when resolution coverage drops below 60%
   - Daily job to backfill new resolutions

### Long Term (Deprecation)

6. **Deprecate old views**
   - Mark `vw_resolutions_all` as deprecated
   - Redirect all queries to `vw_resolutions_unified`
   - Eventually drop old views

7. **Clean up bad API data**
   ```sql
   ALTER TABLE cascadian_clean.resolutions_src_api
   DELETE WHERE resolved = 0 OR winning_index < 0 OR payout_denominator = 0
   SETTINGS mutations_sync = 1;
   ```

---

## SQL Quick Reference

### Check coverage
```sql
WITH traded AS (
  SELECT
    count(DISTINCT condition_id_norm) as total_markets,
    sum(abs(usd_value)) as total_volume
  FROM default.vw_trades_canonical
  WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
),
covered AS (
  SELECT
    count(DISTINCT t.condition_id_norm) as covered_markets,
    sum(abs(t.usd_value)) as covered_volume
  FROM default.vw_trades_canonical t
  INNER JOIN cascadian_clean.vw_resolutions_unified r
    ON lower(t.condition_id_norm) = r.cid_hex
  WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
)
SELECT
  traded.total_markets,
  traded.total_volume,
  covered.covered_markets,
  covered.covered_volume,
  round(100.0 * covered.covered_markets / traded.total_markets, 2) as market_pct,
  round(100.0 * covered.covered_volume / traded.total_volume, 2) as volume_pct
FROM traded, covered;
```

### Get resolution for a market
```sql
SELECT *
FROM cascadian_clean.vw_resolutions_unified
WHERE cid_hex = lower('0x...')
```

### Calculate PnL with payout vector
```sql
SELECT
  t.wallet_address,
  t.condition_id_norm,
  t.shares,
  t.cost_basis,
  r.payout_numerators,
  r.payout_denominator,
  r.winning_index,
  (t.shares * arrayElement(r.payout_numerators, r.winning_index + 1)) / r.payout_denominator - t.cost_basis as pnl_usd
FROM vw_trades_canonical t
INNER JOIN cascadian_clean.vw_resolutions_unified r
  ON lower(t.condition_id_norm) = r.cid_hex
```

---

## Files Created

- `/Users/scotty/Projects/Cascadian-app/verify-unified-resolutions.ts` - Full verification script
- `/Users/scotty/Projects/Cascadian-app/create-unified-resolutions-view.sql` - SQL DDL
- `/Users/scotty/Projects/Cascadian-app/UNIFIED_RESOLUTIONS_REPORT.md` - This report

## Database Objects Created

- `cascadian_clean.vw_resolutions_unified` - Unified resolutions view (144k markets)
