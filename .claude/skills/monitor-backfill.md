# Monitor Backfill Progress

## Skill Description
Universal monitoring for long-running backfill operations. Works with any data pipeline that uses worker-based parallel processing and writes to logs/databases. Provides progress tracking, ETA estimates, and bottleneck identification.

## When to Use
- During any long-running backfill operation (blockchain, API, file processing, etc.)
- When user asks "how's it going?" or "what's the status?"
- To verify backfill completion
- To troubleshoot stuck or slow workers
- To tune worker counts and rate limits

## Generic Usage Pattern

### 1. Identify Log File Location
```bash
# Common patterns:
# - tmp/backfill.log (current convention)
# - logs/*.log
# - stdout/stderr redirects
# - Background process output via BashOutput tool

# Find active log file
ls -lt tmp/*.log | head -5
ls -lt logs/*.log | head -5
```

### 2. Check Worker Progress
```bash
# Pattern: Look for worker status lines
tail -n 50 <LOG_FILE> | grep -i "worker"

# Common indicators to look for:
# - "Worker N: XX% complete"
# - "Worker N: Block/Page/Record XXXXX"
# - Progress percentages
# - Row/item counts processed

# Example for our ERC-1155 backfill:
tail -n 30 tmp/backfill.log | grep Worker
```

### 3. Get Database/Output Metrics
```bash
# For database targets (ClickHouse, Postgres, etc.):
# Run verification script or direct query

# Example patterns:
npx tsx scripts/verify-<target>-tables.ts
psql -c "SELECT count(*) FROM staging_table"
clickhouse-client --query "SELECT count() FROM database.table"

# For file-based outputs:
wc -l output/*.csv
du -sh output/
```

### 4. Check for Errors
```bash
# Generic error patterns
grep -i "error\|failed\|exception" <LOG_FILE> | tail -20

# Rate limit specific (HTTP 429, 503)
grep -c "HTTP 503\|HTTP 429\|rate limit" <LOG_FILE>

# Check if retries are succeeding
grep "Attempt [2-9] failed" <LOG_FILE> | wc -l
# Should return 0 for healthy operation

# Fatal errors that stopped execution
grep -i "fatal\|crash\|killed" <LOG_FILE>
```

### 5. Verify Process Still Running
```bash
# Generic process check
ps aux | grep -i "<script_name>" | grep -v grep

# Check CPU/memory usage
ps aux | grep -i "<script_name>" | grep -v grep | awk '{print $3, $4}'

# For Node.js processes
ps aux | grep node | grep <script_name>
```

## Status Report Template

When reporting progress, adapt to your backfill type and include:

1. **Progress metric** - Total items processed (rows, files, records, blocks, etc.)
2. **Worker status** - Percentage complete for active workers
3. **Bottleneck identification** - Slowest worker(s) holding up completion
4. **ETA calculation** - Time remaining based on slowest worker progress
5. **Error status** - Rate limits, retries, failures
6. **Data quality** - Type-specific metrics (timestamps, checksums, validation errors, etc.)

## Example Output Formats

### For Database Backfills (ClickHouse, Postgres, etc.)
```
## Backfill Progress: XX.XM rows

**Current Stats:**
- **XX,XXX,XXX rows** in <database>.<table>
- **Range:** <start> → <end> (blocks/IDs/dates)
- **Throughput:** XXX,XXX items/minute

**Worker Status:**
- Workers 0-7: ✅ FINISHED
- Workers 8-15: XX-XX% complete
  - Worker 9 (slowest): XX.X%
- Workers 16-23: ✅ FINISHED

**Error Status:**
- XX HTTP 503/429 errors
- X failed retries (target: 0)

**ETA:** ~XX minutes
```

### For File Processing Backfills
```
## File Processing Progress: X,XXX files

**Current Stats:**
- **X,XXX files** processed
- **XX GB** total size processed
- **Throughput:** XX files/minute

**Worker Status:**
- XX active workers processing
- Slowest worker: Worker X at XX.X%

**Error Status:**
- X read errors
- X validation failures
- X retries needed

**ETA:** ~XX minutes
```

### For API Data Fetching
```
## API Backfill Progress: XXX,XXX records

**Current Stats:**
- **XXX,XXX records** fetched
- **API calls:** X,XXX total (XX% of estimate)
- **Throughput:** XX requests/second

**Worker Status:**
- XX workers active
- Rate limits: XX hits, all recovered

**ETA:** ~XX minutes
```

## Common File Locations by Backfill Type

**Blockchain data:**
- Logs: `tmp/blockchain-backfill.log`, `tmp/erc1155-backfill.log`
- Verification: `scripts/verify-staging-tables.ts`
- Target: ClickHouse staging tables

**API integrations:**
- Logs: `tmp/api-backfill.log`, `logs/ingest-*.log`
- Verification: `scripts/verify-api-data.ts`
- Target: Database tables or JSON files

**File processing:**
- Logs: `logs/file-processor.log`
- Verification: Count files in output directory
- Target: Processed files or aggregated data

## Common Issues

**Issue: Workers seem stuck**
- Check log for repeated errors
- Look for cascading rate limit backoffs
- Verify ClickHouse connection still active

**Issue: Row count not increasing**
- Check if process still running (ps aux)
- Look for fatal errors in log tail
- Verify disk space available

**Issue: Many HTTP 503 errors**
- Count errors: `grep -c "HTTP 503" tmp/backfill.log`
- If >100 errors: Consider reducing worker count
- If retries failing: Stop and restart with lower rate

## Performance Benchmarks

**Good performance indicators:**
- 200K-500K rows/minute throughput
- <50 HTTP 503 errors per hour
- 0 failed retries
- Minimal zero timestamps (<0.01%)

**Optimal tuning signs:**
- Some 503 errors (shows we're pushing limits)
- All retries succeed (shows backoff is working)
- Workers finishing at similar times (well-balanced)

## Cascadian Project Specific Examples

### ERC-1155 Blockchain Backfill (Current)
- **Log:** `tmp/backfill.log`
- **Script:** `scripts/erc1155-alchemy-backfill.ts`
- **Verification:** `npx tsx scripts/verify-staging-tables.ts`
- **Target:** `staging.erc1155_transfers_v2` (ClickHouse)
- **Check command:** `tail -n 30 tmp/backfill.log | grep Worker`

### CLOB Fills Backfill
- **Log:** `tmp/clob-backfill.log` (typical)
- **Verification:** Count rows in `clob_fills` table
- **Target:** ClickHouse `default` database

### Market Data Sync
- **Log:** `logs/market-sync.log` (if configured)
- **Verification:** Check latest timestamp in markets table
- **Target:** Real-time market data tables

---
**Created:** 2025-11-11
**Last Updated:** 2025-11-11
**Tested With:** ERC-1155 Alchemy backfill (60M rows, 24 workers, ~140 minutes)
