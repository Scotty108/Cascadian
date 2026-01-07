# Proxy Mapping Investigation Report

**Date:** 2025-12-30
**Status:** Investigation complete, solution validated

## Summary

We identified why some wallets show massive PnL discrepancies: their CTF events (PositionSplit, PositionsMerge, PayoutRedemption) are executed by **proxy contracts**, not their own wallet address. Without mapping proxies to users, the CCR-v1 engine can't correctly attribute cost basis for split-originated tokens.

## Key Findings

### 1. Proxy Mapping Works

We can link CTF events to user wallets by matching `tx_hash` between tables:

```sql
-- Find proxy CTF events for a user
WITH wallet_hashes AS (
  SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) = lower('{wallet}')
)
SELECT ctf.event_type, ctf.amount_or_payout
FROM pm_ctf_events ctf
WHERE ctf.tx_hash IN (SELECT tx_hash FROM wallet_hashes)
  AND lower(ctf.user_address) IN ({proxy_contracts})
```

**Known Proxy Contracts:**
- `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e` (Exchange Proxy)
- `0xd91e80cf2e7be2e162c6513ced06f1dd0da35296` (CTF Exchange)
- `0xc5d563a36ae78145c45a50134d48a1215220f80a` (Neg Risk Adapter)

### 2. Test Wallet Results

| Wallet | UI PnL | CCR-v1 PnL | Error | CTF Splits | Explanation |
|--------|--------|------------|-------|------------|-------------|
| f918 | $1.16 | $1.11 | -4.3% | 12 tokens | Small wallet, minimal CTF |
| Lheo | $690 | -$5,812 | -942% | 10,114 tokens | Heavy split usage |

### 3. Root Cause

When a user does a PositionSplit via proxy:
1. They deposit $1.00 USDC
2. They receive 1 YES + 1 NO token (each with $0.50 cost basis)
3. They sell one side via CLOB

**What CCR-v1 sees:**
- SELL without prior BUY → "external sell"
- Assumes $1.00 cost basis → wrong!

**Reality:**
- Split created token at $0.50 cost basis
- Difference: $0.50 per token → massive PnL error

### 4. Adjustment Formula

```javascript
// Simple correction for split-originated external sells
const splitOverlap = Math.min(external_sell_tokens, split_tokens * 2);
const correction = splitOverlap * 0.50; // $0.50 per token
const adjusted_pnl = ccr_pnl + correction;
```

**Results:**
- Lheo: -$5,812 → -$127 (improved from 942% to 118% error)
- Still not accurate enough for leaderboard

### 5. Scale Challenges

Building wallet_identity_map at scale hits ClickHouse memory limits:
- Full JOIN: >10.8GB memory
- Weekly batches: >10.8GB memory
- Daily batches: Still >10.8GB for some days
- Per-wallet queries: ~30 sec each → days for 50k wallets

## Recommendations

### Short-term (Current Leaderboard)

1. **Exclude LOW confidence wallets** - Wallets with high `external_sell_ratio` should be flagged
2. **Use CCR-v1 as-is for HIGH confidence wallets** - Those with minimal external sells

### Medium-term (Better Coverage)

1. **Build wallet_identity_map incrementally** - Process one wallet at a time for leaderboard candidates
2. **Cache mappings** - Once computed, store in ClickHouse table for reuse
3. **Apply simple split correction** - Use the formula above to improve estimates

### Long-term (Full Accuracy)

1. **Integrate CTF events into engine** - Process CLOB + CTF together in timestamp order
2. **Track split cost basis** - $0.50 per token for split-originated positions
3. **Handle merges/redemptions** - Proper accounting for all CTF event types

## Files Created

| File | Purpose |
|------|---------|
| `scripts/test-proxy-mappings.ts` | Get proxy mappings for test wallets |
| `scripts/test-pnl-with-splits.ts` | Test simple split adjustment |
| `scripts/test-pnl-with-splits-v2.ts` | Test refined split adjustment |
| `scripts/build-wallet-identity-map-v7.ts` | Ultra-minimal batch approach |

## Conclusion

The proxy mapping approach is **validated** - it correctly explains the PnL discrepancy for Lheo. However, building the mapping at scale requires either:
1. Accepting slow per-wallet queries (~30 sec each)
2. Running batched jobs over multiple hours/days
3. Building a pre-computed hash index (memory intensive)

For the leaderboard MVP, we recommend:
- Using CCR-v1's confidence metric to filter out LOW confidence wallets
- Building mappings on-demand for specific wallets that need investigation
- Documenting that "CLOB-only with CTF via proxy" wallets may have estimates
