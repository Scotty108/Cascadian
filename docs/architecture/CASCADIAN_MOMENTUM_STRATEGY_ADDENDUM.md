# CASCADIAN Momentum Strategy Addendum
**Version**: 1.0
**Date**: 2025-10-25
**Status**: Specification Update
**Related Docs**:
- `CASCADIAN_ARCHITECTURE_PLAN_V1.md` (base architecture)
- `CASCADIAN_COMPLETE_SCHEMA_V1.md` (database schema)
- `DATABASE_ARCHITECT_SPEC.md` (102 metrics system)

---

## Executive Summary

This addendum documents critical momentum trading strategy discoveries from Austin (domain expert) and updates the CASCADIAN architecture to support sophisticated momentum-based trading signals.

**Key Changes**:
1. **Momentum Detection**: Upgrade from simple velocity to True Strength Index (TSI) with configurable smoothing
2. **Flexible Smoothing**: Support SMA, EMA, and RMA as runtime-configurable options (NOT hardcoded)
3. **Directional Conviction**: Add elite wallet consensus scoring (90% confidence threshold)
4. **Exit Strategy**: TSI crossover reversals for increased capital velocity vs elite wallets
5. **Database Schema**: Extended to support any smoothing method and signal type

**Critical Requirement**: All smoothing methods (SMA, EMA, RMA) must be configurable at runtime. The database schema must store which method was used, and the implementation must support switching between methods for experimentation and backtesting.

---

## Table of Contents

1. [Austin's Strategy Discoveries](#austins-strategy-discoveries)
2. [Database Schema Updates](#database-schema-updates)
3. [Implementation Architecture](#implementation-architecture)
4. [Service Specifications](#service-specifications)
5. [Configuration System](#configuration-system)
6. [Open Questions for Austin](#open-questions-for-austin)
7. [Integration with Existing Plan](#integration-with-existing-plan)

---

## 1. Austin's Strategy Discoveries

### 1.1 The Problem with Simple Momentum

**Original Approach (naive)**:
```typescript
// ❌ WRONG: Gets "wicked out" in choppy markets
if (velocity > 0.01) {
  return 'BULLISH';
}
```

**Why it fails**:
- Low liquidity markets: Single $1,000 bet can spike price 5%
- Choppy markets: Price oscillates without trend
- False signals: "One wallet could screw our whole position"
- No exit strategy: Holding positions too long reduces capital velocity

### 1.2 True Strength Index (TSI) Approach

**What Austin uses**:
- **Indicator**: True Strength Index (TSI)
- **Periods**: Fast line (9-period) vs Slow line (21-period)
- **Smoothing**: RMA (Wilder's smoothing) preferred for low liquidity markets
  - User wants flexibility: SMA, EMA, RMA all available
- **Signal**: Crossover detection (bullish when fast crosses above slow)
- **Exit**: Bearish crossover (fast crosses below slow) - don't wait for elite wallets to exit

**TSI Formula**:
```
Price Change = Close - Previous Close
Double Smoothed PC = Smooth(Smooth(Price Change, slow), fast)
Double Smoothed Abs PC = Smooth(Smooth(Abs(Price Change), slow), fast)
TSI = 100 * (Double Smoothed PC / Double Smoothed Abs PC)
```

Where `Smooth()` is configurable (SMA/EMA/RMA).

### 1.3 Smoothing Methods

**User Requirement**: Support all three smoothing methods as configurable options.

#### Simple Moving Average (SMA)
```
SMA(n) = (P1 + P2 + ... + Pn) / n
```
- **Pros**: Easy to understand, equal weight to all periods
- **Cons**: Lagging indicator, sharp changes at window edges

#### Exponential Moving Average (EMA)
```
EMA(t) = α * P(t) + (1 - α) * EMA(t-1)
α = 2 / (n + 1)
```
- **Pros**: More responsive to recent prices
- **Cons**: Never fully "forgets" old data

#### Running Moving Average (RMA) / Wilder's Smoothing
```
RMA(t) = (RMA(t-1) * (n - 1) + P(t)) / n
```
- **Pros**: Smoother than EMA, ideal for low liquidity (Austin's preference)
- **Cons**: Very slow to respond

**Critical**: Implementation must support switching between these at runtime without schema changes.

### 1.4 Directional Conviction

**Austin's insight**: "I'm 90% confident this is the right answer... you bet with smart money"

**Directional Conviction Score** (0 to 1):
```typescript
conviction = (
  elite_consensus_pct * 0.5 +        // 50% weight: % of elite wallets on same side
  category_specialist_pct * 0.3 +     // 30% weight: Category experts aligned
  omega_weighted_consensus * 0.2      // 20% weight: Omega-weighted agreement
)
```

**Entry Threshold**: `conviction >= 0.9` (Austin's "90% confident")

**Components**:
1. **Elite Consensus %**: Of the elite wallets trading this market, what % are on YES vs NO?
2. **Category Specialist %**: Are the top omega traders in this category aligned?
3. **Omega-Weighted**: Higher omega wallets get more weight in consensus

### 1.5 Exit Strategy for Capital Velocity

**Austin's key insight**: Don't wait for elite wallets to exit

**Elite Wallet Behavior**:
- Enter early, hold until resolution
- Locks capital for days/weeks
- Lower capital velocity

**Our Advantage**:
- Exit on TSI bearish crossover (momentum reversal)
- Free up capital for next trade
- Higher capital velocity = more trades/month

**Exit Conditions**:
```typescript
// Exit when TSI crosses bearish
if (tsi_fast < tsi_slow && previous_tsi_fast >= previous_tsi_slow) {
  return 'EXIT'; // Bearish crossover
}

// NOT: Wait for elite wallets to exit
// NOT: Time-based exits (unless Austin confirms)
// NOT: Fixed profit targets (unless Austin confirms)
```

---

## 2. Database Schema Updates

### 2.1 Extended `market_price_momentum` Table

**Purpose**: Store TSI indicators and smoothing metadata

```sql
-- Extends existing market_price_momentum table
ALTER TABLE market_price_momentum ADD COLUMN IF NOT EXISTS
  -- TSI Indicators (Fast Line - 9 period)
  tsi_fast Decimal(12, 8) DEFAULT NULL COMMENT 'Fast TSI line (9-period)',
  tsi_fast_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) DEFAULT 'RMA' COMMENT 'Smoothing method used for fast line',
  tsi_fast_periods UInt8 DEFAULT 9 COMMENT 'Periods for fast TSI line',

  -- TSI Indicators (Slow Line - 21 period)
  tsi_slow Decimal(12, 8) DEFAULT NULL COMMENT 'Slow TSI line (21-period)',
  tsi_slow_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) DEFAULT 'RMA' COMMENT 'Smoothing method used for slow line',
  tsi_slow_periods UInt8 DEFAULT 21 COMMENT 'Periods for slow TSI line',

  -- Crossover Detection
  crossover_signal Enum8('BULLISH'=1, 'BEARISH'=2, 'NEUTRAL'=3) DEFAULT 'NEUTRAL' COMMENT 'Current crossover state',
  crossover_timestamp DateTime64(3) DEFAULT NULL COMMENT 'When crossover occurred',

  -- Price Smoothing (for noise reduction)
  price_smoothed Decimal(10, 6) DEFAULT NULL COMMENT 'Smoothed mid price',
  price_smoothing_method Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) DEFAULT 'RMA' COMMENT 'Method used for price smoothing',
  price_smoothing_periods UInt8 DEFAULT 3 COMMENT 'Periods for price smoothing',

  -- Momentum Metadata
  momentum_calculation_version String DEFAULT 'v1_tsi' COMMENT 'Which momentum algorithm was used';

-- Index for crossover queries
ALTER TABLE market_price_momentum
  ADD INDEX IF NOT EXISTS idx_crossover (market_id, crossover_signal, crossover_timestamp) TYPE minmax GRANULARITY 1;
```

**Key Design Decisions**:
- ✅ Smoothing method stored per calculation (not hardcoded)
- ✅ Periods configurable (9/21 default, but changeable)
- ✅ Version tracking (`momentum_calculation_version`) for algorithm updates
- ✅ Supports experimentation: Can calculate same market with different smoothing and compare

### 2.2 New `momentum_trading_signals` Table

**Purpose**: Store generated trading signals with full context

```sql
CREATE TABLE IF NOT EXISTS momentum_trading_signals (
  -- Identity
  signal_id String DEFAULT generateUUIDv4() COMMENT 'Unique signal identifier',
  market_id String NOT NULL COMMENT 'Market this signal is for',
  signal_timestamp DateTime64(3) DEFAULT now64() COMMENT 'When signal was generated',

  -- Signal Type
  signal_type Enum8('ENTRY'=1, 'EXIT'=2, 'HOLD'=3) NOT NULL COMMENT 'Entry, exit, or hold',
  signal_direction Enum8('YES'=1, 'NO'=2) DEFAULT NULL COMMENT 'Direction for entry signals',

  -- TSI Context
  tsi_fast Decimal(12, 8) NOT NULL COMMENT 'TSI fast line value at signal',
  tsi_slow Decimal(12, 8) NOT NULL COMMENT 'TSI slow line value at signal',
  crossover_type Enum8('BULLISH'=1, 'BEARISH'=2) DEFAULT NULL COMMENT 'Type of crossover that triggered',
  tsi_fast_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) NOT NULL COMMENT 'Smoothing method used',
  tsi_slow_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) NOT NULL COMMENT 'Smoothing method used',

  -- Directional Conviction
  directional_conviction Decimal(5, 4) NOT NULL COMMENT 'Conviction score (0-1)',
  elite_consensus_pct Decimal(5, 4) NOT NULL COMMENT 'Elite wallet agreement %',
  category_specialist_pct Decimal(5, 4) DEFAULT NULL COMMENT 'Category specialist agreement %',
  omega_weighted_consensus Decimal(5, 4) DEFAULT NULL COMMENT 'Omega-weighted agreement',

  -- Elite Attribution
  elite_wallets_yes UInt16 DEFAULT 0 COMMENT 'Count of elite wallets on YES',
  elite_wallets_no UInt16 DEFAULT 0 COMMENT 'Count of elite wallets on NO',
  elite_wallets_total UInt16 DEFAULT 0 COMMENT 'Total elite wallets in market',

  -- Market Context
  mid_price Decimal(10, 6) NOT NULL COMMENT 'Mid price at signal time',
  volume_24h Decimal(18, 2) DEFAULT NULL COMMENT '24h volume at signal',
  liquidity_depth Decimal(18, 2) DEFAULT NULL COMMENT 'Total order book depth',

  -- Signal Metadata
  signal_strength Enum8('WEAK'=1, 'MODERATE'=2, 'STRONG'=3, 'VERY_STRONG'=4) NOT NULL COMMENT 'Signal quality',
  confidence_score Decimal(5, 4) NOT NULL COMMENT 'Overall confidence (0-1)',
  meets_entry_threshold Boolean DEFAULT 0 COMMENT 'conviction >= 0.9',

  -- Version Tracking
  calculation_version String DEFAULT 'v1_tsi_austin' COMMENT 'Algorithm version',
  created_at DateTime64(3) DEFAULT now64() COMMENT 'Record creation time'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(signal_timestamp)
ORDER BY (market_id, signal_timestamp, signal_type)
SETTINGS index_granularity = 8192;

-- Indexes
ALTER TABLE momentum_trading_signals
  ADD INDEX IF NOT EXISTS idx_entry_signals (signal_type, meets_entry_threshold, signal_timestamp) TYPE minmax GRANULARITY 1;

ALTER TABLE momentum_trading_signals
  ADD INDEX IF NOT EXISTS idx_market_signals (market_id, signal_timestamp) TYPE minmax GRANULARITY 1;
```

**Key Design Decisions**:
- ✅ Stores smoothing method used (for backtesting different methods)
- ✅ Full context: TSI values, conviction, elite attribution
- ✅ Version tracking: Can evolve algorithm and compare results
- ✅ Supports filtering: `meets_entry_threshold` for quick queries

### 2.3 New `smoothing_configurations` Table (Supabase)

**Purpose**: Store user-configurable smoothing parameters

```sql
CREATE TABLE IF NOT EXISTS smoothing_configurations (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_name TEXT NOT NULL UNIQUE,

  -- TSI Settings
  tsi_fast_periods INTEGER DEFAULT 9 CHECK (tsi_fast_periods >= 2),
  tsi_fast_smoothing TEXT DEFAULT 'RMA' CHECK (tsi_fast_smoothing IN ('SMA', 'EMA', 'RMA')),

  tsi_slow_periods INTEGER DEFAULT 21 CHECK (tsi_slow_periods >= 2),
  tsi_slow_smoothing TEXT DEFAULT 'RMA' CHECK (tsi_slow_smoothing IN ('SMA', 'EMA', 'RMA')),

  -- Price Smoothing (optional)
  price_smoothing_enabled BOOLEAN DEFAULT TRUE,
  price_smoothing_method TEXT DEFAULT 'RMA' CHECK (price_smoothing_method IN ('SMA', 'EMA', 'RMA')),
  price_smoothing_periods INTEGER DEFAULT 3 CHECK (price_smoothing_periods >= 1),

  -- Conviction Thresholds
  entry_conviction_threshold DECIMAL(5, 4) DEFAULT 0.90 CHECK (entry_conviction_threshold BETWEEN 0 AND 1),
  exit_on_crossover BOOLEAN DEFAULT TRUE,

  -- Metadata
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Only one active config at a time
CREATE UNIQUE INDEX idx_active_config ON smoothing_configurations(is_active) WHERE is_active = TRUE;

-- Default configuration
INSERT INTO smoothing_configurations (config_name, is_active)
VALUES ('austin_default', TRUE)
ON CONFLICT (config_name) DO NOTHING;
```

**Key Design Decisions**:
- ✅ Allows switching smoothing methods via UI/API
- ✅ Supports A/B testing different configurations
- ✅ Can have multiple saved configs, one active
- ✅ No code changes needed to experiment

### 2.4 Schema Migration Strategy

**Phase 0 (Immediate)**:
1. Create `momentum_trading_signals` table
2. Extend `market_price_momentum` with TSI columns
3. Create `smoothing_configurations` table in Supabase

**Phase 1 (Week 1-2)**:
1. Implement TSI calculator service
2. Implement smoothing functions (SMA/EMA/RMA)
3. Backfill historical TSI calculations

**Phase 2 (Week 3)**:
1. Implement crossover detector
2. Implement directional conviction calculator
3. Start generating live signals

**Rollback Plan**:
- New columns are nullable: Existing queries unaffected
- Can drop tables/columns without data loss (signals are derived, not source)

---

## 3. Implementation Architecture

### 3.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│                  WebSocket Snapshotter                       │
│  (10-second price snapshots → price_snapshots_10s)          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                TSI Calculator Service                        │
│  - Reads price_snapshots_10s                                │
│  - Applies configurable smoothing (SMA/EMA/RMA)             │
│  - Calculates fast (9) and slow (21) TSI lines             │
│  - Detects crossovers                                       │
│  - Writes to market_price_momentum                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│          Directional Conviction Calculator                   │
│  - Reads elite wallet positions (trades_raw)                │
│  - Calculates elite consensus (% on YES vs NO)              │
│  - Weights by omega scores                                  │
│  - Outputs conviction score (0-1)                           │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Signal Generator Service                        │
│  - Combines TSI + Conviction                                │
│  - Generates ENTRY/EXIT/HOLD signals                        │
│  - Applies 0.9 conviction threshold                         │
│  - Writes to momentum_trading_signals                       │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

**Every 10 seconds**:
1. WebSocket receives price ticks → buffered
2. Buffer flushed to `price_snapshots_10s` table

**Every 30 seconds** (configurable):
1. TSI Calculator reads last 210 seconds of snapshots (21 periods × 10s)
2. Applies smoothing per active config
3. Calculates TSI fast and slow lines
4. Detects crossovers
5. Writes to `market_price_momentum`

**Every 60 seconds** (configurable):
1. Conviction Calculator queries elite wallet positions
2. Calculates consensus metrics
3. Caches results

**Every 60 seconds** (after TSI + Conviction):
1. Signal Generator combines signals
2. Checks: `crossover == BULLISH && conviction >= 0.9` → ENTRY
3. Checks: `crossover == BEARISH` → EXIT
4. Writes to `momentum_trading_signals`

---

## 4. Service Specifications

### 4.1 Smoothing Functions Library

**File**: `lib/metrics/smoothing.ts`

```typescript
/**
 * Smoothing Functions Library
 * Supports SMA, EMA, and RMA (Wilder's) smoothing
 *
 * CRITICAL: All smoothing methods are configurable, not hardcoded
 */

export type SmoothingMethod = 'SMA' | 'EMA' | 'RMA';

export interface SmoothingConfig {
  method: SmoothingMethod;
  periods: number;
}

/**
 * Simple Moving Average
 * Equal weight to all values in window
 */
export function calculateSMA(values: number[], periods: number): number | null {
  if (values.length < periods) return null;

  const window = values.slice(-periods);
  const sum = window.reduce((acc, val) => acc + val, 0);
  return sum / periods;
}

/**
 * Exponential Moving Average
 * More weight to recent values
 */
export function calculateEMA(values: number[], periods: number, previousEMA?: number): number | null {
  if (values.length === 0) return null;

  const alpha = 2 / (periods + 1);
  const currentValue = values[values.length - 1];

  if (previousEMA === undefined) {
    // First calculation: Use SMA as seed
    return calculateSMA(values, Math.min(periods, values.length));
  }

  return alpha * currentValue + (1 - alpha) * previousEMA;
}

/**
 * Running Moving Average (Wilder's Smoothing)
 * Smoothest, best for low liquidity markets
 */
export function calculateRMA(values: number[], periods: number, previousRMA?: number): number | null {
  if (values.length === 0) return null;

  const currentValue = values[values.length - 1];

  if (previousRMA === undefined) {
    // First calculation: Use SMA as seed
    return calculateSMA(values, Math.min(periods, values.length));
  }

  return (previousRMA * (periods - 1) + currentValue) / periods;
}

/**
 * Generic smoothing function - routes to correct method
 * This is the PRIMARY interface - all callers use this
 */
export function smooth(
  values: number[],
  config: SmoothingConfig,
  previousValue?: number
): number | null {
  switch (config.method) {
    case 'SMA':
      return calculateSMA(values, config.periods);
    case 'EMA':
      return calculateEMA(values, config.periods, previousValue);
    case 'RMA':
      return calculateRMA(values, config.periods, previousValue);
    default:
      throw new Error(`Unknown smoothing method: ${config.method}`);
  }
}

/**
 * Get smoothing method as enum value for database
 */
export function getSmoothingEnum(method: SmoothingMethod): number {
  const map = { 'SMA': 1, 'EMA': 2, 'RMA': 3 };
  return map[method];
}
```

### 4.2 TSI Calculator Service

**File**: `lib/metrics/tsi-calculator.ts`

```typescript
import { clickhouse } from '@/lib/clickhouse/client';
import { smooth, SmoothingConfig, getSmoothingEnum } from './smoothing';

export interface TSIConfig {
  fastPeriods: number;
  slowPeriods: number;
  fastSmoothing: SmoothingConfig;
  slowSmoothing: SmoothingConfig;
}

export interface TSIResult {
  marketId: string;
  timestamp: Date;
  tsiFast: number;
  tsiSlow: number;
  crossoverSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  crossoverTimestamp: Date | null;
}

/**
 * Calculate True Strength Index for a market
 *
 * Formula:
 * 1. Price Change = Close - Previous Close
 * 2. Double Smoothed PC = Smooth(Smooth(PC, slow), fast)
 * 3. Double Smoothed Abs PC = Smooth(Smooth(Abs(PC), slow), fast)
 * 4. TSI = 100 * (Double Smoothed PC / Double Smoothed Abs PC)
 */
export class TSICalculator {
  private config: TSIConfig;
  private cache: Map<string, { values: number[], timestamps: Date[] }> = new Map();

  constructor(config: TSIConfig) {
    this.config = config;
  }

  /**
   * Fetch price snapshots for a market
   */
  private async fetchPriceSnapshots(
    marketId: string,
    lookbackSeconds: number
  ): Promise<{ price: number, timestamp: Date }[]> {
    const result = await clickhouse.query({
      query: `
        SELECT
          timestamp,
          mid_price as price
        FROM price_snapshots_10s
        WHERE market_id = {marketId:String}
          AND timestamp >= now() - INTERVAL {lookback:UInt32} SECOND
        ORDER BY timestamp ASC
      `,
      query_params: {
        marketId,
        lookback: lookbackSeconds
      }
    });

    const data = await result.json<{ timestamp: string, price: string }[]>();
    return data.map(row => ({
      price: parseFloat(row.price),
      timestamp: new Date(row.timestamp)
    }));
  }

  /**
   * Calculate price changes
   */
  private calculatePriceChanges(prices: number[]): number[] {
    const changes: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }
    return changes;
  }

  /**
   * Calculate TSI for fast and slow lines
   */
  private calculateTSILine(
    priceChanges: number[],
    slowConfig: SmoothingConfig,
    fastConfig: SmoothingConfig
  ): number | null {
    // Step 1: First smoothing (slow)
    const firstSmoothed: number[] = [];
    const firstSmoothedAbs: number[] = [];

    let prevSmoothed: number | undefined;
    let prevSmoothedAbs: number | undefined;

    for (let i = 0; i < priceChanges.length; i++) {
      const window = priceChanges.slice(0, i + 1);
      const absWindow = window.map(Math.abs);

      const smoothed = smooth(window, slowConfig, prevSmoothed);
      const smoothedAbs = smooth(absWindow, slowConfig, prevSmoothedAbs);

      if (smoothed !== null && smoothedAbs !== null) {
        firstSmoothed.push(smoothed);
        firstSmoothedAbs.push(smoothedAbs);
        prevSmoothed = smoothed;
        prevSmoothedAbs = smoothedAbs;
      }
    }

    // Step 2: Second smoothing (fast)
    const doubleSmoothed = smooth(firstSmoothed, fastConfig);
    const doubleSmoothedAbs = smooth(firstSmoothedAbs, fastConfig);

    if (doubleSmoothed === null || doubleSmoothedAbs === null || doubleSmoothedAbs === 0) {
      return null;
    }

    // Step 3: TSI calculation
    return 100 * (doubleSmoothed / doubleSmoothedAbs);
  }

  /**
   * Detect crossover between fast and slow TSI lines
   */
  private detectCrossover(
    currentFast: number,
    currentSlow: number,
    previousFast: number | null,
    previousSlow: number | null
  ): { signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL', timestamp: Date | null } {
    if (previousFast === null || previousSlow === null) {
      return { signal: 'NEUTRAL', timestamp: null };
    }

    // Bullish crossover: Fast crosses above slow
    if (currentFast > currentSlow && previousFast <= previousSlow) {
      return { signal: 'BULLISH', timestamp: new Date() };
    }

    // Bearish crossover: Fast crosses below slow
    if (currentFast < currentSlow && previousFast >= previousSlow) {
      return { signal: 'BEARISH', timestamp: new Date() };
    }

    return { signal: 'NEUTRAL', timestamp: null };
  }

  /**
   * Calculate TSI for a market
   */
  async calculateTSI(marketId: string): Promise<TSIResult | null> {
    // Lookback: Need enough data for slow periods × 2 (double smoothing)
    const lookbackSeconds = this.config.slowPeriods * 2 * 10; // 10s snapshots

    // Fetch price snapshots
    const snapshots = await this.fetchPriceSnapshots(marketId, lookbackSeconds);

    if (snapshots.length < this.config.slowPeriods) {
      console.warn(`Insufficient data for ${marketId}: ${snapshots.length} snapshots`);
      return null;
    }

    const prices = snapshots.map(s => s.price);
    const priceChanges = this.calculatePriceChanges(prices);

    // Calculate fast line (9-period by default)
    const tsiFast = this.calculateTSILine(
      priceChanges,
      this.config.fastSmoothing,
      { method: this.config.fastSmoothing.method, periods: this.config.fastPeriods }
    );

    // Calculate slow line (21-period by default)
    const tsiSlow = this.calculateTSILine(
      priceChanges,
      this.config.slowSmoothing,
      { method: this.config.slowSmoothing.method, periods: this.config.slowPeriods }
    );

    if (tsiFast === null || tsiSlow === null) {
      return null;
    }

    // Get previous values for crossover detection
    const cached = this.cache.get(marketId);
    const previousFast = cached?.values[0] ?? null;
    const previousSlow = cached?.values[1] ?? null;

    // Detect crossover
    const crossover = this.detectCrossover(tsiFast, tsiSlow, previousFast, previousSlow);

    // Update cache
    this.cache.set(marketId, {
      values: [tsiFast, tsiSlow],
      timestamps: [new Date()]
    });

    return {
      marketId,
      timestamp: new Date(),
      tsiFast,
      tsiSlow,
      crossoverSignal: crossover.signal,
      crossoverTimestamp: crossover.timestamp
    };
  }

  /**
   * Save TSI result to database
   */
  async saveTSI(result: TSIResult): Promise<void> {
    await clickhouse.insert({
      table: 'market_price_momentum',
      values: [{
        market_id: result.marketId,
        timestamp: Math.floor(result.timestamp.getTime() / 1000),
        tsi_fast: result.tsiFast,
        tsi_fast_smoothing: getSmoothingEnum(this.config.fastSmoothing.method),
        tsi_fast_periods: this.config.fastPeriods,
        tsi_slow: result.tsiSlow,
        tsi_slow_smoothing: getSmoothingEnum(this.config.slowSmoothing.method),
        tsi_slow_periods: this.config.slowPeriods,
        crossover_signal: result.crossoverSignal,
        crossover_timestamp: result.crossoverTimestamp ? Math.floor(result.crossoverTimestamp.getTime() / 1000) : null,
        momentum_calculation_version: 'v1_tsi_austin'
      }],
      format: 'JSONEachRow'
    });
  }
}

/**
 * Factory: Create TSI calculator from active config
 */
export async function createTSICalculatorFromConfig(): Promise<TSICalculator> {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch active smoothing config
  const { data, error } = await supabase
    .from('smoothing_configurations')
    .select('*')
    .eq('is_active', true)
    .single();

  if (error || !data) {
    throw new Error('No active smoothing configuration found');
  }

  return new TSICalculator({
    fastPeriods: data.tsi_fast_periods,
    slowPeriods: data.tsi_slow_periods,
    fastSmoothing: {
      method: data.tsi_fast_smoothing as 'SMA' | 'EMA' | 'RMA',
      periods: data.tsi_fast_periods
    },
    slowSmoothing: {
      method: data.tsi_slow_smoothing as 'SMA' | 'EMA' | 'RMA',
      periods: data.tsi_slow_periods
    }
  });
}
```

### 4.3 Directional Conviction Calculator

**File**: `lib/metrics/directional-conviction.ts`

```typescript
import { clickhouse } from '@/lib/clickhouse/client';
import { createClient } from '@supabase/supabase-js';

export interface ConvictionResult {
  marketId: string;
  timestamp: Date;
  directionalConviction: number; // 0-1
  eliteConsensus: number; // % on dominant side
  categorySpecialistConsensus: number | null;
  omegaWeightedConsensus: number | null;
  eliteWalletsYes: number;
  eliteWalletsNo: number;
  eliteWalletsTotal: number;
  dominantSide: 'YES' | 'NO' | 'NEUTRAL';
}

/**
 * Calculate directional conviction for a market
 * Based on elite wallet positions and category specialists
 */
export class DirectionalConvictionCalculator {
  private supabase: ReturnType<typeof createClient>;

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Fetch elite wallets (omega >= 2.0, min 10 trades)
   */
  private async fetchEliteWallets(): Promise<Map<string, number>> {
    const { data, error } = await this.supabase
      .from('wallet_scores')
      .select('wallet_address, omega_ratio')
      .gte('omega_ratio', 2.0)
      .gte('closed_positions', 10);

    if (error || !data) {
      console.error('Error fetching elite wallets:', error);
      return new Map();
    }

    return new Map(data.map(w => [w.wallet_address.toLowerCase(), w.omega_ratio]));
  }

  /**
   * Fetch category specialists for a market's category
   */
  private async fetchCategorySpecialists(category: string): Promise<Map<string, number>> {
    const { data, error } = await this.supabase
      .from('wallet_scores_by_category')
      .select('wallet_address, omega_ratio')
      .eq('category', category)
      .gte('omega_ratio', 2.0)
      .gte('closed_positions', 5);

    if (error || !data) {
      return new Map();
    }

    return new Map(data.map(w => [w.wallet_address.toLowerCase(), w.omega_ratio]));
  }

  /**
   * Get market category
   */
  private async getMarketCategory(marketId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('markets')
      .select('category')
      .eq('market_id', marketId)
      .single();

    return data?.category ?? null;
  }

  /**
   * Fetch recent positions for elite wallets in a market
   */
  private async fetchElitePositions(
    marketId: string,
    eliteWallets: Map<string, number>
  ): Promise<{ wallet: string, side: 'YES' | 'NO', omega: number }[]> {
    const walletAddresses = Array.from(eliteWallets.keys());

    if (walletAddresses.length === 0) {
      return [];
    }

    const result = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          side,
          timestamp
        FROM trades_raw
        WHERE market_id = {marketId:String}
          AND wallet_address IN ({wallets:Array(String)})
          AND is_closed = 0
          AND timestamp >= now() - INTERVAL 7 DAY
        ORDER BY timestamp DESC
      `,
      query_params: {
        marketId,
        wallets: walletAddresses
      }
    });

    const data = await result.json<{ wallet_address: string, side: 'YES' | 'NO', timestamp: string }[]>();

    // Get latest position per wallet
    const latestPositions = new Map<string, { side: 'YES' | 'NO', omega: number }>();

    for (const row of data) {
      const wallet = row.wallet_address.toLowerCase();
      if (!latestPositions.has(wallet)) {
        const omega = eliteWallets.get(wallet) ?? 0;
        latestPositions.set(wallet, { side: row.side, omega });
      }
    }

    return Array.from(latestPositions.entries()).map(([wallet, data]) => ({
      wallet,
      side: data.side,
      omega: data.omega
    }));
  }

  /**
   * Calculate conviction score
   */
  async calculateConviction(marketId: string): Promise<ConvictionResult | null> {
    // Fetch elite wallets
    const eliteWallets = await this.fetchEliteWallets();

    if (eliteWallets.size === 0) {
      console.warn('No elite wallets found');
      return null;
    }

    // Fetch positions
    const positions = await this.fetchElitePositions(marketId, eliteWallets);

    if (positions.length === 0) {
      return null;
    }

    // Count positions by side
    const yesCount = positions.filter(p => p.side === 'YES').length;
    const noCount = positions.filter(p => p.side === 'NO').length;
    const total = positions.length;

    // Elite consensus: % on dominant side
    const dominantSide = yesCount > noCount ? 'YES' : yesCount < noCount ? 'NO' : 'NEUTRAL';
    const eliteConsensus = dominantSide === 'NEUTRAL' ? 0.5 : Math.max(yesCount, noCount) / total;

    // Omega-weighted consensus
    const yesOmegaSum = positions.filter(p => p.side === 'YES').reduce((sum, p) => sum + p.omega, 0);
    const noOmegaSum = positions.filter(p => p.side === 'NO').reduce((sum, p) => sum + p.omega, 0);
    const totalOmega = yesOmegaSum + noOmegaSum;
    const omegaWeighted = totalOmega > 0 ? Math.max(yesOmegaSum, noOmegaSum) / totalOmega : null;

    // Category specialist consensus (if available)
    const category = await this.getMarketCategory(marketId);
    let categorySpecialistConsensus: number | null = null;

    if (category) {
      const specialists = await this.fetchCategorySpecialists(category);
      const specialistPositions = positions.filter(p => specialists.has(p.wallet));

      if (specialistPositions.length > 0) {
        const specYes = specialistPositions.filter(p => p.side === 'YES').length;
        const specNo = specialistPositions.filter(p => p.side === 'NO').length;
        const specTotal = specialistPositions.length;
        categorySpecialistConsensus = Math.max(specYes, specNo) / specTotal;
      }
    }

    // Calculate overall conviction
    // Formula: 50% elite consensus + 30% category specialists + 20% omega-weighted
    const conviction =
      eliteConsensus * 0.5 +
      (categorySpecialistConsensus ?? eliteConsensus) * 0.3 +
      (omegaWeighted ?? eliteConsensus) * 0.2;

    return {
      marketId,
      timestamp: new Date(),
      directionalConviction: conviction,
      eliteConsensus,
      categorySpecialistConsensus,
      omegaWeightedConsensus: omegaWeighted,
      eliteWalletsYes: yesCount,
      eliteWalletsNo: noCount,
      eliteWalletsTotal: total,
      dominantSide
    };
  }
}
```

### 4.4 Signal Generator Service

**File**: `lib/metrics/signal-generator.ts`

```typescript
import { clickhouse } from '@/lib/clickhouse/client';
import { TSIResult } from './tsi-calculator';
import { ConvictionResult } from './directional-conviction';

export interface TradingSignal {
  signalId: string;
  marketId: string;
  timestamp: Date;
  signalType: 'ENTRY' | 'EXIT' | 'HOLD';
  signalDirection: 'YES' | 'NO' | null;
  signalStrength: 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG';
  meetsEntryThreshold: boolean;
  confidenceScore: number;
}

/**
 * Generate trading signals by combining TSI and conviction
 */
export class SignalGenerator {
  private convictionThreshold: number = 0.9; // Austin's "90% confident"

  /**
   * Generate signal from TSI and conviction data
   */
  generateSignal(tsi: TSIResult, conviction: ConvictionResult): TradingSignal {
    const signalId = crypto.randomUUID();

    // ENTRY signal: Bullish crossover + high conviction
    if (tsi.crossoverSignal === 'BULLISH' && conviction.directionalConviction >= this.convictionThreshold) {
      return {
        signalId,
        marketId: tsi.marketId,
        timestamp: new Date(),
        signalType: 'ENTRY',
        signalDirection: conviction.dominantSide === 'NEUTRAL' ? null : conviction.dominantSide,
        signalStrength: this.calculateStrength(conviction.directionalConviction),
        meetsEntryThreshold: true,
        confidenceScore: conviction.directionalConviction
      };
    }

    // EXIT signal: Bearish crossover (regardless of conviction)
    if (tsi.crossoverSignal === 'BEARISH') {
      return {
        signalId,
        marketId: tsi.marketId,
        timestamp: new Date(),
        signalType: 'EXIT',
        signalDirection: null,
        signalStrength: 'MODERATE',
        meetsEntryThreshold: false,
        confidenceScore: 1.0 - conviction.directionalConviction // Inverse conviction
      };
    }

    // HOLD: No crossover or low conviction
    return {
      signalId,
      marketId: tsi.marketId,
      timestamp: new Date(),
      signalType: 'HOLD',
      signalDirection: null,
      signalStrength: 'WEAK',
      meetsEntryThreshold: false,
      confidenceScore: conviction.directionalConviction
    };
  }

  /**
   * Calculate signal strength from conviction score
   */
  private calculateStrength(conviction: number): 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG' {
    if (conviction >= 0.95) return 'VERY_STRONG';
    if (conviction >= 0.90) return 'STRONG';
    if (conviction >= 0.75) return 'MODERATE';
    return 'WEAK';
  }

  /**
   * Save signal to database
   */
  async saveSignal(signal: TradingSignal, tsi: TSIResult, conviction: ConvictionResult): Promise<void> {
    await clickhouse.insert({
      table: 'momentum_trading_signals',
      values: [{
        signal_id: signal.signalId,
        market_id: signal.marketId,
        signal_timestamp: Math.floor(signal.timestamp.getTime() / 1000),
        signal_type: signal.signalType,
        signal_direction: signal.signalDirection,
        tsi_fast: tsi.tsiFast,
        tsi_slow: tsi.tsiSlow,
        crossover_type: tsi.crossoverSignal === 'NEUTRAL' ? null : tsi.crossoverSignal,
        directional_conviction: conviction.directionalConviction,
        elite_consensus_pct: conviction.eliteConsensus,
        category_specialist_pct: conviction.categorySpecialistConsensus,
        omega_weighted_consensus: conviction.omegaWeightedConsensus,
        elite_wallets_yes: conviction.eliteWalletsYes,
        elite_wallets_no: conviction.eliteWalletsNo,
        elite_wallets_total: conviction.eliteWalletsTotal,
        signal_strength: signal.signalStrength,
        confidence_score: signal.confidenceScore,
        meets_entry_threshold: signal.meetsEntryThreshold,
        calculation_version: 'v1_tsi_austin'
      }],
      format: 'JSONEachRow'
    });
  }
}
```

---

## 5. Configuration System

### 5.1 Runtime Configuration

**All smoothing methods are configurable via Supabase table** - no code changes needed to experiment.

**Config UI** (future):
```typescript
// Example: Switch from RMA to EMA for experimentation
const { data, error } = await supabase
  .from('smoothing_configurations')
  .update({
    tsi_fast_smoothing: 'EMA',
    tsi_slow_smoothing: 'EMA'
  })
  .eq('config_name', 'austin_default');

// Next TSI calculation will use EMA instead of RMA
```

### 5.2 A/B Testing Different Smoothing

**Create multiple configs**:
```sql
-- Config A: Austin's default (RMA)
INSERT INTO smoothing_configurations (config_name, tsi_fast_smoothing, tsi_slow_smoothing)
VALUES ('config_a_rma', 'RMA', 'RMA');

-- Config B: EMA for faster response
INSERT INTO smoothing_configurations (config_name, tsi_fast_smoothing, tsi_slow_smoothing)
VALUES ('config_b_ema', 'EMA', 'EMA');

-- Config C: SMA for simplicity
INSERT INTO smoothing_configurations (config_name, tsi_fast_smoothing, tsi_slow_smoothing)
VALUES ('config_c_sma', 'SMA', 'SMA');
```

**Backtest comparison**:
```sql
-- Compare performance of different smoothing methods
SELECT
  tsi_fast_smoothing,
  COUNT(*) as total_signals,
  SUM(CASE WHEN signal_type = 'ENTRY' THEN 1 ELSE 0 END) as entry_signals,
  AVG(confidence_score) as avg_confidence
FROM momentum_trading_signals
WHERE signal_timestamp >= now() - INTERVAL 7 DAY
GROUP BY tsi_fast_smoothing;
```

### 5.3 Environment Variables

**Add to `.env.local`**:
```bash
# Momentum Signal Configuration
MOMENTUM_UPDATE_INTERVAL_SECONDS=30  # How often to calculate TSI
CONVICTION_UPDATE_INTERVAL_SECONDS=60  # How often to recalculate conviction
SIGNAL_GENERATION_INTERVAL_SECONDS=60  # How often to generate new signals

# Thresholds
ENTRY_CONVICTION_THRESHOLD=0.9  # Austin's "90% confident"
MIN_ELITE_WALLETS_FOR_CONVICTION=3  # Minimum elite wallets needed for signal

# Feature Flags
ENABLE_CATEGORY_SPECIALIST_WEIGHTING=true
ENABLE_OMEGA_WEIGHTED_CONSENSUS=true
EXIT_ON_CROSSOVER=true  # Austin's strategy: Exit on bearish crossover
```

---

## 6. Open Questions for Austin

**Before finalizing implementation, need clarity on**:

1. **TSI Periods**: Confirm 9/21 periods are optimal for Polymarket?
   - Traditional stock TSI uses 25/13
   - Crypto often uses 20/8
   - Low liquidity prediction markets may need different tuning

2. **Exit Strategy**:
   - Exit ONLY on TSI bearish crossover?
   - Or also time-based (e.g., exit after 48h if no crossover)?
   - Or also profit-target based (e.g., exit at 20% gain)?

3. **Directional Conviction Threshold**:
   - 0.9 threshold for `directional_conviction` score?
   - Or 0.9 threshold for `elite_consensus_pct` alone?
   - Current formula: 50% elite + 30% category + 20% omega-weighted

4. **Multi-Market Strategy**:
   - Should Phase 2 include "basket" signals (e.g., "5 AI markets all bullish")?
   - Or focus on single-market signals first?

5. **Snapshot Frequency**:
   - 10-second snapshots adequate for 21-period slow line (3.5 min history)?
   - Or need faster snapshots (5-second)?

---

## 7. Integration with Existing Plan

### 7.1 Updated Timeline

**Phase 0: Schema Design** (Complete)
- ✅ 18-table schema designed
- ⏳ Add TSI columns to `market_price_momentum`
- ⏳ Create `momentum_trading_signals` table
- ⏳ Create `smoothing_configurations` table in Supabase

**Phase 1: Discovery Platform** (Week 1-2)
- Implement 102 wallet metrics
- Implement 11 screening strategies
- Build category analytics (Austin methodology)
- Deploy Tier 1 batch analytics

**Phase 2: Momentum Detection** (Week 3) - **UPDATED**
- ~~Simple velocity-based momentum~~ ❌
- ✅ Implement TSI calculator with configurable smoothing
- ✅ Implement smoothing library (SMA/EMA/RMA)
- ✅ WebSocket snapshotter (10-second price captures)
- ✅ Crossover detector
- Deploy real-time TSI calculations

**Phase 3: Elite Attribution + Signals** (Week 4) - **UPDATED**
- Implement directional conviction calculator
- Implement signal generator (TSI + conviction)
- Build signal delivery system (webhooks/notifications)
- Deploy live trading signals

**Phase 4: UI + Monitoring** (Week 5)
- Build momentum dashboard
- Add smoothing config UI
- Implement backtesting UI
- Set up alerting/monitoring

### 7.2 Data Sources (No Change)

**Free Tier (Start Here)**:
- ✅ Polymarket WebSocket (RTDS) - Price momentum
- ✅ Goldsky GraphQL API - Historical trades, wallet attribution
- ✅ Polymarket Gamma API - Market metadata, categories

**Paid Upgrade (When Validated)**:
- Goldsky Mirror ($83/month) - Real-time wallet attribution
- Only add when tripwires fire (1000+ users, <70s attribution too slow)

### 7.3 Database Tables Affected

**New Tables**:
1. `momentum_trading_signals` (ClickHouse) - Stores generated signals
2. `smoothing_configurations` (Supabase) - Runtime configuration

**Extended Tables**:
1. `market_price_momentum` (ClickHouse) - Add TSI columns, smoothing metadata

**Unchanged Tables**:
- `trades_raw` (ClickHouse) - Elite wallet positions
- `wallet_scores` (Supabase) - Omega scores for weighting
- `wallet_scores_by_category` (Supabase) - Category specialists
- `price_snapshots_10s` (ClickHouse) - WebSocket price data

---

## Conclusion

This addendum updates the CASCADIAN architecture to support Austin's sophisticated momentum trading strategy:

1. **True Strength Index (TSI)**: Replaces simple velocity with crossover-based signals
2. **Flexible Smoothing**: SMA, EMA, RMA all supported as runtime configuration (NOT hardcoded)
3. **Directional Conviction**: Elite wallet consensus + category specialists + omega weighting
4. **Capital Velocity**: Exit on momentum reversal, not following elite wallets
5. **Experimentation-Ready**: Database stores smoothing method used, supports A/B testing

**Critical Success Factors**:
- ✅ No hardcoded smoothing - all configurable
- ✅ Database supports any signal type needed
- ✅ Can backtest different smoothing approaches
- ✅ Austin's discoveries fully documented
- ✅ Implementation Claude has clear specification

**Next Steps**:
1. Review open questions with Austin
2. Apply schema migrations (Phase 0)
3. Implement smoothing library + TSI calculator (Phase 2)
4. Deploy and validate signals (Phase 3)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-25
**Author**: Claude (Sonnet 4.5)
**Status**: Ready for Implementation
