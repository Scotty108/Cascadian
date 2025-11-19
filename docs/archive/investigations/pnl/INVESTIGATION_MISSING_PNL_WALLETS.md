# Investigation Report: Missing P&L for Wallets 2-4

## Executive Summary

**Critical Finding:** The `is_resolved` field in `trades_raw` is NOT being populated correctly for wallets 2-4, despite having significant trade activity and their markets likely being resolved.

## Test Wallet Status

| Wallet | UI P&L | Total Trades | Resolved Trades | Unresolved Trades | Unique Conditions | Status |
|--------|---------|--------------|-----------------|-------------------|-------------------|--------|
| 0x1489...c1307 | $137,663 | 3,598 | **2,003** (56%) | 1,595 | 141 | ✅ Working |
| 0x8e9e...f38e4 | $360,492 | 2 | **0** (0%) | 2 | 2 | ❌ Broken |
| 0xcce2...d58b | $94,730 | 1,385 | **0** (0%) | 1,385 | 142 | ❌ Broken |
| 0x6770...545fb | $12,171 | 1,794 | **0** (0%) | 1,794 | 284 | ❌ Broken |

## Root Cause Analysis

### Issue 1: is_resolved Field Not Updated

The `is_resolved` field in `trades_raw` is a UInt8 flag (0 = unresolved, 1 = resolved). This field should be updated when:
1. A market resolution is added to `market_resolutions_final`
2. The resolution data propagates to the trades table

**For wallets 2-4, this update is NOT happening.**

### Schema Details

#### trades_raw Table
- **wallet_address**: String (wallet identifier)
- **condition_id**: String (market condition ID, may include '0x' prefix)
- **is_resolved**: UInt8 (0 or 1 flag)
- **resolved_outcome**: LowCardinality(String) (empty if unresolved)
- **outcome_index**: Int16 (defaults to -1 if unresolved)
- **realized_pnl_usd**: Float64 (should be calculated when resolved)

#### market_resolutions_final Table
- **condition_id_norm**: FixedString(64) (lowercase, no '0x' prefix)
- **payout_numerators**: Array(UInt8) (payout vector, e.g., [1, 0] for Yes)
- **payout_denominator**: UInt8 (usually 1)
- **winning_outcome**: LowCardinality(String) (e.g., 'Yes', 'NO', 'Over')
- **winning_index**: UInt16 (0-indexed position in payout vector)
- **resolved_at**: Nullable(DateTime)

### Issue 2: condition_id Normalization Mismatch

The join between `trades_raw` and `market_resolutions_final` requires:
- **trades_raw.condition_id**: May be stored WITH or WITHOUT '0x' prefix
- **market_resolutions_final.condition_id_norm**: Always lowercase, NO '0x' prefix, FixedString(64)

**Join Pattern (Correct):**
```sql
INNER JOIN market_resolutions_final r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
```

## Date Range Analysis

| Wallet | Earliest Trade | Latest Trade | Trade Period |
|--------|----------------|--------------|--------------|
| 0x1489...c1307 | 2024-10-27 20:13:00 | 2025-10-27 21:00:25 | ~12 months |
| 0x8e9e...f38e4 | 2025-10-19 00:52:14 | 2025-10-19 00:52:14 | Same day (2 trades) |
| 0xcce2...d58b | 2024-08-21 14:38:22 | 2025-10-15 00:15:01 | ~14 months |
| 0x6770...545fb | 2025-02-26 20:01:43 | 2025-10-28 21:27:07 | ~8 months |

**Insight:** Wallets 3 and 4 have extensive trading history (14 months and 8 months respectively) with ZERO resolved trades. This is statistically impossible unless:
1. They only trade on long-duration markets (unlikely with 1,385+ and 1,794+ trades)
2. The resolution update pipeline is broken
3. Their condition_ids are malformed or don't match the resolution table

## Next Diagnostic Steps

### Step 1: Check Condition ID Coverage
For each failing wallet, verify if their condition_ids exist in `market_resolutions_final`:

```sql
-- For Wallet 3 (1,385 trades, 142 unique conditions, $94,730 UI P&L)
WITH wallet_conditions AS (
  SELECT DISTINCT
    condition_id,
    lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
    count() as trade_count
  FROM trades_raw
  WHERE lower(wallet_address) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
  GROUP BY condition_id
)
SELECT
  wc.condition_id,
  wc.trade_count,
  r.winning_outcome,
  r.resolved_at,
  CASE WHEN r.condition_id_norm IS NOT NULL THEN 'MATCHED' ELSE 'UNMATCHED' END as status
FROM wallet_conditions wc
LEFT JOIN market_resolutions_final r
  ON wc.condition_id_norm = r.condition_id_norm
ORDER BY wc.trade_count DESC
LIMIT 20;
```

### Step 2: Check is_resolved Update Pipeline

Find the script/process that updates `is_resolved` in `trades_raw`:
- Likely a ClickHouse materialized view or scheduled query
- May be a batch update script in `/scripts/`
- Could be triggered by new data in `market_resolutions_final`

**Search patterns:**
```bash
grep -r "is_resolved" scripts/
grep -r "trades_raw" scripts/ | grep -i "update\|merge\|insert"
```

### Step 3: Validate Data Quality

Check for condition_id format issues:
```sql
SELECT
  condition_id,
  length(condition_id) as len,
  condition_id LIKE '0x%' as has_prefix,
  length(replaceAll(condition_id, '0x', '')) as norm_len
FROM trades_raw
WHERE lower(wallet_address) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
  AND (
    length(replaceAll(condition_id, '0x', '')) != 64
    OR condition_id = ''
    OR condition_id IS NULL
  )
LIMIT 10;
```

## Recommendations

### Immediate Fix (Manual Backfill)

If condition_ids exist in `market_resolutions_final` but `is_resolved` isn't set, run a backfill:

```sql
-- WARNING: Test on small sample first!
-- This is a ClickHouse ReplacingMergeTree pattern, not an UPDATE

CREATE TABLE trades_raw_updated AS
SELECT
  t.*,
  CASE
    WHEN r.condition_id_norm IS NOT NULL THEN 1
    ELSE t.is_resolved
  END as is_resolved,
  coalesce(r.winning_outcome, t.resolved_outcome) as resolved_outcome,
  coalesce(r.winning_index, t.outcome_index) as outcome_index
FROM trades_raw t
LEFT JOIN market_resolutions_final r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm;

-- Then atomic swap:
RENAME TABLE trades_raw TO trades_raw_backup,
             trades_raw_updated TO trades_raw;
```

### Long-term Fix

1. **Materialized View**: Create a materialized view that auto-updates `is_resolved` when new resolutions arrive
2. **Trigger**: Add a post-insert trigger on `market_resolutions_final` to update `trades_raw`
3. **Scheduled Job**: Run a daily reconciliation script to catch any gaps

### P&L Calculation Fix

Once `is_resolved` is correct, the P&L calculation should use:

```sql
SELECT
  wallet_address,
  sum(CASE
    WHEN is_resolved = 1 THEN
      shares * (arrayElement(r.payout_numerators, outcome_index + 1) / r.payout_denominator) - usd_value
    ELSE 0
  END) as realized_pnl
FROM trades_raw t
LEFT JOIN market_resolutions_final r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE wallet_address IN (
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
)
GROUP BY wallet_address;
```

## Files to Review

1. `/scripts/` - Look for resolution update scripts
2. `/lib/clickhouse/` - Check for materialized view definitions
3. `PAYOUT_VECTOR_PNL_UPDATE.md` - Existing P&L documentation
4. `scripts/step4-gate-then-swap.ts` - Atomic rebuild pattern
5. `scripts/step5-rebuild-pnl.ts` - P&L recalculation logic

## Critical Questions

1. **How is `is_resolved` supposed to be updated?** (materialized view? script? manual?)
2. **Why does Wallet 1 have resolved trades but Wallets 2-4 don't?** (different time periods? different update logic?)
3. **Is there a backfill script that needs to be run?** (check recent commits for migration scripts)
4. **Are there logs showing the resolution update process?** (check for errors or skipped wallets)

---

**Status:** Investigation in progress - awaiting Step 1 (condition ID coverage check)
**Priority:** HIGH - $467,393 in UI P&L is missing from calculated P&L ($360,492 + $94,730 + $12,171)
**Impact:** 75% of test wallets failing (3 out of 4)
