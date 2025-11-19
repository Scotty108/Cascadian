# Payout Vector Backfill - Execution Guide

**Objective:** Backfill 170,448 missing payout vectors from Goldsky subgraph in under 10 hours

**Status:** Ready to execute
**Expected Runtime:** 2-3 hours with 4 workers
**Data Source:** Goldsky GraphQL API
**Target Table:** `default.resolutions_external_ingest`

---

## Quick Start

### 1. Verify Prerequisites

```bash
# Check that the condition IDs file exists
ls -lh reports/condition_ids_missing_api.txt
# Should show: 170448 lines

# Verify ClickHouse connection
npx tsx -e "import { clickhouse } from './lib/clickhouse/client'; clickhouse.ping().then(() => console.log('✅ Connected')).catch(console.error)"

# Create runtime directory for checkpoints
mkdir -p runtime
```

### 2. Run 4 Workers in Parallel

Open 4 separate terminal windows and run:

```bash
# Terminal 1
npx tsx backfill-payouts-parallel.ts --worker=1 --of=4

# Terminal 2
npx tsx backfill-payouts-parallel.ts --worker=2 --of=4

# Terminal 3
npx tsx backfill-payouts-parallel.ts --worker=3 --of=4

# Terminal 4
npx tsx backfill-payouts-parallel.ts --worker=4 --of=4
```

### 3. Monitor Progress

```bash
# Watch all workers' progress in real-time
tail -f runtime/payout-backfill-worker*.progress.jsonl

# Check checkpoint status
cat runtime/payout-backfill-worker1.checkpoint.json | jq

# Count total payouts inserted so far
clickhouse-client --query "SELECT COUNT(*) FROM default.resolutions_external_ingest WHERE source='goldsky-api'"
```

---

## System Architecture

### Data Flow

```
reports/condition_ids_missing_api.txt (170,448 IDs)
    ↓ Split into 4 worker chunks (~42,612 IDs each)
    ↓
Worker 1,2,3,4 (parallel execution)
    ↓ Batch into groups of 1,000 IDs
    ↓
Goldsky GraphQL API (8 concurrent requests per worker)
    ↓ Parse payout vectors
    ↓
ClickHouse: default.resolutions_external_ingest
    ↓ Union into vw_resolutions_truth
    ↓
P&L calculation (settled trades)
```

### Worker Distribution

| Worker | ID Range      | IDs Count | Terminal |
|--------|---------------|-----------|----------|
| 1      | 0-42,611      | 42,612    | Term 1   |
| 2      | 42,612-85,223 | 42,612    | Term 2   |
| 3      | 85,224-127,835| 42,612    | Term 3   |
| 4      | 127,836-170,447| 42,612   | Term 4   |

---

## Performance Specs

### Expected Performance

| Metric | Value |
|--------|-------|
| **Total IDs** | 170,448 |
| **Batch size** | 1,000 IDs/query |
| **Total batches** | 171 batches |
| **Workers** | 4 parallel |
| **Batches per worker** | ~43 batches |
| **Concurrent requests** | 8 per worker |
| **GraphQL rate** | ~500ms per request (rate limited) |
| **Expected runtime** | 2-3 hours |

### Throughput Calculation

```
Per worker:
- 43 batches × 1,000 IDs = 43,000 IDs
- 43 batches / 8 concurrent = ~6 rounds
- 6 rounds × 8 requests × 500ms = 24 seconds minimum
- With retries/overhead: ~10-15 minutes per worker

Total: 2-3 hours with 4 workers
```

---

## Checkpoint & Resume

### Automatic Checkpointing

- Checkpoints saved every 10 batches
- Checkpoint files: `runtime/payout-backfill-worker{N}.checkpoint.json`
- Progress logs: `runtime/payout-backfill-worker{N}.progress.jsonl`

### Resume After Failure

If a worker crashes or is interrupted (Ctrl+C):

```bash
# Just restart the same worker - it will resume automatically
npx tsx backfill-payouts-parallel.ts --worker=2 --of=4
```

The worker will:
1. Load checkpoint file
2. Skip already-processed batches
3. Continue from last saved position

### Manual Recovery

```bash
# Check worker 2's progress
cat runtime/payout-backfill-worker2.checkpoint.json

# Output:
{
  "workerNum": 2,
  "batchesProcessed": 25,
  "lastBatchIndex": 24,
  "totalIdsProcessed": 25000,
  "totalPayoutsFound": 18234,
  "startTime": "2025-11-09T10:30:00.000Z",
  "lastSaveTime": "2025-11-09T11:15:00.000Z"
}

# Worker 2 will resume from batch 25
```

---

## Monitoring & Debugging

### Real-Time Progress

```bash
# Watch all workers
watch -n 5 'ls -lh runtime/*.checkpoint.json && echo && cat runtime/payout-backfill-worker*.checkpoint.json | jq -r "{worker: .workerNum, processed: .totalIdsProcessed, found: .totalPayoutsFound}"'

# Count inserted payouts
watch -n 10 'clickhouse-client --query "SELECT COUNT(*) as total_payouts, COUNT(DISTINCT condition_id) as unique_conditions FROM default.resolutions_external_ingest WHERE source=\"goldsky-api\""'
```

### Common Issues

#### 1. GraphQL Errors

**Symptom:** Worker logs show "GraphQL errors: ..."

**Solution:**
- Usually transient - worker will retry automatically (3 retries)
- If persistent, reduce `CONCURRENT_REQUESTS` in script (line 40)

#### 2. ClickHouse Connection Errors

**Symptom:** "ClickHouse insert failed"

**Solution:**
```bash
# Test connection
npx tsx -e "import { clickhouse } from './lib/clickhouse/client'; clickhouse.ping().then(() => console.log('✅ OK')).catch(console.error)"

# Check .env.local
cat .env.local | grep CLICKHOUSE
```

#### 3. Rate Limiting

**Symptom:** Many failed requests, slow progress

**Solution:**
- Goldsky has generous limits, but if hit, adjust `RATE_LIMIT_DELAY_MS` in `lib/polymarket/goldsky-payouts.ts`
- Current: 500ms (2 req/sec per worker)
- Try: 1000ms (1 req/sec)

#### 4. Worker Stuck

**Symptom:** No progress for >5 minutes

**Solution:**
```bash
# Kill stuck worker (Ctrl+C)
# Check last checkpoint
cat runtime/payout-backfill-worker3.checkpoint.json

# Restart - will resume from checkpoint
npx tsx backfill-payouts-parallel.ts --worker=3 --of=4
```

---

## Validation

### After Completion

```bash
# 1. Check total payouts inserted
clickhouse-client --query "
SELECT
  COUNT(*) as total_payouts,
  COUNT(DISTINCT condition_id) as unique_conditions,
  source
FROM default.resolutions_external_ingest
WHERE source = 'goldsky-api'
GROUP BY source
"

# Expected output:
# total_payouts: ~120,000-150,000 (not all markets are resolved yet)
# unique_conditions: ~120,000-150,000

# 2. Check payout quality
clickhouse-client --query "
SELECT
  COUNT(*) as count,
  payout_denominator,
  arraySum(payout_numerators) as sum_check
FROM default.resolutions_external_ingest
WHERE source = 'goldsky-api'
GROUP BY payout_denominator, sum_check
ORDER BY count DESC
LIMIT 10
"

# 3. Sample a few payouts
clickhouse-client --query "
SELECT
  condition_id,
  payout_numerators,
  payout_denominator,
  winning_index
FROM default.resolutions_external_ingest
WHERE source = 'goldsky-api'
LIMIT 5
" --format Pretty
```

### Coverage Analysis

```bash
# Compare before/after
clickhouse-client --query "
SELECT
  'Before' as status,
  COUNT(*) as total_resolutions
FROM default.market_resolutions_final

UNION ALL

SELECT
  'After Goldsky' as status,
  COUNT(*) as total_resolutions
FROM (
  SELECT condition_id FROM default.market_resolutions_final
  UNION ALL
  SELECT condition_id FROM default.resolutions_external_ingest WHERE source='goldsky-api'
)
" --format Pretty
```

---

## Performance Tuning

### Scale Up (Faster)

```bash
# Run 8 workers instead of 4
# Expected runtime: 1-1.5 hours

# Terminal 1-8
npx tsx backfill-payouts-parallel.ts --worker=1 --of=8
npx tsx backfill-payouts-parallel.ts --worker=2 --of=8
# ... etc
```

### Scale Down (Conservative)

```bash
# Run 2 workers for lower load
# Expected runtime: 4-6 hours

npx tsx backfill-payouts-parallel.ts --worker=1 --of=2
npx tsx backfill-payouts-parallel.ts --worker=2 --of=2
```

### Adjust Concurrency

Edit `backfill-payouts-parallel.ts` line 40:

```typescript
const CONCURRENT_REQUESTS = 8; // Default

// More aggressive (may hit rate limits)
const CONCURRENT_REQUESTS = 12;

// More conservative (slower but safer)
const CONCURRENT_REQUESTS = 4;
```

---

## Integration with P&L System

### Next Steps After Backfill

Once backfill completes, update `vw_resolutions_truth` to include Goldsky data:

```sql
-- Update cascadian_clean.vw_resolutions_truth
CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_truth AS
SELECT
  condition_id,
  payout_numerators,
  payout_denominator,
  winning_index,
  resolved_at,
  'market_resolutions_final' as source
FROM default.market_resolutions_final
WHERE payout_denominator > 0

UNION ALL

SELECT
  condition_id,
  payout_numerators,
  payout_denominator,
  winning_index,
  resolved_at,
  source
FROM default.resolutions_external_ingest
WHERE payout_denominator > 0
  AND arraySum(payout_numerators) > 0;
```

### Verify P&L Impact

```bash
# Check settled P&L coverage before/after
clickhouse-client --query "
SELECT
  COUNT(DISTINCT wallet_address) as wallets_with_settled_pnl,
  SUM(settled_pnl_usd) as total_settled_pnl
FROM cascadian_clean.vw_wallet_pnl_settled
WHERE settled_pnl_usd != 0
"
```

---

## File Reference

| File | Purpose |
|------|---------|
| `lib/polymarket/goldsky-payouts.ts` | GraphQL client for Goldsky API |
| `backfill-payouts-parallel.ts` | Parallel worker script |
| `reports/condition_ids_missing_api.txt` | Input: 170,448 missing IDs |
| `runtime/payout-backfill-worker{N}.checkpoint.json` | Checkpoint state |
| `runtime/payout-backfill-worker{N}.progress.jsonl` | Detailed progress log |

---

## Support & Troubleshooting

### Debug Mode

Enable detailed logging:

```bash
# Add DEBUG flag
DEBUG=1 npx tsx backfill-payouts-parallel.ts --worker=1 --of=4
```

### Clean Restart

```bash
# Remove all checkpoints and start fresh
rm runtime/payout-backfill-worker*.checkpoint.json
rm runtime/payout-backfill-worker*.progress.jsonl

# Restart workers
npx tsx backfill-payouts-parallel.ts --worker=1 --of=4
```

### Manual Query Test

```bash
# Test a single batch manually
npx tsx -e "
import { fetchPayoutsBatch } from './lib/polymarket/goldsky-payouts';
const ids = [
  '0000074ba83ff8fb5b39ebbe2d366bcf1a537b31bdd53afb21ef2019d8b7d32e',
  '00004a51362c3e68e2c1f84b51c6e2dd18263554cc64f07272a7b5ee4448f2bb'
];
fetchPayoutsBatch(ids).then(payouts => {
  console.log(\`Found \${payouts.length} payouts\`);
  console.log(JSON.stringify(payouts, null, 2));
}).catch(console.error);
"
```

---

## Timeline & Milestones

| Time | Milestone | Validation |
|------|-----------|------------|
| T+0min | Start 4 workers | Workers show "Starting..." |
| T+5min | First checkpoints saved | `cat runtime/*.checkpoint.json` shows progress |
| T+30min | ~25% complete | ~40,000 IDs processed |
| T+60min | ~50% complete | ~85,000 IDs processed |
| T+90min | ~75% complete | ~127,000 IDs processed |
| T+120min | 100% complete | All workers show "COMPLETE!" |
| T+125min | Validation | Run validation queries above |
| T+130min | Integration | Update `vw_resolutions_truth` view |

---

## Success Criteria

✅ **Backfill Complete When:**
- All 4 workers show "✅ WORKER N COMPLETE!"
- `SELECT COUNT(DISTINCT condition_id) FROM default.resolutions_external_ingest WHERE source='goldsky-api'` returns 120,000+
- No errors in final stats (or <1% error rate)
- `vw_resolutions_truth` successfully unions new data

✅ **P&L Impact:**
- Settled P&L coverage increases from current baseline
- No NULL payout vectors for resolved markets
- Wallet P&L calculations include redemption values

---

**Ready to execute!** Start with Quick Start section above.
