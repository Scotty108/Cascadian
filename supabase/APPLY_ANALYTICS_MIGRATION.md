# Apply Market Analytics Migration

This migration adds the `market_analytics` table for trade data aggregation.

## Quick Steps

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz
   - Navigate to: **SQL Editor** (left sidebar)

2. **Create New Query**
   - Click **"New query"** button
   - Name it: "Market Analytics Migration"

3. **Copy Migration SQL**
   - Open: `/supabase/migrations/20251022220000_add_market_analytics.sql`
   - Select all (Cmd+A / Ctrl+A)
   - Copy (Cmd+C / Ctrl+C)

4. **Paste and Run**
   - Paste into the SQL Editor
   - Click **"Run"** (or press Cmd+Enter)
   - Wait for "Success" message (should take 2-3 seconds)

5. **Verify Table Created**
   ```sql
   SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name = 'market_analytics';
   ```
   - You should see 1 row: `market_analytics`

6. **Check Indexes**
   ```sql
   SELECT indexname
   FROM pg_indexes
   WHERE schemaname = 'public'
   AND tablename = 'market_analytics'
   ORDER BY indexname;
   ```
   - You should see 7 indexes

## Verification Query

Run this to verify everything is set up correctly:

```sql
-- Verify table structure
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'market_analytics'
ORDER BY ordinal_position;
```

Expected columns:
- market_id (TEXT, PRIMARY KEY)
- condition_id (TEXT)
- trades_24h (INTEGER)
- buyers_24h (INTEGER)
- sellers_24h (INTEGER)
- buy_volume_24h (NUMERIC)
- sell_volume_24h (NUMERIC)
- buy_sell_ratio (NUMERIC)
- momentum_score (NUMERIC)
- price_change_24h (NUMERIC)
- last_aggregated_at (TIMESTAMPTZ)
- created_at (TIMESTAMPTZ)
- updated_at (TIMESTAMPTZ)

## Test Helper Functions

After migration, test the helper functions:

```sql
-- Check if analytics are stale (returns true if > 1 hour old)
SELECT are_analytics_stale(1);

-- Get staleness interval
SELECT get_analytics_staleness();

-- Get top momentum markets (will be empty until first aggregation)
SELECT * FROM get_top_momentum_markets(5);

-- Get most bullish markets (will be empty until first aggregation)
SELECT * FROM get_most_bullish_markets(5);
```

## Troubleshooting

### "relation already exists" error
- Table already created, migration already applied
- Safe to ignore if re-running

### "permission denied" error
- Make sure you're logged into the correct Supabase project
- Check you have owner/admin access

### "foreign key violation" error
- Ensure `markets` table exists first
- Run previous migration: `20251022140000_create_polymarket_tables_v2.sql`

## After Migration

Once complete, you can:

1. **Run test script** to verify aggregation works:
   ```bash
   npx tsx scripts/test-trade-aggregation.ts
   ```

2. **Trigger manual aggregation**:
   ```bash
   curl -X POST http://localhost:3000/api/polymarket/aggregate \
     -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
   ```

3. **Check aggregation status**:
   ```bash
   curl http://localhost:3000/api/polymarket/aggregate
   ```

4. **Fetch markets with analytics**:
   ```bash
   curl "http://localhost:3000/api/polymarket/markets?include_analytics=true&limit=5"
   ```

The database is now ready for trade data aggregation!
