-- =====================================================================
-- VERIFICATION SCRIPT: Wallet Analytics Tables
-- =====================================================================
-- Purpose: Verify all wallet analytics tables, indexes, functions, and
--          policies were created correctly
-- =====================================================================

-- 1. Check all tables exist
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN (
    'wallets',
    'wallet_positions',
    'wallet_trades',
    'wallet_closed_positions',
    'wallet_pnl_snapshots',
    'market_holders',
    'whale_activity_log'
  )
ORDER BY table_name;

-- 2. Check indexes
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'wallets',
    'wallet_positions',
    'wallet_trades',
    'wallet_closed_positions',
    'wallet_pnl_snapshots',
    'market_holders',
    'whale_activity_log'
  )
ORDER BY tablename, indexname;

-- 3. Check functions
SELECT
  routine_name,
  routine_type,
  data_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'update_wallet_timestamp',
    'calculate_wallet_win_rate',
    'get_top_whales',
    'get_suspected_insiders',
    'get_recent_whale_activity'
  )
ORDER BY routine_name;

-- 4. Check RLS policies
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'wallets',
    'wallet_positions',
    'wallet_trades',
    'wallet_closed_positions',
    'wallet_pnl_snapshots',
    'market_holders',
    'whale_activity_log'
  )
ORDER BY tablename, policyname;

-- 5. Check constraints
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name IN (
    'wallets',
    'wallet_positions',
    'wallet_trades',
    'wallet_closed_positions',
    'wallet_pnl_snapshots',
    'market_holders',
    'whale_activity_log'
  )
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
