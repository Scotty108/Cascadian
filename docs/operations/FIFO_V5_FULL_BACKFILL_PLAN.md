# FIFO V5 Full Backfill Plan - All Wallets Overnight

## Executive Summary

**Goal:** Process TRUE FIFO (First-In-First-Out) cost-basis tracking for ALL wallets in the database

**Strategy:** Batch processing (100 wallets at a time) using proven approach from active wallets script

**Expected Runtime:** 8-12 hours overnight for ~500,000 wallets

**Output:** Complete pm_trade_fifo_roi_v3 table with both resolved + closed positions

---

## Why This Approach Works

### ✅ Proven Performance
- Current script (2-day active wallets) running at **2,600 wallets/min**
- Each 100-wallet batch completes in **1.6-2.9 seconds**
- No timeouts, no memory errors
- Scales linearly with wallet count

### ✅ Avoids Previous Failures
- ❌ One wallet at a time: 64+ hours (too slow)
- ❌ Large IN clauses (10k wallets): max_query_size exceeded
- ❌ Monthly partitioning: timeout on window functions
- ❌ Temp table JOIN: SQL identifier resolution errors
- ✅ **100-wallet batches with IN clause: PERFECT**

### ✅ TRUE FIFO Logic
- Per-trade buy/sell matching using window functions
- Processes ENTIRE wallet history (not just recent activity)
- Handles both:
  - **RESOLVED positions:** Market resolved, PnL finalized
  - **CLOSED positions:** Fully exited, market NOT resolved yet

---

## Technical Architecture

### Data Flow
```
pm_canonical_fills_v4_deduped (940M rows)
    ↓
Get ALL distinct wallets (~500k)
    ↓
Batch into groups of 100 wallets
    ↓
For each batch:
  - Filter fills for those 100 wallets
  - Apply FIFO window function logic
  - Insert into pm_trade_fifo_roi_v3
    ↓
pm_trade_fifo_roi_v3 (6-10M rows)
    ↓
Query via pm_trade_fifo_roi_v3_deduped
```

### FIFO Window Function Logic

**Core Calculation:**
```sql
-- Match sells to buys chronologically (FIFO)
least(buy.tokens, greatest(0,
  coalesce(sells.total_tokens_sold, 0) -
  coalesce(sum(buy.tokens) OVER (
    PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
    ORDER BY buy.entry_time
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
  ), 0)
)) as tokens_sold_early
```

**What this does:**
1. For each buy, calculate cumulative tokens bought before it
2. Match total sells to buys in chronological order
3. Determine how many tokens from THIS buy were sold early
4. Calculate PnL based on actual sell prices (not avg)

---

## Implementation Script

### File: `scripts/build-fifo-v5-full-backfill.ts`

**Key Modifications from Active Wallets Script:**

```typescript
// CHANGE 1: Get ALL wallets (no date filter)
async function getAllWallets(): Promise<string[]> {
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4_deduped
      WHERE source = 'clob'
      ORDER BY wallet
    `,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 600,
      max_memory_usage: 8000000000,
      max_threads: 8,
    },
  });

  const rows = await result.json() as { wallet: string }[];
  return rows.map(r => r.wallet);
}

// CHANGE 2: Use ALL wallets (no activity filtering)
const wallets = await getAllWallets();

// CHANGE 3: Same batch processing (100 wallets per batch)
const BATCH_SIZE = 100;
```

**Rest of the logic:** IDENTICAL to current working script

---

## Execution Plan

### Pre-Flight Checklist

**1. Verify current backfill is complete**
```bash
# Check active wallets script status
tail -20 /private/tmp/claude/-Users-scotty-Projects-Cascadian-app/tasks/b6fd17c.output
```

**2. Clear existing FIFO V5 data (if needed)**
```sql
-- Only run if starting fresh
TRUNCATE TABLE pm_trade_fifo_roi_v3;
```

**3. Verify table structure**
```sql
DESCRIBE pm_trade_fifo_roi_v3;
-- Should have: is_closed, is_short columns
```

### Execution Steps

**Step 1: Create full backfill script**
```bash
cp scripts/build-fifo-v5-batch.ts scripts/build-fifo-v5-full-backfill.ts
```

**Step 2: Modify script** (see Implementation Script section)

**Step 3: Add checkpoint/resume capability**
```typescript
// Add to script for overnight safety
const CHECKPOINT_FILE = '/tmp/fifo-v5-full-checkpoint.json';

interface Checkpoint {
  completedBatches: number[];
  lastBatch: number;
  totalRows: number;
  startedAt: string;
}

function loadCheckpoint(): Checkpoint { /* ... */ }
function saveCheckpoint(checkpoint: Checkpoint) { /* ... */ }
```

**Step 4: Run in tmux/screen for safety**
```bash
# Start tmux session
tmux new -s fifo-v5-full

# Inside tmux
npx tsx scripts/build-fifo-v5-full-backfill.ts 2>&1 | tee /tmp/fifo-v5-full.log

# Detach: Ctrl+B then D
# Reattach: tmux attach -t fifo-v5-full
```

**Step 5: Monitor progress**
```bash
# Check progress every 30 min
tail -50 /tmp/fifo-v5-full.log

# Or query database directly
SELECT count() as total_rows FROM pm_trade_fifo_roi_v3;
```

---

## Expected Timeline

### Assumptions
- **Total wallets:** ~500,000
- **Processing rate:** 2,600 wallets/min (proven from active script)
- **Batch size:** 100 wallets
- **Total batches:** 5,000

### Time Estimates

| Phase | Duration | Details |
|-------|----------|---------|
| Find all wallets | 5-10 min | One-time scan of pm_canonical_fills_v4_deduped |
| Process batches (5,000) | 8-10 hours | 2,600 wallets/min = ~192 min per 500k wallets |
| Final stats/cleanup | 5 min | Count rows, report results |
| **TOTAL** | **8-12 hours** | Run overnight, complete by morning |

### Batch Breakdown
```
500,000 wallets ÷ 100 per batch = 5,000 batches
5,000 batches × 2.2 sec per batch = 11,000 sec = 3 hours (minimum)
Add overhead for network, retries, etc. = 8-12 hours (realistic)
```

---

## ClickHouse Settings

### Per-Batch Query Settings
```typescript
clickhouse_settings: {
  max_execution_time: 1800,        // 30 min per batch (safety)
  max_memory_usage: 15000000000,   // 15GB
  max_threads: 8,                  // Full parallelism
  optimize_read_in_window_order: 1, // CRITICAL for window functions
  query_plan_enable_optimizations: 1,
}
```

### Why These Settings Work
- **30 min timeout:** Plenty of headroom (actual: 2-3 sec)
- **15GB memory:** Window functions need memory for sorting
- **8 threads:** Utilize full CPU for parallel window computation
- **optimize_read_in_window_order:** Avoids unnecessary sorts

---

## Error Handling & Recovery

### Automatic Retry Strategy
```typescript
async function processBatchWithRetry(wallets: string[], maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await processBatch(wallets);
    } catch (error: any) {
      if (attempt === maxRetries) throw error;

      // Wait before retry (exponential backoff)
      await sleep(Math.min(1000 * Math.pow(2, attempt), 30000));
      console.log(`  Retry ${attempt}/${maxRetries} for batch...`);
    }
  }
}
```

### Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `read ETIMEDOUT` | Network hiccup | Retry (automatic) |
| `Max query size exceeded` | Batch too large | Reduce BATCH_SIZE to 50 |
| `Timeout exceeded` | Window function slow | Increase max_execution_time |
| `Memory limit exceeded` | Large wallet history | Increase max_memory_usage to 20GB |

### Resume from Checkpoint
```bash
# If script fails partway through
# Check checkpoint
cat /tmp/fifo-v5-full-checkpoint.json

# Script will auto-resume from last completed batch
npx tsx scripts/build-fifo-v5-full-backfill.ts
```

---

## Validation After Completion

### 1. Count Total Rows
```sql
SELECT
  count() as total_rows,
  countIf(is_closed = 0) as resolved_rows,
  countIf(is_closed = 1) as closed_rows
FROM pm_trade_fifo_roi_v3;
```

**Expected:**
- Total rows: 6-10 million
- Resolved: 5-8 million (majority)
- Closed: 1-2 million

### 2. Check Wallet Coverage
```sql
SELECT count(DISTINCT wallet) as unique_wallets
FROM pm_trade_fifo_roi_v3;
```

**Expected:** ~500,000 wallets (or whatever getAllWallets() returned)

### 3. Verify PnL Sanity
```sql
SELECT
  round(sum(pnl_usd), 0) as total_pnl,
  round(avg(pnl_usd), 2) as avg_pnl_per_position,
  min(pnl_usd) as min_pnl,
  max(pnl_usd) as max_pnl
FROM pm_trade_fifo_roi_v3;
```

**Sanity checks:**
- Total PnL should be negative (market-wide losses to fees/spreads)
- Avg PnL per position: -$5 to +$20 (typical range)
- Max PnL: Should see some $50k+ wins

### 4. Test Leaderboard Query Performance
```sql
SELECT
  wallet,
  sum(pnl_usd) as total_pnl,
  count() as num_positions,
  round(avg(roi) * 100, 1) as avg_roi_pct
FROM pm_trade_fifo_roi_v3_deduped
GROUP BY wallet
ORDER BY total_pnl DESC
LIMIT 100;
```

**Expected:** Query completes in <5 seconds

### 5. Spot-Check Known Wallets
```sql
-- Check FuelHydrantBoss (known test wallet)
SELECT
  count() as positions,
  round(sum(pnl_usd), 0) as total_pnl
FROM pm_trade_fifo_roi_v3_deduped
WHERE wallet = '0x94a4f1e3eb49a66a20372d98af9988be73bb55c4';
```

**Compare with:** Polymarket API or previous V1 engine results

---

## Optimizations for Future Runs

### Incremental Updates (After Initial Backfill)

**Strategy:** Only process NEW wallets or wallets with new activity

```sql
-- Find wallets active since last backfill
SELECT DISTINCT wallet
FROM pm_canonical_fills_v4
WHERE event_time >= (SELECT max(resolved_at) FROM pm_trade_fifo_roi_v3)
  AND source = 'clob';
```

### Parallel Processing (Advanced)

**For faster completion (4-6 hours instead of 8-12):**

1. Split wallets into 4 groups by first character
2. Run 4 parallel scripts in separate tmux sessions
3. Each processes ~125k wallets

```bash
# Terminal 1
npx tsx scripts/build-fifo-v5-full-backfill.ts --prefix=0-3

# Terminal 2
npx tsx scripts/build-fifo-v5-full-backfill.ts --prefix=4-7

# Terminal 3
npx tsx scripts/build-fifo-v5-full-backfill.ts --prefix=8-b

# Terminal 4
npx tsx scripts/build-fifo-v5-full-backfill.ts --prefix=c-f
```

---

## Final Checklist

### Before Starting Overnight Run

- [ ] Current active wallets backfill is complete
- [ ] `build-fifo-v5-full-backfill.ts` script created and tested on 1000 wallets
- [ ] Checkpoint/resume logic added
- [ ] tmux/screen session started
- [ ] Output logging to file (`tee /tmp/fifo-v5-full.log`)
- [ ] Verified ClickHouse has sufficient resources (check Cloud dashboard)
- [ ] Set calendar reminder to check progress in morning

### After Completion

- [ ] Validation queries all pass (see Validation section)
- [ ] Leaderboard query performance <5s
- [ ] Test wallets show correct PnL
- [ ] Update cron jobs to use new table
- [ ] Document final row counts in this file
- [ ] Archive checkpoint file for reference

---

## Contact & Support

**If script fails overnight:**

1. Check `/tmp/fifo-v5-full.log` for errors
2. Check `/tmp/fifo-v5-full-checkpoint.json` for progress
3. Restart script (will auto-resume from checkpoint)
4. If persistent errors, reduce BATCH_SIZE from 100 to 50

**Expected final state:**
- pm_trade_fifo_roi_v3: 6-10M rows
- Leaderboards query via pm_trade_fifo_roi_v3_deduped
- Completes in 8-12 hours overnight

---

## Appendix: Full Script Template

See `scripts/build-fifo-v5-full-backfill.ts` for complete implementation.

**Key differences from active wallets script:**
1. `getAllWallets()` instead of `getActiveWallets()`
2. No date filtering in wallet discovery
3. Same batch size (100), same FIFO logic
4. Added checkpoint/resume capability
5. Better error handling with retries

---

**Last Updated:** January 27, 2026
**Status:** Ready for overnight execution
**Estimated Completion:** 8-12 hours
