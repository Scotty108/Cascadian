-- Check for existing wallet-related tables
-- This query will help us understand if the migration will conflict

SELECT
  table_name,
  table_type
FROM information_schema.tables
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

-- Also check for any tables with 'wallet' in the name
SELECT
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%wallet%'
ORDER BY table_name;
