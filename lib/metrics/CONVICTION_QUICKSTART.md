# Directional Conviction - Quick Start Guide

## 5-Minute Setup

### Step 1: Install Dependencies

Dependencies are already installed if you're running the Cascadian app.

```bash
# Verify environment variables are set
grep -E "CLICKHOUSE|SUPABASE" .env.local
```

Required environment variables:
```bash
CLICKHOUSE_HOST=your-clickhouse-host
CLICKHOUSE_PASSWORD=your-password
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-key
```

### Step 2: Basic Usage

```typescript
import { calculateDirectionalConviction } from '@/lib/metrics/directional-conviction';

// Calculate conviction for a market
const result = await calculateDirectionalConviction({
  marketId: '0x123...',      // From Supabase markets table
  conditionId: '0xabc...',   // From Supabase markets.condition_id
  side: 'YES',               // Or 'NO'
  lookbackHours: 24          // Optional, defaults to 24
});

// Check if signal meets threshold
if (result.meetsEntryThreshold) {
  console.log('🎯 High conviction signal!');
  console.log(`Elite consensus: ${(result.eliteConsensusPct * 100).toFixed(1)}%`);
  console.log(`Overall conviction: ${(result.directionalConviction * 100).toFixed(1)}%`);
}
```

### Step 3: Test It

```bash
# Run the test suite
npx tsx scripts/test-directional-conviction.ts

# Or test with a specific market
npx tsx -e "
import { calculateDirectionalConviction } from './lib/metrics/directional-conviction';

const result = await calculateDirectionalConviction({
  marketId: 'your-market-id',
  conditionId: 'your-condition-id',
  side: 'YES'
});

console.log(result);
"
```

## Common Use Cases

### Use Case 1: Single Market Analysis

```typescript
const conviction = await calculateDirectionalConviction({
  marketId: '0x123...',
  conditionId: '0xabc...',
  side: 'YES'
});

console.log(`Conviction: ${(conviction.directionalConviction * 100).toFixed(1)}%`);
console.log(`Elite wallets on YES: ${conviction.eliteWalletsOnSide}/${conviction.eliteWalletsCount}`);
```

### Use Case 2: Compare Both Sides

```typescript
import { calculateBothSides } from '@/lib/metrics/directional-conviction';

const both = await calculateBothSides(marketId, conditionId, 24);

console.log(`YES: ${(both.YES.directionalConviction * 100).toFixed(1)}%`);
console.log(`NO: ${(both.NO.directionalConviction * 100).toFixed(1)}%`);

const stronger = both.YES.directionalConviction > both.NO.directionalConviction ? 'YES' : 'NO';
console.log(`Smart money favors: ${stronger}`);
```

### Use Case 3: Integration with TSI

```typescript
import { calculateAndSaveTSI } from '@/lib/metrics/tsi-calculator';
import { calculateDirectionalConviction } from '@/lib/metrics/directional-conviction';

// Calculate both in parallel
const [tsi, conviction] = await Promise.all([
  calculateAndSaveTSI(marketId, 60),
  calculateDirectionalConviction({ marketId, conditionId, side: 'YES' })
]);

// Austin's Strategy: Generate entry signal
if (tsi.crossoverSignal === 'BULLISH' && conviction.meetsEntryThreshold) {
  console.log('🎯 ENTRY SIGNAL!');
  console.log(`  TSI Fast: ${tsi.tsiFast.toFixed(2)}`);
  console.log(`  TSI Slow: ${tsi.tsiSlow.toFixed(2)}`);
  console.log(`  Conviction: ${(conviction.directionalConviction * 100).toFixed(1)}%`);
}

// Austin's Strategy: Generate exit signal
if (tsi.crossoverSignal === 'BEARISH') {
  console.log('🚪 EXIT SIGNAL - Close position to free capital');
}
```

### Use Case 4: Batch Processing

```typescript
import { calculateConvictionBatch } from '@/lib/metrics/directional-conviction';

const markets = [
  { marketId: '0x123...', conditionId: '0xabc...', side: 'YES' as const },
  { marketId: '0x456...', conditionId: '0xdef...', side: 'YES' as const },
  { marketId: '0x789...', conditionId: '0xghi...', side: 'NO' as const },
];

const results = await calculateConvictionBatch(markets, 5); // Process 5 at a time

// Filter for high conviction
const highConviction = Array.from(results.values())
  .filter(r => r.meetsEntryThreshold);

console.log(`Found ${highConviction.length} high-conviction opportunities`);
```

## Understanding the Output

```typescript
interface ConvictionResult {
  // Core scores (0-1 scale)
  directionalConviction: number;      // 0.832 = 83.2% conviction
  eliteConsensusPct: number;          // 0.875 = 87.5% elite consensus
  categorySpecialistPct: number;      // 0.800 = 80% specialist consensus
  omegaWeightedConsensus: number;     // 0.772 = 77.2% omega-weighted

  // Threshold check
  meetsEntryThreshold: boolean;       // true if >= 0.9 (90%)

  // Supporting data
  eliteWalletsCount: number;          // Total elite wallets traded (e.g., 8)
  eliteWalletsOnSide: number;         // Elite wallets on this side (e.g., 7)
  specialistsCount: number;           // Category specialists traded (e.g., 5)
  specialistsOnSide: number;          // Specialists on this side (e.g., 4)
  totalOmegaWeight: number;           // Sum of omega scores (e.g., 18.5)

  // Metadata
  timestamp: Date;
  marketId: string;
  conditionId: string;
  side: 'YES' | 'NO';
}
```

## Interpretation Guide

### Conviction Score Ranges

| Score | Interpretation | Action |
|-------|----------------|--------|
| 0.95+ | Very strong conviction | Strong entry signal |
| 0.90-0.95 | Strong conviction | Entry signal (Austin's threshold) |
| 0.75-0.90 | Moderate conviction | Monitor closely |
| 0.60-0.75 | Weak conviction | Wait for better setup |
| 0.50-0.60 | Low conviction | Avoid |
| < 0.50 | Contrarian conviction | Smart money on other side |

### Component Analysis

**Elite Consensus (50% weight)**
- High (>0.8): Most elite wallets agree
- Medium (0.6-0.8): Mixed but leaning
- Low (<0.6): No clear elite consensus

**Category Specialist (30% weight)**
- High (>0.8): Domain experts aligned
- Medium (0.6-0.8): Specialists moderately agree
- Low (<0.6): Specialists divided or absent

**Omega-Weighted (20% weight)**
- High (>0.8): Highest omega wallets aligned
- Medium (0.6-0.8): Quality wallets moderately aligned
- Low (<0.6): High-omega wallets divided

## Troubleshooting

### Issue: All conviction scores are 0.5

**Possible Causes:**
1. No elite wallets have traded this market
2. Market ID or condition ID is incorrect
3. Lookback window too short

**Solutions:**
```typescript
// Check if market exists
const { data } = await supabaseAdmin
  .from('markets')
  .select('market_id, condition_id')
  .eq('market_id', marketId);

console.log(data);

// Try longer lookback
const result = await calculateDirectionalConviction({
  marketId,
  conditionId,
  side: 'YES',
  lookbackHours: 168  // 7 days
});
```

### Issue: specialistsCount is always 0

**Possible Causes:**
1. Category tagging hasn't been run
2. Category name mismatch
3. No specialists exist for this category

**Solutions:**
```bash
# Run category tagging
npm run calculate-category-omega

# Check category names
npx tsx -e "
import { supabaseAdmin } from './lib/supabase';
const { data } = await supabaseAdmin
  .from('wallet_category_tags')
  .select('category, wallet_address')
  .eq('is_likely_specialist', true);
console.log(data);
"
```

### Issue: Performance is slow

**Possible Causes:**
1. Large lookback window
2. No caching
3. Processing too many markets at once

**Solutions:**
```typescript
// Reduce lookback window
const result = await calculateDirectionalConviction({
  marketId,
  conditionId,
  side: 'YES',
  lookbackHours: 12  // Instead of 24 or 168
});

// Use batch processing with smaller batch size
const results = await calculateConvictionBatch(markets, 3); // Instead of 5+
```

## API Endpoint Example

Create an API endpoint for conviction:

```typescript
// app/api/conviction/[marketId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { calculateDirectionalConviction } from '@/lib/metrics/directional-conviction';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: { marketId: string } }
) {
  try {
    const { marketId } = params;
    const searchParams = request.nextUrl.searchParams;
    const side = (searchParams.get('side') || 'YES') as 'YES' | 'NO';
    const lookbackHours = parseInt(searchParams.get('lookback') || '24');

    // Get condition_id from market
    const { data: market } = await supabaseAdmin
      .from('markets')
      .select('condition_id')
      .eq('market_id', marketId)
      .single();

    if (!market?.condition_id) {
      return NextResponse.json(
        { error: 'Market not found or missing condition_id' },
        { status: 404 }
      );
    }

    // Calculate conviction
    const result = await calculateDirectionalConviction({
      marketId,
      conditionId: market.condition_id,
      side,
      lookbackHours,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Conviction API error:', error);
    return NextResponse.json(
      { error: 'Failed to calculate conviction' },
      { status: 500 }
    );
  }
}
```

**Usage:**
```bash
# Get YES conviction for a market
curl http://localhost:3000/api/conviction/0x123...?side=YES&lookback=24

# Get NO conviction
curl http://localhost:3000/api/conviction/0x123...?side=NO&lookback=48
```

## Configuration

### Custom Threshold

```bash
# .env.local
ENTRY_CONVICTION_THRESHOLD=0.95  # More conservative than 0.9
```

```typescript
import { getConvictionThreshold } from '@/lib/metrics/directional-conviction';

const threshold = getConvictionThreshold(); // Returns 0.95 if env set
const meetsThreshold = conviction.directionalConviction >= threshold;
```

### Feature Flags

```bash
# .env.local
ENABLE_CATEGORY_SPECIALIST_WEIGHTING=true
ENABLE_OMEGA_WEIGHTED_CONSENSUS=true
MIN_ELITE_WALLETS_FOR_CONVICTION=3
```

## Next Steps

1. **Test with real data:**
   ```bash
   npx tsx scripts/test-directional-conviction.ts
   ```

2. **Create API endpoint** (see example above)

3. **Integrate with TSI** for signal generation

4. **Build UI dashboard** to display conviction scores

5. **Set up cron job** for periodic calculation

## Getting Help

### Documentation
- [Full README](./DIRECTIONAL_CONVICTION_README.md) - Complete API reference
- [Architecture Diagrams](./CONVICTION_ARCHITECTURE.md) - Visual guides
- [Example Usage](./directional-conviction.example.ts) - Code examples

### Data Sources
- ClickHouse `wallet_metrics_complete` - Elite wallet omega scores
- ClickHouse `trades_raw` - Recent wallet positions
- Supabase `markets` - Market categories
- Supabase `wallet_category_tags` - Category specialists

### Key Queries

**Check elite wallets:**
```sql
SELECT
  wallet_address,
  metric_2_omega_net as omega,
  metric_22_resolved_bets as trades
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_2_omega_net > 2.0
  AND metric_22_resolved_bets >= 10
LIMIT 10;
```

**Check recent positions:**
```sql
SELECT
  wallet_address,
  side,
  timestamp
FROM trades_raw
WHERE condition_id = 'your-condition-id'
  AND timestamp >= now() - INTERVAL 24 HOUR
  AND is_closed = 0
LIMIT 10;
```

**Check category specialists:**
```sql
SELECT
  wallet_address,
  category,
  category_omega
FROM wallet_category_tags
WHERE is_likely_specialist = true
  AND category_omega > 2.0
LIMIT 10;
```

---

**Ready to start?** Run the test suite:
```bash
npx tsx scripts/test-directional-conviction.ts
```

**Questions?** Check the [full documentation](./DIRECTIONAL_CONVICTION_README.md)
