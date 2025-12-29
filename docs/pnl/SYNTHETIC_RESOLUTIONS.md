# Synthetic Resolutions Definition

## Overview

**Synthetic resolutions** are the canonical method for calculating realized PnL on resolved markets in Cascadian's CLOB-first PnL engine.

## Definition

For any resolved `(condition_id, outcome_index)`, treat remaining `final_tokens` as settled at `payout_norm` (0, 1, or normalized payout for multi-outcome markets).

**Do NOT require redemption events** to realize that value.

## Formula

```
position_pnl = cash_flow_eff + (final_tokens_eff * settlement_price)

where:
  - cash_flow_eff = sum of clamped usdc_delta (buys - sells, after external inventory clamp)
  - final_tokens_eff = sum of clamped token_delta (after external inventory clamp)
  - settlement_price = payout_norm if resolved, else mark_price
```

## Rationale

1. **Redemption events are incomplete**: Not all wallets redeem immediately. Some hold resolved positions indefinitely.

2. **CLOB-first philosophy**: We track CLOB trades as the source of truth. If a wallet bought 1000 shares at $0.30 and the market resolved YES (payout_norm = 1.0), their realized PnL is:
   - cash_flow_eff = -$300 (cost to buy)
   - final_tokens_eff = 1000
   - settlement_price = 1.0
   - position_pnl = -$300 + (1000 * 1.0) = +$700

3. **UI parity**: Polymarket's UI calculates PnL this way - positions on resolved markets are shown as realized profit/loss regardless of redemption status.

## Implementation Notes

### Dedupe Key
- `event_id` (wallet-scoped GROUP BY)

### Ordering for Clamp
- `(event_time, event_id)` per `(condition_id, outcome_index)`

### External Inventory Clamp
- Sells are clamped to available CLOB position
- Prevents phantom profits from tokens acquired outside CLOB

### Mark Price for Unresolved
- Use latest trade price from CLOB, NOT 0.5 constant
- Computed globally via `argMax(price, event_time)` per `(condition_id, outcome_index)`

## Related Files

- `lib/pnl/uiActivityEngineV20.ts` - Canonical V20b engine
- `scripts/pnl/build-mark-price-view.ts` - Latest mark price computation
- `scripts/pnl/export-clob-validated-wallets.ts` - Filtered export

## Version History

- 2025-12-15: Initial definition for Cascadian v1
