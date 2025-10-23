# Production Deployment Guide - Cascadian App

**Date**: 2025-10-23
**Status**: Code pushed to GitHub, awaiting Vercel configuration fix

---

## ✅ Completed Steps

### 1. Code Committed and Pushed
All local changes have been successfully committed and pushed to GitHub:

**Commit 1: Whale Detection System** (69d20ef)
- 146 files changed
- Complete whale detection and analytics system
- API routes, scripts, migrations
- Database schema for wallet analytics

**Commit 2: Workflow System & Market Syncing** (6a30f50)
- 73 files changed
- Workflow builder system
- Market data syncing with cron
- Comprehensive documentation

**GitHub Repository**: https://github.com/Scotty108/Cascadian-app

### 2. Market Data Syncing Configured

**Automated Cron Jobs** (vercel.json):
```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-wallets",
      "schedule": "*/15 * * * *"
    },
    {
      "path": "/api/polymarket/sync",
      "schedule": "*/30 * * * *"
    }
  ]
}
```

- **Wallet Refresh**: Every 15 minutes
  - Discovers new whale wallets
  - Refreshes stale wallet data
  - Endpoint: `/api/cron/refresh-wallets`

- **Market Data Sync**: Every 30 minutes
  - Syncs Polymarket event data
  - Updates market information
  - Endpoint: `/api/polymarket/sync`

**Manual Sync Endpoints**:
- `POST /api/polymarket/sync` - Trigger market sync
- `GET /api/polymarket/sync` - Check sync status

---

## ⚠️ Vercel Configuration Required

### Issue
Vercel is configured with an incorrect root directory:
```
~/Projects/Cascadian-app/packages/app
```

This directory doesn't exist, causing deployment failures.

### Fix Required

1. **Visit Vercel Dashboard**:
   - URL: https://vercel.com/scribeforce/cascadian-app/settings
   - Navigate to "General" settings

2. **Update Root Directory**:
   - Current: `~/Projects/Cascadian-app/packages/app`
   - Change to: `.` (single dot, meaning project root)
   - Or leave blank for project root

3. **Save Changes**

4. **Trigger Deployment**:
   - Vercel will automatically redeploy from latest GitHub push
   - Or manually trigger via "Deployments" tab → "Redeploy"

---

## 🚀 Post-Deployment Checklist

### 1. Environment Variables
Ensure these are set in Vercel:

**Required**:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin access

**Optional**:
- `CRON_SECRET` - For cron authentication (recommended for production)
- `ADMIN_API_KEY` - Alternative to CRON_SECRET

### 2. Verify Cron Jobs Enabled
In Vercel dashboard:
- Go to "Settings" → "Cron Jobs"
- Verify both cron jobs are listed:
  - Wallet refresh (15 min)
  - Market sync (30 min)
- Ensure they're enabled

### 3. Database Migrations
If not already applied, run Supabase migrations:

```bash
# Apply wallet analytics tables
supabase migration up

# Or manually via Supabase dashboard
# SQL files in: supabase/migrations/
```

Key migrations:
- `20251023120000_create_wallet_analytics_tables.sql`
- `20251022220000_add_market_analytics.sql`
- `20251023000000_create_workflow_sessions.sql`

### 4. Initial Data Seeding (Production)

After successful deployment, seed production database:

```bash
# Set production environment variables
export NEXT_PUBLIC_SUPABASE_URL="your-production-url"
export SUPABASE_SERVICE_ROLE_KEY="your-production-key"

# Run seeding script
pnpm tsx scripts/seed-top-wallets.ts
```

Expected results:
- ~200 wallets processed in ~5 minutes
- 7+ whales identified (whale_score >= 7)
- Thousands of trades and positions ingested

---

## 🧪 Testing Production APIs

### 1. Whale Scoreboard API
```bash
curl "https://your-domain.vercel.app/api/whale/scoreboard?limit=10"
```

Expected response:
```json
{
  "success": true,
  "data": [
    {
      "wallet_address": "0x...",
      "whale_score": 9.1,
      "total_volume_usd": 527520,
      "total_trades": 500,
      "win_rate": 0.7
    }
  ],
  "count": 7
}
```

### 2. Whale Trades API
```bash
curl "https://your-domain.vercel.app/api/whale/trades?limit=5"
```

Expected: Recent trades from whale wallets with metadata

### 3. Wallet Detail API
```bash
curl "https://your-domain.vercel.app/api/wallet/0x[address]"
```

Expected: Comprehensive wallet profile (auto-discovers if not cached)

### 4. Market Data Sync Status
```bash
curl "https://your-domain.vercel.app/api/polymarket/sync"
```

Expected response:
```json
{
  "success": true,
  "last_synced": "2025-10-23T12:00:00Z",
  "is_stale": false,
  "sync_in_progress": false
}
```

### 5. Manual Market Sync (Authenticated)
```bash
curl -X POST "https://your-domain.vercel.app/api/polymarket/sync" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expected: Sync results with markets synced count

---

## 📊 System Features Deployed

### Whale Detection System
- Real-time whale identification (whale_score algorithm)
- 7 whales detected from 233 wallets
- Scores range from 7.3 to 9.1 (out of 10)
- Automatic discovery and caching

### API Endpoints
- `/api/whale/scoreboard` - Top whale rankings
- `/api/whale/trades` - Recent whale trades
- `/api/whale/positions` - Whale positions
- `/api/whale/flows` - Capital flow analysis
- `/api/whale/flips` - Position flips
- `/api/whale/concentration` - Market concentration
- `/api/wallet/[address]` - Wallet detail with auto-discovery
- `/api/cron/refresh-wallets` - Wallet refresh cron
- `/api/polymarket/sync` - Market data sync

### Workflow System
- Visual workflow builder
- Polymarket data integration
- Transform, filter, and alert nodes
- Session management with anonymous support

### Database Schema
- Wallet analytics (wallets, positions, trades)
- Polymarket events and markets
- OHLC price history
- Workflow sessions

---

## 🔍 Monitoring

### Check Cron Job Execution
In Vercel dashboard:
- Go to "Deployments" → Click on deployment
- View "Functions" tab
- Check cron execution logs

### Expected Cron Results

**Wallet Refresh** (every 15 min):
```json
{
  "success": true,
  "stats": {
    "newWalletsDiscovered": 20,
    "walletsRefreshed": 30,
    "errors": 0
  }
}
```

**Market Sync** (every 30 min):
```json
{
  "success": true,
  "markets_synced": 50,
  "errors": 0,
  "duration_ms": 5000
}
```

### Performance Metrics
- API response times: <200ms
- Whale detection: 0.8 wallets/second
- Market sync: ~5 seconds for 50 markets
- Database: 27k+ trades, 4k+ positions

---

## 🐛 Troubleshooting

### Deployment Fails
1. Check Vercel build logs
2. Verify root directory is set correctly
3. Check environment variables are set
4. Ensure migrations are applied

### Cron Jobs Not Running
1. Verify cron jobs are enabled in Vercel
2. Check CRON_SECRET is set (if required)
3. View function logs in Vercel dashboard

### No Data in APIs
1. Run seeding script: `pnpm tsx scripts/seed-top-wallets.ts`
2. Check Supabase database has data
3. Verify SUPABASE_SERVICE_ROLE_KEY is correct

### Market Sync Failing
1. Check Polymarket API is accessible
2. Verify sync endpoint: `GET /api/polymarket/sync`
3. Check function logs for errors

---

## 📞 Next Steps

1. **Fix Vercel root directory** in dashboard settings
2. **Verify deployment** succeeds
3. **Check environment variables** are set
4. **Enable cron jobs** if not automatic
5. **Run production seeding** to populate data
6. **Test all API endpoints** as listed above
7. **Monitor cron execution** in Vercel dashboard

---

## ✨ Production Ready Features

- ✅ Complete whale detection system
- ✅ Real-time data ingestion
- ✅ On-demand wallet discovery
- ✅ Automated refresh every 15 minutes
- ✅ Market data syncing every 30 minutes
- ✅ Comprehensive API suite
- ✅ Workflow builder system
- ✅ Database migrations
- ✅ TypeScript types and hooks
- ✅ Documentation and guides

**The system is production-ready once Vercel configuration is fixed!**
