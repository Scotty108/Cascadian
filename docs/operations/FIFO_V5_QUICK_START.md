# FIFO V5 Full Backfill - Quick Start Guide

## TL;DR - Run Tonight in 3 Steps

```bash
# 1. Start tmux session (safe for overnight)
tmux new -s fifo-v5-full

# 2. Run the script (will take 8-12 hours)
npx tsx scripts/build-fifo-v5-full-backfill.ts 2>&1 | tee /tmp/fifo-v5-full.log

# 3. Detach and let it run overnight
# Press: Ctrl+B then D
```

**Check progress tomorrow:**
```bash
# Reattach to session
tmux attach -t fifo-v5-full

# Or just check log
tail -50 /tmp/fifo-v5-full.log
```

---

## What This Does

- ✅ Processes **ALL 500k wallets** in database
- ✅ TRUE FIFO matching (per-trade buy/sell chronology)
- ✅ Includes both resolved + closed positions
- ✅ Auto-resumes if interrupted (checkpoint system)
- ✅ Proven approach (2,600 wallets/min rate from current run)

---

## Expected Results

**Runtime:** 8-12 hours

**Output Table:** `pm_trade_fifo_roi_v3`
- Total rows: 6-10 million
- Resolved positions: 5-8M
- Closed positions: 1-2M

**Query via:** `pm_trade_fifo_roi_v3_deduped` (already exists)

---

## Monitoring

### Check Progress (Without Interrupting)
```bash
tail -50 /tmp/fifo-v5-full.log
```

### Check Database Directly
```sql
-- Current row count
SELECT count() FROM pm_trade_fifo_roi_v3;

-- Current closed positions count
SELECT countIf(is_closed = 1) FROM pm_trade_fifo_roi_v3;
```

### Resume If Interrupted
The script has built-in checkpoint/resume:
```bash
# Just run it again - it will auto-resume
npx tsx scripts/build-fifo-v5-full-backfill.ts 2>&1 | tee -a /tmp/fifo-v5-full.log
```

---

## Validation After Completion

```sql
-- 1. Check total rows
SELECT count() as total_rows FROM pm_trade_fifo_roi_v3;
-- Expected: 6-10 million

-- 2. Check wallet coverage
SELECT count(DISTINCT wallet) FROM pm_trade_fifo_roi_v3;
-- Expected: ~500,000

-- 3. Test leaderboard query (should be <5s)
SELECT wallet, sum(pnl_usd) as total_pnl
FROM pm_trade_fifo_roi_v3_deduped
GROUP BY wallet
ORDER BY total_pnl DESC
LIMIT 100;
```

---

## If Something Goes Wrong

### Script hangs on one batch
- Wait 30 minutes (max_execution_time)
- Script will auto-retry 3 times then skip that batch

### Out of memory errors
```bash
# Edit the script, increase memory:
max_memory_usage: 20000000000, // 20GB instead of 15GB
```

### Network timeouts
- Script auto-retries with exponential backoff
- Checkpoint saves progress every 10 batches

### Need to reduce batch size
```bash
# Edit scripts/build-fifo-v5-full-backfill.ts line 14:
const BATCH_SIZE = 50; // instead of 100
```

---

## Full Documentation

See: `docs/operations/FIFO_V5_FULL_BACKFILL_PLAN.md` for complete technical details.

---

**Ready to run?** Just copy the 3 commands from the top and let it run overnight!
