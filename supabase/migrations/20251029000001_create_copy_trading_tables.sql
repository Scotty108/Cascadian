-- ============================================================
-- Copy Trading System - Database Tables
-- ============================================================
-- Purpose: Track copy trades, signals, and performance
-- Created: 2025-10-29
-- ============================================================

-- ============================================================
-- Table 1: tracked_wallets
-- ============================================================
-- Purpose: Manage which wallets each strategy is monitoring
-- ============================================================

CREATE TABLE IF NOT EXISTS tracked_wallets (
  id BIGSERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,

  -- Why this wallet was selected
  selection_reason TEXT,
  selection_filters JSONB,

  -- Performance expectations
  expected_omega DECIMAL(10, 4),
  expected_omega_lag_30s DECIMAL(10, 4),
  expected_omega_lag_2min DECIMAL(10, 4),
  expected_ev_per_hour DECIMAL(18, 6),

  -- Category specialization
  primary_category TEXT,
  category_omega DECIMAL(10, 4),

  -- Tracking status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'stopped', 'underperforming')),
  started_tracking_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_tracking_at TIMESTAMPTZ,

  -- Performance tracking
  trades_copied INT DEFAULT 0,
  trades_skipped INT DEFAULT 0,
  cumulative_pnl DECIMAL(18, 2) DEFAULT 0,
  current_omega DECIMAL(10, 4),

  -- Alerts
  alert_on_underperformance BOOLEAN DEFAULT true,
  alert_threshold_omega DECIMAL(10, 4) DEFAULT 1.0,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(strategy_id, wallet_address)
);

-- Indexes
CREATE INDEX idx_tracked_wallets_strategy ON tracked_wallets(strategy_id) WHERE status = 'active';
CREATE INDEX idx_tracked_wallets_wallet ON tracked_wallets(wallet_address) WHERE status = 'active';
CREATE INDEX idx_tracked_wallets_status ON tracked_wallets(status);

-- Comments
COMMENT ON TABLE tracked_wallets IS 'Manages which wallets each strategy is monitoring for copy trading';
COMMENT ON COLUMN tracked_wallets.selection_filters IS 'JSON of filters used: {"min_omega": 2.0, "min_copyability": 1.5}';
COMMENT ON COLUMN tracked_wallets.expected_omega IS 'Omega at time of selection';
COMMENT ON COLUMN tracked_wallets.expected_omega_lag_30s IS 'Expected performance with 30s latency';
COMMENT ON COLUMN tracked_wallets.expected_omega_lag_2min IS 'Expected performance with 2min latency';
COMMENT ON COLUMN tracked_wallets.expected_ev_per_hour IS 'Expected EV per hour at selection';
COMMENT ON COLUMN tracked_wallets.category_omega IS 'Omega in primary category';
COMMENT ON COLUMN tracked_wallets.status IS 'active: copying trades, paused: monitoring only, stopped: no longer tracking';


-- ============================================================
-- Table 2: copy_trade_signals
-- ============================================================
-- Purpose: Track every trade signal and the decision made
-- ============================================================

CREATE TABLE IF NOT EXISTS copy_trade_signals (
  id BIGSERIAL PRIMARY KEY,
  signal_id TEXT UNIQUE NOT NULL,

  -- Source information
  strategy_id TEXT NOT NULL,
  source_wallet TEXT NOT NULL,
  source_trade_id TEXT,

  -- Market information
  market_id TEXT NOT NULL,
  condition_id TEXT,
  side TEXT NOT NULL CHECK (side IN ('YES', 'NO')),

  -- Source trade details
  source_entry_price DECIMAL(10, 6),
  source_shares DECIMAL(18, 6),
  source_usd_amount DECIMAL(18, 2),
  source_timestamp TIMESTAMPTZ NOT NULL,

  -- Signal received timing
  signal_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latency_seconds INT,

  -- OWRR Analysis
  owrr_score DECIMAL(5, 4),
  owrr_slider INT,
  owrr_yes_score DECIMAL(18, 2),
  owrr_no_score DECIMAL(18, 2),
  owrr_yes_qualified INT,
  owrr_no_qualified INT,
  owrr_confidence TEXT CHECK (owrr_confidence IN ('high', 'medium', 'low', 'insufficient')),

  -- Decision
  decision TEXT NOT NULL CHECK (decision IN ('copy', 'skip', 'copy_reduced', 'error')),
  decision_reason TEXT NOT NULL,
  decision_factors JSONB,

  -- If copied
  copied_trade_id BIGINT,
  position_size_multiplier DECIMAL(5, 4),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_signals_strategy ON copy_trade_signals(strategy_id);
CREATE INDEX idx_signals_source_wallet ON copy_trade_signals(source_wallet);
CREATE INDEX idx_signals_market ON copy_trade_signals(market_id);
CREATE INDEX idx_signals_decision ON copy_trade_signals(decision);
CREATE INDEX idx_signals_timestamp ON copy_trade_signals(signal_received_at DESC);
CREATE INDEX idx_signals_owrr ON copy_trade_signals(owrr_score) WHERE decision = 'copy';

-- Comments
COMMENT ON TABLE copy_trade_signals IS 'Tracks every trade signal detected and the decision made (copy or skip)';
COMMENT ON COLUMN copy_trade_signals.latency_seconds IS 'Seconds between source trade and signal detection';
COMMENT ON COLUMN copy_trade_signals.owrr_score IS '0.0-1.0: smart money consensus';
COMMENT ON COLUMN copy_trade_signals.owrr_slider IS '0-100: UI representation';
COMMENT ON COLUMN copy_trade_signals.owrr_yes_qualified IS 'Count of qualified YES wallets';
COMMENT ON COLUMN copy_trade_signals.owrr_no_qualified IS 'Count of qualified NO wallets';
COMMENT ON COLUMN copy_trade_signals.decision_factors IS 'JSON: {"owrr": 0.68, "latency": 35, "slippage_risk": "low", "portfolio_heat": 0.3}';
COMMENT ON COLUMN copy_trade_signals.position_size_multiplier IS '1.0 = full size, 0.5 = half size, 0 = skipped';
COMMENT ON COLUMN copy_trade_signals.decision_reason IS 'Human-readable: "OWRR 68/100 - Strong YES signal. Latency 35s acceptable."';


-- ============================================================
-- Table 3: copy_trades
-- ============================================================
-- Purpose: Track executed copy trades and their performance
-- ============================================================

CREATE TABLE IF NOT EXISTS copy_trades (
  id BIGSERIAL PRIMARY KEY,

  -- Strategy & source
  strategy_id TEXT NOT NULL,
  source_wallet TEXT NOT NULL,
  source_trade_id TEXT,
  signal_id TEXT REFERENCES copy_trade_signals(signal_id),

  -- Market & position
  market_id TEXT NOT NULL,
  condition_id TEXT,
  side TEXT NOT NULL CHECK (side IN ('YES', 'NO')),

  -- Source trade details
  source_entry_price DECIMAL(10, 6),
  source_shares DECIMAL(18, 6),
  source_usd_amount DECIMAL(18, 2),
  source_timestamp TIMESTAMPTZ,

  -- Our trade details
  our_order_id TEXT,
  our_entry_price DECIMAL(10, 6),
  our_shares DECIMAL(18, 6),
  our_usd_amount DECIMAL(18, 2),
  our_timestamp TIMESTAMPTZ,

  -- Execution quality
  latency_seconds INT,
  slippage_bps INT,
  slippage_usd DECIMAL(18, 2),
  execution_fee_usd DECIMAL(18, 2),

  -- Position management
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'partially_closed', 'error')),

  -- Close details (if closed)
  exit_price DECIMAL(10, 6),
  exit_timestamp TIMESTAMPTZ,
  exit_reason TEXT CHECK (exit_reason IN ('resolution', 'stop_loss', 'take_profit', 'manual', 'source_exited')),

  -- Performance
  realized_pnl_usd DECIMAL(18, 2),
  realized_pnl_pct DECIMAL(10, 4),
  unrealized_pnl_usd DECIMAL(18, 2),

  -- Comparison with source
  source_realized_pnl_usd DECIMAL(18, 2),
  pnl_capture_ratio DECIMAL(5, 4),

  -- Risk metrics
  max_drawdown_pct DECIMAL(10, 4),
  holding_period_hours DECIMAL(12, 2),

  -- OWRR context at entry
  entry_owrr_score DECIMAL(5, 4),
  entry_owrr_slider INT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_copy_trades_strategy ON copy_trades(strategy_id);
CREATE INDEX idx_copy_trades_source_wallet ON copy_trades(source_wallet);
CREATE INDEX idx_copy_trades_market ON copy_trades(market_id);
CREATE INDEX idx_copy_trades_status ON copy_trades(status);
CREATE INDEX idx_copy_trades_timestamp ON copy_trades(our_timestamp DESC);
CREATE INDEX idx_copy_trades_pnl ON copy_trades(realized_pnl_usd) WHERE status = 'closed';

-- Comments
COMMENT ON TABLE copy_trades IS 'Tracks executed copy trades with full performance and execution metrics';
COMMENT ON COLUMN copy_trades.our_order_id IS 'Polymarket order ID';
COMMENT ON COLUMN copy_trades.latency_seconds IS 'Time from source trade to our execution';
COMMENT ON COLUMN copy_trades.slippage_bps IS 'Basis points of slippage (our_price - source_price) * 10000. Positive = paid more than source, Negative = got better price';
COMMENT ON COLUMN copy_trades.slippage_usd IS 'Dollar amount of slippage';
COMMENT ON COLUMN copy_trades.execution_fee_usd IS 'Polymarket fees paid';
COMMENT ON COLUMN copy_trades.unrealized_pnl_usd IS 'If still open';
COMMENT ON COLUMN copy_trades.source_realized_pnl_usd IS 'Source wallet P&L on this trade';
COMMENT ON COLUMN copy_trades.pnl_capture_ratio IS 'Efficiency metric: our_pnl / source_pnl (1.0 = matched source, 0.8 = captured 80% of source P&L)';
COMMENT ON COLUMN copy_trades.max_drawdown_pct IS 'Max % decline while open';


-- Add foreign key constraint to copy_trade_signals after copy_trades exists
ALTER TABLE copy_trade_signals
  ADD CONSTRAINT fk_copy_trade_signals_copied_trade
  FOREIGN KEY (copied_trade_id) REFERENCES copy_trades(id);


-- ============================================================
-- Table 4: copy_trade_performance_snapshots
-- ============================================================
-- Purpose: Daily snapshots of strategy performance vs source wallets
-- ============================================================

CREATE TABLE IF NOT EXISTS copy_trade_performance_snapshots (
  id BIGSERIAL PRIMARY KEY,

  -- Scope
  strategy_id TEXT NOT NULL,
  source_wallet TEXT,
  snapshot_date DATE NOT NULL,

  -- Our performance
  our_trades_count INT,
  our_trades_opened INT,
  our_trades_closed INT,
  our_total_pnl DECIMAL(18, 2),
  our_avg_pnl DECIMAL(18, 2),
  our_win_rate DECIMAL(5, 4),
  our_omega DECIMAL(10, 4),

  -- Source performance
  source_trades_count INT,
  source_total_pnl DECIMAL(18, 2),
  source_avg_pnl DECIMAL(18, 2),
  source_win_rate DECIMAL(5, 4),
  source_omega DECIMAL(10, 4),

  -- Capture ratios
  trade_capture_ratio DECIMAL(5, 4),
  pnl_capture_ratio DECIMAL(5, 4),
  omega_capture_ratio DECIMAL(5, 4),

  -- Execution quality
  avg_latency_seconds DECIMAL(10, 2),
  avg_slippage_bps DECIMAL(10, 2),
  median_latency_seconds DECIMAL(10, 2),
  median_slippage_bps DECIMAL(10, 2),

  -- Decision quality
  signals_received INT,
  signals_copied INT,
  signals_skipped INT,
  copy_rate DECIMAL(5, 4),

  -- OWRR effectiveness
  avg_owrr_when_copied DECIMAL(5, 4),
  avg_owrr_when_skipped DECIMAL(5, 4),
  copied_trades_avg_pnl DECIMAL(18, 2),
  skipped_trades_would_have_pnl DECIMAL(18, 2),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(strategy_id, source_wallet, snapshot_date)
);

-- Indexes
CREATE INDEX idx_snapshots_strategy ON copy_trade_performance_snapshots(strategy_id, snapshot_date DESC);
CREATE INDEX idx_snapshots_wallet ON copy_trade_performance_snapshots(source_wallet, snapshot_date DESC) WHERE source_wallet IS NOT NULL;
CREATE INDEX idx_snapshots_date ON copy_trade_performance_snapshots(snapshot_date DESC);

-- Comments
COMMENT ON TABLE copy_trade_performance_snapshots IS 'Daily performance snapshots comparing copy trades to source wallets';
COMMENT ON COLUMN copy_trade_performance_snapshots.source_wallet IS 'NULL = aggregate across all wallets';
COMMENT ON COLUMN copy_trade_performance_snapshots.source_trades_count IS 'Total trades by source';
COMMENT ON COLUMN copy_trade_performance_snapshots.trade_capture_ratio IS 'our_trades / source_trades';
COMMENT ON COLUMN copy_trade_performance_snapshots.pnl_capture_ratio IS 'our_pnl / source_pnl';
COMMENT ON COLUMN copy_trade_performance_snapshots.omega_capture_ratio IS 'our_omega / source_omega';
COMMENT ON COLUMN copy_trade_performance_snapshots.copy_rate IS 'signals_copied / signals_received';
COMMENT ON COLUMN copy_trade_performance_snapshots.skipped_trades_would_have_pnl IS 'Retrospective analysis: what if we copied skipped trades? Did we make good skip decisions?';


-- ============================================================
-- Update Triggers
-- ============================================================

-- Update timestamp on tracked_wallets
CREATE OR REPLACE FUNCTION update_tracked_wallets_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tracked_wallets_update_timestamp
  BEFORE UPDATE ON tracked_wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_tracked_wallets_timestamp();

-- Update timestamp on copy_trades
CREATE OR REPLACE FUNCTION update_copy_trades_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER copy_trades_update_timestamp
  BEFORE UPDATE ON copy_trades
  FOR EACH ROW
  EXECUTE FUNCTION update_copy_trades_timestamp();

-- Auto-update tracked_wallets stats when copy_trade closes
CREATE OR REPLACE FUNCTION update_tracked_wallet_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    UPDATE tracked_wallets
    SET
      trades_copied = trades_copied + 1,
      cumulative_pnl = cumulative_pnl + COALESCE(NEW.realized_pnl_usd, 0),
      updated_at = NOW()
    WHERE strategy_id = NEW.strategy_id
      AND wallet_address = NEW.source_wallet;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tracked_wallet_stats_trigger
  AFTER INSERT OR UPDATE ON copy_trades
  FOR EACH ROW
  EXECUTE FUNCTION update_tracked_wallet_stats();


-- ============================================================
-- Helpful Views
-- ============================================================

-- View: Active copy trades with performance
CREATE OR REPLACE VIEW v_active_copy_trades AS
SELECT
  ct.*,
  tw.primary_category,
  tw.expected_omega,
  (ct.our_timestamp - ct.source_timestamp) AS execution_delay,
  CASE
    WHEN ct.status = 'open' THEN ct.unrealized_pnl_usd
    ELSE ct.realized_pnl_usd
  END AS current_pnl
FROM copy_trades ct
LEFT JOIN tracked_wallets tw
  ON ct.strategy_id = tw.strategy_id
  AND ct.source_wallet = tw.wallet_address
WHERE ct.status IN ('open', 'partially_closed');

COMMENT ON VIEW v_active_copy_trades IS 'All currently open copy trades with enriched data';


-- View: Strategy performance summary
CREATE OR REPLACE VIEW v_strategy_copy_performance AS
SELECT
  strategy_id,
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE status = 'open') as open_trades,
  COUNT(*) FILTER (WHERE status = 'closed') as closed_trades,
  SUM(realized_pnl_usd) FILTER (WHERE status = 'closed') as total_realized_pnl,
  AVG(realized_pnl_usd) FILTER (WHERE status = 'closed') as avg_pnl_per_trade,
  AVG(latency_seconds) as avg_latency_sec,
  AVG(slippage_bps) as avg_slippage_bps,
  AVG(pnl_capture_ratio) FILTER (WHERE pnl_capture_ratio IS NOT NULL) as avg_capture_ratio,
  COUNT(*) FILTER (WHERE realized_pnl_usd > 0 AND status = 'closed') as winning_trades,
  COUNT(*) FILTER (WHERE realized_pnl_usd < 0 AND status = 'closed') as losing_trades,
  CASE
    WHEN COUNT(*) FILTER (WHERE status = 'closed') > 0
    THEN COUNT(*) FILTER (WHERE realized_pnl_usd > 0 AND status = 'closed')::DECIMAL /
         COUNT(*) FILTER (WHERE status = 'closed')
    ELSE NULL
  END as win_rate,
  SUM(our_usd_amount) FILTER (WHERE status IN ('open', 'closed')) as total_capital_deployed
FROM copy_trades
GROUP BY strategy_id;

COMMENT ON VIEW v_strategy_copy_performance IS 'Aggregate performance metrics per strategy';


-- View: OWRR decision effectiveness
CREATE OR REPLACE VIEW v_owrr_decision_quality AS
SELECT
  cts.strategy_id,
  cts.decision,
  COUNT(*) as signal_count,
  AVG(cts.owrr_score) as avg_owrr,
  AVG(cts.owrr_slider) as avg_slider,
  AVG(cts.latency_seconds) as avg_latency,
  -- For copied trades, get actual P&L
  AVG(ct.realized_pnl_usd) FILTER (WHERE ct.status = 'closed') as avg_pnl,
  COUNT(ct.id) FILTER (WHERE ct.realized_pnl_usd > 0) as winning_copies,
  COUNT(ct.id) FILTER (WHERE ct.realized_pnl_usd < 0) as losing_copies
FROM copy_trade_signals cts
LEFT JOIN copy_trades ct ON cts.copied_trade_id = ct.id
GROUP BY cts.strategy_id, cts.decision;

COMMENT ON VIEW v_owrr_decision_quality IS 'Analyze whether OWRR-based decisions lead to profitable trades';


-- ============================================================
-- Sample Queries
-- ============================================================

-- Query 1: Get all active tracked wallets for a strategy
-- SELECT * FROM tracked_wallets WHERE strategy_id = 'strat_123' AND status = 'active';

-- Query 2: Get recent copy trade signals with decisions
-- SELECT * FROM copy_trade_signals WHERE strategy_id = 'strat_123' ORDER BY signal_received_at DESC LIMIT 20;

-- Query 3: Get strategy performance summary
-- SELECT * FROM v_strategy_copy_performance WHERE strategy_id = 'strat_123';

-- Query 4: Find best performing source wallets
-- SELECT
--   source_wallet,
--   COUNT(*) as trades,
--   SUM(realized_pnl_usd) as total_pnl,
--   AVG(pnl_capture_ratio) as capture_ratio
-- FROM copy_trades
-- WHERE strategy_id = 'strat_123' AND status = 'closed'
-- GROUP BY source_wallet
-- ORDER BY total_pnl DESC;

-- Query 5: Analyze OWRR effectiveness
-- SELECT * FROM v_owrr_decision_quality WHERE strategy_id = 'strat_123';
