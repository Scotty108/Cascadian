# Strategy Executor Integration - Complete

**Date:** 2025-10-26
**Status:** ✅ Ready for executor wiring

---

## What Was Built

Three concrete integrations as requested:

### (A) Audited P&L Integration ✅

**Files Created:**
- `lib/data/wallet-pnl-feed.ts` - Loads `audited_wallet_pnl.json`
- `lib/strategy/high-conviction-wallets.ts` - Public API for executor

**Key Functions:**
```typescript
// Get all high conviction wallets (coverage ≥2%)
getHighConvictionWallets(minCoveragePct?: number, limit?: number)

// Check if wallet is high conviction
isHighConvictionWallet(walletAddress: string)

// Get wallet details
getHighConvictionWalletDetails(walletAddress: string)
```

**Governance:**
- ✅ Only uses `audited_wallet_pnl.json` (never legacy `pnl_net`)
- ✅ Coverage threshold: 2% minimum (configurable)
- ✅ Returns ranked list by realized P&L
- ✅ Read-only, no production writes

### (B) Live Signal Subscription Interface ✅

**File Created:**
- `lib/strategy/market-subscription.ts` - Stub interfaces for live feeds

**Event Types:**
- `PriceMoveEvent` - Price ticks, spread, depth
- `MomentumEvent` - Directional moves, volume spikes
- `HighScoreWalletFlowEvent` - High conviction wallet trades
- `ResolutionClockEvent` - Time remaining alerts
- `RuleChangeEvent` - Market rule changes

**Key Functions:**
```typescript
// Subscribe to market signals (returns unsubscribe function)
subscribeToMarket(conditionId, marketId, callbacks)

// Check for momentum (stub - returns false until real feed)
hasRecentMomentum(conditionId, side, thresholdPct)

// Get time to resolution (stub - returns null until real feed)
getSecondsToResolution(conditionId)
```

**Status:**
- ✅ All interfaces defined
- ⏳ Implementations are stubs (log only)
- 📋 Ready for real-time feed integration

### (C) Escalation Logic + Strategy Status ✅

**File Created:**
- `lib/strategy/escalation.ts` - Decision engine for watchlist → trade

**Escalation Levels:**
```
STAY_WATCHING    → Normal monitoring
ALERT_ONLY       → Interesting but not ready
READY_TO_TRADE   → All conditions met
```

**Decision Rule (Hardcoded for MVP):**
| High Conviction Wallet | Momentum | Result |
|------------------------|----------|---------|
| ✅ YES | ✅ YES | `READY_TO_TRADE` |
| ✅ YES | ❌ NO | `ALERT_ONLY` |
| ❌ NO | ✅ YES | `ALERT_ONLY` |
| ❌ NO | ❌ NO | `STAY_WATCHING` |

**Key Functions:**
```typescript
// Evaluate escalation level
evaluateEscalation(strategyId, conditionId, marketId, context)

// Placeholder for future order sizing
calculateOrderSize(strategyId, marketId, bankrollUsd)

// Placeholder for future order placement
placeStrategyOrder(strategyId, marketId, side, sizeUsd)
```

**Strategy Status:**
- ✅ Status routes already correct (start→running, pause→paused, stop→stopped)
- ✅ No fixes needed in API routes
- 📋 Executor just needs to call these routes

---

## Executor Integration Layer

**File Created:**
- `lib/workflow/executor-integration.ts` - Wiring layer for executor

**Functions for Executor:**

```typescript
// 1. Initialize strategy runtime (call on start)
initializeStrategyRuntime(strategyId, context)
// Returns enhanced context with high conviction wallets

// 2. Add market to watchlist (call when high conviction wallet trades)
addMarketToWatchlist(context, conditionId, marketId, metadata, triggeredByWallet)
// Subscribes to signals, evaluates escalation on events

// 3. Cleanup runtime (call on stop)
cleanupStrategyRuntime(context)
// Unsubscribes from all markets
```

**What It Does:**
1. Loads high conviction wallets at startup
2. Subscribes to market signals when adding to watchlist
3. Evaluates escalation when signals fire
4. Sends notifications for ALERT_ONLY and READY_TO_TRADE
5. Updates watchlist status in store
6. Logs all events for debugging

---

## How to Wire Into Executor

### Step 1: Import Integration Layer

```typescript
import {
  initializeStrategyRuntime,
  addMarketToWatchlist,
  cleanupStrategyRuntime,
  type EnhancedExecutionContext
} from '@/lib/workflow/executor-integration'
```

### Step 2: Initialize on Strategy Start

```typescript
// In startStrategy() or continuous monitoring setup:
const enhancedContext = initializeStrategyRuntime(workflowId, baseContext)

// Now context includes:
// - highConvictionWallets: Array of top wallets
// - marketSubscriptions: Map for cleanup
// - strategyId: For database updates
```

### Step 3: Monitor High Conviction Wallet Activity

```typescript
// When detecting wallet activity (from trades_raw or live feed):
const wallet = '0xabc...'
const market = {
  condition_id: '0x123...',
  market_id: 'market-456',
  category: 'politics',
  question: 'Will X happen?'
}

if (isHighConvictionWallet(wallet)) {
  addMarketToWatchlist(
    enhancedContext,
    market.condition_id,
    market.market_id,
    { category: market.category, question: market.question },
    wallet // Triggered by this wallet
  )
}
```

### Step 4: Handle Escalation Results

**Automatic** - The integration layer handles escalation internally:
- Calls `evaluateEscalation()` when signals fire
- Updates watchlist status
- Sends notifications
- Logs READY_TO_TRADE events

**What Executor Sees:**
```
[Strategy Runtime] 🚨 READY_TO_TRADE: 0x123...
[Strategy Runtime] TODO: Calculate order size and place limit order
[Strategy Runtime] Metadata: {...}
```

### Step 5: Cleanup on Stop

```typescript
// When strategy stops:
cleanupStrategyRuntime(enhancedContext)
// Unsubscribes from all markets
```

---

## Testing the Integration

### Test 1: High Conviction Wallets

```bash
# Run in project root:
npx tsx -e "
import { getHighConvictionWallets } from './lib/strategy/high-conviction-wallets.js';
const wallets = getHighConvictionWallets();
console.log('Found', wallets.length, 'high conviction wallets');
console.log('Top 3:', wallets.slice(0, 3));
"
```

**Expected Output:**
```
Found 5 high conviction wallets
Top 3: [
  { wallet: '0xb744...', realizedPnlUsd: 9012.68, coveragePct: 35.56, rank: 1 },
  { wallet: '0xc7f7...', realizedPnlUsd: 4657.81, coveragePct: 6.77, rank: 2 },
  { wallet: '0x3a03...', realizedPnlUsd: 3693.99, coveragePct: 19.23, rank: 3 }
]
```

### Test 2: Market Subscription Stubs

```bash
npx tsx -e "
import { subscribeToMarket } from './lib/strategy/market-subscription.js';
const unsub = subscribeToMarket('0x123', 'market-456', {
  onMomentumSpike: (e) => console.log('Momentum!', e),
  onPriceMove: (e) => console.log('Price!', e)
});
console.log('Subscribed');
unsub();
"
```

**Expected Output:**
```
[SUBSCRIPTION STUB] Subscribing to market 0x123 (market-456)
  ✓ onMomentumSpike callback registered
  ✓ onPriceMove callback registered
Subscribed
[SUBSCRIPTION STUB] Unsubscribing from market 0x123
```

### Test 3: Escalation Logic

```bash
npx tsx -e "
import { evaluateEscalation } from './lib/strategy/escalation.js';
const result = evaluateEscalation('strat-1', 'cond-1', 'market-1', {
  recentWallets: ['0xb744f56635b537e859152d14b022af5afe485210'], // High conviction
  preferredSide: 'NO'
});
console.log('Result:', result.level, '-', result.reason);
"
```

**Expected Output:**
```
[MOMENTUM STUB] Checking momentum for cond-1 (side: NO, threshold: 5%)
Result: ALERT_ONLY - High conviction wallet detected (waiting for momentum)
```

---

## Order Placement Slot (NOT IMPLEMENTED)

**Where:** `lib/strategy/escalation.ts`

**Placeholders:**
```typescript
calculateOrderSize() // Returns 0 to block orders
placeStrategyOrder() // Returns error
```

**When ready to implement:**

1. **Size Calculation:**
   - Max % of bankroll (e.g. 5%)
   - Kelly criterion
   - Current exposure check
   - Liquidity check

2. **Order Placement:**
   - Create `strategy_trade_intents` table
   - Record intent BEFORE placing
   - Place LIMIT orders only (never market)
   - Wait for fill confirmation
   - Update intent status

3. **Risk Management:**
   - Balance check
   - Duplicate prevention
   - Timeout cancellation
   - Audit logging

---

## Status Reporting (ALREADY CORRECT)

**Finding:** Status API routes already update correctly!

**Routes:**
- `POST /api/strategies/[id]/start` → Sets `status='running'`
- `POST /api/strategies/[id]/pause` → Sets `status='paused'`
- `POST /api/strategies/[id]/stop` → Sets `status='stopped'`
- `GET /api/strategies/[id]/status` → Reads `status` field

**No executor changes needed.** The routes handle status updates.

**If strategies show wrong status:**
- Check frontend caching (useStrategyStatus hook uses 30s polling)
- Verify initial status when strategy is created
- Check if executor calls start/pause/stop routes

---

## Documentation

**Files Created:**
- `RUNTIME_CONTRACT.md` - Detailed technical contract
- `INTEGRATION_SUMMARY.md` - This file (implementation guide)

**Existing Docs Referenced:**
- `scripts/build-dimension-tables.ts` - For markets_dim/events_dim
- `hooks/use-strategy-watchlist.ts` - Frontend watchlist hook
- `hooks/use-strategy-status.ts` - Frontend status hook

---

## Compliance Checklist

**✅ All Rules Followed:**

1. **Read-only operations** - No production DB writes
2. **Audited P&L only** - Uses `audited_wallet_pnl.json` exclusively
3. **No legacy data** - Never touches `pnl_net`, `pnl_gross`
4. **Coverage contract** - 2% minimum enforced
5. **Stub transparency** - All stubs clearly marked
6. **No order placement** - Only placeholders with errors
7. **Status routes correct** - Already working, no changes needed

**❌ Not Implemented (By Design):**

- Real-time market feeds (stubs only)
- Order sizing logic (placeholder)
- Order placement (error placeholder)
- Production database writes (read-only)

---

## Next Steps for Executor Team

1. **Import integration layer** in executor startup
2. **Call initializeStrategyRuntime()** on strategy start
3. **Call addMarketToWatchlist()** when high conviction wallet trades
4. **Monitor logs** for escalation events
5. **Wait for order placement module** (future work)

**When Path B delivers `audited_wallet_pnl_extended.json`:**
- No code changes needed
- Integration layer automatically picks up new wallets
- Just drop in the new file and restart strategies

---

**Integration Complete. Ready for executor wiring.**
