-- =====================================================
-- STRATEGY POSITION TRACKING & AUTOMATED TRADING SYSTEM
-- =====================================================
-- Purpose: Complete database schema for strategy execution, position tracking,
--          trade logging, and performance monitoring
-- Author: Database Architect
-- Created: 2025-10-25
-- =====================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- ENUMS
-- =====================================================

-- Watchlist item types
CREATE TYPE watchlist_item_type AS ENUM (
  'WALLET',
  'MARKET',
  'CATEGORY'
);

-- Watchlist item status
CREATE TYPE watchlist_status AS ENUM (
  'WATCHING',    -- Actively monitoring
  'TRIGGERED',   -- Signal fired, position may be created
  'DISMISSED',   -- Manually dismissed by user
  'EXPIRED'      -- Time-based expiration
);

-- Confidence levels for signals
CREATE TYPE signal_confidence AS ENUM (
  'HIGH',
  'MEDIUM',
  'LOW'
);

-- Position status
CREATE TYPE position_status AS ENUM (
  'OPEN',        -- Active position
  'CLOSED',      -- Fully closed
  'PARTIAL',     -- Partially closed
  'CANCELLED'    -- Cancelled before execution
);

-- Trade outcome side
CREATE TYPE trade_outcome AS ENUM (
  'YES',
  'NO'
);

-- Trade type
CREATE TYPE trade_type AS ENUM (
  'BUY',
  'SELL'
);

-- Trade execution status
CREATE TYPE execution_status AS ENUM (
  'PENDING',     -- Order placed, not yet filled
  'COMPLETED',   -- Successfully executed
  'FAILED',      -- Execution failed
  'CANCELLED'    -- Order cancelled
);

-- =====================================================
-- TABLE 1: STRATEGY_WATCHLIST_ITEMS
-- =====================================================
-- Unified watchlist for wallets, markets, and categories
-- flagged by strategy signals for monitoring
-- =====================================================

CREATE TABLE strategy_watchlist_items (
  -- Primary identification
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Strategy relationships
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,
  execution_id UUID REFERENCES strategy_executions(execution_id) ON DELETE SET NULL,

  -- Item being watched
  item_type watchlist_item_type NOT NULL,
  item_id TEXT NOT NULL, -- wallet_address, market_id, or category_name
  item_data JSONB DEFAULT '{}'::jsonb, -- Cached metrics, market info, etc.

  -- Signal metadata
  signal_reason TEXT, -- Why was this flagged? e.g., "omega_ratio > 2.0 AND win_rate > 0.65"
  confidence signal_confidence DEFAULT 'MEDIUM',

  -- Status tracking
  status watchlist_status DEFAULT 'WATCHING',
  triggered_at TIMESTAMPTZ, -- When signal fired (status = TRIGGERED)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comments for documentation
COMMENT ON TABLE strategy_watchlist_items IS
  'Unified watchlist tracking wallets, markets, and categories flagged by strategy signals';
COMMENT ON COLUMN strategy_watchlist_items.item_type IS
  'Type of item: WALLET, MARKET, or CATEGORY';
COMMENT ON COLUMN strategy_watchlist_items.item_data IS
  'Cached data snapshot at time of addition (metrics, prices, etc.)';
COMMENT ON COLUMN strategy_watchlist_items.signal_reason IS
  'Human-readable explanation of why this item was flagged';
COMMENT ON COLUMN strategy_watchlist_items.confidence IS
  'Signal confidence level from strategy evaluation';

-- Indexes for performance
CREATE INDEX idx_watchlist_strategy_status
  ON strategy_watchlist_items(strategy_id, status);

CREATE INDEX idx_watchlist_item
  ON strategy_watchlist_items(item_type, item_id);

CREATE INDEX idx_watchlist_triggered
  ON strategy_watchlist_items(triggered_at DESC)
  WHERE status = 'TRIGGERED';

CREATE INDEX idx_watchlist_execution
  ON strategy_watchlist_items(execution_id)
  WHERE execution_id IS NOT NULL;

CREATE INDEX idx_watchlist_created
  ON strategy_watchlist_items(strategy_id, created_at DESC);

-- Unique constraint: one item per strategy (can re-add if dismissed)
CREATE UNIQUE INDEX idx_watchlist_unique_active
  ON strategy_watchlist_items(strategy_id, item_type, item_id)
  WHERE status IN ('WATCHING', 'TRIGGERED');

-- =====================================================
-- TABLE 2: STRATEGY_POSITIONS
-- =====================================================
-- Active and historical positions created by strategy signals
-- Tracks entry, current value, and exit for each position
-- =====================================================

CREATE TABLE strategy_positions (
  -- Primary identification
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Strategy relationships
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,
  watchlist_item_id UUID REFERENCES strategy_watchlist_items(id) ON DELETE SET NULL,

  -- Market information
  market_id TEXT NOT NULL,
  market_slug TEXT,
  market_title TEXT NOT NULL,
  condition_id TEXT, -- Specific outcome condition ID
  outcome trade_outcome NOT NULL,
  category TEXT,

  -- Entry details
  entry_signal_type TEXT, -- e.g., 'HIGH_OMEGA_WALLET', 'SII_THRESHOLD', 'MOMENTUM_BREAKOUT'
  entry_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entry_price NUMERIC(10,4) NOT NULL CHECK (entry_price >= 0 AND entry_price <= 1),
  entry_shares NUMERIC(20,8) NOT NULL CHECK (entry_shares > 0),
  entry_amount_usd NUMERIC(20,2) NOT NULL CHECK (entry_amount_usd > 0),

  -- Current state (for open positions)
  current_price NUMERIC(10,4) CHECK (current_price >= 0 AND current_price <= 1),
  current_value_usd NUMERIC(20,2),
  unrealized_pnl NUMERIC(20,2),
  unrealized_pnl_percent NUMERIC(10,4),

  -- Exit details (for closed positions)
  exit_timestamp TIMESTAMPTZ,
  exit_price NUMERIC(10,4) CHECK (exit_price >= 0 AND exit_price <= 1),
  exit_shares NUMERIC(20,8) CHECK (exit_shares > 0),
  exit_amount_usd NUMERIC(20,2) CHECK (exit_amount_usd >= 0),
  realized_pnl NUMERIC(20,2),
  realized_pnl_percent NUMERIC(10,4),

  -- Costs and fees
  fees_paid NUMERIC(20,2) DEFAULT 0 CHECK (fees_paid >= 0),

  -- Status and automation
  status position_status DEFAULT 'OPEN',
  auto_entered BOOLEAN DEFAULT false, -- Automatically entered by strategy
  auto_exited BOOLEAN DEFAULT false, -- Automatically exited by strategy
  exit_signal_type TEXT, -- e.g., 'TAKE_PROFIT', 'STOP_LOSS', 'SIGNAL_REVERSAL', 'MANUAL'

  -- Additional metadata
  metadata JSONB DEFAULT '{}'::jsonb, -- Stop loss/take profit levels, notes, etc.

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comments for documentation
COMMENT ON TABLE strategy_positions IS
  'Position tracking for all strategy-created trades with entry, current, and exit data';
COMMENT ON COLUMN strategy_positions.watchlist_item_id IS
  'References the watchlist item that triggered this position (may be null for manual entries)';
COMMENT ON COLUMN strategy_positions.entry_signal_type IS
  'Type of signal that triggered position entry';
COMMENT ON COLUMN strategy_positions.current_price IS
  'Latest price, updated periodically for open positions';
COMMENT ON COLUMN strategy_positions.unrealized_pnl IS
  'Calculated as (current_value_usd - entry_amount_usd - fees_paid)';
COMMENT ON COLUMN strategy_positions.realized_pnl IS
  'Final P&L after position close: (exit_amount_usd - entry_amount_usd - fees_paid)';
COMMENT ON COLUMN strategy_positions.metadata IS
  'Flexible storage for stop loss, take profit, trailing stops, notes, etc.';

-- Indexes for performance
CREATE INDEX idx_positions_strategy_status
  ON strategy_positions(strategy_id, status);

CREATE INDEX idx_positions_market
  ON strategy_positions(market_id);

CREATE INDEX idx_positions_entry
  ON strategy_positions(entry_timestamp DESC);

CREATE INDEX idx_positions_open
  ON strategy_positions(strategy_id, status)
  WHERE status = 'OPEN';

CREATE INDEX idx_positions_watchlist
  ON strategy_positions(watchlist_item_id)
  WHERE watchlist_item_id IS NOT NULL;

CREATE INDEX idx_positions_closed_pnl
  ON strategy_positions(strategy_id, realized_pnl DESC)
  WHERE status = 'CLOSED';

CREATE INDEX idx_positions_category
  ON strategy_positions(strategy_id, category)
  WHERE category IS NOT NULL;

-- =====================================================
-- TABLE 3: STRATEGY_TRADES
-- =====================================================
-- Execution log of all buy/sell orders
-- Each position may have multiple trades (entry, partial exits, full exit)
-- =====================================================

CREATE TABLE strategy_trades (
  -- Primary identification
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Relationships
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,
  position_id UUID REFERENCES strategy_positions(id) ON DELETE SET NULL,

  -- Trade details
  trade_type trade_type NOT NULL,
  market_id TEXT NOT NULL,
  market_title TEXT,
  outcome trade_outcome NOT NULL,

  -- Execution details
  shares NUMERIC(20,8) NOT NULL CHECK (shares > 0),
  price NUMERIC(10,4) NOT NULL CHECK (price >= 0 AND price <= 1),
  amount_usd NUMERIC(20,2) NOT NULL CHECK (amount_usd > 0),
  fees NUMERIC(20,2) DEFAULT 0 CHECK (fees >= 0),

  -- Status and timing
  execution_status execution_status DEFAULT 'PENDING',
  error_message TEXT, -- If execution failed
  executed_at TIMESTAMPTZ,

  -- External references
  order_id TEXT, -- Polymarket order ID
  transaction_hash TEXT, -- Blockchain transaction hash

  -- P&L tracking (for SELL trades)
  pnl NUMERIC(20,2), -- Realized P&L for this specific trade

  -- Additional data
  metadata JSONB DEFAULT '{}'::jsonb, -- Raw API response, execution details, slippage, etc.

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comments for documentation
COMMENT ON TABLE strategy_trades IS
  'Complete execution log of all buy and sell orders for strategy positions';
COMMENT ON COLUMN strategy_trades.position_id IS
  'Links trade to a position; null for standalone trades';
COMMENT ON COLUMN strategy_trades.pnl IS
  'For SELL trades, the realized P&L: (shares * price) - cost_basis - fees';
COMMENT ON COLUMN strategy_trades.order_id IS
  'External order ID from Polymarket or other trading venue';
COMMENT ON COLUMN strategy_trades.transaction_hash IS
  'Blockchain transaction hash for on-chain trades';
COMMENT ON COLUMN strategy_trades.metadata IS
  'Raw API responses, slippage data, execution context, etc.';

-- Indexes for performance
CREATE INDEX idx_trades_strategy
  ON strategy_trades(strategy_id, executed_at DESC NULLS LAST);

CREATE INDEX idx_trades_position
  ON strategy_trades(position_id)
  WHERE position_id IS NOT NULL;

CREATE INDEX idx_trades_status
  ON strategy_trades(execution_status, created_at DESC);

CREATE INDEX idx_trades_market
  ON strategy_trades(market_id, executed_at DESC NULLS LAST);

CREATE INDEX idx_trades_pending
  ON strategy_trades(created_at DESC)
  WHERE execution_status = 'PENDING';

CREATE INDEX idx_trades_type
  ON strategy_trades(strategy_id, trade_type, executed_at DESC NULLS LAST);

-- =====================================================
-- TABLE 4: STRATEGY_PERFORMANCE_SNAPSHOTS
-- =====================================================
-- Time-series performance data for charting and analysis
-- Captured periodically (hourly, daily) or on-demand
-- =====================================================

CREATE TABLE strategy_performance_snapshots (
  -- Primary identification
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Strategy relationship
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,

  -- Snapshot timing
  snapshot_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Portfolio state
  portfolio_value_usd NUMERIC(20,2) NOT NULL, -- cash + open position values
  cash_balance_usd NUMERIC(20,2) NOT NULL,
  open_positions_count INTEGER DEFAULT 0 CHECK (open_positions_count >= 0),
  open_positions_value_usd NUMERIC(20,2) DEFAULT 0,

  -- P&L metrics
  total_realized_pnl NUMERIC(20,2) DEFAULT 0,
  total_unrealized_pnl NUMERIC(20,2) DEFAULT 0,
  total_pnl NUMERIC(20,2) DEFAULT 0, -- realized + unrealized
  total_roi_percent NUMERIC(10,4), -- (total_pnl / initial_balance) * 100

  -- Trading statistics
  total_trades INTEGER DEFAULT 0 CHECK (total_trades >= 0),
  win_count INTEGER DEFAULT 0 CHECK (win_count >= 0),
  loss_count INTEGER DEFAULT 0 CHECK (loss_count >= 0),
  win_rate NUMERIC(10,4), -- win_count / (win_count + loss_count)
  profit_factor NUMERIC(10,4), -- total_wins / total_losses (if losses > 0)
  avg_win NUMERIC(20,2),
  avg_loss NUMERIC(20,2),

  -- Risk metrics
  max_drawdown_percent NUMERIC(10,4),
  sharpe_ratio NUMERIC(10,4),

  -- Additional metrics
  metadata JSONB DEFAULT '{}'::jsonb, -- Daily volume, volatility, beta, etc.

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comments for documentation
COMMENT ON TABLE strategy_performance_snapshots IS
  'Time-series snapshots of strategy performance for historical charting and analysis';
COMMENT ON COLUMN strategy_performance_snapshots.portfolio_value_usd IS
  'Total portfolio value: cash_balance + sum(open_position_values)';
COMMENT ON COLUMN strategy_performance_snapshots.total_pnl IS
  'Total P&L: realized_pnl + unrealized_pnl';
COMMENT ON COLUMN strategy_performance_snapshots.win_rate IS
  'Percentage of winning trades: win_count / total_closed_trades';
COMMENT ON COLUMN strategy_performance_snapshots.profit_factor IS
  'Ratio of gross profits to gross losses (> 1.0 is profitable)';
COMMENT ON COLUMN strategy_performance_snapshots.max_drawdown_percent IS
  'Maximum peak-to-trough decline in portfolio value';

-- Indexes for performance
CREATE INDEX idx_snapshots_strategy_time
  ON strategy_performance_snapshots(strategy_id, snapshot_timestamp DESC);

CREATE INDEX idx_snapshots_timestamp
  ON strategy_performance_snapshots(snapshot_timestamp DESC);

-- Unique constraint: one snapshot per strategy per timestamp
CREATE UNIQUE INDEX idx_snapshots_unique
  ON strategy_performance_snapshots(strategy_id, snapshot_timestamp);

-- =====================================================
-- TABLE 5: STRATEGY_SETTINGS
-- =====================================================
-- Per-strategy configuration for automated execution and risk management
-- One row per strategy
-- =====================================================

CREATE TABLE strategy_settings (
  -- Primary identification (one-to-one with strategy_definitions)
  strategy_id UUID PRIMARY KEY REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,

  -- Capital management
  initial_balance_usd NUMERIC(20,2) NOT NULL DEFAULT 10000 CHECK (initial_balance_usd > 0),
  current_balance_usd NUMERIC(20,2) NOT NULL DEFAULT 10000 CHECK (current_balance_usd >= 0),
  max_position_size_usd NUMERIC(20,2) CHECK (max_position_size_usd > 0), -- Per-position limit
  max_positions INTEGER DEFAULT 10 CHECK (max_positions > 0), -- Concurrent position limit

  -- Automation settings
  auto_execute_enabled BOOLEAN DEFAULT false, -- Auto-enter positions on signals
  auto_exit_enabled BOOLEAN DEFAULT false, -- Auto-close on exit signals

  -- Risk management defaults
  stop_loss_percent NUMERIC(10,4) CHECK (stop_loss_percent >= 0 AND stop_loss_percent <= 100),
  take_profit_percent NUMERIC(10,4) CHECK (take_profit_percent >= 0),
  risk_per_trade_percent NUMERIC(10,4) DEFAULT 2.0 CHECK (risk_per_trade_percent >= 0 AND risk_per_trade_percent <= 100),

  -- Trading restrictions
  trading_hours JSONB DEFAULT '{
    "enabled": false,
    "timezone": "America/New_York",
    "start_hour": 9,
    "end_hour": 17,
    "days": ["MON", "TUE", "WED", "THU", "FRI"]
  }'::jsonb,

  -- Notifications
  notifications_enabled BOOLEAN DEFAULT true,
  webhook_url TEXT, -- For external notifications (Slack, Discord, etc.)
  notification_events JSONB DEFAULT '{
    "position_opened": true,
    "position_closed": true,
    "stop_loss_hit": true,
    "take_profit_hit": true,
    "signal_generated": true,
    "execution_error": true
  }'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comments for documentation
COMMENT ON TABLE strategy_settings IS
  'Per-strategy configuration for automated execution, risk management, and notifications';
COMMENT ON COLUMN strategy_settings.initial_balance_usd IS
  'Starting capital for the strategy (for ROI calculations)';
COMMENT ON COLUMN strategy_settings.current_balance_usd IS
  'Available cash balance (updated after each trade)';
COMMENT ON COLUMN strategy_settings.max_position_size_usd IS
  'Maximum USD value for a single position (null = no limit)';
COMMENT ON COLUMN strategy_settings.risk_per_trade_percent IS
  'Maximum percentage of portfolio to risk per trade (for position sizing)';
COMMENT ON COLUMN strategy_settings.trading_hours IS
  'JSON configuration for time-based trading restrictions';
COMMENT ON COLUMN strategy_settings.notification_events IS
  'Which events should trigger notifications';

-- Index for quick lookups (already indexed via PRIMARY KEY)

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE strategy_watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_settings ENABLE ROW LEVEL SECURITY;

-- Helper function to check strategy ownership
CREATE OR REPLACE FUNCTION user_owns_strategy(strat_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM strategy_definitions
    WHERE id = strat_id
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if strategy is public
CREATE OR REPLACE FUNCTION strategy_is_public(strat_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM strategy_definitions
    WHERE id = strat_id
    AND is_public = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- RLS POLICIES: STRATEGY_WATCHLIST_ITEMS
-- =====================================================

-- Users can view their own watchlist items
CREATE POLICY "Users can view own watchlist items"
  ON strategy_watchlist_items FOR SELECT
  USING (user_owns_strategy(strategy_id));

-- Users can view public strategy watchlist items
CREATE POLICY "Users can view public watchlist items"
  ON strategy_watchlist_items FOR SELECT
  USING (strategy_is_public(strategy_id));

-- Users can insert into their own strategies
CREATE POLICY "Users can insert own watchlist items"
  ON strategy_watchlist_items FOR INSERT
  WITH CHECK (user_owns_strategy(strategy_id));

-- Users can update their own watchlist items
CREATE POLICY "Users can update own watchlist items"
  ON strategy_watchlist_items FOR UPDATE
  USING (user_owns_strategy(strategy_id));

-- Users can delete their own watchlist items
CREATE POLICY "Users can delete own watchlist items"
  ON strategy_watchlist_items FOR DELETE
  USING (user_owns_strategy(strategy_id));

-- =====================================================
-- RLS POLICIES: STRATEGY_POSITIONS
-- =====================================================

CREATE POLICY "Users can view own positions"
  ON strategy_positions FOR SELECT
  USING (user_owns_strategy(strategy_id));

CREATE POLICY "Users can view public positions"
  ON strategy_positions FOR SELECT
  USING (strategy_is_public(strategy_id));

CREATE POLICY "Users can insert own positions"
  ON strategy_positions FOR INSERT
  WITH CHECK (user_owns_strategy(strategy_id));

CREATE POLICY "Users can update own positions"
  ON strategy_positions FOR UPDATE
  USING (user_owns_strategy(strategy_id));

CREATE POLICY "Users can delete own positions"
  ON strategy_positions FOR DELETE
  USING (user_owns_strategy(strategy_id));

-- =====================================================
-- RLS POLICIES: STRATEGY_TRADES
-- =====================================================

CREATE POLICY "Users can view own trades"
  ON strategy_trades FOR SELECT
  USING (user_owns_strategy(strategy_id));

CREATE POLICY "Users can view public trades"
  ON strategy_trades FOR SELECT
  USING (strategy_is_public(strategy_id));

CREATE POLICY "Users can insert own trades"
  ON strategy_trades FOR INSERT
  WITH CHECK (user_owns_strategy(strategy_id));

CREATE POLICY "Users can update own trades"
  ON strategy_trades FOR UPDATE
  USING (user_owns_strategy(strategy_id));

CREATE POLICY "Users can delete own trades"
  ON strategy_trades FOR DELETE
  USING (user_owns_strategy(strategy_id));

-- =====================================================
-- RLS POLICIES: STRATEGY_PERFORMANCE_SNAPSHOTS
-- =====================================================

CREATE POLICY "Users can view own snapshots"
  ON strategy_performance_snapshots FOR SELECT
  USING (user_owns_strategy(strategy_id));

CREATE POLICY "Users can view public snapshots"
  ON strategy_performance_snapshots FOR SELECT
  USING (strategy_is_public(strategy_id));

CREATE POLICY "Users can insert own snapshots"
  ON strategy_performance_snapshots FOR INSERT
  WITH CHECK (user_owns_strategy(strategy_id));

CREATE POLICY "Users can update own snapshots"
  ON strategy_performance_snapshots FOR UPDATE
  USING (user_owns_strategy(strategy_id));

CREATE POLICY "Users can delete own snapshots"
  ON strategy_performance_snapshots FOR DELETE
  USING (user_owns_strategy(strategy_id));

-- =====================================================
-- RLS POLICIES: STRATEGY_SETTINGS
-- =====================================================

CREATE POLICY "Users can view own settings"
  ON strategy_settings FOR SELECT
  USING (user_owns_strategy(strategy_id));

-- Public strategies: users can view settings but not sensitive data
-- (handled by column-level security or view layer)

CREATE POLICY "Users can insert own settings"
  ON strategy_settings FOR INSERT
  WITH CHECK (user_owns_strategy(strategy_id));

CREATE POLICY "Users can update own settings"
  ON strategy_settings FOR UPDATE
  USING (user_owns_strategy(strategy_id));

CREATE POLICY "Users can delete own settings"
  ON strategy_settings FOR DELETE
  USING (user_owns_strategy(strategy_id));

-- =====================================================
-- TRIGGERS FOR AUTO-UPDATING TIMESTAMPS
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_watchlist_items_updated_at
  BEFORE UPDATE ON strategy_watchlist_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_updated_at
  BEFORE UPDATE ON strategy_positions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trades_updated_at
  BEFORE UPDATE ON strategy_trades
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON strategy_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- USEFUL VIEWS FOR COMMON QUERIES
-- =====================================================

-- View: Active watchlist items with enriched data
CREATE OR REPLACE VIEW v_active_watchlist AS
SELECT
  w.*,
  sd.strategy_name as strategy_name,
  sd.created_by,
  se.executed_at as added_at
FROM strategy_watchlist_items w
JOIN strategy_definitions sd ON w.strategy_id = sd.strategy_id
LEFT JOIN strategy_executions se ON w.execution_id = se.execution_id
WHERE w.status IN ('WATCHING', 'TRIGGERED')
ORDER BY w.created_at DESC;

COMMENT ON VIEW v_active_watchlist IS
  'Active watchlist items with strategy context';

-- View: Open positions with current P&L
CREATE OR REPLACE VIEW v_open_positions AS
SELECT
  p.*,
  sd.strategy_name as strategy_name,
  sd.created_by,
  EXTRACT(EPOCH FROM (NOW() - p.entry_timestamp))/3600 as hours_open,
  CASE
    WHEN p.unrealized_pnl > 0 THEN 'winning'
    WHEN p.unrealized_pnl < 0 THEN 'losing'
    ELSE 'neutral'
  END as pnl_status
FROM strategy_positions p
JOIN strategy_definitions sd ON p.strategy_id = sd.strategy_id
WHERE p.status = 'OPEN'
ORDER BY p.entry_timestamp DESC;

COMMENT ON VIEW v_open_positions IS
  'All open positions with calculated fields and strategy context';

-- View: Recent trades with position context
CREATE OR REPLACE VIEW v_recent_trades AS
SELECT
  t.*,
  sd.strategy_name as strategy_name,
  sd.created_by,
  p.market_title as position_market_title,
  p.entry_timestamp as position_entry_time
FROM strategy_trades t
JOIN strategy_definitions sd ON t.strategy_id = sd.strategy_id
LEFT JOIN strategy_positions p ON t.position_id = p.id
WHERE t.execution_status = 'COMPLETED'
ORDER BY t.executed_at DESC;

COMMENT ON VIEW v_recent_trades IS
  'Successfully executed trades with position and strategy context';

-- View: Strategy performance summary
CREATE OR REPLACE VIEW v_strategy_performance_summary AS
SELECT
  sd.strategy_id as strategy_id,
  sd.strategy_name as strategy_name,
  sd.created_by,
  ss.initial_balance_usd,
  ss.current_balance_usd,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'OPEN') as open_positions,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'CLOSED') as closed_positions,
  SUM(p.unrealized_pnl) FILTER (WHERE p.status = 'OPEN') as total_unrealized_pnl,
  SUM(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED') as total_realized_pnl,
  AVG(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl > 0) as avg_win,
  AVG(p.realized_pnl) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl < 0) as avg_loss,
  COUNT(*) FILTER (WHERE p.status = 'CLOSED' AND p.realized_pnl > 0)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE p.status = 'CLOSED'), 0) as win_rate,
  COUNT(DISTINCT t.id) as total_trades
FROM strategy_definitions sd
LEFT JOIN strategy_settings ss ON sd.strategy_id = ss.strategy_id
LEFT JOIN strategy_positions p ON sd.strategy_id = p.strategy_id
LEFT JOIN strategy_trades t ON sd.strategy_id = t.strategy_id AND t.execution_status = 'COMPLETED'
GROUP BY sd.strategy_id, sd.strategy_name, sd.created_by, ss.initial_balance_usd, ss.current_balance_usd;

COMMENT ON VIEW v_strategy_performance_summary IS
  'Aggregated performance metrics per strategy';

-- =====================================================
-- EXAMPLE QUERIES (COMMENTED OUT - FOR DOCUMENTATION)
-- =====================================================

/*
-- Query 1: Get all active watchlist items for a strategy
SELECT * FROM strategy_watchlist_items
WHERE strategy_id = 'YOUR-STRATEGY-ID'
  AND status IN ('WATCHING', 'TRIGGERED')
ORDER BY created_at DESC;

-- Query 2: Get open positions with unrealized P&L
SELECT
  market_title,
  outcome,
  entry_price,
  current_price,
  entry_amount_usd,
  unrealized_pnl,
  unrealized_pnl_percent,
  EXTRACT(EPOCH FROM (NOW() - entry_timestamp))/3600 as hours_open
FROM strategy_positions
WHERE strategy_id = 'YOUR-STRATEGY-ID'
  AND status = 'OPEN'
ORDER BY unrealized_pnl DESC;

-- Query 3: Calculate win rate for closed positions
SELECT
  COUNT(*) FILTER (WHERE realized_pnl > 0) as wins,
  COUNT(*) FILTER (WHERE realized_pnl < 0) as losses,
  COUNT(*) as total,
  (COUNT(*) FILTER (WHERE realized_pnl > 0)::numeric / COUNT(*)) * 100 as win_rate_percent
FROM strategy_positions
WHERE strategy_id = 'YOUR-STRATEGY-ID'
  AND status = 'CLOSED';

-- Query 4: Get performance snapshots for charting (last 30 days)
SELECT
  snapshot_timestamp,
  portfolio_value_usd,
  total_pnl,
  total_roi_percent,
  open_positions_count,
  win_rate
FROM strategy_performance_snapshots
WHERE strategy_id = 'YOUR-STRATEGY-ID'
  AND snapshot_timestamp >= NOW() - INTERVAL '30 days'
ORDER BY snapshot_timestamp ASC;

-- Query 5: Top performing markets (by realized P&L)
SELECT
  market_title,
  COUNT(*) as position_count,
  SUM(realized_pnl) as total_pnl,
  AVG(realized_pnl_percent) as avg_roi_percent
FROM strategy_positions
WHERE strategy_id = 'YOUR-STRATEGY-ID'
  AND status = 'CLOSED'
GROUP BY market_title
ORDER BY total_pnl DESC
LIMIT 10;

-- Query 6: Recent trade execution history
SELECT
  t.trade_type,
  t.market_title,
  t.outcome,
  t.shares,
  t.price,
  t.amount_usd,
  t.fees,
  t.execution_status,
  t.executed_at,
  p.realized_pnl as position_pnl
FROM strategy_trades t
LEFT JOIN strategy_positions p ON t.position_id = p.id
WHERE t.strategy_id = 'YOUR-STRATEGY-ID'
ORDER BY t.executed_at DESC
LIMIT 20;

-- Query 7: Update current price and unrealized P&L for open position
UPDATE strategy_positions
SET
  current_price = 0.67,
  current_value_usd = shares * 0.67,
  unrealized_pnl = (shares * 0.67) - entry_amount_usd - fees_paid,
  unrealized_pnl_percent = (((shares * 0.67) - entry_amount_usd - fees_paid) / entry_amount_usd) * 100,
  updated_at = NOW()
WHERE id = 'POSITION-ID';

-- Query 8: Close a position
UPDATE strategy_positions
SET
  status = 'CLOSED',
  exit_timestamp = NOW(),
  exit_price = 0.72,
  exit_shares = shares,
  exit_amount_usd = shares * 0.72,
  realized_pnl = (shares * 0.72) - entry_amount_usd - fees_paid,
  realized_pnl_percent = (((shares * 0.72) - entry_amount_usd - fees_paid) / entry_amount_usd) * 100,
  auto_exited = true,
  exit_signal_type = 'TAKE_PROFIT',
  updated_at = NOW()
WHERE id = 'POSITION-ID';

-- Query 9: Add new watchlist item from strategy execution
INSERT INTO strategy_watchlist_items (
  strategy_id,
  execution_id,
  item_type,
  item_id,
  item_data,
  signal_reason,
  confidence,
  status
) VALUES (
  'STRATEGY-ID',
  'EXECUTION-ID',
  'WALLET',
  '0x1234...abcd',
  '{"omega_ratio": 2.5, "win_rate": 0.68, "total_volume": 125000}'::jsonb,
  'High omega ratio (2.5) and win rate (68%) detected',
  'HIGH',
  'WATCHING'
);

-- Query 10: Create position from watchlist trigger
INSERT INTO strategy_positions (
  strategy_id,
  watchlist_item_id,
  market_id,
  market_slug,
  market_title,
  outcome,
  entry_signal_type,
  entry_price,
  entry_shares,
  entry_amount_usd,
  current_price,
  current_value_usd,
  category,
  auto_entered,
  metadata
) VALUES (
  'STRATEGY-ID',
  'WATCHLIST-ITEM-ID',
  '0xmarket123',
  'will-bitcoin-hit-100k',
  'Will Bitcoin hit $100K by end of 2025?',
  'YES',
  'HIGH_OMEGA_WALLET',
  0.55,
  1000,
  550.00,
  0.55,
  550.00,
  'Crypto',
  true,
  '{"stop_loss": 0.45, "take_profit": 0.75, "source_wallet": "0x1234...abcd"}'::jsonb
);
*/

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

-- Grant usage on types to authenticated users
GRANT USAGE ON TYPE watchlist_item_type TO authenticated;
GRANT USAGE ON TYPE watchlist_status TO authenticated;
GRANT USAGE ON TYPE signal_confidence TO authenticated;
GRANT USAGE ON TYPE position_status TO authenticated;
GRANT USAGE ON TYPE trade_outcome TO authenticated;
GRANT USAGE ON TYPE trade_type TO authenticated;
GRANT USAGE ON TYPE execution_status TO authenticated;

-- Grant table permissions
GRANT ALL ON strategy_watchlist_items TO authenticated;
GRANT ALL ON strategy_positions TO authenticated;
GRANT ALL ON strategy_trades TO authenticated;
GRANT ALL ON strategy_performance_snapshots TO authenticated;
GRANT ALL ON strategy_settings TO authenticated;

-- Grant view permissions
GRANT SELECT ON v_active_watchlist TO authenticated;
GRANT SELECT ON v_open_positions TO authenticated;
GRANT SELECT ON v_recent_trades TO authenticated;
GRANT SELECT ON v_strategy_performance_summary TO authenticated;

-- =====================================================
-- END OF MIGRATION
-- =====================================================
