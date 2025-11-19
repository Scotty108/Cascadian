# API Schema Deployment Checklist

**Date:** 2025-11-09
**Status:** Ready for Production Deployment

---

## Pre-Deployment

### 1. Review Documentation
- [ ] Read `API_SCHEMA_DESIGN.md` (comprehensive overview)
- [ ] Review `API_SCHEMA_QUICK_REFERENCE.md` (quick lookup)
- [ ] Check `API_SCHEMA_ARCHITECTURE.txt` (visual diagram)
- [ ] Understand `API_SCHEMA_IMPLEMENTATION_SUMMARY.md` (deployment guide)

### 2. Verify Prerequisites
- [ ] ClickHouse cluster accessible
- [ ] Databases exist: `default`, `cascadian_clean`
- [ ] Disk space available: ~100GB free
- [ ] Backup of existing tables created
- [ ] API keys/endpoints verified:
  - [ ] Polymarket Data API: https://data-api.polymarket.com
  - [ ] Goldsky Subgraph: https://api.goldsky.com/...

### 3. Test Environment Setup
- [ ] Test migrations on staging environment first
- [ ] Run verification queries
- [ ] Test rollback procedures
- [ ] Verify query performance

---

## Deployment (Production)

### Step 1: Backup Existing Data
```bash
# Backup critical tables
clickhouse-client --query "CREATE TABLE default.market_resolutions_final_backup AS default.market_resolutions_final"
clickhouse-client --query "CREATE VIEW cascadian_clean.vw_resolutions_truth_backup AS SELECT * FROM cascadian_clean.vw_resolutions_truth"
```
- [ ] Backups created
- [ ] Verify backup row counts match source

### Step 2: Apply Migrations
```bash
cd /Users/scotty/Projects/Cascadian-app

# Migration 001: Staging tables
clickhouse-client --multiquery < migrations/001-create-api-staging-tables.sql
```
- [ ] Migration 001 completed
- [ ] No errors in output
- [ ] Tables created: `wallet_positions_api`, `wallet_metadata_api`, `wallet_api_backfill_log`

```bash
# Migration 002: Resolution views
clickhouse-client --multiquery < migrations/002-update-resolution-views.sql
```
- [ ] Migration 002 completed
- [ ] Views created: `vw_resolutions_truth`, `vw_pnl_reconciliation`, `vw_wallet_positions_api_format`

```bash
# Migration 003: Leaderboard tables
clickhouse-client --multiquery < migrations/003-create-leaderboard-tables.sql
```
- [ ] Migration 003 completed
- [ ] Tables created: `wallet_market_returns`, `wallet_omega_daily`, `leaderboard_whales`, `leaderboard_omega`

```bash
# Migration 004: Coverage metrics
clickhouse-client --multiquery < migrations/004-create-coverage-metrics.sql
```
- [ ] Migration 004 completed
- [ ] Tables created: `wallet_coverage_metrics`, `market_coverage_metrics`, `data_sync_status`
- [ ] Materialized view created: `mv_data_quality_summary`

### Step 3: Verify Schema
```bash
clickhouse-client --multiquery < API_SCHEMA_VERIFICATION.sql > verification_results.txt
```
- [ ] All tables exist (11 total)
- [ ] All views exist (4 total)
- [ ] No data type errors
- [ ] No duplicate keys (run OPTIMIZE if needed)

### Step 4: Initial Data Load

#### Test Wallet First
```bash
npx tsx test-data-api-integration.ts
```
- [ ] API test successful
- [ ] Position data retrieved
- [ ] Payout vectors retrieved

```bash
npx tsx backfill-wallet-pnl-from-api.ts 0x4ce73141dbfce41e65db3723e31059a730f0abad
```
- [ ] Test wallet backfilled
- [ ] Data inserted into `wallet_positions_api`
- [ ] Row count > 0

#### Top Wallets Backfill
```bash
# Start with small batch
npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 10

# Then scale up
npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 100
npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 1000
```
- [ ] Top 10 wallets backfilled
- [ ] Top 100 wallets backfilled
- [ ] Top 1000 wallets backfilled
- [ ] No API errors
- [ ] Check `wallet_api_backfill_log` for status

#### Payout Vectors Backfill
```bash
npx tsx backfill-payout-vectors.ts
```
- [ ] Payout vectors fetched from Goldsky
- [ ] Data inserted into `resolutions_external_ingest`
- [ ] Check row count

### Step 5: Build Analytics Tables

#### Populate wallet_market_returns
```sql
-- Run population query from migration 003
INSERT INTO cascadian_clean.wallet_market_returns
SELECT ... (see migration file);
```
- [ ] Query completed successfully
- [ ] Row count: 50K-200K expected
- [ ] Spot check: Sample wallet has correct trades

#### Populate wallet_coverage_metrics
```sql
-- Run population query from migration 004
INSERT INTO cascadian_clean.wallet_coverage_metrics
SELECT ... (see migration file);
```
- [ ] Query completed successfully
- [ ] Row count: 10K-50K expected
- [ ] Coverage gates calculated

#### Populate leaderboards
```sql
-- Run population queries from migration 003
INSERT INTO cascadian_clean.leaderboard_whales SELECT ...;
INSERT INTO cascadian_clean.leaderboard_omega SELECT ...;
```
- [ ] Leaderboard whales populated
- [ ] Leaderboard omega populated
- [ ] Row count: 1K-5K expected (after filtering)
- [ ] Ranks assigned correctly

### Step 6: Optimize Tables
```bash
clickhouse-client --query "OPTIMIZE TABLE default.wallet_positions_api FINAL"
clickhouse-client --query "OPTIMIZE TABLE cascadian_clean.wallet_market_returns FINAL"
clickhouse-client --query "OPTIMIZE TABLE cascadian_clean.wallet_coverage_metrics FINAL"
clickhouse-client --query "OPTIMIZE TABLE cascadian_clean.leaderboard_whales FINAL"
clickhouse-client --query "OPTIMIZE TABLE cascadian_clean.leaderboard_omega FINAL"
```
- [ ] All tables optimized
- [ ] No duplicate keys remain

---

## Post-Deployment

### Step 7: Validate Data Quality
```sql
-- Check system health
SELECT * FROM cascadian_clean.mv_data_quality_summary
ORDER BY calculation_date DESC LIMIT 1;
```
- [ ] total_wallets > 0
- [ ] wallets_leaderboard_eligible > 0
- [ ] avg_price_coverage >= 90%
- [ ] avg_payout_coverage >= 90%

```sql
-- Verify leaderboard rankings
SELECT rank, wallet_address, total_settled_pnl_usd
FROM cascadian_clean.leaderboard_whales
ORDER BY rank LIMIT 10;
```
- [ ] Leaderboard populated
- [ ] Rankings in descending order
- [ ] P&L values look reasonable

```sql
-- Check P&L reconciliation
SELECT
    quality_category,
    count() as count
FROM cascadian_clean.vw_pnl_reconciliation
WHERE has_both = true
GROUP BY quality_category;
```
- [ ] Majority in MATCH or MINOR_DIFF
- [ ] Few MAJOR_DIFF cases
- [ ] Investigate large discrepancies

### Step 8: Test Example Queries
```sql
-- Get wallet P&L
SELECT * FROM cascadian_clean.wallet_coverage_metrics
WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
```
- [ ] Query returns data (<100ms)
- [ ] Coverage metrics populated

```sql
-- Get wallet positions
SELECT * FROM cascadian_clean.vw_wallet_positions_api_format
WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
ORDER BY abs(cashPnl) DESC LIMIT 20;
```
- [ ] Query returns positions (<150ms)
- [ ] Data matches Polymarket UI

### Step 9: Performance Testing
```bash
# Run performance benchmarks
time clickhouse-client --query "SELECT * FROM cascadian_clean.leaderboard_whales ORDER BY rank LIMIT 100"
time clickhouse-client --query "SELECT * FROM cascadian_clean.wallet_coverage_metrics WHERE wallet_address = '0x...'"
```
- [ ] Leaderboard query < 200ms
- [ ] Wallet lookup < 100ms
- [ ] No slow queries in system.query_log

### Step 10: Schedule Automated Jobs

#### Daily Jobs (crontab or systemd timer)
```bash
# Add to crontab
0 2 * * * npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 1000
0 3 * * * clickhouse-client --query "TRUNCATE TABLE cascadian_clean.leaderboard_whales; INSERT INTO cascadian_clean.leaderboard_whales SELECT ..."
0 4 * * * clickhouse-client --query "OPTIMIZE TABLE default.wallet_positions_api FINAL"
```
- [ ] Daily API backfill scheduled
- [ ] Daily leaderboard rebuild scheduled
- [ ] Daily OPTIMIZE scheduled

#### Weekly Jobs
```bash
# Add to crontab
0 1 * * 0 cd /Users/scotty/Projects/Cascadian-app && npx tsx backfill-payout-vectors.ts
```
- [ ] Weekly payout backfill scheduled

#### Monitoring Jobs
- [ ] Set up alerts for data freshness (>48 hours)
- [ ] Set up alerts for low coverage (<90%)
- [ ] Set up alerts for API errors
- [ ] Set up dashboard for system health

---

## Rollback (If Needed)

### If deployment fails at any step:

1. **Stop immediately** - Don't proceed with next steps
2. **Document the error** - Copy error messages
3. **Run rollback script**:
```bash
clickhouse-client --multiquery < migrations/ROLLBACK.sql
```
4. **Verify rollback**:
```bash
clickhouse-client --query "SHOW TABLES FROM default LIKE '%api%'"
clickhouse-client --query "SHOW TABLES FROM cascadian_clean LIKE '%leaderboard%'"
```
5. **Restore from backup** (if needed):
```bash
clickhouse-client --query "RENAME TABLE default.market_resolutions_final_backup TO default.market_resolutions_final"
```
6. **Debug the issue** - Review error logs
7. **Fix and retry** - Apply corrected migration

---

## Success Criteria

### Minimum Viable Deployment
- [x] All migration files created
- [ ] Schema deployed to production
- [ ] Test wallet data loaded
- [ ] Top 100 wallets backfilled
- [ ] Leaderboards populated
- [ ] Query performance acceptable

### Full Production Deployment
- [ ] All minimum criteria met
- [ ] Top 1000 wallets backfilled
- [ ] Coverage metrics > 90%
- [ ] P&L reconciliation < 10% discrepancy
- [ ] Automated jobs scheduled
- [ ] Monitoring dashboards operational
- [ ] Team trained on new schema

---

## Troubleshooting

### Issue: Tables not created
**Solution:** Check ClickHouse permissions, verify database exists

### Issue: API backfill failing
**Solution:** Verify API endpoint, check rate limits, review error logs

### Issue: Leaderboard empty
**Solution:** Check coverage gates (all_gates_pass), verify data population

### Issue: P&L mismatch
**Solution:** Query vw_pnl_reconciliation, check for missing condition_ids

### Issue: Slow queries
**Solution:** Verify ORDER BY usage, run OPTIMIZE TABLE FINAL

---

## Support

### Documentation
- Full docs: `API_SCHEMA_DESIGN.md`
- Quick reference: `API_SCHEMA_QUICK_REFERENCE.md`
- Architecture: `API_SCHEMA_ARCHITECTURE.txt`
- Verification: `API_SCHEMA_VERIFICATION.sql`

### Contact
- Database Architect: [Your contact info]
- Team Lead: [Team lead contact]
- Emergency: [On-call engineer]

---

**Deployment Status:** ⏳ Pending
**Last Updated:** 2025-11-09
**Next Review:** After production deployment
