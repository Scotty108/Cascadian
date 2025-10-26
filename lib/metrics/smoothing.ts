/**
 * TSI Smoothing Library
 *
 * Implements three smoothing methods for the True Strength Index (TSI) and other technical indicators:
 * - SMA: Simple Moving Average
 * - EMA: Exponential Moving Average
 * - RMA: Running Moving Average (Wilder's Smoothing)
 *
 * All methods are runtime-configurable based on the smoothing_configurations table.
 *
 * @module lib/metrics/smoothing
 */

/**
 * Available smoothing methods
 */
export type SmoothingMethod = 'SMA' | 'EMA' | 'RMA';

/**
 * Simple Moving Average (SMA)
 *
 * Calculates the arithmetic mean of the last N values in a rolling window.
 * Each value in the window has equal weight.
 *
 * Formula: SMA = (sum of last N values) / N
 *
 * @example
 * ```typescript
 * const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const smoothed = sma(values, 3);
 * // Returns: [NaN, NaN, 2, 3, 4, 5, 6, 7, 8, 9]
 * // First 2 values are NaN because we need 3 values for the average
 * ```
 *
 * @param values - Array of numeric values to smooth
 * @param period - Number of periods for the moving average (must be > 0)
 * @returns Array of smoothed values (same length as input)
 */
export function sma(values: number[], period: number): number[] {
  // Validate inputs
  if (!values || values.length === 0) {
    return [];
  }

  if (period <= 0) {
    throw new Error('Period must be greater than 0');
  }

  if (!Number.isInteger(period)) {
    throw new Error('Period must be an integer');
  }

  const result: number[] = new Array(values.length);

  // Fill initial values with NaN until we have enough data
  for (let i = 0; i < Math.min(period - 1, values.length); i++) {
    result[i] = NaN;
  }

  // Calculate SMA for each position where we have enough data
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += values[i - j];
    }
    result[i] = sum / period;
  }

  return result;
}

/**
 * Exponential Moving Average (EMA)
 *
 * Applies exponentially decreasing weights to older values.
 * More responsive to recent changes than SMA.
 *
 * Formula:
 * - alpha = 2 / (period + 1)
 * - EMA[0] = SMA of first N values
 * - EMA[i] = alpha * value[i] + (1 - alpha) * EMA[i-1]
 *
 * @example
 * ```typescript
 * const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const smoothed = ema(values, 3);
 * // Returns smoothed values with more weight on recent data
 * // First 2 values are NaN, then EMA starts with SMA seed
 * ```
 *
 * @param values - Array of numeric values to smooth
 * @param period - Number of periods for the EMA (must be > 0)
 * @returns Array of smoothed values (same length as input)
 */
export function ema(values: number[], period: number): number[] {
  // Validate inputs
  if (!values || values.length === 0) {
    return [];
  }

  if (period <= 0) {
    throw new Error('Period must be greater than 0');
  }

  if (!Number.isInteger(period)) {
    throw new Error('Period must be an integer');
  }

  const result: number[] = new Array(values.length);
  const alpha = 2 / (period + 1);

  // Fill initial values with NaN until we have enough data
  for (let i = 0; i < Math.min(period - 1, values.length); i++) {
    result[i] = NaN;
  }

  // If we don't have enough values, return early
  if (values.length < period) {
    return result;
  }

  // Initialize EMA with SMA of first period values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = sum / period;

  // Calculate EMA for remaining values
  for (let i = period; i < values.length; i++) {
    result[i] = alpha * values[i] + (1 - alpha) * result[i - 1];
  }

  return result;
}

/**
 * Running Moving Average (RMA) / Wilder's Smoothing
 *
 * A variation of EMA with less weight on recent values (slower smoothing).
 * Commonly used in RSI and other Wilder indicators.
 *
 * Formula:
 * - alpha = 1 / period
 * - RMA[0] = SMA of first N values
 * - RMA[i] = alpha * value[i] + (1 - alpha) * RMA[i-1]
 *
 * Equivalent to: RMA[i] = (RMA[i-1] * (period - 1) + value[i]) / period
 *
 * @example
 * ```typescript
 * const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const smoothed = rma(values, 3);
 * // Returns smoothed values with slower response than EMA
 * // First 2 values are NaN, then RMA starts with SMA seed
 * ```
 *
 * @param values - Array of numeric values to smooth
 * @param period - Number of periods for the RMA (must be > 0)
 * @returns Array of smoothed values (same length as input)
 */
export function rma(values: number[], period: number): number[] {
  // Validate inputs
  if (!values || values.length === 0) {
    return [];
  }

  if (period <= 0) {
    throw new Error('Period must be greater than 0');
  }

  if (!Number.isInteger(period)) {
    throw new Error('Period must be an integer');
  }

  const result: number[] = new Array(values.length);
  const alpha = 1 / period;

  // Fill initial values with NaN until we have enough data
  for (let i = 0; i < Math.min(period - 1, values.length); i++) {
    result[i] = NaN;
  }

  // If we don't have enough values, return early
  if (values.length < period) {
    return result;
  }

  // Initialize RMA with SMA of first period values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = sum / period;

  // Calculate RMA for remaining values
  for (let i = period; i < values.length; i++) {
    result[i] = alpha * values[i] + (1 - alpha) * result[i - 1];
  }

  return result;
}

/**
 * Get a smoothing function by method name
 *
 * Returns the appropriate smoothing function based on the method parameter.
 * Useful for runtime configuration based on smoothing_configurations table.
 *
 * @example
 * ```typescript
 * // Runtime configuration example
 * const config = await getConfigFromDatabase(); // Returns { method: 'EMA', period: 5 }
 * const smoothingFn = getSmoothing(config.method);
 * const smoothed = smoothingFn(values, config.period);
 * ```
 *
 * @param method - The smoothing method to use ('SMA', 'EMA', or 'RMA')
 * @returns The smoothing function for the specified method
 * @throws Error if method is not recognized
 */
export function getSmoothing(
  method: SmoothingMethod
): (values: number[], period: number) => number[] {
  switch (method) {
    case 'SMA':
      return sma;
    case 'EMA':
      return ema;
    case 'RMA':
      return rma;
    default:
      throw new Error(`Unknown smoothing method: ${method}`);
  }
}

/**
 * Helper function to apply double smoothing (for TSI calculation)
 *
 * TSI requires double smoothing: first with one period, then with another.
 * This helper makes it easy to apply two smoothing operations in sequence.
 *
 * @example
 * ```typescript
 * const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const doubleSmoothed = doubleSmooth(values, 'EMA', 13, 25);
 * // First applies EMA with period 13, then EMA with period 25
 * ```
 *
 * @param values - Array of numeric values to smooth
 * @param method - The smoothing method to use
 * @param firstPeriod - Period for first smoothing pass
 * @param secondPeriod - Period for second smoothing pass
 * @returns Array of double-smoothed values
 */
export function doubleSmooth(
  values: number[],
  method: SmoothingMethod,
  firstPeriod: number,
  secondPeriod: number
): number[] {
  const smoothingFn = getSmoothing(method);
  const firstPass = smoothingFn(values, firstPeriod);
  return smoothingFn(firstPass, secondPeriod);
}

/**
 * Validate smoothing configuration
 *
 * Checks if a smoothing configuration is valid before use.
 * Useful for validating data from smoothing_configurations table.
 *
 * @example
 * ```typescript
 * const config = { method: 'EMA', period: 13 };
 * if (validateSmoothingConfig(config.method, config.period)) {
 *   // Safe to use
 * }
 * ```
 *
 * @param method - The smoothing method
 * @param period - The period value
 * @returns true if configuration is valid, false otherwise
 */
export function validateSmoothingConfig(
  method: string,
  period: number
): method is SmoothingMethod {
  const validMethods: SmoothingMethod[] = ['SMA', 'EMA', 'RMA'];
  return (
    validMethods.includes(method as SmoothingMethod) &&
    Number.isInteger(period) &&
    period > 0
  );
}

/**
 * Calculate percentage of valid (non-NaN) values in smoothed output
 *
 * Useful for understanding data coverage after smoothing.
 *
 * @param smoothedValues - Array of smoothed values
 * @returns Percentage of valid values (0-100)
 */
export function getValidDataPercentage(smoothedValues: number[]): number {
  if (smoothedValues.length === 0) {
    return 0;
  }

  const validCount = smoothedValues.filter(v => !isNaN(v)).length;
  return (validCount / smoothedValues.length) * 100;
}
