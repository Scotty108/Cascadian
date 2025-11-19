# Final Diagnosis: Condition ID Recovery

## Executive Summary

**77.4M trades with $18.7B volume are missing both condition_id AND market_id.** These appear to be trades ingested from blockchain events without Polymarket API enrichment. The ONLY recovery path is blockchain lookups using the transaction_hash values (which exist for 100% of trades).

## The Data

### What We Have
- ✅ **transaction_hash**: 100% coverage (32M unique hashes)
- ✅ **wallet_address**: 100% coverage
- ✅ **shares, usd_value**: 99.9% coverage
- ✅ **timestamp**: 100% coverage (Jan 2024 - Oct 2025)

### What We Don't Have
- ❌ **condition_id**: 0% (empty string)
- ❌ **market_id**: 0% (null bytes: `0x00000...000`)
- ❌ **trade_id format broken**: Contains `"undefined"` literal

### Sample Trade
```json
{
  "trade_id": "0xec8f967bac5878b62ddc23b9d03cd51218fa6eb74c7c6e119a4badfbcfa38e55-undefined-maker",
  "wallet_address": "0x00000000000050ba7c429821e6d66429452ba168",
  "market_id": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "condition_id": "",
  "transaction_hash": "0xec8f967bac5878b62ddc23b9d03cd51218fa6eb74c7c6e119a4badfbcfa38e55",
  "shares": 2.5,
  "usd_value": 5
}
```

## Root Cause Analysis

### Data Ingestion Pattern

These trades appear to come from two different sources:

**Source 1: Polymarket CLOB API** (minority of trades)
- Has market_id, condition_id populated
- Complete metadata
- Trade IDs follow proper format

**Source 2: Raw Blockchain Events** (77.4M trades - majority)
- Only has on-chain data: tx_hash, wallet, shares, value
- Missing all Polymarket-specific metadata
- Trade IDs have "undefined" where market_id should be

### Why This Happened

Likely scenarios:
1. **Backfill from blockchain first**, Polymarket enrichment later (never completed)
2. **Two separate ingestion pipelines** that weren't merged properly
3. **CLOB API rate limits** forced fallback to blockchain-only ingestion

## Recovery Options Analysis

### Option A: Polymarket API (NOT VIABLE)
- ❌ Cannot look up by market_id (we don't have it)
- ❌ Cannot look up by condition_id (that's what we're trying to find)
- ❌ API doesn't support tx_hash → condition_id lookup

**Status**: Ruled out

---

### Option B: Blockchain Transaction Receipt Lookup (REQUIRED)

**Approach**: Fetch transaction receipts for 32M unique transaction hashes and extract condition_id from ERC1155 event logs.

#### How ERC1155 Transfers Work

Every Polymarket trade creates an ERC1155 transfer event with:
```solidity
event TransferBatch(
  address indexed operator,
  address indexed from,
  address indexed to,
  uint256[] ids,        // <-- condition_ids are here
  uint256[] values
)
```

The `ids` array contains the condition_id(s) involved in the trade.

#### Implementation Strategy

**Step 1: Batch Fetch Transaction Receipts**
```typescript
import { createPublicClient, http } from 'viem'
import { polygon } from 'viem/chains'

const client = createPublicClient({
  chain: polygon,
  transport: http(process.env.ALCHEMY_RPC_URL)
})

async function extractConditionId(txHash: string): Promise<string | null> {
  const receipt = await client.getTransactionReceipt({ hash: txHash })

  // Find ERC1155 TransferBatch or TransferSingle events
  const erc1155Events = receipt.logs.filter(log =>
    log.topics[0] === ERC1155_TRANSFER_BATCH_TOPIC ||
    log.topics[0] === ERC1155_TRANSFER_SINGLE_TOPIC
  )

  if (erc1155Events.length === 0) return null

  // Decode the event to get condition_id
  const decoded = decodeEventLog({
    abi: erc1155Abi,
    data: erc1155Events[0].data,
    topics: erc1155Events[0].topics
  })

  // Return first condition_id (most trades involve single market)
  return decoded.args.ids[0]
}
```

**Step 2: Parallel Processing with Rate Limiting**
```typescript
const BATCH_SIZE = 1000
const WORKERS = 8
const RATE_LIMIT = 100 // calls/sec per worker

async function backfillConditionIds() {
  // Get all unique transaction hashes
  const targets = await clickhouse.query(`
    SELECT DISTINCT transaction_hash
    FROM trades_raw
    WHERE condition_id = '' OR condition_id IS NULL
  `)

  const chunks = chunkArray(targets, BATCH_SIZE)

  // Process in parallel with workers
  await Promise.all(
    Array(WORKERS).fill(0).map(async (_, workerId) => {
      for (let i = workerId; i < chunks.length; i += WORKERS) {
        const chunk = chunks[i]
        const results = await Promise.all(
          chunk.map(extractConditionId)
        )

        // Update ClickHouse
        await updateConditionIds(results)

        // Rate limit
        await sleep(BATCH_SIZE / RATE_LIMIT * 1000)
      }
    })
  )
}
```

**Step 3: Atomic Update in ClickHouse**
```sql
-- Create temporary table with recovery results
CREATE TABLE condition_id_recovery (
  transaction_hash String,
  condition_id String,
  recovery_timestamp DateTime
) ENGINE = Memory

-- Insert recovery data
INSERT INTO condition_id_recovery VALUES ...

-- Update trades_raw using ALTER UPDATE (for ReplacingMergeTree)
-- OR rebuild table with JOIN (for production)
CREATE TABLE trades_raw_recovered AS
SELECT
  t.*,
  COALESCE(r.condition_id, t.condition_id) as condition_id,
  r.recovery_timestamp
FROM trades_raw t
LEFT JOIN condition_id_recovery r USING (transaction_hash)

-- Atomic swap
RENAME TABLE trades_raw TO trades_raw_old,
             trades_raw_recovered TO trades_raw

-- Verify and cleanup
DROP TABLE trades_raw_old
```

#### Cost & Time Estimates

**Assumptions:**
- Unique transactions: 32M
- Workers: 8
- Rate limit: 100 calls/sec per worker = 800 calls/sec total
- RPC provider: Alchemy Growth tier ($199/month, 10M requests/day limit)

**Estimates:**
- **Runtime**: 32M / 800 / 3600 = ~11 hours
- **RPC calls**: 32M (within 10M/day limit with multi-day run)
- **Cost**: $199/month (1 month)
- **Success rate**: ~98% (some txs may not have ERC1155 events)

**Optimization Options:**
1. Use archive node for faster parallel requests (reduce to 2-3 hours)
2. Cache receipts locally to enable retries
3. Checkpoint progress every 100K transactions

#### Risk Mitigation

1. **Pilot Test** (1 hour)
   - Test on 1,000 random transaction_hashes
   - Validate condition_id extraction accuracy
   - Measure actual RPC performance

2. **Phased Rollout** (2-3 days)
   - Day 1: Process 10M transactions (33%)
   - Day 2: Process 10M transactions (66%)
   - Day 3: Process remaining 12M (100%)
   - Spot-check accuracy at each phase

3. **Fallback Strategy**
   - If RPC rate limits hit: reduce to 4 workers
   - If accuracy < 95%: review event decoding logic
   - If missing events: flag for manual review (acceptable <2% loss)

---

### Option C: Hybrid (NOT APPLICABLE)

Since we have no market_id, cannot use API at all. Must use blockchain-only approach.

---

## Recommended Path Forward

### Phase 0: Preparation (2-4 hours)

1. **Set up Alchemy account**
   - Growth tier: $199/month, 10M requests/day
   - Alternative: Infura with similar tier

2. **Build pilot script** (`scripts/pilot-condition-id-recovery.ts`)
   - Test on 1,000 random transactions
   - Validate ERC1155 event decoding
   - Measure performance and cost

3. **Verify data quality**
   - Spot-check 100 recovered condition_ids against Polymarket
   - Confirm they match valid markets

### Phase 1: Pilot Validation (1 hour)

```bash
npx tsx scripts/pilot-condition-id-recovery.ts
```

**Success criteria:**
- ✅ >95% of transactions have ERC1155 events
- ✅ Extracted condition_ids match Polymarket format (64-char hex)
- ✅ RPC performance meets 100 calls/sec target
- ✅ No rate limit errors

### Phase 2: Production Run (11-24 hours)

```bash
npx tsx scripts/full-condition-id-recovery.ts \
  --workers 8 \
  --batch-size 1000 \
  --checkpoint-interval 100000
```

**Monitor:**
- Progress: Transactions processed per hour
- Errors: RPC failures, decoding errors, missing events
- Cost: API usage dashboard

### Phase 3: Validation & Cleanup (2-4 hours)

1. **Count coverage**
   ```sql
   SELECT
     COUNT(*) as total,
     COUNT(CASE WHEN condition_id != '' THEN 1 END) as recovered,
     ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
   FROM trades_raw
   ```

2. **Spot-check accuracy** (sample 1000 random recovered records)

3. **Document unrecoverable trades** (if any)

4. **Update schema** to prevent future gaps
   ```sql
   ALTER TABLE trades_raw
   ADD COLUMN recovery_method String DEFAULT 'blockchain',
   ADD COLUMN recovered_at DateTime
   ```

---

## Cost-Benefit Analysis

### Costs
- **Development**: 8-12 hours ($800-1200 @ $100/hr)
- **RPC service**: $199/month (1 month)
- **Testing**: 4 hours ($400)
- **Total**: ~$1,600-1,800

### Benefits
- **Recover $18.7B in trade data** (currently unusable without condition_id)
- **Enable P&L calculations** for 77.4M trades
- **Complete dataset** for wallet analytics
- **Professional data quality** (vs 77M missing records)

### ROI
- If this enables even 1 additional customer: Pays for itself
- Data completeness is table stakes for production analytics platform

---

## Next Steps

1. ✅ **Diagnosis complete** (this document)
2. **Get approval** for $200 Alchemy budget
3. **Build pilot script** (2 hours)
4. **Run pilot** (1 hour)
5. **Review pilot results** → Decision point
6. **Execute production run** (if pilot succeeds)

---

## Files

- This report: `/Users/scotty/Projects/Cascadian-app/FINAL_DIAGNOSIS_CONDITION_ID.md`
- Investigation: `/Users/scotty/Projects/Cascadian-app/TX_HASH_INVESTIGATION_REPORT.md`
- Action plan: `/Users/scotty/Projects/Cascadian-app/CONDITION_ID_RECOVERY_ACTION_PLAN.md`
- Investigation script: `/Users/scotty/Projects/Cascadian-app/investigate-tx-hash-matching.ts`

---

## Decision Required

**Proceed with blockchain recovery?**
- Cost: ~$1,800 (dev + RPC)
- Time: 3-4 days
- Risk: Low (proven approach, reversible)
- Benefit: Recover $18.7B in unusable trade data

Recommended: **Yes, proceed with pilot first to validate approach.**
