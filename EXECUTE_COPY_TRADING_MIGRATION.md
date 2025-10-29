# Execute Copy Trading Migration - Manual Instructions

## CRITICAL: Network Connectivity Issue

The Supabase CLI is experiencing network connectivity issues (IPv6/DNS routing problem).

**SOLUTION:** Execute the migration directly in the Supabase SQL Editor.

---

## Step 1: Access Supabase SQL Editor

1. Go to: https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/sql/new
2. Log in if necessary

---

## Step 2: Copy & Paste the Migration SQL

The complete migration SQL is located at:
```
/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251029000001_create_copy_trading_tables.sql
```

**Alternatively**, you can copy the SQL from below:

---

## Step 3: Execute the SQL

1. Paste the entire migration SQL into the SQL Editor
2. Click "Run" or press Cmd+Enter
3. Wait for execution to complete (should take ~2-5 seconds)
4. Verify no errors appear

---

## Step 4: Verify Installation

After execution, run this verification query in the SQL Editor:

```sql
-- Verify all 4 tables were created
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN (
    'tracked_wallets',
    'copy_trade_signals',
    'copy_trades',
    'copy_trade_performance_snapshots'
  )
ORDER BY table_name;
```

**Expected Output:**
```
table_name                          | column_count
------------------------------------+-------------
copy_trade_performance_snapshots   | 31
copy_trade_signals                 | 24
copy_trades                        | 35
tracked_wallets                    | 20
```

---

## Step 5: Run npm verification script

Back in your terminal, run:

```bash
npm run verify:copy-trading
```

**Expected Output:**
```
✅ tracked_wallets: 20 columns
✅ copy_trade_signals: 24 columns
✅ copy_trades: 35 columns
✅ copy_trade_performance_snapshots: 31 columns

✅ 4/4 tables verified
```

---

## Troubleshooting

### If tables already exist
The migration uses `CREATE TABLE IF NOT EXISTS`, so it's safe to run multiple times.

### If you get permission errors
Make sure you're logged in with admin/owner permissions in Supabase dashboard.

### If verification fails
1. Check the SQL Editor for error messages
2. Run the verification query above manually
3. Check if tables were partially created: `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'copy%' OR tablename = 'tracked_wallets';`

---

## Migration Details

**Creates 4 Tables:**
1. `tracked_wallets` - Wallets being monitored for copy trading
2. `copy_trade_signals` - Every trade signal and decision made
3. `copy_trades` - Executed copy trades with performance tracking
4. `copy_trade_performance_snapshots` - Daily performance summaries

**Creates 3 Views:**
1. `v_active_copy_trades` - Currently open positions
2. `v_strategy_copy_performance` - Strategy-level metrics
3. `v_owrr_decision_quality` - OWRR decision effectiveness

**Creates 3 Triggers:**
1. Auto-update timestamps on tracked_wallets
2. Auto-update timestamps on copy_trades
3. Auto-update stats when trades close

---

## Alternative: Use Supabase CLI (if network is fixed)

If the network issue is resolved, you can try:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_1c6fb25cc379b9a62ec896149b3eb2098fd0ebef
export DB_URL="postgresql://postgres:EwchTep6Zw97GLw@db.cqvjfonlpqycmaonacvz.supabase.co:5432/postgres"

# Try CLI push
supabase db push --db-url "$DB_URL" --include-all

# OR try direct psql (if installed)
psql "$DB_URL" -f supabase/migrations/20251029000001_create_copy_trading_tables.sql
```

---

## Status

- ❌ Supabase CLI network connectivity failed
- ❌ psql not installed locally
- ✅ Manual SQL Editor execution required

**NEXT ACTION:** Go to Supabase SQL Editor and execute the migration!
