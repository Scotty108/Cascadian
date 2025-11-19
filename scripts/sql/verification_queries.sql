-- THIRD-PARTY VERIFICATION AUDIT - SQL QUERIES
-- Execute these directly against ClickHouse to validate 8 claims
-- Date: 2025-11-07

-- ============================================================================
-- CLAIM #1: trades_raw is complete with 159.6M rows
-- ============================================================================
-- Expected: ~159.6M rows
-- Check: Row count, date range, wallet diversity, condition coverage
SELECT
  'CLAIM #1: trades_raw row count' as claim,
  COUNT(*) as row_count,
  ROUND(COUNT() / 1000000.0, 1) as millions,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  COUNT(DISTINCT condition_id) as unique_conditions,
  MIN(block_timestamp) as earliest_date,
  MAX(block_timestamp) as latest_date,
  ROUND((MAX(block_timestamp) - MIN(block_timestamp)) / 86400) as day_count
FROM trades_raw;

-- ============================================================================
-- CLAIM #2: P&L formula validated at 2.05% accuracy (Wallet 1 = HolyMoses7)
-- ============================================================================
-- Expected: $1,907,531.19 realized P&L
-- Check: Does the formula produce this value?
SELECT
  'CLAIM #2: HolyMoses7 P&L' as claim,
  wallet_address,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd,
  COUNT(*) as transaction_count
FROM wallet_pnl_summary_v2
WHERE lower(wallet_address) = 'holymoses7'
LIMIT 10;

-- Also check if this wallet exists in other forms
SELECT
  'HolyMoses7 existence check' as note,
  DISTINCT wallet_address
FROM trades_raw
WHERE lower(wallet_address) LIKE '%holymoses%'
LIMIT 10;

-- ============================================================================
-- CLAIM #3: Wallets 2-4 have zero resolved conditions
-- ============================================================================
-- Expected: Zero resolved conditions for test wallets
-- Check: Are the top 4 wallets by PnL actually resolved?
SELECT
  'CLAIM #3: Top 4 wallets - resolved conditions' as claim,
  wallet_address,
  COUNT(DISTINCT condition_id) as resolved_conditions,
  SUM(realized_pnl_usd) as total_pnl,
  COUNT(*) as rows_count
FROM wallet_pnl_summary_v2
GROUP BY wallet_address
ORDER BY SUM(realized_pnl_usd) DESC
LIMIT 4;

-- ============================================================================
-- CLAIM #4: Only 133 conditions out of 166,773 have trades_raw coverage
-- ============================================================================
-- Expected: 133 overlapping conditions between trades_raw and market_resolutions_final
-- Check: Coverage percentage, is 0.08% really correct?
SELECT
  'CLAIM #4: Condition coverage' as claim,
  (SELECT COUNT(DISTINCT condition_id) FROM trades_raw) as conditions_in_trades,
  (SELECT COUNT(DISTINCT condition_id) FROM market_resolutions_final) as total_markets,
  (SELECT COUNT(DISTINCT t.condition_id)
   FROM trades_raw t
   INNER JOIN market_resolutions_final m ON t.condition_id = m.condition_id) as overlap_count,
  ROUND(
    ((SELECT COUNT(DISTINCT t.condition_id)
      FROM trades_raw t
      INNER JOIN market_resolutions_final m ON t.condition_id = m.condition_id)
     /
     (SELECT COUNT(DISTINCT condition_id) FROM market_resolutions_final)::Float64) * 100,
    2
  ) as coverage_percent;

-- ============================================================================
-- CLAIM #5: Schema consolidation (87→18 tables) is straightforward
-- ============================================================================
-- Expected: 87 total tables (or close to it)
-- Check: How many tables, how much bloat, which ones are empty?
SELECT
  'CLAIM #5: Schema table count' as claim,
  COUNT(*) as total_tables,
  SUM(CASE WHEN total_rows = 0 THEN 1 ELSE 0 END) as empty_tables,
  SUM(CASE WHEN total_rows > 0 AND total_rows < 1000 THEN 1 ELSE 0 END) as tiny_tables,
  SUM(total_rows) as total_rows_all,
  formatReadableSize(SUM(total_bytes)) as total_size_all
FROM system.tables
WHERE database = currentDatabase();

-- Detailed table breakdown for consolidation planning
SELECT
  name,
  total_rows,
  formatReadableSize(total_bytes) as size,
  engine
FROM system.tables
WHERE database = currentDatabase()
  AND total_rows = 0
ORDER BY name;

-- ============================================================================
-- CLAIM #6: Omega ratio definition is pending user input
-- ============================================================================
-- Expected: No tables with "omega" in name (if pending)
-- Check: Does any omega/ratio/sharpe metric exist?
SELECT
  'CLAIM #6: Omega metric existence' as claim,
  COUNT(*) as tables_with_omega_in_name
FROM system.tables
WHERE database = currentDatabase()
  AND (lower(name) LIKE '%omega%' OR lower(name) LIKE '%sharpe%' OR lower(name) LIKE '%ratio%');

-- Check if wallet_metrics_complete has omega or ratio columns
SELECT
  'wallet_metrics_complete columns' as table_name,
  name as column_name
FROM system.columns
WHERE database = currentDatabase()
  AND table = 'wallet_metrics_complete'
  AND (lower(name) LIKE '%omega%' OR lower(name) LIKE '%ratio%' OR lower(name) LIKE '%sharpe%')
LIMIT 10;

-- ============================================================================
-- CLAIM #7: Backfill all 996K wallets in 2-4 hours with 8 workers
-- ============================================================================
-- Expected: 996K unique wallets
-- Check: Processing time estimate based on actual data volume
SELECT
  'CLAIM #7: Backfill timing estimate' as claim,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  COUNT(*) as total_trades,
  COUNT(DISTINCT condition_id) as unique_conditions,
  ROUND(COUNT() / 8.0) as rows_per_worker,
  'Est. 2-4hrs assumes 2M-10M rows/sec per worker' as assumption,
  MIN(block_timestamp) as backfill_start,
  MAX(block_timestamp) as backfill_end
FROM trades_raw;

-- ============================================================================
-- CLAIM #8: Main Claude found breakthrough: P&L formula is 2.05% accurate
-- ============================================================================
-- Expected: P&L calculations exist and are consistent
-- Check: Can we find the "2.05%" accuracy metric? Data consistency?
SELECT
  'CLAIM #8: P&L formula validation' as claim,
  COUNT(*) as rows_with_pnl,
  COUNT(DISTINCT wallet_address) as wallets_calculated,
  ROUND(AVG(ABS(realized_pnl_usd)), 2) as avg_absolute_pnl,
  formatReadableSize(8) as note
FROM wallet_pnl_summary_v2
WHERE realized_pnl_usd != 0;

-- Triple validation: Compare three P&L tables
SELECT
  'Consistency check: 3 P&L tables' as validation_type,
  (SELECT SUM(pnl_usd) FROM trade_cashflows_v3) as trade_cashflows_total,
  (SELECT SUM(realized_pnl_usd) FROM wallet_pnl_summary_v2) as wallet_pnl_total,
  (SELECT SUM(realized_pnl_usd) FROM realized_pnl_by_market_final) as realized_pnl_market_total;

-- ============================================================================
-- DATA QUALITY CHECKS
-- ============================================================================
-- Overall data integrity validation
SELECT
  'Data quality metrics' as check_type,
  (SELECT COUNT(*) FROM trades_raw) as trades_raw_count,
  (SELECT COUNT(*) FROM market_resolutions_final) as markets_resolved,
  (SELECT COUNT(*) FROM wallet_pnl_summary_v2) as wallet_pnl_rows,
  (SELECT COUNT(DISTINCT wallet_address) FROM wallet_pnl_summary_v2) as wallets_with_pnl,
  (SELECT COUNT(DISTINCT wallet_address) FROM trades_raw) as wallets_in_trades;

-- Check for potential data gaps or anomalies
SELECT
  'Anomalies' as check,
  COUNT(*) as empty_wallet_pnl_rows
FROM wallet_pnl_summary_v2
WHERE realized_pnl_usd = 0 AND unrealized_pnl_usd = 0;
