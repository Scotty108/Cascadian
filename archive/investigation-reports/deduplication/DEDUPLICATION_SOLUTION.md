# Production-Ready Deduplication Solution

**Created:** 2025-11-17 (PST)
**Target:** `pm_trades_raw` table (12,761x duplication)
**Priority:** P0 - Critical Data Quality Issue

---

## Executive Summary

- **Problem:** 12,761x duplication on XCN wallet (`0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e`)
- **Root Cause:** Missing ORDER BY in ReplacingMergeTree + repeated ingestion
- **Natural Key:** (transaction_hash, log_index)
- **Expected Rows:** ~1,299 (matching Polymarket API)
- **Actual Rows:** 16,572,639 (before dedup)
- **Recommended Fix:** Option B (Create Clean + Atomic Swap)
- **Timeline:** 2-4 hours total

---

## PHASE 1: IMMEDIATE HOTFIX (30 minutes)

### Step 1A: Create Deduplicated XCN Wallet Table

```sql
-- Create clean temp table for XCN wallet
CREATE TABLE polymarket_canonical.pm_trades_xcn_clean
ENGINE = ReplacingMergeTree()
ORDER BY (wallet, transaction_hash, log_index)
AS
SELECT *
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY transaction_hash, log_index
      ORDER BY timestamp DESC  -- Keep most recent version
    ) AS rn
  FROM polymarket_canonical.pm_trades_raw
  WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
)
WHERE rn = 1;
```

**Estimated Time:** 5-10 seconds
**Expected Rowcount:** ~1,299

### Step 1B: Validate XCN Clean Data

```sql
-- Check rowcount matches expectations
SELECT count(*) AS total_rows FROM polymarket_canonical.pm_trades_xcn_clean;
-- Expected: ~1,299

-- Verify no duplicates remain
SELECT
  transaction_hash,
  log_index,
  count(*) AS dup_count
FROM polymarket_canonical.pm_trades_xcn_clean
GROUP BY transaction_hash, log_index
HAVING dup_count > 1;
-- Expected: 0 rows

-- Compare P&L to Polymarket API
SELECT
  sum(CASE WHEN side = 'BUY' THEN -price * size ELSE price * size END) AS net_pnl,
  count(*) AS total_trades,
  count(DISTINCT transaction_hash) AS unique_transactions
FROM polymarket_canonical.pm_trades_xcn_clean;
-- Manually compare to Polymarket API data
```

**Decision Point:** If validation passes, proceed to Phase 2. If fails, investigate discrepancies.

---

## PHASE 2: GLOBAL DEDUPLICATION (1-2 hours)

### Recommended Approach: **Option B - Create Clean + Atomic Swap**

**Why Option B?**
- ✅ Zero downtime (atomic rename)
- ✅ Safe rollback (old table preserved)
- ✅ Predictable performance (~1-2 hours for 16M rows)
- ✅ No ReplacingMergeTree quirks (OPTIMIZE FINAL unreliable)
- ✅ Can validate before swap

### Step 2A: Create Global Clean Table

```sql
-- Create clean table with proper deduplication
CREATE TABLE polymarket_canonical.pm_trades_raw_v2
ENGINE = ReplacingMergeTree()
ORDER BY (wallet, transaction_hash, log_index)
SETTINGS index_granularity = 8192
AS
SELECT *
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY transaction_hash, log_index
      ORDER BY
        timestamp DESC,           -- Prefer latest timestamp
        wallet ASC                 -- Tiebreaker (rare)
    ) AS rn
  FROM polymarket_canonical.pm_trades_raw
)
WHERE rn = 1;
```

**Estimated Time:** 60-90 minutes (depends on cluster size)
**Expected Rowcount:** ~1.3M (down from 16.5M)

**Performance Notes:**
- Uses window functions (efficient in ClickHouse)
- Sorts by partition key (optimized)
- No joins required (single table scan)

### Step 2B: Validate Global Clean Table

```sql
-- 1. Check total rowcount
SELECT count(*) AS total_rows FROM polymarket_canonical.pm_trades_raw_v2;
-- Expected: ~1.3M (91% reduction)

-- 2. Verify no duplicates
SELECT
  count(*) AS total_rows,
  count(DISTINCT (transaction_hash, log_index)) AS unique_keys,
  total_rows / unique_keys AS dup_factor
FROM polymarket_canonical.pm_trades_raw_v2;
-- Expected dup_factor: 1.0

-- 3. Sample validation (top 10 wallets)
SELECT
  wallet,
  count(*) AS row_count
FROM polymarket_canonical.pm_trades_raw_v2
GROUP BY wallet
ORDER BY row_count DESC
LIMIT 10;
-- Manually verify against Polymarket API

-- 4. Date coverage check
SELECT
  min(timestamp) AS earliest,
  max(timestamp) AS latest,
  count(*) AS total_rows
FROM polymarket_canonical.pm_trades_raw_v2;
-- Verify no data loss in date range

-- 5. Wallet coverage check
SELECT
  count(DISTINCT wallet) AS unique_wallets_old
FROM polymarket_canonical.pm_trades_raw;

SELECT
  count(DISTINCT wallet) AS unique_wallets_new
FROM polymarket_canonical.pm_trades_raw_v2;
-- Verify same wallet count
```

### Step 2C: Atomic Table Swap

```sql
-- Rename tables atomically (zero downtime)
RENAME TABLE
  polymarket_canonical.pm_trades_raw TO polymarket_canonical.pm_trades_raw_backup,
  polymarket_canonical.pm_trades_raw_v2 TO polymarket_canonical.pm_trades_raw;
```

**Estimated Time:** <1 second
**Safety:** Old table preserved as `pm_trades_raw_backup`

### Step 2D: Update Dependencies

```sql
-- Rebuild dependent views/materialized views
-- (Add specific views from your schema here)

-- Example:
-- DROP VIEW IF EXISTS polymarket_canonical.wallet_trades;
-- CREATE VIEW polymarket_canonical.wallet_trades AS
-- SELECT * FROM polymarket_canonical.pm_trades_raw;
```

**Estimated Time:** 5-10 minutes

---

## PHASE 3: PREVENTION MECHANISMS (30 minutes)

### 3A: Ingestion Script Deduplication

**File:** `scripts/ingest-clob-fills-correct.ts`

Add deduplication logic:

```typescript
// Before inserting, deduplicate in-memory
const uniqueTrades = new Map<string, TradeRecord>();

for (const trade of rawTrades) {
  const key = `${trade.transaction_hash}:${trade.log_index}`;

  // Keep most recent version
  if (!uniqueTrades.has(key) ||
      trade.timestamp > uniqueTrades.get(key)!.timestamp) {
    uniqueTrades.set(key, trade);
  }
}

const tradesToInsert = Array.from(uniqueTrades.values());

// Insert deduplicated data
await client.insert({
  table: 'pm_trades_raw',
  values: tradesToInsert,
  format: 'JSONEachRow'
});
```

### 3B: Data Quality Tests

**File:** `tests/data-quality/deduplication.test.ts`

```typescript
import { createClient } from '@clickhouse/client';

describe('Data Quality: Deduplication', () => {
  it('should have no duplicate (transaction_hash, log_index) pairs', async () => {
    const client = createClient({ /* config */ });

    const result = await client.query({
      query: `
        SELECT
          count(*) AS total,
          count(DISTINCT (transaction_hash, log_index)) AS unique_keys,
          total / unique_keys AS dup_factor
        FROM pm_trades_raw
      `,
      format: 'JSONEachRow'
    });

    const data = await result.json();
    expect(data[0].dup_factor).toBe(1.0);
  });

  it('should match Polymarket API counts for sample wallets', async () => {
    // Compare rowcounts against Polymarket API
    const sampleWallets = [
      '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
      // Add more wallets
    ];

    for (const wallet of sampleWallets) {
      const dbCount = await getDbTradeCount(wallet);
      const apiCount = await getPolymarketTradeCount(wallet);

      expect(dbCount).toBeCloseTo(apiCount, 0.05); // 5% tolerance
    }
  });
});
```

### 3C: Monitoring & Alerts

**File:** `scripts/monitor-data-quality.ts`

```typescript
import { createClient } from '@clickhouse/client';

async function checkDuplication() {
  const client = createClient({ /* config */ });

  const result = await client.query({
    query: `
      SELECT
        count(*) / count(DISTINCT (transaction_hash, log_index)) AS dup_factor
      FROM pm_trades_raw
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json();
  const dupFactor = data[0].dup_factor;

  if (dupFactor > 1.01) {  // Alert if >1% duplication
    console.error(`🚨 ALERT: Duplication detected! Factor: ${dupFactor}`);
    // Send alert (Slack, PagerDuty, etc.)
  } else {
    console.log(`✅ Data quality check passed. Dup factor: ${dupFactor}`);
  }
}

// Run hourly via cron
checkDuplication();
```

### 3D: ClickHouse Table Design Fix

**Current Issue:** Missing ORDER BY clause causes ReplacingMergeTree to not deduplicate properly.

**Fix:** When creating future tables, use explicit ORDER BY:

```sql
CREATE TABLE polymarket_canonical.pm_trades_raw
ENGINE = ReplacingMergeTree()
ORDER BY (wallet, transaction_hash, log_index)  -- ✅ Explicit ordering
SETTINGS index_granularity = 8192
AS SELECT * FROM ...;
```

**Note:** ClickHouse does NOT support UNIQUE constraints. Deduplication must be:
1. Enforced at ingestion (application layer)
2. Handled via ReplacingMergeTree + ORDER BY
3. Validated via tests

---

## PHASE 4: VALIDATION FRAMEWORK (30 minutes)

### Test Suite

**File:** `tests/deduplication-validation.test.ts`

```typescript
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'polymarket_canonical'
});

describe('Deduplication Validation', () => {
  describe('Pre-Deduplication State', () => {
    it('captures baseline metrics', async () => {
      const result = await client.query({
        query: `
          SELECT
            count(*) AS total_rows,
            count(DISTINCT (transaction_hash, log_index)) AS unique_keys,
            count(DISTINCT wallet) AS unique_wallets,
            min(timestamp) AS earliest,
            max(timestamp) AS latest
          FROM pm_trades_raw_backup
        `,
        format: 'JSONEachRow'
      });

      const baseline = await result.json();
      console.log('Baseline:', baseline);

      // Store for comparison
      expect(baseline[0].total_rows).toBeGreaterThan(0);
    });
  });

  describe('Post-Deduplication State', () => {
    it('has zero duplicates', async () => {
      const result = await client.query({
        query: `
          SELECT
            transaction_hash,
            log_index,
            count(*) AS dup_count
          FROM pm_trades_raw
          GROUP BY transaction_hash, log_index
          HAVING dup_count > 1
        `,
        format: 'JSONEachRow'
      });

      const duplicates = await result.json();
      expect(duplicates.length).toBe(0);
    });

    it('preserves all unique transactions', async () => {
      const oldResult = await client.query({
        query: `SELECT count(DISTINCT (transaction_hash, log_index)) AS unique_keys FROM pm_trades_raw_backup`,
        format: 'JSONEachRow'
      });

      const newResult = await client.query({
        query: `SELECT count(DISTINCT (transaction_hash, log_index)) AS unique_keys FROM pm_trades_raw`,
        format: 'JSONEachRow'
      });

      const oldUnique = (await oldResult.json())[0].unique_keys;
      const newUnique = (await newResult.json())[0].unique_keys;

      expect(newUnique).toBe(oldUnique);
    });

    it('preserves all wallets', async () => {
      const oldResult = await client.query({
        query: `SELECT count(DISTINCT wallet) AS unique_wallets FROM pm_trades_raw_backup`,
        format: 'JSONEachRow'
      });

      const newResult = await client.query({
        query: `SELECT count(DISTINCT wallet) AS unique_wallets FROM pm_trades_raw`,
        format: 'JSONEachRow'
      });

      const oldWallets = (await oldResult.json())[0].unique_wallets;
      const newWallets = (await newResult.json())[0].unique_wallets;

      expect(newWallets).toBe(oldWallets);
    });

    it('matches P&L calculations', async () => {
      // Sample wallet P&L comparison
      const wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

      const oldPnl = await calculatePnl(client, 'pm_trades_raw_backup', wallet);
      const newPnl = await calculatePnl(client, 'pm_trades_raw', wallet);

      expect(newPnl).toBeCloseTo(oldPnl, 2); // Within $0.01
    });
  });

  describe('Polymarket API Reconciliation', () => {
    it('matches API trade counts for top wallets', async () => {
      const topWallets = await getTopWallets(10);

      for (const wallet of topWallets) {
        const dbCount = await getDbTradeCount(wallet);
        const apiCount = await fetchPolymarketTradeCount(wallet);

        // Allow 5% tolerance for API lag
        expect(dbCount).toBeGreaterThan(apiCount * 0.95);
        expect(dbCount).toBeLessThan(apiCount * 1.05);
      }
    });
  });
});

// Helper functions
async function calculatePnl(client, table: string, wallet: string) {
  const result = await client.query({
    query: `
      SELECT
        sum(CASE
          WHEN side = 'BUY' THEN -price * size
          ELSE price * size
        END) AS net_pnl
      FROM ${table}
      WHERE wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json();
  return data[0].net_pnl;
}

async function getTopWallets(limit: number): Promise<string[]> {
  const result = await client.query({
    query: `
      SELECT wallet, count(*) AS trade_count
      FROM pm_trades_raw
      GROUP BY wallet
      ORDER BY trade_count DESC
      LIMIT ${limit}
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json();
  return data.map(row => row.wallet);
}

async function getDbTradeCount(wallet: string): Promise<number> {
  const result = await client.query({
    query: `SELECT count(*) AS count FROM pm_trades_raw WHERE wallet = '${wallet}'`,
    format: 'JSONEachRow'
  });

  const data = await result.json();
  return data[0].count;
}

async function fetchPolymarketTradeCount(wallet: string): Promise<number> {
  // Call Polymarket API
  const response = await fetch(
    `https://clob.polymarket.com/trades?wallet=${wallet}&limit=1000`
  );
  const data = await response.json();
  return data.length; // Simplified - actual API may be paginated
}
```

---

## COMPARISON: ALL OPTIONS

### Option A: In-Place Deduplication
```sql
-- NOT RECOMMENDED
ALTER TABLE pm_trades_raw
DELETE WHERE (transaction_hash, log_index) IN (
  SELECT transaction_hash, log_index
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY transaction_hash, log_index ORDER BY timestamp DESC) AS rn
    FROM pm_trades_raw
  )
  WHERE rn > 1
);
```

**Pros:**
- No table rename needed
- Lower disk space (no duplicate table)

**Cons:**
- ❌ Very slow on large tables (16M rows)
- ❌ No rollback (destructive operation)
- ❌ Locks table during operation
- ❌ Fragmented after deletion (requires OPTIMIZE)

**Estimated Time:** 4-8 hours
**Risk:** HIGH

---

### Option B: Create Clean + Atomic Swap ✅ RECOMMENDED
```sql
CREATE TABLE pm_trades_raw_v2 AS SELECT ... WHERE rn = 1;
RENAME TABLE pm_trades_raw TO pm_trades_raw_backup, pm_trades_raw_v2 TO pm_trades_raw;
```

**Pros:**
- ✅ Zero downtime (atomic rename)
- ✅ Safe rollback (backup preserved)
- ✅ Predictable performance
- ✅ Can validate before swap

**Cons:**
- Requires 2x disk space temporarily
- Need to update dependent views

**Estimated Time:** 1-2 hours
**Risk:** LOW

---

### Option C: Fix ReplacingMergeTree + OPTIMIZE
```sql
-- Update version column (if exists)
-- Run OPTIMIZE TABLE FINAL
OPTIMIZE TABLE pm_trades_raw FINAL;
```

**Pros:**
- Uses native ClickHouse feature
- No new table needed

**Cons:**
- ❌ ReplacingMergeTree requires proper ORDER BY (already missing)
- ❌ OPTIMIZE FINAL is unreliable and slow
- ❌ May not deduplicate correctly without version column
- ❌ No validation before "fix"

**Estimated Time:** Unknown (3-12 hours)
**Risk:** VERY HIGH

**Verdict:** Do NOT use Option C unless ReplacingMergeTree was set up correctly from the start.

---

## TIMELINE SUMMARY

| Phase | Task | Time | Risk |
|-------|------|------|------|
| Phase 1 | XCN Hotfix | 30 min | LOW |
| Phase 2 | Global Dedup | 1-2 hours | LOW |
| Phase 2 | Validation | 15 min | LOW |
| Phase 2 | Atomic Swap | <1 min | LOW |
| Phase 2 | Update Views | 10 min | LOW |
| Phase 3 | Prevention Code | 30 min | LOW |
| Phase 4 | Test Suite | 30 min | LOW |
| **TOTAL** | **End-to-End** | **3-4 hours** | **LOW** |

---

## ROLLBACK PLAN

If something goes wrong after swap:

```sql
-- Rollback to old table (instant)
RENAME TABLE
  polymarket_canonical.pm_trades_raw TO polymarket_canonical.pm_trades_raw_failed,
  polymarket_canonical.pm_trades_raw_backup TO polymarket_canonical.pm_trades_raw;
```

**Time to rollback:** <1 second

---

## SUCCESS CRITERIA

✅ Zero duplicates: `dup_factor = 1.0`
✅ All wallets preserved
✅ All unique transactions preserved
✅ P&L calculations match
✅ Top 100 wallets match Polymarket API (±5%)
✅ Automated tests pass
✅ Monitoring alerts configured

---

## EXECUTION CHECKLIST

**Before Starting:**
- [ ] Backup current table (already done via RENAME)
- [ ] Verify disk space (need 2x current table size)
- [ ] Test queries on small dataset
- [ ] Communicate maintenance window (if needed)

**Phase 1 - XCN Hotfix:**
- [ ] Run Step 1A (create XCN clean table)
- [ ] Run Step 1B (validate XCN data)
- [ ] Compare to Polymarket API
- [ ] Get approval to proceed

**Phase 2 - Global Dedup:**
- [ ] Run Step 2A (create global clean table)
- [ ] Run Step 2B (validate global data)
- [ ] Run Step 2C (atomic swap)
- [ ] Run Step 2D (update views)
- [ ] Verify API endpoints still work

**Phase 3 - Prevention:**
- [ ] Update ingestion scripts
- [ ] Add data quality tests
- [ ] Set up monitoring
- [ ] Document table design rules

**Phase 4 - Validation:**
- [ ] Run full test suite
- [ ] Verify P&L calculations
- [ ] Check API reconciliation
- [ ] Monitor for 24 hours

**Cleanup:**
- [ ] Drop backup table after 7 days (if all good)
- [ ] Document lessons learned
- [ ] Update runbooks

---

## NEXT STEPS

1. **Review this plan** with team
2. **Get approval** for 2-hour maintenance window
3. **Execute Phase 1** (XCN hotfix) immediately
4. **Validate Phase 1** against Polymarket API
5. **Schedule Phase 2** for next available window
6. **Implement Phase 3** prevention (ongoing)
7. **Set up Phase 4** monitoring (ongoing)

---

## ADDITIONAL NOTES

### Why NOT Use UNIQUE Constraints?

ClickHouse does NOT support UNIQUE constraints like PostgreSQL. The only ways to enforce uniqueness are:

1. **ReplacingMergeTree** - Requires proper ORDER BY + version column (complex)
2. **Application-layer deduplication** - Dedupe before insert (recommended)
3. **Periodic cleanup** - Run dedup scripts regularly (maintenance burden)

We recommend **Option 2** (application-layer) for new data + this one-time cleanup for existing data.

### Why ROW_NUMBER() Over DISTINCT?

```sql
-- ❌ DISTINCT doesn't let you choose which row to keep
SELECT DISTINCT ON (transaction_hash, log_index) *
FROM pm_trades_raw;

-- ✅ ROW_NUMBER() lets you pick most recent
SELECT *
FROM (
  SELECT *, ROW_NUMBER() OVER (...) AS rn
  FROM pm_trades_raw
)
WHERE rn = 1;
```

### Crash Protection for Backfills

Add to ingestion scripts:

```typescript
// Save checkpoint every 10k rows
const CHECKPOINT_INTERVAL = 10000;
let processedRows = 0;

for (const batch of batches) {
  await insertBatch(batch);
  processedRows += batch.length;

  if (processedRows % CHECKPOINT_INTERVAL === 0) {
    await saveCheckpoint(processedRows);
    console.log(`✅ Checkpoint: ${processedRows} rows`);
  }
}
```

### Rate Limiting for Workers

```typescript
// Use 8 workers without hitting rate limits
const WORKERS = 8;
const RATE_LIMIT = 100; // requests per second
const DELAY = 1000 / (RATE_LIMIT / WORKERS); // ms between requests

await Promise.all(
  Array(WORKERS).fill(0).map(async (_, i) => {
    for (const item of workItems.filter((_, idx) => idx % WORKERS === i)) {
      await processItem(item);
      await sleep(DELAY);
    }
  })
);
```

---

**Document Owner:** Claude 1 (Main Agent)
**Last Updated:** 2025-11-17 (PST)
**Status:** Ready for Execution
**Approval Required:** Yes (Scotty)
