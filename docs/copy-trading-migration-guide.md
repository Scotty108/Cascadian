# Copy Trading Database Migration Guide

## Overview

This guide explains how to apply the copy trading database migration to your Supabase PostgreSQL database.

## Migration Files

- **Migration SQL**: `/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251029000001_create_copy_trading_tables.sql`
- **Verification Script**: `/Users/scotty/Projects/Cascadian-app/scripts/verify-copy-trading-tables.ts`

## Tables Created

The migration creates 4 main tables:

1. **tracked_wallets** - Manages which wallets each strategy is monitoring for copy trading
2. **copy_trade_signals** - Tracks every trade signal detected and the decision made (copy or skip)
3. **copy_trades** - Tracks executed copy trades with full performance and execution metrics
4. **copy_trade_performance_snapshots** - Daily performance snapshots comparing copy trades to source wallets

Additionally, it creates:
- **16 indexes** for optimal query performance
- **3 views** for common queries
- **3 triggers** for automatic timestamp updates and stats tracking

## How to Apply the Migration

### Method 1: Supabase Dashboard (Recommended)

1. Go to the Supabase SQL Editor:
   ```
   https://app.supabase.com/project/cqvjfonlpqycmaonacvz/sql
   ```

2. Click "New Query"

3. Copy the entire contents of the migration file:
   ```bash
   cat supabase/migrations/20251029000001_create_copy_trading_tables.sql
   ```

4. Paste it into the SQL editor

5. Click "Run" or press `Cmd/Ctrl + Enter`

6. Wait for the migration to complete (should take 2-5 seconds)

### Method 2: Using psql (If you have PostgreSQL client)

```bash
# Install psql if needed
brew install postgresql

# Apply the migration
PGPASSWORD="EwchTep6Zw97GLw" psql \
  -h db.cqvjfonlpqycmaonacvz.supabase.co \
  -p 5432 \
  -U postgres \
  -d postgres \
  -f supabase/migrations/20251029000001_create_copy_trading_tables.sql
```

### Method 3: Using Supabase CLI (Requires Docker)

```bash
# Start Docker if not running
open -a Docker

# Push migration to remote database
supabase db push
```

## Verify the Migration

After applying the migration, verify it was successful:

```bash
# Run verification script
bash scripts/run-verify-tables.sh
```

Expected output:
```
📋 Copy Trading Tables Verification
====================================

🔍 Checking tables...

  ✅ tracked_wallets: EXISTS (0 rows)
  ✅ copy_trade_signals: EXISTS (0 rows)
  ✅ copy_trades: EXISTS (0 rows)
  ✅ copy_trade_performance_snapshots: EXISTS (0 rows)

────────────────────────────────────────────────────────────
Summary: 4/4 tables verified
────────────────────────────────────────────────────────────

✅ All tables exist! Testing sample operations...

🧪 Testing table operations...

Test 1: Insert into tracked_wallets
  ✅ Success: Inserted wallet ID 1
  🧹 Cleaned up test data

Test 2: Insert into copy_trade_signals
  ✅ Success: Inserted signal ID 1
  🧹 Cleaned up test data

Test 3: Query v_strategy_copy_performance view
  ✅ Success: View is queryable (returned 0 rows)

🎉 Verification complete!
```

## Schema Details

### Table: tracked_wallets

Tracks which wallets each strategy is monitoring for copy trading.

**Key columns:**
- `strategy_id` - ID of the strategy
- `wallet_address` - Address of the wallet being tracked
- `expected_omega` - Expected performance metric
- `status` - active | paused | stopped | underperforming
- `cumulative_pnl` - Total P&L from copying this wallet

**Indexes:**
- `idx_tracked_wallets_strategy` - Fast lookups by strategy (active only)
- `idx_tracked_wallets_wallet` - Fast lookups by wallet (active only)
- `idx_tracked_wallets_status` - Fast filtering by status

### Table: copy_trade_signals

Tracks every trade signal and the decision made.

**Key columns:**
- `signal_id` - Unique identifier for the signal
- `source_wallet` - Wallet that made the trade
- `market_id` - Polymarket market ID
- `side` - YES | NO
- `owrr_score` - Smart money consensus score (0.0-1.0)
- `decision` - copy | skip | copy_reduced | error
- `decision_reason` - Human-readable explanation

**Indexes:**
- `idx_signals_strategy` - Fast lookups by strategy
- `idx_signals_source_wallet` - Fast lookups by source wallet
- `idx_signals_market` - Fast lookups by market
- `idx_signals_timestamp` - Sorted by time (DESC)
- `idx_signals_owrr` - OWRR scores for copied trades

### Table: copy_trades

Tracks executed copy trades with full performance metrics.

**Key columns:**
- `strategy_id` - ID of the strategy
- `source_wallet` - Wallet we copied
- `market_id` - Market traded
- `our_entry_price` - Price we got
- `latency_seconds` - Time from source trade to execution
- `slippage_bps` - Slippage in basis points
- `realized_pnl_usd` - Profit/loss (if closed)
- `status` - open | closed | partially_closed | error

**Indexes:**
- `idx_copy_trades_strategy` - Fast lookups by strategy
- `idx_copy_trades_source_wallet` - Fast lookups by source wallet
- `idx_copy_trades_market` - Fast lookups by market
- `idx_copy_trades_status` - Fast filtering by status
- `idx_copy_trades_timestamp` - Sorted by time (DESC)
- `idx_copy_trades_pnl` - P&L for closed trades

### Table: copy_trade_performance_snapshots

Daily snapshots comparing copy trades to source wallets.

**Key columns:**
- `strategy_id` - ID of the strategy
- `source_wallet` - Wallet being tracked (NULL = aggregate)
- `snapshot_date` - Date of the snapshot
- `our_total_pnl` - Our total P&L
- `source_total_pnl` - Source wallet P&L
- `pnl_capture_ratio` - Efficiency (our_pnl / source_pnl)
- `avg_latency_seconds` - Average execution latency

**Indexes:**
- `idx_snapshots_strategy` - Fast lookups by strategy and date
- `idx_snapshots_wallet` - Fast lookups by wallet and date
- `idx_snapshots_date` - Sorted by date (DESC)

## Views

### v_active_copy_trades

All currently open copy trades with enriched data.

```sql
SELECT * FROM v_active_copy_trades
WHERE strategy_id = 'strat_123'
ORDER BY our_timestamp DESC;
```

### v_strategy_copy_performance

Aggregate performance metrics per strategy.

```sql
SELECT * FROM v_strategy_copy_performance
WHERE strategy_id = 'strat_123';
```

### v_owrr_decision_quality

Analyze whether OWRR-based decisions lead to profitable trades.

```sql
SELECT * FROM v_owrr_decision_quality
WHERE strategy_id = 'strat_123'
ORDER BY signal_count DESC;
```

## Triggers

1. **tracked_wallets_update_timestamp** - Auto-updates `updated_at` on row changes
2. **copy_trades_update_timestamp** - Auto-updates `updated_at` on row changes
3. **update_tracked_wallet_stats_trigger** - Auto-updates wallet stats when trades close

## Sample Queries

### Get all active tracked wallets for a strategy
```sql
SELECT *
FROM tracked_wallets
WHERE strategy_id = 'strat_123'
  AND status = 'active'
ORDER BY cumulative_pnl DESC;
```

### Get recent copy trade signals with decisions
```sql
SELECT *
FROM copy_trade_signals
WHERE strategy_id = 'strat_123'
ORDER BY signal_received_at DESC
LIMIT 20;
```

### Get strategy performance summary
```sql
SELECT *
FROM v_strategy_copy_performance
WHERE strategy_id = 'strat_123';
```

### Find best performing source wallets
```sql
SELECT
  source_wallet,
  COUNT(*) as trades,
  SUM(realized_pnl_usd) as total_pnl,
  AVG(pnl_capture_ratio) as capture_ratio,
  AVG(latency_seconds) as avg_latency
FROM copy_trades
WHERE strategy_id = 'strat_123'
  AND status = 'closed'
GROUP BY source_wallet
ORDER BY total_pnl DESC;
```

### Analyze OWRR effectiveness
```sql
SELECT *
FROM v_owrr_decision_quality
WHERE strategy_id = 'strat_123'
ORDER BY decision, avg_owrr DESC;
```

## Rollback

If you need to rollback the migration:

```sql
-- Drop views first (they depend on tables)
DROP VIEW IF EXISTS v_owrr_decision_quality;
DROP VIEW IF EXISTS v_strategy_copy_performance;
DROP VIEW IF EXISTS v_active_copy_trades;

-- Drop triggers and functions
DROP TRIGGER IF EXISTS update_tracked_wallet_stats_trigger ON copy_trades;
DROP TRIGGER IF EXISTS copy_trades_update_timestamp ON copy_trades;
DROP TRIGGER IF EXISTS tracked_wallets_update_timestamp ON tracked_wallets;
DROP FUNCTION IF EXISTS update_tracked_wallet_stats();
DROP FUNCTION IF EXISTS update_copy_trades_timestamp();
DROP FUNCTION IF EXISTS update_tracked_wallets_timestamp();

-- Drop tables (in reverse order of creation due to foreign keys)
DROP TABLE IF EXISTS copy_trade_performance_snapshots;
DROP TABLE IF EXISTS copy_trades;
DROP TABLE IF EXISTS copy_trade_signals;
DROP TABLE IF EXISTS tracked_wallets;
```

## Next Steps

After applying the migration:

1. **Update your application code** to use these tables
2. **Create API endpoints** for copy trading operations
3. **Implement the copy trading engine** that populates these tables
4. **Set up monitoring** for the copy trading system
5. **Create dashboards** to visualize performance

## Support

If you encounter any issues:

1. Check the Supabase logs for error messages
2. Verify your database credentials are correct
3. Ensure you have sufficient permissions
4. Review the migration SQL for any syntax errors

## Migration Fixed Issues

The migration file has been corrected to fix:

1. Removed inline `COMMENT` syntax (not supported in PostgreSQL)
2. Moved all column comments to `COMMENT ON COLUMN` statements
3. Fixed forward reference issue with foreign key constraint
4. Added proper foreign key constraint after all tables are created

All SQL syntax has been validated and is ready to apply.
