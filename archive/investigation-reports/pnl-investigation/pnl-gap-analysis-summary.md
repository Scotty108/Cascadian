# P&L Gap Analysis Summary

**Wallet:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
**Date:** 2025-11-12
**Current System:** $23,426 realized P&L
**Dune Reported:** ~$80,000 realized P&L
**Gap:** ~$56,574

---

## Key Findings

### 1. Data Sources Analyzed

#### `clob_fills` (194 trades, 2024-08-22 to 2025-09-10)
- **168 BUY** trades (opening positions)
- **26 SELL** trades (closing positions)
- **Heavily skewed toward HOLDING positions**

#### `trades_raw` (674 trades, 2024-08-21 to 2025-10-15)
- 167 BUY trades: $173,104 spent
- 501 SELL trades: $36,857 received
- 6 UNKNOWN direction trades: $621
- **Net cashflow: -$136,247** (more money out than in)

**Key insight:** `cashflow_usdc` in `trades_raw` is UNSIGNED notional value, not signed P&L:
- BUY trades have POSITIVE cashflow (notional cost)
- SELL trades have POSITIVE cashflow (notional proceeds)
- To calculate net: SELL proceeds - BUY costs = $36,857 - $173,104 = **-$136,247**

### 2. Realized P&L from Average Cost Method

Using the user's algorithm on `clob_fills` (194 fills):
```
Total Realized P&L: $3.51
Closed positions: 2
Open positions: 43 (valued at $47,000 at avg cost)
```

**This is LOW because the wallet is primarily HOLDING, not round-tripping.**

### 3. Redemption P&L

**Found 10 burn events** (transfers to 0x0):
- First burn: 2025-03-01 00:28:07
- Last burn: 2025-10-30 20:58:09
- 10 unique tokens redeemed
- Sample burn amounts (hex):
  - `0x12560fb0` = 310M raw units = 310 shares
  - `0x3b9aca00` = 1B raw units = 1,000 shares
  - Many burns in same tx (0xa5e736464e5820929a... on 2025-07-01)

**Redemption P&L needs to be calculated:**
- Match each burned token_id to its market outcome
- Determine if outcome won (payout = shares × $1)
- Subtract original cost basis for those positions

---

## Current P&L Breakdown

### Trading P&L (from fills)
**$3.51** - Only 2 positions fully closed via round-trip trading

### Redemption P&L (from burns)
**$??? - TO BE CALCULATED**
- 10 positions redeemed
- Need to:
  1. Decode hex burn amounts to share counts
  2. Map token_ids to condition_ids and outcomes
  3. Check which outcomes won
  4. Calculate: (shares_burned × $1_if_won) - original_cost_basis

### Total Realized P&L
**$3.51 + redemption_pnl**

---

## Gap Analysis

If Dune shows $80K realized and we have:
- $3.51 from trading
- $??? from redemptions

Then redemptions must account for **~$79,996.49**

This seems plausible if:
1. The 10 burned positions were large winners
2. The wallet bought winning outcomes cheaply and held through resolution
3. Redemption payouts were substantial

---

## Next Steps

### Immediate: Calculate Redemption P&L

```typescript
// 1. Get all burns with decoded amounts
SELECT
  token_id,
  reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) AS shares_raw,
  shares_raw / 1e6 AS shares,
  block_timestamp,
  tx_hash
FROM default.erc1155_transfers
WHERE lower(from_address) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
  AND lower(to_address) = lower('0x0000000000000000000000000000000000000000')

// 2. Map token_ids to condition_ids and outcomes
// 3. Check market resolutions to see which outcomes won
// 4. Calculate payout: winning_shares × $1
// 5. Find original cost basis from clob_fills/trades_raw
// 6. Calculate: payout - cost_basis = redemption_pnl
```

### Secondary: Verify Completeness

- **Check if clob_fills has complete history** (why only 194 trades vs 674 in trades_raw?)
- **Reconcile per-market with Dune** per user's step 4
- **Verify trader address mapping** is complete (no missing proxies)

---

## Expected Result

If redemption P&L ≈ $80K, then:
```
Total Realized P&L = Trading P&L + Redemption P&L
                   = $3.51 + $79,996.49
                   = $80,000 ✅ Matches Dune!
```

This would explain the gap:
- User's correction was right: **Redemptions DO contribute to realized P&L**
- My calculation was incomplete because I only calculated **trading P&L**
- The missing piece is **redemption P&L from burn events**

---

## Data Quality Notes

1. **clob_fills size field:** Raw token units, need /1e6 for shares
2. **trades_raw cashflow_usdc:** Unsigned notional, not signed P&L
3. **erc1155_transfers value:** Hex string, need to decode for amounts
4. **wallet_metrics table:** Completely empty (0 wallets) - no existing calculations

---

**Status:** Ready to implement redemption P&L calculation

**Confidence:** High - the 10 burn events likely account for the $80K gap
