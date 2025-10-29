# Test Momentum Strategy - Testing Guide

**Created:** 2025-10-26
**Strategy:** TEST: Momentum Watchlist Flow
**Status:** Ready for testing

---

## Overview

This test strategy verifies the complete WATCHLIST → SIGNAL → ACTION workflow with:
- ✅ Watchlist persistence and monitoring
- ✅ Event-driven signal triggers (not CRON polling)
- ✅ EXIT signals that loop back to monitor positions
- ✅ Momentum indicators (RMA/EMA)

---

## Strategy Workflow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. DATA_SOURCE (MARKETS)                                    │
│    Find: YES 10-40%, volume > 5K, liquidity > 1K           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. ENHANCED_FILTER                                          │
│    Filter by price, volume, liquidity criteria             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. ADD_TO_WATCHLIST ← TEST POINT 1                          │
│    • Should add markets to database                         │
│    • Should start continuous monitoring                     │
│    • Should persist after restart                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. SIGNAL (ENTRY) ← TEST POINT 2                            │
│    • Should trigger automatically when momentum > 0         │
│    • Should NOT wait for next CRON run                      │
│    • Should use momentum indicator (RMA/EMA)                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. ACTION (ENTER TRADE)                                     │
│    • Place limit order on NO side                           │
│    • Track position opened                                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. SIGNAL (EXIT) ← TEST POINT 3                             │
│    • Should loop back to monitor same position              │
│    • Should trigger when momentum levels out                │
│    • Should know which position it opened                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. ACTION (EXIT TRADE)                                      │
│    • Close the position                                     │
│    • Remove from watchlist                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## How to Test

### Step 1: Activate the Strategy

1. Go to http://localhost:3000/strategy-builder
2. Find **"TEST: Momentum Watchlist Flow"** in the strategy list
3. Click **Activate** (toggle switch)
4. Verify it shows as "Active"

### Step 2: Trigger Execution

**Option A: Manual Trigger**
- Click "Run Strategy" button
- Watch execution log

**Option B: Wait for CRON**
- If execution_mode = SCHEDULED
- Wait for next cron run (check schedule_cron)

### Step 3: Monitor Watchlist

**Check Database:**
```sql
SELECT * FROM strategy_watchlists
WHERE strategy_id = '3d726317-756a-4938-b600-a96b69bcf9fc'
ORDER BY added_at DESC;
```

**Expected:**
- Markets should appear in table
- Status should be 'watching'
- Metadata should include market info

**Check UI:**
- Go to strategy dashboard
- Look for "Watchlist" section
- Should show markets being monitored

**Check File System:**
```bash
cat watchlist-3d726317-756a-4938-b600-a96b69bcf9fc.json
```

**Expected:**
- JSON file with watchlist entries
- Should persist after restart

---

## Test Points

### TEST 1: Watchlist Persistence ✅

**What to Check:**
1. Markets get added to database table
2. Watchlist UI shows the markets
3. JSON file created in project root
4. Markets persist after server restart

**How to Verify:**
```bash
# Check database
npm exec tsx -- -e "
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

async function check() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data } = await supabase
    .from('strategy_watchlists')
    .select('*')
    .eq('strategy_id', '3d726317-756a-4938-b600-a96b69bcf9fc');

  console.log('Watchlist entries:', data?.length || 0);
  data?.forEach(entry => {
    console.log('  -', entry.market_id, entry.status);
  });
}

check();
"
```

**Expected Output:**
```
Watchlist entries: 5
  - market_123 watching
  - market_456 watching
  ...
```

**Pass Criteria:**
- ✅ At least 1 market added
- ✅ Status = 'watching'
- ✅ JSON file exists
- ✅ UI shows markets

---

### TEST 2: Event-Driven Signals ⚠️

**What to Test:**
Does the SIGNAL node trigger automatically when condition is met, or does it wait for next CRON run?

**How to Test:**
1. Add a market to watchlist manually
2. Simulate momentum change (update price data)
3. Check if ENTRY signal triggers **immediately**
4. Or if it waits for next CRON run (bad)

**Monitor Execution Log:**
```bash
# Check for signal trigger events
tail -f logs/strategy-execution.log | grep "SIGNAL"
```

**Or check database:**
```sql
SELECT * FROM strategy_execution_logs
WHERE strategy_id = '3d726317-756a-4938-b600-a96b69bcf9fc'
AND node_type = 'SIGNAL'
ORDER BY executed_at DESC;
```

**Expected Behavior:**
- ⏱️ Signal triggers within seconds of condition being met
- ❌ NOT: Signal waits 5-15 minutes for next CRON run

**Pass Criteria:**
- ✅ Signal triggers < 10 seconds after condition met
- ✅ Log shows "SIGNAL triggered automatically"
- ✅ No CRON delay

**If It Fails:**
- Need to add event-driven monitoring
- Watchlist items need to subscribe to market updates
- Market updates should evaluate signals immediately

---

### TEST 3: Exit Signal Loops ⚠️

**What to Test:**
After ENTRY signal triggers and trade executes, does the EXIT signal:
1. Loop back to monitor the same market?
2. Know which position it opened?
3. Trigger when exit condition is met?

**How to Test:**
1. Wait for ENTRY signal to trigger
2. Verify trade executed
3. Check if EXIT signal is now monitoring
4. Simulate exit condition (momentum levels out)
5. Check if EXIT signal triggers

**Monitor Position Tracking:**
```bash
# Check if position is being tracked
npm exec tsx -- -e "
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

async function check() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data } = await supabase
    .from('strategy_positions')
    .select('*')
    .eq('strategy_id', '3d726317-756a-4938-b600-a96b69bcf9fc')
    .eq('status', 'open');

  console.log('Open positions:', data?.length || 0);
  data?.forEach(pos => {
    console.log('  -', pos.market_id, 'opened at', pos.entry_price);
  });
}

check();
"
```

**Expected:**
- After ENTRY: 1 open position
- After EXIT: 0 open positions

**Pass Criteria:**
- ✅ EXIT signal references the opened position
- ✅ EXIT signal monitors same market as entry
- ✅ EXIT signal triggers when condition met
- ✅ Position closed after exit

**If It Fails:**
- Need to link ENTRY and EXIT signals
- Need position tracking between signals
- Need graph edge from ACTION → SIGNAL (loop back)

---

### TEST 4: Momentum Indicators ⚠️

**What to Test:**
Can SIGNAL nodes actually use momentum indicators (RMA, EMA, TSI)?

**How to Test:**
1. Check SIGNAL node config supports:
   - `indicator: 'RMA'` or `'EMA'` or `'TSI'`
   - `period: 14`
   - `smoothing: 'RMA'`
   - `threshold: 0`
2. Check if executor calculates momentum
3. Check if it uses TSI calculator

**Inspect Node Executor:**
```bash
# Search for momentum calculation in executor
grep -n "momentum\|RMA\|EMA\|TSI" lib/workflow/node-executors.ts
```

**Expected:**
- Executor imports TSI calculator
- Executor calculates momentum from price data
- Executor compares against threshold

**Pass Criteria:**
- ✅ SIGNAL config accepts momentum parameters
- ✅ Executor calculates indicator values
- ✅ Uses TSI from `lib/metrics/tsi-calculator.ts`

**If It Fails:**
- Need to enhance SIGNAL node config schema
- Need to add momentum calculation to executor
- Need to integrate TSI calculator

---

## Debugging Tips

### No Markets in Watchlist

**Check:**
1. Is strategy active?
2. Did DATA_SOURCE return markets?
3. Did FILTER pass any through?

**Debug:**
```bash
# Check execution log
npm exec tsx -- -e "
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

async function debug() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data } = await supabase
    .from('strategy_execution_logs')
    .select('*')
    .eq('strategy_id', '3d726317-756a-4938-b600-a96b69bcf9fc')
    .order('executed_at', { ascending: false })
    .limit(10);

  data?.forEach(log => {
    console.log(log.node_type, log.status, log.output?.substring(0, 100));
  });
}

debug();
"
```

### Signals Not Triggering

**Check:**
1. Is watchlist monitoring active?
2. Are market subscriptions set up?
3. Is condition logic correct?

**Debug:**
```bash
# Check market subscriptions
ls -la | grep "watchlist-"
cat watchlist-3d726317-756a-4938-b600-a96b69bcf9fc.json | jq
```

### Exit Signal Not Looping

**Check:**
1. Is there an edge from ACTION → SIGNAL?
2. Does EXIT signal know which position to monitor?
3. Is position tracked in database?

**Debug:**
```sql
SELECT node_graph->'edges' FROM strategy_definitions
WHERE strategy_id = '3d726317-756a-4938-b600-a96b69bcf9fc';
```

Look for edge from `action_enter_trade` → `signal_exit`

---

## Expected Results

### ✅ SUCCESS Case

```
1. Strategy activated
2. Markets found: 12
3. Filtered candidates: 5
4. Added to watchlist: 5
5. Monitoring started
6. ENTRY signal triggered after 3 seconds (momentum crossed > 0)
7. Trade executed: NO side @ 0.35
8. Position tracked: market_123
9. EXIT signal monitoring: market_123
10. EXIT signal triggered after 45 seconds (momentum leveled)
11. Position closed
12. Watchlist updated: status = 'exited'
```

### ❌ FAILURE Cases

**Case 1: CRON Polling**
```
1. Markets added to watchlist
2. Waiting for next CRON run... (5 minutes)
3. SIGNAL checked on CRON trigger
4. Trade executed

❌ Problem: Not event-driven, waits for CRON
```

**Case 2: No Exit Loop**
```
1. ENTRY signal triggered
2. Trade executed
3. EXIT signal never evaluated
4. Position never closed

❌ Problem: EXIT signal not linked to position
```

**Case 3: No Momentum**
```
1. SIGNAL node executes
2. Error: "momentum indicator not found"

❌ Problem: SIGNAL doesn't support momentum config
```

---

## Next Steps Based on Results

### If TEST 1 Fails (Watchlist)
- Fix `executeWatchlistNode()` in node-executors.ts
- Ensure database writes work
- Add UI refresh after watchlist update

### If TEST 2 Fails (Event-Driven)
- Add market subscription system
- Make watchlist items trigger signal evaluation
- Remove CRON dependency for signals

### If TEST 3 Fails (Exit Loops)
- Add position tracking to context
- Link ENTRY and EXIT signals
- Ensure graph supports loops

### If TEST 4 Fails (Momentum)
- Enhance SIGNAL config schema
- Add momentum calculation to executor
- Integrate TSI calculator

---

## Summary

**Test Strategy Created:** ✅
- ID: `3d726317-756a-4938-b600-a96b69bcf9fc`
- Name: `TEST: Momentum Watchlist Flow`
- Nodes: 7 (complete entry/exit cycle)
- Loop: Yes (exit monitors after entry)

**Ready to Test:**
1. Activate in UI
2. Monitor watchlist
3. Check signal triggers
4. Verify exit loops

**Report findings and we'll fix what doesn't work!**
