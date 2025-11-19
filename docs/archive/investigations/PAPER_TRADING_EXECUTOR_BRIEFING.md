# Paper Trading Executor - Implementation Briefing

## Executive Summary

Build a **paper trading execution engine** that simulates copy trades and calculates returns without risking capital. This allows us to:
- Test copy trading logic end-to-end
- Validate momentum triggers work correctly
- Measure simulated P&L and strategy performance
- Transition seamlessly to live trading (swap executor, keep data model)

**Scope:** Limit orders only, instant simulation fills, TP/SL monitoring
**Timeline:** 3-5 days for MVP
**Phase:** Pre-live trading validation

---

## System Architecture

### High-Level Flow

```
Market Watchlist (ClickHouse)
       ↓
Momentum Trigger (TSI Crossover)
       ↓
Paper Trade Executor (NEW)
       ├─ Place Order (simulated fill)
       ├─ Monitor Position (realtime)
       ├─ Take Profit/Stop Loss
       └─ Exit Trade
       ↓
Copy Trades Table (Supabase)
       ↓
PnL Dashboard & Analytics
```

### Data Model

**Extends existing `copy_trades` table:**
```sql
CREATE TABLE copy_trades (
  id UUID PRIMARY KEY,
  strategy_id UUID,
  source_wallet TEXT,           -- who we're copying from
  market_id TEXT,
  side TEXT,                     -- 'BUY' or 'SELL'

  -- Entry (when signal fires)
  entry_price DECIMAL(10,6),
  entry_shares DECIMAL(20,8),
  entry_usd_amount DECIMAL(20,2),
  entry_timestamp TIMESTAMPTZ,

  -- Exit (when TP/SL/manual)
  exit_price DECIMAL(10,6),
  exit_timestamp TIMESTAMPTZ,
  exit_reason TEXT,              -- 'TP', 'SL', 'MANUAL', 'MOMENTUM_REVERSAL'

  -- P&L
  realized_pnl DECIMAL(20,2),
  realized_pnl_pct DECIMAL(10,4),
  unrealized_pnl DECIMAL(20,2),  -- updated in real-time
  unrealized_pnl_pct DECIMAL(10,4),

  -- Status & Metadata
  status TEXT,                   -- 'open', 'closed', 'pending'
  trade_type TEXT,               -- 'copy_trade', 'signal_trade', 'consensus'
  latency_ms INT,                -- time from signal → fill
  slippage_bps INT,              -- basis points slippage

  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

---

## Paper Trade Executor Component

### 1. Core Classes

#### `PaperTradeExecutor`
```typescript
class PaperTradeExecutor {
  // Place an order (instantly fills in paper trading)
  async placeOrder(params: {
    strategy_id: string
    source_wallet: string
    market_id: string
    condition_id: string
    side: 'BUY' | 'SELL'
    shares: number
    entry_price: number
    bankroll_usd: number
    tp_pct?: number  // default 2%
    sl_pct?: number  // default -1%
  }): Promise<Trade>

  // Monitor all open positions for TP/SL
  async monitorPositions(strategy_id: string): Promise<void>

  // Close a position
  async closePosition(trade_id: string, exit_price: number, reason: string): Promise<Trade>

  // Get strategy P&L summary
  async getStrategyPnL(strategy_id: string): Promise<StrategyMetrics>

  // Calculate unrealized P&L for open positions
  async updateUnrealizedPnL(strategy_id: string): Promise<void>
}
```

#### `PriceSimulator`
```typescript
class PriceSimulator {
  // Get current market price (from RTDS or API)
  async getCurrentPrice(market_id: string): Promise<{
    yes_price: number
    no_price: number
    timestamp: Date
  }>

  // Simulate slippage (bid/ask spread impact)
  getSlippageAdjustedPrice(
    side: 'BUY' | 'SELL',
    base_price: number,
    spread_bps: number = 20  // 20 basis points default
  ): number
}
```

#### `PositionLifecycleManager`
```typescript
class PositionLifecycleManager {
  // Track position from entry → exit
  async openPosition(order: PlaceOrderParams): Promise<Trade>

  async updatePosition(trade_id: string, current_price: number): Promise<Trade>

  async closePosition(trade_id: string, exit_price: number, reason: string): Promise<Trade>

  // Batch process: check all open positions for TP/SL
  async processTPSL(strategy_id: string): Promise<ClosedTrade[]>
}
```

---

## Execution Flow

### 1. Order Placement Flow

```
Signal (Momentum Trigger)
  ↓
{market_id, side, confidence_score}
  ↓
PaperTradeExecutor.placeOrder({
  strategy_id
  market_id
  side: 'BUY'
  shares: 100
  entry_price: 0.65
  tp_pct: 2.0
  sl_pct: -1.0
})
  ↓
1. Get current price (RTDS or API)
2. Create Trade record (status='pending')
3. Instantly "fill" (status='open')
4. Calculate: usd_value = shares * entry_price
5. Set TP/SL targets
6. Start monitoring
  ↓
INSERT INTO copy_trades (...)
  ↓
Return Trade object
```

### 2. Position Monitoring Loop

**Runs every 10 seconds (or configurable interval):**

```
For each open position in strategy:
  1. Get current market price
  2. Calculate unrealized P&L
  3. Check if TP triggered (unrealized_pnl_pct >= 2%)
  4. Check if SL triggered (unrealized_pnl_pct <= -1%)
  5. If triggered → closePosition()
  6. Update copy_trades table with unrealized_pnl
```

### 3. Position Exit Flow

```
TP/SL Trigger or Manual Close
  ↓
PaperTradeExecutor.closePosition({
  trade_id
  exit_price: 0.663
  reason: 'TP' | 'SL' | 'MANUAL' | 'MOMENTUM_REVERSAL'
})
  ↓
1. Calculate realized_pnl = (exit_price - entry_price) * shares
2. Calculate realized_pnl_pct = (realized_pnl / entry_usd) * 100
3. Calculate latency = exit_time - entry_time
4. Set status='closed'
5. Update copy_trades
  ↓
Return closed Trade object
```

---

## Integration Points

### 1. Momentum Trigger System

**Location:** `/lib/strategy/momentum-trigger.ts` (to be created)

When TSI crossover detected:
```typescript
// Pseudo-code
if (tsiCrossover === 'BULLISH') {
  const trade = await executor.placeOrder({
    strategy_id: strategy.id,
    market_id: signal.market_id,
    condition_id: signal.condition_id,
    side: 'BUY',
    shares: calculateShares(bankroll, riskPercent),
    entry_price: currentPrice.yes_price,
    tp_pct: strategy.tp_percent,
    sl_pct: strategy.sl_percent
  });

  watchlist.push(trade);
}
```

### 2. API Endpoints

**New endpoints needed:**

```
POST /api/strategies/{strategyId}/paper-trade
  - Manually place a paper trade

GET /api/strategies/{strategyId}/paper-trades
  - List all paper trades (open + closed)

GET /api/strategies/{strategyId}/paper-pnl
  - Get aggregated P&L metrics

PUT /api/strategies/{strategyId}/paper-trades/{tradeId}/close
  - Manually close a position

GET /api/strategies/{strategyId}/paper-trades/{tradeId}
  - Get detailed trade info
```

### 3. Dashboard Integration

**Update Copy Trading Section:**
- Show open positions with real-time P&L
- Show closed trades with realized P&L
- Performance chart (cumulative returns over time)
- Win rate, avg win/loss, max drawdown

---

## Configuration

### Strategy Settings (in orchestrator node)

```typescript
interface CopyTradingConfig {
  trading_mode: 'PAPER' | 'LIVE'  // Start with PAPER

  tp_percent: number              // Take profit target (default: 2.0)
  sl_percent: number              // Stop loss target (default: -1.0)

  entry_type: 'BID' | 'MID' | 'ASK'  // Which price to use
  exit_type: 'BID' | 'MID' | 'ASK'   // Which price to use

  position_size_method: 'FIXED' | 'PCT_BANKROLL'
  position_size: number           // $ or %

  bankroll_usd: number            // Starting capital (paper trading)

  max_open_positions: number      // Risk management
  max_drawdown_pct: number        // Kill switch

  auto_monitoring: boolean        // Auto TP/SL check
  monitoring_interval_seconds: number
}
```

---

## Paper Trading Features

### 1. Instant Fills
- No queue or partial fills in paper trading
- Order fills immediately at specified price
- Useful for rapid testing

### 2. Slippage Simulation
- Optional: add spread (default 20 bps for YES/NO pair)
- Models realistic entry/exit costs
- Can be disabled for "perfect execution" testing

### 3. TP/SL Automation
- Monitors all open positions
- Closes when threshold reached
- Records reason (TP, SL, MANUAL)

### 4. Multi-Position Tracking
- Multiple trades open simultaneously
- Portfolio-level P&L calculation
- Drawdown monitoring

---

## Database Changes

### New Table: `paper_trading_config`
```sql
CREATE TABLE paper_trading_config (
  id UUID PRIMARY KEY,
  strategy_id UUID REFERENCES strategy_definitions(strategy_id),

  trading_mode TEXT DEFAULT 'PAPER',
  tp_percent DECIMAL(10,2) DEFAULT 2.0,
  sl_percent DECIMAL(10,2) DEFAULT -1.0,

  entry_type TEXT DEFAULT 'MID',
  exit_type TEXT DEFAULT 'MID',

  position_size_method TEXT,
  position_size DECIMAL(20,2),
  bankroll_usd DECIMAL(20,2),

  auto_monitoring BOOLEAN DEFAULT true,
  monitoring_interval_seconds INT DEFAULT 10,

  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### Update: `copy_trades` (existing table extensions)
- Add `exit_reason` TEXT column
- Add `slippage_bps` INT column
- Add `latency_ms` INT column
- Add `unrealized_pnl_pct` DECIMAL
- Ensure indexes on: strategy_id, status, created_at

---

## Implementation Timeline

### Phase 1: Core Executor (Days 1-2)
- [ ] PaperTradeExecutor class
- [ ] PriceSimulator
- [ ] PositionLifecycleManager
- [ ] Basic order placement & closing
- [ ] P&L calculation

### Phase 2: Integration (Days 2-3)
- [ ] Momentum trigger integration
- [ ] API endpoints
- [ ] Background monitoring loop
- [ ] Database schema updates

### Phase 3: UI & Testing (Days 3-5)
- [ ] Dashboard updates
- [ ] Manual trade placement UI
- [ ] Test with real momentum signals
- [ ] Verify P&L calculations

### Phase 4: Live Trading Prep (Days 5+)
- [ ] Research Polymarket order API
- [ ] Build LiveTradeExecutor (swap paper executor)
- [ ] Wallet signing integration
- [ ] Safety guards & limits

---

## Transition to Live Trading

### Key Principle: Identical Data Model

Paper executor and live executor share same interface:

```typescript
interface ITradeExecutor {
  placeOrder(params): Promise<Trade>
  closePosition(trade_id, exit_price, reason): Promise<Trade>
  getOpenPositions(strategy_id): Promise<Trade[]>
  updateUnrealizedPnL(strategy_id): Promise<void>
}

// Paper implementation
class PaperTradeExecutor implements ITradeExecutor { ... }

// Live implementation (to be built)
class LiveTradeExecutor implements ITradeExecutor { ... }

// In strategy executor
const executor = config.trading_mode === 'PAPER'
  ? new PaperTradeExecutor()
  : new LiveTradeExecutor();
```

**To go live:**
1. Build `LiveTradeExecutor` (uses Polymarket API)
2. Switch `trading_mode` from PAPER → LIVE
3. Same `copy_trades` table, same P&L calculations
4. No UI changes needed

---

## Testing Strategy

### Unit Tests
- P&L calculations (entry/exit scenarios)
- Slippage simulation
- TP/SL triggering logic
- Position lifecycle

### Integration Tests
- End-to-end: Signal → Place → Monitor → Close
- Multiple open positions
- Concurrent trades

### Manual Tests
- Run with real momentum signals for 24 hours
- Verify dashboard matches calculations
- Compare simulated returns vs. expected outcomes

---

## Success Criteria

✅ Paper trades execute with zero slippage (configurable)
✅ P&L calculations match manual verification
✅ TP/SL triggers accurately
✅ Dashboard shows real-time position metrics
✅ Can run 100+ simultaneous simulations
✅ Easy to switch to live mode

---

## Open Questions / Future Enhancements

1. **Slippage model:** Should we model deeper than 20 bps?
2. **Partial fills:** Add to paper trading for realism?
3. **Market hours:** Should we skip non-trading hours?
4. **Competition modeling:** Simulate other bots competing for fills?
5. **Seed capital management:** Should we allow drawdown limits to trigger safety shutoff?

---

## Dependencies

**External:**
- Polymarket RTDS (WebSocket) for real-time prices
- Supabase for data persistence
- ClickHouse for analytics queries

**Internal:**
- `vw_trades_canonical` (for historical analysis)
- `TSI calculator` (for momentum signals)
- Strategy execution engine (for flow control)

---

## References

- Moon Dev Polymarket Agent: Uses limit orders only, bid/ask pricing, TP/SL monitoring
- Extended Exchange Bot: P&L monitoring with configurable TP/SL thresholds
- Cascadian Strategy Builder: Node-based configuration system

