-- GoldSky Cleanup: Drop Unused Tables
--
-- These tables are NOT used in production and can be safely dropped:
-- - pm_fpmm_trades: FPMM/AMM trades (never integrated into PnL pipeline)
-- - pm_fpmm_pool_map: FPMM pool mapping (supporting table for unused pm_fpmm_trades)
--
-- Estimated savings: ~40% of GoldSky costs ($600-675/month at $1500/month)
--
-- Date: 2026-01-31

-- Step 1: Verify tables exist and check row counts
SELECT 'pm_fpmm_trades' as table_name, count() as rows FROM pm_fpmm_trades
UNION ALL
SELECT 'pm_fpmm_pool_map' as table_name, count() as rows FROM pm_fpmm_pool_map;

-- Step 2: Verify no production code references these tables
-- Run this grep first: grep -r "pm_fpmm_trades\|pm_fpmm_pool_map" --include="*.ts" app/ lib/
-- Expected result: No files (only goldsky/ and scripts/ which are not production)

-- Step 3: Drop the unused tables
-- UNCOMMENT THESE LINES AFTER VERIFYING STEP 1 AND 2:

-- DROP TABLE IF EXISTS pm_fpmm_trades;
-- DROP TABLE IF EXISTS pm_fpmm_pool_map;

-- Step 4: Verify cleanup
-- SELECT name FROM system.tables WHERE database = currentDatabase() AND name LIKE 'pm_fpmm%';
