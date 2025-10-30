# Dashboard Real Data Integration - Fixed

**Date**: 2025-10-29
**Status**: ✅ COMPLETE

---

## Summary

Fixed dashboard API routes to query **real paper trading data** from the database instead of referencing non-existent tables. The dashboard now displays actual strategy performance from the `paper_trades` and `paper_portfolios` tables.

---

## Issues Found

### 1. Trades API Route - Wrong Table
**File**: `/app/api/strategies/[id]/trades/route.ts`
**Problem**: Querying from `strategy_trades` table which doesn't exist
**Solution**: Updated to query from `paper_trades` table

### 2. Positions API Route - Wrong Table
**File**: `/app/api/strategies/[id]/positions/route.ts`
**Problem**: Querying from `strategy_positions` table which doesn't exist
**Solution**: Updated to query from `paper_trades` table (positions are trades with status='open')

---

## Changes Made

### 1. Updated `/app/api/strategies/[id]/trades/route.ts`

**Before**:
```typescript
const { data, error } = await supabase
  .from('strategy_trades')  // ❌ Table doesn't exist
  .select('*')
  .eq('strategy_id', id)
  .order('executed_at', { ascending: false })
  .limit(100);
```

**After**:
```typescript
// Query from paper_trades table (paper trading system)
const { data, error } = await supabase
  .from('paper_trades')  // ✅ Correct table
  .select('*')
  .eq('strategy_id', id)
  .order('created_at', { ascending: false })
  .limit(100);

// Transform to expected format
const trades = (data || []).map((trade: any) => ({
  id: trade.trade_id,
  strategy_id: trade.strategy_id,
  market_id: trade.market_id,
  market_question: trade.market_question,
  side: trade.side,
  action: trade.action,
  entry_price: trade.entry_price,
  entry_shares: trade.entry_shares,
  entry_notional_usd: trade.entry_notional_usd,
  exit_price: trade.exit_price,
  realized_pnl_usd: trade.realized_pnl_usd,
  unrealized_pnl_usd: trade.unrealized_pnl_usd,
  status: trade.status,
  executed_at: trade.entry_date,
  created_at: trade.created_at,
}));
```

### 2. Updated `/app/api/strategies/[id]/positions/route.ts`

**Before (GET)**:
```typescript
const { data, error } = await supabase
  .from('strategy_positions')  // ❌ Table doesn't exist
  .select('*')
  .eq('strategy_id', id)
  .or('status.eq.OPEN,status.eq.CLOSED')
  .order('entry_timestamp', { ascending: false })
  .limit(100);
```

**After (GET)**:
```typescript
// Get open and recently closed positions from paper_trades
const { data, error } = await supabase
  .from('paper_trades')  // ✅ Correct table
  .select('*')
  .eq('strategy_id', id)
  .in('status', ['open', 'closed'])
  .order('entry_date', { ascending: false })
  .limit(100);

// Separate open and closed
const open = (data || []).filter(p => p.status === 'open');
const closed = (data || []).filter(p => p.status === 'closed');
```

**Before (POST)**:
```typescript
const { data: position, error } = await supabase
  .from('strategy_positions')  // ❌ Table doesn't exist
  .insert({
    strategy_id: id,
    market_id,
    market_title,
    // ...
    status: 'OPEN',
  })
  .select()
  .single();
```

**After (POST)**:
```typescript
// Create paper trade (paper trading system)
const { data: position, error } = await supabase
  .from('paper_trades')  // ✅ Correct table
  .insert({
    strategy_id: id,
    market_id,
    market_question: market_title,
    side: outcome, // 'YES' or 'NO'
    action: 'BUY',
    entry_price,
    entry_shares,
    entry_notional_usd: entry_price * entry_shares,
    entry_date: new Date().toISOString(),
    status: 'open',
  })
  .select()
  .single();
```

---

## Correct Database Schema

### Paper Trading Tables

**`paper_trades`** - All trades executed in paper trading mode
```sql
- trade_id (UUID, PK)
- strategy_id (UUID, FK)
- market_id (TEXT)
- market_question (TEXT)
- side (TEXT: 'YES' | 'NO')
- action (TEXT: 'BUY' | 'SELL' | 'CLOSE')
- entry_price (NUMERIC)
- entry_shares (NUMERIC)
- entry_notional_usd (NUMERIC)
- exit_price (NUMERIC, nullable)
- realized_pnl_usd (NUMERIC)
- unrealized_pnl_usd (NUMERIC)
- status (TEXT: 'open' | 'closed' | 'expired')
- entry_date (TIMESTAMPTZ)
- created_at (TIMESTAMPTZ)
```

**`paper_portfolios`** - Portfolio state for each strategy
```sql
- portfolio_id (UUID, PK)
- strategy_id (UUID, FK)
- initial_bankroll_usd (NUMERIC)
- current_bankroll_usd (NUMERIC)
- total_pnl_usd (NUMERIC)
- open_positions_count (INTEGER)
- total_trades_count (INTEGER)
- winning_trades_count (INTEGER)
- losing_trades_count (INTEGER)
- win_rate (NUMERIC)
- created_at (TIMESTAMPTZ)
```

**`strategy_definitions`** - Strategy configuration
```sql
- strategy_id (UUID, PK)
- strategy_name (TEXT)
- trading_mode (TEXT: 'paper' | 'live')
- paper_bankroll_usd (NUMERIC)
- paper_pnl_usd (NUMERIC)
- is_active (BOOLEAN)
- node_graph (JSONB)
- created_at (TIMESTAMPTZ)
```

---

## API Endpoints Fixed

### ✅ `/api/strategies/[id]/trades` (GET)
- **Before**: Queried non-existent `strategy_trades` table
- **After**: Queries `paper_trades` table
- **Returns**: Array of trades with proper transformation

### ✅ `/api/strategies/[id]/positions` (GET)
- **Before**: Queried non-existent `strategy_positions` table
- **After**: Queries `paper_trades` filtered by status
- **Returns**: `{ open: [], closed: [] }`

### ✅ `/api/strategies/[id]/positions` (POST)
- **Before**: Inserted into non-existent `strategy_positions` table
- **After**: Inserts into `paper_trades` table
- **Returns**: Created paper trade record

### ✅ `/api/strategies/[id]/performance` (GET)
- **Status**: Already correctly querying `paper_trades` and `paper_portfolios`
- **No changes needed**

---

## Dashboard Data Flow

```
User Views Dashboard
    ↓
useStrategyDashboard hook
    ↓
Fetches from API endpoints:
├── /api/strategies/[id]           → strategy_definitions ✅
├── /api/strategies/[id]/trades    → paper_trades ✅ (FIXED)
├── /api/strategies/[id]/positions → paper_trades ✅ (FIXED)
├── /api/strategies/[id]/performance → paper_portfolios ✅
└── /api/strategies/[id]/watchlist → strategy_watchlist ✅
    ↓
Transforms data to StrategyData type
    ↓
Dashboard displays REAL trading data
```

---

## Verification

### How to Test

1. **Deploy a strategy** (already done - Smart Money with $100)
2. **Let it execute** (wait for cron or trigger manually)
3. **View dashboard** at `/strategies/[strategy_id]`
4. **Check API responses**:
```bash
# Check trades
curl http://localhost:3000/api/strategies/6378f27c-9065-4132-97c5-def5c59a0510/trades

# Check positions
curl http://localhost:3000/api/strategies/6378f27c-9065-4132-97c5-def5c59a0510/positions

# Check performance
curl http://localhost:3000/api/strategies/6378f27c-9065-4132-97c5-def5c59a0510/performance
```

### Expected Results

**When strategy has NOT executed yet:**
- Trades: `[]` (empty array)
- Positions: `{ open: [], closed: [] }`
- Performance: Default values with $100 bankroll

**When strategy HAS executed:**
- Trades: Array of paper trades from `paper_trades` table
- Positions: Open trades shown as positions
- Performance: Calculated P&L, win rate, trade counts

---

## Mock Data Status

**`/components/strategy-dashboard/mock-data.ts`**:
- **Status**: Still exists but NOT USED in production
- **Purpose**: Reference/testing only
- **Dashboard**: Uses REAL data from API endpoints

The mock data file can be kept for:
- Development testing
- Component stories/tests
- Reference for data structure

**Dashboard is 100% connected to real database now!** ✅

---

## Summary

| Component | Before | After | Status |
|-----------|--------|-------|--------|
| **Trades API** | ❌ `strategy_trades` | ✅ `paper_trades` | FIXED |
| **Positions API (GET)** | ❌ `strategy_positions` | ✅ `paper_trades` | FIXED |
| **Positions API (POST)** | ❌ `strategy_positions` | ✅ `paper_trades` | FIXED |
| **Performance API** | ✅ `paper_portfolios` | ✅ `paper_portfolios` | OK |
| **Strategy API** | ✅ `strategy_definitions` | ✅ `strategy_definitions` | OK |
| **Dashboard Hook** | ✅ Fetches real data | ✅ Fetches real data | OK |

---

## Next Steps

1. **✅ Deploy Smart Money strategy** - DONE ($100 paper balance)
2. **⏰ Wait for execution** - Strategy runs every 6 hours
3. **🎉 View real data in dashboard** - When trades are placed
4. **📊 Monitor P&L tracking** - Real-time updates

The dashboard will now show:
- Real paper trades when strategy executes
- Actual P&L from paper trading
- True win rate and statistics
- Live portfolio balance updates

**No more mock data!** The dashboard displays genuine strategy performance from the database. 🚀
