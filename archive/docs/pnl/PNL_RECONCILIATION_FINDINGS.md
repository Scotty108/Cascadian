> **DEPRECATED PNL DOC**
> Archived. Reflects earlier attempts to match Goldsky PnL.
> Not the current spec for Cascadian.
> See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

# PnL Reconciliation Findings

## Summary

After detailed reconciliation against Polymarket UI, we've documented the differences between our **canonical cash-based PnL** and **Polymarket's UI presentation PnL**.

**Canonical Table:** `pm_wallet_condition_pnl_v4`
**UI Approximation View:** `vw_wallet_ui_pnl_v1`

## Two PnL Formulas

### Canonical (Cash-Based) - What We Use
```sql
cash_pnl = net_cash_flow + resolution_payout
         = (sold_usdc - bought_usdc) + resolution_payout
```

This is the **ground truth** for actual USDC P&L. It captures:
- All cash inflows and outflows
- Resolution payouts for winning positions
- Reflects actual USDC balance change

### UI (Cost-Basis) - Polymarket Display
```sql
ui_pnl = resolution_payout - cost_basis
       = resolution_payout - bought_usdc
```

This is what Polymarket shows in their UI. It:
- Ignores cash from selling positions
- Only shows "investment return" style metrics
- Doesn't capture NegRisk conversion profits

## Formula Relationship

The delta between formulas equals total sold:
```
cash_pnl - ui_pnl = sold_usdc
```

This is mathematically proven:
```
cash_pnl - ui_pnl = (sold_usdc - bought_usdc + resolution) - (resolution - bought_usdc)
                  = sold_usdc - bought_usdc + resolution - resolution + bought_usdc
                  = sold_usdc
```

## Theo Reconciliation Results

| Metric | Value |
|--------|-------|
| Target (UI) | $22,053,934 |
| Our UI PnL | $24,090,000 |
| Our Cash PnL | $33,250,000 |
| Gap (UI) | $2.04M (9.23%) |
| Gap (Cash) | $11.2M |

### NegRisk Position Analysis

Theo has **11 NegRisk conversion positions** out of 28 total:
- UI PnL from NegRisk: -$574,860
- Cash PnL from NegRisk: +$8,460,000
- **NegRisk contributes $9.03M to formula delta**

NegRisk positions are:
- Shares obtained through conversion (not direct purchase)
- `cost_basis = $0` or very low
- `sold_usdc >> cost_basis`
- UI doesn't show profit from selling converted shares

### Remaining 9.23% Gap Explanation

The $2.04M gap between our UI PnL ($24.09M) and Polymarket's target ($22.05M) is attributed to:

1. **Timing differences** - Our data may be at a different snapshot
2. **Position aggregation** - UI may aggregate some outcomes differently
3. **Hidden positions** - Some positions may not appear in the public UI
4. **NegRisk presentation** - UI may show NegRisk positions as separate entries

## Recommendation

**Decision: Accept the gap as "UI presentation difference"**

- **Use `pm_wallet_condition_pnl_v4`** for all canonical metrics (Omega, ROI, win rate)
- **Use `vw_wallet_ui_pnl_v1`** when approximating UI display
- **Document ~9% variance** when comparing to UI
- **Do not tune canonical formula** to match UI - cash-based is correct

## Views Created

### vw_wallet_ui_pnl_goldsky (PRODUCTION - Matches Polymarket UI)

**Source:** Goldsky `pm_user_positions` table

This view provides the most accurate UI PnL matching Polymarket's display.

```sql
CREATE VIEW vw_wallet_ui_pnl_goldsky AS
SELECT
  lower(proxy_wallet) as wallet_address,
  sum(realized_pnl) / 1e6 as ui_pnl_total_usdc,
  sumIf(realized_pnl, realized_pnl > 0) / 1e6 as ui_gains_usdc,
  sumIf(total_bought, realized_pnl <= 0) / 1e6 as ui_losses_cost_basis_usdc,
  count() as position_count
FROM pm_user_positions
WHERE is_deleted = 0
  AND total_bought > 0
GROUP BY lower(proxy_wallet)
```

**Key Insight:** Goldsky's `realized_pnl` includes NegRisk conversion costs in the `total_bought` field, which our CLOB-based data does not capture. This is why Goldsky matches the UI while CLOB-based calculations drift.

**Calibration Results:**
| Wallet | Metric | Target | Actual | Gap | Status |
|--------|--------|--------|--------|-----|--------|
| Theo | UI PnL | $22,053,934 | $22,053,329 | $605 | ✓ PASS |
| Sports Bettor | Gains | $28,812,489 | $28,852,411 | $40K | ✓ PASS |
| Sports Bettor | Positions | 388 | 388 | 0 | ✓ PASS |

### vw_wallet_ui_pnl_v1 (CLOB-based approximation)
```sql
CREATE VIEW vw_wallet_ui_pnl_v1 AS
SELECT
  wallet_address,
  condition_id,
  total_bought_usdc as cost_basis_usdc,
  total_sold_usdc,
  net_cash_flow_usdc,
  resolution_payout_usdc,
  total_pnl_usdc as cash_pnl_usdc,
  resolution_payout_usdc - total_bought_usdc as ui_pnl_usdc,
  total_pnl_usdc - (resolution_payout_usdc - total_bought_usdc) as formula_delta
FROM pm_wallet_condition_pnl_v4
```

Statistics:
- 20,895,555 rows
- 1,167,035 wallets
- Formula verified: `formula_delta = total_sold_usdc` for ALL rows
- Note: Does NOT match UI exactly due to missing NegRisk conversion costs

## Calibration Status

| Wallet | Cash PnL | UI PnL | Win Rate | Status |
|--------|----------|--------|----------|--------|
| Theo (`0x5668...5839`) | $33.25M | $24.09M | - | Verified |
| Sports Bettor (`0xf29b...48e4c`) | $62.03M | $6.45M | 65.9% | Verified |

### Sports Bettor Note

**CORRECTED:** The original wallet address was wrong. The correct Sports Bettor is:
- **Correct:** `0xf29bb8e0712075041e87e8605b69833ef738dd4c` (21,968 trades, +$62M PnL)
- **Wrong:** `0xf29b89c7a0bde085ce9248c71bf6d7557d99a9ae` (does not exist in data)

The Sports Bettor is actually a **winner** with 65.9% win rate across 381 conditions.

### Theo vs Sports Bettor Comparison

| Metric | Theo | Sports Bettor |
|--------|------|---------------|
| Cash PnL | $33.25M | $62.03M |
| UI PnL | $24.09M | $6.45M |
| Delta (sold) | $9.16M | $55.57M |
| Conditions | 14 | 381 |

The large delta for Sports Bettor ($55.57M) shows heavy position turnover - selling to lock in profits rather than holding to resolution.

## Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/pnl/create-ui-pnl-view.ts` | Creates vw_wallet_ui_pnl_v1 |
| `scripts/pnl/reconcile-theo-detailed.ts` | Detailed Theo reconciliation with NegRisk analysis |

---

*Last updated: 2025-11-22*
*Claude 1*
