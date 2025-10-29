-- ============================================================
-- Copy Trading System - Test Queries
-- ============================================================
-- Purpose: Quick reference for testing and verifying the copy trading system
-- Created: 2025-10-29
-- ============================================================

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Check all tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'tracked_wallets',
    'copy_trade_signals',
    'copy_trades',
    'copy_trade_performance_snapshots'
  )
ORDER BY table_name;

-- Check all indexes exist
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'tracked_wallets',
    'copy_trade_signals',
    'copy_trades',
    'copy_trade_performance_snapshots'
  )
ORDER BY tablename, indexname;

-- Check all views exist
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN (
    'v_active_copy_trades',
    'v_strategy_copy_performance',
    'v_owrr_decision_quality'
  )
ORDER BY table_name;

-- Check all triggers exist
SELECT
  event_object_table as table_name,
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN (
    'tracked_wallets',
    'copy_trades'
  )
ORDER BY event_object_table, trigger_name;


-- ============================================================
-- TEST DATA INSERTION
-- ============================================================

-- Insert test tracked wallet
INSERT INTO tracked_wallets (
  strategy_id,
  wallet_address,
  selection_reason,
  expected_omega,
  primary_category,
  status
) VALUES (
  'test_strategy_001',
  '0x1234567890abcdef1234567890abcdef12345678',
  'High performing wallet in Politics category',
  2.5,
  'Politics',
  'active'
) RETURNING *;

-- Insert test signal (skip decision)
INSERT INTO copy_trade_signals (
  signal_id,
  strategy_id,
  source_wallet,
  market_id,
  side,
  source_timestamp,
  source_entry_price,
  source_shares,
  source_usd_amount,
  owrr_score,
  owrr_slider,
  decision,
  decision_reason
) VALUES (
  'signal_' || gen_random_uuid(),
  'test_strategy_001',
  '0x1234567890abcdef1234567890abcdef12345678',
  '0xmarket123',
  'YES',
  NOW() - INTERVAL '5 minutes',
  0.65,
  1000,
  650,
  0.45,
  45,
  'skip',
  'OWRR too low (45/100) - Insufficient smart money consensus'
) RETURNING *;

-- Insert test signal (copy decision)
INSERT INTO copy_trade_signals (
  signal_id,
  strategy_id,
  source_wallet,
  market_id,
  side,
  source_timestamp,
  source_entry_price,
  source_shares,
  source_usd_amount,
  owrr_score,
  owrr_slider,
  owrr_confidence,
  decision,
  decision_reason
) VALUES (
  'signal_' || gen_random_uuid(),
  'test_strategy_001',
  '0x1234567890abcdef1234567890abcdef12345678',
  '0xmarket456',
  'YES',
  NOW() - INTERVAL '2 minutes',
  0.55,
  2000,
  1100,
  0.72,
  72,
  'high',
  'copy',
  'OWRR 72/100 - Strong YES signal. Latency 30s acceptable.'
) RETURNING *;

-- Insert test copy trade (open)
INSERT INTO copy_trades (
  strategy_id,
  source_wallet,
  market_id,
  side,
  source_entry_price,
  source_shares,
  source_usd_amount,
  source_timestamp,
  our_entry_price,
  our_shares,
  our_usd_amount,
  our_timestamp,
  latency_seconds,
  slippage_bps,
  entry_owrr_score,
  entry_owrr_slider,
  status
) VALUES (
  'test_strategy_001',
  '0x1234567890abcdef1234567890abcdef12345678',
  '0xmarket456',
  'YES',
  0.55,
  2000,
  1100,
  NOW() - INTERVAL '2 minutes',
  0.56,
  1785,
  1000,
  NOW() - INTERVAL '90 seconds',
  30,
  18,
  0.72,
  72,
  'open'
) RETURNING *;

-- Insert test copy trade (closed)
INSERT INTO copy_trades (
  strategy_id,
  source_wallet,
  market_id,
  side,
  source_entry_price,
  source_shares,
  source_usd_amount,
  source_timestamp,
  our_entry_price,
  our_shares,
  our_usd_amount,
  our_timestamp,
  latency_seconds,
  slippage_bps,
  entry_owrr_score,
  entry_owrr_slider,
  status,
  exit_price,
  exit_timestamp,
  exit_reason,
  realized_pnl_usd,
  realized_pnl_pct
) VALUES (
  'test_strategy_001',
  '0x1234567890abcdef1234567890abcdef12345678',
  '0xmarket789',
  'NO',
  0.60,
  1666,
  1000,
  NOW() - INTERVAL '2 days',
  0.61,
  1639,
  1000,
  NOW() - INTERVAL '2 days' + INTERVAL '1 minute',
  45,
  17,
  0.68,
  68,
  'closed',
  0.45,
  NOW() - INTERVAL '1 day',
  'take_profit',
  246.85,
  24.69
) RETURNING *;

-- Insert test performance snapshot
INSERT INTO copy_trade_performance_snapshots (
  strategy_id,
  source_wallet,
  snapshot_date,
  our_trades_count,
  our_trades_opened,
  our_trades_closed,
  our_total_pnl,
  our_avg_pnl,
  our_win_rate,
  source_trades_count,
  source_total_pnl,
  source_avg_pnl,
  source_win_rate,
  pnl_capture_ratio,
  avg_latency_seconds,
  avg_slippage_bps,
  signals_received,
  signals_copied,
  signals_skipped,
  copy_rate,
  avg_owrr_when_copied
) VALUES (
  'test_strategy_001',
  '0x1234567890abcdef1234567890abcdef12345678',
  CURRENT_DATE,
  5,
  2,
  3,
  450.25,
  150.08,
  0.60,
  8,
  520.00,
  162.50,
  0.625,
  0.866,
  38.5,
  15.2,
  12,
  5,
  7,
  0.4167,
  0.71
) RETURNING *;


-- ============================================================
-- QUERY EXAMPLES
-- ============================================================

-- 1. Get all active tracked wallets for a strategy
SELECT *
FROM tracked_wallets
WHERE strategy_id = 'test_strategy_001'
  AND status = 'active'
ORDER BY cumulative_pnl DESC;

-- 2. Get recent copy trade signals with decisions
SELECT
  signal_id,
  source_wallet,
  market_id,
  side,
  owrr_score,
  owrr_slider,
  decision,
  decision_reason,
  signal_received_at
FROM copy_trade_signals
WHERE strategy_id = 'test_strategy_001'
ORDER BY signal_received_at DESC
LIMIT 20;

-- 3. Get strategy performance summary
SELECT *
FROM v_strategy_copy_performance
WHERE strategy_id = 'test_strategy_001';

-- 4. Find best performing source wallets
SELECT
  source_wallet,
  COUNT(*) as trades,
  SUM(realized_pnl_usd) as total_pnl,
  AVG(realized_pnl_usd) as avg_pnl,
  AVG(pnl_capture_ratio) as capture_ratio,
  AVG(latency_seconds) as avg_latency,
  AVG(slippage_bps) as avg_slippage
FROM copy_trades
WHERE strategy_id = 'test_strategy_001'
  AND status = 'closed'
GROUP BY source_wallet
ORDER BY total_pnl DESC;

-- 5. Analyze OWRR effectiveness
SELECT *
FROM v_owrr_decision_quality
WHERE strategy_id = 'test_strategy_001'
ORDER BY decision, avg_owrr DESC;

-- 6. Get all open positions
SELECT
  ct.id,
  ct.market_id,
  ct.side,
  ct.our_entry_price,
  ct.our_shares,
  ct.our_usd_amount,
  ct.our_timestamp,
  ct.latency_seconds,
  ct.slippage_bps,
  ct.unrealized_pnl_usd,
  tw.primary_category,
  tw.expected_omega
FROM copy_trades ct
LEFT JOIN tracked_wallets tw
  ON ct.strategy_id = tw.strategy_id
  AND ct.source_wallet = tw.wallet_address
WHERE ct.strategy_id = 'test_strategy_001'
  AND ct.status = 'open'
ORDER BY ct.our_timestamp DESC;

-- 7. Get signals that were skipped but would have been profitable (retrospective analysis)
SELECT
  cts.signal_id,
  cts.market_id,
  cts.side,
  cts.owrr_score,
  cts.decision_reason,
  -- Would need to join with actual market outcomes to calculate this
  'TBD' as would_have_pnl
FROM copy_trade_signals cts
WHERE cts.strategy_id = 'test_strategy_001'
  AND cts.decision = 'skip'
  AND cts.signal_received_at > NOW() - INTERVAL '7 days'
ORDER BY cts.owrr_score DESC;

-- 8. Get daily performance snapshots
SELECT
  snapshot_date,
  source_wallet,
  our_total_pnl,
  source_total_pnl,
  pnl_capture_ratio,
  our_win_rate,
  source_win_rate,
  copy_rate,
  avg_latency_seconds
FROM copy_trade_performance_snapshots
WHERE strategy_id = 'test_strategy_001'
  AND snapshot_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY snapshot_date DESC, source_wallet;

-- 9. Get aggregate performance across all wallets
SELECT
  snapshot_date,
  our_total_pnl,
  source_total_pnl,
  pnl_capture_ratio,
  signals_received,
  signals_copied,
  signals_skipped,
  copy_rate
FROM copy_trade_performance_snapshots
WHERE strategy_id = 'test_strategy_001'
  AND source_wallet IS NULL -- NULL = aggregate
ORDER BY snapshot_date DESC;

-- 10. Find trades with high slippage
SELECT
  id,
  market_id,
  side,
  source_entry_price,
  our_entry_price,
  slippage_bps,
  slippage_usd,
  latency_seconds,
  our_timestamp
FROM copy_trades
WHERE strategy_id = 'test_strategy_001'
  AND slippage_bps > 20 -- More than 20 basis points
ORDER BY slippage_bps DESC;

-- 11. Compare copy vs skip decisions by OWRR range
SELECT
  CASE
    WHEN owrr_score >= 0.7 THEN '70-100 (High)'
    WHEN owrr_score >= 0.5 THEN '50-70 (Medium)'
    WHEN owrr_score >= 0.3 THEN '30-50 (Low)'
    ELSE '0-30 (Very Low)'
  END as owrr_range,
  decision,
  COUNT(*) as count,
  AVG(owrr_score) as avg_owrr
FROM copy_trade_signals
WHERE strategy_id = 'test_strategy_001'
GROUP BY owrr_range, decision
ORDER BY owrr_range DESC, decision;

-- 12. Get trades that closed today
SELECT
  id,
  market_id,
  side,
  our_entry_price,
  exit_price,
  realized_pnl_usd,
  realized_pnl_pct,
  holding_period_hours,
  exit_reason
FROM copy_trades
WHERE strategy_id = 'test_strategy_001'
  AND status = 'closed'
  AND exit_timestamp::date = CURRENT_DATE
ORDER BY realized_pnl_usd DESC;


-- ============================================================
-- CLEANUP TEST DATA
-- ============================================================

-- Delete test data (run these after testing)
-- DELETE FROM copy_trade_performance_snapshots WHERE strategy_id = 'test_strategy_001';
-- DELETE FROM copy_trades WHERE strategy_id = 'test_strategy_001';
-- DELETE FROM copy_trade_signals WHERE strategy_id = 'test_strategy_001';
-- DELETE FROM tracked_wallets WHERE strategy_id = 'test_strategy_001';


-- ============================================================
-- TRIGGER TESTS
-- ============================================================

-- Test: Update timestamp triggers
UPDATE tracked_wallets
SET status = 'paused'
WHERE strategy_id = 'test_strategy_001'
RETURNING updated_at; -- Should show current timestamp

-- Test: Auto-update wallet stats when trade closes
-- First, get current stats
SELECT trades_copied, cumulative_pnl
FROM tracked_wallets
WHERE strategy_id = 'test_strategy_001'
  AND wallet_address = '0x1234567890abcdef1234567890abcdef12345678';

-- Close a trade
UPDATE copy_trades
SET
  status = 'closed',
  exit_price = 0.70,
  exit_timestamp = NOW(),
  exit_reason = 'take_profit',
  realized_pnl_usd = 150.00,
  realized_pnl_pct = 15.00
WHERE strategy_id = 'test_strategy_001'
  AND status = 'open'
  AND id = (
    SELECT id
    FROM copy_trades
    WHERE strategy_id = 'test_strategy_001'
      AND status = 'open'
    LIMIT 1
  );

-- Verify stats were updated
SELECT trades_copied, cumulative_pnl
FROM tracked_wallets
WHERE strategy_id = 'test_strategy_001'
  AND wallet_address = '0x1234567890abcdef1234567890abcdef12345678';
-- Should show trades_copied +1 and cumulative_pnl increased by 150.00
