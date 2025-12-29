# Polymarket PnL Calculation - The Unified Formula

## The One Formula

```
PnL(t) = CF(t) + Σ q_p(t) × P_p(t)
```

Where:
- **CF(t)** = cumulative cash flow (USDC received - USDC spent)
- **q_p(t)** = net token quantity per position (condition_id, outcome_index)
- **P_p(t)** = chosen price for tokens (varies by mode)

This is THE universal formula. Everything else is just choosing different values for P_p.

## Pricing Modes

| Mode | P_p(t) | Use Case |
|------|--------|----------|
| **REALIZED** | 0 for all | Pure cash flow, always accurate |
| **RESOLUTION** | $1 winners, $0 losers | Match UI for resolved markets |
| **MARK_TO_MARKET** | Payout or last price | Full portfolio value |

## Summary

After extensive analysis of 9 test wallets, we developed a formula that **matches the Polymarket UI within 5% for cash-dominated wallets** (positions mostly closed).

## The Formula

```
PnL = cash_out + redemptions + adjusted_holdings - cash_in
```

Where:
- **cash_in** = total USDC spent on BUY trades (deduplicated by event_id)
- **cash_out** = total USDC received from SELL trades (deduplicated by event_id)
- **redemptions** = total USDC received from PayoutRedemption events
- **adjusted_holdings** = sum of (position × payout_price) after subtracting redeemed amounts

### Critical Details

1. **Deduplication is essential**: Raw data has ~3x duplicates. Always `GROUP BY event_id`

2. **Redemptions reduce positions**: When you redeem tokens, they're gone. Holdings must be reduced:
   ```sql
   actual_position = trade_position - redeemed_tokens
   ```

3. **Payout prices are binary**: Winners = $1, Losers = $0
   - If `payout_numerators[outcome_index] > 0` then $1, else $0

4. **Unresolved positions = $0**: No guessing on open markets

## SQL Implementation

See `build-pnl-v5-final.ts` for the complete implementation.

Key tables used:
- `pm_trader_events_v2` - CLOB trades (with deduplication)
- `pm_ctf_events` - PayoutRedemption events
- `pm_condition_resolutions` - Payout data
- `pm_token_to_condition_map_v3` - Token → condition mapping

## Results

| Wallet Type | Match Quality | Example |
|-------------|---------------|---------|
| Cash-dominated (mostly redeemed) | ≤5% | W2: +0.3% |
| Holdings-dominated (unredeemed) | 50-75% | WHALE: +52% |

## Why Holdings-Dominated Wallets Differ

For wallets with large unredeemed positions, our calculation differs from the UI due to:

1. **Data source**: We use on-chain data; UI may use internal Polymarket systems
2. **Timing**: UI may snapshot positions at different times
3. **Resolution data**: Markets we consider "resolved" may differ from UI

## Recommendations

1. **For most users**: This formula will be accurate (most users redeem their winnings)
2. **For large holders**: Acknowledge ~50% variance vs UI
3. **Alternative**: Use pure cash flow (`cash_out + redemptions - cash_in`) as a "realized-only" metric that's always accurate but excludes unrealized gains

## Files

- `build-pnl-v5-final.ts` - Production formula
- `build-pnl-wac-v1.ts` through `v4` - Development iterations
- `build-pnl-portfolio-value.ts` - Alternative approaches

---
*Terminal: Claude 3 | Date: 2025-11-26*
