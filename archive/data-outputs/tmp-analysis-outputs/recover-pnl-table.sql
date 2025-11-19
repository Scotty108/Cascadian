-- Step 1: Create staging table with sign-corrected P&L
CREATE TABLE default.realized_pnl_by_market_final_staging
ENGINE = MergeTree()
ORDER BY (wallet, condition_id_norm)
AS SELECT
    wallet,
    condition_id as condition_id_norm,
    '' as market_id,
    toDateTime('1970-01-01 00:00:00') as resolved_at,
    -1 * SUM(coalesce(realized_pnl_usd, 0)) as realized_pnl_usd
FROM vw_wallet_pnl_calculated_backup
GROUP BY wallet, condition_id;

-- Step 2: Verify row counts
SELECT 'Staging table created' as status, COUNT(*) as row_count FROM default.realized_pnl_by_market_final_staging;

-- Step 3: Show sign distribution
SELECT 
    'Sign distribution' as metric,
    SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as positive_pnl,
    SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as negative_pnl
FROM default.realized_pnl_by_market_final_staging;
