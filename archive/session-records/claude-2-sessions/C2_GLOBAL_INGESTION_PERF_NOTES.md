# Global Ghost Ingestion Performance Analysis

**Date:** 2025-11-16T04:30:00Z
**Agent:** C2 - External Data Ingestion
**Script:** `scripts/222-batch-ingest-global-ghost-wallets.ts`

---

## Current Performance Controls

### Constants (Hard-coded)

```typescript
const BATCH_SIZE = 500;                // Process 500 wallets per batch
const WALLET_TIMEOUT_MS = 30000;       // 30 seconds per wallet query
```

### Sequential Processing

**Current implementation:** Wallets are processed **sequentially** (one at a time) within each batch.

```typescript
for (const wallet of wallets) {
  const activities = await fetchActivitiesForWallet(wallet, allConditionIds);
  // ...
  await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
}
```

**Key finding:** NO concurrent fetching. This is the primary performance bottleneck.

### Delay Settings

| Delay Type | Duration | Location | Purpose |
|------------|----------|----------|---------|
| Per-wallet delay | **100ms** | Line 265 | Avoid overwhelming API |
| Between-batch delay | **2000ms** (2 sec) | Line 523 | Cool-down between batches |
| Rate limit backoff | **5000ms** (5 sec) | Line 177 | Retry after HTTP 429 |

### Concurrency Level

**Current:** `1` (sequential processing)
**Bottleneck:** Each batch of 500 wallets takes ~4.5 minutes
- 500 wallets × 100ms delay = 50 seconds minimum
- Plus actual API request time (~3.5 min)
- Total: ~4.5 minutes per batch

---

## Observed Performance (Batch 1 Results)

**Configuration:**
- Batch size: 500 wallets
- Concurrency: 1 (sequential)
- Delays: 100ms per wallet, 2s per batch

**Results:**
- Wallets processed: 498 (2 timeouts)
- Duration: 4.5 minutes
- Throughput: ~110 wallets/minute
- Trades inserted: 23,442
- No rate limiting encountered (no 429 errors)

**Key insight:** The API handled sequential requests with 100ms delays without any rate limiting. This suggests room for higher concurrency.

---

## Performance Bottlenecks

1. **Sequential processing** (biggest bottleneck)
   - Only 1 wallet fetched at a time
   - 100ms delay between each = minimum 50 seconds per 500 wallets

2. **Conservative batch size**
   - 500 wallets per batch
   - Could be increased to 1000 or more

3. **Conservative delays**
   - 100ms per wallet may be unnecessary with proper concurrency control
   - 2 second batch delay adds overhead

---

## Proposed Improvements

### 1. Add Concurrent Wallet Fetching

Replace sequential `for` loop with concurrent `Promise.all` with concurrency limit:

```typescript
// Current (sequential):
for (const wallet of wallets) {
  await fetchActivitiesForWallet(wallet, ...);
}

// Proposed (concurrent):
await processConcurrently(wallets, MAX_CONCURRENCY, fetchActivitiesForWallet);
```

### 2. Make Settings Configurable via CLI

Add CLI flags:
- `--max-concurrency <number>` - Control concurrent requests
- `--batch-size <number>` - Control wallets per batch
- `--wallet-delay-ms <number>` - Control delay between wallet requests
- `--batch-delay-ms <number>` - Control delay between batches

### 3. Define Safe vs Fast Modes

**Safe Mode (current defaults):**
- Max concurrency: `4`
- Batch size: `500`
- Wallet delay: `50ms`
- Estimated throughput: ~200 wallets/minute

**Fast Mode (aggressive but safe):**
- Max concurrency: `16`
- Batch size: `1000`
- Wallet delay: `0ms` (rely on concurrency control)
- Estimated throughput: ~800-1000 wallets/minute

---

## Rate Limit Considerations

**Observed:** No 429 errors with sequential requests + 100ms delays

**Conservative estimate:** Polymarket Data-API likely supports:
- 10-20 concurrent requests safely
- 100-200 requests per minute

**Proposed approach:**
- Start with concurrency = 8 (medium)
- Monitor for 429 errors
- Automatically back off if rate limited
- Keep existing 5-second retry logic on 429

---

## Next Steps

1. ✅ Document current performance (this file)
2. ⏳ Add CLI flags for performance tuning
3. ⏳ Implement concurrent wallet fetching
4. ⏳ Test with small batches to verify checkpoints work
5. ⏳ Create operator guide with safe/fast mode examples

---

**— C2 (External Data Ingestion Agent)**

_Performance analysis complete. Ready to implement CLI controls and concurrency._
