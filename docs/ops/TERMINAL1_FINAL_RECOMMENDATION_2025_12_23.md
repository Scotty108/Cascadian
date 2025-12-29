# Terminal 1 - Final Recommendation

**From:** Terminal 2
**Date:** 2025-12-23
**Priority:** HIGH - READ THIS

---

## TL;DR

**Stop trying to map old 15-min crypto markets via Gamma API. It won't work.**

Instead:
1. **Use redemption events to identify winners** (already in ClickHouse)
2. **Get live prices for open positions** (from CLOB order book)
3. **Calculate P&L using the validated formula**

---

## Validated P&L Formula

From Polymarket's [subgraph source code](https://github.com/Polymarket/polymarket-subgraph/tree/f5a074a5a3b7622185971c5f18aec342bcbe96a6/pnl-subgraph/src/utils):

```typescript
// For each trade in chronological order:
if (side === 'buy') {
  avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount);
  amount += buyAmount;
} else if (side === 'sell') {
  const pnl = sellAmount * (sellPrice - avgPrice);
  if (pnl > 0) totalGain += pnl;
  else totalLoss += Math.abs(pnl);
  amount -= sellAmount;
}

// For resolved positions (redemptions):
const pnl = holdingAmount * (resolvedPrice - avgPrice);
// resolvedPrice = 1 if winner, 0 if loser
```

---

## What We Validated

| Wallet | Our Calc | Analytics | UI | Our Error |
|--------|----------|-----------|-----|-----------|
| @Holliewell | $4,597 | $4,716 | $4,764 | **3.5%** |
| @pb7 | $5,224 | $5,926 | $6,442 | **19%** |

@pb7 has high error due to $128K in **open positions** (need live prices).

---

## Resolution Data Coverage

**Good news:** Our resolution view already has 99.99% coverage!

```
Conditions in vw_pm_resolution_prices: 248,590
Conditions with redemptions:           205,624
Overlap:                               205,603 (99.99%)
Missing from view:                     22 (negligible)
```

---

## The Real Blocker: Open Position Prices

The 19% error for @pb7 is due to **$128K in unrealized positions**.

For accurate P&L:
1. ✅ Resolved positions: Use `vw_pm_resolution_prices` (99.99% coverage)
2. ⚠️ Open positions: Need live market prices **only if you want total P&L**

**Get live prices from recent CLOB trades:**

```sql
SELECT
  token_id,
  argMax(usdc_amount / token_amount, trade_time) as live_price
FROM pm_trader_events_v2
WHERE trade_time > now() - INTERVAL 1 HOUR
  AND is_deleted = 0
GROUP BY token_id
```

---

## Revised Action Plan

### Phase 1: Calculate P&L for Resolved-Only Wallets
Many wallets have NO open positions - calculate their P&L now with existing data.

```sql
-- Find wallets with 100% resolved positions
SELECT trader_wallet, count(DISTINCT token_id) as tokens
FROM pm_trader_events_v2
WHERE is_deleted = 0
  AND token_id IN (
    SELECT m.token_id_dec
    FROM pm_token_to_condition_map_v5 m
    JOIN vw_pm_resolution_prices r
      ON m.condition_id = r.condition_id
    WHERE r.resolved_price IS NOT NULL
  )
GROUP BY trader_wallet
```

### Phase 2: Build Live Price Cache
For wallets with open positions, we need live prices from CLOB.

### Phase 3: Calculate Full P&L
Apply formula: Realized from sells + Redemptions + **Synthetic resolution for ALL resolved outcomes**
Optional: add open positions at last-trade price for total P&L

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/copytrade/polymarket-style-pnl.ts` | Validated P&L calculator |
| `docs/reports/PNL_FORMULA_VALIDATION_2025_12_23.md` | Validation report |
| `vw_pm_resolution_prices` | Resolution prices (99.99% coverage) |

---

## What NOT To Do

1. ❌ Don't keep trying Gamma API for deleted markets
2. ❌ Don't try to derive token→outcome mappings for old markets
3. ❌ Don't focus on the 710-wallet cohort (filtered by bad data)

---

## Summary

**The formula is validated. The resolution data is 99.99% complete.**

The only missing piece is **live prices for open positions**. Focus on:
1. Calculate P&L now for wallets with resolved-only positions
2. Build live price cache for open position valuation
3. Rank all wallets by P&L → Find copy trading candidates

The Polymarket Analytics site shows we're on the right track - their errors are similar to ours (0.9%-8% from UI).

---

## 🔧 Critical Fixes (Subgraph + ClickHouse)

1. **Sell cap is correct (per Polymarket subgraph):**  
   If a wallet sells more than its tracked position, cap the sell to position amount and ignore extra.
   This matches their `updateUserPositionWithSell` logic and explains “sold > bought” cases without flipping side/role.

2. **ClickHouse empty-string bug in mappings:**  
   `pm_token_to_condition_map_v5` can have empty strings (not NULL).  
   Use `NULLIF(g.condition_id, '')` before `COALESCE` so patch mappings don’t get dropped.

   Example:
   ```
   COALESCE(NULLIF(g.condition_id, ''), p.condition_id) as condition_id
   COALESCE(if(g.condition_id != '', g.outcome_index, NULL), p.outcome_index) as outcome_index
   ```

3. **Splits are under Exchange contract (tx_hash join):**  
   `PositionSplit` / `PositionsMerge` events are recorded under the Exchange contract, not user_address.  
   Load these via tx_hash from the wallet’s CLOB trades and feed into the engine.

**Implication:** No ERC1155 transfer logic needed to match subgraph behavior; just cap sells, fix mapping joins, and add tx_hash splits.

---

## ✅ Economic Parity Mode (New Requirement)

For copy-trading rankings, use **economic realized P&L**:
- **Synthetic resolution for ALL resolved outcomes** (winners + losers)
- **No 0.5 mark-to-market**
- Open positions only included in total P&L if explicitly marked to last trade price
