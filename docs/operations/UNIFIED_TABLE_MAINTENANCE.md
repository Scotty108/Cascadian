# Unified Table Maintenance Guide

> **Last Updated:** 2026-02-02
> **Table:** `pm_trade_fifo_roi_v3_mat_unified`
> **Purpose:** Central source of truth for all positions (resolved + unresolved, longs + shorts)

---

## Quick Status Check

Run this to see if the table is up to date:

```sql
SELECT
  count() as total_rows,
  countIf(resolved_at IS NOT NULL) as resolved,
  countIf(resolved_at IS NULL AND is_short = 0) as unresolved_long,
  countIf(resolved_at IS NULL AND is_short = 1) as unresolved_short,
  max(entry_time) as newest_entry,
  dateDiff('minute', max(entry_time), now()) as entry_staleness_min,
  max(resolved_at) as newest_resolved,
  dateDiff('minute', max(resolved_at), now()) as resolved_staleness_min
FROM pm_trade_fifo_roi_v3_mat_unified
```

**Healthy thresholds:**
- `entry_staleness_min` < 130 (cron runs every 2 hours at :45)
- `resolved_staleness_min` < 130

---

## How Everything Connects

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW                                    │
└─────────────────────────────────────────────────────────────────────┘

Raw Blockchain Data (Goldsky pipelines)
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ pm_trader_events_v2/v3  │  pm_ctf_split_merge  │  vw_negrisk_...   │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│               pm_canonical_fills_v4 (1.19B rows)                     │
│    Cron: update-canonical-fills (every 10 min)                       │
│    Contains: All fills from CLOB, CTF, NegRisk sources               │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│               pm_condition_resolutions (410k+ rows)                  │
│    Source: Polymarket API                                            │
│    Contains: Which markets resolved, what outcome won                │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│               pm_trade_fifo_roi_v3 (287M rows)                       │
│    Cron: refresh-fifo-trades (every 2 hours)                         │
│    Contains: FIFO-calculated positions with PnL/ROI                  │
│    NOTE: Only RESOLVED positions (for historical accuracy)           │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│           pm_trade_fifo_roi_v3_mat_unified (291M rows)               │
│    Cron: refresh-unified-incremental (every 2 hours at :45)          │
│    Contains: EVERYTHING - resolved + unresolved, longs + shorts      │
│                                                                       │
│    This is the ONE TABLE that has it all!                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The All-In-One Cron: refresh-unified-incremental

**File:** `app/api/cron/refresh-unified-incremental/route.ts`
**Schedule:** Every 2 hours at :45 (e.g., 2:45, 4:45, 6:45...)
**Timeout:** 10 minutes (Vercel Pro limit)

### What It Does (In Order)

1. **Process Pending Resolutions**
   - Finds conditions resolved in last 48h not yet in `pm_trade_fifo_roi_v3`
   - Calculates FIFO positions for those conditions
   - Inserts into `pm_trade_fifo_roi_v3`

2. **Sync Resolved Positions to Unified Table**
   - Finds resolved positions in `pm_trade_fifo_roi_v3` that aren't in unified table
   - Inserts them with explicit column mapping

3. **Refresh Unresolved Positions**
   - For active wallets (traded in last 24h)
   - Calculates current unresolved LONG positions
   - Calculates current unresolved SHORT positions
   - Uses anti-join pattern (safe - only inserts what doesn't exist)

### Manual Trigger

```bash
# Get the CRON_SECRET from Vercel
source .env.local  # or .env.vercel

# Trigger the cron
curl "https://cascadian.vercel.app/api/cron/refresh-unified-incremental?token=$CRON_SECRET"
```

---

## Common Problems & Solutions

### Problem 1: "Unauthorized" When Triggering Cron

**Cause:** CRON_SECRET doesn't match between local and Vercel

**Fix:**
```bash
# Pull latest env from Vercel
npx vercel env pull .env.vercel --yes

# Use the secret from that file
grep CRON_SECRET .env.vercel
# Then use that value in your curl request
```

### Problem 2: 404 When Hitting Cron Endpoint

**Cause:** Changes deployed but not promoted to production alias

**Fix:**
```bash
# Check what's actually deployed
npx vercel inspect cascadian.vercel.app

# If it shows an old deployment, deploy and promote:
npx vercel --prod

# Then manually alias if needed:
npx vercel alias <new-deployment-url> cascadian.vercel.app
```

### Problem 3: SQL Error "no alias for subquery"

**Cause:** ClickHouse requires all subqueries in FROM clauses to have aliases

**Fix:** Add `AS <alias>` after every subquery and qualify all column references:
```sql
-- BAD
FROM (SELECT ... FROM table)
INNER JOIN other_table ON column = ...

-- GOOD
FROM (SELECT ... FROM table) AS subquery
INNER JOIN other_table ON subquery.column = ...
```

### Problem 4: Memory Limit Exceeded (10.80 GiB)

**Cause:** JOIN or NOT IN against full table (269M+ rows)

**Fix:** Scope the subquery to current batch:
```sql
-- BAD (scans entire unified table)
WHERE (tx_hash, wallet, condition_id, outcome_index) NOT IN (
  SELECT tx_hash, wallet, condition_id, outcome_index
  FROM pm_trade_fifo_roi_v3_mat_unified
)

-- GOOD (scans only relevant conditions)
WHERE (tx_hash, wallet, condition_id, outcome_index) NOT IN (
  SELECT tx_hash, wallet, condition_id, outcome_index
  FROM pm_trade_fifo_roi_v3_mat_unified
  WHERE condition_id IN (${conditionList})  -- Scoped!
)
```

### Problem 5: Column Order Mismatch (Silent Data Corruption)

**Cause:** `SELECT *` inserts data in wrong columns when source and destination have different column orders

**Example:**
- `pm_trade_fifo_roi_v3`: entry_time, tokens, cost_usd, ..., resolved_at
- `pm_trade_fifo_roi_v3_mat_unified`: entry_time, resolved_at, tokens, cost_usd, ...

**Fix:** Always use explicit column lists:
```sql
INSERT INTO destination_table
SELECT
  tx_hash, wallet, condition_id, outcome_index,
  entry_time, resolved_at, tokens, cost_usd,
  tokens_sold_early, tokens_held, exit_value,
  pnl_usd, roi, pct_sold_early,
  is_maker, is_closed, is_short
FROM source_table
```

### Problem 6: Duplicates After Refresh

**Cause:** Anti-join didn't work, rows inserted multiple times

**Check:**
```sql
SELECT
  count() as total,
  count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE entry_time >= now() - INTERVAL 7 DAY
```

**Fix:** See the deduplication plan in `/Users/scotty/.claude/plans/purring-honking-hellman.md`

### Problem 7: ALTER TABLE DELETE Race Condition

**Cause:** ClickHouse DELETE is async (mutation). INSERT runs before DELETE completes.

**Example of BAD pattern:**
```typescript
// Step 1: Delete old unresolved
await clickhouse.command({ query: 'DELETE FROM table WHERE resolved_at IS NULL' });
// Step 2: Insert new unresolved - BUT DELETE ISN'T DONE YET!
await clickhouse.command({ query: 'INSERT INTO table SELECT ...' });
```

**Fix:** Use anti-join pattern instead (never delete, only insert if not exists)

---

## Table Schema

```sql
CREATE TABLE pm_trade_fifo_roi_v3_mat_unified (
  tx_hash String,
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,
  entry_time DateTime,
  resolved_at Nullable(DateTime),
  tokens Float64,
  cost_usd Float64,
  tokens_sold_early Float64,
  tokens_held Float64,
  exit_value Float64,
  pnl_usd Float64,
  roi Float64,
  pct_sold_early Float64,
  is_maker UInt8,
  is_closed UInt8,
  is_short UInt8
) ENGINE = SharedMergeTree
ORDER BY (wallet, condition_id, outcome_index, tx_hash)
```

**Primary key meaning:**
- Unique row = (wallet, condition_id, outcome_index, tx_hash)
- For LONG positions: tx_hash is the actual transaction hash
- For SHORT positions: tx_hash is synthetic `short_<wallet>_<condition>_<outcome>_<timestamp>`

---

## Manual Scripts

### Refresh All Unresolved (Safe)

```bash
npx tsx scripts/refresh-all-unresolved.ts
```

This:
- Finds ALL unresolved conditions (not just active wallets)
- Uses anti-join pattern (never deletes, safe if interrupted)
- Takes ~10-15 minutes for full scan

### Check FIFO Source Table

```bash
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client';
const r = await clickhouse.query({ query: 'SELECT count(), max(resolved_at) FROM pm_trade_fifo_roi_v3', format: 'JSONEachRow' });
console.log(await r.json());
"
```

### Manual FIFO Refresh

```bash
npx tsx scripts/manual-fifo-refresh.ts
```

---

## Deployment Checklist

Before any deployment:

1. **Check current state:**
   ```bash
   git status
   git log --oneline -3
   ```

2. **Commit changes:**
   ```bash
   git add -A
   git commit -m "fix: description of fix

   Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
   ```

3. **Push to GitHub:**
   ```bash
   git push origin main
   ```

4. **Deploy to Vercel:**
   ```bash
   npx vercel --prod
   ```

5. **Verify alias points to new deployment:**
   ```bash
   npx vercel inspect cascadian.vercel.app
   # Check the "created" timestamp - should be recent
   ```

6. **If old deployment still showing:**
   ```bash
   # Get new deployment URL from the vercel --prod output
   npx vercel alias <new-deployment-url> cascadian.vercel.app
   ```

---

## Cron Schedule (vercel.json)

```json
{
  "path": "/api/cron/refresh-unified-incremental",
  "schedule": "45 */2 * * *"
}
```

This means: At minute 45 of every 2nd hour (00:45, 02:45, 04:45, ...)

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/cron/refresh-unified-incremental/route.ts` | Main all-in-one cron |
| `app/api/cron/refresh-fifo-trades/route.ts` | FIFO calculation for resolved positions |
| `scripts/refresh-all-unresolved.ts` | Manual full unresolved refresh |
| `lib/clickhouse/client.ts` | ClickHouse connection |
| `vercel.json` | Cron schedules |
| `.env.local` / `.env.vercel` | CRON_SECRET and other env vars |

---

## Emergency Procedures

### Table Completely Broken

1. Check if backup exists:
   ```sql
   SHOW TABLES LIKE '%backup%'
   ```

2. Swap to backup:
   ```sql
   RENAME TABLE
     pm_trade_fifo_roi_v3_mat_unified TO pm_trade_fifo_roi_v3_mat_unified_broken,
     pm_trade_fifo_roi_v3_mat_unified_backup TO pm_trade_fifo_roi_v3_mat_unified
   ```

### Cron Keeps Failing

1. Check Vercel logs:
   ```bash
   npx vercel logs cascadian.vercel.app --follow
   ```

2. Run the cron locally to debug:
   ```bash
   # In one terminal
   npm run dev

   # In another terminal
   curl "http://localhost:3000/api/cron/refresh-unified-incremental?token=$CRON_SECRET"
   ```

### Massive Duplicates

See the deduplication plan: `/Users/scotty/.claude/plans/purring-honking-hellman.md`

---

## Contact & Escalation

If something is seriously broken and this doc doesn't help:
1. Check CLAUDE.md for overall system context
2. Check docs/operations/NEVER_DO_THIS_AGAIN.md for data safety rules
3. Search claude-self-reflect for past solutions to similar problems
