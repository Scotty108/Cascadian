# Complete Trading Workflows ✅

**Updated:** 2025-10-26
**Status:** All 10 strategies now have explicit ACTION nodes

---

## Overview

All predefined strategies now have **complete trading workflows** showing every step from discovery to execution:

1. **Find opportunities** (DATA_SOURCE)
2. **Filter by criteria** (ENHANCED_FILTER)
3. **Select best candidates** (AGGREGATION)
4. **Calculate position sizes** (ORCHESTRATOR)
5. **Execute trades** (ACTION) ⭐ NEW!

---

## Complete Workflows

### 1. Aggressive Growth
**Goal:** Maximum capital growth with elite traders
**CRON:** Every 10 minutes (`*/10 * * * *`)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. DATA_SOURCE                                              │
│    • Source: WALLETS (wallet_metrics_complete)              │
│    • Prefilter: closed_positions >= 25                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. ENHANCED_FILTER (6 conditions, AND logic)                │
│    • bets_per_week > 3                                      │
│    • closed_positions > 25                                  │
│    • deposit_driven_pnl < 0.2                               │
│    • omega_ratio > 3.0 (elite skill)                        │
│    • omega_lag_30s > 2.0 (copyable)                         │
│    • tail_ratio > 3.0 (asymmetric)                          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. AGGREGATION                                              │
│    • Function: TOP_N                                        │
│    • Field: ev_per_hour_capital                             │
│    • Limit: 10 wallets                                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. ORCHESTRATOR (Position Sizing)                           │
│    • Kelly: 0.40 (aggressive)                               │
│    • Max per position: 12%                                  │
│    • Portfolio heat: 75%                                    │
│    • Risk tolerance: 8/10                                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. ACTION (Execute Trades) ⭐                                │
│    • Type: PLACE_LIMIT_ORDER                                │
│    • Max positions: 10                                      │
│    • Profit target: +30%                                    │
│    • Stop loss: -15%                                        │
│    • Max hold: 48 hours                                     │
│    • Trailing stop: Yes (activate at +15%, trail 8%)        │
└─────────────────────────────────────────────────────────────┘
```

---

### 2. Balanced Hybrid
**Goal:** Balance profitability with risk management
**CRON:** Every 15 minutes (`*/15 * * * *`)

```
DATA_SOURCE (wallet_scores_by_category)
    ↓
ENHANCED_FILTER
    • total_positions >= 30
    • closed_positions >= 20
    • total_pnl > 500
    • omega_ratio >= 2.0
    • win_rate >= 0.50
    ↓
AGGREGATION (Top 15 by P&L)
    ↓
ORCHESTRATOR
    • Kelly: 0.30
    • Max per position: 8%
    • Risk: 5/10
    ↓
ACTION ⭐
    • Max positions: 15
    • Profit target: +20%
    • Stop loss: -10%
    • Max hold: 72 hours
```

---

### 3. Momentum Rider
**Goal:** Ride hot hands with improving performance
**CRON:** Every 10 minutes (`*/10 * * * *`)

```
DATA_SOURCE (wallet_scores_by_category)
    ↓
ENHANCED_FILTER
    • total_positions >= 30
    • closed_positions >= 20
    • omega_momentum > 0 (trending up!)
    • omega_ratio >= 2.0
    • total_pnl > 500
    ↓
AGGREGATION (Top 12 by omega_momentum)
    ↓
ORCHESTRATOR
    • Kelly: 0.35
    • Max per position: 10%
    • Risk: 7/10
    ↓
ACTION ⭐
    • Max positions: 12
    • Profit target: +25%
    • Stop loss: -12%
    • Max hold: 48 hours
    • Trailing stop: Yes (activate +12%, trail 6%)
    • Momentum exit: Yes (exit if momentum reverses)
```

---

### 4. Safe & Steady
**Goal:** Conservative compounding with minimal drawdown
**CRON:** Every 30 minutes (`*/30 * * * *`)

```
DATA_SOURCE (wallet_metrics_complete, 100+ trades)
    ↓
ENHANCED_FILTER
    • bets_per_week > 5
    • closed_positions > 100
    • max_drawdown > -0.2 (limit losses)
    • time_in_drawdown_pct < 0.3 (fast recovery)
    ↓
AGGREGATION (Top 12 by sortino_ratio)
    ↓
ORCHESTRATOR
    • Kelly: 0.25 (conservative)
    • Max per position: 6%
    • Risk: 3/10
    ↓
ACTION ⭐
    • Max positions: 12
    • Profit target: +15%
    • Stop loss: -8%
    • Max hold: 120 hours
    • Time stop: Yes
```

---

### 5. Eggman Hunter (AI Specialist)
**Goal:** Find next "Eggman" in AI category
**CRON:** Every 20 minutes (`*/20 * * * *`)

```
DATA_SOURCE (wallet_metrics_by_category, AI only)
    ↓
ENHANCED_FILTER
    • category = "AI"
    • closed_positions > 10
    • calibration_error < 0.1 (true forecasting skill)
    • omega_lag_2min > 3.0 (copyable)
    • clv_lag_0s > 0 (execution skill)
    ↓
AGGREGATION (Top 8 by ev_per_hour_category)
    ↓
ORCHESTRATOR
    • Kelly: 0.35
    • Max per position: 10%
    • Risk: 6/10
    ↓
ACTION ⭐
    • Max positions: 8
    • Profit target: +25%
    • Stop loss: -12%
    • Max hold: 96 hours
    • Follow source wallet: Yes (exit if they exit)
```

---

### 6. Fortress
**Goal:** Maximum capital preservation
**CRON:** Every 6 hours (`0 */6 * * *`)

```
DATA_SOURCE (wallet_metrics_complete, 150+ trades)
    ↓
ENHANCED_FILTER
    • closed_positions > 150
    • max_drawdown > -0.15 (minimal losses)
    • time_in_drawdown_pct < 0.2
    • calmar_ratio > 1.5
    ↓
AGGREGATION (Top 10 by calmar_ratio)
    ↓
ORCHESTRATOR
    • Kelly: 0.20 (ultra-conservative)
    • Max per position: 5%
    • Risk: 2/10
    ↓
ACTION ⭐
    • Max positions: 8
    • Profit target: +12%
    • Stop loss: -6%
    • Max hold: 168 hours
    • Early exit on deterioration: Yes
```

---

### 7. Rising Star
**Goal:** Find emerging talent early
**CRON:** Every 20 minutes (`*/20 * * * *`)

```
DATA_SOURCE (wallet_metrics_complete)
    ↓
ENHANCED_FILTER
    • closed_positions >= 30 (emerging)
    • closed_positions <= 100 (not too established)
    • roi_30d >= 0.2 (hot recent performance)
    • omega_momentum_30d > 0 (improving)
    • total_pnl > 200 (already profitable)
    ↓
AGGREGATION (Top 10 by roi_30d)
    ↓
ORCHESTRATOR
    • Kelly: 0.30
    • Max per position: 8%
    • Risk: 6/10
    ↓
ACTION ⭐
    • Max positions: 10
    • Profit target: +25%
    • Stop loss: -12%
    • Max hold: 72 hours
    • Follow source wallet: Yes
```

---

### 8. Alpha Decay Detector
**Goal:** Fade declining wallets (contrarian)
**CRON:** Every 4 hours (`0 */4 * * *`)

```
DATA_SOURCE (wallet_metrics_complete, 100+ trades)
    ↓
ENHANCED_FILTER
    • closed_positions > 100
    • omega_momentum_30d < 0 (declining!)
    • clv_momentum_30d < 0 (execution worsening)
    • omega_ratio > 1.5 (was good before)
    ↓
AGGREGATION (Bottom 10 by combined_momentum_z - biggest declines)
    ↓
ORCHESTRATOR
    • Kelly: 0.25
    • Max per position: 6%
    • Risk: 4/10
    • Preferred side: OPPOSITE (fade them!)
    ↓
ACTION ⭐
    • Type: FADE (take opposite side)
    • Max positions: 8
    • Profit target: +15%
    • Stop loss: -10%
    • Max hold: 96 hours
```

---

### 9. Scotty's Strategy
**Goal:** Last 12h opportunities, YES 10-40%, profit > fees
**CRON:** Every 5 minutes (`*/5 * * * *`)

```
DATA_SOURCE (MARKETS, active, volume > 1000)
    ↓
ENHANCED_FILTER
    • price >= 0.10 (YES 10%)
    • price <= 0.40 (YES 40%)
    • volume > 5000
    • liquidity > 1000
    • active = true
    ↓
ORCHESTRATOR
    • Kelly: 0.375
    • Max per position: 5%
    • Preferred side: NO (79% base rate)
    ↓
ACTION ⭐
    • Type: PLACE_LIMIT_ORDER
    • Max positions: 20
    • Profit target: +15%
    • Stop loss: -10%
    • Max hold: 12 hours
    • Exit 1h before resolution
```

---

### 10. Category Copy Trading
**Goal:** Copy elite wallets in specific categories
**CRON:** Every 5 minutes (`*/5 * * * *`)

```
DATA_SOURCE (WALLETS - category specialists)
    ↓
ENHANCED_FILTER (Category + Metrics)
    • category = "Politics"
    • omega_ratio >= 2.5
    • win_rate >= 0.55
    • total_pnl > 1000
    • roi_per_bet > 50
    • closed_positions >= 20
    ↓
AGGREGATION (Top 10 by P&L)
    ↓
DATA_SOURCE (WALLET_POSITIONS - their open positions)
    ↓
ENHANCED_FILTER (Time + Liquidity)
    • active = true
    • volume > 5000
    • liquidity > 1000
    • price: 0.15 - 0.85
    ↓
ORCHESTRATOR
    • Kelly: 0.25 (conservative copy trading)
    • Max per position: 10%
    • Max 60% deployed
    ↓
ACTION ⭐
    • Type: COPY TRADE
    • Max positions: 15
    • Follow wallet side: Yes
    • Profit target: +20%
    • Stop loss: -10%
    • Max hold: 12 hours
    • Follow wallet exits: Yes
```

---

## Key Features

### Every Strategy Now Has:

✅ **Explicit Trade Execution** - ACTION nodes show exactly what trades happen
✅ **Clear Exit Rules** - Profit targets, stop losses, time limits
✅ **Position Limits** - Max concurrent positions defined
✅ **Risk Management** - Stop losses, trailing stops, time stops
✅ **CRON Automation** - Runs automatically on schedule

### Execution Flow:

```
Every N minutes:
├─ CRON triggers
├─ Find opportunities (DATA_SOURCE)
├─ Filter by criteria (ENHANCED_FILTER)
├─ Select best candidates (AGGREGATION)
├─ Calculate position sizes (ORCHESTRATOR)
│  ├─ Kelly criterion
│  ├─ Risk limits
│  └─ Portfolio heat
├─ Execute trades (ACTION)
│  ├─ Place limit orders
│  ├─ Set stop losses
│  └─ Monitor exits
└─ Wait for next CRON trigger
```

---

## What You'll See in the UI

When you open any strategy in the Strategy Builder, you'll now see:

1. **Data Source Node** - Where opportunities come from
2. **Enhanced Filter Node** - All filtering conditions
3. **Aggregation Node** - How we select the best
4. **Orchestrator Node** - Position sizing rules
5. **Action Node** ⭐ - **The actual trading logic!**

Each node is connected in a **clear linear flow** from left to right.

---

## Comparison: Before vs After

### Before
```
DATA_SOURCE → ENHANCED_FILTER → AGGREGATION → ORCHESTRATOR
                                                    ↓
                                              (Then what? 🤷)
```

### After
```
DATA_SOURCE → ENHANCED_FILTER → AGGREGATION → ORCHESTRATOR → ACTION
                                                                 ↓
                                                      (Execute trades! 🎯)
```

---

## Testing

All strategies validated:
```bash
npm exec tsx scripts/audit-all-strategies.ts
```

**Results:**
- ✅ 10/10 strategies valid
- ✅ All have ACTION nodes
- ✅ Complete linear workflows
- ✅ SCHEDULED execution
- ✅ 0 disconnected nodes

---

**Status:** Complete Trading Workflows ✅
**Last Updated:** 2025-10-26
**Created By:** Claude Code
