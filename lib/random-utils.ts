/**
 * Statistical distribution utilities for realistic data generation
 */

/**
 * Generate a normally distributed random number (bell curve)
 * Uses Box-Muller transform
 */
export function normalDistribution(
  mean: number,
  stdDev: number,
  min: number,
  max: number
): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random(); // Converting [0,1) to (0,1)
  while (v === 0) v = Math.random();

  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  const value = num * stdDev + mean;

  // Clamp to min/max
  return Math.max(min, Math.min(max, value));
}

/**
 * Generate a power law distributed random number (long tail)
 * Perfect for position sizes, volumes, etc.
 */
export function powerLawRandom(
  min: number,
  max: number,
  alpha: number = 1.5
): number {
  const u = Math.random();
  const range = max - min;

  // Inverse transform sampling for power law
  const value = min * Math.pow(
    1 - u * (1 - Math.pow(min / max, alpha)),
    -1 / alpha
  );

  return Math.min(max, value);
}

/**
 * Generate a beta distributed random number (0-1 bounded)
 * Useful for prices, percentages
 */
export function betaDistribution(alpha: number, beta: number): number {
  const gamma1 = gammaRandom(alpha);
  const gamma2 = gammaRandom(beta);

  return gamma1 / (gamma1 + gamma2);
}

/**
 * Gamma distribution (helper for beta distribution)
 * Uses Marsaglia and Tsang method
 */
function gammaRandom(shape: number): number {
  if (shape < 1) {
    return gammaRandom(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x, v;
    do {
      x = normalDistribution(0, 1, -10, 10);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();

    if (u < 1 - 0.0331 * x * x * x * x) {
      return d * v;
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Generate random float between min and max
 */
export function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Generate random integer between min and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(randomFloat(min, max + 1));
}

/**
 * Select random item from array with optional weights
 */
export function weightedRandom<T>(
  options: T[],
  weights?: number[]
): T {
  if (!weights || weights.length !== options.length) {
    // Uniform distribution
    return options[randomInt(0, options.length - 1)];
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < options.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return options[i];
    }
  }

  return options[options.length - 1];
}

/**
 * Select random item from array
 */
export function randomFromList<T>(list: T[]): T {
  return list[randomInt(0, list.length - 1)];
}

/**
 * Round number to nearest tick size
 */
export function roundToTick(value: number, tickSize: number): number {
  return Math.round(value / tickSize) * tickSize;
}

/**
 * Generate date in the past
 */
export function pastDate(minDays: number, maxDays: number): Date {
  const days = randomInt(minDays, maxDays);
  return new Date(Date.now() - days * 86400000);
}

/**
 * Generate date in the future
 */
export function futureDate(minDays: number, maxDays: number): Date {
  const days = randomInt(minDays, maxDays);
  return new Date(Date.now() + days * 86400000);
}

/**
 * Generate recent date (within hours)
 */
export function recentDate(minHours: number, maxHours: number): Date {
  const hours = randomInt(minHours, maxHours);
  return new Date(Date.now() - hours * 3600000);
}

/**
 * Calculate hours between now and future date
 */
export function calculateHoursToClose(endDate: Date): number {
  return Math.floor((endDate.getTime() - Date.now()) / 3600000);
}
