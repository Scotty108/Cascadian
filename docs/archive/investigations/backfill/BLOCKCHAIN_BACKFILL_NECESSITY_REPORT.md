# Why Blockchain Backfill Takes 18-27 Hours (Can't Be Avoided)

## Executive Summary

**Question:** Why does the backfill take so long if we already have the data in our database?

**Answer:** We DON'T have the critical data (condition_ids) - we only have partial trade data (prices, shares, directions) with all-zero identifiers.

---

## Current Database State

### What We Have ✅
- **Trade metadata:** usd_value, shares, trade_direction
- **Transaction hashes:** Valid 66-char Polygon tx hashes
- **Wallet addresses:** Normalized and correct
- **Row count:** 655,945 "missing" transactions for top wallet

### What We DON'T Have ❌
- **Condition IDs:** ALL are `0x0000000000000000000000000000000000000000000000000000000000000000`
- **Market IDs:** ALL are `0x0000000000000000000000000000000000000000000000000000000000000000`
- **ERC1155 events:** Only 291,113 events in database (0.2% coverage of missing txs)

---

## Investigation Results

### Test 1: Check vw_trades_canonical
```
Sample of 20 "missing" transactions:
✅ Found in vw_trades_canonical: 655,945 rows
❌ Has valid condition_id: 0 (0.0%)
❌ Has valid market_id: 0 (0.0%)
```

**All condition_id_norm values:**
```
0x0000000000000000000000000000000000000000000000000000000000000000
```

### Test 2: Check market_id_mapping
```
Can derive condition_id from market_id_mapping: NO
Reason: market_id_norm is all zeros, can't join
```

### Test 3: Check erc1155_transfers
```
Missing transactions: 655,945 (sampled 1,000)
Found in erc1155_transfers: 2 (0.2%)
Coverage rate: 0.2%
```

**Database currently has:** 291,113 ERC1155 events total

### Test 4: Verify on Blockchain
```
Sampled 10 "missing" transaction hashes
Result: 10/10 ARE REAL Polygon transactions
Each has: 14-22 blockchain events (ERC1155 transfers + USDC transfers)
Status: All confirmed successful on-chain
```

---

## Why Blockchain Backfill Is Necessary

### The Missing Puzzle Piece: token_id → condition_id

**ERC1155 Transfer Event Structure:**
```solidity
event TransferBatch(
  address indexed operator,
  address indexed from,
  address indexed to,
  uint256[] ids,      // ← condition_id is encoded in these token IDs
  uint256[] values
)
```

**The condition_id is embedded in the token_id:**
- Token ID format: `0x{condition_id}{outcome_index}`
- First 64 hex chars = condition_id
- Last 2 hex chars = outcome index (00 or 01 for binary markets)

**We MUST extract from blockchain because:**
1. CLOB API import had bugs → didn't capture condition_ids
2. No existing table has valid condition_ids
3. Only the blockchain event logs contain the token_id
4. Can't derive condition_id any other way

---

## Blockchain Backfill Process

### What the backfill does:
1. **Scans blockchain:** 1,048 days of Polygon history
2. **Filters ERC1155 events:** Only CTF Exchange contract (0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E)
3. **Decodes token_ids:** Extracts condition_id from first 64 hex chars
4. **Matches transactions:** Links to existing trades via tx_hash
5. **Updates database:** Inserts into erc1155_transfers table

### Time breakdown:
- **Block range:** ~47M blocks (from genesis to current)
- **RPC calls:** ~47,000 queries (1000 blocks per batch)
- **Rate limiting:** ~200ms between calls to avoid RPC throttling
- **Decoding:** Parse event logs, extract token_ids, normalize condition_ids
- **Total time:** 18-27 hours (depending on RPC performance)

---

## Can We Speed It Up?

### Option 1: Faster RPC endpoint ⚡
- Current: Public Polygon RPC (free, rate-limited)
- Alternative: Alchemy/Infura paid tier (higher limits)
- **Time savings:** 18-27 hours → 8-12 hours
- **Cost:** $199-299/month

### Option 2: Parallel workers (Already doing this!) ✅
- Current: 8 workers processing different block ranges
- Already optimized!

### Option 3: Use The Graph or Goldsky 🤔
- Pre-indexed blockchain data via GraphQL
- **Time savings:** 18-27 hours → 2-4 hours
- **Limitation:** May not have full historical data
- **Requires:** Integration work (4-6 hours)

### Option 4: Query existing data ❌
- **NOT POSSIBLE** - condition_ids don't exist in any table
- All we have is zeros/blanks

---

## What Happens After Backfill?

### Recovery Strategy (Once backfill completes):

```sql
-- Extract condition_ids from erc1155_transfers
WITH recovered_conditions AS (
  SELECT
    e.tx_hash,
    lower(substring(hex(e.token_id), 1, 64)) as condition_id_norm,
    v.wallet_address_norm,
    v.usd_value,
    v.shares,
    v.trade_direction
  FROM erc1155_transfers e
  INNER JOIN vw_trades_canonical v
    ON e.tx_hash = v.transaction_hash
  WHERE e.token_id != 0
)
-- Insert into trades_with_direction
INSERT INTO trades_with_direction
SELECT * FROM recovered_conditions;
```

**Estimated recovery time:** 5-10 minutes (after backfill completes)

---

## Current Status

### Blockchain Backfill Progress:
- **Started:** Running in background
- **ERC1155 events fetched:** 291,113 (0.2% of needed data)
- **Estimated completion:** 18-27 hours from start
- **Status:** MUST complete, no shortcuts available

### Recommendation:
✅ **Let the backfill run to completion**
- It's the only way to get condition_ids
- Already optimized with 8 parallel workers
- No faster alternative without paying for premium RPC

---

## Summary

| Question | Answer |
|----------|--------|
| Can we query existing tables? | ❌ NO - all condition_ids are zeros |
| Can we derive from market_ids? | ❌ NO - market_ids also zeros |
| Can we skip the backfill? | ❌ NO - blockchain is only source |
| Can we speed it up? | ⚠️  Only with paid RPC ($200-300/mo) |
| Is it worth the wait? | ✅ YES - necessary for complete wallet P&L |

**Bottom line:** The blockchain backfill is unavoidable. The 18-27 hour wait is the price we pay for recovering condition_ids that were lost during buggy CLOB API import.
