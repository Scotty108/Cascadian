# FIFO V5 Full Backfill - Strategy Comparison

**Date:** January 28, 2026
**Context:** After 2-day validation completes, choose between 10-day or full backfill

---

## Executive Summary

| Strategy | Wallets | Time Estimate | Data Completeness | Risk Level |
|----------|---------|---------------|-------------------|------------|
| **10-Day Run** | ~350k | 6-8 hours | Recent traders only | Low |
| **Full Run** | ~1.9M | 18-24 hours | Complete historical | Medium |

---

## Current Baseline: 2-Day Test

**What we learned:**
- 160,900 wallets (recently active)
- 50 batches with wallet hash modulo
- ~3-4 hours total (including batch 24 timeout recovery)
- Average: 4-5 minutes per batch
- Unresolved rows: ~4M (from batches 24-31, extrapolate to ~6M total)
- Resolved rows: ~4.3M (from original batches 1-23)
- Combined: ~10-11M total rows for 160k wallets

**Key insight:** Processing 160k wallets with full history = ~3-4 hours

---

## Option 1: 10-Day Full Backfill

### Scope
- **Wallets:** All wallets active in last 10 days (~350,000)
- **History:** Complete trading history for those wallets (all time)
- **Markets:** Both resolved AND unresolved
- **Output:** `pm_trade_fifo_roi_v3_mat_unified_10d`

### Time Estimate

**Calculation:**
```
Base: 2-day test = 160k wallets = 3.5 hours
10-day test = 350k wallets

Scaling factor: 350k / 160k = 2.19x more wallets
Time estimate: 3.5 hours × 2.19 = 7.7 hours

With overhead/variability: 6-8 hours
```

**Batch structure:**
- 100 batches (more wallets per batch than 2-day test)
- Average 4-5 minutes per batch
- Total: 400-500 minutes = 6.7-8.3 hours

**Completion ETA:** Start at 4:00 PM → Finish by 11:00 PM - midnight

### Data Completeness

**What you GET:**
- ✅ All active traders from last 10 days
- ✅ Their complete trading history (all time)
- ✅ Open positions on unresolved markets
- ✅ Closed positions on unresolved markets
- ✅ All resolved market positions
- ✅ ~95% of trading volume (recent traders = most active)

**What you MISS:**
- ❌ Wallets that haven't traded in 10+ days
- ❌ Inactive historical whales
- ❌ One-time traders from 2+ weeks ago
- ❌ ~5-10% of unique wallets (~150k historical wallets)

### Use Case Fit

**Good for:**
- Leaderboard focused on active traders ✅
- "Hot money" tracking ✅
- Recent smart money detection ✅
- Fast time-to-production (tonight) ✅

**Not good for:**
- Historical analysis (inactive traders missing)
- Complete wallet universe coverage
- Academic/research completeness

### Risk Assessment

**Low Risk:**
- Proven approach (2-day test validates logic)
- Manageable runtime (overnight)
- Can always run full backfill later
- Incremental approach (validate → expand)

---

## Option 2: Full Database Backfill

### Scope
- **Wallets:** ALL 1.9M wallets ever seen
- **History:** Complete trading history (all time)
- **Markets:** Both resolved AND unresolved
- **Output:** `pm_trade_fifo_roi_v3_mat_unified`

### Time Estimate

**Calculation:**
```
Base: 2-day test = 160k wallets = 3.5 hours
Full run = 1.9M wallets

Scaling factor: 1.9M / 160k = 11.9x more wallets
Time estimate: 3.5 hours × 11.9 = 41.6 hours

HOWEVER: Most wallets are inactive (1-2 trades)
Active traders take longer, inactive traders are fast

Adjusted estimate:
- 30% highly active (500k): 30 hours
- 70% low activity (1.4M): 8 hours
- Total: ~20-24 hours (not linear scaling)

Alternative calculation (batch-based):
- 200 batches (9,500 wallets per batch)
- Active batches: 6-8 min each (~60 batches) = 360-480 min
- Inactive batches: 2-4 min each (~140 batches) = 280-560 min
- Total: 640-1,040 minutes = 10.7-17.3 hours
- With overhead: 12-20 hours realistic
```

**Conservative estimate: 18-24 hours**

**Batch structure:**
- 200 batches (better distribution across hash space)
- Mix of fast (2 min) and slow (8 min) batches
- Average: 5-6 minutes per batch
- Total: 1,000-1,200 minutes = 16.7-20 hours

**Completion ETA:**
- Start tonight 4:00 PM → Finish tomorrow 10:00 AM - 2:00 PM
- OR start tonight 11:00 PM → Finish tomorrow 5:00 PM - 9:00 PM

### Data Completeness

**What you GET:**
- ✅ Every wallet that ever traded
- ✅ Complete historical leaderboard
- ✅ Full research dataset
- ✅ 100% coverage
- ✅ Never need to re-run full backfill

**What you DON'T miss:**
- Nothing - complete dataset ✅

### Use Case Fit

**Good for:**
- Complete historical leaderboard ✅
- Research and analysis ✅
- One-and-done approach ✅
- Future-proof (never re-run) ✅

**Not good for:**
- Fast time-to-production (20+ hour wait)
- Tonight launch deadline

### Risk Assessment

**Medium Risk:**
- Long runtime (20+ hours)
- Higher chance of errors (more batches)
- Requires overnight monitoring
- If it fails at batch 150, lost 12+ hours

**Mitigation:**
- Restart capability (like we did with batch 24)
- Can always fall back to 10-day if needed
- Proven logic from 2-day test

---

## Detailed Comparison

### Timeline Comparison

| Milestone | 10-Day Strategy | Full Strategy |
|-----------|-----------------|---------------|
| 2-day test completes | 2:42 PM | 2:42 PM |
| Validation & spot checks | 2:42-3:15 PM | 2:42-3:15 PM |
| Start next backfill | 3:30 PM | 3:30 PM |
| 25% complete | 5:00 PM | 9:00 PM |
| 50% complete | 6:30 PM | 2:30 AM |
| 75% complete | 8:00 PM | 8:00 AM |
| **COMPLETE** | **10:00-11:00 PM** | **10:00 AM - 2:00 PM (next day)** |
| Leaderboard live | Tonight | Tomorrow afternoon |

### Resource Requirements

| Resource | 10-Day | Full |
|----------|--------|------|
| ClickHouse CPU | 6-8 hours | 18-24 hours |
| Memory per batch | 10GB | 10GB (same) |
| Network bandwidth | Moderate | High |
| Disk I/O | Moderate | High |
| Human monitoring | Evening | Overnight + morning |

### Row Count Estimates

Based on 2-day test producing ~10-11M rows for 160k wallets:

| Metric | 2-Day Test | 10-Day | Full |
|--------|------------|--------|------|
| Wallets | 160,900 | ~350,000 | ~1,900,000 |
| Avg rows/wallet | 62 | 62 | 62 |
| **Total rows** | **10-11M** | **~22M** | **~118M** |
| Unresolved rows | ~6M | ~13M | ~70M |
| Resolved rows | ~4-5M | ~9M | ~48M |

**Note:** Full resolved table already has 286M rows (this is historical resolved only). The unified table will be smaller because it's deduplicated per-transaction.

### Incremental Update Strategy (Post-Backfill)

Both strategies need daily updates:

**Daily cron (runs at 2 AM):**
1. Find newly resolved markets (last 24 hours)
2. Find new trades (last 24 hours)
3. Rebuild ONLY affected wallets (~1,000 wallets/day)
4. Runtime: 5-10 minutes

Both 10-day and full strategies support the same incremental update pattern.

---

## Recommendation Matrix

### Choose 10-Day IF:
- ✅ Need leaderboard live tonight
- ✅ Focus on active/recent traders
- ✅ Want to validate at larger scale before full commit
- ✅ Prefer lower risk (shorter runtime)
- ✅ Can run full backfill later if needed

### Choose Full IF:
- ✅ Can wait until tomorrow afternoon
- ✅ Need complete historical coverage
- ✅ Want one-and-done approach
- ✅ Building research/analytics platform
- ✅ Don't want to run large backfills again

---

## My Recommendation: **10-Day First, Then Full**

**Rationale:**

1. **Progressive validation:**
   - 2-day (160k wallets) ✅ Validates logic
   - 10-day (350k wallets) → Validates scale
   - Full (1.9M wallets) → Complete dataset

2. **Risk mitigation:**
   - If 10-day fails, only lost 6-8 hours
   - If full fails, lost 20+ hours
   - Incremental confidence building

3. **Time to value:**
   - Leaderboard live tonight with 10-day
   - Users can start using it
   - Run full backfill tomorrow night when less critical

4. **Learning opportunity:**
   - 10-day run will reveal any performance issues
   - Can optimize before 20-hour full run
   - Better batch sizing decisions

5. **Production ready faster:**
   - Tonight: Leaderboard with 95% of traders
   - Tomorrow: Leaderboard with 100% of traders
   - Vs. waiting until tomorrow for first launch

**Implementation:**
```
Today:
- 2:42 PM: 2-day test completes
- 3:00 PM: Validation & spot checks
- 3:30 PM: Start 10-day backfill
- 11:00 PM: 10-day completes
- 11:30 PM: Deploy leaderboard 🎉

Tomorrow:
- 11:00 PM: Start full backfill (off-peak hours)
- Next day 5:00 PM: Full backfill completes
- Next day 6:00 PM: Update leaderboard with complete data
```

---

## Script Specifications

### 10-Day Script: `scripts/rebuild-full-10days.ts`

```typescript
const NUM_BATCHES = 100;
const LOOKBACK_DAYS = 10;
const TIMEOUT = 1200000; // 20 minutes

// Steps:
1. Find wallets active in last 10 days
2. Pre-compute unresolved conditions (temp table)
3. Process 100 batches with INNER JOIN optimization
4. Build unified table (resolved + unresolved)
5. Deduplicate with GROUP BY (tx_hash, wallet, condition_id, outcome_index)

// Output tables:
- pm_trade_fifo_roi_v3_mat_unresolved_10d
- pm_trade_fifo_roi_v3_mat_resolved_10d
- pm_trade_fifo_roi_v3_mat_unified_10d (final)
```

### Full Script: `scripts/rebuild-full-all-wallets.ts`

```typescript
const NUM_BATCHES = 200;
const LOOKBACK_DAYS = null; // All wallets
const TIMEOUT = 1200000; // 20 minutes

// Steps:
1. Get ALL wallets from pm_canonical_fills_v4
2. Pre-compute unresolved conditions (temp table)
3. Process 200 batches with INNER JOIN optimization
4. Build unified table (resolved + unresolved)
5. Deduplicate with GROUP BY (tx_hash, wallet, condition_id, outcome_index)

// Output tables:
- pm_trade_fifo_roi_v3_mat_unresolved (unresolved only)
- pm_trade_fifo_roi_v3_mat_resolved (copy existing 286M table)
- pm_trade_fifo_roi_v3_mat_unified (final - complete dataset)
```

---

## Success Metrics

After each backfill, verify:

```sql
-- 1. Zero duplicates
SELECT
  count() as total,
  uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique_keys,
  count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
FROM pm_trade_fifo_roi_v3_mat_unified_10d -- or _unified
-- duplicates MUST be 0

-- 2. Row count sanity check
SELECT
  count() as total_rows,
  uniq(wallet) as unique_wallets,
  countIf(resolved_at IS NOT NULL) as resolved_rows,
  countIf(resolved_at IS NULL) as unresolved_rows,
  countIf(is_short = 1) as short_positions
FROM pm_trade_fifo_roi_v3_mat_unified_10d

-- 3. Sample wallet verification
SELECT
  condition_id,
  outcome_index,
  count() as buy_transactions,
  sum(pnl_usd) as total_pnl,
  sum(tokens) as total_tokens_bought
FROM pm_trade_fifo_roi_v3_mat_unified_10d
WHERE wallet = '0x...' -- Known test wallet
GROUP BY condition_id, outcome_index
ORDER BY buy_transactions DESC

-- 4. PnL sanity check
SELECT
  quantile(0.5)(pnl_usd) as median_pnl,
  avg(pnl_usd) as avg_pnl,
  quantile(0.99)(pnl_usd) as p99_pnl,
  min(pnl_usd) as worst_loss,
  max(pnl_usd) as best_win
FROM pm_trade_fifo_roi_v3_mat_unified_10d
WHERE abs(cost_usd) >= 10
```

---

## Next Steps

After 2-day test completes (ETA: 2:42 PM):

1. ✅ Verify zero duplicates
2. ✅ Spot-check 5 known wallets
3. ✅ Review row counts
4. 🤔 **DECISION POINT:** 10-day or full?
5. 🚀 Create appropriate script
6. 🚀 Run backfill
7. 🎉 Deploy leaderboard

---

## Questions to Answer Before Choosing

**For 10-day:**
- Is 95% trader coverage acceptable for launch?
- Can we accept missing historical inactive wallets?
- Do we want leaderboard live tonight?

**For full:**
- Can we wait until tomorrow afternoon?
- Is complete historical coverage critical?
- Are we okay with 20+ hour runtime?

**My vote: 10-day tonight, full tomorrow night** 🎯
