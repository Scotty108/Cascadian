# Resolution P&L Implementation Plan

**Date**: 2025-11-12
**Issue**: Missing ~$70K P&L from positions held to resolution
**Root Cause**: Not tracking ERC-1155 burns/redemptions and resolved-but-unredeemed inventory

---

## Problem Statement

Current P&L calculation only recognizes cashflow from:
1. ✅ Explicit CLOB trades (BUY/SELL fills)
2. ❌ **MISSING**: Positions held to resolution (bought at $0.23, worth $1 when won)
3. ❌ **MISSING**: ERC-1155 redemptions without payout vectors

### The Gap

| What We Track | What We Miss | Impact |
|---------------|--------------|--------|
| CLOB fills only | Held-to-resolution gains | ~$70K for this wallet |
| Priced burns | Unpriced redemptions | Unknown |
| Traded positions | Resolved-but-unredeemed inventory | Unknown |

---

## Solution Architecture

### Bucket 1: Resolved-but-Unredeemed Inventory

**Query Flow:**
```sql
-- Step 1: Get wallet's current ERC-1155 holdings
SELECT
  token_id,
  SUM(amount) as balance
FROM erc1155_transfers
WHERE to_address = {wallet}
GROUP BY token_id
HAVING balance > 0

-- Step 2: Check if market resolved
JOIN market_resolutions_final
  ON erc1155.condition_id = resolutions.condition_id_norm

-- Step 3: Calculate resolution value
CASE
  WHEN erc1155.outcome_index = resolutions.winning_outcome
    THEN balance * 1.00  -- Won
  ELSE balance * 0.00     -- Lost
END as resolution_value

-- Step 4: Get cost basis from original purchases
JOIN clob_fills
  ON condition_id + outcome_index
  WHERE trade_direction = 'BUY'
```

**Result**: Unrealized P&L for resolved positions still in wallet

### Bucket 2: Redemptions Without Payout Vectors

**Query Flow:**
```sql
-- Step 1: Find ERC-1155 burns (transfers to 0x000...000)
SELECT
  token_id,
  amount,
  block_timestamp
FROM erc1155_transfers
WHERE from_address = {wallet}
  AND to_address = '0x0000000000000000000000000000000000000000'

-- Step 2: Decode token_id to condition_id + outcome_index
-- (CTF token encoding: first 32 bytes = condition_id, last byte = outcome_index)

-- Step 3: Check if this was a winning outcome
JOIN market_resolutions_final
  WHERE burns.outcome_index = resolutions.winning_outcome

-- Step 4: Value the burn
amount * 1.00 as redemption_value

-- Step 5: Subtract cost basis
JOIN clob_fills (BUY trades) to get original cost
```

**Result**: Realized P&L from redemptions

---

## Implementation Steps

### Phase 1: Data Discovery (1-2 hours)
1. ✅ Check `erc1155_transfers` table exists
2. ✅ Verify token_id encoding format
3. ✅ Confirm `market_resolutions_final` coverage
4. ✅ Test token_id → condition_id decoding

### Phase 2: Build Bucket 1 (2-3 hours)
1. Query current ERC-1155 balances for wallet
2. Filter to resolved markets only
3. Calculate resolution value (winning outcome = $1, losing = $0)
4. Match to cost basis from CLOB fills
5. Output: Resolved-but-unredeemed P&L

### Phase 3: Build Bucket 2 (2-3 hours)
1. Query ERC-1155 burns (transfers to 0x000...000)
2. Decode token_ids to condition_id + outcome_index
3. Check if burned outcome was winner
4. Value winning burns at $1/share
5. Subtract cost basis from original BUY
6. Output: Redemption P&L

### Phase 4: Integration (1 hour)
```typescript
Total Realized P&L =
  + Explicit CLOB P&L (existing)
  + Redemption P&L (Bucket 2)
  + Resolved-but-unredeemed P&L (Bucket 1)
```

### Phase 5: Validation (1 hour)
- Compare to Dune's $80K
- Test on multiple wallets
- Document methodology

---

## Expected Results

| Component | Current | After Fix | Difference |
|-----------|---------|-----------|------------|
| CLOB P&L | $0 | $0 | - |
| Redemption P&L | $0 | ~$50K? | +$50K |
| Resolved-unredeemed P&L | $0 | ~$20K? | +$20K |
| **Total** | **$0** | **~$70K** | **+$70K** |

This should match Dune's ~$80K reported P&L.

---

## Key Tables

| Table | Purpose | Critical Fields |
|-------|---------|----------------|
| `clob_fills` | Source of truth for trades | wallet, condition_id, outcome_index, shares, usd_value |
| `erc1155_transfers` | Token movements (holds, burns) | from_address, to_address, token_id, amount |
| `market_resolutions_final` | Market outcomes | condition_id_norm, winning_outcome, resolved_at |
| `token_per_share_payout` | Payout mapping (incomplete) | ctf_token_id, payout_per_share |

---

## Critical Implementation Notes

### ✅ DO:
- Use `clob_fills` as authoritative trade source
- Track ERC-1155 ledger for holdings and burns
- Credit resolved positions at $1 (win) or $0 (lose)
- Match cost basis from original CLOB BUY trades

### ❌ DON'T:
- Switch to `vw_trades_canonical` for production
- Trust synthetic/inferred trade rows
- Rely on incomplete `token_per_share_payout` table
- Use SELLs from before coverage window (no cost basis)

---

## Next Steps

1. **Verify ERC-1155 table structure** (5 min)
2. **Test token_id decoding** (15 min)
3. **Build Bucket 1 query** (1-2 hours)
4. **Build Bucket 2 query** (1-2 hours)
5. **Integrate and validate** (2 hours)

**Total Time Estimate**: 6-8 hours to full implementation

---

## References

- Original issue: P&L shows $0-9K vs Dune's $80K
- Root cause: Missing held-to-resolution gains
- Data source: `clob_fills` (194 trades) NOT `vw_trades_canonical` (1,384 trades)
- Solution: Build ERC-1155 ledger tracking + resolution buckets

---

**Claude 1** - Implementation Plan Complete ✅
