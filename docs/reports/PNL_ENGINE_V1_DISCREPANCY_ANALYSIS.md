# PnL Engine V1 Discrepancy Analysis

**Date:** 2026-01-07
**Test Wallet:** `0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e`
**Wallet Type:** Copy-trading bot (PolyQL Telegram bot)

---

## Summary

| Source | Reported PnL |
|--------|-------------|
| **Polymarket UI** | **$57.71** |
| **PnL Engine V1** | **$314.26** |
| **Discrepancy** | **+$256.55 (5.4x)** |

Our engine is significantly **overcounting profits**.

---

## Root Cause: Missing Split Cost Attribution

### The Problem

When users perform **bundled split transactions** through Polymarket:
1. User deposits X USDC
2. User receives X tokens of EACH outcome (YES + NO)
3. User sells the unwanted outcome on CLOB
4. User keeps the wanted outcome

**Our engine only sees step 3 (CLOB sell)** - we don't see the split cost (step 1).

### Example: Bitcoin Up/Down Dec 21 Market

For condition `7f736f95...` (resolution: outcome 0 loses, outcome 1 wins):

| Outcome | CLOB Bought | CLOB Sold | From Splits | CLOB Cost | CLOB Proceeds |
|---------|-------------|-----------|-------------|-----------|---------------|
| 0 (loses) | 787 | 3.39 | 0 | $11.78 | $0.03 |
| 1 (wins) | 3.39 | 763.72 | **760.33** | $3.36 | $752.47 |

**The wallet sold 760 more outcome-1 tokens than they bought via CLOB.** These came from splits.

### Our Calculation (Wrong)
```
Outcome 0: $0.03 (sell) + $0 (settlement @ 0) - $11.78 (buy) = -$11.75
Outcome 1: $752.47 (sell) + $0 (no tokens held) - $3.36 (buy) = +$749.11
Total: +$737.36 profit (WRONG!)
```

### Polymarket's Calculation (Correct)
```
Split cost for 760 tokens @ $0.50 each = $380.16
Outcome 1 actual PnL: $752.47 - $3.36 - $380.16 = +$368.95
Outcome 0: -$11.75 - $380.16 (split cost share) = -$391.91
Total: ~$-23 to ~$-30 (approximate)
```

---

## Why Splits Aren't Visible

1. **Proxy Contract Attribution**: Split events are recorded under exchange proxy addresses (`0x4bfb41d5...`, `0xc5d563a3...`), not the user's wallet

2. **CTF Events Table**: `pm_ctf_events` only shows 28 PayoutRedemption events for this wallet ($358.54 total), but no PositionSplit events attributed to them

3. **Market-Level Splits Exist**: The condition shows $164,373 in PositionSplit events overall, but they're attributed to proxies

---

## Proposed Solutions

### Option 1: Transaction Hash Matching (Recommended)
Match CLOB trades to CTF events via `transaction_hash`:
- When wallet does a split + sell in same tx, the CTF event shares the tx_hash
- Use this to attribute split cost to the wallet

```sql
-- Find splits in same transaction as wallet's CLOB trades
SELECT ctf.event_type, ctf.amount_or_payout
FROM pm_ctf_events ctf
WHERE ctf.tx_hash IN (
  SELECT DISTINCT transaction_hash
  FROM pm_trader_events_v3
  WHERE trader_wallet = '0x...'
)
AND ctf.event_type = 'PositionSplit'
```

### Option 2: Infer Splits from Oversold Positions
When `sold > bought` for an outcome, assume the difference came from splits:
```sql
split_tokens = MAX(sold - bought, 0)
split_cost = split_tokens * 0.50  -- Polymarket standard
```

### Option 3: Use Polymarket Subgraph Approach
The official subgraph:
- Only attributes trades to **makers** ("the taker is always the exchange")
- This sidesteps the split attribution problem because splits go through the exchange
- BUT: This undercounts taker-heavy wallets

---

## Additional Findings

### Maker/Taker Distribution
This wallet: 1,007 maker trades ($1,827), 1,083 taker trades ($3,617)

**Maker-only filtering would miss 50%+ of their activity.**

### No CLOB Duplicates
No duplicate base events found (maker+taker on same fill for same wallet). The maker/taker pairs in V3 are legitimately different fills.

### Market Breakdown
Top markets by calculated PnL (likely inflated):
- Bitcoin Up/Down Dec 21: +$697 (should be much lower or negative)
- Ethereum Up/Down Dec 21: +$309
- Various crypto time-slice markets

---

## Next Steps

1. **Implement tx_hash matching** to attribute CTF splits to wallets
2. **Add split cost inference** as fallback when direct attribution fails
3. **Validate against more wallets** - especially:
   - Pure CLOB traders (no splits)
   - Heavy split users
   - Mixed strategies
4. **Compare realized-only PnL** (exclude open positions) to reduce variables

---

## Files Reference

- Engine: `lib/pnl/pnlEngineV1.ts`
- Mark prices cron: `app/api/cron/update-mark-prices/route.ts`
- CTF events: `pm_ctf_events` table
- CLOB trades: `pm_trader_events_v3` table
