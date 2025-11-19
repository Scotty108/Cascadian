# Global Ghost Wallet Ingestion - Operator Guide

**Date:** 2025-11-16T04:35:00Z
**Agent:** C2 - External Data Ingestion
**Script:** `scripts/222-batch-ingest-global-ghost-wallets.ts`

---

## Quick Start

### Safe Mode (Default - Recommended for first runs)

```bash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts
```

**Settings:**
- Batch size: 500 wallets
- Max concurrency: 4 concurrent requests
- Wallet delay: 50ms
- Batch delay: 2000ms (2 seconds)
- **Estimated throughput:** ~200 wallets/minute
- **Estimated total time:** ~64 minutes for 12,717 wallets

**Best for:**
- Initial runs
- Conservative API usage
- When rate limits are a concern

---

### Fast Mode (Aggressive but still respectful)

```bash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --mode fast
```

**Settings:**
- Batch size: 1000 wallets
- Max concurrency: 16 concurrent requests
- Wallet delay: 0ms
- Batch delay: 1000ms (1 second)
- **Estimated throughput:** ~800-1000 wallets/minute
- **Estimated total time:** ~13-16 minutes for 12,717 wallets

**Best for:**
- Subsequent runs when you know the API can handle it
- When speed is important
- When API has proven stable under higher load

**⚠️ Warning:** Monitor for HTTP 429 (rate limit) errors. The script will automatically retry, but if you see many 429s, consider reducing concurrency.

---

### Custom Mode (Fine-tuned control)

```bash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts \
  --max-concurrency 12 \
  --batch-size 800 \
  --wallet-delay-ms 25 \
  --batch-delay-ms 1500
```

**Settings:**
- You control all parameters individually
- Mix and match for optimal performance
- Override individual settings while keeping others at default

**Example scenarios:**

**Medium speed:**
```bash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 8 --batch-size 750
```

**High concurrency, smaller batches:**
```bash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 20 --batch-size 500
```

**Large batches, lower concurrency:**
```bash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 6 --batch-size 1500
```

---

## Performance Flags Reference

| Flag | Description | Default (Safe) | Fast Mode | Range |
|------|-------------|----------------|-----------|-------|
| `--mode` | Preset mode (safe/fast) | safe | fast | safe, fast |
| `--max-concurrency` | Concurrent wallet requests | 4 | 16 | 1-32 |
| `--batch-size` | Wallets per batch | 500 | 1000 | 100-2000 |
| `--wallet-delay-ms` | Delay between wallet requests | 50ms | 0ms | 0-1000ms |
| `--batch-delay-ms` | Delay between batches | 2000ms | 1000ms | 0-5000ms |

**Note:** `--mode` sets all values. Individual flags override the mode preset.

---

## Crash Protection & Resumability

### How it works

The script is **fully crash-protected** and **resumable**:

1. **Checkpoints after each batch:** Progress saved to `global_ghost_ingestion_checkpoints` table
2. **Automatic resume:** Restarts from last completed batch
3. **Change settings on resume:** Can adjust performance flags mid-run
4. **Status tracking:** Real-time progress in `C2_GLOBAL_EXTERNAL_INGESTION_STATUS.md`

### Resuming after a crash or stop

**Same settings:**
```bash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --mode fast
```

**Different settings (e.g., speed up mid-run):**
```bash
# First run (safe mode)
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts

# Kill it after a few batches (Ctrl+C)

# Resume with fast mode
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --mode fast
```

**The script will:**
- ✅ Load last completed batch number from checkpoints
- ✅ Skip all previously completed batches
- ✅ Continue from where it left off
- ✅ Use NEW performance settings for remaining batches

---

## Monitoring Progress

### Real-time log

```bash
# Follow live log
tail -f /tmp/global-ghost-ingestion.log

# Or use the background job output
# (if run in background with `&` or `2>&1 | tee`)
```

### Status markdown

```bash
# View current status
cat C2_GLOBAL_EXTERNAL_INGESTION_STATUS.md

# Watch it update (refreshes after each batch)
watch -n 5 cat C2_GLOBAL_EXTERNAL_INGESTION_STATUS.md
```

**Status shows:**
- Progress (wallets processed, batches completed)
- Performance configuration used
- Estimated time remaining
- Per-batch details (trades, shares, value)

### Database checkpoints

```sql
-- Query checkpoints table directly
SELECT * FROM global_ghost_ingestion_checkpoints ORDER BY batch_number DESC LIMIT 10;

-- Check current progress
SELECT
  MAX(batch_number) as last_batch,
  COUNT(*) as total_batches_run,
  SUM(wallets_processed) as wallets_done,
  SUM(trades_inserted) as trades_inserted
FROM global_ghost_ingestion_checkpoints
WHERE status = 'completed';
```

---

## Performance Tuning Guide

### Starting conservative (recommended)

1. **First run:** Use safe mode
2. **Monitor logs:** Check for rate limits (HTTP 429)
3. **If no 429s:** Gradually increase concurrency

```bash
# Run 1: Safe mode (establish baseline)
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts

# After 2-3 batches, kill it (Ctrl+C)

# Run 2: Medium speed
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 8 --batch-size 750

# After 2-3 batches, if still no 429s, kill it

# Run 3: Fast mode
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --mode fast
```

### Handling rate limits (HTTP 429)

If you see `⏳ Rate limited, waiting 5 seconds...`:

1. **Occasional 429s (1-2 per batch):** Normal, script handles it automatically
2. **Frequent 429s (10+ per batch):** Reduce concurrency

```bash
# Reduce concurrency mid-run
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 6
```

### Optimal settings discovery

**Formula:**
- Start with: `concurrency = 4, batch_size = 500`
- Double concurrency each run until you see 429s
- Back off by 25% from the 429 threshold
- That's your optimal concurrency

**Example:**
- Run 1: `--max-concurrency 4` → No 429s
- Run 2: `--max-concurrency 8` → No 429s
- Run 3: `--max-concurrency 16` → Few 429s
- Run 4: `--max-concurrency 12` → **OPTIMAL** (no 429s, high speed)

---

## Error Handling

### Automatic retry on 429

```
⏳ Rate limited, waiting 5 seconds...
```

**What it means:** Polymarket API is rate limiting
**What happens:** Script waits 5 seconds and retries once
**Action:** None needed (automatic)

### Timeout after 30 seconds

```
⏱️  Timeout after 30000ms - skipping wallet
```

**What it means:** Wallet query took too long
**What happens:** Skip wallet, continue with others
**Action:** None needed (wallet skipped, data may be incomplete for that wallet)

### HTTP errors (500, 503)

```
✗ 0x1234... → HTTP 500: Internal Server Error
```

**What it means:** API server error
**What happens:** Skip wallet, continue with others
**Action:** Check if persistent. If many wallets fail, pause and retry later.

### Batch failure

```
❌ Batch 5 failed: [error message]
⚠️  Batch failed but progress saved. You can resume from next batch.
```

**What it means:** Entire batch failed (rare)
**What happens:** Progress saved, script moves to next batch
**Action:** Review logs. Resume script when ready.

---

## Best Practices

### 1. Start conservatively

Always start with safe mode for new markets or after API changes.

### 2. Monitor first few batches

Don't set-and-forget. Watch the first 2-3 batches for:
- Rate limit errors (429)
- Timeouts
- Other HTTP errors

### 3. Adjust based on observations

- **No 429s after 3 batches:** Increase concurrency
- **Many 429s:** Decrease concurrency
- **Many timeouts:** Reduce concurrency or increase timeout

### 4. Use checkpoints strategically

- Kill script after validating a few batches work
- Resume with higher concurrency if API handles it well
- Resume with lower concurrency if seeing issues

### 5. Document your settings

For large runs, note the settings used:

```bash
# Example
echo "Run started: $(date)" >> ingestion-runs.log
echo "Mode: fast (concurrency=16, batch=1000)" >> ingestion-runs.log
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --mode fast
```

---

## Troubleshooting

### Script won't start

**Error:** `global_ghost_wallets_all table not found`

**Fix:** Run wallet discovery first:
```bash
npx tsx scripts/219-batch-discover-ghost-wallets.ts
```

### Progress seems stuck

**Check:** Is the script still running?
```bash
ps aux | grep 222-batch-ingest
```

**Check logs:**
```bash
tail -50 /tmp/global-ghost-ingestion.log
```

### Checkpoints not resuming

**Verify checkpoints exist:**
```sql
SELECT COUNT(*) FROM global_ghost_ingestion_checkpoints WHERE status = 'completed';
```

**If 0 rows:** Checkpoints were never saved (script crashed before first batch completed)

**Solution:** Restart from beginning

### Want to restart from scratch

**Clear checkpoints:**
```sql
TRUNCATE TABLE global_ghost_ingestion_checkpoints;
```

**Or drop and recreate:**
```sql
DROP TABLE IF EXISTS global_ghost_ingestion_checkpoints;
-- Script will recreate on next run
```

---

## Advanced Usage

### Parallel runs (NOT recommended)

While possible to run multiple instances with different wallet sets, **NOT recommended** because:
- Shared checkpoint table will conflict
- Risk of duplicate insertions
- Better to use higher concurrency in single run

### Custom checkpoint table

If you need isolated runs, modify script to use different checkpoint table:

```typescript
// In script, change:
const CHECKPOINT_TABLE = 'global_ghost_ingestion_checkpoints_custom';
```

### Performance benchmarking

To find optimal settings for YOUR API access:

```bash
# Test 1: Concurrency = 4
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 4 --batch-size 100

# Test 2: Concurrency = 8
TRUNCATE TABLE global_ghost_ingestion_checkpoints;  # Reset
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 8 --batch-size 100

# Test 3: Concurrency = 16
TRUNCATE TABLE global_ghost_ingestion_checkpoints;  # Reset
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 16 --batch-size 100

# Compare throughput and errors
```

---

## Summary

**For most users:**
- First run: Use `--mode safe` (default)
- Watch for 429s in logs
- If none after 5 batches, resume with `--mode fast`

**Command cheat sheet:**
```bash
# Safe (default)
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts

# Fast
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --mode fast

# Resume after crash
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --mode fast

# Custom
npx tsx scripts/222-batch-ingest-global-ghost-wallets.ts --max-concurrency 12 --batch-size 800
```

**Remember:**
- Progress is always saved (crash-protected)
- Can change settings on resume
- Monitor logs for rate limits
- Start conservative, speed up if API handles it

---

**— C2 (External Data Ingestion Agent)**

_Performance tuning complete. Ready for operator-controlled high-throughput ingestion._
