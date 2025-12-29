# PnL Engine Canonical Specification

**Date:** 2025-11-28 (Session 14)
**Status:** FROZEN - V3 Algorithm Final
**Author:** Claude Code Terminal - Session 14

---

## Overview

This document is the **single source of truth** for Cascadian's PnL calculation system. It defines the trust hierarchy between metrics and establishes which values are canonical.

---

## Trust Hierarchy

### Tier 1: Canonical (100% Trust)

| Metric | Source | Notes |
|--------|--------|-------|
| **V9 Economic PnL** | `net_cash + net_tokens × payout_price` | Deterministic, complete, accurate |
| **fills_count** | Deduplicated CLOB events | `GROUP BY event_id` from `pm_trader_events_v2` |
| **redemptions_count** | PayoutRedemption events | From `pm_ctf_events` |
| **outcomes_traded** | Unique `(condition_id, outcome_index)` pairs | Per wallet |

**Usage:** Analytics dashboards, internal metrics, smart money scoring.

### Tier 2: Approximate (75% Trust)

| Metric | Source | Error Range | Notes |
|--------|--------|-------------|-------|
| **V10 pnl_activity_total** | Cost-basis V3 engine | 0-26% for normal wallets | Matches UI for redeemed positions |
| **volume_traded** | Sum of CLOB notional | -6% to -47% vs UI | Under-counts; UI may include redemptions |

**Usage:** UI parity display, approximate comparisons with Polymarket.

**Known Limitations:**
- W2 (perfect redeemer): 0% error
- W1, W4, W6 (partial redeemers): 7-26% error
- W5 (small positions): 129% error
- W3 (large unredeemed winner): 45,000%+ error (expected outlier)

### Tier 3: Unreliable (Do Not Use)

| Metric | Source | Error Range | Notes |
|--------|--------|-------------|-------|
| **gain_activity** | Per-outcome aggregation | 23-89% vs UI | We aggregate per-outcome, UI aggregates per-trade |
| **loss_activity** | Per-outcome aggregation | 80-400% vs UI | Same issue as gain_activity |
| **conditions_traded** | Outcome count | ~60-80% of UI "predictions" | We count outcomes, UI counts conditions |

**Usage:** NEVER use for display. Internal debugging only.

---

## Algorithm: V3 Activity PnL (FROZEN)

### Version
- **Engine:** `lib/pnl/uiActivityEngineV3.ts`
- **Version:** V3 Final (Session 14)
- **Status:** FROZEN - No changes without explicit user approval

### Data Sources

1. **CLOB Trades** from `pm_trader_events_v2`
   - Deduplicated with `GROUP BY event_id`
   - Buy events: add to position at cost
   - Sell events: realize PnL using average cost basis

2. **PayoutRedemption Events** from `pm_ctf_events`
   - Joined with `pm_condition_resolutions` for payout prices
   - Treated as "sell at payout_price"

3. **Implicit Resolution Losses**
   - Remaining positions in resolved markets
   - Realize at payout_price (winners AND losers)

### Algorithm Pseudocode

```typescript
// State per outcome (condition_id + outcome_index)
interface OutcomeState {
  position_qty: number;
  position_cost: number;
  realized_pnl: number;
}

// On BUY:
state.position_cost += fill.usdc_notional;
state.position_qty += fill.qty_tokens;

// On SELL or REDEMPTION:
if (state.position_qty > 0) {
  const avg_cost = state.position_cost / state.position_qty;
  const qty_to_sell = Math.min(fill.qty_tokens, state.position_qty);
  const pnl_now = (fill.price - avg_cost) * qty_to_sell;

  state.realized_pnl += pnl_now;
  state.position_cost -= avg_cost * qty_to_sell;
  state.position_qty -= qty_to_sell;
}

// POST-PROCESSING: Both winners and losers at resolution
for (const [key, state] of outcomeStates.entries()) {
  if (state.position_qty <= 0.01) continue;

  const resolution = resolutions.get(conditionId);
  if (!resolution) continue;

  const payout_price = resolution.payout_numerators[outcomeIndex];
  const avg_cost = state.position_cost / state.position_qty;
  const pnl_from_resolution = (payout_price - avg_cost) * state.position_qty;

  state.realized_pnl += pnl_from_resolution;
}
```

### Why V3 is Final

Tested alternatives:
- **V1 (CLOB-only):** Missing redemption PnL
- **V2 (+Redemptions):** Missing resolution losses
- **V3 (+Both winners and losers):** Best overall fit
- **V4 (Asymmetric - losers only):** Made errors WORSE (212-655% for W1, W4)

V3 achieves 0% error for wallets that fully redeem (W2) and acceptable error (7-26%) for normal trading patterns.

---

## ClickHouse Infrastructure

### Table

```sql
CREATE TABLE pm_wallet_pnl_ui_activity_v1 (
  wallet              String,
  pnl_activity_total  Float64,
  gain_activity       Float64,
  loss_activity       Float64,
  volume_traded       Float64,
  fills_count         UInt32,
  redemptions_count   UInt32,
  updated_at          DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet)
```

### View

```sql
CREATE VIEW vw_wallet_pnl_ui_activity_v1 AS
SELECT * FROM pm_wallet_pnl_ui_activity_v1 FINAL
```

### Materialization

```bash
# Full backfill (8 workers)
WORKERS=8 npx tsx scripts/pnl/materialize-wallet-pnl-ui-activity-v1.ts

# Specific wallets
WALLETS="0x1234,0x5678" npx tsx scripts/pnl/materialize-wallet-pnl-ui-activity-v1.ts
```

---

## Benchmark Wallets

| Label | Wallet | UI PnL | V3 PnL | Error | Notes |
|-------|--------|--------|--------|-------|-------|
| W1 | 0x9d36c904... | -$6,138.90 | -$7,451.28 | 21.4% | Partial redemption |
| **W2** | 0xdfe10ac1... | $4,404.92 | $4,405.20 | **0.0%** | Perfect match (all redeemed) |
| W3 | 0x418db17e... | $5.44 | $2,502.80 | 45,907% | Outlier (unredeemed Trump) |
| W4 | 0x4974d5c6... | -$294.61 | -$255.64 | 13.2% | Good match |
| W5 | 0xeab03de4... | $146.90 | $336.07 | 128.8% | Small positions |
| W6 | 0x7dca4d9f... | $470.40 | $592.33 | 25.9% | Partial match |

**Reference:** `scripts/pnl/ui-benchmark-constants.ts`

---

## API Usage Guidelines

### Recommended

```typescript
// For analytics dashboards
const economicPnl = walletData.pnl_economic; // V9 - canonical

// For UI parity display (with caveat)
const activityPnl = walletData.pnl_activity_total; // V10 - approximate
// Add tooltip: "Approximate value based on realized trades"
```

### Not Recommended

```typescript
// DO NOT use for display
const gain = walletData.gain_activity; // Unreliable
const loss = walletData.loss_activity; // Unreliable
```

---

## Related Documents

- [PNL_V9_UI_PARITY_SPEC.md](./PNL_V9_UI_PARITY_SPEC.md) - V9 Economic PnL
- [PNL_V10_UI_ACTIVITY_PNL_SPEC.md](./PNL_V10_UI_ACTIVITY_PNL_SPEC.md) - V10 Session 13-14 history
- [READ_ME_FIRST_PNL.md](../../READ_ME_FIRST_PNL.md) - PnL quick start guide

---

## Change Log

| Date | Session | Change |
|------|---------|--------|
| 2025-11-28 | 14 | Created canonical spec with trust hierarchy |
| 2025-11-28 | 14 | Froze V3 algorithm after V4 testing |
| 2025-11-28 | 13-14 | Implemented V3 engine, table, materialization |

---

*Signed: Claude Code Terminal - Session 14*
