# Operational Guide - Parallel Backfill Live

**Status**: LIVE - 8 workers, monitor, gates, on-complete hook running
**Started**: 2025-11-05 23:47 UTC
**Expected Completion**: 3-7 hours

---

## Health Checks (Every 15 Minutes)

### Query 1: Backfill Progress
```sql
SELECT
  countIf(status='COMPLETE') AS days_done,
  max(day_idx) AS max_day,
  round(100.0 * countIf(status='COMPLETE') / 1048, 1) AS progress_pct
FROM backfill_checkpoint;
```

**Expected**: Steady increase (0 → 1048 over 2-5 hours)
**Red flags**: No change for >30 min on all workers

---

### Query 2: Worker Heartbeats
```sql
SELECT
  worker_id,
  last_batch,
  dateDiff('minute', updated_at, now()) AS mins_ago
FROM worker_heartbeats
ORDER BY worker_id;
```

**Expected**: All 8 workers with mins_ago < 5
**Red flags**: Any worker mins_ago > 5 (stalled, monitor will restart)

---

### Query 3: Deduplication Sanity
```sql
SELECT
  count() AS rows,
  uniqExact(tuple(tx_hash, log_index)) AS uniq_rows,
  rows - uniq_rows AS duplicates
FROM erc20_transfers_staging FINAL;
```

**Expected**: duplicates = 0 (ReplacingMergeTree deduped)
**Red flags**: duplicates > 0 (run OPTIMIZE FINAL)

---

## Contingency Playbook

### Issue: Worker Stalled (>5 min no heartbeat)

**Auto-recovery**: Monitor will kill and relaunch automatically
**Manual check**:
```bash
tail -f data/backfill/worker-N.log  # Check for errors
ps aux | grep "SHARD_ID=N" # Verify process exists
```

**If repeats**: Lower batch size, raise shard count
```bash
# Scale to 12 shards (finer granularity per worker)
# Existing checkpoints prevent reprocessing
# ReplacingMergeTree prevents duplicates
SHARDS=12 ./scripts/launch-workers-nohup.sh
```

---

### Issue: Duplicates Growing

**Check**: Run dedup sanity query above
```sql
SELECT rows - uniq_rows AS duplicates
FROM erc20_transfers_staging FINAL;
```

**If duplicates > 0**:
```sql
OPTIMIZE TABLE erc20_transfers_staging FINAL;
```

**Then continue**: Restarting workers safe (checkpoint resume + ReplacingMergeTree)

---

### Issue: Gates Breach Thresholds

**Monitor**: Check `data/backfill/gates.log` every 30 min
```bash
tail -f data/backfill/gates.log
```

**If gates fail**:
1. Check output for which gate failed
2. Query last 10 completed days:
   ```sql
   SELECT day_idx, erc20_count, erc1155_count
   FROM backfill_checkpoint
   WHERE status='COMPLETE'
   ORDER BY day_idx DESC
   LIMIT 10;
   ```
3. Pause scaling until diagnosed
4. Check worker logs for RPC errors

**Expected**: Relaxed thresholds during backfill (60%/80%). Strict (2%/95%) applied after rebuild.

---

### Issue: RPC Throttling (429 Errors in Worker Logs)

**Current**: Single RPC with retry + backoff
**If throughput low**: Add RPC redundancy

**Round-robin multiple RPCs**:
```bash
# Update scripts/step3-streaming-backfill-parallel.ts
# to rotate between RPC URLs on 429 or timeout
export ETHEREUM_RPC_URLS="url1,url2,url3"
# Implement round-robin in getLogs() helper
```

**Or scale to lower per-worker load**:
```bash
SHARDS=12 ./scripts/launch-workers-nohup.sh
# Each worker processes ~87 days instead of 131
# Lower RPC pressure per worker
```

---

### Issue: Disk Pressure in ClickHouse

**If tables fill disk**: Move staging to dedicated volume
```sql
ALTER TABLE erc20_transfers_staging SET TTL created_at + INTERVAL 7 DAY;
ALTER TABLE erc1155_transfers_staging SET TTL created_at + INTERVAL 7 DAY;
```

Then resume workers.

---

## Scaling Safely

**Add workers without data risk**:
```bash
# Current: 8 workers
# Scale to: 12 workers (or any N)
SHARDS=12 ./scripts/launch-workers-nohup.sh
```

**Why safe**:
- New workers read same SHARDS=12 from env
- Day assignment: `day_idx % 12 == SHARD_ID`
- Checkpoints prevent reprocessing completed days
- ReplacingMergeTree prevents duplicates if any overlap

---

## Monitoring Commands

### Real-Time Progress
```bash
# Watch monitor (every 30 sec)
tail -f data/backfill/monitor.log

# Watch worker 0 (most active)
tail -f data/backfill/worker-0.log

# Watch gates (every 30 min)
tail -f data/backfill/gates.log

# Watch rebuild (when complete)
tail -f data/backfill/on-complete.log
```

### Quick Status
```bash
# All worker logs
ls -lh data/backfill/worker-*.log

# Errors across all workers
grep -h "❌\|Error" data/backfill/worker-*.log | tail -20

# Active processes
ps aux | grep -E "step3|monitor|gates|on-complete" | grep -v grep
```

---

## Rebuild Phase (Auto-Execute)

When checkpoint reaches 1,048 days, `on-complete-rebuild.sh` runs:

```
Step 1: compute net flows on full dataset
Step 2: hard-gate-validator (MUST EXIT 0)
Step 3: rebuild PnL against winning_index
Step 4: generate coverage snapshot
Output: data/post_rebuild_snapshot_<timestamp>.json
```

**If hard gate fails**:
- Stops before any table swaps
- Review diagnostic output
- Fix data issues (if any)
- Re-run hard-gate-validator

**If rebuild succeeds**:
- Check coverage snapshot: `data/post_rebuild_snapshot_*.json`
- Verify: ~170k resolved markets, correct direction, PnL 40-50% win rate
- Ready for production handoff

---

## Expected End State

**Transfers**:
- Full 1,048 days backfilled
- No duplicates (ReplacingMergeTree dedup)
- ~500k-1M total transfers (ERC20 + ERC1155)

**Resolutions**:
- ~170k markets with resolution vectors
- All binary (one-hot validated)

**Direction**:
- All trades assigned from net flows
- HIGH confidence ≥ 95% of volume
- No reliance on trades_raw.side label

**PnL**:
- Rebuilt using winning_index from market_resolutions_final
- Win rate 40-50%
- Total P&L computed across all wallets

**Coverage**:
- Wallets traded: TBD (query canonical trades)
- Markets resolved: ~170k
- Trades with direction: All
- PnL stats: Snapshot in JSON

---

## Abort Decision Tree

```
Backfill stalled for >30 min on all workers?
  → Check RPC connectivity, restart backfill

Duplicate count growing?
  → Run OPTIMIZE FINAL, check logs

Gates breaching thresholds?
  → Check last 10 days, diagnose RPC/data quality

Hard gate fails at rebuild?
  → Stop before swap, investigate, re-run

Disk pressure on ClickHouse?
  → Set TTLs, move staging, resume
```

**Otherwise**: Continue monitoring. System is safe and recoverable.

---

## Timeline Estimate

| Event | ETA |
|-------|-----|
| T+30 min | 200-300 days done (if RPC fast) |
| T+1 hour | 400-600 days done |
| T+2 hours | 700+ days done |
| T+3 hours | Backfill complete (if RPC steady) |
| T+4 hours | Rebuild complete (if gates pass) |
| T+5 hours | Coverage snapshot ready |

**If RPC throttled**: Add 1-2 hours to estimate.

---

## You're Ready

All systems online:
- 8 workers ingesting data
- Monitor detecting stalls
- Gates validating gates
- Hook waiting to rebuild

Check health every 15 min. Ready to scale, troubleshoot, or abort safely.

