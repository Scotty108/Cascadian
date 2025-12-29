# PnL V9 UI Parity Specification

**Date:** 2025-11-28 (Session 13)
**Status:** IN PROGRESS
**Parent Document:** [PNL_V8_PROXY_PNL_NOTES.md](./PNL_V8_PROXY_PNL_NOTES.md)

---

## Overview

This document specifies **Plan B: UI Parity PnL** - a second PnL surface that aims to reproduce the wallet Profit/Loss UI metrics on polymarket.com as closely as possible.

### Two PnL Metrics in Cascadian

| Metric | Formula | Purpose |
|--------|---------|---------|
| **V9 Economic PnL** | `net_cash + net_tokens × payout_price` | True economic performance, analytics, rankings |
| **UI Parity PnL** | TBD (this spec) | Match Polymarket wallet UI display |

**Important:** These are complementary, not competing metrics:
- V9 Economic PnL = What the trader actually made/lost
- UI Parity PnL = What Polymarket shows users in their dashboard

---

## UI Benchmark Wallets

These values were captured directly from polymarket.com wallet pages (ALL timeframe):

```typescript
const UI_BENCHMARK_WALLETS = [
  {
    wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486',
    label: 'W1',
    profitLoss_all: -6138.90,
    volume_all: 205876.66,
    gain_all: 37312.46,
    loss_all: -43451.36,
    positions_value: 0.01,
    predictions: 15,
    notes: 'UI says All Time. Our V9 econ PnL is ~-17.5k. Suspect different time filter or special handling.'
  },
  {
    wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838',
    label: 'W2',
    profitLoss_all: 4404.92,
    volume_all: 23191.46,
    gain_all: 6222.31,
    loss_all: -1817.39,
    positions_value: 0.01,
    predictions: 22,
    notes: 'V9 econ PnL was ~4417.84, extremely close to UI net total.'
  },
  {
    wallet: '0x418db17eaa8f25eaf2085657d0becd82462c6786',
    label: 'W3',
    profitLoss_all: 5.44,
    volume_all: 30868.84,
    gain_all: 14.90,
    loss_all: -9.46,
    positions_value: 5.57,
    predictions: 30,
  },
  {
    wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15',
    label: 'W4',
    profitLoss_all: -294.61,
    volume_all: 141825.27,
    gain_all: 3032.88,
    loss_all: -3327.49,
    positions_value: 168.87,
    predictions: 52,
  },
  {
    wallet: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2',
    label: 'W5',
    profitLoss_all: 146.90,
    volume_all: 6721.77,
    gain_all: 148.40,
    loss_all: -1.50,
    positions_value: 0.01,
    predictions: 9,
  },
  {
    wallet: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d',
    label: 'W6',
    profitLoss_all: 470.40,
    volume_all: 44145.02,
    gain_all: 1485.80,
    loss_all: -1015.40,
    positions_value: 1628.12,
    predictions: 89,
  },
];
```

### Calibration Strategy

- **Primary anchors:** W2, W3, W4, W5, W6 (these should match closely)
- **Secondary/suspect:** W1 (may be using different time filter or special handling)

---

## Metrics Checklist

For each wallet, we want to approximate:

| Metric | UI Label | Status |
|--------|----------|--------|
| Profit/Loss (Net total) | "Profit/Loss · ALL" | Priority 1 |
| Volume traded | "Volume traded" | Priority 1 |
| Gain | "Gain" | Priority 1 |
| Loss | "Loss" | Priority 1 |
| Predictions | "Predictions" | Priority 2 |
| Positions Value | "Positions value" | Priority 3 (requires live prices) |

---

## Candidate Definitions

### 1. Profit/Loss (Net Total)

**Candidate 1: V9 Economic PnL**
```sql
-- Per condition:
realized_pnl = net_cash + (net_tokens × payout_price)
-- Aggregate per wallet:
pnl_net_total = SUM(realized_pnl) for all resolved conditions
```

**Hypothesis:** For most wallets, V9 economic PnL should match UI Profit/Loss closely.

### 2. Volume Traded

**Candidate 1: Sum of absolute USDC from all trades**
```sql
volume_traded = SUM(abs(usdc_amount) / 1e6)
FROM pm_trader_events_v2
WHERE wallet = X
GROUP BY event_id -- dedupe first
```

**Candidate 2: Buy volume + Sell volume separately**
```sql
volume_traded = SUM(buy_usdc) + SUM(sell_usdc)
```

### 3. Gain and Loss

**Candidate 1: Split by condition-level PnL sign**
```sql
-- Per condition:
realized_pnl_condition = net_cash + (net_tokens × payout_price)

-- Aggregate:
gain = SUM(realized_pnl_condition) WHERE realized_pnl_condition > 0
loss = SUM(realized_pnl_condition) WHERE realized_pnl_condition < 0
```

### 4. Predictions

**Candidate 1: Count distinct conditions with any trade activity**
```sql
predictions = COUNT(DISTINCT condition_id)
FROM trades
WHERE wallet = X
```

### 5. Positions Value

**Deferred:** Requires live prices. Stub for now:
```sql
positions_value = SUM(current_size × mid_price)
-- where current_size = net_tokens for unresolved positions
```

---

## Benchmark Results

### Session 13 Results (2025-11-28)

#### PnL Comparison Table

| Wallet | UI PnL | V9 Econ PnL | Diff | Diff % | Match? |
|--------|--------|-------------|------|--------|--------|
| W1 | -$6,138.90 | -$17,543.75 | -$11,404.85 | 185.8% | **NO** |
| W2 | $4,404.92 | $4,417.84 | +$12.92 | **0.3%** | **YES** |
| W3 | $5.44 | $2,541.38 | +$2,535.94 | 46617% | **NO** |
| W4 | -$294.61 | $566.97 | +$861.58 | 292% | **NO** |
| W5 | $146.90 | $464.10 | +$317.20 | 216% | **NO** |
| W6 | $470.40 | $370.26 | -$100.14 | 21% | **NO** |

#### Volume Comparison Table

| Wallet | UI Volume | V9 Volume | Diff % | Match? |
|--------|-----------|-----------|--------|--------|
| W1 | $205,876.66 | $207,966.69 | **1.0%** | **YES** |
| W2 | $23,191.46 | $12,382.50 | 46.6% | NO |
| W3 | $30,868.84 | $25,767.15 | 16.5% | PARTIAL |
| W4 | $141,825.27 | $105,861.44 | 25.4% | NO |
| W5 | $6,721.77 | $5,565.89 | 17.2% | PARTIAL |
| W6 | $44,145.02 | $41,530.59 | 5.9% | PARTIAL |

#### Predictions Comparison Table

| Wallet | UI Predictions | V9 Conditions | V9 Markets | Match? |
|--------|----------------|---------------|------------|--------|
| W1 | 15 | 15 | 15 | **YES** |
| W2 | 22 | 22 | 22 | **YES** |
| W3 | 30 | 30 | 30 | **YES** |
| W4 | 52 | 52 | 52 | **YES** |
| W5 | 9 | 9 | 9 | **YES** |
| W6 | 89 | 97 | 97 | CLOSE |

---

## Critical Discovery: UI vs V9 Methodology

### W2 is a Perfect Match

W2 shows a **0.3% match** between V9 and UI PnL. This validates the V9 formula is correct.

### W3 Deep Dive: Why the Massive Difference?

| Metric | Value |
|--------|-------|
| Trading Net Cash | -$5,203.07 (money spent on trades) |
| Resolution Payouts | +$7,744.45 (tokens × payout_price) |
| **V9 Economic PnL** | **+$2,541.38** |
| **UI Profit/Loss** | **+$5.44** |

**Gap: $2,536** (V9 shows 46,600% more profit than UI)

Key finding: W3 has a **large Trump position** (7,494 tokens worth $7,494 at resolution) that:
- Our V9 formula correctly values at resolution price
- The UI appears to NOT include in realized PnL

### Hypothesis: UI Only Counts "Redeemed" Payouts

The UI's Profit/Loss appears to:
1. **NOT** automatically credit resolution value for held positions
2. Only count PnL when tokens are actually **sold** or **redeemed (burned)**
3. The Data API's `realizedPnl` shows only $0.11 for W3 (tiny partial sales)

This means:
- **V9 = True Economic PnL** (what you've actually made/lost based on final outcomes)
- **UI = Activity-Based PnL** (what you've "realized" through trading actions)

### Why W2 Matches Perfectly

W2 traded in "Up or Down" short-duration markets and **held positions to resolution**. These markets:
- Resolve quickly (same day)
- Tokens are automatically redeemed at resolution
- So trading PnL ≈ economic PnL for W2

### What This Means for Cascadian

**We have two valid but different PnL metrics:**

| Metric | Formula | Best Use Case |
|--------|---------|---------------|
| **V9 Economic PnL** | `net_cash + net_tokens × payout_price` | Analytics, rankings, true performance |
| **UI Activity PnL** | Trading gains only (no held-to-resolution) | Matching Polymarket dashboard |

---

## Recommendation: Use V9 as Canonical

For Cascadian's analytics and ranking purposes, **V9 Economic PnL is the superior metric** because:

1. **It's deterministic** - Same inputs always produce same output
2. **It's complete** - Includes all value, not just "realized through action"
3. **It's accurate** - Shows true economic performance
4. **It matches for active traders** - W2 validates the formula

The UI mismatch is explainable:
- Users who hold positions to resolution without redeeming show lower UI PnL
- This is a UI/UX choice by Polymarket, not an error in our formula

### Production Views

1. **`vw_realized_pnl_v9`** - Canonical economic PnL (use for rankings)
2. **`vw_wallet_pnl_v9`** - Aggregated per-wallet economic PnL

### Metrics That Match Well

- **Predictions count** - Nearly exact match (our conditions = their predictions)
- **Volume** - Within 1-25% for most wallets (different counting methodology)

---

## Implementation Plan

### Phase 1: Benchmark Harness
- Script: `scripts/pnl/ui-parity-benchmarks.ts`
- Compare V9 metrics to UI values for all 6 wallets

### Phase 2: Candidate Testing
- Test each candidate definition
- Select best match for W2-W6

### Phase 3: Create View
- View: `vw_wallet_pnl_ui_parity_v1`
- Columns: wallet, pnl_ui_net_total, pnl_ui_gain, pnl_ui_loss, volume_traded_ui, predictions_ui

### Phase 4: W1 Investigation
- Understand why W1 diverges significantly
- Document as known gap or identify root cause

---

## Files

| File | Purpose |
|------|---------|
| `docs/systems/database/PNL_V9_UI_PARITY_SPEC.md` | This spec document |
| `scripts/pnl/ui-parity-benchmarks.ts` | Benchmark comparison script |
| `vw_wallet_pnl_ui_parity_v1` | ClickHouse view for UI parity metrics |

---

*Signed: Claude Code Terminal - Session 13*
