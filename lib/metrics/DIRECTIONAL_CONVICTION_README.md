# Directional Conviction Calculator

## Overview

The Directional Conviction Calculator is a key component of Austin's TSI momentum trading strategy. It measures how strongly "smart money" (elite wallets) is aligned on a particular market direction by combining three weighted factors:

1. **Elite Consensus (50% weight)** - Percentage of elite wallets (Omega > 2.0) on this side
2. **Category Specialist Consensus (30% weight)** - Percentage of category specialists on this side
3. **Omega-Weighted Consensus (20% weight)** - Votes weighted by omega scores

The final conviction score ranges from 0 to 1, with Austin's entry threshold set at **0.9 (90% confident)**.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│               Directional Conviction Flow                    │
└─────────────────────────────────────────────────────────────┘

1. Fetch Elite Wallets (ClickHouse)
   ↓
   SELECT wallet_address, omega
   FROM wallet_metrics_complete
   WHERE metric_2_omega_net > 2.0
     AND metric_22_resolved_bets >= 10

2. Fetch Recent Positions (ClickHouse)
   ↓
   SELECT wallet_address, side
   FROM trades_raw
   WHERE condition_id = ?
     AND timestamp >= now() - INTERVAL 24 HOUR
     AND is_closed = 0

3. Fetch Category Specialists (Supabase)
   ↓
   SELECT wallet_address, category_omega
   FROM wallet_category_tags
   WHERE category = ?
     AND is_likely_specialist = true

4. Calculate Component Scores
   ↓
   - Elite Consensus: % on specified side
   - Specialist Consensus: % of specialists on side
   - Omega-Weighted: Weighted by omega scores

5. Combine into Final Score
   ↓
   conviction = 0.5 × elite + 0.3 × specialist + 0.2 × omega_weighted
```

## Usage

### Basic Example

```typescript
import { calculateDirectionalConviction } from '@/lib/metrics/directional-conviction';

const result = await calculateDirectionalConviction({
  marketId: '0x123...',
  conditionId: '0xabc...',
  side: 'YES',
  lookbackHours: 24
});

console.log(`Conviction: ${(result.directionalConviction * 100).toFixed(1)}%`);
console.log(`Meets threshold: ${result.meetsEntryThreshold}`);
```

### Integration with TSI

```typescript
import { calculateAndSaveTSI } from '@/lib/metrics/tsi-calculator';
import { calculateDirectionalConviction } from '@/lib/metrics/directional-conviction';

// Calculate both in parallel
const [tsi, conviction] = await Promise.all([
  calculateAndSaveTSI(marketId, 60),
  calculateDirectionalConviction({
    marketId,
    conditionId,
    side: 'YES'
  })
]);

// Austin's Strategy: ENTRY signal
if (tsi.crossoverSignal === 'BULLISH' && conviction.meetsEntryThreshold) {
  console.log('🎯 ENTRY SIGNAL!');
  // Place trade...
}

// Austin's Strategy: EXIT signal
if (tsi.crossoverSignal === 'BEARISH') {
  console.log('🚪 EXIT SIGNAL!');
  // Close position to free capital
}
```

### Compare Both Sides

```typescript
import { calculateBothSides } from '@/lib/metrics/directional-conviction';

const both = await calculateBothSides(marketId, conditionId, 24);

console.log(`YES conviction: ${(both.YES.directionalConviction * 100).toFixed(1)}%`);
console.log(`NO conviction: ${(both.NO.directionalConviction * 100).toFixed(1)}%`);

if (both.YES.directionalConviction > both.NO.directionalConviction) {
  console.log('Smart money favors YES');
}
```

### Batch Processing

```typescript
import { calculateConvictionBatch } from '@/lib/metrics/directional-conviction';

const markets = [
  { marketId: '0x123...', conditionId: '0xabc...', side: 'YES' as const },
  { marketId: '0x456...', conditionId: '0xdef...', side: 'YES' as const },
];

const results = await calculateConvictionBatch(markets, 5);

// Filter for high conviction
const highConviction = Array.from(results.values())
  .filter(r => r.meetsEntryThreshold);

console.log(`Found ${highConviction.length} high-conviction opportunities`);
```

## Formula Breakdown

### Component Calculations

#### 1. Elite Consensus (50% weight)

```typescript
elite_consensus_pct = elite_wallets_on_side / total_elite_wallets
```

**Example:**
- 8 elite wallets traded this market
- 7 are on YES side
- Elite consensus = 7/8 = 0.875 (87.5%)

#### 2. Category Specialist Consensus (30% weight)

```typescript
specialist_consensus_pct = specialists_on_side / total_specialists
```

**Example:**
- 5 category specialists traded
- 4 are on YES side
- Specialist consensus = 4/5 = 0.80 (80%)

If no specialists exist for this category, falls back to elite consensus.

#### 3. Omega-Weighted Consensus (20% weight)

```typescript
yes_weight = sum(omega for wallets on YES)
no_weight = sum(omega for wallets on NO)
omega_weighted_pct = yes_weight / (yes_weight + no_weight)
```

**Example:**
- YES side: Wallets with omega [3.2, 2.5, 2.1] = 7.8
- NO side: Wallets with omega [2.3] = 2.3
- Omega-weighted = 7.8 / (7.8 + 2.3) = 0.772 (77.2%)

### Final Score

```typescript
directional_conviction =
  0.50 × elite_consensus_pct +
  0.30 × specialist_consensus_pct +
  0.20 × omega_weighted_pct
```

**Example:**
```
= 0.50 × 0.875 + 0.30 × 0.80 + 0.20 × 0.772
= 0.4375 + 0.24 + 0.1544
= 0.832 (83.2%)
```

This does NOT meet the 0.9 threshold, so no entry signal would be generated.

## Edge Cases

### No Elite Wallets Traded

If no elite wallets have traded this market recently:

```typescript
{
  directionalConviction: 0.5,       // Neutral
  eliteConsensusPct: 0.5,
  categorySpecialistPct: 0.5,
  omegaWeightedConsensus: 0.5,
  meetsEntryThreshold: false,
  eliteWalletsCount: 0
}
```

### No Category Specialists

If no specialists exist for this category, the specialist component falls back to the elite consensus value:

```typescript
specialist_consensus_pct = elite_consensus_pct
```

### Equal Distribution

If wallets are evenly split (e.g., 4 on YES, 4 on NO):

```typescript
elite_consensus_pct = 0.5  // Neutral
```

### Only One Side Traded

If all elite wallets are on one side:

```typescript
elite_consensus_pct = 1.0  // 100% on that side
```

## Data Requirements

### ClickHouse Tables

#### wallet_metrics_complete
```sql
SELECT
  wallet_address,
  metric_2_omega_net as omega
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_2_omega_net > 2.0
  AND metric_22_resolved_bets >= 10
```

#### trades_raw
```sql
SELECT
  wallet_address,
  side,
  timestamp
FROM trades_raw
WHERE condition_id = ?
  AND timestamp >= now() - INTERVAL ? HOUR
  AND is_closed = 0
ORDER BY timestamp DESC
```

### Supabase Tables

#### markets
```sql
SELECT category
FROM markets
WHERE market_id = ?
```

#### wallet_category_tags
```sql
SELECT
  wallet_address,
  category_omega
FROM wallet_category_tags
WHERE category = ?
  AND is_likely_specialist = true
  AND category_omega > 2.0
```

## Output Schema

### ConvictionResult

```typescript
interface ConvictionResult {
  // Core scores (0-1)
  directionalConviction: number;      // Composite score
  eliteConsensusPct: number;          // Elite wallet consensus
  categorySpecialistPct: number;      // Specialist consensus
  omegaWeightedConsensus: number;     // Omega-weighted vote
  meetsEntryThreshold: boolean;       // >= 0.9 threshold

  // Supporting data
  eliteWalletsCount: number;          // Total elite wallets
  eliteWalletsOnSide: number;         // Elite wallets on this side
  specialistsCount: number;           // Total specialists
  specialistsOnSide: number;          // Specialists on this side
  totalOmegaWeight: number;           // Sum of omega scores

  // Metadata
  timestamp: Date;                    // When calculated
  marketId: string;                   // Market ID
  conditionId: string;                // Condition ID
  side: 'YES' | 'NO';                // Side evaluated
}
```

## Performance Considerations

### Query Optimization

- **Elite wallet lookup**: Indexed on `metric_2_omega_net` and `window`
- **Trade history**: Partitioned by month, ordered by `wallet_address, timestamp`
- **Category specialists**: Indexed on `category` and `is_likely_specialist`

### Caching Strategy

For high-frequency updates, consider caching elite wallet lists:

```typescript
// Cache elite wallets for 5 minutes
const ELITE_WALLET_CACHE_TTL = 5 * 60 * 1000;
let cachedEliteWallets: Map<string, number> | null = null;
let cacheTimestamp = 0;

function getCachedEliteWallets() {
  if (Date.now() - cacheTimestamp < ELITE_WALLET_CACHE_TTL) {
    return cachedEliteWallets;
  }
  return null;
}
```

### Batch Processing

When processing multiple markets, use `calculateConvictionBatch()` to:
- Reuse elite wallet queries
- Process in parallel with concurrency control
- Handle failures gracefully

## Testing

### Manual Testing

```typescript
// Test with known market
const result = await calculateDirectionalConviction({
  marketId: 'known-market-id',
  conditionId: 'known-condition-id',
  side: 'YES',
  lookbackHours: 24
});

console.log(JSON.stringify(result, null, 2));
```

### Unit Test Scenarios

1. **No elite wallets** → Returns neutral (0.5) conviction
2. **100% consensus** → Returns 1.0 on dominant component
3. **Equal split** → Returns ~0.5 overall
4. **No specialists** → Falls back to elite consensus
5. **Mixed signals** → Weighted average of components

## Integration Points

### 1. Signal Generator

```typescript
// lib/metrics/signal-generator.ts
import { calculateDirectionalConviction } from './directional-conviction';

const conviction = await calculateDirectionalConviction({...});
if (conviction.meetsEntryThreshold) {
  generateEntrySignal();
}
```

### 2. API Endpoints

```typescript
// app/api/conviction/[marketId]/route.ts
export async function GET(request: Request) {
  const conviction = await calculateDirectionalConviction({...});
  return Response.json(conviction);
}
```

### 3. Cron Jobs

```typescript
// scripts/calculate-conviction-signals.ts
const markets = await getActiveMarkets();
const results = await calculateConvictionBatch(markets);
```

### 4. Real-time Dashboard

```typescript
// components/conviction-gauge.tsx
const { data: conviction } = useSWR(
  `/api/conviction/${marketId}`,
  fetcher,
  { refreshInterval: 60000 } // Update every minute
);
```

## Configuration

### Environment Variables

```bash
# .env.local

# Conviction threshold (0-1)
ENTRY_CONVICTION_THRESHOLD=0.9

# Minimum elite wallets needed for signal
MIN_ELITE_WALLETS_FOR_CONVICTION=3

# Lookback window (hours)
CONVICTION_LOOKBACK_HOURS=24

# Feature flags
ENABLE_CATEGORY_SPECIALIST_WEIGHTING=true
ENABLE_OMEGA_WEIGHTED_CONSENSUS=true
```

### Runtime Configuration

```typescript
import { getConvictionThreshold } from './directional-conviction';

const threshold = getConvictionThreshold(); // Reads from env or defaults to 0.9
```

## Troubleshooting

### Low Conviction Despite Strong Elite Consensus

**Issue:** Elite consensus is 90%+ but overall conviction is below threshold.

**Cause:** Category specialist or omega-weighted components pulling down average.

**Solution:**
```typescript
// Check individual components
console.log(`Elite: ${result.eliteConsensusPct}`);
console.log(`Specialist: ${result.categorySpecialistPct}`);
console.log(`Omega-weighted: ${result.omegaWeightedConsensus}`);

// Adjust weights in formula if needed
```

### No Specialists Found

**Issue:** `specialistsCount = 0` for most markets.

**Cause:** Category tagging system hasn't run or category name mismatch.

**Solution:**
```sql
-- Check category names match
SELECT DISTINCT category FROM markets;
SELECT DISTINCT category FROM wallet_category_tags;

-- Run category tagging
npm run calculate-category-omega
```

### Stale Elite Wallet Data

**Issue:** Conviction doesn't reflect recent elite wallet changes.

**Cause:** `wallet_metrics_complete` not updated recently.

**Solution:**
```bash
# Refresh wallet metrics
npm run calculate-wallet-metrics

# Check last update
SELECT MAX(calculated_at) FROM wallet_metrics_complete;
```

## Future Enhancements

### 1. Time-Decay Weighting

Weight recent trades more heavily:

```typescript
const hoursSinceEntry = (now - tradeTimestamp) / (1000 * 60 * 60);
const decayFactor = Math.exp(-hoursSinceEntry / 24); // Decay over 24h
const weightedVote = omega * decayFactor;
```

### 2. Confidence Intervals

Add uncertainty bounds:

```typescript
interface ConvictionResult {
  directionalConviction: number;
  confidenceLower: number;  // 95% CI lower bound
  confidenceUpper: number;  // 95% CI upper bound
}
```

### 3. Category-Specific Thresholds

Different thresholds for different categories:

```typescript
const threshold = category === 'Politics' ? 0.95 : 0.90;
```

### 4. Multi-Market Basket Signals

Detect when multiple correlated markets align:

```typescript
const allBullish = markets.every(m => m.conviction.meetsEntryThreshold);
if (allBullish) {
  console.log('🎯 Basket signal: All AI markets bullish');
}
```

## References

- [CASCADIAN_MOMENTUM_STRATEGY_ADDENDUM.md](../../CASCADIAN_MOMENTUM_STRATEGY_ADDENDUM.md) - Full strategy specification
- [DATABASE_ARCHITECT_SPEC.md](../../DATABASE_ARCHITECT_SPEC.md) - 102 metrics system
- [tsi-calculator.ts](./tsi-calculator.ts) - TSI integration
- [Example usage](./directional-conviction.example.ts) - Code examples

## Support

For questions or issues:

1. Check the [troubleshooting section](#troubleshooting) above
2. Review [example usage](./directional-conviction.example.ts)
3. Examine ClickHouse/Supabase table schemas
4. Verify environment variables are set correctly

---

**Version:** 1.0
**Last Updated:** 2025-10-25
**Author:** Claude (Sonnet 4.5)
**Status:** Production Ready
