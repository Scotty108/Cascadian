# Strategy Runtime Contract

**Status:** ✅ Integration Complete
**Date:** 2025-10-26
**Last Updated:** 2025-10-26
**Purpose:** Document how audited P&L, live signals, and escalation integrate with the strategy executor

## Integration Status

✅ **HIGH CONVICTION WALLETS** - Wired into executor startup (`lib/workflow/executor.ts`)
✅ **SUBSCRIPTION HOOKS** - Integrated into watchlist additions (`lib/workflow/node-executors.ts`)
✅ **ESCALATION LOGIC** - Called on momentum/wallet flow events
✅ **STATUS REPORTING** - Already implemented in start/pause/stop endpoints
⏳ **ORDER PLACEMENT** - Placeholder only (not implemented)

---

## Overview

The strategy runtime has been enhanced with three critical integrations:

1. **Audited Wallet P&L** - High conviction wallet identification
2. **Live Signal Subscriptions** - Market monitoring (stubs)
3. **Escalation Logic** - Watchlist → trade decision engine

All pieces are read-only. No production writes. No order placement yet.

---

## (A) Audited Wallet P&L Integration

### Source of Truth

**File:** `audited_wallet_pnl.json` (from Path B)
**Future:** `audited_wallet_pnl_extended.json` (when batch completes)

**Schema:**
```json
{
  "wallet": "0x...",
  "realized_pnl_usd": 1234.56,
  "resolved_conditions_covered": 25,
  "total_conditions_seen": 130,
  "coverage_pct": 19.23
}
```

### Integration Module

**File:** `lib/strategy/high-conviction-wallets.ts`

**Public API:**
```typescript
// Get all high conviction wallets (coverage ≥2%)
getHighConvictionWallets(minCoveragePct?: number, limit?: number): HighConvictionWallet[]

// Check if specific wallet is high conviction
isHighConvictionWallet(walletAddress: string, minCoveragePct?: number): boolean

// Get details for specific wallet
getHighConvictionWalletDetails(walletAddress: string, minCoveragePct?: number): HighConvictionWallet | null
```

### Governance Rules

- ✅ Only uses `audited_wallet_pnl.json` as P&L source
- ✅ Coverage threshold: ≥2% (configurable)
- ❌ Never touches legacy `pnl_net` columns
- ❌ Never uses contaminated "$563K" data
- ✅ Returns ranked list sorted by realized P&L descending

### Usage in Executor

```typescript
import { getHighConvictionWallets, isHighConvictionWallet } from '@/lib/strategy/high-conviction-wallets'

// Get signal wallets at strategy start
const signalWallets = getHighConvictionWallets()
console.log(`Monitoring ${signalWallets.length} high conviction wallets`)

// Check if trade came from high conviction wallet
const isSignalWallet = isHighConvictionWallet(tradeWalletAddress)
if (isSignalWallet) {
  // Add market to watchlist
}
```

---

## (B) Live Signal Subscription Interface

### Status: **STUB IMPLEMENTATION**

All subscription functions currently log events. Real-time feeds will be added later.

### Integration Module

**File:** `lib/strategy/market-subscription.ts`

**Event Types:**

1. **PriceMoveEvent** - Price ticks, spread, depth
2. **MomentumEvent** - Directional moves, volume spikes
3. **HighScoreWalletFlowEvent** - Trades from top wallets
4. **ResolutionClockEvent** - Time remaining alerts
5. **RuleChangeEvent** - Market text/rule changes

**Public API:**
```typescript
// Subscribe to live market signals (returns unsubscribe function)
subscribeToMarket(
  conditionId: string,
  marketId: string,
  callbacks: MarketSubscriptionCallbacks
): () => void

// Check for recent momentum (stub returns false)
hasRecentMomentum(conditionId: string, side: 'YES' | 'NO', thresholdPct?: number): boolean

// Get seconds until resolution (stub returns null)
getSecondsToResolution(conditionId: string): number | null
```

### Usage in Executor

```typescript
import { subscribeToMarket } from '@/lib/strategy/market-subscription'

// When market added to watchlist:
const unsubscribe = subscribeToMarket(conditionId, marketId, {
  onPriceMove: (event) => {
    console.log(`Price update: ${event.newPriceYes} / ${event.newPriceNo}`)
  },
  onMomentumSpike: (event) => {
    console.log(`Momentum on ${event.side}: ${event.magnitude}%`)
    // Trigger escalation check
    const escalation = evaluateEscalation(strategyId, conditionId, marketId, {
      preferredSide: event.side
    })
    if (escalation.level === 'READY_TO_TRADE') {
      // TODO: Size and place order
    }
  },
  onHighScoreWalletFlow: (event) => {
    console.log(`High conviction wallet ${event.wallet} traded ${event.side}`)
  }
})

// Later: unsubscribe() when removing from watchlist
```

### Future Implementation

When real-time feeds are added, replace stubs with:

1. **WebSocket connection** to Polymarket price feed
2. **Orderbook monitor** for depth/liquidity tracking
3. **Wallet flow tracker** querying recent trades
4. **Resolution time monitor** from market metadata
5. **Rule change detector** via polling Polymarket API

---

## (C) Escalation Logic

### Integration Module

**File:** `lib/strategy/escalation.ts`

**Escalation Levels:**

```typescript
type EscalationLevel = 'STAY_WATCHING' | 'ALERT_ONLY' | 'READY_TO_TRADE'
```

**Decision Tree (Hardcoded for MVP):**

| High Conviction Wallet | Momentum Event | Result |
|------------------------|----------------|---------|
| ✅ YES | ✅ YES | `READY_TO_TRADE` |
| ✅ YES | ❌ NO | `ALERT_ONLY` |
| ❌ NO | ✅ YES | `ALERT_ONLY` |
| ❌ NO | ❌ NO | `STAY_WATCHING` |

**Public API:**
```typescript
// Evaluate escalation for watchlist market
evaluateEscalation(
  strategyId: string,
  conditionId: string,
  marketId: string,
  context?: {
    recentWallets?: string[]
    preferredSide?: 'YES' | 'NO'
    timeToResolution?: number
  }
): EscalationResult
```

**Escalation Result:**
```typescript
{
  level: 'READY_TO_TRADE' | 'ALERT_ONLY' | 'STAY_WATCHING',
  reason: string,
  metadata: {
    hasHighConvictionWallet: boolean,
    hasMomentum: boolean,
    walletInvolved?: string,
    momentumSide?: 'YES' | 'NO'
  }
}
```

### Usage in Executor

```typescript
import { evaluateEscalation } from '@/lib/strategy/escalation'

// When new wallet flow detected or momentum event fires:
const result = evaluateEscalation(strategyId, conditionId, marketId, {
  recentWallets: ['0xabc...', '0xdef...'],
  preferredSide: 'NO',
  timeToResolution: 3600 // 1 hour
})

if (result.level === 'READY_TO_TRADE') {
  console.log(`🚨 Escalated to READY_TO_TRADE: ${result.reason}`)
  // TODO: Call order sizing and placement
  // For now: log intent and await implementation
}

if (result.level === 'ALERT_ONLY') {
  console.log(`⚠️ Alert: ${result.reason}`)
  // Send notification to dashboard/alerts
}
```

---

## Order Placement Slot (NOT IMPLEMENTED)

### Placeholder Functions

**File:** `lib/strategy/escalation.ts`

```typescript
// Calculate order size based on constraints
calculateOrderSize(strategyId: string, marketId: string, bankrollUsd: number): number

// Place limit order (NOT IMPLEMENTED - returns error)
placeStrategyOrder(strategyId: string, marketId: string, side: 'YES' | 'NO', sizeUsd: number): Promise<{success: false; error: string}>
```

### Future Implementation Requirements

When order placement is ready:

1. **Size Constraints:**
   - Max % of bankroll per trade (e.g. 5%)
   - Kelly criterion for optimal sizing
   - Total exposure limit across all positions
   - Market liquidity check (orderbook depth)

2. **Order Placement:**
   - **LIMIT ORDERS ONLY** (never market orders for strategies)
   - Record intent in database BEFORE placing
   - Wait for fill confirmation
   - Update strategy state on fill/timeout

3. **Intent Tracking:**
   - Create `strategy_trade_intents` table
   - Fields: strategy_id, market_id, side, size, limit_price, status, created_at
   - Status: pending → filled | cancelled | timeout

4. **Risk Management:**
   - Check available balance before placing
   - Prevent duplicate orders on same market
   - Cancel stale orders after timeout
   - Log all order attempts for audit

---

## Strategy Status Reporting

### Status: ✅ ALREADY IMPLEMENTED

**API Route:** `app/api/strategies/[id]/status/route.ts`
**Database:** `workflow_sessions` table → `status` column

### Status Values

```typescript
type StrategyStatus = 'running' | 'paused' | 'stopped' | 'error'
```

### Implementation

Status updates are **already correctly implemented** in the control endpoints:

1. **`app/api/strategies/[id]/start/route.ts`** → Sets `status = 'running'`, `auto_run = true`
2. **`app/api/strategies/[id]/pause/route.ts`** → Sets `status = 'paused'`, `auto_run = false`
3. **`app/api/strategies/[id]/stop/route.ts`** → Sets `status = 'stopped'`, `auto_run = false`

**Example from start endpoint:**
```typescript
await supabase
  .from('workflow_sessions')
  .update({
    status: 'running',
    auto_run: true,
    execution_interval_minutes: executionInterval,
    next_execution_at: nextExecutionAt,
  })
  .eq('id', id)
```

The status API reads this field and returns the current state correctly. No changes needed.

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ audited_wallet_pnl.json (Path B)                           │
│ - Source of truth for wallet quality                       │
│ - Coverage ≥2% = high conviction                           │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│ high-conviction-wallets.ts                                  │
│ - getHighConvictionWallets()                                │
│ - isHighConvictionWallet(wallet)                            │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│ STRATEGY EXECUTOR                                           │
│                                                              │
│ 1. Load high conviction wallets at startup                  │
│ 2. Monitor markets where they trade                         │
│ 3. Subscribe to live signals (price, momentum, flow)        │
│ 4. Evaluate escalation on signal events                     │
│ 5. Update status in workflow_sessions                       │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│ market-subscription.ts (STUBS)                              │
│ - subscribeToMarket(condition_id, callbacks)                │
│ - onMomentumSpike → trigger escalation check                │
│ - onHighScoreWalletFlow → trigger escalation check          │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│ escalation.ts                                               │
│ - evaluateEscalation() → READY_TO_TRADE | ALERT | WATCHING │
│ - If READY_TO_TRADE → TODO: size and place order           │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│ ORDER PLACEMENT (NOT IMPLEMENTED)                           │
│ - calculateOrderSize()                                      │
│ - placeStrategyOrder() → limit orders only                  │
│ - Record intent → place → wait for fill                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Integration Checklist

**✅ Completed:**

- [x] Audited P&L integration (`high-conviction-wallets.ts`)
- [x] Live signal subscription interfaces (`market-subscription.ts` - stubs)
- [x] Escalation logic (`escalation.ts`)
- [x] Order placement slot documented (placeholders)
- [x] Runtime contract documentation

**⏳ TODO (Future Work):**

- [x] Wire `getHighConvictionWallets()` into executor startup ✅ DONE
- [x] Call `subscribeToMarket()` when adding to watchlist ✅ DONE
- [x] Call `evaluateEscalation()` on momentum/wallet flow events ✅ DONE
- [x] Fix status updates in start/pause/stop endpoints ✅ ALREADY IMPLEMENTED
- [ ] Replace subscription stubs with real-time feeds
- [ ] Implement order sizing logic
- [ ] Implement order placement with intent tracking
- [ ] Add risk management constraints

---

## Compliance Notes

**✅ All implementations follow policy:**

1. **Read-only operations** - No production database writes
2. **Audited P&L only** - Uses `audited_wallet_pnl.json` exclusively
3. **No legacy data** - Never touches `pnl_net`, `pnl_gross`, contaminated columns
4. **Coverage contract** - 2% minimum coverage enforced
5. **Stub transparency** - All stubs clearly marked and logged

**❌ Not allowed:**

- Writing to `wallet_scores` or production tables
- Using ClickHouse `pnl_net` for wallet quality
- Placing orders (placeholder only)
- Claiming real-time signals (stubs only)

---

## For Infrastructure & Trading Teams

### Executor Integration Points

**✅ All integration points are now implemented:**

1. **On strategy start** (✅ DONE in `lib/workflow/executor.ts:36-54`)
   ```typescript
   // Load high conviction wallets for strategy
   const highConvictionWallets = getHighConvictionWallets()
   console.log(`[Strategy ${workflow.id}] Loaded ${highConvictionWallets.length} high conviction wallets`)

   const context: ExecutionContext = {
     // ...
     globalState: {
       highConvictionWallets, // Available to all nodes
     },
   }
   ```

2. **On market added to watchlist** (✅ DONE in `lib/workflow/node-executors.ts:659-720`)
   ```typescript
   const unsubscribe = subscribeToMarket(conditionId, marketId, {
     onMomentumSpike: (event) => {
       console.log(`[Watchlist ${context.workflowId}] Momentum spike on ${conditionId}`)
       const escalation = evaluateEscalation(context.workflowId, conditionId, marketId, {
         preferredSide: event.side,
       })
       if (escalation.level === 'READY_TO_TRADE') {
         console.log(`🚨 ${escalation.reason}`)
         // TODO: Trigger order sizing and placement
       }
     },
     onHighScoreWalletFlow: (event) => {
       console.log(`[Watchlist ${context.workflowId}] High conviction wallet traded`)
       const escalation = evaluateEscalation(context.workflowId, conditionId, marketId, {
         recentWallets: [event.wallet],
         preferredSide: event.side,
       })
       // Handle escalation...
     }
   })
   context.watchlists.set(conditionId, unsubscribe)
   ```

3. **On signal event** (✅ DONE - integrated into watchlist callbacks above)
   - Escalation is evaluated when momentum or wallet flow events fire
   - Results are logged with appropriate emoji (🚨 for READY_TO_TRADE, ⚠️ for ALERT_ONLY)
   - Order placement is TODO but framework is in place

4. **On status change** (✅ ALREADY IMPLEMENTED in API routes)
   - Start endpoint updates `status = 'running'`
   - Pause endpoint updates `status = 'paused'`
   - Stop endpoint updates `status = 'stopped'`
   - Status API correctly reads and returns current state

### Testing Recommendations

1. **High Conviction Wallets:**
   ```bash
   npx tsx -e "import {getHighConvictionWallets} from './lib/strategy/high-conviction-wallets'; console.log(getHighConvictionWallets())"
   ```

2. **Subscription Stubs:**
   - Should see log messages when called
   - Verify callbacks are registered
   - Check unsubscribe cleans up

3. **Escalation Logic:**
   - Test all 4 decision tree branches
   - Verify reason strings are descriptive
   - Check metadata includes all context

---

**End of Runtime Contract**
