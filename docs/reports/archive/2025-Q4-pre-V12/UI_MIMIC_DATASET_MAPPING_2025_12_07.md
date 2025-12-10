# UI-Mimic Dataset Mapping

**Date:** 2025-12-07
**Source:** John from Goldsky

## Summary

John provided insight into how Polymarket UI calculates PnL. Key findings:

1. **Rounding Rule**: UI rounds price to cents before multiplication - this causes drift for high-volume wallets
2. **Position-Level Data**: UI likely uses `polymarket_user_positions` which has pre-computed `realized_pnl`, `avg_price`, `total_bought`
3. **USD Transfers**: USDC flows on Matic may be included in total PnL

## Dataset Mapping

| John's Dataset | Our Equivalent | Coverage | Notes |
|---------------|----------------|----------|-------|
| `polymarket.order_filled` | `pm_trader_events_v2` | ~220K wallets | CLOB fills with side, price, amount |
| `polymarket_user_positions` | `pm_user_positions_v2` | 105K wallets | **INCOMPLETE** - has realized_pnl but stale/partial |
| `polymarket_market_open_interest_raw` | None found | - | May not be needed |
| `matic_usd_transfers` | `pm_erc20_usdc_flows` | Unknown | Has flow_type: ctf_deposit, ctf_payout |

## Key Problem

`pm_user_positions_v2` only covers ~105K wallets but `pm_trader_events_v2` covers ~220K. The subgraph position data is incomplete and likely stale.

The UI must be computing PnL from something else - likely:
1. Live API calls to Polymarket backend
2. Or reconstructing from order_filled events with their specific formula

## John's Price Rounding Rule

```typescript
function roundUiPrice(price: number): number {
  return Math.round(price * 100) / 100;  // Round to cents
}
```

Apply at per-trade basis before aggregating.

## Subgraph PnL Formula Reference

From John's link to [Polymarket subgraph](https://github.com/Polymarket/polymarket-subgraph/blob/f5a074a5a3b7622185971c5f18aec342bcbe96a6/pnl-subgraph/src/utils/updateUserPositionWithSell.ts#L17):

```typescript
// When selling:
// realized_pnl += (sell_price - avg_price) * amount_sold
```

This is different from V29's cash-flow approach.

## Next Steps

1. **Test rounding hypothesis**: Apply rounding to V29 trades and compare
2. **Compute UI-style PnL**: Use (sell_price - avg_price) * amount formula
3. **Compare both engines**: V29 realized vs UI-style vs Dome

## Data Quality Notes

- `pm_user_positions_v2` last updated: 2025-12-04 (may be stale)
- Many wallets in our validation cohort are NOT in pm_user_positions_v2
- The subgraph realized_pnl may not match current UI values
