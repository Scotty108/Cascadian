/**
 * True Strength Index (TSI) Calculator
 *
 * Implements Austin's momentum strategy using double-smoothed price momentum.
 * The TSI detects trend reversals through crossovers between fast and slow lines.
 *
 * Key Features:
 * - Double smoothing of price momentum (reduces noise in low-liquidity markets)
 * - Configurable smoothing methods (SMA, EMA, RMA) from Supabase
 * - Crossover detection (bullish/bearish signals)
 * - Integration with ClickHouse market_price_momentum table
 *
 * Austin's Strategy:
 * - Fast line: 9-period (default)
 * - Slow line: 21-period (default)
 * - Smoothing: RMA (Wilder's) - best for low liquidity
 * - Entry: Bullish crossover + high elite conviction (≥0.9)
 * - Exit: Bearish crossover (don't wait for elite wallets)
 *
 * TSI Formula:
 * 1. Price Change = Close - Previous Close
 * 2. Double Smoothed PC = Smooth(Smooth(Price Change, slow), fast)
 * 3. Double Smoothed Abs PC = Smooth(Smooth(Abs(Price Change), slow), fast)
 * 4. TSI = 100 * (Double Smoothed PC / Double Smoothed Abs PC)
 *
 * @module lib/metrics/tsi-calculator
 */

import { clickhouse } from '@/lib/clickhouse/client';
import { supabaseAdmin } from '@/lib/supabase';
import { doubleSmooth, SmoothingMethod, validateSmoothingConfig } from './smoothing';

/**
 * TSI configuration loaded from Supabase smoothing_configurations table
 */
export interface TSIConfig {
  /** Number of periods for fast TSI line (default: 9) */
  fastPeriods: number;
  /** Smoothing method for fast line (SMA/EMA/RMA) */
  fastSmoothing: SmoothingMethod;
  /** Number of periods for slow TSI line (default: 21) */
  slowPeriods: number;
  /** Smoothing method for slow line (SMA/EMA/RMA) */
  slowSmoothing: SmoothingMethod;
}

/**
 * TSI calculation result with crossover detection
 */
export interface TSIResult {
  /** Fast TSI line value (-100 to 100) */
  tsiFast: number;
  /** Slow TSI line value (-100 to 100) */
  tsiSlow: number;
  /** Crossover signal type */
  crossoverSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  /** When crossover occurred (null if NEUTRAL) */
  crossoverTimestamp?: Date;
  /** Raw momentum values (price changes) */
  momentumValues: number[];
}

/**
 * Price point for TSI calculation
 */
export interface PricePoint {
  /** Timestamp of price observation */
  timestamp: Date;
  /** Price value (typically mid price) */
  price: number;
}

/**
 * Load active TSI configuration from Supabase
 *
 * Fetches the active smoothing_configurations record from the database.
 * This allows runtime configuration changes without code deployment.
 *
 * @returns TSI configuration
 * @throws Error if no active configuration exists
 *
 * @example
 * ```typescript
 * const config = await loadTSIConfig();
 * console.log(config);
 * // {
 * //   fastPeriods: 9,
 * //   fastSmoothing: 'RMA',
 * //   slowPeriods: 21,
 * //   slowSmoothing: 'RMA'
 * // }
 * ```
 */
export async function loadTSIConfig(): Promise<TSIConfig> {
  const { data, error } = await supabaseAdmin
    .from('smoothing_configurations')
    .select('*')
    .eq('is_active', true)
    .single();

  if (error || !data) {
    console.error('[TSI] Failed to load active configuration:', error);
    throw new Error('No active TSI configuration found in smoothing_configurations table');
  }

  // Validate configuration
  if (!validateSmoothingConfig(data.tsi_fast_smoothing, data.tsi_fast_periods)) {
    throw new Error(
      `Invalid fast smoothing config: ${data.tsi_fast_smoothing}, ${data.tsi_fast_periods}`
    );
  }

  if (!validateSmoothingConfig(data.tsi_slow_smoothing, data.tsi_slow_periods)) {
    throw new Error(
      `Invalid slow smoothing config: ${data.tsi_slow_smoothing}, ${data.tsi_slow_periods}`
    );
  }

  return {
    fastPeriods: data.tsi_fast_periods,
    fastSmoothing: data.tsi_fast_smoothing as SmoothingMethod,
    slowPeriods: data.tsi_slow_periods,
    slowSmoothing: data.tsi_slow_smoothing as SmoothingMethod,
  };
}

/**
 * Calculate price momentum (price changes)
 *
 * Converts price series into momentum series by calculating
 * the difference between consecutive prices.
 *
 * @param prices - Array of price values
 * @returns Array of price changes (length = prices.length - 1)
 *
 * @example
 * ```typescript
 * const prices = [10, 11, 12, 11, 13];
 * const momentum = calculateMomentum(prices);
 * // Returns [1, 1, -1, 2]
 * ```
 */
function calculateMomentum(prices: number[]): number[] {
  const momentum: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    momentum.push(prices[i] - prices[i - 1]);
  }

  return momentum;
}

/**
 * Calculate TSI line value using double smoothing
 *
 * Implements the TSI formula:
 * 1. Apply first smoothing to momentum and absolute momentum
 * 2. Apply second smoothing to results from step 1
 * 3. Calculate TSI = 100 * (smoothed momentum / smoothed abs momentum)
 *
 * @param momentum - Array of price changes
 * @param slowPeriods - Periods for first (slow) smoothing
 * @param fastPeriods - Periods for second (fast) smoothing
 * @param smoothingMethod - Smoothing method to use (SMA/EMA/RMA)
 * @returns TSI value (-100 to 100) or null if insufficient data
 *
 * @example
 * ```typescript
 * const momentum = [1, -0.5, 2, 1.5, -1];
 * const tsi = calculateTSILine(momentum, 21, 9, 'RMA');
 * // Returns TSI value based on double-smoothed momentum
 * ```
 */
function calculateTSILine(
  momentum: number[],
  slowPeriods: number,
  fastPeriods: number,
  smoothingMethod: SmoothingMethod
): number | null {
  if (momentum.length < slowPeriods + fastPeriods) {
    return null; // Insufficient data for double smoothing
  }

  // Calculate absolute momentum
  const absMomentum = momentum.map(m => Math.abs(m));

  // Apply double smoothing to momentum and absolute momentum
  const doubleSmoothedMomentum = doubleSmooth(momentum, smoothingMethod, slowPeriods, fastPeriods);
  const doubleSmoothedAbsMomentum = doubleSmooth(absMomentum, smoothingMethod, slowPeriods, fastPeriods);

  // Get the most recent values (last element)
  const smoothedMom = doubleSmoothedMomentum[doubleSmoothedMomentum.length - 1];
  const smoothedAbsMom = doubleSmoothedAbsMomentum[doubleSmoothedAbsMomentum.length - 1];

  // Check for valid values
  if (isNaN(smoothedMom) || isNaN(smoothedAbsMom) || smoothedAbsMom === 0) {
    return null;
  }

  // TSI = 100 * (smoothed momentum / smoothed absolute momentum)
  return 100 * (smoothedMom / smoothedAbsMom);
}

/**
 * Detect crossover between fast and slow TSI lines
 *
 * A crossover occurs when the fast line crosses above or below the slow line.
 * - BULLISH: Fast crosses above slow (entry signal)
 * - BEARISH: Fast crosses below slow (exit signal)
 * - NEUTRAL: No crossover detected
 *
 * @param currentFast - Current fast line value
 * @param currentSlow - Current slow line value
 * @param previousFast - Previous fast line value (null if first calculation)
 * @param previousSlow - Previous slow line value (null if first calculation)
 * @returns Crossover signal and timestamp
 *
 * @example
 * ```typescript
 * // Bullish crossover example
 * const signal = detectCrossover(52, 48, 47, 49);
 * // Returns { signal: 'BULLISH', timestamp: Date(...) }
 * // Fast crossed from below (47 < 49) to above (52 > 48)
 *
 * // Bearish crossover example
 * const signal2 = detectCrossover(45, 48, 51, 47);
 * // Returns { signal: 'BEARISH', timestamp: Date(...) }
 * // Fast crossed from above (51 > 47) to below (45 < 48)
 * ```
 */
function detectCrossover(
  currentFast: number,
  currentSlow: number,
  previousFast: number | null,
  previousSlow: number | null
): { signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; timestamp: Date | null } {
  // Need previous values to detect crossover
  if (previousFast === null || previousSlow === null) {
    return { signal: 'NEUTRAL', timestamp: null };
  }

  // Bullish crossover: Fast crosses above slow
  // Previously: fast <= slow
  // Currently: fast > slow
  if (currentFast > currentSlow && previousFast <= previousSlow) {
    return { signal: 'BULLISH', timestamp: new Date() };
  }

  // Bearish crossover: Fast crosses below slow
  // Previously: fast >= slow
  // Currently: fast < slow
  if (currentFast < currentSlow && previousFast >= previousSlow) {
    return { signal: 'BEARISH', timestamp: new Date() };
  }

  // No crossover
  return { signal: 'NEUTRAL', timestamp: null };
}

/**
 * Calculate TSI for a price history series
 *
 * Main TSI calculation function. Processes price history and returns
 * both fast and slow TSI lines with crossover detection.
 *
 * Workflow:
 * 1. Validate input data
 * 2. Calculate price momentum (price changes)
 * 3. Calculate fast TSI line (9-period default)
 * 4. Calculate slow TSI line (21-period default)
 * 5. Detect crossovers between lines
 *
 * @param priceHistory - Array of price points with timestamps
 * @param config - TSI configuration (periods and smoothing methods)
 * @returns TSI result with fast/slow lines and crossover signal
 *
 * @example
 * ```typescript
 * const priceHistory: PricePoint[] = [
 *   { timestamp: new Date('2024-01-01T10:00:00Z'), price: 0.50 },
 *   { timestamp: new Date('2024-01-01T10:00:10Z'), price: 0.51 },
 *   { timestamp: new Date('2024-01-01T10:00:20Z'), price: 0.52 },
 *   // ... more data points
 * ];
 *
 * const config: TSIConfig = {
 *   fastPeriods: 9,
 *   fastSmoothing: 'RMA',
 *   slowPeriods: 21,
 *   slowSmoothing: 'RMA'
 * };
 *
 * const result = await calculateTSI(priceHistory, config);
 * console.log(result);
 * // {
 * //   tsiFast: 45.2,
 * //   tsiSlow: 38.7,
 * //   crossoverSignal: 'BULLISH',
 * //   crossoverTimestamp: Date(...),
 * //   momentumValues: [0.01, 0.01, -0.02, ...]
 * // }
 * ```
 */
export async function calculateTSI(
  priceHistory: PricePoint[],
  config: TSIConfig
): Promise<TSIResult> {
  // Validate input
  if (!priceHistory || priceHistory.length === 0) {
    throw new Error('Price history is empty');
  }

  // Sort by timestamp (ascending) to ensure correct momentum calculation
  const sortedHistory = [...priceHistory].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  // Extract prices
  const prices = sortedHistory.map(p => p.price);

  // Calculate minimum data required for double smoothing
  const minDataPoints = config.slowPeriods + config.fastPeriods;

  if (prices.length < minDataPoints) {
    throw new Error(
      `Insufficient price data. Need at least ${minDataPoints} points, got ${prices.length}`
    );
  }

  // Calculate price momentum (price changes)
  const momentum = calculateMomentum(prices);

  // Calculate fast TSI line
  const tsiFast = calculateTSILine(
    momentum,
    config.slowPeriods,
    config.fastPeriods,
    config.fastSmoothing
  );

  // Calculate slow TSI line
  const tsiSlow = calculateTSILine(
    momentum,
    config.slowPeriods,
    config.slowPeriods, // Use slow periods for both smoothing passes
    config.slowSmoothing
  );

  if (tsiFast === null || tsiSlow === null) {
    throw new Error('Failed to calculate TSI values - insufficient data after smoothing');
  }

  // For crossover detection, we need to calculate previous values
  // We'll use the second-to-last calculation if we have enough data
  let previousFast: number | null = null;
  let previousSlow: number | null = null;

  if (prices.length > minDataPoints) {
    // Calculate TSI for previous period (exclude last price point)
    const previousMomentum = momentum.slice(0, -1);

    previousFast = calculateTSILine(
      previousMomentum,
      config.slowPeriods,
      config.fastPeriods,
      config.fastSmoothing
    );

    previousSlow = calculateTSILine(
      previousMomentum,
      config.slowPeriods,
      config.slowPeriods,
      config.slowSmoothing
    );
  }

  // Detect crossover
  const crossover = detectCrossover(tsiFast, tsiSlow, previousFast, previousSlow);

  return {
    tsiFast,
    tsiSlow,
    crossoverSignal: crossover.signal,
    crossoverTimestamp: crossover.timestamp || undefined,
    momentumValues: momentum,
  };
}

/**
 * Fetch price history from ClickHouse for a market
 *
 * Retrieves recent price snapshots from the price_snapshots_10s table.
 * Used as input data for TSI calculation.
 *
 * @param marketId - Market ID to fetch prices for
 * @param lookbackMinutes - How many minutes of history to fetch
 * @returns Array of price points with timestamps
 *
 * @example
 * ```typescript
 * const prices = await fetchPriceHistory('0x123...', 60);
 * // Fetches last 60 minutes of 10-second price snapshots
 * // Returns ~360 data points (60 min × 6 snapshots/min)
 * ```
 */
export async function fetchPriceHistory(
  marketId: string,
  lookbackMinutes: number = 60
): Promise<PricePoint[]> {
  try {
    const lookbackSeconds = lookbackMinutes * 60;

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
        lookback: lookbackSeconds,
      },
      format: 'JSONEachRow',
    });

    const data = (await result.json()) as Array<{
      timestamp: string;
      price: string;
    }>;

    return data.map(row => ({
      timestamp: new Date(row.timestamp),
      price: parseFloat(row.price),
    }));
  } catch (error) {
    console.error(`[TSI] Failed to fetch price history for ${marketId}:`, error);
    throw error;
  }
}

/**
 * Calculate and save TSI to ClickHouse
 *
 * End-to-end workflow:
 * 1. Load TSI configuration from Supabase
 * 2. Fetch price history from ClickHouse
 * 3. Calculate TSI values
 * 4. Save results to market_price_momentum table
 *
 * This is the main function to call from cron jobs or API endpoints.
 *
 * @param marketId - Market ID to calculate TSI for
 * @param lookbackMinutes - How many minutes of price history to use
 * @returns TSI result
 *
 * @example
 * ```typescript
 * // From a cron job or API endpoint
 * const result = await calculateAndSaveTSI('0x123...', 60);
 * console.log(`TSI Fast: ${result.tsiFast}, Slow: ${result.tsiSlow}`);
 * console.log(`Signal: ${result.crossoverSignal}`);
 * ```
 */
export async function calculateAndSaveTSI(
  marketId: string,
  lookbackMinutes: number = 60
): Promise<TSIResult> {
  // Load configuration
  const config = await loadTSIConfig();

  // Fetch price history
  const priceHistory = await fetchPriceHistory(marketId, lookbackMinutes);

  // Calculate TSI
  const result = await calculateTSI(priceHistory, config);

  // Save to ClickHouse
  await saveTSIToClickHouse(marketId, result, config);

  return result;
}

/**
 * Save TSI result to ClickHouse market_price_momentum table
 *
 * Stores TSI values, smoothing configuration, and crossover signals
 * for historical tracking and backtesting.
 *
 * @param marketId - Market ID
 * @param result - TSI calculation result
 * @param config - TSI configuration used
 *
 * @example
 * ```typescript
 * await saveTSIToClickHouse('0x123...', tsiResult, config);
 * // Writes to market_price_momentum table
 * ```
 */
async function saveTSIToClickHouse(
  marketId: string,
  result: TSIResult,
  config: TSIConfig
): Promise<void> {
  try {
    // Convert smoothing methods to enum values for ClickHouse
    const smoothingEnumMap: Record<SmoothingMethod, number> = {
      SMA: 1,
      EMA: 2,
      RMA: 3,
    };

    const timestamp = Math.floor(Date.now() / 1000);

    await clickhouse.insert({
      table: 'market_price_momentum',
      values: [
        {
          market_id: marketId,
          timestamp,
          tsi_fast: result.tsiFast,
          tsi_fast_smoothing: smoothingEnumMap[config.fastSmoothing],
          tsi_fast_periods: config.fastPeriods,
          tsi_slow: result.tsiSlow,
          tsi_slow_smoothing: smoothingEnumMap[config.slowSmoothing],
          tsi_slow_periods: config.slowPeriods,
          crossover_signal: result.crossoverSignal,
          crossover_timestamp: result.crossoverTimestamp
            ? Math.floor(result.crossoverTimestamp.getTime() / 1000)
            : null,
          momentum_calculation_version: 'v1_tsi_austin',
        },
      ],
      format: 'JSONEachRow',
    });

    console.log(
      `[TSI] Saved result for ${marketId}: Fast=${result.tsiFast.toFixed(2)}, Slow=${result.tsiSlow.toFixed(2)}, Signal=${result.crossoverSignal}`
    );
  } catch (error) {
    console.error(`[TSI] Failed to save result for ${marketId}:`, error);
    throw error;
  }
}

/**
 * Calculate TSI for multiple markets in parallel
 *
 * Batch processing for efficiency. Useful for cron jobs that update
 * TSI values for all active markets.
 *
 * @param marketIds - Array of market IDs
 * @param lookbackMinutes - How many minutes of price history to use
 * @returns Map of market ID -> TSI result
 *
 * @example
 * ```typescript
 * const marketIds = ['0x123...', '0x456...', '0x789...'];
 * const results = await calculateTSIBatch(marketIds, 60);
 *
 * for (const [marketId, result] of results) {
 *   if (result.crossoverSignal === 'BULLISH') {
 *     console.log(`Bullish signal for ${marketId}!`);
 *   }
 * }
 * ```
 */
export async function calculateTSIBatch(
  marketIds: string[],
  lookbackMinutes: number = 60
): Promise<Map<string, TSIResult>> {
  const config = await loadTSIConfig();
  const results = new Map<string, TSIResult>();

  // Process in parallel with concurrency limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < marketIds.length; i += BATCH_SIZE) {
    const batch = marketIds.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async marketId => {
        const priceHistory = await fetchPriceHistory(marketId, lookbackMinutes);
        const result = await calculateTSI(priceHistory, config);
        await saveTSIToClickHouse(marketId, result, config);
        return { marketId, result };
      })
    );

    for (const settled of batchResults) {
      if (settled.status === 'fulfilled') {
        results.set(settled.value.marketId, settled.value.result);
      } else {
        console.error(`[TSI] Failed to calculate for market:`, settled.reason);
      }
    }
  }

  return results;
}

/**
 * Usage Examples
 *
 * @example
 * ```typescript
 * // 1. Simple TSI calculation
 * const config = await loadTSIConfig();
 * const priceHistory = await fetchPriceHistory('0x123...', 60);
 * const result = await calculateTSI(priceHistory, config);
 *
 * if (result.crossoverSignal === 'BULLISH') {
 *   console.log('Entry signal! Fast crossed above slow');
 * }
 *
 * // 2. Calculate and save in one call
 * const result2 = await calculateAndSaveTSI('0x456...', 60);
 *
 * // 3. Batch processing for multiple markets
 * const marketIds = ['0x123...', '0x456...', '0x789...'];
 * const results = await calculateTSIBatch(marketIds, 60);
 *
 * // 4. Custom configuration (for testing)
 * const customConfig: TSIConfig = {
 *   fastPeriods: 7,
 *   fastSmoothing: 'EMA',
 *   slowPeriods: 14,
 *   slowSmoothing: 'EMA'
 * };
 * const result3 = await calculateTSI(priceHistory, customConfig);
 * ```
 */
