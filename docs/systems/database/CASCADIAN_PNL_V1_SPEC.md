# Cascadian PnL Definition V1

**Date:** 2025-11-26
**Status:** Active
**Terminal:** Claude 1

---

## Overview

This document defines the **Cascadian PnL** metric used throughout the platform. This is an internally consistent, economically correct calculation that may differ from Polymarket's UI PnL.

---

## Formula

```
Cascadian PnL = Trade Cash Flow + Resolution Value

Where:
- Trade Cash Flow = Σ (sell_usdc - buy_usdc) for all trades
- Resolution Value = Σ (final_shares × resolution_price) for resolved markets
```

### Breakdown

**Trade Cash Flow** (per outcome):
```sql
SUM(CASE WHEN side = 'buy' THEN -usdc_amount ELSE +usdc_amount END) / 1e6
```

**Final Shares** (per outcome):
```sql
SUM(CASE WHEN side = 'buy' THEN +token_amount ELSE -token_amount END) / 1e6
```

**Resolution Price** (binary markets):
```sql
CASE
  WHEN payout_numerators LIKE '[0,%' AND outcome_index = 0 THEN 0.0
  WHEN payout_numerators LIKE '[0,%' AND outcome_index = 1 THEN 1.0
  WHEN payout_numerators LIKE '[1,%' AND outcome_index = 0 THEN 1.0
  WHEN payout_numerators LIKE '[1,%' AND outcome_index = 1 THEN 0.0
END
```

**Final PnL** (per outcome):
```
realized_pnl = trade_cash_flow + (final_shares × resolution_price)
```

---

## Critical Requirements

### 1. Deduplication (MANDATORY)

`pm_trader_events_v2` contains 2x duplicates. **ALWAYS** use this pattern:

```sql
WITH deduped AS (
  SELECT
    event_id,
    any(side) as side,
    any(usdc_amount) as usdc_amount,
    any(token_amount) as token_amount,
    any(token_id) as token_id
  FROM pm_trader_events_v2
  WHERE trader_wallet = {wallet} AND is_deleted = 0
  GROUP BY event_id
)
-- Continue with deduped table
```

### 2. Resolved Markets Only (V1)

V1 includes only fully resolved binary markets:
```sql
WHERE r.payout_numerators IS NOT NULL
  AND r.payout_numerators LIKE '[%'  -- Valid JSON array
```

### 3. Zero-Sum Validation

For each resolved market, the sum of all wallet PnLs must equal $0:
```sql
SELECT condition_id, SUM(realized_pnl) as market_sum
FROM vw_pm_realized_pnl_v1
GROUP BY condition_id
HAVING ABS(market_sum) > 0.01  -- Should return 0 rows
```

---

## Scope

### In Scope (V1)
- CLOB trades from `pm_trader_events_v2`
- Resolved binary markets from `pm_condition_resolutions`
- Token mapping via `pm_token_to_condition_map_v3`

### Out of Scope (V2)
- AMM trades (separate data source)
- Multi-outcome markets (39 total, 0.02%)
- Open/unresolved positions
- CTF PositionSplit/Merge events

---

## Difference from Polymarket UI

| Aspect | Cascadian PnL | Polymarket UI |
|--------|---------------|---------------|
| Unredeemed winners | Included at resolution price | Unknown/opaque |
| Calculation | Public on-chain data | Internal/proprietary |
| Consistency | Provably zero-sum | Not verifiable |

**Note:** Cascadian PnL is an *economic* measure of value. It includes unredeemed winning positions because that value is real and claimable. Polymarket's UI may use different internal metrics.

---

## Derived Metrics

All derived metrics use Cascadian PnL as their base:

### Win Rate
```
win_rate = winning_markets / total_resolved_markets
```
Where `winning_market` = market with `realized_pnl > 0`

### Profit Factor
```
profit_factor = gross_profit / gross_loss
```
Where:
- `gross_profit` = SUM(realized_pnl) WHERE realized_pnl > 0
- `gross_loss` = ABS(SUM(realized_pnl)) WHERE realized_pnl < 0

### Omega Ratio
```
omega = Σ(gains above threshold) / Σ(losses below threshold)
```
Typically with threshold = 0

### ROI
```
roi = total_realized_pnl / total_usdc_spent
```

---

## View Naming

Views follow explicit scope naming:

| View | Purpose |
|------|---------|
| `vw_pm_realized_pnl_v1` | Per-wallet, per-condition PnL |
| `vw_pm_wallet_pnl_v1` | Aggregated wallet-level metrics |
| `vw_pm_market_pnl_v1` | Per-market breakdown (for debugging) |

---

## Validation Checklist

Before using PnL data:

- [ ] Deduplication applied (GROUP BY event_id)
- [ ] Only resolved markets included
- [ ] Zero-sum check passes for all markets
- [ ] No NULL resolution prices in output

---

## References

- Trade data: `pm_trader_events_v2`
- Resolution data: `pm_condition_resolutions`
- Token mapping: `pm_token_to_condition_map_v3`

---

**Terminal: Claude 1**
