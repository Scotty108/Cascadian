# TSI (True Strength Index) Calculator

A production-ready TSI calculator implementing Austin's momentum trading strategy for Polymarket prediction markets. This calculator uses double smoothing of price momentum to generate reliable entry and exit signals in low-liquidity environments.

## Overview

The True Strength Index (TSI) is a momentum oscillator that helps identify trend reversals and momentum shifts. Unlike simple moving averages, TSI uses double smoothing to reduce noise and prevent false signals in choppy markets.

**Key Features:**
- ✅ Double smoothing of price momentum (noise reduction)
- ✅ Configurable smoothing methods: SMA, EMA, RMA
- ✅ Crossover detection (bullish/bearish signals)
- ✅ Runtime configuration via Supabase
- ✅ ClickHouse integration for historical tracking
- ✅ Batch processing for multiple markets
- ✅ Production-ready error handling

## Files

```
lib/metrics/
├── smoothing.ts                  # Smoothing library (SMA/EMA/RMA)
├── tsi-calculator.ts             # Main TSI calculator
├── tsi-calculator.example.ts     # Usage examples
└── TSI_CALCULATOR_README.md      # This file
```

## Quick Start

### 1. Basic TSI Calculation

```typescript
import { calculateAndSaveTSI } from '@/lib/metrics/tsi-calculator';

// Calculate TSI for a market and save to database
const result = await calculateAndSaveTSI('0x123...', 60);

console.log(`Fast: ${result.tsiFast.toFixed(2)}`);
console.log(`Slow: ${result.tsiSlow.toFixed(2)}`);
console.log(`Signal: ${result.crossoverSignal}`);
```

### 2. Batch Processing

```typescript
import { calculateTSIBatch } from '@/lib/metrics/tsi-calculator';

const marketIds = ['0x123...', '0x456...', '0x789...'];
const results = await calculateTSIBatch(marketIds, 60);

for (const [marketId, result] of results) {
  if (result.crossoverSignal === 'BULLISH') {
    console.log(`Entry signal for ${marketId}!`);
  }
}
```

### 3. Custom Configuration

```typescript
import { calculateTSI, type TSIConfig } from '@/lib/metrics/tsi-calculator';

const config: TSIConfig = {
  fastPeriods: 9,
  fastSmoothing: 'EMA',  // Try different smoothing
  slowPeriods: 21,
  slowSmoothing: 'EMA'
};

const result = await calculateTSI(priceHistory, config);
```

## How It Works

### TSI Formula

The True Strength Index uses a multi-step calculation:

```
1. Price Momentum = Current Price - Previous Price
2. First Smoothing = Smooth(Momentum, slowPeriods)
3. Second Smoothing = Smooth(First Smoothing, fastPeriods)
4. TSI = 100 × (Double Smoothed Momentum / Double Smoothed |Momentum|)
```

This produces values between -100 and +100:
- **Positive values**: Bullish momentum
- **Negative values**: Bearish momentum
- **Magnitude**: Strength of momentum

### Crossover Detection

Signals are generated when fast and slow TSI lines cross:

#### Bullish Crossover (ENTRY)
```
Previous: Fast ≤ Slow
Current:  Fast > Slow
→ Momentum is turning positive
```

#### Bearish Crossover (EXIT)
```
Previous: Fast ≥ Slow
Current:  Fast < Slow
→ Momentum is turning negative
```

### Example Timeline

```
Time    Price   Fast TSI   Slow TSI   Signal
------------------------------------------
10:00   0.50    -12.5      -8.3       NEUTRAL
10:30   0.52    -5.2       -6.1       NEUTRAL
11:00   0.54     2.8       -2.4       BULLISH  ← Fast crossed above slow
11:30   0.56     8.3        1.7       NEUTRAL
12:00   0.55     5.1        3.2       NEUTRAL
12:30   0.53     1.2        3.8       BEARISH  ← Fast crossed below slow
```

## Configuration

### Supabase Configuration

TSI settings are stored in the `smoothing_configurations` table:

```sql
SELECT * FROM smoothing_configurations WHERE is_active = true;

 config_name    | tsi_fast_periods | tsi_fast_smoothing | tsi_slow_periods | tsi_slow_smoothing
----------------|------------------|-------------------|------------------|-------------------
 austin_default | 9                | RMA               | 21               | RMA
```

### Changing Configuration

```typescript
// Update via Supabase (no code changes needed!)
await supabase
  .from('smoothing_configurations')
  .update({
    tsi_fast_smoothing: 'EMA',  // Switch from RMA to EMA
    tsi_slow_smoothing: 'EMA'
  })
  .eq('config_name', 'austin_default');

// Next TSI calculation will use new settings
const result = await calculateAndSaveTSI('0x123...', 60);
```

### Default Settings (Austin's Recommendation)

- **Fast Periods**: 9
- **Slow Periods**: 21
- **Smoothing Method**: RMA (Wilder's)
- **Lookback**: 60 minutes

Why RMA?
- Smoothest option
- Best for low-liquidity markets
- Reduces false signals from single large trades

## Smoothing Methods

### SMA (Simple Moving Average)

```typescript
{ fastSmoothing: 'SMA', slowSmoothing: 'SMA' }
```

**Characteristics:**
- Equal weight to all periods
- Easy to understand
- Lagging indicator
- Sharp changes at window edges

**Best for:** High-liquidity markets, backtesting baseline

### EMA (Exponential Moving Average)

```typescript
{ fastSmoothing: 'EMA', slowSmoothing: 'EMA' }
```

**Characteristics:**
- More weight on recent data
- Responsive to changes
- Good trend following
- Can whipsaw in choppy markets

**Best for:** Fast-moving markets, when responsiveness matters

### RMA (Running Moving Average / Wilder's)

```typescript
{ fastSmoothing: 'RMA', slowSmoothing: 'RMA' }
```

**Characteristics:**
- Smoothest option
- Slow to respond
- Reduces noise
- Prevents false signals

**Best for:** Low-liquidity markets like Polymarket (Austin's choice)

## Integration with Trading Strategy

### Entry Signal (Austin's 90% Rule)

```typescript
import { calculateAndSaveTSI } from '@/lib/metrics/tsi-calculator';
import { calculateConviction } from '@/lib/metrics/directional-conviction';

const tsiResult = await calculateAndSaveTSI(marketId, 60);
const conviction = await calculateConviction(marketId);

if (
  tsiResult.crossoverSignal === 'BULLISH' &&
  conviction.directionalConviction >= 0.9  // Austin's 90% threshold
) {
  // ENTER position on conviction.dominantSide
  console.log('✅ ENTRY SIGNAL');
  console.log(`Direction: ${conviction.dominantSide}`);
  console.log(`Confidence: ${(conviction.directionalConviction * 100).toFixed(1)}%`);
}
```

### Exit Signal (Capital Velocity)

```typescript
if (tsiResult.crossoverSignal === 'BEARISH') {
  // EXIT immediately - don't wait for elite wallets
  console.log('⚠️  EXIT SIGNAL');
  console.log('Free up capital for next opportunity');
}
```

### Strategy Flow

```
┌─────────────────────────────────────────────────────────┐
│  1. TSI Calculation (Every 30s)                         │
│     - Fetch 60 min price history                        │
│     - Calculate fast/slow TSI lines                     │
│     - Detect crossovers                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  2. Conviction Calculation (Every 60s)                  │
│     - Check elite wallet positions                      │
│     - Calculate consensus metrics                       │
│     - Weight by omega scores                            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  3. Signal Generation                                   │
│     - Combine TSI + Conviction                          │
│     - Apply 0.9 threshold                               │
│     - Generate ENTRY/EXIT/HOLD signal                   │
└─────────────────────────────────────────────────────────┘
```

## API Reference

### Main Functions

#### `calculateTSI(priceHistory, config)`

Calculate TSI for a price history series.

**Parameters:**
- `priceHistory: PricePoint[]` - Array of price observations
- `config: TSIConfig` - TSI configuration (periods + smoothing)

**Returns:** `Promise<TSIResult>`

```typescript
interface TSIResult {
  tsiFast: number;              // Fast line value (-100 to 100)
  tsiSlow: number;              // Slow line value (-100 to 100)
  crossoverSignal: string;      // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  crossoverTimestamp?: Date;    // When crossover occurred
  momentumValues: number[];     // Raw price changes
}
```

#### `calculateAndSaveTSI(marketId, lookbackMinutes)`

Calculate TSI and save to ClickHouse (one-step function).

**Parameters:**
- `marketId: string` - Market ID
- `lookbackMinutes: number` - History window (default: 60)

**Returns:** `Promise<TSIResult>`

#### `calculateTSIBatch(marketIds, lookbackMinutes)`

Calculate TSI for multiple markets in parallel.

**Parameters:**
- `marketIds: string[]` - Array of market IDs
- `lookbackMinutes: number` - History window (default: 60)

**Returns:** `Promise<Map<string, TSIResult>>`

#### `loadTSIConfig()`

Load active configuration from Supabase.

**Returns:** `Promise<TSIConfig>`

#### `fetchPriceHistory(marketId, lookbackMinutes)`

Fetch price history from ClickHouse.

**Parameters:**
- `marketId: string` - Market ID
- `lookbackMinutes: number` - History window

**Returns:** `Promise<PricePoint[]>`

### Types

```typescript
interface TSIConfig {
  fastPeriods: number;
  fastSmoothing: SmoothingMethod;
  slowPeriods: number;
  slowSmoothing: SmoothingMethod;
}

interface PricePoint {
  timestamp: Date;
  price: number;
}

type SmoothingMethod = 'SMA' | 'EMA' | 'RMA';
```

## Database Schema

### ClickHouse: market_price_momentum

TSI results are stored in ClickHouse:

```sql
CREATE TABLE market_price_momentum (
  market_id String,
  timestamp DateTime64(3),
  tsi_fast Decimal(12, 8),
  tsi_fast_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3),
  tsi_fast_periods UInt8,
  tsi_slow Decimal(12, 8),
  tsi_slow_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3),
  tsi_slow_periods UInt8,
  crossover_signal Enum8('BULLISH'=1, 'BEARISH'=2, 'NEUTRAL'=3),
  crossover_timestamp DateTime64(3),
  momentum_calculation_version String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, timestamp);
```

### Query Examples

```sql
-- Get latest TSI for a market
SELECT
  timestamp,
  tsi_fast,
  tsi_slow,
  crossover_signal
FROM market_price_momentum
WHERE market_id = '0x123...'
ORDER BY timestamp DESC
LIMIT 1;

-- Find recent crossovers
SELECT
  market_id,
  timestamp,
  crossover_signal,
  tsi_fast,
  tsi_slow
FROM market_price_momentum
WHERE crossover_signal IN ('BULLISH', 'BEARISH')
  AND timestamp >= now() - INTERVAL 1 HOUR
ORDER BY timestamp DESC;

-- Compare smoothing methods
SELECT
  tsi_fast_smoothing,
  COUNT(*) as total_calculations,
  AVG(tsi_fast) as avg_fast,
  AVG(tsi_slow) as avg_slow
FROM market_price_momentum
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY tsi_fast_smoothing;
```

## Running Examples

```bash
# Run a specific example
npx tsx lib/metrics/tsi-calculator.example.ts 1

# Run all examples
npx tsx lib/metrics/tsi-calculator.example.ts all
```

## Cron Job Integration

```typescript
// scripts/update-tsi.ts
import { calculateTSIBatch } from '@/lib/metrics/tsi-calculator';

async function updateTSI() {
  // Fetch active markets
  const { data: markets } = await supabase
    .from('markets')
    .select('market_id')
    .eq('active', true);

  const marketIds = markets.map(m => m.market_id);

  // Calculate TSI for all markets
  const results = await calculateTSIBatch(marketIds, 60);

  console.log(`Updated TSI for ${results.size} markets`);
}

// Run every 30 seconds
setInterval(updateTSI, 30000);
```

## Performance Considerations

### Data Requirements

For accurate TSI calculation, you need:

**Minimum data points:**
```
slowPeriods + fastPeriods = minimum
21 + 9 = 30 data points minimum
```

With 10-second snapshots:
- 30 points = 5 minutes minimum
- 60 points = 10 minutes (recommended minimum)
- 360 points = 60 minutes (default)

### Batch Processing

The calculator uses automatic batching for efficiency:

```typescript
// Processes in batches of 10
const results = await calculateTSIBatch(marketIds, 60);
// Market IDs: [1-10] → Batch 1
// Market IDs: [11-20] → Batch 2
// etc.
```

### ClickHouse Optimization

Price queries are optimized with:
- Time-based filtering (`timestamp >= now() - INTERVAL`)
- Market ID indexing
- Sorted order (no additional sorting needed)

## Troubleshooting

### "Insufficient price data" Error

```typescript
// Error: Need at least 30 points, got 15
```

**Solution:** Increase `lookbackMinutes`:
```typescript
await calculateAndSaveTSI(marketId, 120);  // Use 2 hours instead
```

### "No active configuration" Error

```typescript
// Error: No active TSI configuration found
```

**Solution:** Ensure Supabase has an active config:
```sql
INSERT INTO smoothing_configurations (config_name, is_active)
VALUES ('austin_default', TRUE);
```

### NaN Values in TSI

**Causes:**
- Insufficient data after smoothing
- Division by zero (no momentum)
- All prices identical (no changes)

**Solution:** Check data quality and ensure price variation.

## Testing

### Unit Tests

```typescript
import { calculateTSI } from '@/lib/metrics/tsi-calculator';

describe('TSI Calculator', () => {
  it('should detect bullish crossover', async () => {
    const priceHistory = generateBullishTrend();
    const config = { /* ... */ };
    const result = await calculateTSI(priceHistory, config);

    expect(result.crossoverSignal).toBe('BULLISH');
    expect(result.tsiFast).toBeGreaterThan(result.tsiSlow);
  });
});
```

### Backtesting

```typescript
// Test different configurations
const configs = [
  { fast: 9, slow: 21, method: 'RMA' },
  { fast: 9, slow: 21, method: 'EMA' },
  { fast: 7, slow: 14, method: 'RMA' },
];

for (const cfg of configs) {
  const results = await backtestTSI(historicalData, cfg);
  console.log(`Win rate: ${results.winRate}%`);
}
```

## References

- **CASCADIAN_MOMENTUM_STRATEGY_ADDENDUM.md** - Full strategy documentation
- **lib/metrics/smoothing.ts** - Smoothing library implementation
- **supabase/migrations/20251025140000_create_smoothing_configurations.sql** - Database schema

## Support

For questions or issues:
1. Check usage examples in `tsi-calculator.example.ts`
2. Review strategy documentation in `CASCADIAN_MOMENTUM_STRATEGY_ADDENDUM.md`
3. Verify configuration in Supabase `smoothing_configurations` table

---

**Version:** 1.0
**Last Updated:** 2025-10-25
**Author:** Claude (Sonnet 4.5)
**Status:** Production Ready
