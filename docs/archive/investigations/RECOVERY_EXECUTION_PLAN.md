# Database Recovery & Enrichment Execution Plan

**Current Status:** 159.6M trade records lost; awaiting recovery action
**Estimated time to completion:** 2-8 hours (depending on recovery method)

---

## PHASE 1: RESTORE DATA (Next 2-4 hours)

### Option A: ClickHouse Cloud Backup Restore (PREFERRED)

**Time: 2-4 hours**

1. **Contact ClickHouse Cloud Support**
   ```
   Submit support ticket:
   - Issue: Cluster data truncated to test rows (64 rows only)
   - Affected: All main data tables (trades_raw, erc1155_transfers, erc20_transfers, etc)
   - Incident timestamp: 2025-11-08 (during ENRICHMENT_SIMPLE_ASYNC.sql execution)
   - Requested action: Restore from backup before 2025-11-08T00:00Z
   - Business impact: 159.6M trade records needed for P&L analysis
   ```

2. **Once support responds:**
   - Confirm backup availability and timestamp
   - Accept proposed restore point
   - Cluster will be restored automatically by support team

3. **Verify restoration:**
   ```bash
   npx tsx check-tables.ts  # Should show 159.6M rows in trades_raw
   ```

### Option B: Re-import from Goldsky (FALLBACK)

**Time: 2-5 hours**

If backups unavailable, re-run the original backfill pipeline:

```bash
# Set worker count (lower = safer)
export BACKFILL_WORKERS=8
export BACKFILL_BATCH_SIZE=1000

# Start backfill
npx tsx scripts/phase2-backfill-production.ts

# Monitor progress in separate terminal
watch -n 30 'npx tsx check-progress.ts'
```

**Note:** Will restore October 2025 data only (missing November transactions)

---

## PHASE 2: VERIFY DATA RESTORED

Once data appears in database:

```bash
npx tsx -e "
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function verify() {
  const result = await clickhouse.query({
    query: \`
      SELECT
        'trades_raw' as table_name,
        COUNT(*) as row_count,
        COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_condition_id,
        ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
      FROM trades_raw
      UNION ALL
      SELECT
        'erc1155_transfers',
        COUNT(*),
        COUNT(CASE WHEN token_id > 0 THEN 1 END),
        ROUND(COUNT(CASE WHEN token_id > 0 THEN 1 END) / COUNT(*) * 100, 2)
      FROM erc1155_transfers
    \`
  })

  const text = await result.text()
  const data = JSON.parse(text)

  console.log('\\n✓ DATA VERIFICATION RESULTS')
  console.log('═'.repeat(60))

  if (data.data && data.data[0]) {
    const trades = data.data[0]
    const transfers = data.data[1]

    console.log(\`trades_raw:              \${parseInt(trades.row_count).toLocaleString()} rows\`)
    console.log(\`  - Existing condition_ids: \${parseInt(trades.with_condition_id).toLocaleString()} (\${trades.coverage_pct}%)\`)
    console.log(\`  - Missing condition_ids:  \${(parseInt(trades.row_count) - parseInt(trades.with_condition_id)).toLocaleString()}\`)
    console.log()
    console.log(\`erc1155_transfers:      \${parseInt(transfers.row_count).toLocaleString()} rows\`)

    if (parseInt(trades.row_count) > 100_000_000) {
      console.log('\\n✓ DATA RESTORED! Ready for enrichment phase.')
      return true
    } else {
      console.log('\\n✗ Data not fully restored yet. Still loading...')
      return false
    }
  }
}

verify()
"
```

**Expected output if successful:**
```
trades_raw:              159,574,259 rows
  - Existing condition_ids: 82,133,045 (51.47%)
  - Missing condition_ids:  77,441,214

erc1155_transfers:       388,234,105 rows
```

---

## PHASE 3: EXECUTE ENRICHMENT (1-2 hours)

Once data is verified as restored:

### Step 1: Pre-enrichment Verification

```bash
npx tsx -e "
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function check() {
  const result = await clickhouse.query({
    query: \`
      SELECT
        (SELECT COUNT(*) FROM trades_raw) as trades_count,
        (SELECT COUNT(*) FROM condition_market_map) as mapping_count,
        (SELECT COUNT(DISTINCT market_id) FROM trades_raw) as unique_markets,
        (SELECT COUNT(DISTINCT market_id) FROM condition_market_map) as mapped_markets
    \`
  })

  const text = await result.text()
  console.log('Pre-enrichment check:')
  console.log(text)
}

check()
"
```

**Expected:** trades_count >> mapping_count (not all trades have mappings, that's OK)

### Step 2: Run Batched Enrichment

```bash
# This uses the safer batching approach created to work around HTTP API limits
npx tsx batch-enrichment.ts
```

**What this does:**
- Splits 159.6M rows into 10M-row batches
- Processes each batch with LEFT JOIN to condition_market_map
- Executes sequentially (safe from concurrency issues)
- Checks progress every 2 batches
- Final verification of 98%+ coverage

**Estimated time:** 60-90 minutes total

**During execution:**
- Terminal will show batch progress
- Each batch takes ~5-10 minutes
- Safe to continue working (doesn't require persistent connection)

### Step 3: Monitor Progress

```bash
# In a separate terminal, monitor row counts every 5 minutes
watch -n 300 'npx tsx -e "
import { config } from '\''dotenv'\''
import { resolve } from '\''path'\''
config({ path: resolve(process.cwd(), '\''.env.local'\'') })
import { clickhouse } from '\''./lib/clickhouse/client'\''

(async () => {
  try {
    const result = await clickhouse.query({
      query: \`SELECT COUNT(*) as cnt FROM trades_raw\`
    })
    const text = await result.text()
    const data = JSON.parse(text)
    const count = parseInt(data.data[0].cnt)
    console.log('Row count: ' + count.toLocaleString())
    console.log('Progress: ' + (count / 159574259 * 100).toFixed(1) + '%')
  } catch(e: any) {
    console.error('Error: ' + e.message)
  }
})()
"'
```

---

## PHASE 4: VERIFY ENRICHMENT RESULTS (15 minutes)

Once enrichment completes:

```bash
npx tsx -e "
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function verify() {
  const result = await clickhouse.query({
    query: \`
      SELECT
        COUNT(*) as total_rows,
        COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
        COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as without_condition_id,
        ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
      FROM trades_raw
    \`
  })

  const text = await result.text()
  const data = JSON.parse(text)
  const row = data.data[0]

  console.log('\\n═══════════════════════════════════════════════════════════')
  console.log('ENRICHMENT VERIFICATION RESULTS')
  console.log('═══════════════════════════════════════════════════════════')
  console.log()
  console.log(\`Total trades:           \${parseInt(row.total_rows).toLocaleString()}\`)
  console.log(\`With condition_id:      \${parseInt(row.with_condition_id).toLocaleString()} (\${row.coverage_pct}%)\`)
  console.log(\`Without condition_id:   \${parseInt(row.without_condition_id).toLocaleString()}\`)
  console.log()
  console.log('IMPROVEMENT:')
  console.log(\`  Before: 51.47% → After: \${row.coverage_pct}%\`)
  console.log()

  if (row.coverage_pct >= 95) {
    console.log('✓ ENRICHMENT SUCCESSFUL! Coverage meets target (95%+)')
    console.log('\\nNext: Build complete P&L calculations with enriched dataset')
  } else {
    console.log('⚠ ENRICHMENT PARTIAL - Coverage below target')
    console.log('Review condition_market_map coverage for any gaps')
  }
}

verify()
"
```

**Expected result:**
```
Total trades:           159,574,259
With condition_id:      156,562,813 (98.11%)
Without condition_id:   3,011,446

IMPROVEMENT:
  Before: 51.47% → After: 98.11%
```

---

## Timeline Summary

| Phase | Action | Duration | Status |
|-------|--------|----------|--------|
| 1A | Contact support & await restore | 2-4 hours | **Waiting for user** |
| 1B | Or: Re-import from Goldsky | 2-5 hours | Fallback option |
| 2 | Verify data restored | 5-10 min | After phase 1 |
| 3 | Execute batch enrichment | 60-90 min | Automated |
| 4 | Final verification | 10-15 min | Automated |
| **Total** | **Complete recovery & enrichment** | **3-6 hours** | **Depends on phase 1** |

---

## Rollback Procedure (If Issues Occur)

If enrichment fails or produces incorrect results:

```bash
# Check backup tables
SELECT COUNT(*) FROM trades_raw_backup_final;

# If backup has correct data:
RENAME TABLE trades_raw TO trades_raw_enrichment_failed;
RENAME TABLE trades_raw_backup_final TO trades_raw;

# Then re-run enrichment from PHASE 3 STEP 2
```

---

## Success Criteria

- ✓ 159.6M+ rows in trades_raw
- ✓ 98%+ condition_id coverage (was 51.47%)
- ✓ No data integrity issues
- ✓ Ready for P&L calculations
- ✓ wallet_metrics and dashboard can be rebuilt

---

## Questions?

- **Data restore unclear?** → See DATABASE_INCIDENT_REPORT.md for full context
- **Batch enrichment issues?** → Check batch-enrichment.ts comments
- **Coverage not improving?** → Verify condition_market_map has complete mappings
