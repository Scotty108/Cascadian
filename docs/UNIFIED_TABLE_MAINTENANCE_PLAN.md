# Unified Table Maintenance Plan
**Goal:** Keep `pm_trade_fifo_roi_v3_mat_unified` fresh and duplicate-free with automated cron jobs

**Date Created:** 2026-01-30
**Status:** Ready for implementation tomorrow morning

---

## 🎯 Immediate Solution (Tomorrow Morning)

### 1. Deploy Simple Refresh Cron (ALREADY BUILT)

**Script:** `scripts/refresh-unified-simple.ts` (already exists, tested)

**What it does:**
1. DELETE all unresolved positions (`WHERE resolved_at IS NULL`)
2. Wait for mutation to complete
3. Rebuild fresh unresolved from last 24 hours
4. Runtime: ~10-12 minutes

**Why this prevents duplicates:**
- DELETE removes ALL unresolved first (atomic operation)
- Rebuild starts from clean slate
- No overlap between runs possible

**Recommended Schedule:**
```json
{
  "path": "/api/cron/refresh-unified-table",
  "schedule": "0 */6 * * *"  // Every 6 hours
}
```

**Runtime windows:**
- 12am UTC: ~10-12 min
- 6am UTC: ~10-12 min
- 12pm UTC: ~10-12 min
- 6pm UTC: ~10-12 min

---

## 🔧 Implementation Steps (Tomorrow 9am)

### Step 1: Create Cron API Route (5 min)

**File:** `app/api/cron/refresh-unified-table/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const maxDuration = 600; // 10 minutes
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('Starting unified table refresh...');

    // Run the refresh script
    const { stdout, stderr } = await execAsync(
      'npx tsx scripts/refresh-unified-simple.ts',
      { cwd: process.cwd(), timeout: 600000 }
    );

    console.log('Refresh complete:', stdout);

    return NextResponse.json({
      success: true,
      message: 'Unified table refreshed',
      output: stdout
    });

  } catch (error: any) {
    console.error('Refresh failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
```

### Step 2: Add to Vercel Cron Config (2 min)

**File:** `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-unified-table",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

### Step 3: Test Manually (5 min)

```bash
# Test the script directly first
npx tsx scripts/refresh-unified-simple.ts

# Then test the API endpoint
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.vercel.app/api/cron/refresh-unified-table
```

### Step 4: Monitor First Run (10 min)

Watch logs to ensure:
- DELETE completes without errors
- Rebuild finds expected wallet count (~95k-100k for 24hr window)
- Final verification shows zero duplicates

---

## 📊 What Gets Refreshed

### ALWAYS Refreshed (Every 6 hours)
- **Unresolved positions:** All positions where market not yet resolved
- **Active traders:** Wallets that traded in last 24 hours

### NEVER Touched
- **Resolved positions:** 575M rows stay permanent
- **Historical data:** Positions older than 24 hours remain untouched

### Coverage
- **24-hour window:** ~95k-100k wallets, ~13-15M unresolved positions
- **Staleness:** Max 6 hours behind real-time
- **Completeness:** 100% of truly unresolved positions

---

## 🚨 Why This Prevents Duplicates

### Problem We Just Solved
- Ran build script **twice** with overlapping wallets
- First: 24hr wallets → 11.75M rows
- Second: ALL wallets → 27.59M rows
- **Overlap:** ~16M duplicates

### New Pattern Prevents This
```
Run 1 (12am):
  DELETE WHERE resolved_at IS NULL  ← Removes ALL unresolved
  INSERT (rebuild from source)      ← Fresh data, zero overlap

Run 2 (6am):
  DELETE WHERE resolved_at IS NULL  ← Removes Run 1 data
  INSERT (rebuild from source)      ← Fresh data, zero overlap

Run 3 (12pm):
  DELETE WHERE resolved_at IS NULL  ← Removes Run 2 data
  INSERT (rebuild from source)      ← Fresh data, zero overlap
```

**Key:** DELETE happens BEFORE INSERT, so no run can create duplicates from previous run.

---

## ⚡ Performance Optimizations (Future)

### Option 1: Incremental Updates (Reduces runtime to ~3-5 min)

Instead of DELETE ALL + REBUILD ALL, only update changed positions:

```typescript
// 1. Find new unresolved (markets that just became unresolved)
// 2. Delete resolved (markets that just resolved)
// 3. Insert only new unresolved

// Pros: Faster (3-5 min vs 10-12 min)
// Cons: More complex logic, edge cases
```

### Option 2: Materialized View Pattern (Real-time updates)

Create a materialized view that auto-updates on INSERT:

```sql
CREATE MATERIALIZED VIEW pm_unified_unresolved_mv
ENGINE = ReplacingMergeTree(entry_time)
ORDER BY (wallet, condition_id, outcome_index, tx_hash)
AS SELECT ... FROM pm_canonical_fills_v4
WHERE condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions)
```

**Pros:** Real-time, no cron needed
**Cons:** Higher complexity, requires migration

### Option 3: Hybrid Approach

- **Resolved:** Keep as-is (permanent data)
- **Unresolved:** Use materialized view (auto-update)

---

## 📈 Monitoring & Alerts

### Daily Health Checks

**Query to run:**
```sql
SELECT
  count() as total,
  countIf(resolved_at IS NULL) as unresolved,
  uniq(wallet) as wallets,
  max(entry_time) as latest_entry,
  date_diff('hour', max(entry_time), now()) as hours_stale,
  -- Duplicate check (sample)
  (SELECT count() - uniqExact(tx_hash, wallet, condition_id, outcome_index)
   FROM pm_trade_fifo_roi_v3_mat_unified
   WHERE resolved_at IS NULL) as unresolved_duplicates
FROM pm_trade_fifo_roi_v3_mat_unified
```

**Alert thresholds:**
- ❌ `hours_stale > 8` → Cron failed
- ❌ `unresolved_duplicates > 100` → Duplicate issue
- ❌ `unresolved < 5M` → Missing data

### Cron Failure Recovery

If cron fails:

```bash
# Option 1: Manual trigger
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.vercel.app/api/cron/refresh-unified-table

# Option 2: Direct script run
npx tsx scripts/refresh-unified-simple.ts

# Option 3: Check what went wrong
# - Check Vercel logs
# - Check ClickHouse mutations
# - Verify source data recent
```

---

## 🔄 Disaster Recovery

### Scenario 1: Cron Creates Duplicates (Unlikely but possible)

**Symptoms:** Duplicate check shows >1M duplicates

**Fix:**
```bash
# Run deduplication script
npx tsx scripts/deduplicate-unified-final.ts
# Runtime: ~35-40 min
```

### Scenario 2: DELETE Mutation Stuck

**Symptoms:** Cron timeout, mutation pending for >10 min

**Fix:**
```sql
-- Kill stuck mutation
KILL MUTATION
WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
  AND is_done = 0
SYNC;

-- Then re-run refresh
```

### Scenario 3: Catastrophic Data Loss

**Fix:**
```sql
-- Restore from backup
DROP TABLE pm_trade_fifo_roi_v3_mat_unified;
RENAME TABLE pm_trade_fifo_roi_v3_mat_unified_backup_full_20260130
  TO pm_trade_fifo_roi_v3_mat_unified;

-- Then run fresh rebuild
npx tsx scripts/deduplicate-unified-final.ts
```

---

## 📅 Tomorrow Morning Checklist

- [ ] Create `/api/cron/refresh-unified-table/route.ts`
- [ ] Add cron config to `vercel.json`
- [ ] Deploy to Vercel
- [ ] Test manual trigger via curl
- [ ] Monitor first automated run (12pm UTC)
- [ ] Verify zero duplicates after first run
- [ ] Document any issues

---

## 🎯 Success Metrics

After implementing this plan:

| Metric | Target | Current (after tonight) |
|--------|--------|------------------------|
| **Freshness** | <6 hours stale | 0 hours (manual run) |
| **Duplicates** | 0 unresolved dups | 0 (after dedupe) |
| **Runtime** | <15 min per run | ~10-12 min |
| **Reliability** | 99%+ uptime | TBD |
| **Coverage** | 100% unresolved | 100% |

---

## 💡 Key Insights

1. **DELETE before INSERT** prevents duplicates (atomic swap pattern)
2. **24-hour window** is sufficient for unresolved (most positions close within days)
3. **6-hour frequency** balances freshness vs resource usage
4. **Resolved data never changes** so it's safe to leave untouched
5. **Backup before every major operation** is critical

---

**Next Review:** 2026-02-06 (1 week after deployment)
**Owner:** Data Engineering
**Status:** Ready for deployment
