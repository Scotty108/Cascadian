# Austin Methodology - Quick Start Guide

## TL;DR

Austin's methodology finds "winnable games" by analyzing categories top-down instead of bottom-up.

```typescript
import { analyzeCategories, getCategoryAnalysis } from '@/lib/metrics/austin-methodology'

// Get best categories
const categories = await analyzeCategories('30d', 20)
const bestCategory = categories[0]

// Deep dive
const analysis = await getCategoryAnalysis(bestCategory.category, '30d')
console.log('Follow these wallets:', analysis.topSpecialists)
console.log('Trade these markets:', analysis.topMarkets)
```

## The Philosophy

**Instead of:**
1. Find smart wallets
2. See what they're trading
3. Hope to find an edge

**Do this:**
1. Find categories where smart money wins consistently
2. Find the best markets in those categories
3. Follow the specialists who dominate

## Winnability Criteria

A category is "winnable" if ALL of these are true:

| Metric | Threshold | Why |
|--------|-----------|-----|
| Elite Wallets | ≥20 | Enough smart money to follow |
| Median Omega | ≥2.0 | They're actually winning |
| Mean CLV | ≥2% | Clear edge on closing prices |
| Avg EV/Hour | ≥$10 | Worth your time |
| Total Volume | ≥$100k | Liquid enough to trade |

## Quick Examples

### Example 1: Find Best Category

```typescript
const categories = await analyzeCategories('30d', 20)
const bestCategory = categories[0]

console.log(`Best Category: ${bestCategory.category}`)
console.log(`Winnability Score: ${bestCategory.winnabilityScore}/100`)
console.log(`Elite Wallets: ${bestCategory.eliteWalletCount}`)
console.log(`Median Omega: ${bestCategory.medianOmegaOfElites}`)
```

### Example 2: Get Winnable Categories Only

```typescript
import { getWinnableCategories } from '@/lib/metrics/austin-methodology'

const winnableCategories = await getWinnableCategories('30d')
console.log(`Found ${winnableCategories.length} winnable categories`)
winnableCategories.forEach(cat => {
  console.log(`- ${cat.category} (${cat.winnabilityScore.toFixed(1)}/100)`)
})
```

### Example 3: Deep Dive into Category

```typescript
const politics = await getCategoryAnalysis('Politics', '30d', true, true)

if (politics.isWinnableGame) {
  console.log('✅ Politics is winnable!')

  // Top 3 markets
  politics.topMarkets.slice(0, 3).forEach(market => {
    console.log(`Market: ${market.question}`)
    console.log(`Elite participation: ${market.eliteParticipation * 100}%`)
  })

  // Top 5 specialists to follow
  politics.topSpecialists.slice(0, 5).forEach(specialist => {
    console.log(`Wallet: ${specialist.walletAddress}`)
    console.log(`Category Omega: ${specialist.categoryOmega}`)
    console.log(`${specialist.pctOfWalletTrades * 100}% of their trades`)
  })
}
```

### Example 4: React Component

```tsx
import { useAustinMethodology } from '@/hooks/use-austin-methodology'

export function CategoryDashboard() {
  const { winnableCategories, loading } = useAustinMethodology({
    window: '30d',
    limit: 20,
  })

  if (loading) return <Spinner />

  return (
    <div>
      <h1>Winnable Categories</h1>
      <p>Found {winnableCategories.length} categories worth trading</p>

      {winnableCategories.map(cat => (
        <div key={cat.category} className="category-card">
          <h3>{cat.category}</h3>
          <p>Score: {cat.winnabilityScore.toFixed(1)}/100</p>
          <p>Elite Wallets: {cat.eliteWalletCount}</p>
          <p>Median Omega: {cat.medianOmegaOfElites.toFixed(2)}</p>
          <button>View Details</button>
        </div>
      ))}
    </div>
  )
}
```

### Example 5: API Usage

```bash
# Get all categories
curl "http://localhost:3000/api/austin/categories?window=30d&limit=20"

# Get winnable categories only
curl "http://localhost:3000/api/austin/categories?window=30d&winnableOnly=true"

# Get specific category
curl "http://localhost:3000/api/austin/categories/Politics?window=30d"

# Get recommendation
curl "http://localhost:3000/api/austin/recommend?preferred=Politics,Crypto"

# Refresh analytics (POST)
curl -X POST "http://localhost:3000/api/austin/refresh" \
  -H "Content-Type: application/json" \
  -d '{"window": "30d"}'
```

## Winnability Score Breakdown

The score is calculated from 5 components (0-100 total):

```
Elite Count Score (25 points max):
  - 50+ elite wallets = 25 points
  - 25 elite wallets = 12.5 points
  - <10 elite wallets = <5 points

Median Omega Score (25 points max):
  - Omega 5.0+ = 25 points
  - Omega 2.5 = 12.5 points
  - Omega 1.0 = 5 points

Mean CLV Score (20 points max):
  - CLV 5%+ = 20 points
  - CLV 2.5% = 10 points
  - CLV 1% = 4 points

EV/Hour Score (20 points max):
  - $20+/hour = 20 points
  - $10/hour = 10 points
  - $5/hour = 5 points

Volume Score (10 points max):
  - $1M+ volume = 10 points
  - $500k volume = 5 points
  - $100k volume = 1 point
```

## Common Patterns

### Pattern 1: Category-First Discovery

```typescript
// 1. Find winnable categories
const categories = await getWinnableCategories('30d')

// 2. Pick top category
const topCategory = categories[0]

// 3. Get specialists in that category
const analysis = await getCategoryAnalysis(topCategory.category, '30d')

// 4. Follow these wallets
const walletsToFollow = analysis.topSpecialists
  .filter(s => s.categoryOmega > 3.0)
  .map(s => s.walletAddress)
```

### Pattern 2: Specialist-Based Trading

```typescript
// 1. Find category specialists
const politics = await getCategoryAnalysis('Politics', '30d')

// 2. Find their recent trades
for (const specialist of politics.topSpecialists) {
  const trades = await getWalletTrades(specialist.walletAddress, 7)
  console.log(`${specialist.walletAddress} recent activity:`)
  console.log(trades)
}
```

### Pattern 3: Market Selection

```typescript
// 1. Get category analysis
const crypto = await getCategoryAnalysis('Crypto', '30d')

// 2. Filter high-quality markets
const goodMarkets = crypto.topMarkets.filter(market =>
  market.eliteParticipation > 0.3 &&  // >30% elite participation
  market.avgEliteOmega > 2.5 &&       // High omega traders
  market.liquidity > 10000            // Liquid enough
)

// 3. Trade these markets
console.log('Trade these markets:', goodMarkets)
```

## Integration with Other Systems

### With Market SII

```typescript
import { calculateMarketSII } from '@/lib/metrics/market-sii'

const category = await getCategoryAnalysis('Politics', '30d')
for (const market of category.topMarkets) {
  const sii = await calculateMarketSII(market.marketId)

  if (sii.smart_money_side === 'YES' && sii.signal_strength > 0.7) {
    console.log(`Strong YES signal on: ${market.question}`)
  }
}
```

### With TSI Calculator

```typescript
import { calculateTSI } from '@/lib/metrics/tsi-calculator'

const category = await getCategoryAnalysis('Crypto', '30d')
for (const market of category.topMarkets) {
  const tsi = await calculateTSI(market.marketId)

  if (tsi.signal === 'BULLISH' && tsi.conviction > 0.8) {
    console.log(`High conviction BULLISH on: ${market.question}`)
  }
}
```

### With Omega Leaderboard

```typescript
// Find elite wallets in top categories
const categories = await getWinnableCategories('30d')
const allSpecialists = []

for (const category of categories) {
  const analysis = await getCategoryAnalysis(category.category, '30d')
  allSpecialists.push(...analysis.topSpecialists)
}

// Get unique wallets sorted by average omega
const uniqueWallets = [...new Set(allSpecialists.map(s => s.walletAddress))]
console.log(`Found ${uniqueWallets.length} elite specialists across categories`)
```

## Performance Tips

1. **Use cache**: Second call is 99% faster
2. **Limit results**: Default to top 20 categories
3. **Batch requests**: Fetch multiple categories in parallel
4. **Use 30d window**: Best signal-to-noise ratio
5. **Filter early**: Use `winnableOnly=true` in API

## Troubleshooting

### No winnable categories found

```typescript
// Check thresholds
import { WINNABILITY_THRESHOLDS } from '@/lib/metrics/austin-methodology'
console.log(WINNABILITY_THRESHOLDS)

// Try lower threshold temporarily
const categories = await analyzeCategories('30d', 50)
const almostWinnable = categories.filter(c => c.winnabilityScore > 50)
```

### Category data is stale

```typescript
// Refresh analytics
await refreshCategoryAnalytics('30d')

// Check last calculated time
const politics = await getCategoryAnalysis('Politics', '30d')
console.log('Last updated:', politics.calculatedAt)
```

### Slow performance

```typescript
// Don't fetch markets/specialists if not needed
const analysis = await getCategoryAnalysis('Politics', '30d', false, false)

// Use smaller limit
const categories = await analyzeCategories('30d', 5)
```

## Next Steps

1. **Run test script**: `npx tsx scripts/test-austin-methodology.ts`
2. **Set up cron job**: Refresh analytics every 5 minutes
3. **Build UI**: Use React hooks to create dashboard
4. **Integrate**: Combine with SII and TSI systems

## Resources

- **Full Docs**: `/lib/metrics/AUSTIN_METHODOLOGY.md`
- **Test Script**: `/scripts/test-austin-methodology.ts`
- **API Routes**: `/app/api/austin/*`
- **React Hooks**: `/hooks/use-austin-methodology.ts`
