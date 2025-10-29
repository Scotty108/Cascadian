# Enrichment Pipeline Runbook

## Overview

This runbook covers operations for the crash-resumable enrichment pipeline, including Step D (P&L calculation) and Step E (resolution accuracy).

## Prerequisites

- ClickHouse running and accessible
- Supabase/Postgres configured (optional for remote checkpoints)
- Node.js 20+ with tsx
- Valid `.env.local` with `CLICKHOUSE_*` credentials

## Step D: P&L Calculation (Crash-Resumable)

### Starting Fresh

```bash
# Start Step D from beginning
BATCH_SIZE=300 npx tsx scripts/run-step-d-resumable.ts >> runtime/full-enrichment.console.log 2>&1 &
echo $! > runtime/full-enrichment.pid

# Monitor progress
tail -f runtime/full-enrichment.console.log

# Check checkpoint
cat runtime/full-enrichment.state.json
```

### Resuming After Crash

1. **Check last checkpoint:**
   ```bash
   cat runtime/full-enrichment.state.json
   tail -50 runtime/full-enrichment.console.log
   ```

2. **Verify mutations cleared:**
   ```bash
   npx tsx scripts/print-gates.ts | grep "pending_mutations"
   ```

   If mutations > 0, wait:
   ```bash
   # Poll until clear
   watch -n 10 'npx tsx scripts/print-gates.ts | grep "pending_mutations"'
   ```

3. **Resume:**
   ```bash
   BATCH_SIZE=300 npx tsx scripts/run-step-d-resumable.ts --resume >> runtime/full-enrichment.console.log 2>&1 &
   echo $! > runtime/full-enrichment.pid
   ```

### Graceful Shutdown

Send SIGINT or SIGTERM to save checkpoint:

```bash
# Get PID
cat runtime/full-enrichment.pid

# Graceful shutdown (saves checkpoint)
kill -SIGTERM $(cat runtime/full-enrichment.pid)

# Wait for checkpoint save
sleep 5
cat runtime/full-enrichment.state.json
```

### Monitoring

**Real-time log:**
```bash
tail -f runtime/full-enrichment.console.log
```

**Progress snapshot:**
```bash
cat runtime/full-enrichment.state.json
```

**Gates + invariants:**
```bash
npx tsx scripts/print-gates.ts
```

**Expected output:**
```
✅ Gate 1: markets_missing_dim = 0
✅ Gate 2: pnl_nulls = 0 (will increase as Step D progresses)
❌ Gate 3: wallets_with_outcomes = 3 (waits for Step E)
❌ Gate 4: pending_mutations = X (fluctuates during Step D)
📊 bad_markets = X (decreases as Step D progresses)
```

### Checkpoint Format

**Local:** `runtime/full-enrichment.state.json`

```json
{
  "job": "enrichment",
  "step": "D",
  "batch_idx": 150,
  "pairs_done": 45000,
  "last_mutations": 250,
  "updated_at": "2025-10-28T12:00:00.000Z"
}
```

**Remote:** Supabase `ops_job_checkpoints` table

Same fields, persisted to Postgres for durability.

### Performance Tuning

**Batch size (default: 300):**
- Larger = faster but more memory + mutation pressure
- Smaller = slower but safer

```bash
# Faster (use if mutations stay low)
BATCH_SIZE=500 npx tsx scripts/run-step-d-resumable.ts --resume

# Safer (use if hitting mutation limit)
BATCH_SIZE=200 npx tsx scripts/run-step-d-resumable.ts --resume
```

**Mutation wait frequency:**

Script waits for mutations every 5 batches. This is hardcoded but can be adjusted in `run-step-d-resumable.ts`:

```typescript
if (batchCount % 5 === 0) {
  await waitForMutations()
}
```

### Troubleshooting

**Problem: Mutations stuck at 1000**

ClickHouse has a 1000 mutation limit. If stuck:

```bash
# Check mutation details
npx tsx -e "
import { getPendingMutationDetails } from './lib/clickhouse/mutations.js'
const details = await getPendingMutationDetails()
console.log(JSON.stringify(details, null, 2))
"
```

**Solution:** Reduce BATCH_SIZE or increase wait frequency.

**Problem: Checkpoint not saving**

Check file permissions:

```bash
ls -la runtime/full-enrichment.state.json
```

If Supabase checkpoints failing:

```bash
# Test Postgres connection
npx tsx -e "
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL })
await pool.query('SELECT 1')
console.log('✅ Postgres connected')
await pool.end()
"
```

**Problem: Resume starts from beginning**

Checkpoint file may be corrupted. Check:

```bash
cat runtime/full-enrichment.state.json | jq .
```

If invalid JSON, manually create:

```json
{
  "job": "enrichment",
  "step": "D",
  "batch_idx": <LAST_KNOWN_BATCH>,
  "pairs_done": <BATCH_IDX * 300>,
  "last_mutations": 0,
  "updated_at": "<CURRENT_ISO_TIMESTAMP>"
}
```

**Problem: Value conservation failures (bad_markets > 0)**

This is expected during Step D (only partially processed). After Step D completes, bad_markets should be 0.

If bad_markets > 0 after completion:
1. Check for duplicate trades
2. Verify resolution data integrity
3. Manually investigate markets with `SELECT market_id, sum(realized_pnl_usd) FROM trades_raw WHERE is_resolved=1 GROUP BY market_id HAVING abs(sum(realized_pnl_usd)) > 0.01`

## Step E: Resolution Accuracy

### Prerequisites

- Step D must be 100% complete
- All mutations cleared (pending_mutations = 0)
- `wallet_resolution_outcomes` table exists

### Running Step E

```bash
# Run full enrichment pass, Step E only
npx tsx scripts/full-enrichment-pass.ts --step=E
```

**What Step E does:**
1. Truncates `wallet_resolution_outcomes` table
2. Computes resolution accuracy for all ~2,839 wallets
3. Populates `wallet_resolution_outcomes` with win/loss records

**Expected duration:** 30-60 minutes

### Verification

After Step E completes, run gates:

```bash
npx tsx scripts/print-gates.ts
```

**Expected:**
```
✅ Gate 1: markets_missing_dim = 0
✅ Gate 2: pnl_nulls = 0
✅ Gate 3: wallets_with_outcomes ≈ 2,839
✅ Gate 4: pending_mutations = 0
📊 bad_markets = 0
```

## Validation Gates

### Gate 1: markets_missing_dim

**Query:**
```sql
SELECT uniqExactIf(t.market_id, m.market_id IS NULL) AS markets_missing_dim
FROM trades_raw t
LEFT JOIN markets_dim m USING(market_id)
WHERE t.market_id != '';
```

**Expected:** 0 or 1 (1 acceptable if one market failed API fetch)

**Fix if failing:**
```bash
# Find missing market
SELECT DISTINCT market_id FROM trades_raw t
LEFT JOIN markets_dim m USING(market_id)
WHERE t.market_id != '' AND m.market_id IS NULL;

# Create FOCUS_FILE
echo "<MARKET_ID>" > runtime/focus_market.txt

# Fetch and republish
FOCUS_FILE=runtime/focus_market.txt npx tsx scripts/build-missing-dimensions.ts
npx tsx scripts/publish-dimensions-to-clickhouse.ts
npx tsx scripts/stepB_denorm_categories.ts
```

### Gate 2: pnl_nulls

**Query:**
```sql
SELECT countIf(realized_pnl_usd IS NULL AND is_resolved = 1) AS pnl_nulls
FROM trades_raw;
```

**Expected:** 0

**Fix if failing:**
- Re-run Step D (resume mode safe)
- Check for NULL condition_ids or market_ids in trades_raw

### Gate 3: wallets_with_outcomes

**Query:**
```sql
SELECT COUNT(DISTINCT wallet_address) AS wallets
FROM wallet_resolution_outcomes;
```

**Expected:** ≈2,839 (within ±50)

**Fix if failing:**
- Re-run Step E
- Check `wallet_resolution_outcomes` table exists
- Verify `trades_raw` has data for wallets

### Gate 4: pending_mutations

**Query:**
```sql
SELECT count() as pending
FROM system.mutations
WHERE is_done = 0;
```

**Expected:** 0

**Fix if failing:**
- Wait for mutations to complete
- Use `waitForNoPendingMutations()` helper

## Emergency Procedures

### Hard Reset (Nuclear Option)

**WARNING:** This deletes all enrichment progress.

```bash
# Backup first
clickhouse-client --query "SELECT * FROM trades_raw WHERE is_resolved = 1 FORMAT CSV" > backup.csv

# Reset P&L columns
clickhouse-client --query "
ALTER TABLE trades_raw
UPDATE realized_pnl_usd = NULL, is_resolved = 0
WHERE 1=1
"

# Wait for mutation
npx tsx -e "
import { waitForNoPendingMutations } from './lib/clickhouse/mutations.js'
await waitForNoPendingMutations()
"

# Truncate wallet_resolution_outcomes
clickhouse-client --query "TRUNCATE TABLE wallet_resolution_outcomes"

# Delete checkpoint
rm runtime/full-enrichment.state.json

# Restart Step D from beginning
BATCH_SIZE=300 npx tsx scripts/run-step-d-resumable.ts
```

### Partial Reset (Single Market)

If one market has bad data:

```sql
-- Find trades for bad market
SELECT * FROM trades_raw WHERE market_id = '<BAD_MARKET_ID>' AND is_resolved = 1;

-- Reset just that market
ALTER TABLE trades_raw
UPDATE realized_pnl_usd = NULL, is_resolved = 0
WHERE market_id = '<BAD_MARKET_ID>';
```

Then re-run Step D (will reprocess that market).

## Contacts & Escalation

- **Crash recovery:** Check this runbook first
- **Data quality issues:** Run `print-gates.ts` and share output
- **Performance issues:** Check mutation count and batch size
- **Unknown errors:** Share `runtime/full-enrichment.console.log` tail

## Appendix: File Locations

```
runtime/
├── full-enrichment.state.json      # Local checkpoint
├── full-enrichment.console.log     # Full execution log
├── full-enrichment.pid             # Process ID
└── ingest_backlog.jsonl            # Shadow ingestor output (if enabled)

scripts/
├── run-step-d-resumable.ts         # Crash-resumable Step D
├── full-enrichment-pass.ts         # Steps A-E master script
├── print-gates.ts                  # Validation gates checker
└── apply-supabase-migration.ts     # Remote checkpoint setup

migrations/supabase/
└── 001_create_ops_job_checkpoints.sql  # Remote checkpoint table

lib/clickhouse/
└── mutations.ts                    # Mutation management helpers
```

## Appendix: Process Flow

```
[Start] → Load Checkpoint → Verify Mutations → Load Resolution Map
  ↓
Process Batches (300 pairs/batch)
  ↓
For each (wallet, condition) pair:
  - Calculate net position
  - Calculate P&L
  - Update trades_raw
  ↓
Save Checkpoint (every batch)
  ↓
Wait for Mutations (every 5 batches)
  ↓
[Complete] → Save Final Checkpoint
```

## Appendix: Metrics

- **Total pairs:** 136,931
- **Total batches:** 457 (at BATCH_SIZE=300)
- **Estimated duration:** 6-8 hours
- **Mutations per batch:** ~50-500 (varies by market size)
- **Checkpoint frequency:** Every batch (~1 minute)
- **Mutation wait frequency:** Every 5 batches (~5 minutes)
