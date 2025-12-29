> **DEPRECATED PNL DOC**
> Archived. Reflects earlier attempts to match Goldsky PnL.
> Not the current spec for Cascadian.
> See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

# UI PnL Methodology - Polymarket Style

## Overview

This document describes the hybrid approach for calculating **UI-style PnL** that matches Polymarket/PolymarketAnalytics displays.

## The Problem

Goldsky's `pm_user_positions.realized_pnl` only stores **non-negative** values:
- Winners: `realized_pnl = payout - cost_basis` (positive)
- Losers: `realized_pnl = 0` (losses are cropped)

This works for wallets that are net winners (like Theo) but fails for net losers where we need accurate loss attribution.

## The Solution: Hybrid Approach

Combine two data sources:

| Metric | Source | Field | Logic |
|--------|--------|-------|-------|
| **Losses** | Polymarket Data API | `cashPnl` from open positions | `WHERE cashPnl < 0` |
| **Gains** | Goldsky | `realized_pnl` from closed positions | `WHERE realized_pnl > 0` |

### Data Sources

**1. Polymarket Data API** (`pm_ui_positions` table)
- Endpoint: `https://data-api.polymarket.com/positions?user={wallet}`
- Contains: Open positions with `cashPnl` (can be negative)
- Use for: **Losses** (unrealized positions underwater)

**2. Goldsky** (`pm_user_positions` table)
- Contains: All historical positions with `realized_pnl`
- Use for: **Gains** (realized profits from closed positions)

## Formula

```sql
UI_Gains     = SUM(realized_pnl) FROM pm_user_positions WHERE realized_pnl > 0
UI_Losses    = -SUM(cashPnl) FROM pm_ui_positions WHERE cashPnl < 0
UI_Net_PnL   = UI_Gains - UI_Losses
```

## Views

### `vw_wallet_ui_pnl_hybrid`

The primary view for UI-style PnL:

```sql
CREATE OR REPLACE VIEW vw_wallet_ui_pnl_hybrid AS
SELECT
  wallet,
  open_positions,
  closed_positions,
  open_positions + closed_positions AS total_positions,
  gains_pnl_usd,
  losses_cost_basis_usd,
  gains_pnl_usd - losses_cost_basis_usd AS net_ui_pnl_usd
FROM (
  -- Losses from Data API open positions
  SELECT
    proxy_wallet AS wallet,
    countIf(cash_pnl < 0) AS open_positions,
    -sumIf(cash_pnl, cash_pnl < 0) AS losses_cost_basis_usd
  FROM pm_ui_positions
  GROUP BY proxy_wallet
) AS api
LEFT JOIN (
  -- Gains from Goldsky closed positions
  SELECT
    lower(proxy_wallet) AS wallet,
    countIf(realized_pnl > 0) AS closed_positions,
    sumIf(realized_pnl, realized_pnl > 0) / 1e6 AS gains_pnl_usd
  FROM pm_user_positions
  GROUP BY lower(proxy_wallet)
) AS goldsky USING (wallet)
```

### `vw_wallet_ui_pnl_polymarket`

Alternative view using only Data API data (incomplete for historical closed positions):

```sql
CREATE OR REPLACE VIEW vw_wallet_ui_pnl_polymarket AS
SELECT
  proxy_wallet AS wallet,
  count() AS positions,
  sumIf(cash_pnl, cash_pnl > 0) AS gains_pnl_usd,
  -sumIf(cash_pnl, cash_pnl < 0) AS losses_cost_basis_usd,
  sum(cash_pnl) AS net_ui_pnl_usd
FROM pm_ui_positions
GROUP BY proxy_wallet
```

## Calibration Results

Calibrated against PolymarketAnalytics UI values:

### Theo (`0x56687bf447db6ffa42ffe2204a05edaa20f55839`)

| Metric | Calculated | Target | Match |
|--------|------------|--------|-------|
| Net PnL | $22,053,934 | $22,053,934 | **EXACT** |

### Sports Bettor (`0xf29bb8e0712075041e87e8605b69833ef738dd4c`)

| Metric | Calculated | Target | Match |
|--------|------------|--------|-------|
| Gains | $28,852,409 | $28,812,489 | 99.86% |
| Losses | $38,833,783 | $38,833,660 | 99.9997% |
| Net PnL | -$9,981,374 | -$10,021,172 | 99.6% |

## Backfill Script

`scripts/backfill-ui-positions-from-data-api.ts`

Fetches positions from both endpoints:
- `/positions?user={wallet}` - Open positions with cashPnl
- `/closed-positions?user={wallet}` - Recent closed positions with realizedPnl

**Note:** The closed-positions endpoint returns limited historical data. For complete gains, use Goldsky `pm_user_positions`.

## Key Insights

1. **Open positions** are where losses live (negative cashPnl = underwater position)
2. **Closed positions** are where gains live (realized_pnl from winning bets)
3. **Data API limitations**: Only returns recent closed positions (~50)
4. **Goldsky completeness**: Has full historical position data (500+ positions)

## Usage

```sql
-- Get UI PnL for a wallet
SELECT * FROM vw_wallet_ui_pnl_hybrid WHERE wallet = '0x...'

-- Get all tracked wallets
SELECT * FROM vw_wallet_ui_pnl_hybrid ORDER BY net_ui_pnl_usd DESC
```

---

*Claude 1 - PnL Calibration*
*Last Updated: 2025-11-22*
