# Strategy Position Tracking System - Architecture Documentation

**Created:** 2025-10-25
**Migration:** `20251025200000_create_strategy_position_tracking.sql`
**Purpose:** Complete database schema for automated trading strategy execution, position tracking, and performance monitoring

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Entity Relationship Diagram](#entity-relationship-diagram)
3. [Data Models](#data-models)
4. [Data Flow](#data-flow)
5. [Common Query Patterns](#common-query-patterns)
6. [Performance Considerations](#performance-considerations)
7. [Security Model](#security-model)
8. [Integration Guide](#integration-guide)
9. [Monitoring & Maintenance](#monitoring--maintenance)

---

## System Overview

The Strategy Position Tracking System enables users to:

- **Execute strategies** and generate signals
- **Build watchlists** of high-potential wallets, markets, and categories
- **Track positions** with real-time P&L calculations
- **Log all trades** for audit and analysis
- **Monitor performance** through time-series snapshots
- **Automate execution** with configurable risk management

### Architecture Principles

1. **Separation of Concerns**: Each table has a single, clear responsibility
2. **Traceability**: Every position links back to the watchlist item and execution that created it
3. **Flexibility**: JSONB fields for extensibility without schema changes
4. **Performance**: Strategic indexes for common query patterns
5. **Security**: Row-level security ensures data isolation between users

---

## Entity Relationship Diagram

```
┌─────────────────────────┐
│  strategy_definitions   │
│  (existing table)       │
└────────────┬────────────┘
             │ 1
             │
             │ many
    ┌────────┴────────────────────────────────────────┐
    │                                                  │
    │                                                  │
    ▼                                                  ▼
┌───────────────────────────┐              ┌──────────────────────┐
│ strategy_executions       │              │  strategy_settings   │
│ (existing table)          │              │  (1:1 relationship)  │
└────────────┬──────────────┘              └──────────────────────┘
             │ 1                           Fields:
             │                             - initial_balance_usd
             │ many                        - max_position_size_usd
             ▼                             - auto_execute_enabled
┌─────────────────────────────────┐        - stop_loss_percent
│  strategy_watchlist_items       │        - trading_hours
└────────────┬────────────────────┘        - notification_settings
             │
             │ Fields:
             │ - item_type (WALLET/MARKET/CATEGORY)
             │ - item_id
             │ - signal_reason
             │ - confidence
             │ - status (WATCHING/TRIGGERED/...)
             │
             │ 1
             │
             │ many
             ▼
┌─────────────────────────────────┐
│     strategy_positions          │
└────────────┬────────────────────┘
             │
             │ Fields:
             │ - entry_price, entry_shares, entry_amount_usd
             │ - current_price, unrealized_pnl
             │ - exit_price, realized_pnl
             │ - status (OPEN/CLOSED/PARTIAL)
             │ - auto_entered, auto_exited
             │
             │ 1
             │
             │ many
             ▼
┌─────────────────────────────────┐
│      strategy_trades            │
└─────────────────────────────────┘
  Fields:
  - trade_type (BUY/SELL)
  - shares, price, amount_usd
  - execution_status
  - order_id, transaction_hash
  - pnl


                    ┌──────────────────────────────────┐
                    │  strategy_performance_snapshots  │
                    └──────────────────────────────────┘
                      Fields:
                      - portfolio_value_usd
                      - total_realized_pnl
                      - total_unrealized_pnl
                      - win_rate, profit_factor
                      - snapshot_timestamp
```

### Relationship Summary

| Parent Table | Child Table | Relationship | Description |
|-------------|-------------|--------------|-------------|
| `strategy_definitions` | `strategy_executions` | 1:many | One strategy, many execution runs |
| `strategy_definitions` | `strategy_watchlist_items` | 1:many | One strategy, many watchlist items |
| `strategy_definitions` | `strategy_positions` | 1:many | One strategy, many positions |
| `strategy_definitions` | `strategy_trades` | 1:many | One strategy, many trades |
| `strategy_definitions` | `strategy_settings` | 1:1 | One strategy, one settings record |
| `strategy_definitions` | `strategy_performance_snapshots` | 1:many | One strategy, many snapshots |
| `strategy_executions` | `strategy_watchlist_items` | 1:many | One execution can add many watchlist items |
| `strategy_watchlist_items` | `strategy_positions` | 1:many | One watchlist item can trigger multiple positions |
| `strategy_positions` | `strategy_trades` | 1:many | One position can have multiple trades (entry, partial exits, full exit) |

---

## Data Models

### 1. strategy_watchlist_items

**Purpose:** Unified watchlist for monitoring wallets, markets, and categories flagged by strategy signals.

**Lifecycle:**
1. Strategy execution completes with `ADD_TO_WATCHLIST` action
2. Items inserted with status `WATCHING`
3. Monitoring system periodically checks conditions
4. When conditions met → status becomes `TRIGGERED`
5. User or automation creates position → status remains `TRIGGERED` (historical record)
6. User can manually dismiss → status becomes `DISMISSED`

**Key Fields:**
- `item_type`: WALLET | MARKET | CATEGORY
- `item_id`: The actual ID (wallet address, market ID, category name)
- `item_data`: Cached snapshot of metrics at time of addition (JSONB)
- `signal_reason`: Human-readable explanation (e.g., "omega_ratio > 2.0 AND win_rate > 0.65")
- `confidence`: HIGH | MEDIUM | LOW
- `status`: WATCHING | TRIGGERED | DISMISSED | EXPIRED

**Example Use Cases:**
- Strategy flags wallet `0x1234...` with high omega ratio → add to watchlist
- Monitor wallet for new market participation
- When wallet enters new market → trigger signal, create position

**Sample Data:**
```sql
INSERT INTO strategy_watchlist_items (
  strategy_id, execution_id, item_type, item_id, item_data,
  signal_reason, confidence, status
) VALUES (
  'abc-123', 'exec-456', 'WALLET', '0x1234567890abcdef',
  '{"omega_ratio": 2.5, "win_rate": 0.68, "total_volume_usd": 125000}',
  'High omega ratio (2.5) with strong win rate (68%) in Crypto category',
  'HIGH', 'WATCHING'
);
```

### 2. strategy_positions

**Purpose:** Track all positions (open and closed) with full entry/exit data and P&L calculations.

**Lifecycle:**
1. Watchlist item triggers signal OR user manually creates position
2. Position created with status `OPEN`
3. Periodic updates to `current_price` and `unrealized_pnl`
4. Exit signal fires OR user manually closes
5. Status changes to `CLOSED`, exit fields populated
6. Realized P&L calculated and stored

**Key Fields:**

**Entry:**
- `entry_timestamp`, `entry_price`, `entry_shares`, `entry_amount_usd`
- `entry_signal_type`: Type of signal that triggered entry

**Current State (for open positions):**
- `current_price`: Latest price (updated periodically)
- `current_value_usd`: Current position value
- `unrealized_pnl`: Profit/loss if closed now
- `unrealized_pnl_percent`: ROI percentage

**Exit:**
- `exit_timestamp`, `exit_price`, `exit_shares`, `exit_amount_usd`
- `realized_pnl`: Final profit/loss after close
- `realized_pnl_percent`: Final ROI percentage
- `exit_signal_type`: TAKE_PROFIT | STOP_LOSS | SIGNAL_REVERSAL | MANUAL

**Status:**
- `OPEN`: Active position
- `CLOSED`: Fully closed
- `PARTIAL`: Partially closed (some shares sold)
- `CANCELLED`: Cancelled before execution

**Sample Data:**
```sql
-- Create open position
INSERT INTO strategy_positions (
  strategy_id, watchlist_item_id, market_id, market_title,
  outcome, entry_signal_type, entry_price, entry_shares, entry_amount_usd,
  current_price, current_value_usd, category, auto_entered, metadata
) VALUES (
  'abc-123', 'watch-789', '0xmarket123',
  'Will Bitcoin hit $100K by end of 2025?',
  'YES', 'HIGH_OMEGA_WALLET', 0.55, 1000, 550.00,
  0.55, 550.00, 'Crypto', true,
  '{"stop_loss": 0.45, "take_profit": 0.75, "source_wallet": "0x1234..."}'
);

-- Update with current price (periodic job)
UPDATE strategy_positions
SET
  current_price = 0.67,
  current_value_usd = entry_shares * 0.67,
  unrealized_pnl = (entry_shares * 0.67) - entry_amount_usd - fees_paid,
  unrealized_pnl_percent = (((entry_shares * 0.67) - entry_amount_usd - fees_paid) / entry_amount_usd) * 100
WHERE id = 'position-id' AND status = 'OPEN';

-- Close position
UPDATE strategy_positions
SET
  status = 'CLOSED',
  exit_timestamp = NOW(),
  exit_price = 0.72,
  exit_shares = entry_shares,
  exit_amount_usd = entry_shares * 0.72,
  realized_pnl = (entry_shares * 0.72) - entry_amount_usd - fees_paid,
  realized_pnl_percent = (((entry_shares * 0.72) - entry_amount_usd - fees_paid) / entry_amount_usd) * 100,
  auto_exited = true,
  exit_signal_type = 'TAKE_PROFIT'
WHERE id = 'position-id';
```

### 3. strategy_trades

**Purpose:** Complete execution log of all buy/sell orders.

**Lifecycle:**
1. Order placed → status `PENDING`
2. Order executes → status `COMPLETED`, `executed_at` set
3. For SELL trades → `pnl` calculated

**Key Fields:**
- `trade_type`: BUY | SELL
- `shares`, `price`, `amount_usd`, `fees`
- `execution_status`: PENDING | COMPLETED | FAILED | CANCELLED
- `order_id`: External order ID (Polymarket)
- `transaction_hash`: Blockchain transaction hash
- `pnl`: For SELL trades, the realized P&L

**Use Cases:**
- Entry trade: BUY 1000 shares at 0.55
- Partial exit: SELL 500 shares at 0.68
- Full exit: SELL 500 shares at 0.72
- Failed order: status FAILED with error_message

**Sample Data:**
```sql
-- Entry trade
INSERT INTO strategy_trades (
  strategy_id, position_id, trade_type, market_id, market_title,
  outcome, shares, price, amount_usd, fees, execution_status
) VALUES (
  'abc-123', 'position-456', 'BUY', '0xmarket123',
  'Will Bitcoin hit $100K by end of 2025?',
  'YES', 1000, 0.55, 550.00, 2.75, 'COMPLETED'
);

-- Exit trade with P&L
INSERT INTO strategy_trades (
  strategy_id, position_id, trade_type, market_id, market_title,
  outcome, shares, price, amount_usd, fees, execution_status, pnl
) VALUES (
  'abc-123', 'position-456', 'SELL', '0xmarket123',
  'Will Bitcoin hit $100K by end of 2025?',
  'YES', 1000, 0.72, 720.00, 3.60, 'COMPLETED', 163.65
);
-- pnl = 720.00 - 550.00 - 2.75 - 3.60 = 163.65
```

### 4. strategy_performance_snapshots

**Purpose:** Time-series performance data for charting and analysis.

**Lifecycle:**
1. Cron job runs hourly/daily
2. Calculates current portfolio state
3. Inserts snapshot row
4. Used for charting P&L curves, drawdown, etc.

**Key Metrics:**
- `portfolio_value_usd`: cash + open position values
- `total_realized_pnl`: Sum of all closed position P&L
- `total_unrealized_pnl`: Sum of open position P&L
- `total_pnl`: realized + unrealized
- `win_rate`: % of winning trades
- `profit_factor`: total_wins / total_losses

**Sample Data:**
```sql
INSERT INTO strategy_performance_snapshots (
  strategy_id, snapshot_timestamp,
  portfolio_value_usd, cash_balance_usd,
  open_positions_count, open_positions_value_usd,
  total_realized_pnl, total_unrealized_pnl, total_pnl,
  win_count, loss_count, win_rate
) VALUES (
  'abc-123', '2025-10-25 12:00:00',
  11500.00, 8000.00,
  5, 3500.00,
  800.00, 200.00, 1000.00,
  15, 10, 0.60
);
```

### 5. strategy_settings

**Purpose:** Per-strategy configuration for automation and risk management.

**Key Settings:**

**Capital Management:**
- `initial_balance_usd`: Starting capital (for ROI calculations)
- `current_balance_usd`: Available cash
- `max_position_size_usd`: Per-position limit
- `max_positions`: Concurrent position limit

**Automation:**
- `auto_execute_enabled`: Auto-enter positions on signals
- `auto_exit_enabled`: Auto-close on exit signals

**Risk Management:**
- `stop_loss_percent`: Default stop loss
- `take_profit_percent`: Default take profit
- `risk_per_trade_percent`: Max % of portfolio per trade

**Trading Restrictions:**
- `trading_hours`: JSON config for time-based restrictions

**Notifications:**
- `notifications_enabled`: Enable/disable notifications
- `webhook_url`: External webhook (Slack, Discord)
- `notification_events`: Which events trigger notifications

**Sample Data:**
```sql
INSERT INTO strategy_settings (
  strategy_id, initial_balance_usd, current_balance_usd,
  max_position_size_usd, max_positions,
  auto_execute_enabled, auto_exit_enabled,
  stop_loss_percent, take_profit_percent, risk_per_trade_percent
) VALUES (
  'abc-123', 10000.00, 8500.00,
  500.00, 10,
  true, true,
  20.0, 50.0, 2.0
);
```

---

## Data Flow

### Flow 1: Strategy Execution → Watchlist

```
┌──────────────────────┐
│ User runs strategy   │
│ in Strategy Builder  │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────┐
│ Strategy executes nodes      │
│ - Filters wallets/markets    │
│ - Calculates metrics         │
│ - Evaluates conditions       │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ ACTION node:                 │
│ ADD_TO_WATCHLIST             │
│ - item_type: WALLET          │
│ - item_id: 0x1234...         │
│ - signal_reason: "High Ω"    │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Insert into                      │
│ strategy_watchlist_items         │
│ - status: WATCHING               │
│ - confidence: HIGH               │
│ - item_data: {metrics}           │
└──────────────────────────────────┘
```

### Flow 2: Watchlist → Position

```
┌────────────────────────────┐
│ Monitoring system runs     │
│ (cron job or real-time)    │
└──────────┬─────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ Check watchlist items          │
│ WHERE status = 'WATCHING'      │
└──────────┬─────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ Evaluate trigger conditions    │
│ - New market participation?    │
│ - Price change?                │
│ - Volume spike?                │
└──────────┬─────────────────────┘
           │ Condition met
           ▼
┌────────────────────────────────┐
│ Update watchlist item          │
│ - status: TRIGGERED            │
│ - triggered_at: NOW()          │
└──────────┬─────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ Check strategy_settings        │
│ - auto_execute_enabled?        │
│ - Within trading_hours?        │
│ - Below max_positions?         │
└──────────┬─────────────────────┘
           │ All checks pass
           ▼
┌────────────────────────────────┐
│ Create position                │
│ INSERT INTO strategy_positions │
│ - status: OPEN                 │
│ - auto_entered: true           │
│ - entry_price, shares, amount  │
└──────────┬─────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ Execute BUY trade              │
│ INSERT INTO strategy_trades    │
│ - trade_type: BUY              │
│ - execution_status: PENDING    │
└────────────────────────────────┘
```

### Flow 3: Position Monitoring → Exit

```
┌────────────────────────────┐
│ Price update job runs      │
│ (every 1-5 minutes)        │
└──────────┬─────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ Fetch current prices for all   │
│ open positions                 │
└──────────┬─────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ Update strategy_positions      │
│ - current_price                │
│ - unrealized_pnl               │
│ - unrealized_pnl_percent       │
└──────────┬─────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ Check exit conditions          │
│ - Take profit hit?             │
│ - Stop loss hit?               │
│ - Signal reversal?             │
└──────────┬─────────────────────┘
           │ Exit condition met
           ▼
┌────────────────────────────────┐
│ Check strategy_settings        │
│ - auto_exit_enabled: true?     │
└──────────┬─────────────────────┘
           │ Yes
           ▼
┌────────────────────────────────┐
│ Execute SELL trade             │
│ INSERT INTO strategy_trades    │
│ - trade_type: SELL             │
│ - shares, price, amount        │
│ - pnl: calculated              │
└──────────┬─────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ Update position to CLOSED      │
│ - exit_timestamp, exit_price   │
│ - realized_pnl                 │
│ - auto_exited: true            │
│ - exit_signal_type             │
└────────────────────────────────┘
```

### Flow 4: Performance Snapshot

```
┌────────────────────────────┐
│ Cron job runs              │
│ (hourly or daily)          │
└──────────┬─────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ For each active strategy       │
└──────────┬─────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ Calculate current state        │
│ - Count open positions         │
│ - Sum unrealized P&L           │
│ - Sum realized P&L             │
│ - Calculate win rate           │
│ - Calculate profit factor      │
└──────────┬─────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│ INSERT INTO                    │
│ strategy_performance_snapshots │
│ - portfolio_value_usd          │
│ - total_pnl                    │
│ - win_rate                     │
│ - snapshot_timestamp: NOW()    │
└────────────────────────────────┘
```

---

## Common Query Patterns

### 1. Get Active Watchlist for Dashboard

```sql
-- Show all items being monitored
SELECT
  w.id,
  w.item_type,
  w.item_id,
  w.item_data->>'name' as item_name,
  w.signal_reason,
  w.confidence,
  w.status,
  w.created_at,
  sd.name as strategy_name
FROM strategy_watchlist_items w
JOIN strategy_definitions sd ON w.strategy_id = sd.id
WHERE w.strategy_id = 'YOUR-STRATEGY-ID'
  AND w.status IN ('WATCHING', 'TRIGGERED')
ORDER BY
  CASE w.confidence
    WHEN 'HIGH' THEN 1
    WHEN 'MEDIUM' THEN 2
    WHEN 'LOW' THEN 3
  END,
  w.created_at DESC;
```

### 2. Get Open Positions with Current P&L

```sql
-- Dashboard view of all active positions
SELECT
  p.id,
  p.market_title,
  p.outcome,
  p.entry_timestamp,
  p.entry_price,
  p.current_price,
  p.entry_amount_usd,
  p.current_value_usd,
  p.unrealized_pnl,
  p.unrealized_pnl_percent,
  EXTRACT(EPOCH FROM (NOW() - p.entry_timestamp))/3600 as hours_open,
  p.metadata->>'stop_loss' as stop_loss,
  p.metadata->>'take_profit' as take_profit,
  CASE
    WHEN p.unrealized_pnl > 0 THEN 'winning'
    WHEN p.unrealized_pnl < 0 THEN 'losing'
    ELSE 'neutral'
  END as pnl_status
FROM strategy_positions p
WHERE p.strategy_id = 'YOUR-STRATEGY-ID'
  AND p.status = 'OPEN'
ORDER BY p.unrealized_pnl DESC;
```

### 3. Calculate Strategy Performance Metrics

```sql
-- Real-time performance calculation
WITH closed_positions AS (
  SELECT *
  FROM strategy_positions
  WHERE strategy_id = 'YOUR-STRATEGY-ID'
    AND status = 'CLOSED'
),
stats AS (
  SELECT
    COUNT(*) as total_trades,
    COUNT(*) FILTER (WHERE realized_pnl > 0) as wins,
    COUNT(*) FILTER (WHERE realized_pnl < 0) as losses,
    SUM(realized_pnl) as total_realized_pnl,
    SUM(realized_pnl) FILTER (WHERE realized_pnl > 0) as total_wins,
    SUM(ABS(realized_pnl)) FILTER (WHERE realized_pnl < 0) as total_losses,
    AVG(realized_pnl) FILTER (WHERE realized_pnl > 0) as avg_win,
    AVG(realized_pnl) FILTER (WHERE realized_pnl < 0) as avg_loss
  FROM closed_positions
)
SELECT
  total_trades,
  wins,
  losses,
  ROUND((wins::numeric / NULLIF(total_trades, 0)) * 100, 2) as win_rate_percent,
  total_realized_pnl,
  ROUND(total_wins / NULLIF(total_losses, 1), 2) as profit_factor,
  avg_win,
  avg_loss,
  CASE
    WHEN avg_loss < 0 THEN ROUND(avg_win / ABS(avg_loss), 2)
    ELSE NULL
  END as win_loss_ratio
FROM stats;
```

### 4. Get Trade History with Position Context

```sql
-- Complete trade log with position details
SELECT
  t.id,
  t.trade_type,
  t.market_title,
  t.outcome,
  t.shares,
  t.price,
  t.amount_usd,
  t.fees,
  t.pnl,
  t.execution_status,
  t.executed_at,
  p.entry_price as position_entry_price,
  p.entry_timestamp as position_entry_time,
  p.status as position_status
FROM strategy_trades t
LEFT JOIN strategy_positions p ON t.position_id = p.id
WHERE t.strategy_id = 'YOUR-STRATEGY-ID'
  AND t.execution_status = 'COMPLETED'
ORDER BY t.executed_at DESC
LIMIT 50;
```

### 5. Find Positions Ready for Take Profit

```sql
-- Positions that hit take profit target
SELECT
  p.id,
  p.market_title,
  p.outcome,
  p.entry_price,
  p.current_price,
  p.unrealized_pnl_percent,
  (p.metadata->>'take_profit')::numeric as take_profit_price,
  CASE
    WHEN p.current_price >= (p.metadata->>'take_profit')::numeric
    THEN 'READY_TO_EXIT'
    ELSE 'HOLDING'
  END as action
FROM strategy_positions p
WHERE p.strategy_id = 'YOUR-STRATEGY-ID'
  AND p.status = 'OPEN'
  AND p.metadata->>'take_profit' IS NOT NULL
  AND p.current_price >= (p.metadata->>'take_profit')::numeric
ORDER BY p.unrealized_pnl_percent DESC;
```

### 6. Performance Over Time (Chart Data)

```sql
-- Get performance snapshots for charting
SELECT
  DATE_TRUNC('day', snapshot_timestamp) as date,
  AVG(portfolio_value_usd) as avg_portfolio_value,
  AVG(total_pnl) as avg_total_pnl,
  AVG(total_roi_percent) as avg_roi_percent,
  AVG(win_rate) as avg_win_rate
FROM strategy_performance_snapshots
WHERE strategy_id = 'YOUR-STRATEGY-ID'
  AND snapshot_timestamp >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', snapshot_timestamp)
ORDER BY date ASC;
```

### 7. Best Performing Markets

```sql
-- Top markets by realized P&L
SELECT
  market_title,
  category,
  COUNT(*) as position_count,
  SUM(realized_pnl) as total_pnl,
  AVG(realized_pnl) as avg_pnl,
  AVG(realized_pnl_percent) as avg_roi_percent,
  COUNT(*) FILTER (WHERE realized_pnl > 0) as wins,
  COUNT(*) FILTER (WHERE realized_pnl < 0) as losses
FROM strategy_positions
WHERE strategy_id = 'YOUR-STRATEGY-ID'
  AND status = 'CLOSED'
GROUP BY market_title, category
HAVING COUNT(*) >= 2 -- At least 2 positions
ORDER BY total_pnl DESC
LIMIT 10;
```

### 8. Update Open Position Prices (Batch Job)

```sql
-- Update all open positions with latest prices
-- This would be called by a cron job with real price data
WITH price_updates AS (
  SELECT
    position_id,
    current_price
  FROM get_latest_market_prices() -- Your function to fetch prices
)
UPDATE strategy_positions p
SET
  current_price = pu.current_price,
  current_value_usd = p.entry_shares * pu.current_price,
  unrealized_pnl = (p.entry_shares * pu.current_price) - p.entry_amount_usd - p.fees_paid,
  unrealized_pnl_percent = (
    ((p.entry_shares * pu.current_price) - p.entry_amount_usd - p.fees_paid) / p.entry_amount_usd
  ) * 100,
  updated_at = NOW()
FROM price_updates pu
WHERE p.id = pu.position_id
  AND p.status = 'OPEN';
```

### 9. Create Position from Watchlist Trigger

```sql
-- When a watchlist item triggers, create a position
WITH watchlist_item AS (
  SELECT * FROM strategy_watchlist_items
  WHERE id = 'WATCHLIST-ITEM-ID'
),
settings AS (
  SELECT * FROM strategy_settings
  WHERE strategy_id = (SELECT strategy_id FROM watchlist_item)
),
position_size AS (
  SELECT
    LEAST(
      (SELECT current_balance_usd FROM settings) *
      (SELECT risk_per_trade_percent FROM settings) / 100,
      (SELECT max_position_size_usd FROM settings)
    ) as amount_usd
)
INSERT INTO strategy_positions (
  strategy_id,
  watchlist_item_id,
  market_id,
  market_title,
  outcome,
  entry_signal_type,
  entry_price,
  entry_shares,
  entry_amount_usd,
  current_price,
  current_value_usd,
  auto_entered,
  metadata
)
SELECT
  wi.strategy_id,
  wi.id,
  wi.item_data->>'market_id',
  wi.item_data->>'market_title',
  'YES',
  'WATCHLIST_TRIGGER',
  (wi.item_data->>'current_price')::numeric,
  ps.amount_usd / (wi.item_data->>'current_price')::numeric,
  ps.amount_usd,
  (wi.item_data->>'current_price')::numeric,
  ps.amount_usd,
  true,
  jsonb_build_object(
    'stop_loss', (wi.item_data->>'current_price')::numeric * (1 - s.stop_loss_percent/100),
    'take_profit', (wi.item_data->>'current_price')::numeric * (1 + s.take_profit_percent/100)
  )
FROM watchlist_item wi
CROSS JOIN settings s
CROSS JOIN position_size ps
RETURNING *;
```

### 10. Generate Daily Performance Snapshot

```sql
-- Cron job to create daily snapshot
INSERT INTO strategy_performance_snapshots (
  strategy_id,
  snapshot_timestamp,
  portfolio_value_usd,
  cash_balance_usd,
  open_positions_count,
  open_positions_value_usd,
  total_realized_pnl,
  total_unrealized_pnl,
  total_pnl,
  total_roi_percent,
  total_trades,
  win_count,
  loss_count,
  win_rate,
  profit_factor,
  avg_win,
  avg_loss
)
SELECT
  ss.strategy_id,
  NOW(),
  ss.current_balance_usd + COALESCE(SUM(p.current_value_usd) FILTER (WHERE p.status = 'OPEN'), 0),
  ss.current_balance_usd,
  COUNT(*) FILTER (WHERE p.status = 'OPEN'),
  COALESCE(SUM(p.current_value_usd) FILTER (WHERE p.status = 'OPEN'), 0),
  COALESCE(SUM(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED'), 0),
  COALESCE(SUM(p.unrealized_pnl) FILTER (WHERE p.status = 'OPEN'), 0),
  COALESCE(SUM(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED'), 0) +
    COALESCE(SUM(p.unrealized_pnl) FILTER (WHERE p.status = 'OPEN'), 0),
  (
    (COALESCE(SUM(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED'), 0) +
     COALESCE(SUM(p.unrealized_pnl) FILTER (WHERE p.status = 'OPEN'), 0)) /
    ss.initial_balance_usd
  ) * 100,
  (SELECT COUNT(*) FROM strategy_trades WHERE strategy_id = ss.strategy_id AND execution_status = 'COMPLETED'),
  COUNT(*) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl > 0),
  COUNT(*) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl < 0),
  (COUNT(*) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl > 0)::numeric /
   NULLIF(COUNT(*) FILTER (WHERE p.status = 'CLOSED'), 0)),
  (SUM(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl > 0) /
   NULLIF(ABS(SUM(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl < 0)), 1)),
  AVG(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl > 0),
  AVG(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl < 0)
FROM strategy_settings ss
LEFT JOIN strategy_positions p ON ss.strategy_id = p.strategy_id
WHERE ss.strategy_id = 'YOUR-STRATEGY-ID'
GROUP BY ss.strategy_id, ss.current_balance_usd, ss.initial_balance_usd;
```

---

## Performance Considerations

### Index Strategy

All indexes have been carefully designed for common query patterns:

**1. Watchlist Queries**
- `idx_watchlist_strategy_status`: Fast filtering by strategy + status
- `idx_watchlist_item`: Quick lookups by item type + ID
- `idx_watchlist_triggered`: Efficient sorting of triggered items
- `idx_watchlist_unique_active`: Prevents duplicate active watchlist items

**2. Position Queries**
- `idx_positions_strategy_status`: Dashboard queries for open/closed positions
- `idx_positions_market`: Find all positions for a market
- `idx_positions_open`: Fast access to open positions (partial index)
- `idx_positions_closed_pnl`: Leaderboard queries

**3. Trade Queries**
- `idx_trades_strategy`: Trade history with time-series
- `idx_trades_position`: All trades for a position
- `idx_trades_status`: Monitor pending/failed trades
- `idx_trades_pending`: Fast access to pending executions

**4. Snapshot Queries**
- `idx_snapshots_strategy_time`: Chart data retrieval
- `idx_snapshots_unique`: Prevent duplicate snapshots

### Query Optimization Tips

**1. Use Partial Indexes**
```sql
-- Already implemented for open positions
CREATE INDEX idx_positions_open
ON strategy_positions(strategy_id, status)
WHERE status = 'OPEN';
```

**2. Leverage JSONB Indexes**
```sql
-- If you frequently query specific JSONB fields
CREATE INDEX idx_positions_metadata_stop_loss
ON strategy_positions((metadata->>'stop_loss'))
WHERE status = 'OPEN' AND metadata->>'stop_loss' IS NOT NULL;
```

**3. Use CTEs for Complex Calculations**
```sql
-- Break down complex queries into readable steps
WITH open_positions AS (
  SELECT * FROM strategy_positions WHERE status = 'OPEN'
),
aggregated AS (
  SELECT strategy_id, SUM(unrealized_pnl) as total_unrealized
  FROM open_positions
  GROUP BY strategy_id
)
SELECT * FROM aggregated;
```

**4. Batch Updates**
```sql
-- Update multiple positions in one query
UPDATE strategy_positions p
SET current_price = u.price, updated_at = NOW()
FROM unnest(ARRAY['pos-1', 'pos-2'], ARRAY[0.55, 0.67]) AS u(id, price)
WHERE p.id = u.id;
```

### Monitoring Slow Queries

```sql
-- Enable query logging in PostgreSQL
-- Then analyze with:
SELECT
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%strategy_positions%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Table Maintenance

```sql
-- Periodically vacuum and analyze
VACUUM ANALYZE strategy_positions;
VACUUM ANALYZE strategy_trades;

-- Reindex if needed
REINDEX TABLE strategy_positions;
```

---

## Security Model

### Row Level Security (RLS)

All tables have RLS enabled with these policies:

**Ownership Check:**
```sql
-- Users can only access their own strategy data
CREATE POLICY "Users can view own positions"
ON strategy_positions FOR SELECT
USING (user_owns_strategy(strategy_id));
```

**Public Access:**
```sql
-- Users can view public strategy data (read-only)
CREATE POLICY "Users can view public positions"
ON strategy_positions FOR SELECT
USING (strategy_is_public(strategy_id));
```

**Full Control:**
```sql
-- Users can INSERT/UPDATE/DELETE their own data
CREATE POLICY "Users can update own positions"
ON strategy_positions FOR UPDATE
USING (user_owns_strategy(strategy_id));
```

### Helper Functions

**user_owns_strategy(strategy_id UUID)**
- Returns true if current user owns the strategy
- Uses `auth.uid()` to check ownership
- Declared `SECURITY DEFINER` for efficiency

**strategy_is_public(strategy_id UUID)**
- Returns true if strategy is marked public
- Allows read-only access to shared strategies

### Data Isolation

- Each user can only see their own strategy data
- Public strategies are read-only for non-owners
- No cross-user data leakage
- Admin users can access all data (future enhancement)

### Sensitive Data Handling

**Webhook URLs:**
- Stored in `strategy_settings.webhook_url`
- Only accessible to strategy owner
- Never exposed in public views

**Trade Execution Details:**
- `order_id` and `transaction_hash` in `strategy_trades`
- Visible to strategy owner only
- Can be used for audit and reconciliation

---

## Integration Guide

### 1. Initial Setup

**Create strategy settings on strategy creation:**
```typescript
async function createStrategy(userId: string, strategyData: any) {
  const { data: strategy } = await supabase
    .from('strategy_definitions')
    .insert({
      user_id: userId,
      name: strategyData.name,
      // ... other fields
    })
    .select()
    .single();

  // Create default settings
  await supabase
    .from('strategy_settings')
    .insert({
      strategy_id: strategy.id,
      initial_balance_usd: 10000,
      current_balance_usd: 10000,
      max_position_size_usd: 500,
      max_positions: 10,
      auto_execute_enabled: false,
      auto_exit_enabled: false,
      stop_loss_percent: 20,
      take_profit_percent: 50,
      risk_per_trade_percent: 2,
    });

  return strategy;
}
```

### 2. Add to Watchlist

**After strategy execution with ADD_TO_WATCHLIST action:**
```typescript
async function addToWatchlist(
  strategyId: string,
  executionId: string,
  items: WatchlistItem[]
) {
  const watchlistEntries = items.map(item => ({
    strategy_id: strategyId,
    execution_id: executionId,
    item_type: item.type, // 'WALLET' | 'MARKET' | 'CATEGORY'
    item_id: item.id,
    item_data: item.data, // Metrics snapshot
    signal_reason: item.reason,
    confidence: item.confidence,
    status: 'WATCHING',
  }));

  const { data, error } = await supabase
    .from('strategy_watchlist_items')
    .insert(watchlistEntries)
    .select();

  return { data, error };
}
```

### 3. Monitor Watchlist & Create Positions

**Cron job to check watchlist and create positions:**
```typescript
async function monitorWatchlist() {
  // Get all watching items
  const { data: items } = await supabase
    .from('strategy_watchlist_items')
    .select(`
      *,
      strategy_definitions!inner(id, user_id),
      strategy_settings!inner(*)
    `)
    .eq('status', 'WATCHING');

  for (const item of items) {
    // Check if trigger condition met
    const shouldTrigger = await evaluateTriggerCondition(item);

    if (shouldTrigger) {
      // Update watchlist item
      await supabase
        .from('strategy_watchlist_items')
        .update({
          status: 'TRIGGERED',
          triggered_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      // Check if auto-execute is enabled
      if (item.strategy_settings.auto_execute_enabled) {
        await createPositionFromWatchlist(item);
      } else {
        // Send notification to user
        await sendNotification(item, 'SIGNAL_GENERATED');
      }
    }
  }
}
```

### 4. Create Position

**Create position and execute entry trade:**
```typescript
async function createPositionFromWatchlist(watchlistItem: any) {
  const settings = watchlistItem.strategy_settings;

  // Calculate position size
  const positionSize = Math.min(
    settings.current_balance_usd * (settings.risk_per_trade_percent / 100),
    settings.max_position_size_usd
  );

  const entryPrice = watchlistItem.item_data.current_price;
  const shares = positionSize / entryPrice;

  // Create position
  const { data: position } = await supabase
    .from('strategy_positions')
    .insert({
      strategy_id: watchlistItem.strategy_id,
      watchlist_item_id: watchlistItem.id,
      market_id: watchlistItem.item_data.market_id,
      market_title: watchlistItem.item_data.market_title,
      outcome: 'YES',
      entry_signal_type: 'WATCHLIST_TRIGGER',
      entry_price: entryPrice,
      entry_shares: shares,
      entry_amount_usd: positionSize,
      current_price: entryPrice,
      current_value_usd: positionSize,
      auto_entered: true,
      metadata: {
        stop_loss: entryPrice * (1 - settings.stop_loss_percent / 100),
        take_profit: entryPrice * (1 + settings.take_profit_percent / 100),
      },
    })
    .select()
    .single();

  // Execute BUY trade
  await executeBuyTrade(position);

  return position;
}
```

### 5. Update Position Prices

**Periodic job to update open position prices:**
```typescript
async function updateOpenPositionPrices() {
  // Get all open positions
  const { data: positions } = await supabase
    .from('strategy_positions')
    .select('id, market_id, entry_shares, entry_amount_usd, fees_paid')
    .eq('status', 'OPEN');

  // Fetch current prices from Polymarket
  const prices = await fetchMarketPrices(
    positions.map(p => p.market_id)
  );

  // Update all positions
  for (const position of positions) {
    const currentPrice = prices[position.market_id];
    const currentValue = position.entry_shares * currentPrice;
    const unrealizedPnl = currentValue - position.entry_amount_usd - position.fees_paid;
    const unrealizedPnlPercent = (unrealizedPnl / position.entry_amount_usd) * 100;

    await supabase
      .from('strategy_positions')
      .update({
        current_price: currentPrice,
        current_value_usd: currentValue,
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_percent: unrealizedPnlPercent,
      })
      .eq('id', position.id);
  }
}
```

### 6. Check Exit Conditions

**Monitor positions for exit signals:**
```typescript
async function checkExitConditions() {
  const { data: positions } = await supabase
    .from('strategy_positions')
    .select(`
      *,
      strategy_settings!inner(*)
    `)
    .eq('status', 'OPEN');

  for (const position of positions) {
    const stopLoss = position.metadata.stop_loss;
    const takeProfit = position.metadata.take_profit;

    let shouldExit = false;
    let exitType = null;

    if (position.current_price <= stopLoss) {
      shouldExit = true;
      exitType = 'STOP_LOSS';
    } else if (position.current_price >= takeProfit) {
      shouldExit = true;
      exitType = 'TAKE_PROFIT';
    }

    if (shouldExit && position.strategy_settings.auto_exit_enabled) {
      await closePosition(position, exitType);
    } else if (shouldExit) {
      // Send notification
      await sendNotification(position, exitType);
    }
  }
}
```

### 7. Close Position

**Execute exit trade and update position:**
```typescript
async function closePosition(
  position: any,
  exitSignalType: string
) {
  const exitPrice = position.current_price;
  const exitValue = position.entry_shares * exitPrice;
  const fees = exitValue * 0.005; // 0.5% fee
  const netExit = exitValue - fees;
  const realizedPnl = netExit - position.entry_amount_usd - position.fees_paid;
  const realizedPnlPercent = (realizedPnl / position.entry_amount_usd) * 100;

  // Create SELL trade
  const { data: trade } = await supabase
    .from('strategy_trades')
    .insert({
      strategy_id: position.strategy_id,
      position_id: position.id,
      trade_type: 'SELL',
      market_id: position.market_id,
      market_title: position.market_title,
      outcome: position.outcome,
      shares: position.entry_shares,
      price: exitPrice,
      amount_usd: exitValue,
      fees: fees,
      execution_status: 'COMPLETED',
      executed_at: new Date().toISOString(),
      pnl: realizedPnl,
    })
    .select()
    .single();

  // Update position to CLOSED
  await supabase
    .from('strategy_positions')
    .update({
      status: 'CLOSED',
      exit_timestamp: new Date().toISOString(),
      exit_price: exitPrice,
      exit_shares: position.entry_shares,
      exit_amount_usd: netExit,
      realized_pnl: realizedPnl,
      realized_pnl_percent: realizedPnlPercent,
      auto_exited: true,
      exit_signal_type: exitSignalType,
    })
    .eq('id', position.id);

  // Update strategy balance
  await supabase
    .from('strategy_settings')
    .update({
      current_balance_usd: supabase.rpc('increment', {
        x: netExit
      }),
    })
    .eq('strategy_id', position.strategy_id);

  return trade;
}
```

### 8. Generate Performance Snapshot

**Daily cron job:**
```typescript
async function generatePerformanceSnapshot(strategyId: string) {
  // Get strategy settings
  const { data: settings } = await supabase
    .from('strategy_settings')
    .select('*')
    .eq('strategy_id', strategyId)
    .single();

  // Get all positions
  const { data: positions } = await supabase
    .from('strategy_positions')
    .select('*')
    .eq('strategy_id', strategyId);

  // Calculate metrics
  const openPositions = positions.filter(p => p.status === 'OPEN');
  const closedPositions = positions.filter(p => p.status === 'CLOSED');

  const totalRealized = closedPositions.reduce((sum, p) => sum + (p.realized_pnl || 0), 0);
  const totalUnrealized = openPositions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);
  const totalPnl = totalRealized + totalUnrealized;

  const wins = closedPositions.filter(p => p.realized_pnl > 0).length;
  const losses = closedPositions.filter(p => p.realized_pnl < 0).length;
  const winRate = losses > 0 ? wins / (wins + losses) : null;

  const totalWins = closedPositions
    .filter(p => p.realized_pnl > 0)
    .reduce((sum, p) => sum + p.realized_pnl, 0);
  const totalLosses = Math.abs(closedPositions
    .filter(p => p.realized_pnl < 0)
    .reduce((sum, p) => sum + p.realized_pnl, 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : null;

  // Insert snapshot
  await supabase
    .from('strategy_performance_snapshots')
    .insert({
      strategy_id: strategyId,
      snapshot_timestamp: new Date().toISOString(),
      portfolio_value_usd: settings.current_balance_usd + openPositions.reduce((sum, p) => sum + (p.current_value_usd || 0), 0),
      cash_balance_usd: settings.current_balance_usd,
      open_positions_count: openPositions.length,
      open_positions_value_usd: openPositions.reduce((sum, p) => sum + (p.current_value_usd || 0), 0),
      total_realized_pnl: totalRealized,
      total_unrealized_pnl: totalUnrealized,
      total_pnl: totalPnl,
      total_roi_percent: (totalPnl / settings.initial_balance_usd) * 100,
      total_trades: positions.length,
      win_count: wins,
      loss_count: losses,
      win_rate: winRate,
      profit_factor: profitFactor,
    });
}
```

---

## Monitoring & Maintenance

### Health Checks

**1. Check for Stale Open Positions**
```sql
-- Positions that haven't been updated in 24 hours
SELECT
  id, market_title, entry_timestamp, updated_at,
  EXTRACT(EPOCH FROM (NOW() - updated_at))/3600 as hours_since_update
FROM strategy_positions
WHERE status = 'OPEN'
  AND updated_at < NOW() - INTERVAL '24 hours'
ORDER BY updated_at ASC;
```

**2. Check for Failed Trades**
```sql
-- Trades that failed or are stuck pending
SELECT
  id, trade_type, market_title, execution_status, error_message, created_at
FROM strategy_trades
WHERE execution_status IN ('FAILED', 'PENDING')
  AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

**3. Monitor Snapshot Generation**
```sql
-- Check if snapshots are being generated regularly
SELECT
  strategy_id,
  MAX(snapshot_timestamp) as last_snapshot,
  EXTRACT(EPOCH FROM (NOW() - MAX(snapshot_timestamp)))/3600 as hours_since_last
FROM strategy_performance_snapshots
GROUP BY strategy_id
HAVING MAX(snapshot_timestamp) < NOW() - INTERVAL '25 hours';
```

### Data Cleanup

**1. Archive Old Snapshots**
```sql
-- Delete snapshots older than 1 year (keep monthly averages)
DELETE FROM strategy_performance_snapshots
WHERE snapshot_timestamp < NOW() - INTERVAL '1 year'
  AND id NOT IN (
    SELECT DISTINCT ON (strategy_id, DATE_TRUNC('month', snapshot_timestamp))
      id
    FROM strategy_performance_snapshots
    ORDER BY strategy_id, DATE_TRUNC('month', snapshot_timestamp), snapshot_timestamp DESC
  );
```

**2. Clean Up Dismissed Watchlist Items**
```sql
-- Delete dismissed items older than 90 days
DELETE FROM strategy_watchlist_items
WHERE status = 'DISMISSED'
  AND updated_at < NOW() - INTERVAL '90 days';
```

### Alerts & Notifications

**1. Large Unrealized Losses**
```sql
-- Alert on positions with > 30% unrealized loss
SELECT
  p.id,
  p.market_title,
  p.unrealized_pnl_percent,
  sd.user_id,
  sd.name as strategy_name
FROM strategy_positions p
JOIN strategy_definitions sd ON p.strategy_id = sd.id
WHERE p.status = 'OPEN'
  AND p.unrealized_pnl_percent < -30
ORDER BY p.unrealized_pnl_percent ASC;
```

**2. High-Value Pending Trades**
```sql
-- Alert on large pending trades
SELECT
  t.id,
  t.trade_type,
  t.market_title,
  t.amount_usd,
  t.created_at,
  sd.user_id
FROM strategy_trades t
JOIN strategy_definitions sd ON t.strategy_id = sd.id
WHERE t.execution_status = 'PENDING'
  AND t.amount_usd > 1000
  AND t.created_at < NOW() - INTERVAL '10 minutes'
ORDER BY t.amount_usd DESC;
```

---

## Summary

This schema provides a complete foundation for automated trading strategies with:

- **Unified watchlist** for multi-type monitoring
- **Position tracking** with real-time P&L
- **Trade logging** for complete audit trail
- **Performance snapshots** for historical analysis
- **Flexible settings** for automation and risk management
- **Strong security** with RLS policies
- **Optimized queries** with strategic indexes

The system is designed to scale from individual users to enterprise-level trading operations while maintaining data integrity, security, and performance.

---

**Next Steps:**

1. Apply migration: `supabase migration up`
2. Create initial strategy settings for existing strategies
3. Build monitoring cron jobs for watchlist and positions
4. Implement trade execution API integration
5. Create dashboard UI components for each table
6. Set up alerts and notifications
7. Monitor performance and optimize queries as needed

For questions or issues, consult the inline comments in the migration file or this documentation.
