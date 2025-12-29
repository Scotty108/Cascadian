> **DEPRECATED PNL DOC**
> Archived. Reflects earlier attempts to match Goldsky PnL.
> Not the current spec for Cascadian.
> See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

# UI PnL Calibration Findings

## Overview

This document summarizes findings from the PnL calibration effort comparing our Tax Lot Engine calculations against PolymarketAnalytics UI targets.

**Target Wallet**: Sports Bettor (`0xf29bb8e0712075041e87e8605b69833ef738dd4c`)

## UI Targets vs Our Calculations

| Metric | UI Target | Our Calculation | Difference |
|--------|-----------|-----------------|------------|
| Gains | $28,812,489 | $95,952,954 | +233% (off) |
| Losses | $38,833,660 | $33,927,580 | -12.6% (off) |
| Net PnL | -$10,021,172 | $62,025,374 | (way off) |

## Key Discoveries

### 1. GAINS: Goldsky Methodology Matches UI

**Finding**: Goldsky's `realized_pnl` sum for positive values ($28,852,409) matches UI target ($28,812,489) within 0.14%.

**Goldsky's Methodology**:
- `realized_pnl = max(0, payout - cost_basis)` per position
- Winners show positive PnL (payout > cost_basis)
- Losers are **cropped to 0** (not negative!)
- This is a "non-negative PnL" model

**Our Methodology** (Tax Lot Engine):
- Tracks both realized gains AND realized losses
- Includes trading gains (buy low, sell high before resolution)
- Shows $95.9M total gains vs UI's $28.8M

**Why the Difference**:
- Our gains include $54.6M in **trading PnL** (profit from trading shares)
- UI only shows **resolution gains** (payout - cost_basis for winners)
- Trading profits are effectively hidden in the UI

### 2. LOSSES: ~12% Gap Remains Unexplained

**Our Loss Metrics** (all approximately equal):
- L1 (closed negative PnL): $33,927,580
- L2 (total rekt cost basis): $32,492,885
- L3 (resolved losing cost): $34,135,730
- L4 (all negative PnL): $33,927,580

**UI Target**: $38,833,660

**Gap**: ~$4.9M (12.6%)

**Possible Explanations for Gap**:
1. **Trading fees**: Our `fee_amount` field shows $0 (not captured in data)
2. **Different cost basis**: UI may use FIFO instead of WAC
3. **Position aggregation**: UI may count at condition level, not position level
4. **Point-in-time snapshot**: UI target may include unrealized losses from open positions
5. **Different data source**: Goldsky's `total_bought` for losers shows $87.8M (way over)

### 3. Format Consistency Issue

**Critical**: Goldsky and V4 use incompatible condition_id formats:
- Goldsky: Decimal/uint256 format (~97 chars): `100093696709294873256...`
- V4: 64-char hex format: `00db6859eca62f95003060517f2a45cae340b5c9df831cb52598f0d7b0d474fa`

**Result**: 0% overlap when joining by condition_id directly. Conversion needed.

### 4. Position Counting Differences

| Source | Positions | Unique Conditions |
|--------|-----------|-------------------|
| Goldsky | 547 | 547 |
| V4 | 697 | 381 |

**Why V4 has more positions**: Sports Bettor often bets on BOTH YES and NO for the same market (316 conditions with multi-outcome bets).

## UI Methodology: SOLVED

The UI uses a **hybrid approach** combining two data sources:

```
UI_Gains = SUM(realized_pnl) WHERE realized_pnl > 0
         Source: Goldsky pm_user_positions
         Result: $28,852,409 ✓ (matches UI target $28,812,489)

UI_Losses = -SUM(cashPnl) WHERE cashPnl < 0
          Source: Polymarket Data API (pm_ui_positions table)
          Result: $38,833,783 ✓ (matches UI target $38,833,660)

UI_Net = UI_Gains - UI_Losses
       = $28.8M - $38.8M = -$10M ✓
```

**Why Our L4 Was $4.9M Short**:
- Our calculation uses only **realized** losses from resolved positions
- The Data API's `cashPnl` includes **unrealized** losses from the API snapshot
- The $4.9M gap = unrealized losses on underwater positions at snapshot time

## Data Sources Comparison

| Source | Gains Accuracy | Losses Accuracy | Notes |
|--------|---------------|-----------------|-------|
| Goldsky `pm_user_positions` | **$28.8M** (exact match) | N/A (cropped to 0) | Use for UI gains |
| Data API `pm_ui_positions` | $20.3M (incomplete) | **$38.8M** (exact match) | Use for UI losses |
| V4 `pm_wallet_market_pnl_v4` | $95.9M (includes trading) | $33.9M (realized only) | Full canonical PnL |
| Tax Lot Engine | $95.9M (same as V4) | $33.9M (same as V4) | Validates V4 |

**Hybrid Formula for UI PnL**:
```sql
SELECT
  g.gains_pnl_usd AS ui_gains,
  l.losses_pnl_usd AS ui_losses,
  g.gains_pnl_usd - l.losses_pnl_usd AS ui_net_pnl
FROM (
  SELECT sumIf(realized_pnl, realized_pnl > 0) / 1e6 AS gains_pnl_usd
  FROM pm_user_positions WHERE lower(proxy_wallet) = {wallet}
) g, (
  SELECT -sumIf(cash_pnl, cash_pnl < 0) AS losses_pnl_usd
  FROM pm_ui_positions WHERE proxy_wallet = {wallet}
) l
```

## Scripts Created

1. `scripts/pnl/tax-lot-engine.ts` - WAC-based position tracking
2. `scripts/pnl/validate-tax-lot-engine.ts` - Validates against V4
3. `scripts/pnl/explore-loss-metrics.ts` - Compares L1-L4 metrics
4. `scripts/pnl/deep-dive-gains-gap.ts` - Investigates gains discrepancy
5. `scripts/pnl/analyze-loss-gap.ts` - Investigates losses discrepancy
6. `scripts/pnl/investigate-position-gap.ts` - Position count analysis

## Open Questions

1. **What is the UI loss formula?** Our best metric (L4) is 12% short.
2. **Are fees included in losses?** Our data shows $0 fees.
3. **Can we convert condition_id formats?** Hex <-> Decimal for joins.
4. **Is the UI snapshot different?** We analyzed final resolved state; UI may show point-in-time.

## Next Steps

1. **For accurate UI-style gains**: Use Goldsky `realized_pnl > 0`
2. **For accurate losses**: Need to investigate fee capture or alternative methodology
3. **For hybrid approach**: See `docs/systems/database/UI_PNL_METHODOLOGY.md`

---

*Claude 1 - PnL Calibration*
*Last Updated: 2025-11-22*
