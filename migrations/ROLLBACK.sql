-- ============================================================================
-- ROLLBACK SCRIPT
-- ============================================================================
-- Purpose: Safely rollback API integration migrations
-- Author: Database Architect Agent
-- Date: 2025-11-09
-- Usage: Run sections in reverse order to rollback specific migrations
-- ============================================================================

-- ============================================================================
-- OPTION 1: ROLLBACK ALL MIGRATIONS (NUCLEAR OPTION)
-- ============================================================================
-- WARNING: This will delete ALL API integration tables and views
-- Only use if starting fresh or critical issues occur

/*
DROP VIEW IF EXISTS cascadian_clean.mv_data_quality_summary;
DROP TABLE IF EXISTS cascadian_clean.data_sync_status;
DROP TABLE IF EXISTS cascadian_clean.market_coverage_metrics;
DROP TABLE IF EXISTS cascadian_clean.wallet_coverage_metrics;

DROP TABLE IF EXISTS cascadian_clean.leaderboard_omega;
DROP TABLE IF EXISTS cascadian_clean.leaderboard_whales;
DROP TABLE IF EXISTS cascadian_clean.wallet_omega_daily;
DROP TABLE IF EXISTS cascadian_clean.wallet_market_returns;

DROP VIEW IF EXISTS cascadian_clean.vw_wallet_positions_api_format;
DROP VIEW IF EXISTS cascadian_clean.vw_pnl_reconciliation;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_truth;

DROP TABLE IF EXISTS default.wallet_api_backfill_log;
DROP TABLE IF EXISTS default.wallet_metadata_api;
DROP TABLE IF EXISTS default.wallet_positions_api;
*/

-- ============================================================================
-- OPTION 2: ROLLBACK MIGRATION 004 ONLY (Coverage Metrics)
-- ============================================================================
-- Safe to rollback if coverage metrics not working as expected
-- Does not affect leaderboards or core data

/*
DROP VIEW IF EXISTS cascadian_clean.mv_data_quality_summary;
DROP TABLE IF EXISTS cascadian_clean.data_sync_status;
DROP TABLE IF EXISTS cascadian_clean.market_coverage_metrics;
DROP TABLE IF EXISTS cascadian_clean.wallet_coverage_metrics;
*/

-- ============================================================================
-- OPTION 3: ROLLBACK MIGRATION 003 ONLY (Leaderboards)
-- ============================================================================
-- Safe to rollback if leaderboard calculations incorrect
-- Does not affect views or staging data

/*
DROP TABLE IF EXISTS cascadian_clean.leaderboard_omega;
DROP TABLE IF EXISTS cascadian_clean.leaderboard_whales;
DROP TABLE IF EXISTS cascadian_clean.wallet_omega_daily;
DROP TABLE IF EXISTS cascadian_clean.wallet_market_returns;
*/

-- ============================================================================
-- OPTION 4: ROLLBACK MIGRATION 002 ONLY (Views)
-- ============================================================================
-- Only rollback if views causing query errors
-- Must recreate old vw_resolutions_truth if rolling back

/*
-- Drop new views
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_positions_api_format;
DROP VIEW IF EXISTS cascadian_clean.vw_pnl_reconciliation;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_truth;

-- Recreate old vw_resolutions_truth (single source)
CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_truth AS
SELECT
    toString(condition_id_norm) as condition_id_normalized,
    payout_numerators,
    payout_denominator,
    winning_index,
    resolved_at,
    'market_resolutions_final' as resolution_source,
    'blockchain' as resolution_method
FROM default.market_resolutions_final
WHERE payout_denominator > 0
  AND arraySum(payout_numerators) = payout_denominator
  AND resolved_at IS NOT NULL
  AND length(toString(condition_id_norm)) = 64;
*/

-- ============================================================================
-- OPTION 5: ROLLBACK MIGRATION 001 ONLY (Staging Tables)
-- ============================================================================
-- WARNING: This deletes all API-ingested data
-- Only use if schema needs complete redesign

/*
DROP TABLE IF EXISTS default.wallet_api_backfill_log;
DROP TABLE IF EXISTS default.wallet_metadata_api;
DROP TABLE IF EXISTS default.wallet_positions_api;

-- Note: resolutions_external_ingest already exists, don't drop unless certain
-- DROP TABLE IF EXISTS default.resolutions_external_ingest;
*/

-- ============================================================================
-- OPTION 6: SOFT ROLLBACK (Preserve Data)
-- ============================================================================
-- Rename tables instead of dropping to preserve data for debugging

/*
-- Rename staging tables
RENAME TABLE default.wallet_positions_api TO default.wallet_positions_api_old;
RENAME TABLE default.wallet_metadata_api TO default.wallet_metadata_api_old;
RENAME TABLE default.wallet_api_backfill_log TO default.wallet_api_backfill_log_old;

-- Rename analytics tables
RENAME TABLE cascadian_clean.wallet_market_returns TO cascadian_clean.wallet_market_returns_old;
RENAME TABLE cascadian_clean.wallet_omega_daily TO cascadian_clean.wallet_omega_daily_old;
RENAME TABLE cascadian_clean.leaderboard_whales TO cascadian_clean.leaderboard_whales_old;
RENAME TABLE cascadian_clean.leaderboard_omega TO cascadian_clean.leaderboard_omega_old;

-- Rename coverage tables
RENAME TABLE cascadian_clean.wallet_coverage_metrics TO cascadian_clean.wallet_coverage_metrics_old;
RENAME TABLE cascadian_clean.market_coverage_metrics TO cascadian_clean.market_coverage_metrics_old;
RENAME TABLE cascadian_clean.data_sync_status TO cascadian_clean.data_sync_status_old;

-- Views must be dropped (can't rename)
DROP VIEW IF EXISTS cascadian_clean.mv_data_quality_summary;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_positions_api_format;
DROP VIEW IF EXISTS cascadian_clean.vw_pnl_reconciliation;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_truth;
*/

-- ============================================================================
-- VERIFICATION AFTER ROLLBACK
-- ============================================================================

-- Check what was removed
SELECT
    database,
    name,
    engine
FROM system.tables
WHERE (database = 'default' AND name LIKE '%api%')
   OR (database = 'cascadian_clean' AND name LIKE '%leaderboard%')
   OR (database = 'cascadian_clean' AND name LIKE '%coverage%')
ORDER BY database, name;

-- Check remaining views
SELECT
    database,
    name,
    engine
FROM system.tables
WHERE database = 'cascadian_clean'
  AND engine LIKE '%View%'
ORDER BY name;

-- ============================================================================
-- CLEANUP OLD RENAMED TABLES (After Verifying Rollback)
-- ============================================================================
-- Only run after confirming rollback worked correctly

/*
DROP TABLE IF EXISTS default.wallet_positions_api_old;
DROP TABLE IF EXISTS default.wallet_metadata_api_old;
DROP TABLE IF EXISTS default.wallet_api_backfill_log_old;
DROP TABLE IF EXISTS cascadian_clean.wallet_market_returns_old;
DROP TABLE IF EXISTS cascadian_clean.wallet_omega_daily_old;
DROP TABLE IF EXISTS cascadian_clean.leaderboard_whales_old;
DROP TABLE IF EXISTS cascadian_clean.leaderboard_omega_old;
DROP TABLE IF EXISTS cascadian_clean.wallet_coverage_metrics_old;
DROP TABLE IF EXISTS cascadian_clean.market_coverage_metrics_old;
DROP TABLE IF EXISTS cascadian_clean.data_sync_status_old;
*/

-- ============================================================================
-- RESTORE FROM BACKUP (If Available)
-- ============================================================================
-- If you created backups before migration, restore them here

/*
-- Example: Restore from ClickHouse backup
RESTORE TABLE cascadian_clean.vw_resolutions_truth
FROM Disk('backups', 'pre_migration_002.zip');
*/

-- ============================================================================
-- ROLLBACK DECISION TREE
-- ============================================================================

/*
Issue: Leaderboard rankings incorrect
→ Rollback Option 3 (Migration 003)
→ Fix calculation logic
→ Re-run migration 003

Issue: Coverage metrics not calculating correctly
→ Rollback Option 2 (Migration 004)
→ Debug coverage calculation
→ Re-run migration 004

Issue: Views causing query errors
→ Rollback Option 4 (Migration 002)
→ Fix view definitions
→ Re-run migration 002

Issue: API data ingestion failing
→ Rollback Option 1 (All migrations)
→ Redesign schema
→ Re-run all migrations

Issue: Need to preserve data for debugging
→ Use Option 6 (Soft rollback)
→ Debug issues
→ Either restore or proceed with new schema
*/

-- ============================================================================
-- POST-ROLLBACK TASKS
-- ============================================================================

/*
1. Verify dependent queries still work
   - Check existing P&L calculations
   - Verify resolution coverage queries
   - Test wallet analytics endpoints

2. Update application code
   - Remove references to rolled-back tables
   - Revert to previous API endpoints
   - Update frontend queries

3. Notify team
   - Document rollback reason
   - Share findings from debugging
   - Plan corrective migration

4. Plan re-migration
   - Fix identified issues
   - Test on staging environment
   - Schedule production migration
*/

-- ============================================================================
-- EMERGENCY CONTACT
-- ============================================================================
-- If rollback causes critical issues:
--
-- 1. Check system.query_log for failed queries
-- 2. Review DATABASE_ARCHITECTURE_REFERENCE.md for baseline schema
-- 3. Restore from most recent backup if available
-- 4. Contact database architect for assistance
-- ============================================================================
