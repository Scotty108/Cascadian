# Resolution Backfill Optimization Notes

## Current Performance

**Phase 1 Status:**
- Rate: 2.2 markets/sec
- ETA: ~9 hours for 71,161 markets
- Bottleneck: 100ms delay between API requests

## Immediate Observations

### Rate Limiting Strategy
Current: 100ms fixed delay between requests
- Conservative approach (10 requests/sec max)
- Prevents API throttling
- But: Polymarket API might support higher rates

### API Response Patterns
From initial samples:
- Many "90+ day old" markets are actually still open (marked ○)
- These get skipped (no insert)
- Wasted API calls on markets that won't resolve

## Optimizations for Phase 2 & Future Runs

### 1. Batch API Requests (High Impact)

**Current:** One condition_id per request
```typescript
const url = `${POLYMARKET_API}/markets?condition_id=${conditionId}`;
```

**Optimized:** Batch request (if API supports)
```typescript
// Check if Gamma API supports multiple condition_ids
const url = `${POLYMARKET_API}/markets?condition_ids=${ids.join(',')}`;
```

**Impact:** Could reduce from 9 hours → 1-2 hours (5-9x speedup)

**Action:** Test API with multiple condition_ids before Phase 2

### 2. Pre-filter Open Markets (Medium Impact)

**Problem:** Wasting API calls on markets that are still open

**Solution:** Query CLOB API first to check market status
```typescript
// Batch check market status
const statusCheck = await fetch(
  `https://clob.polymarket.com/markets?status=closed&condition_ids=${ids}`
);
// Only fetch resolution for closed markets
```

**Impact:** Could skip 20-40% of API calls

### 3. Parallel Workers (High Impact - Use Carefully)

**Current:** Single-threaded backfill

**Optimized:** 2-4 parallel workers
```typescript
// Split input into chunks
const chunks = splitIntoChunks(markets, 4);

// Run workers in parallel
await Promise.all(chunks.map((chunk, i) => 
  runWorker(chunk, `worker-${i}`)
));
```

**Risks:**
- API rate limiting (need to test)
- Race conditions on inserts (ClickHouse handles this OK)
- Harder to monitor progress

**Impact:** 2-4x speedup if API allows

### 4. Smarter Checkpointing (Low Impact)

**Current:** Checkpoint every 1000 markets

**Optimized:** Checkpoint based on successes
```typescript
if (checkpoint.successful % 500 === 0) {
  saveCheckpoint();
}
```

**Impact:** Saves I/O, doesn't affect speed much

### 5. Database Insert Batching (Medium Impact)

**Current:** Individual inserts per market
```typescript
await ch.insert({
  table: 'default.market_resolutions_final',
  values: [singleRow],
  format: 'JSONEachRow'
});
```

**Optimized:** Batch inserts every 100-500 markets
```typescript
const buffer = [];
// Collect rows...
buffer.push(row);

if (buffer.length >= 100) {
  await ch.insert({
    table: 'default.market_resolutions_final',
    values: buffer,
    format: 'JSONEachRow'
  });
  buffer = [];
}
```

**Impact:** Reduces ClickHouse connection overhead, 10-20% faster

## Recommended Immediate Actions

### For Current Phase 1 Run:
- ✅ Let it run (already 100+ markets processed)
- Monitor checkpoint file growth
- If success rate < 30%, consider stopping and pre-filtering

### For Phase 2 (Tonight):
1. **Test batch API requests** (5 min test)
   ```bash
   npx tsx test-batch-market-fetch.ts
   ```

2. **If batching works:** Rewrite backfill script to use batches of 10-50
   - Expected speedup: 5-10x
   - Phase 2 (60K markets): 1-2 hours instead of 7-8 hours

3. **If batching doesn't work:** Implement parallel workers (2-3 workers)
   - Expected speedup: 2-3x
   - Test with small sample first

### For Tomorrow (Phase 3 + All IDs):
1. Implement full optimization stack:
   - Batch API requests (if supported)
   - Parallel workers (2-4)
   - Database insert batching
   - Pre-filter with CLOB status check

2. Expected performance:
   - Current: 2.2 markets/sec
   - Optimized: 20-50 markets/sec
   - 171K markets: 1-2 hours instead of 20+ hours

## Schema Improvements

### Add Metadata Fields

Current schema is minimal. Consider adding:

```sql
ALTER TABLE default.market_resolutions_final ADD COLUMN
  api_fetched_at DateTime DEFAULT now(),
  market_closed_at Nullable(DateTime),
  market_end_date_iso Nullable(String),
  volume Nullable(Float64),
  num_traders Nullable(UInt32);
```

**Benefit:** Richer data for analysis, debugging

### Add Status Tracking Table

Create audit table for backfill runs:

```sql
CREATE TABLE default.resolution_backfill_log (
  run_id String,
  started_at DateTime,
  completed_at Nullable(DateTime),
  input_file String,
  total_markets UInt32,
  successful UInt32,
  failed UInt32,
  skipped UInt32,
  avg_rate Float64
) ENGINE = MergeTree()
ORDER BY started_at;
```

**Benefit:** Track backfill history, performance trends

## API Rate Limit Testing

Need to test Polymarket API limits:

```typescript
// Test script: test-api-rate-limits.ts
async function testRateLimit() {
  const start = Date.now();
  const requests = [];

  // Fire 100 requests as fast as possible
  for (let i = 0; i < 100; i++) {
    requests.push(fetch(`${POLYMARKET_API}/markets?condition_id=${sampleIds[i]}`));
  }

  await Promise.all(requests);
  const elapsed = Date.now() - start;

  console.log(`100 requests in ${elapsed}ms`);
  console.log(`Rate: ${100 / (elapsed / 1000)} req/sec`);
}
```

**Run this before Phase 2 to optimize delay settings**

## Success Metrics

Track these after Phase 1 completes:

1. **Success Rate:** successful / (successful + failed + skipped)
   - Target: >30% (many old markets may still be open)

2. **Coverage Gain:** New P&L coverage % - baseline 11.88%
   - Target: >20% absolute gain (to ~32%+)

3. **Resolved Positions:** New resolved count - baseline 1.7M
   - Target: >1M additional positions

4. **Inserts per Hour:** checkpoint.successful / hours_elapsed
   - Current est: ~7,920/hour (2.2/sec)
   - Optimized target: 50,000+/hour

## Conclusion

**Current run:** Let it finish, collect metrics
**Phase 2:** Test batch API, implement if supported
**Phase 3:** Full optimization for remaining 100K+ markets

The 9-hour ETA is acceptable for overnight run, but we can 5-10x this for future backfills.
