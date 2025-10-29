# 10-Worker Parallel Load - Launch Guide

## Safety Features ✅

**Auto-Checkpointing:**
- Saves progress after EVERY wallet
- If worker crashes, restart from last completed wallet
- Files: `runtime/parallel-loads/worker_N.checkpoint.json`

**Error Handling with Exponential Backoff:**
- 3 retry attempts per API call
- Backs off 2s → 4s → 8s on errors
- Auto-pauses 30s if 5 consecutive errors
- Detects 522/503/429 rate limit errors and backs off

**Worker Isolation:**
- Each worker processes separate wallet chunk
- No data conflicts between workers
- Can kill/restart individual workers

## Timeline & Data Availability

### Hour 0-3: Trade Loading (THIS STEP - 10 workers)
**Status:**
- Trades insert to ClickHouse as each wallet completes ✅
- You CAN query raw trades: `SELECT * FROM trades_raw WHERE wallet_address = '0x...'`
- Leaderboard metrics NOT available yet ❌

**Why?** Metrics require enrichment + calculation across all trades.

### Hour 3.0-3.1: Auto-Enrichment (~5 min)
- Adds market_id, categories, events, tags
- Triggered automatically when all workers complete

### Hour 3.1-3.2: Metrics Computation (~10 min)
- Computes omega scores, P&L, win rates
- Computes per-category breakdowns
- Populates `wallet_metrics_complete` and `wallet_metrics_by_category`

### Hour 3.2+: Leaderboard LIVE! 🎉
- All 28,006 wallets with full metrics
- Overall + per-category leaderboards ready
- Politics/Crypto/Sports specialist detection working

## Pre-Flight Checklist

### 1. Apply Supabase Migration

**Via Dashboard (Recommended):**
1. Go to Supabase Dashboard → SQL Editor
2. Paste contents of: `supabase/migrations/20251029200000_batch_condition_market_lookup.sql`
3. Click "Run"

**What it does:**
- Creates `idx_markets_condition_id` index (fast lookups)
- Creates `resolve_condition_to_market_batch()` RPC function
- Adds indexes for notifications & strategies (bonus optimization)

### 2. Verify Supabase is Ready

```bash
# Check if database is responsive
npx tsx scripts/apply-batch-migration.ts
```

Should show "Supabase is reachable" (ignore the error about applying - we'll do via dashboard)

## Launch Commands

### Start 10 Workers

```bash
# Kill any old workers first
pkill -f "goldsky-load-recent-trades"

# Start fresh 10-worker parallel load
bash scripts/parallel-goldsky-load.sh > runtime/parallel-launch.log 2>&1 &

# Wait 10 seconds for workers to start
sleep 10

# Check workers launched
ps aux | grep goldsky-load-recent-trades | grep -v grep | wc -l
# Should show 30 (10 workers × 3 processes each)
```

### Monitor Progress

```bash
# Watch worker 1 progress
tail -f runtime/parallel-loads/worker_1.log

# Check all workers
for i in {1..10}; do
  echo "Worker $i:"
  grep -oE '\[[0-9]+/[0-9]+\]' runtime/parallel-loads/worker_$i.log 2>/dev/null | tail -1
done

# Count total wallets completed across all workers
grep "✅ Inserted successfully" runtime/parallel-loads/worker_*.log | wc -l
```

### Monitor Database Metrics (from your memo)

**Supabase Dashboard → Reports → Database:**
- CPU usage < 70% (MICRO target)
- Active connections < 24 (80% of 30 max on MICRO)
- No "disk IO budget" warnings
- Zero 522 errors in logs

## What You'll See

**Per wallet log output:**
```
[23/2307] 1.0% - Processing wallet: 0xabc...
  📡 Fetching recent trades (max 5000)...
  ✅ Fetched 127 raw trade events
  🔄 Extracting token IDs for batch resolution...
  🚀 Batch resolving 45 unique tokens...
  ✅ Batch resolved in 89ms (505 tokens/sec)
  🔄 Extracting unique conditions for batch market resolution...
  🚀 Batch resolving 45 unique conditions to markets...
  ✅ Batch resolved in 52ms (865 conditions/sec)  <-- THE MAGIC!
  🔄 Transforming trades...
  ✅ Transformed 127/127 trades
  🔍 Checking for duplicates...
  ✅ Found 127 new trades, 0 duplicates
  📥 Inserting 127 new trades...
  ✅ Inserted successfully
```

**If you see backoff:**
```
  ⚠️  Rate limit detected (522), backing off...
  ⏸️  Backing off for 2.3s before retry (attempt 1)...
```
This is NORMAL - the error handling is working!

**If worker pauses:**
```
  🛑 Too many consecutive errors (5), pausing 30s...
```
Worker will auto-resume after cooldown.

## Troubleshooting

### Workers stuck at "Transforming trades..."
**Check:** Is batch migration applied?
```bash
# Test batch RPC
npx tsx << 'EOF'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data, error } = await supabase.rpc('resolve_condition_to_market_batch', { condition_ids: ['test'] })
console.log('RPC exists:', !error?.message?.includes('not find'))
EOF
```

### CPU or connections hitting limits
**Action:** Kill 2-3 workers to reduce load
```bash
# Kill workers 9 and 10
pkill -f "chunk_ai"
pkill -f "chunk_aj"
```
Remaining workers will continue, just take a bit longer.

### Database 522 errors
**Action:** Workers will auto-backoff. If persistent:
1. Check Supabase dashboard for resource saturation
2. Reduce to 6-8 workers
3. Consider upgrading to SMALL if this is ongoing

## After Completion

### Verify Data

```bash
# Check total enriched wallets
npx tsx << 'EOF'
import { clickhouse } from './lib/clickhouse/client'
const result = await clickhouse.query({
  query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw WHERE condition_id != \'\'',
  format: 'JSONEachRow'
})
const data = await result.json()
console.log('Enriched wallets:', data[0].count)
EOF
```

Should show ~28,006 wallets.

### Trigger Auto-Enrichment

The `auto-complete-pipeline.sh` should auto-trigger, but if not:

```bash
# Manual trigger
npx tsx scripts/nuclear-backfill-v2.ts  # Enrichment
npx tsx scripts/compute-wallet-metrics.ts  # Overall metrics
npx tsx scripts/compute-wallet-metrics-by-category.ts  # Category metrics
```

### Test Leaderboard

```bash
curl http://localhost:3000/api/omega/leaderboard | jq .
```

## Performance Expectations

**Per Wallet (with batching):**
- Fetch: 2-3 sec
- Batch token resolution: 0.2 sec ✅
- Batch condition resolution: 0.1 sec ✅
- Transform + Insert: 1-2 sec
- **Total: ~4-5 seconds**

**Total Time:**
- 23,069 wallets ÷ 10 workers = 2,307 per worker
- 2,307 × 4.5 sec = **~2.9 hours**
- **Expected completion: 2.5-3.5 hours**

## Launch NOW! 🚀

```bash
# 1. Apply migration in Supabase Dashboard SQL Editor
# 2. Then run:
pkill -f "goldsky-load-recent-trades" && \
bash scripts/parallel-goldsky-load.sh > runtime/launch-$(date +%H%M).log 2>&1 &
echo "✅ 10 workers launched! Monitor: tail -f runtime/parallel-loads/worker_1.log"
```
