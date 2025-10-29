# QUICK START: Copy Trading Migration

## 🎯 2-Minute Setup

### The SQL is already in your clipboard! Just paste it.

---

## Step 1: Open SQL Editor (if not already open)
```
https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/sql/new
```

## Step 2: Paste & Run
1. Press `Cmd+V` (or `Ctrl+V`)
2. Click **"RUN"** or press `Cmd+Enter`

## Step 3: Verify
```bash
npm run verify:copy-trading
```

### Expected output:
```
✅ tracked_wallets: 20 columns
✅ copy_trade_signals: 24 columns
✅ copy_trades: 35 columns
✅ copy_trade_performance_snapshots: 31 columns

✅ 4/4 tables verified
```

---

## Done! 🎉

For detailed info, see:
- `MIGRATION_STATUS.md` - Full status report
- `EXECUTE_COPY_TRADING_MIGRATION.md` - Detailed instructions
- `supabase/migrations/20251029000001_create_copy_trading_tables.sql` - The actual SQL
