# Requirements: Autonomous Strategy Execution System

**Feature**: 24/7 Autonomous Strategy Execution & Monitoring
**Date**: 2025-10-26
**Status**: Planning

---

## Executive Summary

Transform CASCADIAN's Strategy Builder from an on-demand workflow execution tool into a fully autonomous 24/7 trading system. Strategies should continuously monitor markets, execute trades, and provide real-time visibility into their activities through dedicated dashboards and notifications.

---

## User Story

**As a** CASCADIAN user
**I want to** run my trading strategies 24/7 autonomously
**So that** I don't miss opportunities and can systematically execute my probability-stacking approach without manual intervention

---

## Core Requirements

### 1. 24/7 Strategy Execution Engine

**Description**: Enable strategies to run continuously in the background

**Requirements**:
- When user clicks "Run" on a strategy, it should start running 24/7 (not just execute once)
- Strategies should loop continuously, re-executing their workflow at defined intervals
- Each strategy needs configurable execution frequency (e.g., check markets every 5 minutes, 15 minutes, 1 hour)
- Strategies should restart automatically if they crash or encounter errors
- Users should be able to "pause" and "resume" strategies at any time
- Users should be able to "stop" strategies permanently
- System should handle multiple strategies running concurrently per user
- Execution should continue even if user closes browser (server-side execution)

**Technical Notes**:
- Current implementation: Workflow executor runs once when user clicks "Run"
- Needed: Background job system (cron-like scheduler or queue-based system)
- Consider: Vercel cron limitations (max 10-second execution time) - may need external job queue

---

### 2. Strategy Dashboard (Individual Strategy View)

**Description**: Dedicated dashboard for each strategy showing real-time activity

**Requirements**:
- Each strategy needs its own detail page (`/strategies/[id]`)
- Dashboard should show:
  - **Current Status**: Running, Paused, Stopped, Error
  - **Uptime**: How long strategy has been running
  - **Last Execution**: Timestamp of last workflow run
  - **Next Execution**: Countdown to next run
  - **Execution Log**: Real-time feed of strategy actions (last 50 executions)
  - **Performance Metrics**:
    - Total executions
    - Successful executions
    - Failed executions
    - Current watchlist size
    - Active trades count
    - Win rate (if trades have closed)
    - ROI (if trades have closed)
  - **Active Watchlist**: Markets currently being monitored
  - **Active Trades**: Positions currently held
  - **Recent Activity**: Timeline of actions (added to watchlist, executed trade, etc.)

**UI Requirements**:
- Real-time updates (polling or WebSocket)
- Ability to pause/resume/stop from dashboard
- Ability to edit strategy configuration
- Ability to manually trigger execution
- Visual indicators for status (green = running, yellow = paused, red = stopped/error)

---

### 3. Global Strategies Overview Dashboard

**Description**: View all running strategies at a glance

**Requirements**:
- Dashboard showing grid of all user's strategies
- Each strategy card should show:
  - Strategy name
  - Current status (badge)
  - Uptime
  - Active trades count
  - Watchlist size
  - Last activity timestamp
  - Quick actions: Pause, Stop, View Details
- Filter by status: All, Running, Paused, Stopped
- Sort by: Most active, Newest, Oldest, Performance

---

### 4. Watchlist System

**Description**: Strategies can add markets to a watchlist before executing trades

**Requirements**:
- New workflow node type: "Add to Watchlist"
- Watchlist persists per strategy (database table: `strategy_watchlists`)
- Each watchlist entry should store:
  - Market ID
  - Added timestamp
  - Reason (optional - from workflow output)
  - Metadata (price at time of add, volume, etc.)
- Watchlist should be visible in strategy dashboard
- User can manually remove markets from watchlist
- Strategies can check if market is already in watchlist (avoid duplicates)

**Workflow Integration**:
```
Stream Markets → Filter (volume > 100k) → Add to Watchlist → End
```

---

### 5. Watchlist-to-Trade Conversion (Conditional Trading)

**Description**: Strategies can monitor watchlist and execute trades when conditions are met

**Requirements**:
- New workflow node type: "Monitor Watchlist"
  - Inputs: Watchlist from current strategy
  - Outputs: Markets that meet specified conditions
- New workflow node type: "Execute Trade"
  - Inputs: Market data, outcome (Yes/No), amount, order type
  - Outputs: Trade confirmation
- Conditions can include:
  - **Momentum**: Price velocity (e.g., price increased by 5% in last hour)
  - **Volume**: Trading volume threshold
  - **Whale Activity**: Whale positions changed
  - **Time-based**: Market has been on watchlist for X minutes
  - **Custom formula**: User-defined mathjs expression

**Example Workflow**:
```
Start
 ↓
Monitor Watchlist
 ↓
Filter (momentum > 0.05)  ← Only markets with 5%+ momentum
 ↓
Condition (if volume > 500k AND momentum > 0.05)
 ↓ TRUE
Execute Trade (outcome: Yes, amount: $100, type: market)
 ↓
Remove from Watchlist
 ↓
End
```

**Database Requirements**:
- `strategy_trades` table to track executed trades
- Link trades back to strategy_id and market_id
- Store entry price, timestamp, amount, outcome

---

### 6. Notification System

**Description**: Real-time notifications for strategy activities

**Requirements**:
- Notification types:
  - **Watchlist Updated**: "Strategy 'Momentum Bot' added Bitcoin ETF market to watchlist"
  - **Trade Executed**: "Strategy 'Whale Follower' bought YES for $100 in market XYZ"
  - **Trade Exited**: "Strategy 'Momentum Bot' sold position in market ABC for +$25 profit"
  - **Strategy Error**: "Strategy 'Politics Bot' encountered an error and paused"
  - **Strategy Paused**: "Strategy 'Crypto Scanner' was paused"
  - **Strategy Resumed**: "Strategy 'Crypto Scanner' resumed execution"

- Notification delivery:
  - In-app notification center (bell icon in topbar)
  - Toast notifications (for critical events while user is active)
  - Email notifications (configurable per user)
  - Push notifications (future - mobile app)

- Notification settings:
  - User can configure which events trigger notifications
  - User can set "quiet hours" (e.g., no notifications 11pm - 7am)
  - User can set notification frequency (immediate, batched hourly, batched daily)

**Database Requirements**:
- `notifications` table:
  - user_id, strategy_id (nullable), type, title, message, read, created_at
- `notification_settings` table:
  - user_id, notification_type, enabled, delivery_method

---

### 7. Polymarket Wallet Integration

**Description**: Connect user's Polymarket wallet to enable real trading

**Requirements**:
- Wallet connection flow:
  1. User navigates to Settings > Wallet
  2. User clicks "Connect Polymarket Wallet"
  3. System prompts for wallet address (MetaMask, WalletConnect, or manual entry)
  4. User signs message to verify ownership
  5. System stores encrypted wallet connection

- Wallet management:
  - Display connected wallet address (truncated: 0x123...789)
  - Show wallet balance (USDC available for trading)
  - Show total positions value
  - Ability to disconnect wallet

- Trading prerequisites:
  - Strategy cannot execute real trades without connected wallet
  - Strategy shows warning if wallet not connected
  - Paper trading mode available (simulated trades) if no wallet

**Security Requirements**:
- Never store private keys
- Use WalletConnect for secure signing
- All trades require user signature (initially)
- Rate limiting on trade execution
- Maximum trade size limits (configurable per strategy)

---

### 8. Sub-Wallets Per Strategy (Risk Isolation)

**Description**: Each strategy operates with isolated capital allocation

**Requirements**:
- User allocates specific amount to each strategy
  - Example: "Momentum Bot" gets $500, "Whale Follower" gets $1000
- Sub-wallet tracking:
  - `strategy_wallets` table with strategy_id, allocated_amount, available_amount, deployed_amount
- Strategy cannot trade more than its allocated amount
- User can:
  - View capital allocation dashboard (pie chart of allocations)
  - Rebalance allocations ("Move $200 from Strategy A to Strategy B")
  - Withdraw from strategy (close all positions, return capital to main wallet)

- Risk management:
  - Each strategy has daily loss limit (auto-pause if exceeded)
  - Each strategy has max position size (% of allocated capital)
  - Total portfolio exposure limit (across all strategies)

**Implementation Options**:
1. **Virtual Sub-Wallets** (Recommended for MVP):
   - Single Polymarket wallet
   - Database tracks allocations
   - Simpler implementation

2. **Real Sub-Wallets** (Future):
   - Create actual Polymarket sub-wallets
   - Complete isolation
   - More complex integration

---

### 9. Autonomous Trading Execution (Polymarket CLOB API)

**Description**: Execute real trades on Polymarket via CLOB API

**Requirements**:
- Integration with Polymarket CLOB API:
  - Market orders (buy at current price)
  - Limit orders (buy at specific price)
  - Order status tracking
  - Position management

- Trade execution workflow:
  1. Strategy determines trade signal
  2. Check wallet balance (sufficient funds?)
  3. Check strategy allocation (within limits?)
  4. Create order via CLOB API
  5. Sign order with user's wallet
  6. Submit order to Polymarket
  7. Track order status (pending → filled → settled)
  8. Update database (record trade)
  9. Send notification (trade executed)

- Position exit logic:
  - Strategies can sell positions based on conditions
  - Support for partial exits (sell 50% of position)
  - Support for stop-loss (auto-sell if price drops X%)
  - Support for take-profit (auto-sell if price reaches target)

**Database Requirements**:
- `strategy_trades` columns:
  - order_id (from Polymarket)
  - status (pending, filled, partial, cancelled, settled)
  - entry_price, exit_price (if closed)
  - pnl (profit/loss in USDC)
  - filled_at, closed_at

---

### 10. Node Editor Updates (New Node Types)

**Description**: Add new workflow nodes to support autonomous trading

**New Node Types**:

1. **Add to Watchlist Node**
   - Input: Market data
   - Config: None (uses current strategy's watchlist)
   - Output: Confirmation

2. **Monitor Watchlist Node**
   - Input: None (reads from strategy's watchlist)
   - Config: Filter conditions
   - Output: Markets matching conditions

3. **Execute Trade Node** (Enhanced)
   - Current: Mock execution only
   - New: Real Polymarket CLOB API integration
   - Config:
     - Outcome (Yes/No)
     - Amount (USDC)
     - Order type (market/limit)
     - Limit price (if limit order)
   - Output: Trade confirmation with order_id

4. **Exit Position Node**
   - Input: Market ID or position ID
   - Config:
     - Exit type (full/partial)
     - Amount (if partial)
   - Output: Exit confirmation

5. **Check Momentum Node**
   - Input: Market data
   - Config: Timeframe (1h, 4h, 24h)
   - Output: Momentum score (-1 to 1)

6. **Wait Node**
   - Input: None
   - Config: Duration (minutes, hours, days)
   - Output: None (pauses execution)

---

### 11. Testing & Validation

**Paper Trading Mode**:
- All strategies default to paper trading
- Simulates trades without real money
- Uses real market prices
- Tracks hypothetical P&L
- User can switch to live trading when confident

**Testing Checklist**:
- [ ] Strategy runs 24/7 without user intervention
- [ ] Multiple strategies can run concurrently
- [ ] Watchlist adds/removes correctly
- [ ] Trades execute based on conditions
- [ ] Notifications sent for all events
- [ ] Wallet connection works
- [ ] Sub-wallet allocations enforced
- [ ] Stop-loss and take-profit triggers work
- [ ] Strategy pauses on error
- [ ] Dashboard updates in real-time

---

## User Flows

### Flow 1: Create and Run Autonomous Strategy

1. User navigates to Strategy Builder
2. User builds workflow with AI copilot:
   - "Build a bot that monitors Politics markets with volume > $100k"
   - "Add them to a watchlist"
   - "Check watchlist every 5 minutes for momentum > 5%"
   - "If momentum is strong, buy Yes for $100"
3. User saves strategy as "Politics Momentum Bot"
4. User allocates $500 to strategy
5. User clicks "Start Strategy" (not "Run Strategy")
6. Strategy begins running 24/7 in background
7. User can monitor via strategy dashboard

### Flow 2: Monitor Running Strategy

1. User navigates to "My Strategies" dashboard
2. User sees "Politics Momentum Bot" with status: Running
3. User clicks on strategy to view detail dashboard
4. Dashboard shows:
   - Uptime: 2 hours
   - Watchlist: 12 markets
   - Active trades: 2 positions
   - Recent activity: Added "Trump vs Biden 2024" to watchlist 5 min ago
5. User receives notification: "Politics Momentum Bot bought YES for $100 in market XYZ"
6. User clicks notification, navigates to strategy dashboard
7. User sees trade details in activity log

### Flow 3: Manage Strategy Allocation

1. User navigates to Settings > Capital Allocation
2. User sees pie chart:
   - Politics Momentum Bot: $500 ($300 deployed, $200 available)
   - Whale Follower: $1000 ($800 deployed, $200 available)
3. User clicks "Rebalance"
4. User moves $200 from Whale Follower to Politics Momentum Bot
5. System confirms rebalance
6. Strategies continue running with new allocations

---

## Technical Architecture

### Background Job System

**Option 1: Vercel Cron + Database Queue (Recommended for MVP)**
- Use Vercel cron to trigger every minute: `/api/cron/strategy-executor`
- Cron job checks `strategy_sessions` table for active strategies
- For each active strategy, check if it's time to execute (based on interval)
- Execute workflow in serverless function
- Update `last_executed_at` timestamp

**Limitations**:
- 10-second serverless function timeout
- May need to split long workflows across multiple executions

**Option 2: External Queue System (Future - for scale)**
- Use BullMQ + Redis for job queue
- Long-running worker processes
- Better for complex workflows
- Requires infrastructure beyond Vercel

### Database Schema Changes

**New Tables**:

```sql
-- Strategy Watchlists
CREATE TABLE strategy_watchlists (
  id UUID PRIMARY KEY,
  strategy_id UUID REFERENCES workflow_sessions(id),
  market_id TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT,
  metadata JSONB
);

-- Strategy Trades
CREATE TABLE strategy_trades (
  id UUID PRIMARY KEY,
  strategy_id UUID REFERENCES workflow_sessions(id),
  market_id TEXT NOT NULL,
  order_id TEXT,  -- from Polymarket
  outcome TEXT NOT NULL,  -- Yes or No
  amount NUMERIC NOT NULL,
  order_type TEXT NOT NULL,  -- market or limit
  status TEXT NOT NULL,  -- pending, filled, partial, cancelled, settled
  entry_price NUMERIC,
  exit_price NUMERIC,
  pnl NUMERIC,
  filled_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Strategy Wallets (Capital Allocation)
CREATE TABLE strategy_wallets (
  id UUID PRIMARY KEY,
  strategy_id UUID REFERENCES workflow_sessions(id) UNIQUE,
  allocated_amount NUMERIC NOT NULL DEFAULT 0,
  available_amount NUMERIC NOT NULL DEFAULT 0,
  deployed_amount NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  strategy_id UUID REFERENCES workflow_sessions(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification Settings
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  notification_type TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  delivery_method TEXT NOT NULL DEFAULT 'in-app',  -- in-app, email, push
  UNIQUE(user_id, notification_type)
);
```

**Updated Tables**:

```sql
-- Add to workflow_sessions
ALTER TABLE workflow_sessions ADD COLUMN execution_interval_minutes INTEGER DEFAULT 5;
ALTER TABLE workflow_sessions ADD COLUMN auto_run BOOLEAN DEFAULT FALSE;
ALTER TABLE workflow_sessions ADD COLUMN last_executed_at TIMESTAMPTZ;
ALTER TABLE workflow_sessions ADD COLUMN next_execution_at TIMESTAMPTZ;
```

---

## Success Criteria

**MVP Launch Criteria**:
- [ ] Strategies can run 24/7 in background
- [ ] Users can start/pause/stop strategies
- [ ] Strategy dashboard shows real-time status
- [ ] Watchlist system works (add/remove/monitor)
- [ ] Notifications sent for key events
- [ ] Paper trading executes correctly
- [ ] At least 3 users test autonomous strategies successfully

**Full Feature Launch Criteria**:
- [ ] Polymarket wallet integration complete
- [ ] Real trades executing via CLOB API
- [ ] Sub-wallet allocations enforced
- [ ] Capital rebalancing works
- [ ] Stop-loss and take-profit functioning
- [ ] 99%+ uptime for strategy execution
- [ ] Users report successful autonomous trading

---

## Risks & Mitigations

**Risk 1: Vercel Serverless Timeouts**
- Mitigation: Break long workflows into chunks, use external queue for complex strategies

**Risk 2: Polymarket API Rate Limits**
- Mitigation: Implement request throttling, cache market data

**Risk 3: User Loses Money Due to Bug**
- Mitigation: Mandatory paper trading period, start with small allocations, comprehensive testing

**Risk 4: Wallet Security**
- Mitigation: Never store private keys, use WalletConnect, implement trade limits

**Risk 5: Strategy Runs Out of Control**
- Mitigation: Daily loss limits, max position size, user can always pause/stop

---

## Open Questions

1. Should strategies auto-restart after errors, or require manual intervention?
2. What's the minimum execution interval? (1 min, 5 min, 15 min?)
3. Should we support strategy scheduling? (e.g., only run 9am-5pm EST)
4. Do we need strategy version control for live strategies?
5. How do we handle strategy edits while it's running? (pause required?)
6. Should watchlist have expiration? (auto-remove after X days)
7. Do we need strategy templates for common patterns?

---

## Dependencies

- Polymarket CLOB API documentation
- WalletConnect integration
- Background job system decision (Vercel cron vs external queue)
- Notification service (email provider, push notification service)
- Testing environment with paper trading

---

## Timeline Estimate

**Phase 1: Foundation (Week 1-2)**
- Database schema updates
- Background job system
- Strategy start/pause/stop controls
- Basic strategy dashboard

**Phase 2: Watchlist & Monitoring (Week 3)**
- Watchlist system
- Monitor watchlist node
- Dashboard enhancements

**Phase 3: Notifications (Week 4)**
- Notification system
- In-app notification center
- Email integration

**Phase 4: Trading (Week 5-6)**
- Wallet integration
- Paper trading
- CLOB API integration
- Sub-wallet allocations

**Phase 5: Testing & Polish (Week 7-8)**
- End-to-end testing
- User acceptance testing
- Bug fixes
- Documentation

**Total: 8 weeks to full production**

---

**Status**: Ready for spec writing
**Next Step**: Generate detailed spec.md with technical design
