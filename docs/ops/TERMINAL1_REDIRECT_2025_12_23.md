# Terminal 1 - Redirect Instructions

**From:** Terminal 2
**Date:** 2025-12-23
**Priority:** HIGH

---

## STOP: You're solving the wrong scope

You're mapping 21K tokens for 710 wallets. The REAL scope is:

| Metric | Your Current | Actual Need |
|--------|--------------|-------------|
| Wallets | 710 | **713,027** (60-day active) |
| Tokens | 21,894 | **217,380** |
| Unmapped | 21,894 | **59,692** |

---

## The Gamma API Issue

You found 0% Gamma coverage because you're querying OLD 15-min crypto markets (deleted).

**BUT:** The 60-day active cohort has RECENT markets. Try Gamma API on the 60K unmapped tokens from recent activity - many should be in Gamma.

---

## Revised Plan

### Step 1: Get the 60K unmapped tokens from 60-day cohort

```sql
-- Tokens traded in last 60 days NOT in either mapping table
SELECT DISTINCT token_id
FROM pm_trader_events_v2
WHERE is_deleted = 0
  AND trade_time >= now() - INTERVAL 60 DAY
  AND token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v5)
  AND token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_patch)
```

### Step 2: Get condition_ids via tx_hash correlation (your Phase 2 works!)

### Step 3: Query Gamma API for RECENT conditions
- Recent markets (last 60 days) should be in Gamma
- Older deleted markets won't be - that's OK for now

### Step 4: For truly unmapped conditions
- Use greedy calibration with sample wallets
- Or accept partial coverage and flag those wallets

---

## The End Goal (Confirmed by User)

Once all tokens mapped:
1. Apply validated formula (from Polymarket subgraph):
   ```
   realizedPnL = Σ sellAmount × (sellPrice - avgBuyPrice)
   ```
2. Calculate accurate P&L for ALL 713K wallets
3. Rank by P&L → Find winners
4. Copy trading candidates identified

**⚠️ FORMULA UPDATE:** The old cash-flow formula was wrong. The correct formula:
- Track weighted average buy price per token
- On sells: P&L = amount × (sellPrice - avgPrice)
- On redemptions: P&L = amount × (resolutionPrice - avgPrice)

**Validation results:**
- @Holliewell: $4,597 calculated vs $4,764 UI = **3.5% error**
- @pb7: $5,224 calculated vs $6,442 UI = **19% error** (due to unmapped tokens)

**See:** `docs/reports/PNL_FORMULA_VALIDATION_2025_12_23.md` for full details
**Use:** `scripts/copytrade/polymarket-style-pnl.ts` for calculations

---

## Key Files from Terminal 2

- `scripts/copytrade/polymarket-style-pnl.ts` - **USE THIS** for P&L calculation
- `docs/reports/PNL_FORMULA_VALIDATION_2025_12_23.md` - Formula validation report
- `lib/polymarket/normalizers.ts` - Use for consistent data formats
- `lib/polymarket/vocabulary.ts` - Field name mappings + SQL patterns
- `lib/pnl/validationGuards.ts` - Validate before P&L calc

---

## Summary

1. **Expand scope** to ALL wallets (not just 60-day cohort)
2. **Try Gamma API** on recent conditions (should work for many)
3. **tx_hash correlation** still works for condition lookup
4. **Greedy calibration** for any remaining gaps
5. **Then calculate P&L** for all wallets with validated formula

---

## 🚨 UPDATE FROM TERMINAL 2 (Latest Session)

### Stop Mapping Token→Outcome for Deleted Markets

The Gamma API won't return deleted 15-min markets. But we DON'T need full mappings for P&L!

### What P&L Actually Needs

**For RESOLVED markets:**
```sql
-- Use resolution prices directly (all outcomes)
SELECT
  condition_id,
  outcome_index,
  resolved_price
FROM vw_pm_resolution_prices
```

Apply **synthetic resolution** to ALL held positions for resolved markets
(both winners and losers), even if the wallet never redeemed.

**For OPEN positions:**
```sql
-- Get live prices from recent trades
SELECT
  token_id,
  last_value(usdc_amount / token_amount) as current_price
FROM pm_trader_events_v2
WHERE trade_time > now() - INTERVAL 1 HOUR
GROUP BY token_id
```

### The Simpler Approach

1. **Build resolution map** from `vw_pm_resolution_prices`
2. **Apply synthetic resolution** for ALL resolved outcomes (winners + losers)
3. **Calculate realized P&L** using the validated formula:
   - Sells at trade price (sell-capped)
   - Redemptions at payout price
   - Synthetic resolution for resolved positions (even if not redeemed)
4. **Optional total P&L:** add open positions valued at *last trade price* (not 0.5)

### Why This Works

- Resolution prices are authoritative for resolved markets
- Synthetic resolution closes positions without relying on redemption events
- Matches Polymarket subgraph sell-capping and cost-basis logic

### Open Positions Impact

From our spot checks:
- @Holliewell (mostly sports, quick resolution): 3.5% error
- @pb7 ($128K open positions): 19% error

Open positions need live prices. Without them, we underestimate unrealized gains.

**Priority:** Get resolution status > (optional) live prices for total P&L > Full token mapping

---

## 🔧 Critical Fixes (Subgraph + ClickHouse)

1. **Sell cap is correct (per Polymarket subgraph):**  
   If a wallet sells more than its tracked position, **cap the sell to position amount** and **ignore extra**.  
   This matches their `updateUserPositionWithSell` logic and explains “sold > bought” cases without flipping side/role.

2. **ClickHouse empty-string bug in mappings:**  
   `pm_token_to_condition_map_v5` can have empty strings (not NULL).  
   Use `NULLIF(g.condition_id, '')` before `COALESCE` or you’ll drop valid patch mappings.

   Example:
   ```
   COALESCE(NULLIF(g.condition_id, ''), p.condition_id) as condition_id
   COALESCE(if(g.condition_id != '', g.outcome_index, NULL), p.outcome_index) as outcome_index
   ```

3. **Splits are under Exchange contract (tx_hash join):**  
   `PositionSplit` / `PositionsMerge` events are recorded under the Exchange contract, not user_address.  
   To capture split cost, load CTF splits by **tx_hash from wallet CLOB trades**, then feed into the engine.

**Implication:** No ERC1155 transfer logic needed to match subgraph behavior; just cap sells, fix mapping joins, and add tx_hash splits.
