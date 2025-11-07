# Market ID Normalization Strategy
## Comprehensive Plan to Fix HEX/INTEGER Format Inconsistency

**Created:** 2025-11-06
**Status:** Ready for execution
**Estimated Total Time:** 15-20 minutes

---

## Executive Summary

**Problem:** The `market_id` field exists in two formats across the database:
- **HEX format:** `0x2c3c76ce13ce9d11b2000f25f652eec8fbf2cc5a14b26fa47f3cc6e93fe25329` (66 chars)
- **INTEGER format:** `100`, `538928` (2-10 chars)

**Impact:**
- GROUP BY operations create duplicate rows (one per format)
- JOINs fail when one side uses HEX and the other uses INTEGER
- P&L calculations show inflated values due to duplication
- 67.9M trades affected: 64M in HEX format, 4M in INTEGER format

**Solution:** Normalize all market_id values to LOWERCASE HEX format (without 0x prefix) to match condition_id_norm pattern.

**Critical Insight:** The `market_resolution_map` table uses INTEGER format and is the canonical source of truth for condition_id ↔ market_id mapping. We'll use this for lookups.

---

## Part 1: Normalization Function Design

### 1.1 SQL Function: normalize_market_id

```sql
-- This function is IDEMPOTENT - safe to apply multiple times
-- Converts both HEX and INTEGER market_id to canonical lowercase hex format

CREATE FUNCTION normalize_market_id AS (market_id_input) ->
  if(
    -- If already in HEX format (length > 20)
    length(market_id_input) > 20,
    -- Strip 0x prefix and lowercase
    lower(replaceAll(market_id_input, '0x', '')),
    -- Otherwise it's INTEGER format, return as-is for now
    -- We'll handle INTEGER -> HEX via JOIN to market_resolution_map
    market_id_input
  );
```

**Design Decisions:**
- Uses `length > 20` to distinguish HEX (66 chars) from INTEGER (2-10 chars)
- Strips `0x` prefix to match `condition_id_norm` format
- Lowercase for case-insensitive matching
- Returns INTEGER as-is because conversion requires lookup in market_resolution_map

---

## Part 2: Table Rebuild Strategy

### 2.1 Rebuild outcome_positions_v2

**Current Issues:**
- View definition groups by `lower(market_id)` which doesn't normalize HEX/INT difference
- Creates duplicate rows for same market when both formats exist
- Source: `trades_dedup_mat` (has mixed formats)

**Rebuild Plan:**

```sql
-- STEP 1: Create backup view with current definition
CREATE VIEW outcome_positions_v2_backup AS
SELECT * FROM outcome_positions_v2;

-- STEP 2: Drop current view
DROP VIEW outcome_positions_v2;

-- STEP 3: Rebuild with proper normalization
-- Strategy: Join trades_dedup_mat to market_resolution_map to get canonical condition_id
-- Then group by condition_id instead of market_id

CREATE VIEW outcome_positions_v2 (
    wallet String,
    condition_id_norm String,
    outcome_idx Int16,
    net_shares Float64
) AS
SELECT
    lower(t.wallet_address) AS wallet,
    lower(replaceAll(t.condition_id, '0x', '')) AS condition_id_norm,
    t.outcome_index AS outcome_idx,
    sum(if(t.side = 1, 1.0, -1.0) * toFloat64(t.shares)) AS net_shares
FROM trades_dedup_mat AS t
WHERE t.outcome_index IS NOT NULL
  AND t.condition_id IS NOT NULL
  AND t.condition_id != ''
  AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
GROUP BY
    wallet,
    condition_id_norm,
    outcome_idx
HAVING abs(net_shares) > 0.0001;  -- Filter out zero balances

-- VERIFICATION QUERY
SELECT
    'outcome_positions_v2_backup' as source,
    count() as total_rows,
    count(DISTINCT wallet) as unique_wallets,
    count(DISTINCT condition_id_norm) as unique_conditions
FROM outcome_positions_v2_backup
UNION ALL
SELECT
    'outcome_positions_v2_new' as source,
    count() as total_rows,
    count(DISTINCT wallet) as unique_wallets,
    count(DISTINCT condition_id_norm) as unique_conditions
FROM outcome_positions_v2;
```

**Key Changes:**
1. **Removed `market_id` from grouping** - Group by condition_id_norm only (this is the true unique key)
2. **Added NULL/empty filters** - Exclude invalid condition_ids
3. **Added HAVING clause** - Filter out zero balances (reduces noise)
4. **Simplified schema** - Removed redundant market_id column

**Expected Impact:**
- **Before:** ~X rows with duplicates per market
- **After:** Deduplicated rows grouped by condition only
- **Row reduction:** Expect 5-10% reduction from deduplication

---

### 2.2 Rebuild trade_cashflows_v3

**Current Issues:**
- Same as outcome_positions_v2
- Groups by `lower(market_id)` without normalization
- Creates duplicate cashflow entries

**Rebuild Plan:**

```sql
-- STEP 1: Create backup
CREATE VIEW trade_cashflows_v3_backup AS
SELECT * FROM trade_cashflows_v3;

-- STEP 2: Drop current view
DROP VIEW trade_cashflows_v3;

-- STEP 3: Rebuild with proper normalization
CREATE VIEW trade_cashflows_v3 (
    wallet String,
    condition_id_norm String,
    outcome_idx Int16,
    px Float64,
    sh Float64,
    cashflow_usdc Float64
) AS
SELECT
    lower(t.wallet_address) AS wallet,
    lower(replaceAll(t.condition_id, '0x', '')) AS condition_id_norm,
    t.outcome_index AS outcome_idx,
    toFloat64(t.entry_price) AS px,
    toFloat64(t.shares) AS sh,
    round(
        toFloat64(t.entry_price) * toFloat64(t.shares) * if(t.side = 1, -1, 1),
        8
    ) AS cashflow_usdc
FROM trades_dedup_mat AS t
WHERE t.outcome_index IS NOT NULL
  AND t.condition_id IS NOT NULL
  AND t.condition_id != ''
  AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000';

-- VERIFICATION QUERY
SELECT
    'trade_cashflows_v3_backup' as source,
    count() as total_rows,
    sum(cashflow_usdc) as total_cashflow,
    count(DISTINCT wallet) as unique_wallets
FROM trade_cashflows_v3_backup
UNION ALL
SELECT
    'trade_cashflows_v3_new' as source,
    count() as total_rows,
    sum(cashflow_usdc) as total_cashflow,
    count(DISTINCT wallet) as unique_wallets
FROM trade_cashflows_v3;
```

**Key Changes:**
1. **Removed `market_id` from output** - No longer needed
2. **Added validation filters** - Exclude invalid condition_ids
3. **No aggregation** - This is a row-level view (one row per trade)

**Expected Impact:**
- **Before:** Same row count as trades_dedup_mat
- **After:** Same row count (this is not an aggregated view)
- **Data quality:** Improved by filtering invalid condition_ids

---

### 2.3 Update ctf_token_map (if needed)

**Current State:** 41,130 rows, market_id column exists but may be empty/inconsistent

**Decision:** **DO NOT UPDATE** - This table maps token_id → condition_id. The market_id column is secondary metadata. We can populate it later if needed via:

```sql
-- Optional: Populate market_id in ctf_token_map from market_resolution_map
-- Only run if you need market_id in this table

ALTER TABLE ctf_token_map
UPDATE market_id = (
    SELECT toString(m.market_id)
    FROM market_resolution_map AS m
    WHERE lower(replaceAll(m.condition_id, '0x', '')) = ctf_token_map.condition_id_norm
    LIMIT 1
)
WHERE market_id = '' OR market_id IS NULL;
```

**Why skip this:**
- ctf_token_map is used for token → condition lookups, not market lookups
- Adding market_id is informational, not functional
- Can be done later without breaking anything

---

## Part 3: Verification Queries

### 3.1 Pre-Migration Baseline

Run BEFORE making any changes to capture baseline metrics:

```sql
-- Save baseline metrics
CREATE TABLE IF NOT EXISTS migration_baseline_2025_11_06 (
    metric_name String,
    metric_value String,
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (metric_name, created_at);

-- Capture baseline
INSERT INTO migration_baseline_2025_11_06
SELECT 'outcome_positions_v2_row_count', toString(count()), now() FROM outcome_positions_v2
UNION ALL
SELECT 'outcome_positions_v2_unique_wallets', toString(count(DISTINCT wallet)), now() FROM outcome_positions_v2
UNION ALL
SELECT 'outcome_positions_v2_unique_conditions', toString(count(DISTINCT condition_id_norm)), now() FROM outcome_positions_v2
UNION ALL
SELECT 'trade_cashflows_v3_row_count', toString(count()), now() FROM trade_cashflows_v3
UNION ALL
SELECT 'trade_cashflows_v3_total_cashflow', toString(sum(cashflow_usdc)), now() FROM trade_cashflows_v3
UNION ALL
SELECT 'trades_dedup_mat_hex_count', toString(countIf(length(market_id) > 20)), now() FROM trades_dedup_mat
UNION ALL
SELECT 'trades_dedup_mat_int_count', toString(countIf(length(market_id) <= 20)), now() FROM trades_dedup_mat;

-- View baseline
SELECT * FROM migration_baseline_2025_11_06 ORDER BY metric_name;
```

---

### 3.2 Post-Migration Verification

Run AFTER rebuilding views:

```sql
-- 1. Verify no data loss in outcome_positions_v2
SELECT
    'Check: Net shares should be similar' as check_name,
    abs(
        (SELECT sum(net_shares) FROM outcome_positions_v2) -
        (SELECT sum(net_shares) FROM outcome_positions_v2_backup)
    ) as difference,
    if(difference < 100, 'PASS', 'FAIL') as status;

-- 2. Verify no data loss in trade_cashflows_v3
SELECT
    'Check: Total cashflow should be identical' as check_name,
    abs(
        (SELECT sum(cashflow_usdc) FROM trade_cashflows_v3) -
        (SELECT sum(cashflow_usdc) FROM trade_cashflows_v3_backup)
    ) as difference,
    if(difference < 100, 'PASS', 'FAIL') as status;

-- 3. Verify deduplication worked
SELECT
    'Check: Row count should be lower (deduped)' as check_name,
    (SELECT count() FROM outcome_positions_v2_backup) as before_count,
    (SELECT count() FROM outcome_positions_v2) as after_count,
    before_count - after_count as reduction,
    if(after_count < before_count, 'PASS', 'FAIL') as status;

-- 4. Verify no NULL condition_ids
SELECT
    'Check: No NULL condition_ids' as check_name,
    (SELECT countIf(condition_id_norm IS NULL OR condition_id_norm = '') FROM outcome_positions_v2) as null_count,
    if(null_count = 0, 'PASS', 'FAIL') as status;

-- 5. Test JOIN to market_resolution_map works
SELECT
    'Check: JOIN to market_resolution_map succeeds' as check_name,
    count() as joined_rows,
    if(joined_rows > 0, 'PASS', 'FAIL') as status
FROM outcome_positions_v2 AS o
INNER JOIN market_resolution_map AS m
    ON lower(replaceAll(m.condition_id, '0x', '')) = o.condition_id_norm
LIMIT 100;
```

---

### 3.3 Validation Test Cases

```sql
-- Test Case 1: Verify a specific wallet's positions match before/after
SELECT
    'Before normalization' as source,
    wallet,
    condition_id_norm,
    sum(net_shares) as total_shares
FROM outcome_positions_v2_backup
WHERE wallet = (SELECT wallet FROM outcome_positions_v2_backup LIMIT 1)
GROUP BY wallet, condition_id_norm
UNION ALL
SELECT
    'After normalization' as source,
    wallet,
    condition_id_norm,
    sum(net_shares) as total_shares
FROM outcome_positions_v2
WHERE wallet = (SELECT wallet FROM outcome_positions_v2_backup LIMIT 1)
GROUP BY wallet, condition_id_norm
ORDER BY source, condition_id_norm;

-- Test Case 2: Verify market_id INTEGER format was handled
-- This should show that even though market_id had mixed formats,
-- we now group by condition_id_norm only
SELECT
    condition_id_norm,
    count() as position_count,
    sum(net_shares) as total_shares
FROM outcome_positions_v2
GROUP BY condition_id_norm
HAVING position_count > 10
ORDER BY position_count DESC
LIMIT 10;
```

---

## Part 4: Risk Mitigation

### 4.1 What Could Go Wrong

| Risk | Probability | Impact | Mitigation |
|------|-------------|---------|------------|
| **Data loss during rebuild** | Low | High | Create backup views first; verify before dropping backups |
| **JOIN failures** | Low | Medium | Test JOINs in verification queries before declaring success |
| **Performance degradation** | Low | Low | Views are not materialized; queries remain fast |
| **Condition_id has NULL values** | Medium | Medium | Add WHERE filters to exclude NULL/empty values |
| **Zero balance noise** | Low | Low | Add HAVING clause to filter out near-zero balances |

---

### 4.2 Detection Mechanisms

**How to detect if normalization failed:**

```sql
-- Detection Query 1: Check for duplicate positions per wallet+condition
SELECT
    wallet,
    condition_id_norm,
    count() as duplicate_count
FROM outcome_positions_v2
GROUP BY wallet, condition_id_norm
HAVING duplicate_count > 1;
-- Expected: 0 rows (no duplicates)

-- Detection Query 2: Check for invalid condition_ids
SELECT
    count() as invalid_condition_count
FROM outcome_positions_v2
WHERE condition_id_norm IS NULL
   OR condition_id_norm = ''
   OR length(condition_id_norm) != 64;
-- Expected: 0 rows

-- Detection Query 3: Check for failed JOINs
SELECT
    count(*) as positions_without_market
FROM outcome_positions_v2 AS o
LEFT JOIN market_resolution_map AS m
    ON lower(replaceAll(m.condition_id, '0x', '')) = o.condition_id_norm
WHERE m.condition_id IS NULL;
-- Expected: Low percentage (<5%)
```

---

### 4.3 Rollback Procedures

**If normalization fails or produces unexpected results:**

```sql
-- ROLLBACK STEP 1: Restore outcome_positions_v2
DROP VIEW IF EXISTS outcome_positions_v2;
CREATE VIEW outcome_positions_v2 AS SELECT * FROM outcome_positions_v2_backup;

-- ROLLBACK STEP 2: Restore trade_cashflows_v3
DROP VIEW IF EXISTS trade_cashflows_v3;
CREATE VIEW trade_cashflows_v3 AS SELECT * FROM trade_cashflows_v3_backup;

-- ROLLBACK STEP 3: Verify restoration
SELECT 'outcome_positions_v2', count() FROM outcome_positions_v2
UNION ALL
SELECT 'outcome_positions_v2_backup', count() FROM outcome_positions_v2_backup;
-- Should show identical counts

-- ROLLBACK STEP 4: Drop backups once verified
-- (Only do this after confirming rollback worked)
DROP VIEW IF EXISTS outcome_positions_v2_backup;
DROP VIEW IF EXISTS trade_cashflows_v3_backup;
```

**Estimated Rollback Time:** 30 seconds

---

## Part 5: Related Tables & Dependencies

### 5.1 Tables Directly Affected

| Table | Type | Needs Update? | Action |
|-------|------|---------------|--------|
| `outcome_positions_v2` | View | ✅ YES | Rebuild with new definition |
| `trade_cashflows_v3` | View | ✅ YES | Rebuild with new definition |
| `trades_dedup_mat` | Table | ❌ NO | Source table; keep as-is |
| `market_resolution_map` | Table | ❌ NO | Canonical mapping; keep as-is |
| `ctf_token_map` | Table | ⚠️ OPTIONAL | Can populate market_id later |

---

### 5.2 Tables Indirectly Affected (Downstream Dependencies)

**These tables JOIN to outcome_positions_v2 or trade_cashflows_v3:**

```sql
-- Find all views that reference outcome_positions_v2
SELECT
    view_name,
    view_definition
FROM system.tables
WHERE database = 'default'
  AND engine = 'View'
  AND create_table_query LIKE '%outcome_positions_v2%'
ORDER BY view_name;

-- Find all views that reference trade_cashflows_v3
SELECT
    view_name,
    view_definition
FROM system.tables
WHERE database = 'default'
  AND engine = 'View'
  AND create_table_query LIKE '%trade_cashflows_v3%'
ORDER BY view_name;
```

**Action Required:** After rebuilding the two views, test any downstream views/queries to ensure they still work. Most should work automatically since we're only removing `market_id` column (which can be re-joined if needed).

---

### 5.3 Should daily-sync script be updated?

**Location:** `/Users/scotty/Projects/Cascadian-app/scripts/daily-sync-polymarket.ts`

**Decision:** **REVIEW AFTER MIGRATION**

**Potential Changes:**
1. If the script inserts into `trades_dedup_mat`, no change needed (source table unchanged)
2. If the script creates views, update to match new definitions
3. If the script queries `market_id`, update to use `condition_id_norm` instead

**Action:** After successful migration, audit the daily-sync script and update any hardcoded view definitions.

---

## Part 6: Execution Plan

### 6.1 Execution Order

**Total Estimated Time:** 15-20 minutes

```
Phase 1: Preparation (5 min)
  ├─ 1. Capture baseline metrics
  ├─ 2. Create backup views
  └─ 3. Test queries on backup views

Phase 2: Migration (5 min)
  ├─ 4. Drop and rebuild outcome_positions_v2
  ├─ 5. Drop and rebuild trade_cashflows_v3
  └─ 6. Verify both views compile

Phase 3: Verification (5-10 min)
  ├─ 7. Run all verification queries
  ├─ 8. Run test cases
  ├─ 9. Check for duplicates
  └─ 10. Test downstream dependencies

Phase 4: Cleanup (Optional)
  ├─ 11. Drop backup views (only after 24 hours of stable operation)
  └─ 12. Update daily-sync script if needed
```

---

### 6.2 Complete SQL Script (Copy-Paste Ready)

Save this as `/Users/scotty/Projects/Cascadian-app/scripts/migrate-market-id-normalization.sql`:

```sql
-- ============================================================================
-- MARKET ID NORMALIZATION MIGRATION
-- Date: 2025-11-06
-- Purpose: Fix HEX/INTEGER format inconsistency in market_id field
-- Estimated time: 15-20 minutes
-- ============================================================================

-- ============================================================================
-- PHASE 1: PREPARATION
-- ============================================================================

-- Create baseline metrics table
CREATE TABLE IF NOT EXISTS migration_baseline_2025_11_06 (
    metric_name String,
    metric_value String,
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (metric_name, created_at);

-- Capture baseline metrics
INSERT INTO migration_baseline_2025_11_06
SELECT 'outcome_positions_v2_row_count', toString(count()), now() FROM outcome_positions_v2
UNION ALL
SELECT 'outcome_positions_v2_unique_wallets', toString(count(DISTINCT wallet)), now() FROM outcome_positions_v2
UNION ALL
SELECT 'outcome_positions_v2_unique_conditions', toString(count(DISTINCT condition_id_norm)), now() FROM outcome_positions_v2
UNION ALL
SELECT 'outcome_positions_v2_sum_net_shares', toString(sum(net_shares)), now() FROM outcome_positions_v2
UNION ALL
SELECT 'trade_cashflows_v3_row_count', toString(count()), now() FROM trade_cashflows_v3
UNION ALL
SELECT 'trade_cashflows_v3_total_cashflow', toString(sum(cashflow_usdc)), now() FROM trade_cashflows_v3
UNION ALL
SELECT 'trade_cashflows_v3_unique_wallets', toString(count(DISTINCT wallet)), now() FROM trade_cashflows_v3
UNION ALL
SELECT 'trades_dedup_mat_hex_count', toString(countIf(length(market_id) > 20)), now() FROM trades_dedup_mat WHERE market_id != ''
UNION ALL
SELECT 'trades_dedup_mat_int_count', toString(countIf(length(market_id) <= 20)), now() FROM trades_dedup_mat WHERE market_id != '';

-- View baseline
SELECT '=== BASELINE METRICS ===' as status;
SELECT * FROM migration_baseline_2025_11_06 ORDER BY metric_name;

-- Create backup views
SELECT '=== CREATING BACKUPS ===' as status;

CREATE VIEW outcome_positions_v2_backup AS
SELECT * FROM outcome_positions_v2;

CREATE VIEW trade_cashflows_v3_backup AS
SELECT * FROM trade_cashflows_v3;

SELECT 'Backups created successfully' as status;

-- ============================================================================
-- PHASE 2: MIGRATION
-- ============================================================================

SELECT '=== STARTING MIGRATION ===' as status;

-- Rebuild outcome_positions_v2
SELECT 'Rebuilding outcome_positions_v2...' as status;

DROP VIEW IF EXISTS outcome_positions_v2;

CREATE VIEW outcome_positions_v2 (
    wallet String,
    condition_id_norm String,
    outcome_idx Int16,
    net_shares Float64
) AS
SELECT
    lower(t.wallet_address) AS wallet,
    lower(replaceAll(t.condition_id, '0x', '')) AS condition_id_norm,
    t.outcome_index AS outcome_idx,
    sum(if(t.side = 1, 1.0, -1.0) * toFloat64(t.shares)) AS net_shares
FROM trades_dedup_mat AS t
WHERE t.outcome_index IS NOT NULL
  AND t.condition_id IS NOT NULL
  AND t.condition_id != ''
  AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
GROUP BY
    wallet,
    condition_id_norm,
    outcome_idx
HAVING abs(net_shares) > 0.0001;

SELECT 'outcome_positions_v2 rebuilt successfully' as status;

-- Rebuild trade_cashflows_v3
SELECT 'Rebuilding trade_cashflows_v3...' as status;

DROP VIEW IF EXISTS trade_cashflows_v3;

CREATE VIEW trade_cashflows_v3 (
    wallet String,
    condition_id_norm String,
    outcome_idx Int16,
    px Float64,
    sh Float64,
    cashflow_usdc Float64
) AS
SELECT
    lower(t.wallet_address) AS wallet,
    lower(replaceAll(t.condition_id, '0x', '')) AS condition_id_norm,
    t.outcome_index AS outcome_idx,
    toFloat64(t.entry_price) AS px,
    toFloat64(t.shares) AS sh,
    round(
        toFloat64(t.entry_price) * toFloat64(t.shares) * if(t.side = 1, -1, 1),
        8
    ) AS cashflow_usdc
FROM trades_dedup_mat AS t
WHERE t.outcome_index IS NOT NULL
  AND t.condition_id IS NOT NULL
  AND t.condition_id != ''
  AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000';

SELECT 'trade_cashflows_v3 rebuilt successfully' as status;

-- ============================================================================
-- PHASE 3: VERIFICATION
-- ============================================================================

SELECT '=== VERIFICATION CHECKS ===' as status;

-- Check 1: Verify row count comparison
SELECT
    'Check 1: Row count comparison' as check_name,
    (SELECT count() FROM outcome_positions_v2_backup) as before_count,
    (SELECT count() FROM outcome_positions_v2) as after_count,
    before_count - after_count as reduction,
    round((reduction / before_count) * 100, 2) as reduction_pct,
    if(after_count <= before_count AND after_count > 0, 'PASS ✓', 'FAIL ✗') as status;

-- Check 2: Verify net shares sum is similar
SELECT
    'Check 2: Net shares preservation' as check_name,
    (SELECT sum(net_shares) FROM outcome_positions_v2_backup) as before_sum,
    (SELECT sum(net_shares) FROM outcome_positions_v2) as after_sum,
    abs(before_sum - after_sum) as difference,
    if(difference < 1000, 'PASS ✓', 'FAIL ✗') as status;

-- Check 3: Verify cashflow sum is similar
SELECT
    'Check 3: Cashflow preservation' as check_name,
    (SELECT sum(cashflow_usdc) FROM trade_cashflows_v3_backup) as before_sum,
    (SELECT sum(cashflow_usdc) FROM trade_cashflows_v3) as after_sum,
    abs(before_sum - after_sum) as difference,
    if(difference < 1000, 'PASS ✓', 'FAIL ✗') as status;

-- Check 4: Verify no NULL condition_ids
SELECT
    'Check 4: No NULL condition_ids' as check_name,
    (SELECT countIf(condition_id_norm IS NULL OR condition_id_norm = '') FROM outcome_positions_v2) as null_count,
    if(null_count = 0, 'PASS ✓', 'FAIL ✗') as status;

-- Check 5: Verify condition_id format is valid (64 hex chars)
SELECT
    'Check 5: Valid condition_id format' as check_name,
    (SELECT countIf(length(condition_id_norm) != 64) FROM outcome_positions_v2) as invalid_count,
    if(invalid_count = 0, 'PASS ✓', 'WARNING ⚠') as status;

-- Check 6: Test JOIN to market_resolution_map
SELECT
    'Check 6: JOIN to market_resolution_map' as check_name,
    (SELECT count() FROM outcome_positions_v2 AS o
     INNER JOIN market_resolution_map AS m
         ON lower(replaceAll(m.condition_id, '0x', '')) = o.condition_id_norm
     LIMIT 1000) as joined_rows,
    if(joined_rows > 0, 'PASS ✓', 'FAIL ✗') as status;

-- Check 7: Verify no duplicate positions per wallet+condition
SELECT
    'Check 7: No duplicate positions' as check_name,
    (SELECT count() FROM (
        SELECT wallet, condition_id_norm, count() as cnt
        FROM outcome_positions_v2
        GROUP BY wallet, condition_id_norm
        HAVING cnt > 1
    )) as duplicate_count,
    if(duplicate_count = 0, 'PASS ✓', 'FAIL ✗') as status;

-- ============================================================================
-- PHASE 4: POST-MIGRATION METRICS
-- ============================================================================

SELECT '=== POST-MIGRATION METRICS ===' as status;

INSERT INTO migration_baseline_2025_11_06
SELECT 'POST_outcome_positions_v2_row_count', toString(count()), now() FROM outcome_positions_v2
UNION ALL
SELECT 'POST_outcome_positions_v2_unique_wallets', toString(count(DISTINCT wallet)), now() FROM outcome_positions_v2
UNION ALL
SELECT 'POST_outcome_positions_v2_unique_conditions', toString(count(DISTINCT condition_id_norm)), now() FROM outcome_positions_v2
UNION ALL
SELECT 'POST_outcome_positions_v2_sum_net_shares', toString(sum(net_shares)), now() FROM outcome_positions_v2
UNION ALL
SELECT 'POST_trade_cashflows_v3_row_count', toString(count()), now() FROM trade_cashflows_v3
UNION ALL
SELECT 'POST_trade_cashflows_v3_total_cashflow', toString(sum(cashflow_usdc)), now() FROM trade_cashflows_v3;

-- Show before/after comparison
SELECT
    replaceRegexpOne(metric_name, '^POST_', '') as metric,
    max(if(metric_name NOT LIKE 'POST_%', metric_value, '0')) as before_value,
    max(if(metric_name LIKE 'POST_%', metric_value, '0')) as after_value,
    toFloat64(after_value) - toFloat64(before_value) as difference
FROM migration_baseline_2025_11_06
WHERE metric_name LIKE '%outcome_positions_v2%'
   OR metric_name LIKE '%trade_cashflows_v3%'
GROUP BY metric
ORDER BY metric;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

SELECT '=== MIGRATION COMPLETE ===' as status;
SELECT 'Review the verification checks above.' as next_step;
SELECT 'If all checks PASS, the migration was successful.' as next_step;
SELECT 'Backup views will be kept for 24 hours before cleanup.' as next_step;
```

---

### 6.3 Expected Row Count Changes

| Metric | Before | After (Expected) | Change |
|--------|--------|------------------|---------|
| outcome_positions_v2 rows | ~X | ~X * 0.90-0.95 | -5% to -10% (deduplication) |
| outcome_positions_v2 unique wallets | ~Y | ~Y | No change |
| outcome_positions_v2 unique conditions | ~Z | ~Z | No change |
| outcome_positions_v2 sum(net_shares) | ~A | ~A | No change (±1% tolerance) |
| trade_cashflows_v3 rows | ~B | ~B | No change (not aggregated) |
| trade_cashflows_v3 sum(cashflow_usdc) | ~C | ~C | No change (±1% tolerance) |

**Note:** Run the baseline capture query to get actual "Before" values.

---

## Part 7: Post-Migration Tasks

### 7.1 Immediate Tasks (Within 1 Hour)

- [ ] Run all verification queries and confirm PASS status
- [ ] Test a sample P&L calculation to verify JOINs work
- [ ] Check logs for any errors in downstream queries
- [ ] Document actual row count changes in this file

### 7.2 Short-Term Tasks (Within 24 Hours)

- [ ] Monitor query performance on outcome_positions_v2 and trade_cashflows_v3
- [ ] Review and update daily-sync script if needed
- [ ] Test all dashboard queries that use these views
- [ ] Update any documentation referencing market_id column

### 7.3 Long-Term Tasks (Within 1 Week)

- [ ] Drop backup views after confirming stability
- [ ] Update other tables that reference market_id (if needed)
- [ ] Consider adding materialized view for performance (optional)
- [ ] Add regression tests to prevent future format inconsistencies

---

## Part 8: Rollback Decision Matrix

| Condition | Action |
|-----------|--------|
| All verification checks PASS | ✅ Keep new views, plan to drop backups in 24h |
| 1-2 checks FAIL with minor issues | ⚠️ Investigate, fix issues, re-verify |
| 3+ checks FAIL | 🔴 ROLLBACK immediately using procedures in Section 4.3 |
| Performance degradation >50% | 🔴 ROLLBACK, investigate query optimization |
| Data loss detected (sum mismatch >5%) | 🔴 ROLLBACK immediately, investigate root cause |

---

## Appendix A: Understanding the Root Cause

**Why did this happen?**

1. **market_resolution_map** uses INTEGER format for market_id (from Polymarket API)
2. **trades_dedup_mat** uses HEX format for market_id (from blockchain condition_id)
3. Views grouped by `lower(market_id)` without normalization
4. Result: Same market appears in two groups (one HEX, one INTEGER)

**The correct approach:**

- **condition_id** is the true unique identifier (from blockchain)
- **market_id** is secondary metadata (from Polymarket API)
- Group by `condition_id_norm` (normalized condition_id)
- Use `market_resolution_map` for lookups when market_id needed

---

## Appendix B: Alternative Approaches Considered

### Option 1: Convert INTEGER → HEX via Lookup (REJECTED)

```sql
-- This would require joining every query to market_resolution_map
-- Performance impact too high
SELECT
    COALESCE(
        (SELECT condition_id FROM market_resolution_map WHERE market_id = t.market_id),
        t.market_id
    ) as normalized_market_id
FROM trades_dedup_mat AS t;
```

**Why rejected:** Too slow, complex, error-prone

### Option 2: Update trades_dedup_mat to HEX format (REJECTED)

```sql
-- This would require mutation on 67M rows
-- Mutation limit is 1000, would take hours
ALTER TABLE trades_dedup_mat
UPDATE market_id = (SELECT condition_id FROM market_resolution_map WHERE ...)
WHERE length(market_id) <= 20;
```

**Why rejected:** Too slow, risky, unnecessary

### Option 3: Group by condition_id_norm instead (SELECTED ✅)

**Why selected:**
- Fastest (no JOINs needed)
- Safest (view-only changes)
- Most correct (condition_id is the true key)
- Simplest (remove market_id from grouping)

---

## Appendix C: Quick Reference Commands

```bash
# Run the migration (from project root)
npx tsx -e "$(cat scripts/migrate-market-id-normalization.sql)"

# Or use ClickHouse client directly
cat scripts/migrate-market-id-normalization.sql | \
  clickhouse-client \
    --host=$CLICKHOUSE_HOST \
    --user=$CLICKHOUSE_USER \
    --password=$CLICKHOUSE_PASSWORD \
    --database=$CLICKHOUSE_DATABASE

# Check migration status
npx tsx -e "
import { createClient } from '@clickhouse/client';
const ch = createClient({ host: process.env.CLICKHOUSE_HOST, ... });
const r = await ch.query({
  query: 'SELECT * FROM migration_baseline_2025_11_06 ORDER BY created_at DESC LIMIT 20',
  format: 'JSONEachRow'
});
console.log(await r.json());
"
```

---

## Document Metadata

- **Created:** 2025-11-06
- **Last Updated:** 2025-11-06
- **Version:** 1.0
- **Author:** Database Architect Agent
- **Estimated Execution Time:** 15-20 minutes
- **Risk Level:** Low (view-only changes, backups created)
- **Rollback Time:** <1 minute
- **Prerequisites:** ClickHouse access, ~20 minutes of downtime tolerance

---

**END OF DOCUMENT**
