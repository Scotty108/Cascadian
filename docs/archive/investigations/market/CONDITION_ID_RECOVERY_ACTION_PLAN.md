# Condition ID Recovery - Action Plan

## Situation

77.4M trades are missing condition_ids. The erc1155_transfers table was supposed to provide this data via blockchain lookups, but investigation reveals it's incomplete test data, not a production backfill.

## Root Cause

1. **Column naming**: Secondary Claude used wrong column name (`tx_hash` instead of `transaction_hash`)
2. **Incomplete data**: erc1155_transfers has only 85K valid transfers from a 4-minute window on Nov 8
3. **Data quality**: 71% of table has broken timestamps (epoch 0)
4. **Coverage gap**: Need 32M unique transactions, have only 126K (0.4%)

## Recovery Options

### Option A: Polymarket API (RECOMMENDED - Try First)

**Approach**: Fetch condition_id via market_id from Polymarket API

**Pros:**
- Fast (API calls vs blockchain indexing)
- Cheap (no RPC costs)
- Simple implementation

**Cons:**
- Depends on API availability
- May not have historical data for all markets

**Implementation:**
```typescript
// Pseudo-code
async function recoverFromAPI(marketId: string) {
  const response = await fetch(`https://polymarket-api.com/markets/${marketId}`);
  const { conditionId } = await response.json();
  return conditionId;
}

// Batch process
const uniqueMarkets = await getUniqueMarketIds(); // Get from trades_raw
for (const marketId of uniqueMarkets) {
  const conditionId = await recoverFromAPI(marketId);
  await updateTradesByMarket(marketId, conditionId);
}
```

**Estimate:**
- Unique markets in missing trades: ~1-10K (need to check)
- API rate limit: ~100/sec typical
- Runtime: 10-100 seconds
- Cost: Free (public API)

**Next steps:**
1. Check Polymarket API docs for market endpoints
2. Verify API returns condition_id
3. Count unique market_ids in missing trades
4. Build recovery script

---

### Option B: Blockchain Backfill (If API Unavailable)

**Approach**: Index ERC1155 transfers from blockchain for all 32M transactions

**Pros:**
- Complete data coverage
- No API dependency
- Future-proof (can index ongoing)

**Cons:**
- Expensive (32M RPC calls or archive node required)
- Slow (days to weeks depending on rate limits)
- Complex error handling

**Implementation Strategy:**

**Phase 1: Scope Definition**
```sql
-- Get unique transaction_hashes that need recovery
CREATE TABLE recovery_targets AS
SELECT DISTINCT transaction_hash
FROM trades_raw
WHERE condition_id = '' OR condition_id IS NULL
-- Result: ~32M hashes
```

**Phase 2: Batched Fetching**
```typescript
// Fetch in batches of 1000 transactions
const BATCH_SIZE = 1000;
const RATE_LIMIT = 100; // calls per second

async function fetchERC1155Batch(txHashes: string[]) {
  const receipts = await Promise.all(
    txHashes.map(hash =>
      web3.eth.getTransactionReceipt(hash)
    )
  );

  return receipts
    .filter(r => r.logs.some(isERC1155Transfer))
    .map(extractConditionId);
}

// Process with rate limiting
for (let i = 0; i < 32_000_000; i += BATCH_SIZE) {
  const batch = targets.slice(i, i + BATCH_SIZE);
  const data = await fetchERC1155Batch(batch);
  await insertToClickhouse(data);
  await sleep(BATCH_SIZE / RATE_LIMIT * 1000);
}
```

**Estimate:**
- Transactions to fetch: 32M
- Rate limit: 100/sec (typical public RPC)
- Runtime: 32M / 100 / 3600 = ~89 hours (3.7 days)
- Cost: $0-500 depending on RPC provider (Alchemy/Infura tiers)

**Optimization:**
- Use archive node for parallel requests (reduce to hours)
- Filter by block range to reduce calls
- Cache transaction receipts locally

**Next steps:**
1. Set up Alchemy/Infura account with suitable tier
2. Build batched fetcher with retry logic
3. Implement checkpointing for resume-ability
4. Run small pilot (1000 txs) to validate

---

### Option C: Hybrid Approach (BALANCED)

**Approach**: Combine API + blockchain for optimal cost/speed

**Strategy:**
1. Use Polymarket API for active/recent markets (covers 80%?)
2. Use blockchain backfill for historical/inactive markets (remaining 20%)
3. Prioritize by trade volume (recover high-activity wallets first)

**Implementation:**
```typescript
// Step 1: API recovery (fast)
const recentMarkets = await getMarketsAfter('2024-06-01');
for (const market of recentMarkets) {
  const conditionId = await fetchFromAPI(market.id);
  if (conditionId) {
    await updateTrades(market.id, conditionId);
  }
}

// Step 2: Blockchain backfill (remaining)
const stillMissing = await getTradesWithoutConditionId();
await backfillFromBlockchain(stillMissing);
```

**Estimate:**
- API recovery: 80% in <1 hour
- Blockchain backfill: 20% in ~18 hours
- Total runtime: ~1 day
- Cost: <$100

---

## Recommended Path

### Immediate (1-2 hours)
1. ✅ **Investigate data structure** (COMPLETE)
2. ✅ **Identify root cause** (COMPLETE)
3. **Check Polymarket API** (next step)
   - Review API docs: https://docs.polymarket.com/
   - Test market endpoint for condition_id field
   - Count unique market_ids in missing trades

### Short-term (1-3 days)
4. **Pilot API recovery** (if available)
   - Test on 100 markets
   - Validate condition_id accuracy
   - Measure coverage rate

5. **Implement full recovery**
   - Option A if API covers >90%
   - Option C if API covers 50-90%
   - Option B if API unavailable

### Medium-term (1 week)
6. **Fix erc1155_transfers ingestion**
   - Debug timestamp parsing (71% broken)
   - Implement proper backfill pipeline
   - Add data quality checks

7. **Continuous indexing**
   - Set up real-time ERC1155 monitoring
   - Prevent future gaps

---

## Success Metrics

- **Coverage**: >99% of trades have valid condition_id
- **Accuracy**: Spot-check 100 random recoveries match blockchain
- **Performance**: Recovery completes in <48 hours
- **Cost**: Total spend <$200 (RPC + API)

---

## Files Reference

- Investigation report: `/Users/scotty/Projects/Cascadian-app/TX_HASH_INVESTIGATION_REPORT.md`
- Investigation script: `/Users/scotty/Projects/Cascadian-app/investigate-tx-hash-matching.ts`
- Schema check: `/Users/scotty/Projects/Cascadian-app/check-trades-schema.ts`

---

## Next Action

**Run this query** to understand market_id coverage:

```sql
SELECT
  COUNT(DISTINCT market_id) as unique_markets,
  COUNT(*) as total_trades,
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest
FROM trades_raw
WHERE condition_id = '' OR condition_id IS NULL
```

This will tell us:
- How many unique markets need recovery (is it 1K or 100K?)
- Whether API-based recovery is feasible
- Time range for prioritization

Then check Polymarket API docs to see if we can fetch condition_id by market_id.
