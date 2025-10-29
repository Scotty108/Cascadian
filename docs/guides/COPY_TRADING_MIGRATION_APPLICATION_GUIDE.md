# Copy Trading Migration Application Guide

## Current Status

The copy trading migration file is ready at:
```
/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251029000001_create_copy_trading_tables.sql
```

**Migration Status:** NOT YET APPLIED

All 4 tables do NOT exist in the database:
- tracked_wallets
- copy_trade_signals
- copy_trades
- copy_trade_performance_snapshots

## Migration Overview

### Tables to be Created (4 total)

1. **tracked_wallets** - Manages which wallets each strategy is monitoring
   - 23 columns including performance metrics, category specialization, tracking status
   - 3 indexes (strategy, wallet, status)
   - Auto-update timestamp trigger

2. **copy_trade_signals** - Tracks every trade signal and decision
   - 23 columns including OWRR analysis, latency, decision factors
   - 6 indexes (strategy, wallet, market, decision, timestamp, owrr)
   - Foreign key to copy_trades

3. **copy_trades** - Tracks executed copy trades with performance
   - 36 columns including execution quality, position management, P&L tracking
   - 6 indexes (strategy, wallet, market, status, timestamp, pnl)
   - Auto-update timestamp trigger
   - Auto-update tracked_wallets stats trigger

4. **copy_trade_performance_snapshots** - Daily performance snapshots
   - 28 columns for strategy vs source wallet comparison
   - 3 indexes (strategy+date, wallet+date, date)
   - Unique constraint on (strategy_id, source_wallet, snapshot_date)

### Views to be Created (3 total)

1. **v_active_copy_trades** - Currently open positions with enriched data
2. **v_strategy_copy_performance** - Aggregate performance metrics per strategy
3. **v_owrr_decision_quality** - Analyze OWRR decision effectiveness

### Triggers to be Created (3 total)

1. **tracked_wallets_update_timestamp** - Auto-update timestamp on tracked_wallets
2. **copy_trades_update_timestamp** - Auto-update timestamp on copy_trades
3. **update_tracked_wallet_stats_trigger** - Auto-increment stats when trades close

## How to Apply the Migration

### METHOD 1: Supabase SQL Editor (RECOMMENDED)

This is the easiest and most reliable method.

1. **Open Supabase SQL Editor:**
   ```
   https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/sql/new
   ```

2. **Copy the migration SQL:**
   - Open: `/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251029000001_create_copy_trading_tables.sql`
   - Select all (CMD+A) and copy (CMD+C)

3. **Paste into SQL Editor:**
   - Paste the entire migration SQL into the editor
   - Click "Run" or press CMD+Enter

4. **Verify success:**
   ```bash
   cd /Users/scotty/Projects/Cascadian-app
   npm run verify:copy-trading
   ```

### METHOD 2: Direct psql Connection

If you prefer command-line:

1. **Get PostgreSQL connection string:**
   - Go to: https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/settings/database
   - Click "Connection String" → "URI"
   - Copy the connection string (it includes the password)

2. **Apply migration:**
   ```bash
   cd /Users/scotty/Projects/Cascadian-app
   psql "postgresql://[PASTE-CONNECTION-STRING]" < supabase/migrations/20251029000001_create_copy_trading_tables.sql
   ```

3. **Verify success:**
   ```bash
   npm run verify:copy-trading
   ```

### METHOD 3: Add DATABASE_URL and use Node script

1. **Get PostgreSQL connection string:**
   - Go to: https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/settings/database
   - Copy the connection string

2. **Add to .env.local:**
   ```bash
   echo 'DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@aws-0-us-east-2.pooler.supabase.com:5432/postgres"' >> .env.local
   ```

3. **Run migration script:**
   ```bash
   npx tsx scripts/apply-copy-trading-migration-direct.ts
   ```

4. **Verify success:**
   ```bash
   npm run verify:copy-trading
   ```

## Verification Script

After applying the migration, run:

```bash
cd /Users/scotty/Projects/Cascadian-app
npx tsx scripts/verify-copy-trading-tables.ts
```

This will:
1. Check all 4 tables exist
2. Count rows in each table
3. Test inserting data into tracked_wallets
4. Test inserting data into copy_trade_signals
5. Test querying views
6. Clean up test data

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

## Package.json Script

Add this to your package.json for easy verification:

```json
"scripts": {
  "verify:copy-trading": "tsx scripts/verify-copy-trading-tables.ts"
}
```

## Troubleshooting

### Error: "relation already exists"

The tables already exist. Run verification:
```bash
npx tsx scripts/verify-copy-trading-tables.ts
```

### Error: "permission denied"

Make sure you're using a connection string with sufficient privileges:
- Use the service_role key
- Or use the database password from Supabase dashboard

### Error: "timeout" or "connection refused"

- Check your internet connection
- Verify the Supabase project is not paused
- Try again after a few minutes

### Error: "syntax error at or near..."

Make sure you copied the entire migration file, including all comments.

## Next Steps After Migration

Once the migration is applied successfully:

1. **Update API Routes:**
   - Implement copy trading signal endpoints
   - Add tracked wallet management endpoints
   - Create performance dashboard endpoints

2. **Implement Copy Trading Logic:**
   - Create signal detection service
   - Build trade execution pipeline
   - Set up performance tracking

3. **Build UI Components:**
   - Tracked wallets dashboard
   - Copy trade signals interface
   - Performance analytics views

4. **Set up Monitoring:**
   - Track signal latency
   - Monitor execution quality
   - Alert on underperformance

## Database Schema Documentation

Full schema documentation is embedded in the migration file itself with:
- Table purposes and relationships
- Column descriptions
- Index strategies
- Trigger behaviors
- Sample queries

## Support

If you encounter issues:

1. Check the migration file syntax
2. Verify Supabase credentials
3. Check Supabase project status
4. Review Supabase logs in dashboard

## Files Created

Helper scripts created for this migration:

1. `/Users/scotty/Projects/Cascadian-app/scripts/verify-copy-trading-tables.ts`
   - Verifies tables exist and tests operations

2. `/Users/scotty/Projects/Cascadian-app/scripts/apply-copy-trading-migration-direct.ts`
   - Applies migration via direct PostgreSQL connection (requires DATABASE_URL)

3. `/Users/scotty/Projects/Cascadian-app/scripts/apply-copy-trading-migration-supabase-client.ts`
   - Shows migration status and instructions

4. `/Users/scotty/Projects/Cascadian-app/COPY_TRADING_MIGRATION_APPLICATION_GUIDE.md`
   - This comprehensive guide
