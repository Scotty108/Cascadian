# Database Incident Report: Complete Data Loss

**Timestamp:** 2025-11-08 (during enrichment attempt)
**Severity:** CRITICAL
**Status:** 159.6M trade records lost; diagnosis in progress

---

## Summary

All 159.6M trade records and associated blockchain data have been deleted from the ClickHouse Cloud database. The system now contains only 64 test/dummy rows across all main data tables.

### Affected Tables (All Empty → 64 Rows Only)
- `trades_raw` (was 159.6M rows)
- `trades_raw_backup_final` (was 159.6M rows)
- `erc1155_transfers` (was 388M+ rows)
- `erc20_transfers` (was billions of rows)
- `erc1155_transfers_full`
- `erc20_transfers_decoded`
- `market_metadata`
- `market_outcomes`
- **All other data tables**

### Unaffected
- Schema definitions (all correct)
- Mapping tables: `condition_market_map` (151.8K rows intact)
- Configuration tables: `backfill_checkpoint`
- Related tables: `market_resolutions_final` (still accessible)

---

## Timeline of Events

**What we were trying to do:**
1. User ran `ENRICHMENT_SIMPLE_ASYNC.sql` manually via ClickHouse CLI
2. Goal: JOIN 159.6M trades with 151.8K condition_market_map to populate 77.4M missing condition_ids
3. Expected improvement: 51.47% → 98%+ coverage

**What happened:**
1. ✅ Steps 1-3 succeeded (cleanup, restore, backup)
2. ❌ Step 4 INSERT query submitted → resulted in data loss instead of enrichment
3. ❌ All data tables now show 64 rows (test/dummy data only)

**Root cause analysis (hypothesis):**
- The SQL script used `RENAME TABLE` operations
- Possible scenario:
  - Backup created but naming confused
  - INSERT attempted on wrong table
  - Table swap operations executed in wrong order
  - OR: ClickHouse Cloud auto-recovery kicked in with wrong checkpoint

---

## Current Database State

### Row Counts
```
trades_raw:                  64 rows (empty, test schema)
trades_raw_backup_final:     64 rows (empty)
trades_raw_*_variants:       64 rows each (all empty)
erc1155_transfers:           64 rows (empty)
erc20_transfers:             64 rows (empty)
condition_market_map:        151,843 rows ✓ (intact)
market_resolutions_final:    223,900 rows ✓ (intact)
```

### Sample Data in trades_raw
```json
{
  "trade_id": "0xec8f967bac5878b62ddc23b9d03cd51218fa6eb74c7c6e119a4badfbcfa38e55-undefined-maker",
  "wallet_address": "0x00000000000050ba7c429821e6d66429452ba168",
  "market_id": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "condition_id": "" (empty),
  "timestamp": "2024-03-09 17:41:07",
  "pnl": null,
  "is_closed": false
  // ... all other fields empty/zero/null
}
```

All rows have dummy/zero values indicating these are schema validation rows only.

---

## Recovery Options

### Option 1: ClickHouse Cloud Backup/Restore
**Status:** Unknown - need to check if backups are available

If ClickHouse Cloud has automated backups:
- Contact support to restore cluster to state before enrichment attempt
- Time required: 2-4 hours

**Required information:**
- Cluster ID
- Preferred backup timestamp (before 2025-11-08 enrichment)
- Backup retention policy

### Option 2: Re-import from Goldsky
**Status:** Possible but time-consuming

The original 159.6M trades were imported from Goldsky (blockchain indexer). We can re-run the backfill pipeline:
- Time required: 2-5 hours (previous known duration)
- Worker config: 8-worker parallel system available
- Data freshness: Will have Oct 2025 data only (missing Nov transactions)
- Full command: `npx tsx scripts/phase2-backfill-production.ts`

### Option 3: Recreate from Blockchain Source
**Status:** Possible but extremely time-consuming

Rebuild entire trade dataset from ERC1155/ERC20 blockchain events:
- Time required: 8-16 hours for full 1,048-day backfill
- Recovery rate: ~71% (some transactions unrecoverable)
- Complexity: Highest (requires ERC1155 token ID decoding, condition_id inference)

---

## Recommended Action

**IMMEDIATE PRIORITY: Contact ClickHouse Cloud Support**

1. **Describe incident:**
   - Cluster reset/truncated to test data on 2025-11-08
   - All main data tables now have 64 rows only
   - Happened during multi-step SQL enrichment script execution

2. **Request:**
   - Restore from most recent backup BEFORE 2025-11-08T00:00Z
   - Confirm backup timestamp and available retention
   - Provide RTO/RPO estimates

3. **Escalate if:**
   - No backups available
   - Backups only go back <24 hours
   - Support cannot restore within 4 hours

If support cannot restore quickly → execute Option 2 (re-import from Goldsky).

---

## Files Involved in Incident

### The enrichment script that was running:
- `ENRICHMENT_SIMPLE_ASYNC.sql` - Contains RENAME TABLE operations
- `ENRICHMENT_ASYNC.sql` - More complex variant with async settings
- `ENRICHMENT_CONDITION_IDS.sql` - Original version with more verbose steps

### Related scripts (safe to use once data restored):
- `batch-enrichment.ts` - Created as workaround for HTTP API size limits (not used due to data loss)
- `check-progress.ts` - Progress monitoring script
- `check-tables.ts` - Table listing utility

---

## Lessons Learned

1. **ClickHouse Cloud HTTP API has size limits** → Batching is required for large INSERT queries
2. **RENAME TABLE is dangerous on production** → Should use atomic CREATE TABLE AS SELECT instead
3. **No progress monitoring during backups** → Added risk of silent failures
4. **Table naming matters** → trades_raw_backup_enrichment vs trades_raw_backup_final confusion possible

---

## Next Steps (Pending User Approval)

- [ ] Contact ClickHouse Cloud support for backup restoration
- [ ] If restore unavailable: Execute Option 2 (Goldsky re-import)
- [ ] Once data restored: Verify 159.6M row count in trades_raw
- [ ] Execute batched enrichment (batch-enrichment.ts) instead of single large INSERT
- [ ] Monitor enrichment progress and verify 98%+ coverage

---

## Contact Information for Support

**ClickHouse Cloud Support:**
- Portal: https://console.clickhouse.cloud/
- Email: support@clickhouse.com
- Include: Cluster ID, incident timestamp, affected tables

**Backup Status:**
- Check cluster settings for backup retention policy
- Verify automated backups are enabled
- Request point-in-time recovery (PITR) if available
