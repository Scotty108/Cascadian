# Copy Trading Migration - Quick Start

## Status: READY TO APPLY

The migration is fully prepared but **NOT YET APPLIED** to your database.

---

## Fastest Method (Recommended)

### Option 1: Interactive Script (Easiest)

```bash
cd /Users/scotty/Projects/Cascadian-app
./scripts/open-sql-editor-with-migration.sh
```

This will:
1. Open Supabase SQL Editor in your browser
2. Copy the migration SQL to your clipboard
3. Guide you through the process

Then in SQL Editor:
- Paste (CMD+V)
- Run (CMD+Enter)

Verify:
```bash
npm run verify:copy-trading
```

---

### Option 2: Manual Copy-Paste (Also Easy)

1. **Open SQL Editor:**
   https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/sql/new

2. **Open migration file:**
   ```
   supabase/migrations/20251029000001_create_copy_trading_tables.sql
   ```

3. **Copy entire file contents** (CMD+A, CMD+C)

4. **Paste into SQL Editor** (CMD+V)

5. **Run** (CMD+Enter or click "Run")

6. **Verify:**
   ```bash
   npm run verify:copy-trading
   ```

---

## What You'll Get

After applying the migration:

### 4 New Tables
- `tracked_wallets` - Which wallets are being copied
- `copy_trade_signals` - Every trade signal detected
- `copy_trades` - Executed copy trades with performance
- `copy_trade_performance_snapshots` - Daily performance metrics

### 3 New Views
- `v_active_copy_trades` - Currently open positions
- `v_strategy_copy_performance` - Strategy performance summary
- `v_owrr_decision_quality` - OWRR decision effectiveness

### 3 Auto-Update Triggers
- Auto-update timestamps on data changes
- Auto-increment stats when trades close

---

## Expected Verification Output

After running `npm run verify:copy-trading`:

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

---

## Need Help?

- **Full documentation:** See `COPY_TRADING_MIGRATION_APPLICATION_GUIDE.md`
- **Status report:** See `COPY_TRADING_MIGRATION_STATUS_REPORT.md`
- **Migration SQL:** See `supabase/migrations/20251029000001_create_copy_trading_tables.sql`

---

## Troubleshooting

**Migration fails with "relation already exists"**
- Tables already created! Run `npm run verify:copy-trading` to confirm.

**Connection timeout**
- Use the SQL Editor method instead of CLI (recommended anyway)

**Permission denied**
- Make sure you're logged into Supabase Dashboard with correct account

---

## Time to Complete

- **Apply migration:** < 2 minutes
- **Verification:** < 30 seconds
- **Total:** < 3 minutes

---

**Ready?** Run this now:

```bash
./scripts/open-sql-editor-with-migration.sh
```
