# External Trade Backfill Runbook

**Purpose:** Operational guide for managing external trade ingestion from Polymarket Data-API

**Created:** Phase 9 of C2 External Data Ingestion mission
**Agent:** C2 - External Data Ingestion
**Audience:** Operations team, future agents

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Daily Operations](#daily-operations)
4. [Regenerating Backfill Plan](#regenerating-backfill-plan)
5. [Running the Backfill Worker](#running-the-backfill-worker)
6. [Monitoring and Validation](#monitoring-and-validation)
7. [Troubleshooting](#troubleshooting)
8. [Recovery Procedures](#recovery-procedures)

---

## Prerequisites

### System Requirements

- **Node.js:** v20+ (TypeScript execution via `tsx`)
- **ClickHouse:** Access to production database (read/write)
- **Polymarket Data-API:** Internet access (no auth required)

### Required Tables

Ensure these exist in ClickHouse:

```sql
-- Check for required tables
SELECT name FROM system.tables
WHERE database = currentDatabase()
  AND name IN ('external_trades_raw', 'pm_trades_with_external', 'wallet_backfill_plan')
ORDER BY name;
```

**Expected:** 3 rows (all tables present)

If missing, run setup scripts:
```bash
npx tsx scripts/201-create-external-trades-table.ts
npx tsx scripts/202-create-pm-trades-with-external-view.ts
npx tsx scripts/205-build-wallet-backfill-plan.ts
```

---

## Environment Setup

### Required Environment Variables

Create or update `.env.local` in project root:

```bash
# ClickHouse Connection (required)
CLICKHOUSE_HOST=your-clickhouse-host.com
CLICKHOUSE_PORT=8443
CLICKHOUSE_USER=your-username
CLICKHOUSE_PASSWORD=your-password
CLICKHOUSE_DATABASE=your-database

# Optional: Rate Limiting
BACKFILL_SLEEP_MS=2000  # Milliseconds between wallets (default: 2000)
BACKFILL_LIMIT=100      # Max wallets per run (default: unlimited)
```

### Verify Connection

```bash
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client.js';
const result = await clickhouse.query({
  query: 'SELECT 1 as test',
  format: 'JSONEachRow'
});
console.log('✅ ClickHouse connection working:', await result.json());
"
```

---

## Daily Operations

### Morning Checklist

1. **Check backfill plan status**
   ```bash
   npx tsx scripts/check-wallet-backfill-plan.ts
   ```

2. **Review external_trades_raw growth**
   ```bash
   npx tsx scripts/check-external-trades.ts
   ```

3. **Check for errors**
   ```sql
   SELECT
     wallet_address,
     error_message,
     last_run_at
   FROM wallet_backfill_plan
   WHERE status = 'error'
   ORDER BY last_run_at DESC
   LIMIT 10;
   ```

### Incremental Backfill (Recommended)

Process 10-20 wallets per run to avoid rate limits:

```bash
# Process next 10 pending wallets
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 10

# Wait 5 minutes, then run again
sleep 300
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 10
```

### Full Backfill (Overnight)

Process all pending wallets (use with caution):

```bash
# Recommended: Run in screen/tmux session
screen -S external-backfill

# Start backfill (no limit = process all pending)
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --sleep-ms 3000

# Detach: Ctrl+A, then D
# Reattach: screen -r external-backfill
```

**Estimated runtime:** 100 wallets × 3 seconds = 5 minutes (plus API latency)

---

## Regenerating Backfill Plan

### When to Regenerate

- **New wallets added to pm_trades** (weekly or after major CLOB backfills)
- **Top wallet rankings changed** (monthly)
- **Expanding coverage** (e.g., from top 100 to top 500 wallets)

### Regeneration Steps

**Step 1: Backup current plan**
```sql
CREATE TABLE wallet_backfill_plan_backup AS
SELECT * FROM wallet_backfill_plan;
```

**Step 2: Drop and recreate**
```bash
# Drop old plan
clickhouse-client -q "DROP TABLE wallet_backfill_plan"

# Recreate with updated rankings
npx tsx scripts/205-build-wallet-backfill-plan.ts
```

**Step 3: Restore completed wallets**

If you want to preserve `status='done'` wallets:

```sql
-- Mark previously completed wallets as done
UPDATE wallet_backfill_plan
SET status = 'done', last_run_at = now()
WHERE wallet_address IN (
  SELECT wallet_address FROM wallet_backfill_plan_backup WHERE status = 'done'
);
```

**Step 4: Verify**
```bash
npx tsx scripts/check-wallet-backfill-plan.ts
```

---

## Running the Backfill Worker

### Basic Usage

```bash
# Dry-run mode (preview only, no insertions)
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 1 --dry-run

# Live mode (process 1 wallet)
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 1

# Process next 10 wallets
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 10

# Process wallets 50-60 (skip first 50)
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --skip 50 --limit 10
```

### Advanced Options

```bash
# Custom date range (fetch trades from 2024 onwards)
npx tsx scripts/206-backfill-external-trades-from-data-api.ts \
  --limit 10 \
  --since 2024-01-01 \
  --until 2025-01-01

# Custom sleep interval (slower = more conservative)
npx tsx scripts/206-backfill-external-trades-from-data-api.ts \
  --limit 50 \
  --sleep-ms 5000  # 5 seconds between wallets
```

### Resuming After Interruption

The backfill worker is **resumable** by design:

1. Wallets with `status='pending'` are processed first
2. Wallets with `status='in_progress'` are skipped (manual reset required)
3. Wallets with `status='done'` are skipped
4. Wallets with `status='error'` are skipped (manual retry required)

**Resume command:**
```bash
# Simply re-run - it will pick up where it left off
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 50
```

**Reset stuck wallets:**
```sql
-- Reset wallets stuck in 'in_progress'
UPDATE wallet_backfill_plan
SET status = 'pending', error_message = ''
WHERE status = 'in_progress';
```

---

## Monitoring and Validation

### Real-Time Monitoring

**Watch backfill progress:**
```bash
watch -n 10 "npx tsx scripts/check-wallet-backfill-plan.ts"
```

**Check external_trades_raw growth:**
```sql
SELECT
  toDate(ingested_at) as date,
  COUNT(*) as trades_ingested,
  COUNT(DISTINCT wallet_address) as unique_wallets
FROM external_trades_raw
GROUP BY date
ORDER BY date DESC
LIMIT 7;
```

### Validation After Backfill

**Step 1: Generate coverage report**
```bash
npx tsx scripts/207-report-external-coverage.ts
```

**Step 2: Review report**
```bash
cat EXTERNAL_COVERAGE_STATUS.md
```

**Step 3: Validate UNION view**
```bash
npx tsx scripts/204-validate-external-ingestion.ts
```

**Step 4: Sanity check**
```sql
-- Verify no CLOB/external overlap for ghost markets
SELECT
  condition_id,
  COUNT(*) as total_trades,
  SUM(CASE WHEN data_source = 'clob_fills' THEN 1 ELSE 0 END) as clob_trades,
  SUM(CASE WHEN data_source = 'polymarket_data_api' THEN 1 ELSE 0 END) as external_trades
FROM pm_trades_with_external
WHERE condition_id IN (
  SELECT DISTINCT condition_id FROM external_trades_raw
)
GROUP BY condition_id
HAVING clob_trades > 0 AND external_trades > 0;
```

**Expected:** 0 rows (ghost markets should only exist in external source)

---

## Troubleshooting

### Common Issues

#### Issue 1: "No pending wallets found"

**Cause:** All wallets processed or backfill plan not seeded.

**Fix:**
```bash
# Check plan status
npx tsx scripts/check-wallet-backfill-plan.ts

# If empty, regenerate plan
npx tsx scripts/205-build-wallet-backfill-plan.ts
```

#### Issue 2: "HTTP 429: Too Many Requests"

**Cause:** Rate limit hit on Polymarket Data-API.

**Fix:**
```bash
# Increase sleep interval
npx tsx scripts/206-backfill-external-trades-from-data-api.ts \
  --limit 10 \
  --sleep-ms 5000  # 5 seconds instead of 2
```

#### Issue 3: "ClickHouse connection timeout"

**Cause:** Database unreachable or `.env.local` misconfigured.

**Fix:**
```bash
# Verify environment variables
grep CLICKHOUSE .env.local

# Test connection
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client.js';
const result = await clickhouse.query({ query: 'SELECT 1', format: 'JSONEachRow' });
console.log(await result.json());
"
```

#### Issue 4: Duplicate trades detected

**Cause:** Running ingestion multiple times without deduplication.

**Fix:**
- The connector has built-in deduplication via `external_trade_id`
- Re-running is safe and will skip existing trades
- Duplicates should not occur

**Verify:**
```sql
SELECT
  external_trade_id,
  COUNT(*) as cnt
FROM external_trades_raw
GROUP BY external_trade_id
HAVING COUNT(*) > 1
LIMIT 10;
```

**Expected:** 0 rows

#### Issue 5: Wallet marked as 'error'

**Cause:** Data-API returned error for specific wallet.

**Diagnosis:**
```sql
SELECT
  wallet_address,
  error_message,
  last_run_at
FROM wallet_backfill_plan
WHERE status = 'error'
ORDER BY last_run_at DESC;
```

**Fix:**
```sql
-- Reset to pending for retry
UPDATE wallet_backfill_plan
SET status = 'pending', error_message = ''
WHERE wallet_address = 'problematic_wallet_address';
```

---

## Recovery Procedures

### Scenario A: Backfill Worker Crashed Mid-Run

**Steps:**
1. Check for wallets stuck in 'in_progress'
   ```sql
   SELECT COUNT(*) FROM wallet_backfill_plan WHERE status = 'in_progress';
   ```

2. Reset stuck wallets
   ```sql
   UPDATE wallet_backfill_plan
   SET status = 'pending'
   WHERE status = 'in_progress';
   ```

3. Resume backfill
   ```bash
   npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 50
   ```

### Scenario B: external_trades_raw Corrupted

**Steps:**
1. Backup current state
   ```sql
   CREATE TABLE external_trades_raw_backup AS SELECT * FROM external_trades_raw;
   ```

2. Truncate and rebuild
   ```sql
   TRUNCATE TABLE external_trades_raw;
   ```

3. Reset backfill plan
   ```sql
   UPDATE wallet_backfill_plan SET status = 'pending';
   ```

4. Re-run backfill
   ```bash
   npx tsx scripts/206-backfill-external-trades-from-data-api.ts
   ```

### Scenario C: Polymarket Data-API Outage

**Steps:**
1. Check API status
   ```bash
   curl -I https://data-api.polymarket.com/activity
   ```

2. If down, pause backfills and monitor

3. When recovered, resume
   ```bash
   npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 10
   ```

---

## Best Practices

### Rate Limiting

- **Conservative:** `--sleep-ms 5000` (12 wallets/min)
- **Standard:** `--sleep-ms 2000` (30 wallets/min)
- **Aggressive:** `--sleep-ms 1000` (60 wallets/min, risk of rate limit)

**Recommendation:** Start conservative, increase if no rate limit errors.

### Batch Processing

Process in batches rather than all at once:

```bash
# Batch 1
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 20

# Wait 10 minutes
sleep 600

# Batch 2
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 20
```

### Checkpoint Validation

After each batch, validate:

```bash
# Check for errors
npx tsx scripts/check-wallet-backfill-plan.ts

# Validate ingestion
npx tsx scripts/204-validate-external-ingestion.ts
```

### Logging

Save backfill output for debugging:

```bash
npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 50 \
  2>&1 | tee backfill-$(date +%Y%m%d-%H%M%S).log
```

---

## Quick Reference

### Essential Commands

| Task | Command |
|------|---------|
| Check plan status | `npx tsx scripts/check-wallet-backfill-plan.ts` |
| Check external trades | `npx tsx scripts/check-external-trades.ts` |
| Dry-run backfill | `npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 1 --dry-run` |
| Process 10 wallets | `npx tsx scripts/206-backfill-external-trades-from-data-api.ts --limit 10` |
| Generate coverage report | `npx tsx scripts/207-report-external-coverage.ts` |
| Validate ingestion | `npx tsx scripts/204-validate-external-ingestion.ts` |

### SQL Queries

```sql
-- Pending wallets count
SELECT COUNT(*) FROM wallet_backfill_plan WHERE status = 'pending';

-- Total external trades
SELECT COUNT(*) FROM external_trades_raw;

-- Wallets with external trades
SELECT COUNT(DISTINCT wallet_address) FROM external_trades_raw;

-- Markets with external trades
SELECT COUNT(DISTINCT condition_id) FROM external_trades_raw;

-- Last 10 ingested trades
SELECT * FROM external_trades_raw ORDER BY ingested_at DESC LIMIT 10;

-- Error wallets
SELECT wallet_address, error_message FROM wallet_backfill_plan WHERE status = 'error';
```

---

## Emergency Contacts

**For urgent issues:**
- Check `C2_HANDOFF_FOR_C1.md` for integration guidance
- Review `EXTERNAL_TRADES_PIPELINE.md` for architecture details
- Consult `EXTERNAL_COVERAGE_STATUS.md` for current coverage metrics

**Escalation:**
- C1 agent for P&L integration issues
- Database admin for ClickHouse connection problems
- Polymarket support for Data-API outages

---

**Agent:** C2 - External Data Ingestion
**Runbook Version:** 1.0
**Last Updated:** 2025-11-16

_Always run backfills with maximum workers without hitting rate limits, with save/crash/stall protection enabled._
