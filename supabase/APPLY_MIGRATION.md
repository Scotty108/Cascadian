# Apply Polymarket Database Migration

Due to network configuration, we'll apply the migration via the Supabase Dashboard SQL Editor.

## Quick Steps

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz
   - Navigate to: **SQL Editor** (left sidebar)

2. **Create New Query**
   - Click **"New query"** button
   - Name it: "Polymarket Migration"

3. **Copy Migration SQL**
   - Open: `/supabase/migrations/20251022131000_create_polymarket_tables.sql`
   - Select all (Cmd+A / Ctrl+A)
   - Copy (Cmd+C / Ctrl+C)

4. **Paste and Run**
   - Paste into the SQL Editor
   - Click **"Run"** (or press Cmd+Enter)
   - Wait for "Success" message (should take 2-3 seconds)

5. **Verify Tables Created**
   - Run this verification query:
   ```sql
   SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name IN ('markets', 'sync_logs')
   ORDER BY table_name;
   ```
   - You should see 2 rows: `markets` and `sync_logs`

6. **Check Indexes**
   ```sql
   SELECT tablename, indexname
   FROM pg_indexes
   WHERE schemaname = 'public'
   AND tablename IN ('markets', 'sync_logs')
   ORDER BY tablename, indexname;
   ```
   - You should see 11 indexes

## Alternative: Use This SQL Directly

If you prefer, copy and paste this shortened verification script:

```sql
-- Quick verification after migration
SELECT
  'Tables Created' as check_type,
  COUNT(*) as count
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('markets', 'sync_logs')
UNION ALL
SELECT
  'Indexes Created' as check_type,
  COUNT(*) as count
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('markets', 'sync_logs');
```

Expected output:
```
check_type        | count
------------------+-------
Tables Created    |     2
Indexes Created   |    11
```

## Troubleshooting

### "relation already exists" error
- Tables already created, migration already applied
- Safe to ignore if re-running

### "permission denied" error
- Make sure you're logged into the correct Supabase project
- Check you have owner/admin access

### "syntax error" near...
- Make sure you copied the entire SQL file
- Check for any accidental edits

## After Migration

Once complete, proceed to Phase 1 implementation to:
1. Create Polymarket API client
2. Build sync orchestrator
3. Connect to React UI

The database is now ready! 🎉
