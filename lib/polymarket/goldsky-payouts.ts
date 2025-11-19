/**
 * Goldsky Payout Vector Client
 *
 * Fetches payout vectors from Goldsky GraphQL subgraph API
 * Supports batch queries up to 1,000 condition IDs per request
 *
 * @module lib/polymarket/goldsky-payouts
 */

const GOLDSKY_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RATE_LIMIT_DELAY_MS = 500; // 2 req/sec

export interface PayoutVector {
  condition_id: string; // Without 0x prefix (normalized)
  payout_numerators: number[];
  payout_denominator: number;
  winning_index: number;
  resolved_at: Date;
  source: string;
}

interface GoldskyCondition {
  id: string; // With 0x prefix
  payouts: string[] | null;
}

interface GoldskyResponse {
  data: {
    conditions: GoldskyCondition[];
  };
  errors?: Array<{ message: string }>;
}

/**
 * Sleep utility for rate limiting and retries
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate winning index from payout array
 * Returns index of maximum payout value
 */
function calculateWinningIndex(payouts: number[]): number {
  if (payouts.length === 0) return -1;

  let maxIndex = 0;
  let maxValue = payouts[0];

  for (let i = 1; i < payouts.length; i++) {
    if (payouts[i] > maxValue) {
      maxValue = payouts[i];
      maxIndex = i;
    }
  }

  return maxIndex;
}

/**
 * Parse Goldsky payout strings to PayoutVector
 * Handles both decimal (0.54) and integer (1) formats
 */
function parsePayoutVector(condition: GoldskyCondition): PayoutVector | null {
  if (!condition.payouts || condition.payouts.length === 0) {
    return null; // Not resolved yet
  }

  // Parse payout strings to floats
  const payoutFloats = condition.payouts.map(p => parseFloat(p));

  // Check if all payouts are valid numbers
  if (payoutFloats.some(p => isNaN(p))) {
    console.warn(`Invalid payout format for ${condition.id}:`, condition.payouts);
    return null;
  }

  // Detect if payouts are already integers (1, 0) or decimals (0.54, 0.46)
  const isInteger = payoutFloats.every(p => p === Math.floor(p));

  let payout_numerators: number[];
  let payout_denominator: number;

  if (isInteger) {
    // Already in integer format (1, 0)
    payout_numerators = payoutFloats;
    payout_denominator = 1;
  } else {
    // Decimal format (0.54, 0.46) - scale to integers
    // Find appropriate denominator (try 100, 1000, 10000)
    const sum = payoutFloats.reduce((a, b) => a + b, 0);

    if (Math.abs(sum - 1.0) > 0.001) {
      console.warn(`Payouts don't sum to 1.0 for ${condition.id}: sum=${sum}`);
    }

    // Use 10000 as denominator for 4 decimal precision
    payout_denominator = 10000;
    payout_numerators = payoutFloats.map(p => Math.round(p * payout_denominator));
  }

  const winning_index = calculateWinningIndex(payout_numerators);

  // Normalize condition_id (remove 0x prefix, lowercase)
  const normalized_id = condition.id.toLowerCase().replace(/^0x/, '');

  return {
    condition_id: normalized_id,
    payout_numerators,
    payout_denominator,
    winning_index,
    resolved_at: new Date(), // Goldsky doesn't provide resolved_at, use current time
    source: 'goldsky-api',
  };
}

/**
 * Fetch payout vectors for a batch of condition IDs
 *
 * @param conditionIds - Array of condition IDs (without 0x prefix)
 * @param retries - Number of retries remaining (internal)
 * @returns Array of PayoutVectors (may be less than input if some not resolved)
 */
export async function fetchPayoutsBatch(
  conditionIds: string[],
  retries = MAX_RETRIES
): Promise<PayoutVector[]> {
  if (conditionIds.length === 0) {
    return [];
  }

  if (conditionIds.length > 1000) {
    throw new Error(`Batch size ${conditionIds.length} exceeds limit of 1000`);
  }

  // Add 0x prefix for Goldsky query
  const prefixedIds = conditionIds.map(id => `0x${id}`);

  // Build GraphQL query
  const idsString = prefixedIds.map(id => `"${id}"`).join(', ');
  const query = `{
    conditions(where: {id_in: [${idsString}]}) {
      id
      payouts
    }
  }`;

  try {
    const response = await fetch(GOLDSKY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result: GoldskyResponse = await response.json();

    // Check for GraphQL errors
    if (result.errors && result.errors.length > 0) {
      const errorMsg = result.errors.map(e => e.message).join(', ');
      throw new Error(`GraphQL errors: ${errorMsg}`);
    }

    if (!result.data || !result.data.conditions) {
      throw new Error('Invalid response format: missing data.conditions');
    }

    // Parse conditions to payout vectors
    const payouts: PayoutVector[] = [];
    for (const condition of result.data.conditions) {
      const payout = parsePayoutVector(condition);
      if (payout) {
        payouts.push(payout);
      }
    }

    // Rate limit: wait before next request
    await sleep(RATE_LIMIT_DELAY_MS);

    return payouts;

  } catch (error) {
    if (retries > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, MAX_RETRIES - retries);
      console.warn(`Fetch failed, retrying in ${delay}ms... (${retries} retries left)`);
      console.warn(`Error: ${error instanceof Error ? error.message : String(error)}`);

      await sleep(delay);
      return fetchPayoutsBatch(conditionIds, retries - 1);
    }

    throw error;
  }
}

/**
 * Fetch payouts with concurrent batching
 * Splits large arrays into batches and fetches concurrently
 *
 * @param conditionIds - Array of condition IDs (without 0x prefix)
 * @param batchSize - Size of each batch (default 1000)
 * @param concurrency - Number of concurrent requests (default 5)
 */
export async function fetchPayoutsConcurrent(
  conditionIds: string[],
  batchSize = 1000,
  concurrency = 5
): Promise<PayoutVector[]> {
  const batches: string[][] = [];

  // Split into batches
  for (let i = 0; i < conditionIds.length; i += batchSize) {
    batches.push(conditionIds.slice(i, i + batchSize));
  }

  const results: PayoutVector[] = [];

  // Process batches with concurrency limit
  for (let i = 0; i < batches.length; i += concurrency) {
    const batchPromises = batches
      .slice(i, i + concurrency)
      .map(batch => fetchPayoutsBatch(batch));

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.flat());
  }

  return results;
}
