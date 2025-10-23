# Polymarket Database Migration Instructions

## Overview

This document provides instructions for applying the Polymarket schema migration to your Supabase database.

**Status**: Migration ready to apply
**Date**: 2025-10-22
**Migration File**: `/supabase/migrations/20251022131000_create_polymarket_tables.sql`
**Seed File**: `/supabase/seed/polymarket-test-data.sql`

---

## Why Manual Execution?

Direct PostgreSQL connections to your Supabase database are currently blocked due to network/firewall restrictions. The recommended approach is to use the Supabase Dashboard SQL Editor.

---

## Method 1: Supabase Dashboard (Recommended)

### Step 1: Access SQL Editor

1. Open your Supabase Dashboard:
   ```
   https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz
   ```

2. Click **"SQL Editor"** in the left sidebar

3. Click **"+ New Query"** button

### Step 2: Apply Migration

1. **Copy the migration SQL** (already in your clipboard, or run):
   ```bash
   pbcopy < /Users/scotty/Projects/Cascadian-app/supabase/migrations/20251022131000_create_polymarket_tables.sql
   ```

2. **Paste the SQL** into the query editor

3. **Click "Run"** or press `Cmd + Enter` (Mac) / `Ctrl + Enter` (Windows)

4. **Verify the output** shows:
   - ✓ "Polymarket tables created successfully!"
   - ✓ "Run the seed script to insert test data."

### Step 3: Load Test Data (Optional but Recommended)

1. Click **"+ New Query"** again

2. **Copy the seed SQL**:
   ```bash
   pbcopy < /Users/scotty/Projects/Cascadian-app/supabase/seed/polymarket-test-data.sql
   ```

3. **Paste the SQL** into the new query editor

4. **Click "Run"**

5. **Verify the output** shows:
   - ✓ "Test data inserted successfully!"
   - ✓ "Markets: 20"
   - ✓ "Sync logs: 5"

---

## Method 2: psql Command Line

If you have `psql` installed and can connect:

```bash
# Set connection string
export DATABASE_URL="postgresql://postgres:EwchTep6Zw97GLw@db.cqvjfonlpqycmaonacvz.supabase.co:5432/postgres"

# Apply migration
psql "$DATABASE_URL" -f supabase/migrations/20251022131000_create_polymarket_tables.sql

# Load seed data
psql "$DATABASE_URL" -f supabase/seed/polymarket-test-data.sql
```

---

## Verification Queries

After running the migration, verify everything was created correctly:

### Check Tables Exist

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('markets', 'sync_logs')
ORDER BY table_name;
```

**Expected**: 2 rows (markets, sync_logs)

### Count Indexes

```sql
SELECT COUNT(*) as index_count
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('markets', 'sync_logs');
```

**Expected**: 11+ indexes

### Count Functions

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%market%'
ORDER BY routine_name;
```

**Expected**: 4 functions
- `get_last_successful_sync()`
- `get_market_data_staleness()`
- `is_market_data_stale(integer)`
- `update_markets_updated_at()`

### Check Triggers

```sql
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('markets', 'sync_logs')
ORDER BY trigger_name;
```

**Expected**: 1 trigger (`trigger_markets_updated_at` on `markets`)

### Verify Test Data (if loaded)

```sql
-- Count markets
SELECT COUNT(*) FROM markets;
-- Expected: 20

-- Count sync logs
SELECT COUNT(*) FROM sync_logs;
-- Expected: 5

-- View top markets by volume
SELECT
  title,
  category,
  volume_24h,
  current_price,
  active
FROM markets
WHERE active = TRUE
ORDER BY volume_24h DESC
LIMIT 5;
```

---

## What Was Created

### Tables

1. **`markets`** - Stores Polymarket market data
   - 24 columns including pricing, volume, metadata
   - Primary key: `market_id` (TEXT)
   - Future-proof signal columns (momentum_score, sii_score, etc.)

2. **`sync_logs`** - Audit log of sync operations
   - Tracks success/failure, timing, error messages
   - Primary key: `id` (BIGSERIAL)

### Indexes (11 total)

**markets table:**
- `idx_markets_active` - Active markets filter (partial index)
- `idx_markets_category` - Category filter (partial index)
- `idx_markets_volume_24h` - Volume sorting
- `idx_markets_end_date` - End date sorting
- `idx_markets_title_trgm` - Full-text search (GIN index with pg_trgm)
- `idx_markets_category_volume` - Composite index for category + volume
- `idx_markets_raw_data_gin` - JSONB index
- `idx_markets_momentum_score` - Phase 2 signal
- `idx_markets_sii_score` - Phase 2 signal

**sync_logs table:**
- `idx_sync_logs_started_at` - Query recent syncs
- `idx_sync_logs_status` - Find failures

### Functions (4 total)

1. **`get_market_data_staleness()`**
   - Returns interval since last market update
   - Used to determine if sync is needed

2. **`get_last_successful_sync()`**
   - Returns info about last successful sync
   - Useful for monitoring

3. **`is_market_data_stale(threshold_minutes)`**
   - Returns TRUE if data older than threshold
   - Default: 5 minutes

4. **`update_markets_updated_at()`**
   - Trigger function to auto-update `updated_at` timestamp

### Triggers (1 total)

1. **`trigger_markets_updated_at`**
   - Fires BEFORE UPDATE on markets table
   - Automatically sets `updated_at = NOW()`

### Extensions

1. **`pg_trgm`** - PostgreSQL trigram extension for fuzzy text search

---

## Test Data Overview (if loaded)

The seed file inserts:

- **20 sample markets**
  - Mix of categories: Politics, Sports, Crypto, Entertainment
  - Mix of status: Active (18) and Closed (2)
  - Mix of volume: High ($500k), Medium ($85k), Low ($15k)
  - Edge cases: Very low/high prices, 50/50 odds, near end dates

- **5 sample sync logs**
  - 3 successful syncs
  - 1 partial sync (with errors)
  - 1 failed sync (rate limited)

---

## Troubleshooting

### Issue: "relation already exists"

**Solution**: Tables already exist. Either:
1. Drop tables first: `DROP TABLE IF EXISTS markets, sync_logs CASCADE;`
2. Or skip migration (already applied)

### Issue: "extension pg_trgm does not exist"

**Solution**: Supabase should have this extension available. If not:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### Issue: "permission denied"

**Solution**: Ensure you're logged into the correct Supabase project and have owner/admin access.

### Issue: "syntax error near..."

**Solution**: Make sure you copied the entire SQL file. The migration is a single atomic script.

---

## Next Steps After Migration

1. **Verify Schema**: Run all verification queries above

2. **Test Queries**: Try some sample queries
   ```sql
   -- Get active crypto markets sorted by volume
   SELECT title, volume_24h, current_price
   FROM markets
   WHERE active = TRUE AND category = 'Crypto'
   ORDER BY volume_24h DESC;

   -- Search for Bitcoin markets
   SELECT title, current_price, volume_24h
   FROM markets
   WHERE active = TRUE AND title ILIKE '%bitcoin%'
   ORDER BY volume_24h DESC;

   -- Get data staleness
   SELECT get_market_data_staleness() AS staleness;
   SELECT is_market_data_stale(5) AS needs_sync;
   ```

3. **Set Up RLS Policies** (if needed)
   - Determine if you need Row Level Security
   - Create policies based on your auth requirements

4. **Integrate with Application**
   - Update Supabase client queries
   - Test API endpoints
   - Implement sync job

5. **Monitor Performance**
   - Check query performance in Supabase Dashboard
   - Use `EXPLAIN ANALYZE` for slow queries
   - Add additional indexes if needed

---

## Support

- **Supabase Docs**: https://supabase.com/docs/guides/database/overview
- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **Migration File**: `/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251022131000_create_polymarket_tables.sql`
- **Seed File**: `/Users/scotty/Projects/Cascadian-app/supabase/seed/polymarket-test-data.sql`

---

## Migration Checklist

Use this checklist to track your progress:

- [ ] Opened Supabase Dashboard SQL Editor
- [ ] Copied migration SQL to clipboard
- [ ] Pasted and ran migration SQL
- [ ] Verified success message appeared
- [ ] Copied seed SQL to clipboard (if loading test data)
- [ ] Pasted and ran seed SQL (if loading test data)
- [ ] Verified seed success message (if loading test data)
- [ ] Ran table verification query
- [ ] Ran index count query
- [ ] Ran function count query
- [ ] Ran trigger verification query
- [ ] Tested sample market queries
- [ ] Verified test data loaded (if applicable)
- [ ] Migration complete! 🎉

---

**Migration prepared by**: database-architect agent
**Date**: 2025-10-22
**Status**: Ready to execute
