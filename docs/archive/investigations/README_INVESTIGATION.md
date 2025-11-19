# Investigation Results: Why Only 1% Match Rate?

## TL;DR

The 1% match was caused by:
1. Wrong column name (`tx_hash` vs `transaction_hash`)
2. Incomplete erc1155_transfers table (291K rows vs 32M needed)
3. Missing market_id in 77.4M trades (cannot use Polymarket API)

Solution: Blockchain transaction receipt lookups (11 hours, $199 RPC cost)

---

## Quick Facts

| Metric | Value |
|--------|-------|
| Missing trades | 77.4M |
| Trade volume | $18.7B |
| Has transaction_hash | 100% |
| Has market_id | 0% |
| Has condition_id | 0% |
| erc1155_transfers coverage | 0.4% |
| Recovery method | Blockchain lookups only |
| Estimated cost | $1,600-1,800 |
| Estimated time | 3-4 days |

---

## The Problem (3 Parts)

### Part 1: Column Name Mismatch
Secondary Claude tried to join on `tx_hash`, but the column is `transaction_hash`.

### Part 2: Incomplete Data Table
erc1155_transfers has only 291K rows covering 12 days, but we need 32M transactions over 665 days. Table appears to be test data, not a production backfill.

### Part 3: Missing Polymarket Metadata
77.4M trades have empty market_id and condition_id. They only have blockchain data (wallet, tx_hash, shares, value). This rules out using Polymarket API for recovery.

---

## The Solution

Extract condition_id from blockchain transaction receipts using ERC1155 event logs.

### Pseudo-code
```typescript
for each transaction_hash in missing trades:
  receipt = fetch transaction receipt from blockchain
  erc1155_event = find ERC1155 TransferBatch event
  condition_id = decode event.args.ids[0]
  update trades_raw set condition_id
```

### Resources Needed
- Alchemy Growth tier ($199/month, 10M requests/day)
- 8 parallel workers
- 11-24 hours runtime
- Development time: 8-12 hours

---

## Next Steps

1. Get approval for $200 Alchemy budget
2. Build pilot script (test on 1,000 transactions)
3. Validate >95% success rate
4. Execute production run (32M transactions)

---

## Documentation

| Document | Purpose |
|----------|---------|
| `INVESTIGATION_SUMMARY.md` | Full summary with context |
| `FINAL_DIAGNOSIS_CONDITION_ID.md` | Complete technical diagnosis and solution |
| `TX_HASH_INVESTIGATION_REPORT.md` | Detailed investigation report |
| `CONDITION_ID_RECOVERY_ACTION_PLAN.md` | Recovery options analysis |
| `README_INVESTIGATION.md` | This quick reference |

---

## Key Scripts

| Script | Purpose |
|--------|---------|
| `investigate-tx-hash-matching.ts` | Investigation diagnostic tool |
| `check-trades-schema.ts` | Schema verification |
| (TBD) `pilot-condition-id-recovery.ts` | Pilot test (1K transactions) |
| (TBD) `full-condition-id-recovery.ts` | Production recovery (32M transactions) |

---

## Decision Point

Proceed with blockchain recovery?
- Cost: ~$1,800
- Time: 3-4 days
- Risk: Low (reversible, proven approach)
- Benefit: Unlock $18.7B in trade data

Recommended: Yes (start with pilot)
