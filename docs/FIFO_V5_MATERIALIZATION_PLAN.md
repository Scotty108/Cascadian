# FIFO V5 Materialization Plan

Complete plan for building and maintaining the deduplicated materialized table.

---

## Overview

**Problem:** `pm_trade_fifo_roi_v3` has 286M rows with 94M duplicates (from historical backfills)

**Solution:** Materialize deduplicated table with 192M unique tx_hashes

**Critical:** Deduplication by `tx_hash` (NOT by position) to preserve TRUE FIFO V5 logic

---

## Two-Phase Approach

### Phase 1: Recent Wallets (IMMEDIATE - 1.5 hours)

**Script:** `scripts/create-deduped-recent-final.ts`

**What it does:**
- Finds wallets active in last 2 days (~100k wallets)
- Materializes their FULL HISTORY (all time)
- ~millions of trades
- 100 modulo batches, ~45-50s each

**Run now:**
```bash
npx tsx scripts/create-deduped-recent-final.ts
```

**Result:** Table ready for immediate use with active wallets

### Phase 2: Full Backfill (OVERNIGHT - 2-3 hours)

**Script:** `scripts/create-deduped-full-overnight.ts`

**What it does:**
- Processes ALL 192M unique tx_hashes
- All wallets, all time (1,048 days)
- 200 modulo batches for memory safety
- Progress tracking every 10 batches

**Run tonight:**
```bash
# Run in background with logging
nohup npx tsx scripts/create-deduped-full-overnight.ts > /tmp/dedup-full.log 2>&1 &

# Monitor progress
tail -f /tmp/dedup-full.log
```

**Expected output:**
- Batch progress with ETA
- Row counts every 10 batches
- Final count: ~192M rows

---

## Technical Details

### Why Modulo Batching?

**Problem:** Binary tx_hash data has uneven distribution
- Character 's': 34.7M tx_hashes
- Character 'c': 8.5M tx_hashes
- Hex '0'-'f': Only 17M total (9% of data)

**Solution:** `cityHash64(tx_hash) % 200`
- Even distribution across all batches
- ~960k rows per batch
- Stays under 10GB memory limit

### FIFO V5 Logic Preservation

**Critical deduplication strategy:**
```sql
GROUP BY tx_hash  -- NOT (wallet, condition_id, outcome_index)!
```

**Why this matters:**
- One row per BUY TRANSACTION (tx_hash)
- Multiple rows per POSITION (wallet + market + outcome)
- Preserves early selling vs holding distinction

**Example:**
```
Position: Wallet A, Market X, Outcome 0
  Row 1: tx=0x111, 100 tokens, $10 PnL (bought at $0.45)
  Row 2: tx=0x222, 200 tokens, $20 PnL (bought at $0.50)
  Row 3: tx=0x333, 300 tokens, $30 PnL (bought at $0.52)

Total position PnL: $60
```

If we deduplicated by position, we'd lose per-trade FIFO logic!

### Memory Management

**ClickHouse Cloud Limits:**
- 10.8 GB memory per query
- Earlier attempt failed at 10.84 GB with full-table GROUP BY

**Solution:**
- Batch processing (200 batches)
- Each batch: ~1.4M rows = ~3-5 GB memory
- Safe margin under 10GB limit

---

## Table Schema

```sql
CREATE TABLE pm_trade_fifo_roi_v3_mat_deduped (
  tx_hash String,                    -- Unique buy transaction
  wallet LowCardinality(String),     -- Trader wallet
  condition_id String,               -- Market ID
  outcome_index UInt8,               -- 0/1 (YES/NO)
  entry_time DateTime,               -- Buy timestamp
  resolved_at DateTime,              -- Market resolution time
  cost_usd Float64,                  -- Buy cost (negative for SHORT)
  tokens Float64,                    -- Total tokens bought
  tokens_sold_early Float64,         -- Sold before resolution
  tokens_held Float64,               -- Held to resolution
  exit_value Float64,                -- Total exit value
  pnl_usd Float64,                   -- Realized PnL
  roi Float64,                       -- Return on investment
  pct_sold_early Float64,            -- % sold early (0-1)
  is_maker UInt8,                    -- 1=maker, 0=taker
  is_short UInt8                     -- 1=SHORT, 0=LONG
) ENGINE = MergeTree()
ORDER BY (wallet, condition_id, outcome_index, tx_hash)
SETTINGS index_granularity = 8192
```

---

## Verification Queries

### Check row count
```sql
SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped
-- Expected: ~192M
```

### Verify no duplicates
```sql
SELECT
  count() as total_rows,
  uniq(tx_hash) as unique_txhashes,
  count() - uniq(tx_hash) as duplicates
FROM pm_trade_fifo_roi_v3_mat_deduped
-- Duplicates should be 0
```

### Check FIFO V5 logic preservation
```sql
-- Example: wallet with multiple buys in same position
SELECT
  tx_hash,
  tokens,
  tokens_sold_early,
  tokens_held,
  pnl_usd,
  roi
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
  AND condition_id = '0x...'
  AND outcome_index = 0
ORDER BY entry_time
-- Should show multiple rows (one per buy tx)
```

### Compare with source table
```sql
SELECT
  'Source' as table_name,
  count() as rows,
  uniq(tx_hash) as unique_tx
FROM pm_trade_fifo_roi_v3

UNION ALL

SELECT
  'Materialized' as table_name,
  count() as rows,
  uniq(tx_hash) as unique_tx
FROM pm_trade_fifo_roi_v3_mat_deduped
```

---

## Migration Guide

### Update All Queries

**Old (slow, duplicates):**
```sql
FROM pm_trade_fifo_roi_v3_deduped  -- VIEW with on-the-fly GROUP BY
```

**New (fast, clean):**
```sql
FROM pm_trade_fifo_roi_v3_mat_deduped  -- Materialized, no duplicates
```

### Files to Update

1. `scripts/analysis/find-3day-hyperdiversified-v2.ts` ✅ Already updated
2. Any leaderboard queries
3. PnL calculation scripts
4. Wallet analytics queries

### Query Performance

**Before (VIEW):**
- 3-5 minute queries
- On-the-fly deduplication
- High memory usage

**After (Materialized):**
- 5-10 second queries
- Pre-deduplicated
- Low memory usage

---

## Maintenance Schedule

### Weekly Refresh
```bash
# Run full rebuild once a week
npx tsx scripts/create-deduped-full-overnight.ts
```

### After Bulk Backfills
If you run a bulk FIFO backfill (e.g., new markets, historical data):
1. Wait for FIFO calculation to complete
2. Run overnight script to rebuild materialized table

### Monitoring
```sql
-- Check last updated time
SELECT max(entry_time) FROM pm_trade_fifo_roi_v3_mat_deduped

-- Compare with source table
SELECT max(entry_time) FROM pm_trade_fifo_roi_v3
```

If materialized table is >1 hour behind source, trigger rebuild.

---

## Troubleshooting

### "Memory limit exceeded"
- Reduce number of batches (more batches = less memory per batch)
- Check ClickHouse Cloud tier limits

### "Timeout exceeded"
- Increase `request_timeout` in script
- Increase `max_execution_time` in clickhouse_settings

### Row count mismatch
- Check for failed batches in logs
- Re-run specific batch ranges if needed
- Verify source table hasn't changed during rebuild

### Duplicate rows appearing
- Should NEVER happen with `GROUP BY tx_hash`
- If it does, check for concurrent inserts
- Drop and rebuild table

---

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/create-deduped-recent-final.ts` | Phase 1: Recent wallets (1.5 hr) |
| `scripts/create-deduped-full-overnight.ts` | Phase 2: Full backfill (2-3 hr) |
| `FIFO_V5_README.md` | Main documentation entry point |
| `FIFO_V5_QUICK_START.md` | Quick reference guide |
| `docs/FIFO_V5_REFERENCE.md` | Complete technical reference |
| `docs/FIFO_V5_MATERIALIZATION_PLAN.md` | This file |

---

## Status Tracking

- [x] Phase 1 script created
- [x] Phase 2 script created
- [ ] Phase 1 complete (recent wallets) - **IN PROGRESS**
- [ ] Phase 2 scheduled (overnight full backfill)
- [ ] All queries migrated to use materialized table
- [ ] Weekly refresh cron job configured

---

## Next Steps

1. ✅ Let Phase 1 complete (currently running)
2. ⏰ Schedule Phase 2 for tonight
3. 📝 Update remaining queries to use materialized table
4. 🔄 Set up weekly refresh cron job
5. 📊 Verify leaderboard results with deduplicated data
