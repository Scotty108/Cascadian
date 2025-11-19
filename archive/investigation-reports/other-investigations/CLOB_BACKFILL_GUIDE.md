# CLOB Backfill Guide
**Created:** 2025-11-14 (PST)
**Terminal:** Claude 1 (C1)

---

## Quick Start (3-Step Process)

### Step 1: Diagnose (5 minutes)

Understand what we're dealing with:

```bash
npx tsx scripts/diagnose-missing-clob-markets.ts
```

**This will show you:**
- How many markets are missing (currently ~31,248)
- Age distribution (recent vs old markets)
- Sample test fetches from Goldsky API
- Expected recovery rate
- Recommended worker count

**Read the recommendations carefully!** This tells you if 95% coverage is realistic.

---

### Step 2: Run Backfill (4-8 hours)

Start the targeted backfill with recommended settings:

```bash
# Conservative approach (if diagnosis showed high error rate)
WORKER_COUNT=16 DELAY_MS=500 npx tsx scripts/backfill-missing-clob-markets.ts

# Recommended approach (if diagnosis looked good)
WORKER_COUNT=32 DELAY_MS=100 npx tsx scripts/backfill-missing-clob-markets.ts

# Aggressive approach (only if diagnosis showed 0% errors)
WORKER_COUNT=64 DELAY_MS=50 npx tsx scripts/backfill-missing-clob-markets.ts
```

**Features:**
- ✅ Checkpoints every 100 markets (safe to Ctrl+C)
- ✅ Auto-resumes from checkpoint
- ✅ Rate limit protection with exponential backoff
- ✅ Progress bar and ETA
- ✅ Logs to `tmp/clob-backfill-progress.log`

**To Stop Safely:**
- Press `Ctrl+C` once → Saves checkpoint and exits
- Press `Ctrl+C` twice → Force kill (may lose progress)

**To Resume:**
```bash
# Just run the same command again
WORKER_COUNT=32 npx tsx scripts/backfill-missing-clob-markets.ts
# It will automatically resume from checkpoint
```

---

### Step 3: Monitor Progress (real-time)

In a **separate terminal**, watch progress:

```bash
# Manual refresh
npx tsx scripts/monitor-clob-coverage.ts

# Auto-refresh every 10 seconds
watch -n 10 npx tsx scripts/monitor-clob-coverage.ts
```

**Shows:**
- Current coverage %
- Missing markets count
- Backfill progress (if running)
- ETA to completion
- Recent activity (last 7 days)

---

## What to Expect

### Timeline

| Worker Count | Expected Time | Risk |
|--------------|---------------|------|
| 16 workers | 8-12 hours | Low (safest) |
| 32 workers | 4-6 hours | Medium (recommended) |
| 64 workers | 2-4 hours | High (may hit rate limits) |

### Success Rates

**Realistic Expectations:**
- **95%+ coverage:** Achievable (my target)
- **5-10% zero-fill markets:** Normal (markets with no trading activity)
- **1-2% errors/rate limits:** Acceptable

**After Backfill:**
- Coverage: 79% → 95-97%
- Missing: 31,248 → ~7,000 (mostly zero-fill markets)
- Ready for P&L: YES ✅

---

## Advanced Usage

### Custom Target List

If you only want to fetch specific markets:

```bash
# Create custom list
echo '["condition_id_1", "condition_id_2", ...]' > tmp/custom-markets.json

# Modify script to read from custom list (edit line ~300)
# Or use the generated tmp/missing-markets-list.json from diagnosis
```

### Retry Failed Markets

After first run completes, retry rate-limited markets with lower worker count:

```bash
# The checkpoint tracks failed markets
WORKER_COUNT=8 DELAY_MS=1000 npx tsx scripts/backfill-missing-clob-markets.ts
```

### Batch Processing

For very large gaps (>50K markets), process in batches:

```bash
BATCH_SIZE=5000 WORKER_COUNT=32 npx tsx scripts/backfill-missing-clob-markets.ts
```

---

## Troubleshooting

### Problem: High Error Rate

**Symptoms:**
- Many "❌ Error" messages
- Low success rate (<50%)

**Solutions:**
1. Reduce worker count: `WORKER_COUNT=16`
2. Increase delays: `DELAY_MS=500`
3. Check Goldsky API status
4. Verify API credentials in `.env.local`

### Problem: Rate Limiting

**Symptoms:**
- "⏸️ Rate limited" messages
- 429 HTTP errors

**Solutions:**
1. **Immediate:** Reduce workers to 8-16
2. Add longer delays: `DELAY_MS=1000`
3. Let it run overnight with 4-8 workers
4. Goldsky may have stricter limits at peak hours

### Problem: Checkpoint Corruption

**Symptoms:**
- Script crashes on startup
- "Invalid checkpoint" errors

**Solutions:**
```bash
# Delete checkpoint and start fresh
rm tmp/clob-backfill-checkpoint.json
WORKER_COUNT=32 npx tsx scripts/backfill-missing-clob-markets.ts
```

### Problem: Slow Progress

**Symptoms:**
- Rate < 10 markets/min
- ETA > 12 hours

**Solutions:**
1. Increase worker count if no errors: `WORKER_COUNT=64`
2. Reduce delay: `DELAY_MS=50`
3. Check network/ClickHouse performance
4. Verify ClickHouse isn't overloaded

---

## Files Generated

### Progress Tracking
- `tmp/clob-backfill-checkpoint.json` - Resume point (auto-saved every 100 markets)
- `tmp/clob-backfill-progress.log` - Detailed log of every market processed

### Diagnosis
- `tmp/missing-markets-list.json` - List of all missing condition_ids

### Don't Delete These!
- If backfill is running, **don't delete** `tmp/clob-backfill-checkpoint.json`
- Progress log is safe to delete (just for debugging)

---

## Success Criteria

### Ready for P&L When:
- ✅ Coverage ≥ 95%
- ✅ No active backfill running
- ✅ Checkpoint shows "BACKFILL COMPLETE"
- ✅ Recent activity shows fills in last 24 hours

### Acceptable Gaps:
- ✅ 5-10% markets with zero fills (expected)
- ✅ 1-2% rate-limited markets (retry later)
- ✅ Very old markets (>2 years) missing (acceptable)

### Not Acceptable:
- ❌ Missing recent markets (<30 days)
- ❌ Coverage < 90%
- ❌ High-profile markets missing

---

## Example Session

```bash
# Terminal 1: Diagnosis
$ npx tsx scripts/diagnose-missing-clob-markets.ts

# OUTPUT:
# Found 31,248 missing markets
# Last 30 days: 1,234 markets
# Recommendation: WORKER_COUNT=32
# Expected coverage: 96.2%

# Terminal 1: Start backfill
$ WORKER_COUNT=32 npx tsx scripts/backfill-missing-clob-markets.ts

# OUTPUT:
# 🚀 CLOB Missing Markets Backfill
# Workers: 32
# ...
# Progress: ████████░░░░░░░░ 45.2%
# Processed: 14,124 / 31,248
# Rate: 42.3 markets/min
# ETA: 6h 42m

# Terminal 2: Monitor
$ watch -n 10 npx tsx scripts/monitor-clob-coverage.ts

# OUTPUT (updates every 10 sec):
# CLOB COVERAGE MONITOR
# Coverage: 87.3%
# Missing: 17,124 markets
# ETA: 6h 30m
```

---

## Cost/Benefit Analysis

### Time Investment
- Diagnosis: 5 minutes
- Setup: 5 minutes
- Backfill: 4-8 hours (mostly unattended)
- **Total active time:** ~10-15 minutes
- **Total elapsed time:** 4-8 hours

### Expected Results
- **Before:** 79% coverage (BLOCKED from P&L)
- **After:** 95-97% coverage (READY for P&L)
- **Improvement:** +16-18 percentage points
- **Markets recovered:** ~24,000 with trading data

### What This Unlocks
- ✅ Wallet-by-wallet P&L calculations
- ✅ Omega ratio leaderboard
- ✅ Complete market coverage
- ✅ Accurate analytics for all markets

---

## FAQ

**Q: Can I run this multiple times?**
A: Yes! It's idempotent. Already-processed markets are skipped.

**Q: Will this slow down ClickHouse?**
A: Minimal impact. Inserts are batched and efficient.

**Q: Can I run other queries while this runs?**
A: Yes, ClickHouse handles concurrent workloads well.

**Q: What if my laptop sleeps/restarts?**
A: Resume from checkpoint. You'll only lose progress since last checkpoint (max 100 markets).

**Q: Should I run this overnight?**
A: Yes! Perfect for unattended operation. Start before bed, wake up to 95%+ coverage.

**Q: How do I know if it's working?**
A: Monitor script shows real-time progress. Log file has detailed per-market status.

**Q: Can I speed it up?**
A: Yes, increase workers to 64-128. But higher risk of rate limiting.

**Q: What if I only get to 90% coverage?**
A: That's acceptable for launch! Remaining 10% likely zero-fill markets.

---

## Next Steps After Backfill

Once backfill reaches 95%+:

1. **Verify coverage:**
   ```bash
   npx tsx scripts/monitor-clob-coverage.ts
   ```

2. **Check for gaps:**
   - Review any failed markets in checkpoint
   - Verify recent markets have fills
   - Spot-check high-profile markets

3. **Proceed with other fixes:**
   - Resume Gamma polling (2 hours)
   - Fix ERC-1155 encoding (4-6 hours)
   - Backfill Nov 6-14 gap (2-4 hours)

4. **Final validation:**
   - Run all checks in `BEFORE_WE_DO_ANY_PNL_C1.md`
   - Verify 5/5 P&L readiness criteria met
   - Create final coverage report

---

**Questions?** Review the diagnostic output and recommendations.

**Ready to start?** Run Step 1 (diagnosis) now!

---

**— Claude 1 (C1)**
**Session:** 2025-11-14 (PST)
**Status:** Ready to execute

_Always run backfills with maximum workers without hitting rate limits, with save/crash/stall protection enabled._
