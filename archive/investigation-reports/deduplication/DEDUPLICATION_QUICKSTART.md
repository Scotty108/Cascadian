# Deduplication Quick Start Guide

**⏱️ Total Time:** 2-4 hours
**🎯 Goal:** Remove 12,761x duplication from pm_trades_raw
**📊 Impact:** 16.5M rows → 1.3M rows (91% reduction)

---

## TL;DR - Copy/Paste Commands

### Phase 1: XCN Wallet Hotfix (30 minutes)

```bash
# Run Phase 1 SQL (creates clean XCN wallet table)
# Copy contents of dedup-phase1-xcn-hotfix.sql into ClickHouse client

# Or via command line (if you have clickhouse-client installed):
clickhouse-client \
  --host=igm38nvzub.us-central1.gcp.clickhouse.cloud \
  --port=9440 \
  --secure \
  --user=default \
  --password='8miOkWI~OhsDb' \
  --database=polymarket_canonical \
  < dedup-phase1-xcn-hotfix.sql
```

**Expected Output:**
```
Total Rows: ~1,299
Duplicate Check: 0
Duplication Factor: 1.0 (down from 12,761)
```

### Phase 2: Global Deduplication (1-2 hours)

```bash
# Run Phase 2 SQL (creates global clean table)
clickhouse-client \
  --host=igm38nvzub.us-central1.gcp.clickhouse.cloud \
  --port=9440 \
  --secure \
  --user=default \
  --password='8miOkWI~OhsDb' \
  --database=polymarket_canonical \
  < dedup-phase2-global-fix.sql

# IMPORTANT: Review ALL validation queries before running the RENAME TABLE command!
```

**Expected Timeline:**
- Create clean table: 60-90 minutes
- Validation queries: 5-10 minutes
- Atomic swap: <1 second
- Update views: 5-10 minutes

### Phase 3: Prevention (30 minutes)

```bash
# Update ingestion scripts
# 1. Add deduplication helper to existing scripts
# 2. Run data quality monitor
npx tsx scripts/monitor-data-quality.ts

# 3. Set up hourly cron job
echo "0 * * * * cd /path/to/Cascadian-app && npx tsx scripts/monitor-data-quality.ts >> /var/log/data-quality.log 2>&1" | crontab -
```

### Phase 4: Validation (30 minutes)

```bash
# Run test suite
npm test deduplication-validation

# Expected: All tests pass ✅
```

---

## Decision Tree

```
START
  ↓
Do you need immediate fix for one wallet?
  YES → Run Phase 1 only (30 min)
  NO → Skip to Phase 2
  ↓
Run Phase 2 (global dedup)
  ↓
Did all validation queries pass?
  YES → Run RENAME TABLE (atomic swap)
  NO → Investigate discrepancies, DO NOT SWAP
  ↓
Run Phase 3 (prevention)
  ↓
Run Phase 4 (validation tests)
  ↓
Monitor for 24 hours
  ↓
All good? → Drop backup tables after 7 days
Problems? → Rollback instantly with RENAME TABLE
```

---

## Pre-Flight Checklist

Before running ANY commands:

- [ ] **Disk space:** Verify you have 2x current table size free
  ```sql
  SELECT
    table,
    formatReadableSize(sum(bytes)) AS size
  FROM system.parts
  WHERE database = 'polymarket_canonical' AND table = 'pm_trades_raw'
  GROUP BY table;
  ```
  - Current size: ~XXX GB
  - Required free space: ~XXX GB

- [ ] **Backup exists:** Confirm you can rollback
  ```sql
  -- After Phase 2 swap, this should work:
  SELECT count(*) FROM pm_trades_raw_backup;
  ```

- [ ] **Read documentation:**
  - [ ] Read DEDUPLICATION_SOLUTION.md (full plan)
  - [ ] Read dedup-phase1-xcn-hotfix.sql (Phase 1 SQL)
  - [ ] Read dedup-phase2-global-fix.sql (Phase 2 SQL)

- [ ] **Communication:**
  - [ ] Notify team of maintenance window (2-4 hours)
  - [ ] Set up monitoring alerts
  - [ ] Have rollback plan ready

---

## File Reference

| File | Purpose | Size |
|------|---------|------|
| **DEDUPLICATION_SOLUTION.md** | Complete solution design | Reference |
| **DEDUPLICATION_QUICKSTART.md** | This file (quick commands) | Quick |
| **dedup-phase1-xcn-hotfix.sql** | Phase 1 SQL (XCN wallet) | Copy/paste |
| **dedup-phase2-global-fix.sql** | Phase 2 SQL (all wallets) | Copy/paste |
| **scripts/monitor-data-quality.ts** | Hourly monitoring script | Run via cron |
| **scripts/dedup-ingestion-helper.ts** | Prevent future duplicates | Import in scripts |
| **__tests__/deduplication-validation.test.ts** | Validation test suite | Run after dedup |

---

## Phase-by-Phase Breakdown

### Phase 1: XCN Wallet Hotfix (30 min)

**Input:**
- Table: `pm_trades_raw`
- Wallet: `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e`
- Current rows: 16,572,639 (12,761x duplication)

**Process:**
1. Create `pm_trades_xcn_clean` table
2. Deduplicate using (transaction_hash, log_index)
3. Keep most recent timestamp

**Output:**
- Table: `pm_trades_xcn_clean`
- Expected rows: ~1,299
- Duplication factor: 1.0

**Validation:**
```sql
SELECT count(*) FROM pm_trades_xcn_clean;
-- Expected: ~1,299

SELECT count() / count(DISTINCT (transaction_hash, log_index))
FROM pm_trades_xcn_clean;
-- Expected: 1.0
```

**Decision Point:**
- ✅ Validation passes → Proceed to Phase 2
- ❌ Validation fails → Investigate before Phase 2

---

### Phase 2: Global Deduplication (1-2 hours)

**Input:**
- Table: `pm_trades_raw` (16.5M rows)
- Duplication factor: 12,761x

**Process:**
1. Create `pm_trades_raw_v2` (clean table) - **60-90 minutes**
2. Run 8 validation queries - **5-10 minutes**
3. Atomic swap (RENAME TABLE) - **<1 second**
4. Update dependent views - **5-10 minutes**

**Output:**
- Table: `pm_trades_raw` (new, clean)
- Backup: `pm_trades_raw_backup` (old, with dups)
- Expected rows: ~1.3M
- Duplication factor: 1.0

**Critical Validations:**
```sql
-- Must ALL pass before swapping!

-- 1. Zero duplicates
SELECT count(*) FROM (
  SELECT transaction_hash, log_index, count(*) AS c
  FROM pm_trades_raw_v2
  GROUP BY transaction_hash, log_index
  HAVING c > 1
);
-- Expected: 0

-- 2. Duplication factor = 1.0
SELECT count() / count(DISTINCT (transaction_hash, log_index))
FROM pm_trades_raw_v2;
-- Expected: 1.0

-- 3. Same unique keys as old table
SELECT count(DISTINCT (transaction_hash, log_index))
FROM pm_trades_raw;  -- Old

SELECT count(DISTINCT (transaction_hash, log_index))
FROM pm_trades_raw_v2;  -- New
-- Expected: Same value

-- 4. Same wallet count
SELECT count(DISTINCT wallet) FROM pm_trades_raw;
SELECT count(DISTINCT wallet) FROM pm_trades_raw_v2;
-- Expected: Same value
```

**Only if ALL validations pass:**
```sql
RENAME TABLE
  polymarket_canonical.pm_trades_raw TO polymarket_canonical.pm_trades_raw_backup,
  polymarket_canonical.pm_trades_raw_v2 TO polymarket_canonical.pm_trades_raw;
```

---

### Phase 3: Prevention (30 min)

**Goal:** Prevent future duplicates

**Tasks:**

1. **Update ingestion scripts:**
   ```typescript
   import { deduplicateTrades } from './scripts/dedup-ingestion-helper';

   // In your ingestion function:
   const rawTrades = await fetchFromAPI();
   const uniqueTrades = deduplicateTrades(rawTrades);  // ← Add this
   await insertToClickHouse(uniqueTrades);
   ```

2. **Set up monitoring:**
   ```bash
   # Run hourly
   npx tsx scripts/monitor-data-quality.ts
   ```

3. **Configure alerts:**
   - Edit `scripts/monitor-data-quality.ts`
   - Add Slack webhook URL
   - Add PagerDuty integration

4. **Document table design rules:**
   - Always use `ORDER BY (wallet, transaction_hash, log_index)`
   - Never rely on ReplacingMergeTree alone
   - Always deduplicate at application layer

---

### Phase 4: Validation (30 min)

**Goal:** Verify deduplication succeeded

**Run test suite:**
```bash
npm test deduplication-validation
```

**Expected results:**
```
✓ should have baseline metrics captured
✓ should have zero duplicates
✓ should have duplication factor of 1.0
✓ should preserve all unique transactions
✓ should preserve all wallets
✓ should preserve date range
✓ should have ~1,299 trades for XCN wallet
✓ should have zero duplicates for XCN wallet
✓ should have consistent P&L calculations
✓ should have reasonable row count reduction

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

**Manual checks:**
1. API endpoints still work
2. P&L calculations match
3. Top wallets have expected row counts
4. No errors in logs

---

## Rollback Procedure

If ANYTHING goes wrong after the swap:

```sql
-- Instant rollback (<1 second)
RENAME TABLE
  polymarket_canonical.pm_trades_raw TO polymarket_canonical.pm_trades_raw_failed,
  polymarket_canonical.pm_trades_raw_backup TO polymarket_canonical.pm_trades_raw;
```

**Then investigate what went wrong.**

---

## Monitoring After Deployment

**First 24 hours:**
- [ ] Run `scripts/monitor-data-quality.ts` every hour
- [ ] Check duplication factor stays at 1.0
- [ ] Verify no new duplicates in last 24h
- [ ] Monitor P&L calculations
- [ ] Check API response times

**After 7 days of stable operation:**
```sql
-- Free up disk space
DROP TABLE polymarket_canonical.pm_trades_raw_backup;
DROP TABLE polymarket_canonical.pm_trades_xcn_clean;
```

---

## Troubleshooting

### Problem: Validation queries fail

**Solution:**
- DO NOT run the RENAME TABLE command
- Investigate discrepancies
- Fix issues in `pm_trades_raw_v2`
- Re-run validations
- Only swap when ALL validations pass

### Problem: Swap completed but API broken

**Solution:**
- Immediate rollback (see Rollback Procedure above)
- Investigate what broke
- Fix dependent views/queries
- Re-attempt swap

### Problem: Duplication factor not 1.0 after swap

**Solution:**
- Check if ingestion scripts are still running
- Pause ingestion during dedup
- Rollback and retry
- Add deduplication to ingestion scripts first

### Problem: P&L calculations don't match

**Solution:**
- Compare specific wallets between old/new tables
- Check if you're keeping the correct version (most recent timestamp)
- Verify (transaction_hash, log_index) is truly unique
- May need to add additional tiebreaker in ROW_NUMBER() ORDER BY

---

## Success Metrics

After completion, you should see:

- ✅ Duplication factor: 1.0 (down from 12,761)
- ✅ Row count: ~1.3M (down from 16.5M)
- ✅ Reduction: ~91%
- ✅ All unique transactions preserved
- ✅ All wallets preserved
- ✅ P&L calculations match
- ✅ API endpoints working
- ✅ Tests passing
- ✅ Monitoring configured

---

## Next Steps After Success

1. **Document lessons learned**
2. **Update runbooks with new procedures**
3. **Train team on prevention techniques**
4. **Set up automated monitoring**
5. **Schedule quarterly data quality audits**
6. **Consider adding similar dedup for other tables**

---

## Questions?

- **Full details:** See DEDUPLICATION_SOLUTION.md
- **SQL commands:** See dedup-phase1-xcn-hotfix.sql and dedup-phase2-global-fix.sql
- **Code examples:** See scripts/dedup-ingestion-helper.ts
- **Tests:** See __tests__/deduplication-validation.test.ts

---

**Created:** 2025-11-17 (PST)
**Owner:** Claude 1 (Main Agent)
**Status:** Ready for Execution
**Approval Required:** Yes (Scotty)
