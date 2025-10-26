# Austin Methodology: Top-Down Category Analysis

Find "winnable games" by analyzing categories from the top down.

## Overview

Austin's approach is fundamentally different from bottom-up wallet discovery:

1. **Identify best categories** where elite wallets succeed
2. **Find best markets** within those categories
3. **Follow elite wallets** who dominate that category

This creates a focused, high-probability approach to finding edges.

## Core Concept: "Winnable Games"

A category is a "winnable game" when:

- **Enough smart money**: ≥20 elite wallets (Omega > 2.0, n > 50)
- **They're winning**: Median omega ≥2.0
- **Clear edge exists**: Mean CLV ≥2% (Closing Line Value)
- **Worth the time**: Avg EV/hour ≥$10
- **Liquid enough**: Total volume ≥$100k

## Winnability Score (0-100)

```
Score = Elite Count Score (25 pts)
      + Median Omega Score (25 pts)
      + Mean CLV Score (20 pts)
      + EV/Hour Score (20 pts)
      + Volume Score (10 pts)
```

### Component Scoring

- **Elite Count**: (count / 50) × 25 = Max 25 points
- **Median Omega**: (omega / 5) × 25 = Max 25 points
- **Mean CLV**: (clv / 0.05) × 20 = Max 20 points
- **EV/Hour**: (ev / 20) × 20 = Max 20 points
- **Volume**: (volume / 1M) × 10 = Max 10 points

## Usage

### TypeScript/Node.js

```typescript
import {
  analyzeCategories,
  getCategoryAnalysis,
  getWinnableCategories,
  getCategoryRecommendation,
  refreshCategoryAnalytics,
} from '@/lib/metrics/austin-methodology'

// Get all categories ranked by winnability
const categories = await analyzeCategories('30d', 20)
console.log('Best category:', categories[0].category)
console.log('Winnability score:', categories[0].winnabilityScore)

// Get only winnable categories
const winnableCategories = await getWinnableCategories('30d')
console.log(`Found ${winnableCategories.length} winnable categories`)

// Deep dive into specific category
const politics = await getCategoryAnalysis('Politics', '30d', true, true)
if (politics.isWinnableGame) {
  console.log('Top markets:', politics.topMarkets)
  console.log('Follow these specialists:', politics.topSpecialists)
}

// Get personalized recommendation
const recommendation = await getCategoryRecommendation(['Politics', 'Crypto'])
console.log('Recommended category:', recommendation?.category)
```

### React Hooks

```typescript
import {
  useAustinMethodology,
  useCategoryAnalysis,
  useCategoryRecommendation,
} from '@/hooks/use-austin-methodology'

// In your component
function CategoryDashboard() {
  const { categories, winnableCategories, loading } = useAustinMethodology({
    window: '30d',
    limit: 20,
    autoFetch: true,
  })

  if (loading) return <Spinner />

  return (
    <div>
      <h1>Winnable Categories</h1>
      {winnableCategories.map(cat => (
        <CategoryCard key={cat.category} category={cat} />
      ))}
    </div>
  )
}

// Specific category
function CategoryDetail({ category }: { category: string }) {
  const { analysis, loading } = useCategoryAnalysis(category, {
    window: '30d',
    includeMarkets: true,
    includeSpecialists: true,
  })

  if (!analysis) return null

  return (
    <div>
      <h2>{analysis.category}</h2>
      <p>Winnability Score: {analysis.winnabilityScore}/100</p>

      <h3>Top Markets</h3>
      {analysis.topMarkets.map(market => (
        <MarketCard key={market.marketId} market={market} />
      ))}

      <h3>Top Specialists</h3>
      {analysis.topSpecialists.map(specialist => (
        <WalletCard key={specialist.walletAddress} wallet={specialist} />
      ))}
    </div>
  )
}

// Get recommendation
function Recommendation() {
  const { recommendation } = useCategoryRecommendation(['Politics', 'Crypto'])

  if (!recommendation) return <p>No recommendation available</p>

  return (
    <div>
      <h2>Recommended Category: {recommendation.category}</h2>
      <p>Score: {recommendation.winnabilityScore}/100</p>
    </div>
  )
}
```

### API Endpoints

#### Get All Categories

```bash
GET /api/austin/categories?window=30d&limit=20&winnableOnly=false
```

Response:
```json
{
  "success": true,
  "count": 20,
  "window": "30d",
  "categories": [
    {
      "category": "Politics",
      "categoryRank": 1,
      "metrics": {
        "eliteWalletCount": 45,
        "medianOmegaOfElites": 2.8,
        "meanCLVOfElites": 0.035,
        "avgEVPerHour": 18.5,
        "totalVolumeUsd": 2500000,
        "activeMarketCount": 120
      },
      "winnability": {
        "isWinnableGame": true,
        "winnabilityScore": 78.3,
        "criteria": {
          "hasEnoughElites": true,
          "hasHighOmega": true,
          "hasEdge": true,
          "isWorthTime": true,
          "hasLiquidity": true
        }
      },
      "topMarkets": [...],
      "topSpecialists": [...]
    }
  ]
}
```

#### Get Specific Category

```bash
GET /api/austin/categories/Politics?window=30d&includeMarkets=true&includeSpecialists=true
```

#### Get Recommendation

```bash
GET /api/austin/recommend?preferred=Politics,Crypto
```

#### Refresh Analytics (Cron Job)

```bash
POST /api/austin/refresh
{
  "window": "30d",
  "createMV": false
}
```

## Data Pipeline

### 1. ClickHouse: Category Analytics Table

```sql
CREATE TABLE category_analytics (
  category String,
  window Enum8('24h' = 1, '7d' = 2, '30d' = 3, 'lifetime' = 4),

  -- Winnability Metrics
  elite_wallet_count UInt32,
  median_omega_of_elites Decimal(12, 4),
  mean_clv_of_elites Decimal(10, 6),

  -- Market Stats
  total_volume_usd Decimal(18, 2),
  active_markets_24h UInt32,

  calculated_at DateTime,

  PRIMARY KEY (category, window)
)
```

### 2. Supabase: Wallet Category Tags

```sql
CREATE TABLE wallet_category_tags (
  wallet_address TEXT,
  category TEXT,
  category_omega DECIMAL(12, 4),
  trades_in_category INT,
  pct_of_wallet_trades DECIMAL(5, 4),
  is_likely_specialist BOOLEAN,
  is_likely_insider BOOLEAN,

  UNIQUE(wallet_address, category)
)
```

### 3. Refresh Schedule

Run `refreshCategoryAnalytics()` on a cron schedule:

- **Production**: Every 5 minutes
- **Development**: Every 30 minutes

```typescript
// Example cron job
import { refreshCategoryAnalytics } from '@/lib/metrics/austin-methodology'

export async function runCronJob() {
  await refreshCategoryAnalytics('30d')
  await refreshCategoryAnalytics('7d')
  await refreshCategoryAnalytics('24h')
}
```

## Testing

Run the comprehensive test suite:

```bash
npx tsx scripts/test-austin-methodology.ts
```

Tests cover:
1. ✅ Refresh analytics
2. ✅ Analyze all categories
3. ✅ Get winnable categories only
4. ✅ Deep dive into specific category
5. ✅ Get category recommendation
6. ✅ Winnability calculation
7. ✅ Cache performance

## Cache Layer

Built-in 5-minute TTL cache for performance:

- **Cache Key Format**: `categories:{window}:{limit}`
- **TTL**: 5 minutes
- **Invalidation**: On refresh

Cache provides ~95% speedup for repeated queries.

## Integration with Existing Systems

### Market SII (Smart Investor Index)

```typescript
// Combine Austin Methodology with Market SII
const category = await getCategoryAnalysis('Politics', '30d', true, false)
const topMarkets = category.topMarkets

for (const market of topMarkets) {
  const sii = await calculateMarketSII(market.marketId)
  console.log(`Market: ${market.question}`)
  console.log(`Elite Omega: ${market.avgEliteOmega}`)
  console.log(`SII Signal: ${sii.smart_money_side}`)
}
```

### TSI (Trading Signal Index)

```typescript
// Add TSI signals to market analysis
import { calculateTSI } from '@/lib/metrics/tsi-calculator'

const markets = await getTopMarketsInCategory('Politics', 10)
for (const market of markets) {
  const tsi = await calculateTSI(market.marketId)
  market.tsiSignal = tsi.signal
  market.conviction = tsi.conviction
}
```

### Omega Leaderboard

```typescript
// Find elite wallets in top categories
const winnableCategories = await getWinnableCategories('30d')
for (const category of winnableCategories) {
  const specialists = await getCategorySpecialists(category.category, 20)
  console.log(`${category.category} specialists:`, specialists)
}
```

## Performance Considerations

- **First Load**: ~2-5 seconds (database query)
- **Cached Load**: ~10-50ms (99% faster)
- **Refresh Time**: ~30-60 seconds (depends on data volume)
- **Memory Usage**: ~10MB per 100 categories

## Best Practices

1. **Always refresh on cron**: Don't rely on on-demand calculation
2. **Use cache**: Cache provides massive speedup
3. **Limit results**: Default to top 20 categories
4. **Focus on 30d window**: Best balance of signal vs noise
5. **Check winnability first**: Filter before deep analysis

## Roadmap

### Phase 1 (Current)
- ✅ Basic category analysis
- ✅ Winnability scoring
- ✅ Top markets in category
- ✅ Category specialists
- ✅ API endpoints
- ✅ React hooks

### Phase 2 (Next)
- ⬜ Real-time updates via WebSocket
- ⬜ Historical winnability trends
- ⬜ Category momentum (improving vs declining)
- ⬜ Sub-category drilling
- ⬜ Insider detection integration

### Phase 3 (Future)
- ⬜ ML-based category prediction
- ⬜ Cross-category correlation
- ⬜ Dynamic threshold optimization
- ⬜ Category arbitrage detection

## Examples

See `/scripts/test-austin-methodology.ts` for comprehensive examples.

## License

MIT
