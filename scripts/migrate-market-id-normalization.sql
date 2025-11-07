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
