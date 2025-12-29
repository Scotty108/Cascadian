> **DEPRECATED PNL DOC**
> Archived. Reflects earlier attempts to match Goldsky PnL.
> Not the current spec for Cascadian.
> See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

# PnL Methodology V4

## Overview

V4 implements a **condition-level PnL** system using the fundamental accounting identity. This is the canonical PnL source for the Cascadian platform.

## Core Formula

```
total_pnl = net_cash_flow + resolution_payout
```

Where:
- **net_cash_flow** = `sum(cash_delta_usdc)` from all trades
  - Buys: negative (cash outflow)
  - Sells: positive (cash inflow)
- **resolution_payout** = `sum(max(0, net_shares) * outcome_won)` per outcome
  - Winning shares pay $1 each
  - Losing shares pay $0

## Data Source

**Canonical Source:** `pm_trader_events_v2`
- CLOB fills data
- Contains all buy/sell transactions with USDC amounts and share quantities

**Note:** Numbers differ from Polymarket UI due to different data sources. See `PNL_DATA_SOURCE_ANALYSIS.md` for details.

## Schema

### Primary Table: `pm_wallet_condition_pnl_v4`

```sql
wallet_address      String     -- Trader wallet
condition_id        String     -- Market condition ID
net_cash_flow_usdc  Float64    -- Sum of trading cash flows
total_fees_usdc     Float64    -- Total fees paid
total_bought_usdc   Float64    -- Total spent on buys
total_sold_usdc     Float64    -- Total received from sells
resolution_payout_usdc Float64 -- Payout from resolved markets
total_pnl_usdc      Float64    -- Final PnL (net_cash + resolution)
computed_at         DateTime   -- When computed
```

### Derived Views

1. **`vw_wallet_pnl_totals`** - Wallet-level aggregates
   - total_pnl, total_gains, total_losses
   - win_rate, roi, omega_ratio

2. **`vw_wallet_pnl_by_category`** - Wallet + category breakdown
   - PnL per category per wallet

3. **`vw_category_pnl_totals`** - Global category stats
   - Platform-wide category metrics

## Key Metrics

| Metric | Formula | Description |
|--------|---------|-------------|
| Win Rate | `winning_conditions / total_conditions` | % of profitable conditions |
| ROI | `total_pnl / total_bought` | Return on investment |
| Omega Ratio | `total_gains / abs(total_losses)` | Risk-adjusted return |

## Verification

The system passes all verification checks:
- No negative resolution payouts
- No duplicate wallet+condition entries
- Accounting identity holds for all 20.9M positions

## Global Statistics (as of 2025-11-22)

| Metric | Value |
|--------|-------|
| Total Rows | 20,895,555 |
| Unique Wallets | 1,167,035 |
| Unique Conditions | 135,574 |
| Total PnL | $9.58B |
| Total Gains | $12.81B |
| Total Losses | -$3.23B |

## Important Notes

### Divergence from Polymarket UI

Our PnL numbers differ from Polymarket's official UI because:
1. **Different data source** - Our fills data has different condition IDs than Goldsky
2. **Goldsky data quality issues** - total_sold=0, timestamp anomalies
3. **Methodology differences** - Goldsky may use a different PnL calculation

### Why This Is Acceptable

1. Our calculation is **internally consistent** - the accounting identity holds
2. We have **transaction-level detail** - can show trading vs resolution PnL
3. Numbers are **reproducible** - same input always gives same output
4. All **derived metrics work correctly** - ROI, win rate, omega ratio

## Usage

### Query Wallet PnL

```sql
SELECT *
FROM vw_wallet_pnl_totals
WHERE wallet_address = '0x...'
```

### Query Category Breakdown

```sql
SELECT category, total_pnl, win_rate, omega_ratio
FROM vw_wallet_pnl_by_category
WHERE wallet_address = '0x...'
ORDER BY abs(total_pnl) DESC
```

### Query Global Category Stats

```sql
SELECT *
FROM vw_category_pnl_totals
ORDER BY total_pnl DESC
```

## Scripts

| Script | Purpose |
|--------|---------|
| `create-ledger-view.ts` | Creates `vw_pm_ledger` normalization layer |
| `calibrate-v4-condition-level.ts` | Calibration script |
| `materialize-condition-pnl-v4.ts` | Materializes the v4 table |
| `create-derived-views.ts` | Creates wallet totals and category views |

---
*Last updated: 2025-11-22*
