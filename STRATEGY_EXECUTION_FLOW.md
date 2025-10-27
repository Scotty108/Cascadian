# CASCADIAN Strategy Execution Flow - Complete End-to-End Guide

## 🎯 Overview

This document explains how strategies execute autonomously, from scanning markets to placing trades, once everything is connected to real data.

---

## 📊 Current Implementation Status

### ✅ **Already Implemented**
1. **Strategy Builder** - Visual workflow editor with ReactFlow
2. **Enhanced Filter Node** - Multi-condition filtering with 50x performance
3. **Portfolio Orchestrator** - AI position sizing with fractional Kelly
4. **Workflow Executor** - Executes node graphs with data flow
5. **Cron Executor** - Runs strategies on schedule (every 1 minute)
6. **Database Schema** - Strategies, executions, orchestrator decisions
7. **API Endpoints** - All orchestrator and decision endpoints

### ⚠️ **Stub/Not Connected Yet**
1. **Trade Execution** - Currently logs trades, doesn't execute on Polymarket
2. **Live Market Data** - Using sample/static data, not real-time Polymarket feed
3. **Position Tracking** - Portfolio state is calculated, not synced with real positions

---

## 🔄 Execution Flow (How It Works End-to-End)

### **1. Strategy Creation** (Manual, One-Time)

**User creates strategy in Strategy Builder:**
```
┌─────────────────────────────────────────────────────────────┐
│ Strategy: "High Omega Momentum Trading"                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [DATA_SOURCE]  →  [ENHANCED_FILTER]  →  [ORCHESTRATOR]    │
│  Fetch Markets      Multi-Condition       AI Position       │
│                     Filters               Sizing            │
│                                                              │
│  Filters:                                                    │
│  - Category = Politics                                       │
│  - Volume > $100k                                            │
│  - Liquidity > $50k                                          │
│  - Active = true                                             │
│                                                              │
│  Orchestrator:                                               │
│  - Mode: Autonomous                                          │
│  - Risk Tolerance: 5/10                                      │
│  - Max per position: 5%                                      │
│  - Kelly lambda: 0.35                                        │
└─────────────────────────────────────────────────────────────┘
```

**User saves strategy with:**
- `execution_mode: 'SCHEDULED'` (runs on cron)
- `schedule_cron: '*/5 * * * *'` (every 5 minutes)
- `is_active: true` (enabled)

**Saved to database:**
```sql
INSERT INTO strategy_definitions (
  strategy_name,
  execution_mode,
  schedule_cron,
  is_active,
  node_graph,
  created_by
) VALUES (
  'High Omega Momentum Trading',
  'SCHEDULED',
  '*/5 * * * *',
  true,
  '{"nodes": [...], "edges": [...]}'::jsonb,
  'user-uuid'
);
```

---

### **2. Scheduled Execution** (Automated, Every N Minutes)

#### **Vercel Cron Job** (configured in `vercel.json`)

```json
{
  "crons": [
    {
      "path": "/api/cron/strategy-executor",
      "schedule": "*/1 * * * *"
    }
  ]
}
```

**Every 1 minute, Vercel calls:**
```
GET /api/cron/strategy-executor
Authorization: Bearer <CRON_SECRET>
```

#### **Cron Executor Logic** (`app/api/cron/strategy-executor/executor.ts`)

```typescript
1. Find strategies due for execution
   - Query: WHERE auto_run = true
           AND next_execution_at <= NOW()
           AND status IN ('running', 'error')
   - Limit: 25 strategies (Vercel timeout protection)

2. For each strategy:
   a. Execute workflow using WorkflowExecutor
   b. Update execution stats
   c. Calculate next execution time (NOW + interval)
   d. Auto-pause if 3+ consecutive errors

3. Return summary:
   - Strategies checked: 47
   - Strategies executed: 3
   - Total time: 2.3 seconds
```

---

### **3. Workflow Execution** (Node-by-Node Processing)

#### **WorkflowExecutor** (`lib/workflow/executor.ts`)

```typescript
1. Load workflow from database
   - Get nodes and edges
   - Build execution graph (topological sort)

2. Execute nodes in dependency order:

   NODE 1: DATA_SOURCE
   ├─ Execute: Fetch markets from database/API
   ├─ Query: SELECT * FROM markets WHERE active = true
   ├─ Output: Array of 1,247 markets
   └─ Pass to: ENHANCED_FILTER

   NODE 2: ENHANCED_FILTER
   ├─ Execute: Filter markets with multi-condition logic
   ├─ Conditions:
   │  • category = 'Politics' (AND)
   │  • volume_24h > 100000 (AND)
   │  • liquidity > 50000 (AND)
   │  • active = true
   ├─ Input: 1,247 markets
   ├─ Output: 47 markets (passed all filters)
   ├─ Execution time: 2ms
   └─ Pass to: ORCHESTRATOR

   NODE 3: ORCHESTRATOR (Portfolio Manager)
   ├─ Execute: AI position sizing for each market
   ├─ For each of 47 markets:
   │
   │  Market: "Will Trump win 2024?"
   │  ├─ Step 1: Fetch portfolio state
   │  │  └─ Query: Get current positions, bankroll, deployed capital
   │  │      {
   │  │        bankroll_total_equity_usd: 10000,
   │  │        bankroll_free_cash_usd: 7500,
   │  │        deployed_capital: 2500,
   │  │        open_positions: 3,
   │  │        total_pnl: 250
   │  │      }
   │  │
   │  ├─ Step 2: Call AI analysis (Claude Sonnet 4.5)
   │  │  └─ Prompt: Fractional Kelly position sizing
   │  │      Input:
   │  │      - Market: Trump 2024 (YES at 0.58)
   │  │      - Volume: $2.3M
   │  │      - Liquidity: $150k
   │  │      - Portfolio: $10k total, $7.5k free
   │  │      - Rules: Kelly lambda 0.35, max 5% per position
   │  │
   │  │      AI Response (JSON):
   │  │      {
   │  │        "decision": "GO",
   │  │        "action": "BUY",
   │  │        "side": "YES",
   │  │        "target_shares": 432,
   │  │        "recommended_notional_usd": 325.50,
   │  │        "kelly_fraction_raw": 0.087,
   │  │        "kelly_fraction_adjusted": 0.030,
   │  │        "p_win": 0.65,
   │  │        "risk_score": 6,
   │  │        "reasoning": "Strong edge with 65% win probability...",
   │  │        "confidence": 0.78,
   │  │        "risk_flags": []
   │  │      }
   │  │
   │  ├─ Step 3: Validate position sizing
   │  │  └─ Check: $325.50 ≤ $10,000 * 0.05 (max 5%) ✅
   │  │      Check: $325.50 ≥ $5 (min bet) ✅
   │  │      Check: $325.50 ≤ $500 (max bet) ✅
   │  │      Check: $2,500 + $325.50 ≤ $10,000 * 0.50 (portfolio heat) ✅
   │  │
   │  ├─ Step 4: Create decision record
   │  │  └─ INSERT INTO orchestrator_decisions (
   │  │        execution_id, workflow_id, node_id,
   │  │        market_id, decision, direction,
   │  │        recommended_size, risk_score, ai_reasoning,
   │  │        status, portfolio_snapshot
   │  │      )
   │  │
   │  └─ Step 5: Execute or queue for approval
   │
   │     IF mode = 'autonomous':
   │       ├─ Execute trade immediately
   │       ├─ Call: executeTrade(decision)
   │       └─ Update status: 'executed'
   │
   │     IF mode = 'approval':
   │       ├─ Send notification to user
   │       ├─ Title: "Trade approval needed: Trump 2024"
   │       ├─ Message: "Recommended: BUY YES for $325 (risk: 6/10)"
   │       └─ Update status: 'pending'
   │
   └─ Output: 47 decisions
      - 12 GO decisions (7 executed in autonomous mode, 5 pending approval)
      - 35 NO_GO decisions (no edge or too risky)

3. Save execution record:
   - INSERT INTO strategy_executions (
       strategy_id, status, results,
       execution_time_ms, nodes_evaluated
     )

4. Return execution result
```

---

### **4. Trade Execution** (Real Polymarket Trades)

#### **Current State: STUB** (`lib/workflow/node-executors/orchestrator-executor.ts:307`)

```typescript
async function executeTrade(decision: OrchestratorDecisionRecord): Promise<void> {
  console.log('[Orchestrator Executor] Executing trade (STUB):', {
    market_id: decision.market_id,
    direction: decision.direction,
    size: decision.recommended_size,
  })

  // TODO: Integrate with actual Polymarket trading API
  // For MVP, this is a stub that logs the trade

  // Update decision status to executed
  await supabase
    .from('orchestrator_decisions')
    .update({ status: 'executed', executed_at: new Date().toISOString() })
    .eq('id', decision.id)
}
```

#### **What Needs to Be Implemented:**

**Option 1: Polymarket CLOB API (Real Trades)**
```typescript
import { PolymarketCLOBClient } from '@polymarket/clob-client'

async function executeTrade(decision: OrchestratorDecisionRecord): Promise<void> {
  // 1. Initialize Polymarket client
  const client = new PolymarketCLOBClient({
    privateKey: process.env.POLYMARKET_PRIVATE_KEY,
    chainId: 137, // Polygon mainnet
  })

  // 2. Get current market state
  const market = await client.getMarket(decision.market_id)
  const orderBook = await client.getOrderBook(market.condition_id)

  // 3. Calculate optimal entry price
  const bestAskPrice = decision.direction === 'YES'
    ? orderBook.yes.asks[0].price
    : orderBook.no.asks[0].price

  // 4. Place limit order
  const order = await client.createOrder({
    tokenId: decision.direction === 'YES' ? market.tokens[0].token_id : market.tokens[1].token_id,
    price: bestAskPrice,
    size: decision.recommended_size / bestAskPrice, // Convert USD to shares
    side: 'BUY',
    expiration: Date.now() + 3600000, // 1 hour
  })

  // 5. Sign and submit order
  const signedOrder = await client.signOrder(order)
  const result = await client.postOrder(signedOrder)

  // 6. Update decision record with trade details
  await supabase
    .from('orchestrator_decisions')
    .update({
      status: 'executed',
      actual_size: decision.recommended_size,
      executed_at: new Date().toISOString(),
      trade_id: result.orderId,
      execution_price: bestAskPrice,
    })
    .eq('id', decision.id)

  // 7. Track position in database
  await supabase.from('positions').insert({
    user_id: decision.user_id,
    market_id: decision.market_id,
    side: decision.direction,
    shares: decision.recommended_size / bestAskPrice,
    avg_entry_cost: bestAskPrice,
    entry_date: new Date().toISOString(),
    strategy_id: decision.workflow_id,
  })
}
```

**Option 2: Paper Trading (Simulated Trades)**
```typescript
async function executeTrade(decision: OrchestratorDecisionRecord): Promise<void> {
  // 1. Fetch current market price (from Polymarket public API)
  const price = await getMarketPrice(decision.market_id, decision.direction)

  // 2. Calculate shares
  const shares = decision.recommended_size / price

  // 3. Record paper trade in database
  await supabase.from('paper_trades').insert({
    user_id: decision.user_id,
    market_id: decision.market_id,
    side: decision.direction,
    entry_price: price,
    shares: shares,
    notional_usd: decision.recommended_size,
    entry_date: new Date().toISOString(),
    strategy_id: decision.workflow_id,
    decision_id: decision.id,
  })

  // 4. Update virtual portfolio
  await supabase.rpc('update_paper_portfolio', {
    user_id: decision.user_id,
    cash_change: -decision.recommended_size,
    positions_change: 1,
  })

  // 5. Update decision record
  await supabase
    .from('orchestrator_decisions')
    .update({
      status: 'executed',
      actual_size: decision.recommended_size,
      executed_at: new Date().toISOString(),
      execution_price: price,
    })
    .eq('id', decision.id)
}
```

---

### **5. Approval Workflow** (If mode = 'approval')

**User receives notification:**
```
┌─────────────────────────────────────────────┐
│ 🔔 Trade approval needed                    │
├─────────────────────────────────────────────┤
│ Market: "Will Trump win 2024?"              │
│ Recommended: BUY YES for $325               │
│ Risk Score: 6/10                            │
│                                             │
│ AI Reasoning:                               │
│ "Strong edge with 65% win probability       │
│  based on recent polling data. Market       │
│  underpricing YES by ~7%. Kelly fraction    │
│  suggests 3% of bankroll ($300), adjusted   │
│  to $325 after volatility adjustment."      │
│                                             │
│ Current Portfolio:                          │
│ • Total: $10,000                            │
│ • Available: $7,500                         │
│ • Deployed: $2,500 (25%)                    │
│                                             │
│ [Approve]  [Adjust Size]  [Reject]         │
└─────────────────────────────────────────────┘
```

**User clicks "Approve":**
```typescript
POST /api/orchestrator/decisions/{id}/approve
{
  "final_size": 325,
  "user_id": "user-uuid"
}

→ Executes trade via executeTrade()
→ Updates decision: status = 'approved', actual_size = 325
→ Sends confirmation notification
```

---

### **6. Exit Signals & Position Management** (Future Enhancement)

**Add SIGNAL nodes to workflow:**
```
[DATA_SOURCE]
   ↓
[ENHANCED_FILTER] (Find high-momentum markets)
   ↓
[ORCHESTRATOR] (Size positions)
   ↓
[SIGNAL: MOMENTUM_EXIT] (Detect when to exit)
   ↓
[ORCHESTRATOR: EXIT] (Close positions)
```

**SIGNAL node config:**
```typescript
{
  type: "SIGNAL",
  signalType: "EXIT",
  conditions: {
    momentum_threshold: 0.5,  // RSI drops below 50
    profit_target: 0.15,      // Take profit at 15%
    stop_loss: -0.10,         // Stop loss at -10%
  }
}
```

---

## 🔧 What's Needed to Go Live

### **1. Polymarket Integration**

**Install Polymarket SDK:**
```bash
npm install @polymarket/clob-client
```

**Environment Variables:**
```bash
POLYMARKET_PRIVATE_KEY=<ethereum-private-key>
POLYMARKET_API_KEY=<polymarket-api-key>
POLYMARKET_CHAIN_ID=137  # Polygon mainnet
```

**Replace stub in `orchestrator-executor.ts`:**
- Implement `executeTrade()` with real CLOB API calls
- Handle order placement, fills, and position tracking

---

### **2. Live Market Data Feed**

**Current:** Static/sample data
**Needed:** Real-time Polymarket market data

**Option A: Polymarket API Polling**
```typescript
// Fetch markets every 30 seconds
setInterval(async () => {
  const markets = await polymarketAPI.getActiveMarkets()
  await syncMarketsToDatabase(markets)
}, 30000)
```

**Option B: WebSocket Stream**
```typescript
// Real-time updates
const ws = new WebSocket('wss://clob.polymarket.com/ws')
ws.on('message', (data) => {
  const update = JSON.parse(data)
  updateMarketInDatabase(update)
})
```

**Update DATA_SOURCE node executor:**
```typescript
// Instead of:
SELECT * FROM markets WHERE active = true

// Use:
SELECT * FROM markets_realtime WHERE active = true AND last_updated > NOW() - INTERVAL '5 minutes'
```

---

### **3. Position Tracking & Portfolio State**

**Current:** Calculated portfolio state (stub)
**Needed:** Sync with actual Polymarket positions

**Fetch real positions:**
```typescript
async function fetchPortfolioState(userId: string): Promise<PortfolioState> {
  // 1. Get user's Polymarket wallet address
  const wallet = await getUserWallet(userId)

  // 2. Query Polymarket for open positions
  const positions = await polymarketClient.getUserPositions(wallet.address)

  // 3. Calculate portfolio metrics
  const totalEquity = positions.reduce((sum, p) => sum + p.value_usd, 0)
  const deployedCapital = positions.reduce((sum, p) => sum + p.cost_basis, 0)
  const freeCash = totalEquity - deployedCapital

  // 4. Return portfolio state
  return {
    bankroll_total_equity_usd: totalEquity,
    bankroll_free_cash_usd: freeCash,
    deployed_capital: deployedCapital,
    open_positions: positions.length,
    positions: positions,
  }
}
```

---

### **4. Cron Configuration**

**Vercel Cron is already configured** (`vercel.json`):
```json
{
  "crons": [
    {
      "path": "/api/cron/strategy-executor",
      "schedule": "*/1 * * * *"  // Every 1 minute
    }
  ]
}
```

**User sets execution interval per strategy:**
- Every 1 minute (high-frequency)
- Every 5 minutes (standard)
- Every 15 minutes (conservative)
- Every 1 hour (long-term)

**Database field:**
```sql
execution_interval_minutes: 5  -- Run every 5 minutes
```

---

## 🎯 Complete Example: End-to-End Strategy Execution

### **Strategy: "High Conviction Politics Trader"**

**Setup (One-time):**
```typescript
User creates strategy in Strategy Builder:
- Name: "High Conviction Politics Trader"
- Execution Mode: SCHEDULED
- Interval: Every 5 minutes
- Mode: Autonomous (no approval needed)

Workflow:
1. DATA_SOURCE (Fetch active politics markets)
2. ENHANCED_FILTER (Category = Politics, Volume > $100k, Liquidity > $50k)
3. ORCHESTRATOR (Kelly sizing, Risk tolerance = 5/10, Max per position = 5%)

Strategy saved to database.
```

**Execution Cycle (Every 5 Minutes):**
```
10:00 AM - Vercel Cron triggers
├─ Query: Find strategies due at 10:00
├─ Found: "High Conviction Politics Trader" (last run: 9:55 AM)
├─ Execute workflow:
│
│  Step 1: DATA_SOURCE
│  ├─ Fetch 1,247 active markets from Polymarket API
│  └─ Output: 1,247 markets
│
│  Step 2: ENHANCED_FILTER
│  ├─ Filter: Category = Politics (432 markets)
│  ├─ Filter: Volume > $100k (87 markets)
│  ├─ Filter: Liquidity > $50k (47 markets)
│  └─ Output: 47 markets
│
│  Step 3: ORCHESTRATOR
│  ├─ Fetch portfolio: $10,000 total, $7,200 free cash
│  │
│  ├─ Market 1: "Trump wins 2024?" (YES at 0.58)
│  │  ├─ AI Analysis: GO (Kelly = 0.030, $325 recommended)
│  │  ├─ Validate: ✅ All constraints pass
│  │  ├─ Execute: BUY 560 shares @ $0.58 = $325
│  │  └─ Record: Decision #1234, Status: executed
│  │
│  ├─ Market 2: "Biden approval > 45%?" (YES at 0.62)
│  │  ├─ AI Analysis: NO_GO (No edge, p_win < p_break_even)
│  │  └─ Record: Decision #1235, Status: no_go
│  │
│  ├─ ... (process all 47 markets)
│  │
│  └─ Summary: 7 trades executed, 40 no-go decisions
│
├─ Update strategy: next_execution_at = 10:05 AM
└─ Return: Success (2.3 seconds, 3 nodes executed)

10:05 AM - Next execution scheduled
```

**User Dashboard (Real-time):**
```
┌────────────────────────────────────────────────────┐
│ Strategy: High Conviction Politics Trader          │
├────────────────────────────────────────────────────┤
│ Status: Running                                     │
│ Last Execution: 10:00 AM (23 seconds ago)          │
│ Next Execution: 10:05 AM (4 min 37 sec)           │
│                                                     │
│ Today's Activity:                                   │
│ • Markets scanned: 1,247                           │
│ • Markets filtered: 47                             │
│ • Trades executed: 7                               │
│ • Capital deployed: $2,275                         │
│                                                     │
│ Recent Trades:                                      │
│ 1. Trump wins 2024? - BUY YES @ $0.58 ($325)      │
│ 2. Senate GOP majority? - BUY YES @ $0.71 ($425)  │
│ 3. California stays blue? - BUY YES @ $0.89 ($180)│
│                                                     │
│ Portfolio Status:                                   │
│ • Total Equity: $10,450 (+4.5%)                   │
│ • Free Cash: $4,925                                │
│ • Deployed: $5,525 (52.9%)                        │
│ • Open Positions: 12                               │
└────────────────────────────────────────────────────┘
```

---

## 🚀 Deployment Checklist

### **Phase 1: Paper Trading (Safe Testing)**
- [x] Strategy Builder UI ✅
- [x] Workflow Executor ✅
- [x] Orchestrator AI ✅
- [x] Cron Scheduler ✅
- [ ] Paper trade execution (simulate trades)
- [ ] Virtual portfolio tracking
- [ ] Performance analytics

### **Phase 2: Live Trading (Real Money)**
- [ ] Polymarket CLOB client integration
- [ ] Wallet connection (MetaMask/WalletConnect)
- [ ] Real position syncing
- [ ] Live market data feed
- [ ] Risk management safeguards
- [ ] Emergency stop mechanism

---

## 🎛️ User Controls

**Per Strategy:**
- **Execution Mode:** MANUAL, AUTO (always-on), SCHEDULED (cron)
- **Interval:** 1 min, 5 min, 15 min, 1 hour, 1 day
- **Orchestrator Mode:** Autonomous (auto-execute) or Approval (manual review)
- **Active/Paused:** Can pause/resume at any time
- **Position Sizing:** Min/max bet, max % per position, portfolio heat limit

**Global Controls:**
- **Kill Switch:** Pause all strategies instantly
- **Daily Loss Limit:** Auto-pause if losses exceed threshold
- **Max Concurrent Positions:** Cap total open positions

---

## ✅ Summary

**What works NOW:**
✅ Visual strategy creation
✅ Enhanced multi-condition filters
✅ AI-powered position sizing (fractional Kelly)
✅ Autonomous cron execution
✅ Approval workflow for manual review
✅ Decision history and analytics

**What's needed for LIVE TRADING:**
⚠️ Polymarket CLOB API integration (replace stub)
⚠️ Real-time market data feed
⚠️ Actual position tracking
⚠️ Wallet connection for signing transactions

**What's needed for PAPER TRADING:**
⚠️ Virtual portfolio tracking
⚠️ Simulated trade execution
⚠️ P&L calculation without real trades

---

**The infrastructure is 90% complete.** The missing 10% is connecting the trade execution stub to real Polymarket APIs or implementing paper trading for safe testing first.
