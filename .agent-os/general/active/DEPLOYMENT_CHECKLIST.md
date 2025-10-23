# Trade Aggregation System - Deployment Checklist

## Pre-Deployment Verification

### Code Quality
- [x] TypeScript compiles without errors (`npx tsc --noEmit`)
- [x] All files created successfully
- [x] Types properly defined
- [x] No linting errors

### Files Created
- [x] `/supabase/migrations/20251022220000_add_market_analytics.sql` - Database schema
- [x] `/lib/polymarket/trade-aggregator.ts` - Core aggregation service
- [x] `/app/api/polymarket/aggregate/route.ts` - API endpoints
- [x] `/app/api/polymarket/markets/route.ts` - Enhanced markets API
- [x] `/types/polymarket.ts` - TypeScript types (updated)
- [x] `/scripts/test-trade-aggregation.ts` - Test script
- [x] `/lib/polymarket/TRADE_AGGREGATION.md` - System documentation
- [x] `/supabase/APPLY_ANALYTICS_MIGRATION.md` - Migration guide
- [x] `/TRADE_AGGREGATION_SUMMARY.md` - Implementation summary

## Deployment Steps

### Step 1: Apply Database Migration

**Option A: Supabase Dashboard (Recommended)**
1. Open: https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz
2. Go to SQL Editor
3. Create new query: "Market Analytics Migration"
4. Copy `/supabase/migrations/20251022220000_add_market_analytics.sql`
5. Paste and run
6. Verify: `SELECT COUNT(*) FROM market_analytics;` (should return 0)

**Option B: Supabase CLI**
```bash
supabase db push
```

**Verification:**
```sql
-- Should return 1 row
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'market_analytics';

-- Should return 7 indexes
SELECT COUNT(*)
FROM pg_indexes
WHERE tablename = 'market_analytics';
```

### Step 2: Set Environment Variables

Add to your environment (Vercel, local .env, etc.):

```env
# Required for API authentication
ADMIN_API_KEY=your_secret_key_here

# OR use for cron job only
CRON_SECRET=your_cron_secret_here

# Already configured (verify these exist)
NEXT_PUBLIC_SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```

**For Vercel:**
1. Go to project settings
2. Environment Variables
3. Add `ADMIN_API_KEY` or `CRON_SECRET`
4. Apply to Production, Preview, and Development

### Step 3: Test Locally (Optional but Recommended)

**Start dev server:**
```bash
pnpm dev
```

**Run test script:**
```bash
npx tsx scripts/test-trade-aggregation.ts
```

**Expected output:**
```
================================================================================
Trade Aggregation Test
================================================================================

Verifying market exists in database...
✅ Market found:
  Title: [Market Name]
  Volume 24h: $[Amount]

Running trade aggregation...
This may take 30-60 seconds...

✅ Aggregation completed in [X]ms

Results:
--------------------------------------------------------------------------------
{
  "market_id": "...",
  "trades_24h": 450,
  "buyers_24h": 89,
  "sellers_24h": 76,
  ...
}
--------------------------------------------------------------------------------

✅ Data successfully saved to database
✅ Test passed!
```

**Manual API test:**
```bash
# Check status (should return empty or previous data)
curl http://localhost:3000/api/polymarket/aggregate

# Trigger aggregation (requires ADMIN_API_KEY)
curl -X POST http://localhost:3000/api/polymarket/aggregate \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"

# Fetch markets with analytics
curl "http://localhost:3000/api/polymarket/markets?include_analytics=true&limit=5"
```

### Step 4: Deploy to Vercel

```bash
vercel --prod
```

Or push to main branch (if auto-deploy configured).

### Step 5: Set Up Cron Job

**Create/Update `vercel.json` in project root:**

```json
{
  "crons": [
    {
      "path": "/api/polymarket/aggregate",
      "schedule": "0 * * * *"
    }
  ]
}
```

**Commit and push:**
```bash
git add vercel.json
git commit -m "Add trade aggregation cron job"
git push
```

**Verify cron is configured:**
1. Go to Vercel dashboard
2. Project Settings > Cron Jobs
3. Should see: `/api/polymarket/aggregate` running hourly

### Step 6: Trigger First Aggregation

**Via API:**
```bash
curl -X POST https://yourdomain.com/api/polymarket/aggregate \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

**Via Vercel Dashboard:**
1. Go to Deployments
2. Find latest deployment
3. Go to Functions
4. Find `/api/polymarket/aggregate`
5. Click "Invoke" (if available)

**Expected response:**
```json
{
  "success": true,
  "message": "Trade aggregation completed",
  "processed": 98,
  "failed": 2,
  "duration_ms": 245000
}
```

### Step 7: Verify Data

**Check aggregation status:**
```bash
curl https://yourdomain.com/api/polymarket/aggregate
```

**Expected response:**
```json
{
  "success": true,
  "last_aggregation": "2025-10-22T22:15:30Z",
  "staleness": "00:15:30",
  "total_markets": 100,
  "active_markets": 98,
  "summary": {
    "total_trades_24h": 45230,
    "total_buyers_24h": 8932,
    "total_sellers_24h": 7821,
    ...
  }
}
```

**Fetch markets with analytics:**
```bash
curl "https://yourdomain.com/api/polymarket/markets?include_analytics=true&limit=5"
```

**Verify in database:**
```sql
-- Check analytics exist
SELECT COUNT(*) FROM market_analytics;

-- View sample data
SELECT
  market_id,
  trades_24h,
  buyers_24h,
  sellers_24h,
  buy_sell_ratio,
  momentum_score,
  last_aggregated_at
FROM market_analytics
ORDER BY trades_24h DESC
LIMIT 10;
```

## Post-Deployment Monitoring

### Day 1: Initial Verification
- [ ] Cron job ran successfully (check Vercel logs)
- [ ] Analytics data populated in database
- [ ] Markets API returns analytics correctly
- [ ] No errors in Vercel function logs

### Week 1: Performance Monitoring
- [ ] Aggregation completes within 5 minutes
- [ ] No rate limiting issues from CLOB API
- [ ] Database performance is good (queries < 100ms)
- [ ] Cron job runs reliably every hour

### Ongoing: Data Quality
- [ ] Analytics update regularly (check staleness)
- [ ] Metrics look reasonable (spot check buy/sell ratios)
- [ ] No stale data (all updated within 2 hours)
- [ ] Error rate < 5% (check sync_logs if added)

## Monitoring Queries

```sql
-- Check last aggregation time
SELECT MAX(last_aggregated_at) FROM market_analytics;

-- Count markets with analytics
SELECT COUNT(*) FROM market_analytics;

-- Check staleness (should be < 1 hour)
SELECT are_analytics_stale(1);

-- Find most active markets
SELECT
  m.title,
  ma.trades_24h,
  ma.buyers_24h,
  ma.sellers_24h,
  ma.buy_sell_ratio
FROM market_analytics ma
JOIN markets m ON m.market_id = ma.market_id
ORDER BY ma.trades_24h DESC
LIMIT 10;

-- Find highest momentum markets
SELECT * FROM get_top_momentum_markets(10);

-- Find most bullish markets
SELECT * FROM get_most_bullish_markets(10);
```

## Troubleshooting

### Migration fails
**Error**: "relation already exists"
- **Solution**: Migration already applied, safe to ignore

**Error**: "foreign key violation"
- **Solution**: Ensure `markets` table exists first
- **Fix**: Apply previous migration `20251022140000_create_polymarket_tables_v2.sql`

### Aggregation fails
**Error**: 401 Unauthorized
- **Solution**: Set `ADMIN_API_KEY` or `CRON_SECRET` environment variable

**Error**: Timeout after 300s
- **Solution**: Reduce batch size or market limit in aggregator
- **Fix**: Call with `?limit=50` instead of default 100

**Error**: CLOB API returns 429
- **Solution**: Increase delay between batches
- **Fix**: Change `BATCH_DELAY_MS` from 2000 to 5000 in trade-aggregator.ts

### No analytics data
**Symptom**: Markets API returns empty analytics
- **Check**: Has first aggregation run? `SELECT COUNT(*) FROM market_analytics;`
- **Fix**: Trigger manual aggregation via POST endpoint

**Symptom**: Analytics are stale (> 2 hours old)
- **Check**: Is cron job running? Check Vercel logs
- **Fix**: Verify `vercel.json` cron config is deployed

### Performance issues
**Symptom**: Aggregation takes > 5 minutes
- **Check**: How many markets are being processed?
- **Fix**: Reduce market limit to 50-75
- **Fix**: Increase parallel batch size if server can handle it

**Symptom**: High database CPU
- **Check**: Are indexes created? Run index verification query
- **Fix**: Apply migration if indexes missing

## Rollback Plan

If issues arise, you can disable the system without data loss:

### Option 1: Disable Cron
Remove from `vercel.json`:
```json
{
  "crons": []
}
```

### Option 2: Drop Table (Nuclear)
```sql
DROP TABLE IF EXISTS market_analytics CASCADE;
```

Then remove:
- Analytics-related code from markets API
- Trade aggregator service
- API endpoint

## Success Criteria

System is working correctly when:
- [x] Migration applied successfully
- [x] Cron job runs hourly without errors
- [x] Analytics data updates every hour
- [x] Markets API returns analytics when requested
- [x] Test script passes
- [x] No TypeScript errors
- [x] Aggregation completes in < 5 minutes
- [x] Data looks reasonable (spot checks pass)

## Support Resources

- **System Documentation**: `/lib/polymarket/TRADE_AGGREGATION.md`
- **Implementation Summary**: `/TRADE_AGGREGATION_SUMMARY.md`
- **Migration Guide**: `/supabase/APPLY_ANALYTICS_MIGRATION.md`
- **Test Script**: `/scripts/test-trade-aggregation.ts`

## Quick Commands Reference

```bash
# Test locally
npx tsx scripts/test-trade-aggregation.ts

# Deploy to Vercel
vercel --prod

# Check TypeScript
npx tsc --noEmit

# Trigger aggregation (production)
curl -X POST https://yourdomain.com/api/polymarket/aggregate \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Check status
curl https://yourdomain.com/api/polymarket/aggregate

# Fetch markets with analytics
curl "https://yourdomain.com/api/polymarket/markets?include_analytics=true&limit=5"
```

## Environment Variables Checklist

```env
# Required
ADMIN_API_KEY=xxx                    # [x] Set in Vercel
NEXT_PUBLIC_SUPABASE_URL=xxx         # [x] Already configured
SUPABASE_SERVICE_ROLE_KEY=xxx        # [x] Already configured

# Optional
CRON_SECRET=xxx                      # [ ] Alternative to ADMIN_API_KEY
```

---

**Ready to deploy!** Follow the steps above and verify each checkpoint.
