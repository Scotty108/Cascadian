# Watchlist & Signal Node Status

**Date:** 2025-10-26
**Status:** Nodes exist but need testing and possible enhancements for momentum trading

---

## ✅ What EXISTS

### 1. WATCHLIST System

**Components:**
- ✅ `lib/strategy/watchlist-store.ts` - In-memory watchlist storage
- ✅ `app/api/strategies/[id]/watchlist/route.ts` - API endpoints
- ✅ `supabase/migrations/20251026000001_create_strategy_watchlists.sql` - Database schema
- ✅ `components/strategy-dashboard/watchlist-display.tsx` - UI component
- ✅ `hooks/use-strategy-watchlist.ts` - React hook

**Node Type:**
```typescript
{
  type: "add-to-watchlist",
  label: "Add to Watchlist",
  icon: Bookmark,
  category: "Actions"
}
```

**Executor:**
```typescript
async function executeWatchlistNode(config, inputs, context) {
  // Adds markets to watchlist
  // Stores in database: strategy_watchlists table
  // Subscribes to market updates
  // Evaluates escalation criteria
}
```

**Watchlist Entry Structure:**
```typescript
{
  condition_id: string
  market_id: string
  event_id: string
  category: string
  question: string
  side: 'YES' | 'NO'
  reason: string  // e.g. "smart-flow", "momentum"
  strategyId: string
  status: 'watching' | 'escalate_candidate' | 'entered_position' | 'exited'
  triggeredByWallet?: string
  timeToResolution?: number
}
```

### 2. SIGNAL Nodes

**Node Type:**
```typescript
{
  type: "SIGNAL",
  label: "Signal",
  category: "Signals",
  config: {
    signalType: 'ENTRY' | 'EXIT' | 'HOLD'
    condition: string  // Logic node ID
    direction?: 'YES' | 'NO'
    strength?: 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG'
    positionSize?: {
      method: 'FIXED' | 'KELLY' | 'OMEGA_WEIGHTED'
      baseAmount?: number
    }
  }
}
```

**Status:** ⚠️ Type exists but executor may be stub/incomplete

### 3. Database Tables

**strategy_watchlists:**
```sql
CREATE TABLE strategy_watchlists (
  id uuid PRIMARY KEY,
  strategy_id uuid REFERENCES strategy_definitions(strategy_id),
  market_id text NOT NULL,
  condition_id text,
  side text CHECK (side IN ('YES', 'NO')),
  reason text,
  status text DEFAULT 'watching',
  added_at timestamptz DEFAULT now(),
  metadata jsonb
);
```

---

## ⚠️ What Might Be MISSING/INCOMPLETE

### 1. Momentum Signal Detection

**Your Requirement:**
- Wait for momentum to "tick up" before trading
- Wait for momentum to "level out" before exiting
- Use RMA/EMA smoothing to avoid whipsaw

**Current SIGNAL Node:**
- Has types: ENTRY/EXIT/HOLD
- Has strength levels
- ❓ **Unknown:** Does it support momentum indicators (RMA, EMA, TSI)?
- ❓ **Unknown:** Can it trigger on crossovers?
- ❓ **Unknown:** Does it continuously monitor or just evaluate once?

**What You Need:**
```typescript
{
  type: 'SIGNAL',
  config: {
    signalType: 'ENTRY',
    indicator: 'MOMENTUM_RMA',  // ← Missing?
    params: {
      period: 14,
      smoothing: 'RMA',
      threshold: 0  // Positive momentum
    },
    trigger: 'CROSSOVER_ABOVE'  // ← Missing?
  }
}
```

### 2. Event-Driven Execution

**Current:** CRON-based batch execution (every N minutes)

**Your Requirement:**
- Add to watchlist
- **Monitor continuously** for signals
- Execute when signal triggers (not on next CRON run)

**Questions:**
- Does watchlist monitoring happen continuously?
- Do SIGNAL nodes trigger events?
- Or do strategies just check signals on each CRON run?

### 3. Momentum Indicators

**TSI Calculator Exists:**
- ✅ `lib/metrics/tsi-calculator.example.ts` - True Strength Index
- ✅ `components/tsi-signal-card.tsx` - UI component

**Question:** Can SIGNAL nodes use TSI? Or just basic conditions?

---

## 🧪 What Needs TESTING

### Test 1: Basic Watchlist Flow
```
MARKETS → FILTER → ADD_TO_WATCHLIST
```

**Questions:**
1. Do markets get added to database?
2. Can we see them in UI?
3. Do they persist after restart?

### Test 2: Watchlist → Signal → Action
```
MARKETS → ADD_TO_WATCHLIST → SIGNAL(ENTRY) → ACTION(TRADE)
```

**Questions:**
1. Does SIGNAL node trigger when condition is met?
2. Is it event-driven or CRON-polled?
3. Can signals access market data from watchlist?

### Test 3: Momentum Indicators
```
WATCHLIST → SIGNAL(momentum RMA > 0) → ACTION
```

**Questions:**
1. Can SIGNAL nodes calculate momentum?
2. Can they use TSI/RMA/EMA?
3. Do they smooth data to avoid whipsaw?

### Test 4: Entry + Exit Signals
```
SIGNAL(ENTRY: momentum up) → ACTION(BUY)
    ↓
SIGNAL(EXIT: momentum levels) → ACTION(SELL)
```

**Questions:**
1. Can a strategy have multiple SIGNAL nodes?
2. Do they track which positions they opened?
3. Can EXIT signals reference ENTRY signals?

---

## 🎯 Your Desired Workflow

### Scotty's Strategy (Market-Based with Momentum)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. DATA_SOURCE (MARKETS)                                    │
│    • Last 12 hours only                                     │
│    • YES odds 10-40%                                        │
│    • Liquid markets                                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. ENHANCED_FILTER                                          │
│    • Profit > fees + spread                                 │
│    • Volume/liquidity thresholds                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. ADD_TO_WATCHLIST ← Does this work?                       │
│    • Store markets for monitoring                           │
│    • Subscribe to price updates                             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. SIGNAL (ENTRY) ← Does this support momentum?             │
│    • Wait for momentum RMA > 0                              │
│    • Smooth with 14-period RMA                              │
│    • Trigger on crossover                                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. ORCHESTRATOR                                             │
│    • Calculate position size                                │
│    • Default to NO side                                     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. ACTION (ENTER)                                           │
│    • Place limit order                                      │
│    • Track position                                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. SIGNAL (EXIT) ← Loop back to monitor                     │
│    • Wait for momentum to level out                         │
│    • RMA crosses below threshold                            │
│    • Or TSI slow < fast                                     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 8. ACTION (EXIT)                                            │
│    • Close position                                         │
│    • Remove from watchlist                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Action Items to Verify

### Immediate Tests:

1. **Build a simple watchlist strategy:**
   ```
   MARKETS → FILTER → ADD_TO_WATCHLIST
   ```
   - Activate it
   - Check if markets appear in watchlist UI
   - Verify database entries

2. **Test SIGNAL node:**
   ```
   MARKETS → SIGNAL(basic condition) → ACTION
   ```
   - Does it execute?
   - What config options work?
   - Can it access market data?

3. **Check momentum indicators:**
   - Can TSI calculator be used in SIGNAL nodes?
   - Is there RMA/EMA calculation?
   - How to configure smoothing?

### Required for Full Momentum Trading:

1. **Momentum Indicator Support:**
   - Add RMA/EMA/TSI to SIGNAL node config
   - Support period/smoothing parameters
   - Implement crossover triggers

2. **Continuous Monitoring:**
   - Watchlist items trigger evaluation
   - Don't wait for next CRON run
   - Event-driven signal checking

3. **Position Tracking:**
   - Link ENTRY and EXIT signals
   - Track which signal opened which position
   - Only exit positions we opened

4. **Exit Signal Loop:**
   - After ENTRY → ACTION, loop back to monitor
   - EXIT signal watches same market
   - Closes position when triggered

---

## 🔍 Recommended Investigation

### Step 1: Read Executor Code
Check `lib/workflow/node-executors.ts` for:
- How ADD_TO_WATCHLIST actually works
- If SIGNAL nodes are implemented
- What config options they support

### Step 2: Check Monitoring System
Look at:
- How watchlist items are monitored
- If there's continuous evaluation
- Or just CRON polling

### Step 3: Test Momentum Indicators
- Try using TSI in a SIGNAL node
- See if it works or errors
- Check what data it has access to

### Step 4: Build Test Strategy
Create simplest possible momentum strategy:
```
MARKETS → ADD_TO_WATCHLIST → SIGNAL(price > X) → ACTION(LOG)
```

See what works and what doesn't.

---

## Summary

**Good News:**
- ✅ Watchlist system exists with database, API, UI
- ✅ SIGNAL node type exists in type system
- ✅ ADD_TO_WATCHLIST node exists and is executed
- ✅ TSI momentum calculator exists

**Uncertainties:**
- ❓ Can SIGNAL nodes use momentum indicators?
- ❓ Is execution event-driven or CRON-polled?
- ❓ Can EXIT signals loop back and monitor?
- ❓ Do signals work with watchlist items?

**Recommendation:**
Test the existing nodes to see what works, then we can fill in any gaps needed for your full momentum trading workflow.

---

**Next Step:** Build a test strategy using existing WATCHLIST and SIGNAL nodes to see what works?
