# Polymarket Trade Data Aggregation System

## Overview

This system aggregates real trade data from Polymarket's CLOB (Central Limit Order Book) API to calculate market analytics similar to hashdive.com.

## What It Does

Fetches trade history for each market and calculates:
- **Trade Counts**: Total trades, unique buyers, unique sellers (24h window)
- **Volume Metrics**: Buy volume, sell volume (in USD)
- **Sentiment Indicators**: Buy/Sell ratio (>1 = bullish, <1 = bearish)
- **Momentum Score**: Price velocity (price change per hour)
- **Price Change**: Percentage change over 24h

## Architecture

### Components

1. **Database Schema** (`/supabase/migrations/20251022220000_add_market_analytics.sql`)
   - `market_analytics` table stores aggregated metrics
   - Indexed for fast lookups by market_id, momentum, ratio, etc.
   - Helper functions for staleness checking

2. **Trade Aggregator** (`/lib/polymarket/trade-aggregator.ts`)
   - Fetches trades from CLOB API: `https://data-api.polymarket.com/trades`
   - Handles pagination (up to 10k trades per market)
   - Calculates analytics from raw trade data
   - Stores results in database via upsert

3. **API Endpoint** (`/app/api/polymarket/aggregate/route.ts`)
   - `POST /api/polymarket/aggregate` - Trigger aggregation (protected)
   - `GET /api/polymarket/aggregate` - Check status (public)
   - Authentication via `ADMIN_API_KEY` or `CRON_SECRET` env variable

4. **Markets API Integration** (`/app/api/polymarket/markets/route.ts`)
   - Optionally joins analytics data: `?include_analytics=true`
   - Supports sorting by momentum, trade count
   - Returns analytics in `market.analytics` field

## Usage

### Manual Trigger

Trigger aggregation for top 100 markets:

```bash
curl -X POST http://localhost:3000/api/polymarket/aggregate \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

### Check Status

```bash
curl http://localhost:3000/api/polymarket/aggregate
```

Response:
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
    "total_buy_volume_24h": 1234567.89,
    "total_sell_volume_24h": 1123456.78
  }
}
```

### Fetch Markets with Analytics

```bash
curl "http://localhost:3000/api/polymarket/markets?include_analytics=true&limit=10"
```

Response includes:
```json
{
  "data": [
    {
      "market_id": "529278",
      "title": "Irish Presidential Election",
      "volume_24h": 123456.78,
      "analytics": {
        "trades_24h": 450,
        "buyers_24h": 89,
        "sellers_24h": 76,
        "buy_sell_ratio": 1.17,
        "momentum_score": 2.34,
        "price_change_24h": 5.67
      }
    }
  ]
}
```

### Programmatic Usage

```typescript
import { aggregateMarketTrades, aggregateAllMarkets } from '@/lib/polymarket/trade-aggregator';

// Aggregate single market
const analytics = await aggregateMarketTrades(marketId, conditionId);

// Aggregate top 100 markets
const result = await aggregateAllMarkets(100);
console.log(`Processed ${result.processed} markets in ${result.duration_ms}ms`);
```

## Cron Job Setup

### Vercel Cron (Recommended)

1. Add to `vercel.json`:
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

2. Set `CRON_SECRET` in Vercel environment variables

3. Deploy - cron runs hourly automatically

### Alternative: GitHub Actions

```yaml
# .github/workflows/aggregate-trades.yml
name: Aggregate Trade Data
on:
  schedule:
    - cron: '0 * * * *'  # Every hour
jobs:
  aggregate:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Aggregation
        run: |
          curl -X POST https://yourdomain.com/api/polymarket/aggregate \
            -H "Authorization: Bearer ${{ secrets.ADMIN_API_KEY }}"
```

## Performance

- **Single Market**: 5-10 seconds (depending on trade volume)
- **100 Markets**: 3-5 minutes (with rate limiting delays)
- **Rate Limiting**: Processes 10 markets in parallel, 2 second delay between batches
- **CLOB API Limits**: 1000 trades per request, up to 10k total per market

## Database Schema

```sql
CREATE TABLE market_analytics (
  market_id TEXT PRIMARY KEY,
  condition_id TEXT NOT NULL,

  -- Trade counts (24h)
  trades_24h INTEGER DEFAULT 0,
  buyers_24h INTEGER DEFAULT 0,
  sellers_24h INTEGER DEFAULT 0,

  -- Volume (24h)
  buy_volume_24h NUMERIC(18, 2),
  sell_volume_24h NUMERIC(18, 2),

  -- Sentiment & Momentum
  buy_sell_ratio NUMERIC(10, 4),
  momentum_score NUMERIC(10, 4),
  price_change_24h NUMERIC(10, 4),

  -- Metadata
  last_aggregated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Analytics Formulas

### Buy/Sell Ratio
```
ratio = unique_buyers / unique_sellers
> 1 = bullish (more buyers than sellers)
< 1 = bearish (more sellers than buyers)
```

### Momentum Score
```
momentum = (price_change / time_span_hours) * 100

Example:
- Price went from 0.50 to 0.55 in 12 hours
- momentum = (0.05 / 12) * 100 = 0.417
- Positive = upward momentum
```

### Price Change
```
change = ((last_price - first_price) / first_price) * 100

Example:
- First trade: 0.50
- Last trade: 0.55
- change = ((0.55 - 0.50) / 0.50) * 100 = 10%
```

## Testing

### Run Test Script

```bash
npx tsx scripts/test-trade-aggregation.ts
```

This tests aggregation on a single high-volume market and verifies:
- CLOB API connectivity
- Analytics calculation
- Database storage
- Data retrieval

### Manual Testing

1. Apply migration:
```bash
supabase db push
```

2. Trigger aggregation:
```bash
curl -X POST http://localhost:3000/api/polymarket/aggregate \
  -H "Authorization: Bearer test_key"
```

3. Check results:
```bash
curl "http://localhost:3000/api/polymarket/markets?include_analytics=true&limit=5"
```

## Monitoring

### Check Staleness

```typescript
import { areAnalyticsStale, getAnalyticsStaleness } from '@/lib/polymarket/trade-aggregator';

const stale = await areAnalyticsStale(1); // 1 hour threshold
const staleness = await getAnalyticsStaleness();
console.log(`Analytics are ${staleness} old`);
```

### Database Queries

```sql
-- Get last aggregation time
SELECT last_aggregated_at
FROM market_analytics
ORDER BY last_aggregated_at DESC
LIMIT 1;

-- Find most bullish markets
SELECT *
FROM market_analytics
WHERE trades_24h > 0
ORDER BY buy_sell_ratio DESC
LIMIT 10;

-- Find highest momentum markets
SELECT *
FROM market_analytics
WHERE trades_24h > 0
ORDER BY momentum_score DESC
LIMIT 10;

-- Count markets with analytics
SELECT COUNT(*) FROM market_analytics;
```

## Error Handling

- **API Rate Limits**: Automatic retry with 5s delay
- **Missing Markets**: Logged and skipped, doesn't fail batch
- **Invalid Data**: Returns zeros for empty trade sets
- **Database Errors**: Logged with market_id for debugging

## Future Enhancements

1. **Real-time Updates**: WebSocket connection to CLOB for live trades
2. **Historical Analytics**: Store time-series data for trending
3. **Smart Money Tracking**: Identify and track high-value wallets
4. **Liquidity Analysis**: Calculate bid-ask spreads from order book
5. **Market Correlation**: Detect related markets moving together

## Environment Variables

```env
# Required for cron job authentication
ADMIN_API_KEY=your_secret_key
# OR
CRON_SECRET=your_cron_secret

# Supabase (already configured)
NEXT_PUBLIC_SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```

## Troubleshooting

### No trades returned

- Check `condition_id` is correct (64-char hex string)
- Verify market is active and has recent trades
- Check CLOB API status: `https://data-api.polymarket.com/`

### Slow performance

- Reduce `marketLimit` in `aggregateAllMarkets()`
- Increase `BATCH_DELAY_MS` to avoid rate limits
- Process fewer markets per cron run

### Stale data

- Check cron job is running: `vercel logs`
- Verify API key is set correctly
- Check `sync_logs` table for errors

## Related Files

- `/supabase/migrations/20251022220000_add_market_analytics.sql` - Database schema
- `/lib/polymarket/trade-aggregator.ts` - Core aggregation logic
- `/app/api/polymarket/aggregate/route.ts` - API endpoint
- `/app/api/polymarket/markets/route.ts` - Markets API with analytics
- `/scripts/test-trade-aggregation.ts` - Test script
- `/types/polymarket.ts` - TypeScript types

## API Documentation

### POST /api/polymarket/aggregate

Trigger trade data aggregation.

**Authentication**: Bearer token (ADMIN_API_KEY or CRON_SECRET)

**Query Params**:
- `limit` (optional): Max markets to process (default: 100)

**Response**:
```json
{
  "success": true,
  "message": "Trade aggregation completed",
  "processed": 98,
  "failed": 2,
  "duration_ms": 245000
}
```

### GET /api/polymarket/aggregate

Get aggregation status and summary statistics.

**Authentication**: None (public)

**Response**:
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
    "total_buy_volume_24h": 1234567.89,
    "total_sell_volume_24h": 1123456.78
  }
}
```

### GET /api/polymarket/markets?include_analytics=true

Fetch markets with optional analytics data.

**Query Params**:
- `include_analytics` (boolean): Include analytics data (default: false)
- `sort` (string): Sort by 'volume', 'momentum', 'trades' (default: volume)
- `limit`, `offset`, `category`, `active`: Standard filters

**Response**: See Markets API documentation
