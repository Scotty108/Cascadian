# TSI Calculator - Quick Reference Card

One-page reference for the TSI calculator.

## Installation Check

```bash
# Verify files exist
ls -la lib/metrics/tsi-calculator.ts
ls -la lib/metrics/smoothing.ts

# Run tests
npx tsx lib/metrics/tsi-calculator.test.ts

# Run examples
npx tsx lib/metrics/tsi-calculator.example.ts 1
```

## Import Statements

```typescript
// Main functions
import {
  calculateTSI,
  calculateAndSaveTSI,
  calculateTSIBatch,
  loadTSIConfig,
  fetchPriceHistory,
  type TSIConfig,
  type TSIResult,
  type PricePoint
} from '@/lib/metrics/tsi-calculator';

// Smoothing utilities
import {
  sma,
  ema,
  rma,
  doubleSmooth,
  type SmoothingMethod
} from '@/lib/metrics/smoothing';
```

## Common Usage Patterns

### Pattern 1: Calculate for One Market

```typescript
const result = await calculateAndSaveTSI('0x123...', 60);
console.log(result.crossoverSignal); // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
```

### Pattern 2: Batch Processing

```typescript
const marketIds = ['0x123...', '0x456...', '0x789...'];
const results = await calculateTSIBatch(marketIds, 60);
```

### Pattern 3: Custom Configuration

```typescript
const config: TSIConfig = {
  fastPeriods: 9,
  fastSmoothing: 'RMA',
  slowPeriods: 21,
  slowSmoothing: 'RMA'
};

const priceHistory = await fetchPriceHistory(marketId, 60);
const result = await calculateTSI(priceHistory, config);
```

### Pattern 4: Trading Signal

```typescript
const tsi = await calculateAndSaveTSI(marketId, 60);

if (tsi.crossoverSignal === 'BULLISH' && conviction >= 0.9) {
  return { signal: 'ENTRY', confidence: 'HIGH' };
}
```

## Types

```typescript
interface TSIConfig {
  fastPeriods: number;
  fastSmoothing: SmoothingMethod;
  slowPeriods: number;
  slowSmoothing: SmoothingMethod;
}

interface TSIResult {
  tsiFast: number;              // -100 to 100
  tsiSlow: number;              // -100 to 100
  crossoverSignal: string;      // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  crossoverTimestamp?: Date;
  momentumValues: number[];
}

type SmoothingMethod = 'SMA' | 'EMA' | 'RMA';
```

## Interpretation

```typescript
// BULLISH Signal
if (result.crossoverSignal === 'BULLISH') {
  // Fast line crossed above slow line
  // Momentum turning positive
  // → Consider ENTRY if conviction high
}

// BEARISH Signal
if (result.crossoverSignal === 'BEARISH') {
  // Fast line crossed below slow line
  // Momentum turning negative
  // → Consider EXIT immediately
}

// NEUTRAL
if (result.crossoverSignal === 'NEUTRAL') {
  // No crossover detected
  // → HOLD current position
}
```

## Configuration

### Load Config

```typescript
const config = await loadTSIConfig();
// Returns active config from smoothing_configurations table
```

### Update Config

```typescript
import { supabaseAdmin } from '@/lib/supabase';

await supabaseAdmin
  .from('smoothing_configurations')
  .update({
    tsi_fast_smoothing: 'EMA',
    tsi_slow_smoothing: 'EMA'
  })
  .eq('config_name', 'austin_default');
```

## Database Queries

### Latest TSI

```sql
SELECT timestamp, tsi_fast, tsi_slow, crossover_signal
FROM market_price_momentum
WHERE market_id = '0x123...'
ORDER BY timestamp DESC
LIMIT 1;
```

### Recent Signals

```sql
SELECT market_id, timestamp, crossover_signal, tsi_fast, tsi_slow
FROM market_price_momentum
WHERE crossover_signal IN ('BULLISH', 'BEARISH')
  AND timestamp >= now() - INTERVAL 1 HOUR
ORDER BY timestamp DESC;
```

## Error Handling

```typescript
try {
  const result = await calculateAndSaveTSI(marketId, 60);
} catch (error) {
  if (error.message.includes('Insufficient price data')) {
    // Try longer lookback
    const result = await calculateAndSaveTSI(marketId, 120);
  } else if (error.message.includes('No active configuration')) {
    // Ensure Supabase has active config
    console.error('Check smoothing_configurations table');
  } else {
    throw error;
  }
}
```

## Performance Tips

```typescript
// ✅ Good: Batch processing
await calculateTSIBatch(marketIds, 60);

// ❌ Bad: Sequential processing
for (const id of marketIds) {
  await calculateAndSaveTSI(id, 60);
}

// ✅ Good: Reuse config
const config = await loadTSIConfig();
for (const priceHistory of histories) {
  await calculateTSI(priceHistory, config);
}

// ❌ Bad: Load config repeatedly
for (const priceHistory of histories) {
  const config = await loadTSIConfig();
  await calculateTSI(priceHistory, config);
}
```

## Smoothing Methods

| Method | Speed | Smoothness | Best For |
|--------|-------|------------|----------|
| **RMA** | Slow | Very smooth | Low liquidity (Austin's choice) |
| **EMA** | Medium | Smooth | Balanced responsiveness |
| **SMA** | Fast | Least smooth | Baseline comparison |

## Default Configuration

Austin's recommended settings:

```typescript
{
  fastPeriods: 9,
  fastSmoothing: 'RMA',
  slowPeriods: 21,
  slowSmoothing: 'RMA'
}
```

## API Routes Example

```typescript
// app/api/tsi/[marketId]/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: { marketId: string } }
) {
  const result = await calculateAndSaveTSI(params.marketId, 60);
  return NextResponse.json(result);
}
```

## React Hook Example

```typescript
// hooks/use-tsi.ts
export function useTSI(marketId: string) {
  return useQuery({
    queryKey: ['tsi', marketId],
    queryFn: async () => {
      const res = await fetch(`/api/tsi/${marketId}`);
      return res.json();
    },
    refetchInterval: 30000, // 30 seconds
  });
}
```

## Cron Job Example

```typescript
// scripts/update-tsi-all-markets.ts
setInterval(async () => {
  const { data: markets } = await supabase
    .from('markets')
    .select('market_id')
    .eq('active', true);

  const marketIds = markets.map(m => m.market_id);
  await calculateTSIBatch(marketIds, 60);
}, 30000);
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| "No active configuration" | Insert into smoothing_configurations with is_active=TRUE |
| "Insufficient price data" | Increase lookback: `calculateAndSaveTSI(id, 120)` |
| NaN values | Check price variation, ensure market is trading |
| TypeScript errors | Run `npm run build` |

## Resources

- **Full Documentation:** `TSI_CALCULATOR_README.md`
- **Integration Guide:** `TSI_INTEGRATION_GUIDE.md`
- **Examples:** Run `npx tsx lib/metrics/tsi-calculator.example.ts all`
- **Tests:** Run `npx tsx lib/metrics/tsi-calculator.test.ts`

---

**Quick Start:** `await calculateAndSaveTSI(marketId, 60)`
