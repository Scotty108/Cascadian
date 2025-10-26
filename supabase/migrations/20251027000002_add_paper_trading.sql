-- ============================================================================
-- PAPER TRADING SYSTEM
-- ============================================================================
-- Enables users to test strategies with virtual money before committing real capital.
-- Tracks all trades, positions, and P&L as if they were real, but no actual money is used.

-- ============================================================================
-- 1. Add trading mode to strategy definitions
-- ============================================================================

-- Add trading_mode column to strategy_definitions
ALTER TABLE strategy_definitions
ADD COLUMN IF NOT EXISTS trading_mode TEXT DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live'));

-- Add paper_bankroll column (virtual money for paper trading)
ALTER TABLE strategy_definitions
ADD COLUMN IF NOT EXISTS paper_bankroll_usd NUMERIC DEFAULT 10000;

-- Add paper_pnl tracking (current P&L for paper trading)
ALTER TABLE strategy_definitions
ADD COLUMN IF NOT EXISTS paper_pnl_usd NUMERIC DEFAULT 0;

-- Add paper_positions_count
ALTER TABLE strategy_definitions
ADD COLUMN IF NOT EXISTS paper_positions_count INTEGER DEFAULT 0;

-- Index on trading mode
CREATE INDEX IF NOT EXISTS idx_strategy_trading_mode ON strategy_definitions(trading_mode);

-- ============================================================================
-- 2. Paper Trades Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS paper_trades (
  -- Identity
  trade_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Strategy reference
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,
  execution_id UUID REFERENCES strategy_executions(execution_id) ON DELETE SET NULL,
  decision_id UUID REFERENCES orchestrator_decisions(id) ON DELETE SET NULL,

  -- Trade details
  market_id TEXT NOT NULL,
  market_question TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL', 'CLOSE')),

  -- Entry
  entry_price NUMERIC NOT NULL,
  entry_shares NUMERIC NOT NULL,
  entry_notional_usd NUMERIC NOT NULL,
  entry_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exit (nullable until position is closed)
  exit_price NUMERIC,
  exit_shares NUMERIC,
  exit_notional_usd NUMERIC,
  exit_date TIMESTAMPTZ,

  -- P&L tracking
  realized_pnl_usd NUMERIC DEFAULT 0,
  unrealized_pnl_usd NUMERIC DEFAULT 0,
  total_pnl_usd NUMERIC DEFAULT 0,

  -- Position status
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired')),

  -- Market resolution (when market settles)
  market_resolved BOOLEAN DEFAULT FALSE,
  winning_side TEXT CHECK (winning_side IN ('YES', 'NO', 'INVALID')),
  resolution_date TIMESTAMPTZ,

  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_paper_trades_strategy ON paper_trades(strategy_id, created_at DESC);
CREATE INDEX idx_paper_trades_status ON paper_trades(status) WHERE status = 'open';
CREATE INDEX idx_paper_trades_market ON paper_trades(market_id);
CREATE INDEX idx_paper_trades_user ON paper_trades(created_by);

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_paper_trades_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_paper_trades_updated_at_trigger
  BEFORE UPDATE ON paper_trades
  FOR EACH ROW
  EXECUTE FUNCTION update_paper_trades_updated_at();

-- ============================================================================
-- 3. Paper Portfolio State Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS paper_portfolios (
  -- Identity
  portfolio_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL UNIQUE REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,

  -- Bankroll
  initial_bankroll_usd NUMERIC NOT NULL DEFAULT 10000,
  current_bankroll_usd NUMERIC NOT NULL DEFAULT 10000,

  -- Cash tracking
  available_cash_usd NUMERIC NOT NULL DEFAULT 10000,
  deployed_capital_usd NUMERIC DEFAULT 0,

  -- P&L
  total_pnl_usd NUMERIC DEFAULT 0,
  realized_pnl_usd NUMERIC DEFAULT 0,
  unrealized_pnl_usd NUMERIC DEFAULT 0,

  -- Position tracking
  open_positions_count INTEGER DEFAULT 0,
  total_trades_count INTEGER DEFAULT 0,
  winning_trades_count INTEGER DEFAULT 0,
  losing_trades_count INTEGER DEFAULT 0,

  -- Performance metrics
  win_rate NUMERIC DEFAULT 0,
  avg_win_usd NUMERIC DEFAULT 0,
  avg_loss_usd NUMERIC DEFAULT 0,
  largest_win_usd NUMERIC DEFAULT 0,
  largest_loss_usd NUMERIC DEFAULT 0,
  max_drawdown_usd NUMERIC DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_paper_portfolios_strategy ON paper_portfolios(strategy_id);

-- Auto-update timestamp
CREATE TRIGGER update_paper_portfolios_updated_at_trigger
  BEFORE UPDATE ON paper_portfolios
  FOR EACH ROW
  EXECUTE FUNCTION update_paper_trades_updated_at();

-- ============================================================================
-- 4. Functions for Paper Trading
-- ============================================================================

-- Function: Initialize paper portfolio when strategy is created
CREATE OR REPLACE FUNCTION initialize_paper_portfolio()
RETURNS TRIGGER AS $$
BEGIN
  -- Only initialize if trading_mode is 'paper'
  IF NEW.trading_mode = 'paper' THEN
    INSERT INTO paper_portfolios (
      strategy_id,
      initial_bankroll_usd,
      current_bankroll_usd,
      available_cash_usd
    ) VALUES (
      NEW.strategy_id,
      NEW.paper_bankroll_usd,
      NEW.paper_bankroll_usd,
      NEW.paper_bankroll_usd
    )
    ON CONFLICT (strategy_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER initialize_paper_portfolio_trigger
  AFTER INSERT OR UPDATE ON strategy_definitions
  FOR EACH ROW
  WHEN (NEW.trading_mode = 'paper')
  EXECUTE FUNCTION initialize_paper_portfolio();

-- Function: Update portfolio metrics after trade
CREATE OR REPLACE FUNCTION update_paper_portfolio_metrics()
RETURNS TRIGGER AS $$
DECLARE
  portfolio_record RECORD;
BEGIN
  -- Get current portfolio state
  SELECT * INTO portfolio_record
  FROM paper_portfolios
  WHERE strategy_id = NEW.strategy_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Update based on trade action
  IF NEW.action = 'BUY' THEN
    -- Decrease available cash
    UPDATE paper_portfolios
    SET
      available_cash_usd = available_cash_usd - NEW.entry_notional_usd,
      deployed_capital_usd = deployed_capital_usd + NEW.entry_notional_usd,
      open_positions_count = open_positions_count + 1,
      total_trades_count = total_trades_count + 1,
      updated_at = NOW()
    WHERE strategy_id = NEW.strategy_id;

  ELSIF NEW.action IN ('SELL', 'CLOSE') THEN
    -- Return cash and track P&L
    UPDATE paper_portfolios
    SET
      available_cash_usd = available_cash_usd + NEW.exit_notional_usd,
      deployed_capital_usd = deployed_capital_usd - NEW.entry_notional_usd,
      open_positions_count = GREATEST(0, open_positions_count - 1),
      realized_pnl_usd = realized_pnl_usd + NEW.realized_pnl_usd,
      total_pnl_usd = total_pnl_usd + NEW.realized_pnl_usd,
      current_bankroll_usd = current_bankroll_usd + NEW.realized_pnl_usd,
      winning_trades_count = CASE WHEN NEW.realized_pnl_usd > 0 THEN winning_trades_count + 1 ELSE winning_trades_count END,
      losing_trades_count = CASE WHEN NEW.realized_pnl_usd < 0 THEN losing_trades_count + 1 ELSE losing_trades_count END,
      largest_win_usd = GREATEST(largest_win_usd, NEW.realized_pnl_usd),
      largest_loss_usd = LEAST(largest_loss_usd, NEW.realized_pnl_usd),
      updated_at = NOW()
    WHERE strategy_id = NEW.strategy_id;

    -- Update win rate
    UPDATE paper_portfolios
    SET win_rate = CASE
      WHEN total_trades_count > 0 THEN winning_trades_count::NUMERIC / total_trades_count::NUMERIC
      ELSE 0
    END
    WHERE strategy_id = NEW.strategy_id;
  END IF;

  -- Sync back to strategy_definitions
  UPDATE strategy_definitions
  SET
    paper_pnl_usd = (SELECT total_pnl_usd FROM paper_portfolios WHERE strategy_id = NEW.strategy_id),
    paper_positions_count = (SELECT open_positions_count FROM paper_portfolios WHERE strategy_id = NEW.strategy_id)
  WHERE strategy_id = NEW.strategy_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_paper_portfolio_metrics_trigger
  AFTER INSERT OR UPDATE ON paper_trades
  FOR EACH ROW
  EXECUTE FUNCTION update_paper_portfolio_metrics();

-- ============================================================================
-- 5. RLS Policies
-- ============================================================================

ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_portfolios ENABLE ROW LEVEL SECURITY;

-- Users can only view their own paper trades
CREATE POLICY "users_can_view_own_paper_trades"
  ON paper_trades
  FOR SELECT
  USING (created_by = auth.uid());

-- Users can create their own paper trades
CREATE POLICY "users_can_create_paper_trades"
  ON paper_trades
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Users can update their own paper trades
CREATE POLICY "users_can_update_own_paper_trades"
  ON paper_trades
  FOR UPDATE
  USING (created_by = auth.uid());

-- Users can view their own paper portfolios
CREATE POLICY "users_can_view_own_paper_portfolios"
  ON paper_portfolios
  FOR SELECT
  USING (
    strategy_id IN (
      SELECT strategy_id FROM strategy_definitions WHERE created_by = auth.uid()
    )
  );

-- Users can update their own paper portfolios
CREATE POLICY "users_can_update_own_paper_portfolios"
  ON paper_portfolios
  FOR UPDATE
  USING (
    strategy_id IN (
      SELECT strategy_id FROM strategy_definitions WHERE created_by = auth.uid()
    )
  );

-- ============================================================================
-- 6. Comments
-- ============================================================================

COMMENT ON TABLE paper_trades IS 'Virtual trades executed in paper trading mode - tracks P&L as if real';
COMMENT ON TABLE paper_portfolios IS 'Portfolio state for paper trading strategies - virtual money only';
COMMENT ON COLUMN strategy_definitions.trading_mode IS 'Trading mode: paper (virtual money) or live (real money)';
COMMENT ON COLUMN strategy_definitions.paper_bankroll_usd IS 'Virtual money allocated to this strategy for paper trading';
COMMENT ON COLUMN strategy_definitions.paper_pnl_usd IS 'Current P&L for paper trading (synced from paper_portfolios)';

-- ============================================================================
-- 7. Sample Data (Optional - for testing)
-- ============================================================================

-- Update existing strategies to paper trading mode by default
UPDATE strategy_definitions
SET trading_mode = 'paper',
    paper_bankroll_usd = 10000
WHERE trading_mode IS NULL;
