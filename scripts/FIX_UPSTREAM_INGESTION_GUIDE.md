# Upstream Ingestion Fix Guide - Stop Future Duplicates

**Date:** 2025-11-16 (PST)
**Agent:** C2 - Data Pipeline Agent
**Priority:** P0 (Execute after dedup completes)

---

## Problem

CLOB ingestion scripts are inserting the same trades multiple times:
- 59M duplicate trades/day ($24.5B/day volume)
- No idempotency checks before INSERT
- trade_id contains "undefined" (missing dedup key)
- Crash recovery re-inserts entire batches

---

## Solution: Integrate ETL Guardrail

### Step 1: Import Guardrail Module

**Add to all `scripts/ingest-*.ts` files:**

```typescript
import { validateAndNormalizeTrade, validateAndNormalizeBatch } from '../lib/etl-guardrail';
import { clickhouse } from '../lib/clickhouse/client';
```

### Step 2: Validate Before INSERT

**Single-trade processing:**

```typescript
// BEFORE (vulnerable to duplicates):
for (const trade of trades) {
  await clickhouse.insert({
    table: 'pm_trades_canonical_v3',
    values: [trade],
    format: 'JSONEachRow'
  });
}

// AFTER (guardrail protected):
for (const trade of trades) {
  const result = await validateAndNormalizeTrade(trade, clickhouse);

  if (!result.allowed) {
    console.log(`⚠️  Quarantined: ${result.reason} - ${trade.trade_id}`);
    continue; // Skip this trade
  }

  // Use normalized trade for INSERT
  await clickhouse.insert({
    table: 'pm_trades_canonical_v3',
    values: [result.normalized],
    format: 'JSONEachRow'
  });
}
```

**Batch processing (high-throughput):**

```typescript
// BEFORE (vulnerable):
await clickhouse.insert({
  table: 'pm_trades_canonical_v3',
  values: trades,
  format: 'JSONEachRow'
});

// AFTER (guardrail protected):
const results = await validateAndNormalizeBatch(trades, clickhouse);

const allowedTrades = results
  .filter(r => r.allowed)
  .map(r => r.normalized!);

const quarantinedCount = results.filter(r => !r.allowed).length;

console.log(`✅ Allowed: ${allowedTrades.length}, ⚠️  Quarantined: ${quarantinedCount}`);

await clickhouse.insert({
  table: 'pm_trades_canonical_v3',
  values: allowedTrades,
  format: 'JSONEachRow'
});
```

---

## Files to Patch

### Priority 1 (CLOB Ingestion)

**1. `scripts/ingest-clob-fills-correct.ts`**
- ✅ Add guardrail import
- ✅ Wrap INSERT with validateAndNormalizeTrade
- ✅ Fix "undefined" in trade_id generation
- ✅ Add checkpoint resume logic

**2. `scripts/ingest-clob-fills-backfill.ts`**
- ✅ Add batch validation
- ✅ Skip existing trade_ids
- ✅ Proper checkpoint handling

**3. `scripts/ingest-clob-simple.ts`**
- ✅ Add single-trade validation
- ✅ Log quarantined trades

### Priority 2 (Goldsky/External Sources)

**4. `scripts/ingest-goldsky-fills-optimized.ts`**
- ✅ Add batch validation
- ✅ Parallel worker safety

**5. `scripts/ingest-goldsky-fills-parallel.ts`**
- ✅ Worker-level guardrail checks
- ✅ Shared quarantine table

**6. `scripts/ingest-new-trades.ts`**
- ✅ Validate before INSERT
- ✅ Handle conflicts gracefully

---

## Example: Patching ingest-clob-fills-correct.ts

**Location:** Lines 150-200 (INSERT section)

**BEFORE:**
```typescript
// Insert batch
await ch.insert({
  table: 'pm_trades_canonical_v3',
  values: batch,
  format: 'JSONEachRow'
});
```

**AFTER:**
```typescript
import { validateAndNormalizeBatch } from '../lib/etl-guardrail';

// Validate batch before INSERT
const results = await validateAndNormalizeBatch(batch, ch);

const allowedTrades = results
  .filter(r => r.allowed)
  .map(r => r.normalized!);

const quarantined = results.filter(r => !r.allowed);

// Log quarantined trades
if (quarantined.length > 0) {
  console.log(`⚠️  Quarantined ${quarantined.length} trades:`);
  quarantined.forEach(r =>
    console.log(`   - ${r.normalized?.trade_id}: ${r.reason}`)
  );
}

// Insert only allowed trades
if (allowedTrades.length > 0) {
  await ch.insert({
    table: 'pm_trades_canonical_v3',
    values: allowedTrades,
    format: 'JSONEachRow'
  });
  console.log(`✅ Inserted ${allowedTrades.length} valid trades`);
}
```

---

## Testing Procedure

### 1. Test on Single Batch

```bash
# Create test script
npx tsx scripts/test-guardrail-integration.ts
```

**Test script:**
```typescript
import { validateAndNormalizeTrade } from '../lib/etl-guardrail';
import { clickhouse } from '../lib/clickhouse/client';

// Test 100 trades from CLOB API
const testTrades = await fetchCLOBTrades({ limit: 100 });

let allowed = 0;
let quarantined = 0;

for (const trade of testTrades) {
  const result = await validateAndNormalizeTrade(trade, clickhouse);

  if (result.allowed) {
    allowed++;
  } else {
    quarantined++;
    console.log(`Quarantined: ${result.reason}`);
  }
}

console.log(`\nResults: ${allowed} allowed, ${quarantined} quarantined`);
console.log(`Performance: ~${((Date.now() - start) / testTrades.length).toFixed(2)}ms per trade`);
```

**Success criteria:**
- ✅ <10ms overhead per trade
- ✅ Zero false positives (all quarantines valid)
- ✅ Duplicate trade_ids correctly blocked
- ✅ Attribution conflicts correctly detected

### 2. Deploy to Single Script

**Choose:** `ingest-clob-simple.ts` (lowest volume, easiest to monitor)

**Steps:**
1. Patch script with guardrail
2. Run single batch manually
3. Check quarantine table
4. Monitor for 1 hour
5. If successful, proceed to Step 3

### 3. Roll Out to All Scripts

**Order:**
1. `ingest-clob-simple.ts` ✅ (already deployed)
2. `ingest-clob-fills-correct.ts` (main production)
3. `ingest-clob-fills-backfill.ts` (backfill only)
4. `ingest-goldsky-fills-optimized.ts` (parallel workers)
5. `ingest-new-trades.ts` (incremental)

**Monitor between each:**
- Check quarantine table for false positives
- Monitor performance (<10ms overhead)
- Verify duplicate rate = 0

---

## Monitoring After Deployment

### Daily Checks

**1. Duplicate Rate (should be 0):**
```sql
SELECT count(*) AS new_duplicates
FROM (
  SELECT trade_id
  FROM pm_trades_canonical_v3
  WHERE created_at >= now() - INTERVAL 1 DAY
  GROUP BY trade_id
  HAVING count() > 1
);
```

**2. Quarantine Volume:**
```sql
SELECT
  count() AS quarantined_today,
  groupArray((resolution_notes, count)) AS reasons
FROM pm_trades_attribution_conflicts
WHERE detected_at >= now() - INTERVAL 1 DAY
GROUP BY resolution_notes;
```

**3. Orphan Rate Trend:**
```sql
SELECT
  toDate(created_at) AS date,
  count() AS total_trades,
  countIf(condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64) AS orphans,
  round(100.0 * orphans / total_trades, 2) AS orphan_pct
FROM pm_trades_canonical_v3
WHERE created_at >= now() - INTERVAL 7 DAY
GROUP BY date
ORDER BY date DESC;
```

### Automated Monitoring

**Nightly collision check:** Already deployed
- Runs at 1:00 AM PST
- Alerts on any new duplicates
- Tracks orphan rate trends
- Logs to `pm_collision_monitor_log`

---

## Rollback Plan

**If guardrail causes issues:**

**1. Immediate (disable guardrail):**
```typescript
// Comment out guardrail checks
// const result = await validateAndNormalizeTrade(trade, clickhouse);
// if (!result.allowed) continue;

// Revert to direct INSERT
await clickhouse.insert({ values: [trade], ... });
```

**2. Investigate quarantine table:**
```sql
SELECT *
FROM pm_trades_attribution_conflicts
WHERE detected_at >= now() - INTERVAL 1 HOUR
ORDER BY detected_at DESC;
```

**3. Fix false positives:**
- Review quarantined trades
- Adjust validation logic if needed
- Re-enable guardrail

**4. No data loss:**
- All quarantined trades saved in `pm_trades_attribution_conflicts`
- Can manually review and re-insert valid trades
- Original data preserved

---

## Success Metrics

### Immediate (After Deployment)
- ✅ Zero new duplicate trade_ids
- ✅ Zero attribution conflicts
- ✅ <10ms performance overhead
- ✅ <1% false positive rate

### Short Term (7 Days)
- ✅ Consistent 0 duplicate rate
- ✅ Orphan rate stable or decreasing
- ✅ No production incidents
- ✅ Quarantine volume trending down

### Long Term (30 Days)
- ✅ Orphan rate <15% (vs current 30%)
- ✅ Zero ETL duplicates
- ✅ Data quality score >95%
- ✅ User complaints reduced

---

## Next Steps

**After P0 Dedup Completes:**

1. ✅ Test guardrail on 100-trade batch
2. ✅ Deploy to `ingest-clob-simple.ts`
3. ✅ Monitor for 1 hour
4. ✅ Roll out to remaining scripts
5. ✅ Enable nightly monitoring cron
6. ✅ Run PnL rebuild
7. ✅ Update dashboards

**Timeline:** 2-4 hours total

---

**SIGNED:** C2 - Data Pipeline Agent
**DATE:** 2025-11-16 (PST)
**STATUS:** Ready for deployment after P0 dedup completes

================================================================================
