# Setup Time vs Maintenance Time

## Initial Setup (ONE TIME ONLY) - ~6-8 Hours Total

This is what we're doing RIGHT NOW - backfilling ALL historical data:

### Phase 1: Discovery (⏳ Currently Running)
- **Time:** ~30-45 minutes
- **What:** Find all 60k-80k wallets from historical data
- **Status:** 47,223 wallets found, ~70% complete
- **Frequency:** ONE TIME ONLY

### Phase 2: Initial Sync (🔜 Next)
- **Time:** 2-4 hours
- **What:** Fetch ALL historical trades for ALL wallets
- **Volume:** ~100,000-500,000 trades
- **Why slow:** Fetching years of historical data from Goldsky
- **Frequency:** ONE TIME ONLY

### Phase 3: Initial Enrichment (🔜 After sync)
- **Time:** 30-60 minutes
- **What:** Calculate P&L for ALL historical trades
- **Why slow:** Processing 100k+ trades, looking up market resolutions
- **Frequency:** ONE TIME ONLY

### Phase 4: Initial Metrics (🔜 After enrichment)
- **Time:** 2-5 minutes
- **What:** Calculate 8 metrics × 4 windows for ALL wallets
- **Why fast:** ClickHouse aggregations are very fast
- **Frequency:** ONE TIME ONLY

**TOTAL INITIAL SETUP: ~6-8 hours**

---

## Ongoing Maintenance (DAILY) - ~5-15 Minutes Total

After initial setup, updates are VERY fast because we only process NEW data:

### Daily Wallet Discovery
- **Time:** ~30 seconds
- **What:** Find only NEW wallets (maybe 50-200 per day)
- **Script:** `scripts/discover-new-wallets.ts`
- **Cron:** Every 6 hours

### Incremental Trade Sync
- **Time:** 1-5 minutes
- **What:** Sync only NEW trades since last sync
- **Volume:** ~1,000-5,000 new trades per day (vs 100k+ initial)
- **Script:** `scripts/sync-wallets-incremental.ts` ← ALREADY EXISTS!
- **Cron:** Every 1 hour

### Incremental Enrichment
- **Time:** 30-60 seconds
- **What:** Enrich only NEW trades (1k-5k vs 100k+ initial)
- **Script:** `scripts/enrich-trades.ts --incremental`
- **Cron:** Every 1 hour (after sync)

### Recalculate Metrics
- **Time:** 1-2 minutes
- **What:** Recalculate metrics for wallets with new trades
- **Why fast:** Only recalculating ~500-1000 wallets, not 60k
- **Script:** `scripts/calculate-tier1-metrics.ts --incremental`
- **Cron:** Every 6 hours or daily

### TSI Signals (Real-time)
- **Time:** 10-50ms per market
- **What:** Calculate TSI for watchlist markets (~100)
- **Why fast:** Using cached price data, only 100 markets
- **Script:** Background job, runs every 10 seconds

**TOTAL DAILY MAINTENANCE: ~5-15 minutes** (mostly automated cron jobs)

---

## Comparison Table

| Task | Initial Setup | Daily Updates |
|------|---------------|---------------|
| **Wallet Discovery** | 30-45 min (60k wallets) | 30 sec (50-200 new) |
| **Trade Sync** | 2-4 hours (100k+ trades) | 1-5 min (1k-5k trades) |
| **Enrichment** | 30-60 min (100k+ trades) | 30-60 sec (1k-5k trades) |
| **Metrics** | 2-5 min (60k wallets) | 1-2 min (500-1k wallets) |
| **TSI Signals** | N/A (no historical) | Real-time (10-50ms) |
| **TOTAL** | **6-8 hours** | **5-15 minutes** |

---

## Why the Huge Difference?

### Initial Setup (Slow)
- Processing **ALL historical data** (years of trades)
- Fetching from **external API** (Goldsky - rate limited)
- Processing **60,000+ wallets**
- Calculating **100,000+ trades**

### Daily Updates (Fast)
- Processing **only NEW data** (last 24 hours)
- **Incremental queries** (only new trades)
- **Small volume**: ~1-5k new trades/day vs 100k+ initial
- **Already cached**: Most wallets don't trade daily

---

## Incremental Scripts (Already Built!)

### 1. Incremental Sync (scripts/sync-wallets-incremental.ts)
```typescript
// Only syncs trades since last sync
// Uses wallet_sync_metadata.last_synced_at timestamp
// Skips wallets with no new trades
// ~1-5 minutes instead of 2-4 hours
```

**Key optimization:**
```typescript
// Instead of: Get ALL trades for ALL wallets (100k+ queries)
// We do: Get only NEW trades for ACTIVE wallets (1k queries)
WHERE timestamp > last_synced_at
```

### 2. Incremental Enrichment
```bash
# Only enriches unenriched trades
npx tsx scripts/enrich-trades.ts --incremental

# Filters:
WHERE outcome IS NULL  -- Only unprocessed trades
  AND is_closed = FALSE
```

### 3. Incremental Metrics
```bash
# Only recalculates wallets with new trades
npx tsx scripts/calculate-tier1-metrics.ts --incremental

# Smart detection of changed wallets
```

---

## Automation Setup (Cron Jobs)

### Recommended Schedule

```bash
# Every hour: Sync new trades (1-5 min)
0 * * * * npx tsx scripts/sync-wallets-incremental.ts

# Every hour: Enrich new trades (30-60 sec)
15 * * * * npx tsx scripts/enrich-trades.ts --incremental

# Every 6 hours: Recalculate metrics (1-2 min)
0 */6 * * * npx tsx scripts/calculate-tier1-metrics.ts --incremental

# Every 5 minutes: Refresh category analytics (5-10 sec)
*/5 * * * * npx tsx scripts/cron-refresh-categories.ts

# Every 10 seconds: TSI signals (real-time)
# (Runs as background service, not cron)
```

### Total Daily Cron Time
- 24 sync runs × 2 min = 48 minutes
- 24 enrich runs × 1 min = 24 minutes
- 4 metric runs × 2 min = 8 minutes
- 288 category refreshes × 10 sec = 48 minutes

**But:** Most runs find NO new data and exit early!
**Actual:** ~10-30 minutes total across entire day

---

## Real-World Timeline

### Today (Initial Setup) - ONE TIME
```
12:00 PM - Start wallet discovery (45 min)
12:45 PM - Start bulk sync (3 hours)
 3:45 PM - Start enrichment (45 min)
 4:30 PM - Calculate metrics (3 min)
 4:33 PM - ✅ COMPLETE, ALL HISTORICAL DATA LOADED
```

### Tomorrow (Ongoing) - EVERY DAY
```
12:00 AM - Cron: Sync new trades (2 min)
12:15 AM - Cron: Enrich new trades (45 sec)
 6:00 AM - Cron: Recalculate metrics (1.5 min)
12:00 PM - Cron: Sync new trades (2 min)
...
```

**Total active time:** ~5-15 minutes spread across 24 hours
**User impact:** None (runs in background)

---

## Cost Comparison

### Initial Setup
- **API calls:** ~60,000 (one per wallet)
- **Data transferred:** ~500MB-1GB
- **ClickHouse queries:** ~100,000
- **Time cost:** Your 6-8 hours waiting

### Daily Updates
- **API calls:** ~500-1,000 (only active wallets)
- **Data transferred:** ~10-50MB
- **ClickHouse queries:** ~1,000-5,000
- **Time cost:** Automated, you don't wait

**Ratio:** ~100x reduction in ongoing costs!

---

## Bottom Line

**Initial Setup (What we're doing now):**
- ⏱️ **6-8 hours** ONE TIME
- 🎯 **Backfills ALL historical data**
- 📊 **100,000+ trades, 60,000+ wallets**

**Ongoing Maintenance:**
- ⏱️ **5-15 minutes per day** (automated)
- 🎯 **Only NEW data (incremental)**
- 📊 **1,000-5,000 trades, 50-200 new wallets**

**You're experiencing the slow part RIGHT NOW. After this completes, everything is FAST and automated!**

The incremental sync scripts are already built (`sync-wallets-incremental.ts`) and ready to use. Once initial setup completes, you'll barely notice the updates happening.
