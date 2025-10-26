# Deployment & Integration Guide

Complete guide for deploying and integrating the Omega Scoring and Market SII systems.

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   DATA SOURCES                               │
├─────────────────────────────────────────────────────────────┤
│  Goldsky PnL Subgraph    │  Goldsky Positions Subgraph      │
│  (Realized PnL data)     │  (Current positions)             │
└──────────┬──────────────────────────┬────────────────────────┘
           │                          │
           v                          v
    ┌──────────────┐          ┌──────────────┐
    │   Wallet     │          │   Market     │
    │   Omega      │          │    SII       │
    │  Scoring     │          │ Calculation  │
    └──────┬───────┘          └──────┬───────┘
           │                          │
           v                          v
    ┌──────────────┐          ┌──────────────┐
    │ wallet_      │          │ market_sii   │
    │   scores     │          │   table      │
    │  (Postgres)  │          │ (Postgres)   │
    └──────┬───────┘          └──────┬───────┘
           │                          │
           └────────┬───────────────┬─┘
                    v               v
             ┌────────────────────────┐
             │   API Endpoints        │
             │   - /api/wallets/[]/score  │
             │   - /api/markets/[]/sii    │
             │   - /api/sii/refresh       │
             └──────────┬─────────────┘
                        v
               ┌──────────────────┐
               │   Frontend       │
               │   (Next.js)      │
               └──────────────────┘
```

## Database Setup

### 1. Apply All Migrations

All migrations should already be applied if you followed along. Verify:

```bash
# Check migration status
npx supabase db pull

# Apply any pending migrations
npx supabase db push
```

### 2. Verify Tables & Views

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('wallet_scores', 'market_sii');

-- Check views exist
SELECT table_name 
FROM information_schema.views 
WHERE table_schema = 'public';
```

Expected tables:
- `wallet_scores` ✅
- `market_sii` ✅

Expected views:
- `top_omega_wallets` ✅
- `hot_wallets` ✅
- `strongest_sii_signals` ✅

## Initial Data Population

### Step 1: Discover Active Wallets

```bash
# Discover wallets from top 50 markets
npx tsx scripts/discover-active-wallets.ts

# This will:
# - Query top 50 markets by volume
# - Get top 40 positions per market
# - Save unique wallets to discovered-wallets.json
```

Expected output: `discovered-wallets.json` with 500-2000 unique wallets

### Step 2: Score Discovered Wallets

For the wallet discovery script that supports scoring, replace it or run:

```bash
# Calculate Omega scores for 3 test wallets
npx tsx scripts/sync-omega-scores.ts

# View results
npx tsx scripts/calculate-omega-scores.ts
```

This populates `wallet_scores` table with initial data.

### Step 3: Calculate Market SII

The SII will be calculated on-demand or via continuous updates. Test with a single market:

```bash
# Test SII calculation (via API or script)
curl http://localhost:3000/api/markets/[conditionId]/sii?fresh=true
```

## Continuous Updates Setup

### Option 1: Cron Job (Recommended for Production)

Add to your server's crontab:

```bash
# Edit crontab
crontab -e

# Add this line (runs every hour)
0 * * * * cd /path/to/project && npx tsx scripts/continuous-sii-update.ts >> /var/log/sii-update.log 2>&1
```

What it does:
- Updates 50 oldest wallet scores
- Recalculates SII for top 100 markets
- Takes ~3-4 minutes
- Logs to `/var/log/sii-update.log`

### Option 2: Continuous Mode (for Development)

```bash
# Run in continuous mode (updates every hour)
npx tsx scripts/continuous-sii-update.ts --continuous

# Or use PM2 for production
pm2 start "npx tsx scripts/continuous-sii-update.ts --continuous" --name sii-updater
```

### Option 3: API-Triggered Updates

Call the batch refresh endpoint programmatically:

```bash
# Refresh all active markets
curl -X POST http://localhost:3000/api/sii/refresh

# Refresh specific markets
curl -X POST http://localhost:3000/api/sii/refresh \
  -H "Content-Type: application/json" \
  -d '{"market_ids": ["0x..."], "force": true}'
```

## API Endpoints Reference

### Wallet Scores

```bash
# Get cached score (1-hour TTL)
GET /api/wallets/[address]/score

# Force fresh calculation
GET /api/wallets/[address]/score?fresh=true

# Custom cache TTL (2 hours)
GET /api/wallets/[address]/score?ttl=7200
```

### Market SII

```bash
# Get SII for a market
GET /api/markets/[conditionId]/sii

# Get fresh calculation
GET /api/markets/[conditionId]/sii?fresh=true

# Get strongest signals across all markets
GET /api/markets/strongest/sii?limit=20
```

### Batch Operations

```bash
# Refresh all active markets
POST /api/sii/refresh
{}

# Refresh specific markets
POST /api/sii/refresh
{
  "market_ids": ["0x...", "0x..."],
  "force": true
}
```

## Database Queries

### Check System Health

```sql
-- How many wallets scored?
SELECT COUNT(*), 
       COUNT(*) FILTER (WHERE meets_minimum_trades = TRUE) as qualified
FROM wallet_scores;

-- How many markets have SII?
SELECT COUNT(*) FROM market_sii;

-- When was last update?
SELECT 
  MAX(calculated_at) as last_wallet_update
FROM wallet_scores;

SELECT 
  MAX(calculated_at) as last_sii_update
FROM market_sii;
```

### View Top Performers

```sql
-- Top Omega wallets
SELECT * FROM top_omega_wallets LIMIT 10;

-- Hot wallets (improving)
SELECT * FROM hot_wallets LIMIT 10;

-- Strongest SII signals
SELECT * FROM strongest_sii_signals LIMIT 10;
```

### Query Specific Data

```sql
-- Get wallet score
SELECT * FROM wallet_scores 
WHERE wallet_address = '0x...' 
LIMIT 1;

-- Get market SII
SELECT * FROM market_sii 
WHERE market_id = '0x...' 
LIMIT 1;

-- Markets where smart money is on YES
SELECT 
  market_question,
  yes_avg_omega,
  no_avg_omega,
  omega_differential,
  signal_strength
FROM market_sii
WHERE smart_money_side = 'YES'
  AND signal_strength > 0.7
ORDER BY signal_strength DESC;
```

## Monitoring & Debugging

### Check Update Logs

```bash
# If using cron
tail -f /var/log/sii-update.log

# If using PM2
pm2 logs sii-updater

# If running manually
npx tsx scripts/continuous-sii-update.ts
```

### Debug Failed Calculations

```typescript
// Test wallet scoring
npx tsx -e "
import { calculateWalletOmegaScore } from './lib/metrics/omega-from-goldsky';
const score = await calculateWalletOmegaScore('0x...');
console.log(score);
"

// Test SII calculation
npx tsx -e "
import { calculateMarketSII } from './lib/metrics/market-sii';
const sii = await calculateMarketSII('0x...');
console.log(sii);
"
```

### Performance Monitoring

```sql
-- Check cache hit rate
SELECT 
  COUNT(*) FILTER (WHERE calculated_at > NOW() - INTERVAL '1 hour') as fresh,
  COUNT(*) FILTER (WHERE calculated_at <= NOW() - INTERVAL '1 hour') as stale,
  COUNT(*) as total
FROM wallet_scores;

-- Average calculation age
SELECT 
  AVG(EXTRACT(EPOCH FROM (NOW() - calculated_at))/3600) as avg_age_hours
FROM market_sii;
```

## Troubleshooting

### Issue: 503 Errors from Goldsky

**Symptom:** Goldsky returns 503 "Service Unavailable"

**Solution:** Rate limiting. Add delays between requests:
```typescript
await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
```

### Issue: No SII Data for Market

**Possible Causes:**
1. Market has no positions
2. Wallets haven't been scored yet
3. conditionId is incorrect

**Debug:**
```typescript
// Check if market has positions
const positions = await getTopPositions(conditionId, '1', 20);
console.log('Positions found:', positions.length);

// Check if wallets have scores
const wallets = positions.map(p => p.user);
const scores = await getWalletOmegaScores(wallets);
console.log('Wallets with scores:', scores.size);
```

### Issue: Stale Scores

**Solution:** Lower TTL or force refresh:
```bash
# Force refresh specific wallet
GET /api/wallets/[address]/score?fresh=true

# Force refresh all markets
POST /api/sii/refresh
{"force": true}
```

## Production Deployment Checklist

- [ ] All migrations applied
- [ ] Environment variables set (.env.local)
- [ ] Initial wallet discovery completed
- [ ] Wallet scores populated
- [ ] Cron job configured
- [ ] Logs directory created (`/var/log/`)
- [ ] API endpoints tested
- [ ] Database views verified
- [ ] Monitoring alerts configured
- [ ] Backup strategy in place

## Environment Variables Required

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GOLDSKY_PNL_API=https://api.goldsky.com/api/public/project_.../subgraphs/...
GOLDSKY_POSITIONS_API=https://api.goldsky.com/api/public/project_.../subgraphs/...
```

## Next Steps

1. **Frontend Integration**
   - Display Omega grades on wallet profiles
   - Show SII badges on market cards
   - Add filters to Market Screener

2. **Advanced Features**
   - Real-time webhooks for new trades
   - SII momentum tracking (signal changes over time)
   - Automated trading signals

3. **Optimization**
   - Add Redis caching layer
   - Optimize database queries with materialized views
   - Implement incremental updates instead of full recalculation

## Support & Maintenance

**Weekly Tasks:**
- Check log files for errors
- Verify continuous updates are running
- Review stale data (> 24 hours old)

**Monthly Tasks:**
- Review and optimize database indexes
- Clear old log files
- Update Goldsky API endpoints if changed
- Backup `wallet_scores` and `market_sii` tables

**As Needed:**
- Scale up batch processing if adding more markets
- Adjust TTL based on data freshness requirements
- Add new markets to tracking list
