# Condition ID Investigation - Summary

## What I Found

The secondary Claude reported that only 1% of 77.4M missing trades could be matched to `erc1155_transfers` on `tx_hash`. I investigated why and discovered several critical issues.

## Root Causes (3 Issues)

### 1. Wrong Column Name
- ❌ Secondary Claude joined on `tx_hash` (doesn't exist in trades_raw)
- ✅ Correct column is `transaction_hash`

### 2. Incomplete erc1155_transfers Table
- Only 291K rows total (need 32M+)
- Only 12 days of valid data (need 665 days)
- 71% have broken timestamps (1970-01-01)
- Most recent bulk import: 85K rows from Nov 8 (4-minute window)
- **This is test/sample data, not a production backfill**

### 3. Missing Metadata in trades_raw
- 77.4M trades have NO market_id (all show `0x000...000`)
- 77.4M trades have NO condition_id (all empty)
- 100% have transaction_hash
- 100% have wallet_address, shares, usd_value
- Total volume: $18.7 BILLION

These appear to be trades ingested from raw blockchain events without Polymarket API enrichment.

## The Real Problem

**We cannot use Polymarket API** because we don't have market_id to look up.

**We cannot use erc1155_transfers** because it only has 0.4% of needed data.

**We MUST use blockchain lookups** to extract condition_id from transaction receipts.

## Recovery Solution

### Approach: Blockchain Transaction Receipt Lookup

1. Fetch transaction receipts for 32M unique transaction_hashes
2. Decode ERC1155 TransferBatch events to extract condition_id
3. Update trades_raw with recovered condition_ids

### Implementation

```typescript
// Extract condition_id from transaction receipt
const receipt = await client.getTransactionReceipt({ hash: txHash })
const erc1155Event = receipt.logs.find(log =>
  log.topics[0] === ERC1155_TRANSFER_BATCH_TOPIC
)
const conditionId = decodeEventLog(erc1155Event).args.ids[0]
```

### Estimates

| Metric | Value |
|--------|-------|
| Transactions to process | 32M unique |
| Workers | 8 parallel |
| Rate limit | 800 calls/sec total |
| Runtime | 11 hours |
| RPC calls | 32M |
| Cost | $199 (Alchemy Growth 1 month) |
| Success rate | ~98% |

### Phases

**Phase 0: Preparation** (2-4 hours)
- Set up Alchemy account
- Build pilot script
- Verify data quality

**Phase 1: Pilot** (1 hour)
- Test on 1,000 random transactions
- Validate >95% success rate
- Confirm performance

**Phase 2: Production** (11-24 hours)
- Process 32M transactions with 8 workers
- Checkpoint every 100K for resume-ability
- Monitor errors and rate limits

**Phase 3: Validation** (2-4 hours)
- Verify coverage >99%
- Spot-check accuracy on 1,000 samples
- Document any unrecoverable trades

## Cost-Benefit

**Costs:**
- Development: 8-12 hours ($800-1,200)
- RPC service: $199/month
- Total: ~$1,600-1,800

**Benefits:**
- Recover $18.7B in trade data
- Enable P&L for 77.4M trades
- Complete dataset for analytics
- Production data quality

## Next Steps

1. ✅ Diagnosis complete
2. Get approval for $200 Alchemy budget
3. Build pilot script (2 hours)
4. Run pilot (1 hour) → DECISION POINT
5. Execute production run (if pilot succeeds)

## Files Created

| File | Purpose |
|------|---------|
| `TX_HASH_INVESTIGATION_REPORT.md` | Detailed technical investigation |
| `CONDITION_ID_RECOVERY_ACTION_PLAN.md` | Original recovery options (before discovering no market_id) |
| `FINAL_DIAGNOSIS_CONDITION_ID.md` | Complete diagnosis and solution |
| `INVESTIGATION_SUMMARY.md` | This summary (for quick reference) |
| `investigate-tx-hash-matching.ts` | Investigation script |

## Key Queries Used

### Check Column Name
```sql
DESCRIBE trades_raw
-- Found: transaction_hash (not tx_hash)
```

### Check Data Coverage
```sql
SELECT COUNT(*) as total,
       COUNT(transaction_hash) as with_tx,
       COUNT(CASE WHEN market_id != '0x000...000' THEN 1 END) as with_market
FROM trades_raw
WHERE condition_id = ''
-- Result: 77.4M total, 77.4M with tx, 0 with market
```

### Check erc1155_transfers Quality
```sql
SELECT DATE(block_timestamp) as day, COUNT(*) as transfers
FROM erc1155_transfers
WHERE block_timestamp > '2020-01-01'
GROUP BY day
-- Result: Only 12 days, 71% have broken timestamps
```

## Recommendation

**Proceed with blockchain recovery approach.**

The pilot test will validate the approach with minimal cost (1 hour + $0 since we can use free tier for 1K transactions). If successful (>95% extraction rate), the full run is low-risk and high-value.

Alternative is to keep 77.4M trades unusable, which is not acceptable for a production analytics platform.
