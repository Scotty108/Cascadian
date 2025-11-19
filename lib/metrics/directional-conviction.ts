/**
 * Directional Conviction Calculator
 *
 * Implements Austin's TSI momentum strategy's directional conviction scoring.
 * Combines three weighted components to determine smart money consensus:
 *
 * 1. Elite Consensus (50% weight) - % of elite wallets (Omega > 2.0) on this side
 * 2. Category Specialist Consensus (30% weight) - % of category specialists on this side
 * 3. Omega-Weighted Consensus (20% weight) - Vote weighted by omega scores
 *
 * Entry threshold: conviction >= 0.9 (Austin's "90% confident")
 *
 * @module lib/metrics/directional-conviction
 */

import { clickhouse } from '@/lib/clickhouse/client';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Input parameters for conviction calculation
 */
export interface ConvictionInput {
  /** Market ID to calculate conviction for */
  marketId: string;
  /** Condition ID from CTF Exchange */
  conditionId: string;
  /** Side to calculate conviction for (YES or NO) */
  side: 'YES' | 'NO';
  /** How many hours of trade history to look back (default: 24h) */
  lookbackHours?: number;
}

/**
 * Directional conviction calculation result
 */
export interface ConvictionResult {
  /** Composite conviction score (0-1) */
  directionalConviction: number;
  /** Elite consensus percentage (0-1) */
  eliteConsensusPct: number;
  /** Category specialist consensus percentage (0-1) */
  categorySpecialistPct: number;
  /** Omega-weighted consensus (0-1) */
  omegaWeightedConsensus: number;
  /** Whether this meets entry threshold (>= 0.9) */
  meetsEntryThreshold: boolean;

  // Supporting data for transparency
  /** Total number of elite wallets who traded this market */
  eliteWalletsCount: number;
  /** Number of elite wallets on the specified side */
  eliteWalletsOnSide: number;
  /** Total number of category specialists who traded */
  specialistsCount: number;
  /** Number of specialists on the specified side */
  specialistsOnSide: number;
  /** Sum of all omega scores (for weighted calculation) */
  totalOmegaWeight: number;

  /** Timestamp of calculation */
  timestamp: Date;
  /** Market ID */
  marketId: string;
  /** Condition ID */
  conditionId: string;
  /** Side evaluated */
  side: 'YES' | 'NO';
}

/**
 * Elite wallet position from ClickHouse
 */
interface ElitePosition {
  wallet_address: string;
  side: 'YES' | 'NO';
  omega: number;
  timestamp: string;
}

/**
 * Category specialist from Supabase
 */
interface CategorySpecialist {
  wallet_address: string;
  category_omega: number;
}

/**
 * Calculate directional conviction for a market
 *
 * This is the main function that combines elite wallet consensus,
 * category specialist consensus, and omega-weighted voting to
 * determine if smart money is aligned on a particular side.
 *
 * @param input - Conviction calculation parameters
 * @returns Conviction result with all component scores
 * @throws Error if market not found or data unavailable
 *
 * @example
 * ```typescript
 * const conviction = await calculateDirectionalConviction({
 *   marketId: '0x123...',
 *   conditionId: '0xabc...',
 *   side: 'YES',
 *   lookbackHours: 24
 * });
 *
 * if (conviction.meetsEntryThreshold) {
 *   console.log(`🎯 High conviction! Elite consensus: ${conviction.eliteConsensusPct * 100}%`);
 * }
 * ```
 */
export async function calculateDirectionalConviction(
  input: ConvictionInput
): Promise<ConvictionResult> {
  const lookbackHours = input.lookbackHours ?? 24;

  // Step 1: Fetch elite wallets who recently traded this market
  const elitePositions = await fetchEliteWalletPositions(
    input.conditionId,
    lookbackHours
  );

  if (elitePositions.length === 0) {
    // No elite wallets traded - return neutral consensus
    console.warn(`[Conviction] No elite wallets found for market ${input.marketId}`);
    return createNeutralResult(input);
  }

  // Step 2: Get market category and fetch category specialists
  const category = await getMarketCategory(input.marketId);
  let categorySpecialists: Map<string, number> = new Map();

  if (category) {
    categorySpecialists = await fetchCategorySpecialists(category);
  }

  // Step 3: Calculate elite consensus
  const eliteStats = calculateEliteConsensus(elitePositions, input.side);

  // Step 4: Calculate category specialist consensus
  const specialistStats = calculateSpecialistConsensus(
    elitePositions,
    categorySpecialists,
    input.side
  );

  // Step 5: Calculate omega-weighted consensus
  const omegaWeighted = calculateOmegaWeightedConsensus(elitePositions, input.side);

  // Step 6: Combine into final conviction score
  // Formula: 50% elite + 30% category specialists + 20% omega-weighted
  const directionalConviction =
    0.5 * eliteStats.consensusPct +
    0.3 * specialistStats.consensusPct +
    0.2 * omegaWeighted.consensusPct;

  const meetsEntryThreshold = directionalConviction >= 0.9;

  return {
    directionalConviction,
    eliteConsensusPct: eliteStats.consensusPct,
    categorySpecialistPct: specialistStats.consensusPct,
    omegaWeightedConsensus: omegaWeighted.consensusPct,
    meetsEntryThreshold,

    eliteWalletsCount: eliteStats.total,
    eliteWalletsOnSide: eliteStats.onSide,
    specialistsCount: specialistStats.total,
    specialistsOnSide: specialistStats.onSide,
    totalOmegaWeight: omegaWeighted.totalWeight,

    timestamp: new Date(),
    marketId: input.marketId,
    conditionId: input.conditionId,
    side: input.side,
  };
}

/**
 * Fetch elite wallets (Omega > 2.0) who recently traded this market
 *
 * Queries ClickHouse for recent trades by elite wallets, joining with
 * wallet_metrics_complete to filter by omega score.
 *
 * @param conditionId - Condition ID to filter trades
 * @param lookbackHours - How many hours of history to query
 * @returns Array of elite wallet positions with their omega scores
 */
async function fetchEliteWalletPositions(
  conditionId: string,
  lookbackHours: number
): Promise<ElitePosition[]> {
  try {
    const result = await clickhouse.query({
      query: `
        WITH elite_wallets AS (
          SELECT
            wallet_address,
            metric_2_omega_net as omega
          FROM wallet_metrics_complete
          WHERE window = 'lifetime'
            AND metric_2_omega_net > 2.0
            AND metric_22_resolved_bets >= 10
        ),
        recent_trades AS (
          SELECT
            wallet_address,
            side,
            timestamp,
            ROW_NUMBER() OVER (PARTITION BY wallet_address ORDER BY timestamp DESC) as rn
          FROM trades_raw
          WHERE condition_id = {conditionId:String}
            AND length(replaceAll(condition_id, '0x', '')) = 64
            AND timestamp >= now() - INTERVAL {lookback:UInt32} HOUR
            AND is_closed = 0
        )
        SELECT
          rt.wallet_address,
          rt.side,
          ew.omega,
          rt.timestamp
        FROM recent_trades rt
        INNER JOIN elite_wallets ew ON rt.wallet_address = ew.wallet_address
        WHERE rt.rn = 1
        ORDER BY rt.timestamp DESC
      `,
      query_params: {
        conditionId,
        lookback: lookbackHours,
      },
      format: 'JSONEachRow',
    });

    const data = (await result.json()) as Array<{
      wallet_address: string;
      side: 'YES' | 'NO';
      omega: string;
      timestamp: string;
    }>;

    return data.map((row) => ({
      wallet_address: row.wallet_address.toLowerCase(),
      side: row.side,
      omega: parseFloat(row.omega),
      timestamp: row.timestamp,
    }));
  } catch (error) {
    console.error('[Conviction] Failed to fetch elite wallet positions:', error);
    throw error;
  }
}

/**
 * Get market category from Supabase
 *
 * @param marketId - Market ID to look up
 * @returns Category name or null if not found
 */
async function getMarketCategory(marketId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('markets')
      .select('category')
      .eq('market_id', marketId)
      .single();

    if (error || !data) {
      console.warn(`[Conviction] Could not fetch category for market ${marketId}:`, error);
      return null;
    }

    return data.category;
  } catch (error) {
    console.error('[Conviction] Error fetching market category:', error);
    return null;
  }
}

/**
 * Fetch category specialists for a given category
 *
 * Queries Supabase wallet_category_tags for wallets identified as
 * specialists in this category (high category omega, likely specialist flag).
 *
 * @param category - Category name
 * @returns Map of wallet address -> category omega score
 */
async function fetchCategorySpecialists(
  category: string
): Promise<Map<string, number>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('wallet_category_tags')
      .select('wallet_address, category_omega')
      .eq('category', category)
      .eq('is_likely_specialist', true)
      .gte('category_omega', 2.0);

    if (error || !data) {
      console.warn(`[Conviction] No specialists found for category ${category}:`, error);
      return new Map();
    }

    return new Map(
      data.map((row) => [
        row.wallet_address.toLowerCase(),
        row.category_omega ?? 0,
      ])
    );
  } catch (error) {
    console.error('[Conviction] Error fetching category specialists:', error);
    return new Map();
  }
}

/**
 * Calculate elite consensus percentage
 *
 * Of all elite wallets who traded this market, what percentage
 * are on the specified side?
 *
 * @param positions - Elite wallet positions
 * @param side - Side to calculate consensus for
 * @returns Consensus stats
 */
function calculateEliteConsensus(
  positions: ElitePosition[],
  side: 'YES' | 'NO'
): { consensusPct: number; onSide: number; total: number } {
  if (positions.length === 0) {
    return { consensusPct: 0.5, onSide: 0, total: 0 }; // Neutral
  }

  const onSide = positions.filter((p) => p.side === side).length;
  const total = positions.length;
  const consensusPct = onSide / total;

  return { consensusPct, onSide, total };
}

/**
 * Calculate category specialist consensus percentage
 *
 * Of all category specialists who traded this market, what percentage
 * are on the specified side?
 *
 * @param positions - All elite wallet positions
 * @param specialists - Map of wallet address -> category omega
 * @param side - Side to calculate consensus for
 * @returns Specialist consensus stats
 */
function calculateSpecialistConsensus(
  positions: ElitePosition[],
  specialists: Map<string, number>,
  side: 'YES' | 'NO'
): { consensusPct: number; onSide: number; total: number } {
  // Filter positions to only include specialists
  const specialistPositions = positions.filter((p) =>
    specialists.has(p.wallet_address)
  );

  if (specialistPositions.length === 0) {
    // No specialists traded - fall back to elite consensus
    return calculateEliteConsensus(positions, side);
  }

  const onSide = specialistPositions.filter((p) => p.side === side).length;
  const total = specialistPositions.length;
  const consensusPct = onSide / total;

  return { consensusPct, onSide, total };
}

/**
 * Calculate omega-weighted consensus
 *
 * Weight each wallet's vote by their omega score.
 * Higher omega wallets get more weight.
 *
 * Formula:
 * - YES votes: omega × 1
 * - NO votes: omega × -1
 * - Normalize: (weighted_sum + total_omega) / (2 × total_omega)
 *   This maps [-total, +total] to [0, 1]
 *
 * @param positions - Elite wallet positions with omega scores
 * @param side - Side to calculate consensus for
 * @returns Omega-weighted consensus
 */
function calculateOmegaWeightedConsensus(
  positions: ElitePosition[],
  side: 'YES' | 'NO'
): { consensusPct: number; totalWeight: number } {
  if (positions.length === 0) {
    return { consensusPct: 0.5, totalWeight: 0 }; // Neutral
  }

  // Calculate weighted sum for the specified side
  const yesWeight = positions
    .filter((p) => p.side === 'YES')
    .reduce((sum, p) => sum + p.omega, 0);

  const noWeight = positions
    .filter((p) => p.side === 'NO')
    .reduce((sum, p) => sum + p.omega, 0);

  const totalWeight = yesWeight + noWeight;

  if (totalWeight === 0) {
    return { consensusPct: 0.5, totalWeight: 0 }; // Edge case: all omega scores are 0
  }

  // Calculate percentage for the specified side
  const sideWeight = side === 'YES' ? yesWeight : noWeight;
  const consensusPct = sideWeight / totalWeight;

  return { consensusPct, totalWeight };
}

/**
 * Create a neutral conviction result
 *
 * Used when no data is available (no elite wallets traded).
 * Returns 0.5 (50%) consensus across all metrics.
 *
 * @param input - Original conviction input
 * @returns Neutral conviction result
 */
function createNeutralResult(input: ConvictionInput): ConvictionResult {
  return {
    directionalConviction: 0.5,
    eliteConsensusPct: 0.5,
    categorySpecialistPct: 0.5,
    omegaWeightedConsensus: 0.5,
    meetsEntryThreshold: false,

    eliteWalletsCount: 0,
    eliteWalletsOnSide: 0,
    specialistsCount: 0,
    specialistsOnSide: 0,
    totalOmegaWeight: 0,

    timestamp: new Date(),
    marketId: input.marketId,
    conditionId: input.conditionId,
    side: input.side,
  };
}

/**
 * Save conviction result to ClickHouse momentum_trading_signals table
 *
 * This function is called by the signal generator to persist conviction
 * calculations along with TSI signals.
 *
 * Note: This is typically called by the signal generator, not directly.
 * The full signal record includes both TSI and conviction data.
 *
 * @param result - Conviction calculation result
 * @param signalId - UUID for the trading signal
 * @param tsi - TSI values (fast/slow lines)
 * @param midPrice - Current mid price
 *
 * @example
 * ```typescript
 * await saveConvictionToClickHouse(
 *   convictionResult,
 *   'uuid-here',
 *   { tsiFast: 45.2, tsiSlow: 38.1 },
 *   0.52
 * );
 * ```
 */
export async function saveConvictionToClickHouse(
  result: ConvictionResult,
  signalId: string,
  tsi: { tsiFast: number; tsiSlow: number },
  midPrice: number
): Promise<void> {
  try {
    await clickhouse.insert({
      table: 'momentum_trading_signals',
      values: [
        {
          signal_id: signalId,
          market_id: result.marketId,
          signal_timestamp: Math.floor(result.timestamp.getTime() / 1000),
          signal_type: 'HOLD', // Default - signal generator will update
          signal_direction: result.side,
          tsi_fast: tsi.tsiFast,
          tsi_slow: tsi.tsiSlow,
          crossover_type: null,
          tsi_fast_smoothing: 3, // RMA default
          tsi_slow_smoothing: 3, // RMA default
          directional_conviction: result.directionalConviction,
          elite_consensus_pct: result.eliteConsensusPct,
          category_specialist_pct: result.categorySpecialistPct,
          omega_weighted_consensus: result.omegaWeightedConsensus,
          elite_wallets_yes:
            result.side === 'YES' ? result.eliteWalletsOnSide : result.eliteWalletsCount - result.eliteWalletsOnSide,
          elite_wallets_no:
            result.side === 'NO' ? result.eliteWalletsOnSide : result.eliteWalletsCount - result.eliteWalletsOnSide,
          elite_wallets_total: result.eliteWalletsCount,
          mid_price: midPrice,
          volume_24h: null,
          liquidity_depth: null,
          signal_strength: result.meetsEntryThreshold ? 'STRONG' : 'WEAK',
          confidence_score: result.directionalConviction,
          meets_entry_threshold: result.meetsEntryThreshold ? 1 : 0,
          calculation_version: 'v1_tsi_austin',
        },
      ],
      format: 'JSONEachRow',
    });

    console.log(
      `[Conviction] Saved result for ${result.marketId}: conviction=${result.directionalConviction.toFixed(3)}, meets_threshold=${result.meetsEntryThreshold}`
    );
  } catch (error) {
    console.error('[Conviction] Failed to save to ClickHouse:', error);
    throw error;
  }
}

/**
 * Calculate conviction for both YES and NO sides
 *
 * Helper function to get conviction scores for both directions
 * at once. Useful for comparing which side has stronger conviction.
 *
 * @param marketId - Market ID
 * @param conditionId - Condition ID
 * @param lookbackHours - How many hours to look back
 * @returns Object with YES and NO conviction results
 *
 * @example
 * ```typescript
 * const both = await calculateBothSides('0x123...', '0xabc...', 24);
 *
 * if (both.YES.directionalConviction > both.NO.directionalConviction) {
 *   console.log('Smart money favors YES');
 * }
 * ```
 */
export async function calculateBothSides(
  marketId: string,
  conditionId: string,
  lookbackHours: number = 24
): Promise<{ YES: ConvictionResult; NO: ConvictionResult }> {
  const [yesConviction, noConviction] = await Promise.all([
    calculateDirectionalConviction({
      marketId,
      conditionId,
      side: 'YES',
      lookbackHours,
    }),
    calculateDirectionalConviction({
      marketId,
      conditionId,
      side: 'NO',
      lookbackHours,
    }),
  ]);

  return { YES: yesConviction, NO: noConviction };
}

/**
 * Batch calculate conviction for multiple markets
 *
 * Processes multiple markets in parallel with concurrency control.
 *
 * @param inputs - Array of conviction inputs
 * @param batchSize - How many to process in parallel (default: 5)
 * @returns Map of market ID -> conviction result
 *
 * @example
 * ```typescript
 * const results = await calculateConvictionBatch([
 *   { marketId: '0x123...', conditionId: '0xabc...', side: 'YES' },
 *   { marketId: '0x456...', conditionId: '0xdef...', side: 'YES' },
 * ]);
 *
 * for (const [marketId, result] of results) {
 *   console.log(`${marketId}: ${result.directionalConviction}`);
 * }
 * ```
 */
export async function calculateConvictionBatch(
  inputs: ConvictionInput[],
  batchSize: number = 5
): Promise<Map<string, ConvictionResult>> {
  const results = new Map<string, ConvictionResult>();

  // Process in batches
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(async (input) => {
        const result = await calculateDirectionalConviction(input);
        return { marketId: input.marketId, result };
      })
    );

    for (const settled of batchResults) {
      if (settled.status === 'fulfilled') {
        results.set(settled.value.marketId, settled.value.result);
      } else {
        console.error('[Conviction] Batch calculation failed:', settled.reason);
      }
    }
  }

  return results;
}

/**
 * Get conviction threshold from environment or use default
 *
 * Allows runtime configuration of the entry threshold via environment variable.
 * Defaults to Austin's 0.9 (90% confident) threshold.
 *
 * @returns Conviction threshold (0-1)
 */
export function getConvictionThreshold(): number {
  const envThreshold = process.env.ENTRY_CONVICTION_THRESHOLD;
  if (envThreshold) {
    const threshold = parseFloat(envThreshold);
    if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
      return threshold;
    }
  }
  return 0.9; // Austin's default
}

/**
 * Usage Examples
 *
 * @example
 * ```typescript
 * // 1. Simple conviction calculation
 * const conviction = await calculateDirectionalConviction({
 *   marketId: '0x123...',
 *   conditionId: '0xabc...',
 *   side: 'YES',
 *   lookbackHours: 24
 * });
 *
 * console.log(`Directional conviction: ${conviction.directionalConviction.toFixed(3)}`);
 * console.log(`Elite consensus: ${(conviction.eliteConsensusPct * 100).toFixed(1)}%`);
 * console.log(`Meets threshold: ${conviction.meetsEntryThreshold}`);
 *
 * // 2. Integration with TSI for trading signals
 * const [tsi, conviction] = await Promise.all([
 *   calculateAndSaveTSI(marketId, 60),
 *   calculateDirectionalConviction({
 *     marketId,
 *     conditionId,
 *     side: 'YES'
 *   })
 * ]);
 *
 * if (tsi.crossoverSignal === 'BULLISH' && conviction.meetsEntryThreshold) {
 *   console.log('🎯 ENTRY SIGNAL! Bullish momentum + high elite conviction');
 * }
 *
 * // 3. Compare both sides
 * const both = await calculateBothSides(marketId, conditionId);
 * const stronger = both.YES.directionalConviction > both.NO.directionalConviction ? 'YES' : 'NO';
 * console.log(`Smart money favors: ${stronger}`);
 *
 * // 4. Batch processing
 * const markets = [
 *   { marketId: '0x123...', conditionId: '0xabc...', side: 'YES' as const },
 *   { marketId: '0x456...', conditionId: '0xdef...', side: 'YES' as const },
 * ];
 *
 * const results = await calculateConvictionBatch(markets);
 * const highConviction = Array.from(results.values())
 *   .filter(r => r.meetsEntryThreshold);
 *
 * console.log(`Found ${highConviction.length} high-conviction opportunities`);
 * ```
 */
