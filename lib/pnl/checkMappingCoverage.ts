/**
 * Token Mapping Coverage Safeguard
 *
 * ALWAYS call this before running PnL calculations to ensure we have
 * adequate token mapping coverage. If coverage is below threshold,
 * the PnL calculation will be unreliable.
 *
 * Why this exists:
 * - 15-minute crypto markets aren't indexed by Gamma API or pm_market_metadata
 * - If tokens are unmapped, we can't calculate cost basis correctly
 * - Example: wallet 0x925a... had 54 unmapped tokens, causing $55 PnL error
 * - This was discovered 2025-12-22 during copy trade cohort analysis
 *
 * Usage:
 *   const coverage = await checkMappingCoverage(walletAddress);
 *   if (!coverage.reliable) {
 *     console.warn(`Wallet has ${coverage.unmappedTokens} unmapped tokens!`);
 *     return { reliable: false, reason: 'token_mapping_incomplete' };
 *   }
 *
 * Or use the assertion function:
 *   await assertMappingCoverage(walletAddress); // throws if coverage < 95%
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface MappingCoverageResult {
  wallet: string;
  totalTokens: number;
  mappedTokens: number;
  unmappedTokens: number;
  coveragePct: number;
  reliable: boolean;
  unmappedTokenSamples?: string[]; // First 5 unmapped tokens for debugging
}

const MINIMUM_COVERAGE_PCT = 95; // Below this, PnL is unreliable

/**
 * Check token mapping coverage for a wallet
 * @param wallet - Wallet address (lowercase, with 0x prefix)
 * @param options - Optional settings
 * @returns Coverage result with reliability flag
 */
export async function checkMappingCoverage(
  wallet: string,
  options?: {
    minCoveragePct?: number;
    includeUnmappedSamples?: boolean;
  }
): Promise<MappingCoverageResult> {
  const walletLower = wallet.toLowerCase();
  const minCoverage = options?.minCoveragePct ?? MINIMUM_COVERAGE_PCT;

  // Query: Get all distinct tokens for wallet and check mapping
  // Note: ClickHouse LEFT JOIN returns empty string '' not NULL for unmatched rows
  const coverageQ = `
    WITH tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${walletLower}'
       
    )
    SELECT
      count() as total,
      countIf(m.token_id_dec != '') as mapped_v5,
      countIf(p.token_id_dec != '') as mapped_patch,
      countIf(m.token_id_dec = '' AND p.token_id_dec = '') as unmapped
    FROM tokens t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    LEFT JOIN pm_token_to_condition_patch p ON t.token_id = p.token_id_dec
  `;

  const r = await clickhouse.query({ query: coverageQ, format: 'JSONEachRow' });
  const rows = await r.json() as Array<{
    total: number;
    mapped_v5: number;
    mapped_patch: number;
    unmapped: number;
  }>;
  const data = rows[0];

  const totalTokens = Number(data.total);
  const unmappedTokens = Number(data.unmapped);
  const mappedTokens = totalTokens - unmappedTokens;
  const coveragePct = totalTokens > 0 ? (mappedTokens / totalTokens) * 100 : 100;
  const reliable = coveragePct >= minCoverage;

  let unmappedTokenSamples: string[] | undefined;

  // Optionally get samples of unmapped tokens for debugging
  if (options?.includeUnmappedSamples && unmappedTokens > 0) {
    const sampleQ = `
      WITH tokens AS (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v3
        WHERE trader_wallet = '${walletLower}'
         
      )
      SELECT t.token_id
      FROM tokens t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      LEFT JOIN pm_token_to_condition_patch p ON t.token_id = p.token_id_dec
      WHERE m.token_id_dec = '' AND p.token_id_dec = ''
      LIMIT 5
    `;
    const sampleR = await clickhouse.query({ query: sampleQ, format: 'JSONEachRow' });
    const sampleRows = (await sampleR.json()) as { token_id: string }[];
    unmappedTokenSamples = sampleRows.map((r) => r.token_id);
  }

  return {
    wallet: walletLower,
    totalTokens,
    mappedTokens,
    unmappedTokens,
    coveragePct: Math.round(coveragePct * 10) / 10,
    reliable,
    unmappedTokenSamples,
  };
}

/**
 * Check mapping coverage for multiple wallets
 * Useful for validating a cohort before leaderboard calculation
 */
export async function checkCohortMappingCoverage(
  wallets: string[],
  options?: {
    minCoveragePct?: number;
  }
): Promise<{
  totalWallets: number;
  reliableWallets: number;
  unreliableWallets: number;
  results: MappingCoverageResult[];
}> {
  const results: MappingCoverageResult[] = [];

  for (const wallet of wallets) {
    const coverage = await checkMappingCoverage(wallet, options);
    results.push(coverage);
  }

  const reliableWallets = results.filter((r) => r.reliable).length;

  return {
    totalWallets: wallets.length,
    reliableWallets,
    unreliableWallets: wallets.length - reliableWallets,
    results,
  };
}

/**
 * Quick check if a wallet has any unmapped tokens
 * Faster than full coverage check for simple go/no-go decision
 */
export async function hasUnmappedTokens(wallet: string): Promise<boolean> {
  const coverage = await checkMappingCoverage(wallet);
  return coverage.unmappedTokens > 0;
}

/**
 * Check global token mapping coverage for recent trades
 *
 * Use this for system health checks and cron job monitoring.
 *
 * @param lookbackDays - How far back to look (default: 14)
 * @returns Coverage stats for all recent trades
 */
export async function checkGlobalMappingCoverage(
  lookbackDays = 14
): Promise<{
  totalTokens: number;
  mappedV5: number;
  mappedPatch: number;
  mappedCombined: number;
  unmapped: number;
  coveragePct: number;
}> {
  const query = `
    WITH recent_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v3
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL ${lookbackDays} DAY
    )
    SELECT
      count() as total_tokens,
      countIf(v5.token_id_dec IS NOT NULL AND v5.token_id_dec != '') as mapped_v5,
      countIf(p.token_id_dec IS NOT NULL AND p.token_id_dec != '') as mapped_patch,
      countIf(
        (v5.token_id_dec IS NOT NULL AND v5.token_id_dec != '') OR
        (p.token_id_dec IS NOT NULL AND p.token_id_dec != '')
      ) as mapped_combined,
      countIf(
        (v5.token_id_dec IS NULL OR v5.token_id_dec = '') AND
        (p.token_id_dec IS NULL OR p.token_id_dec = '')
      ) as unmapped
    FROM recent_tokens r
    LEFT JOIN pm_token_to_condition_map_v5 v5 ON r.token_id = v5.token_id_dec
    LEFT JOIN pm_token_to_condition_patch p ON r.token_id = p.token_id_dec
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const row = rows[0] || { total_tokens: 0, mapped_v5: 0, mapped_patch: 0, mapped_combined: 0, unmapped: 0 };

  const totalTokens = Number(row.total_tokens);
  const mappedCombined = Number(row.mapped_combined);
  const coveragePct = totalTokens > 0 ? Math.round((mappedCombined / totalTokens) * 1000) / 10 : 100;

  return {
    totalTokens,
    mappedV5: Number(row.mapped_v5),
    mappedPatch: Number(row.mapped_patch),
    mappedCombined,
    unmapped: Number(row.unmapped),
    coveragePct,
  };
}

/**
 * Assert that a wallet has sufficient mapping coverage
 * Throws an error if coverage is below threshold
 *
 * Use this as a guard at the start of PnL calculation functions:
 *   await assertMappingCoverage(wallet); // throws if < 95%
 *
 * @param wallet - Wallet address to check
 * @param minCoveragePct - Minimum required coverage (default: 95)
 * @throws Error if coverage is below threshold
 */
export async function assertMappingCoverage(
  wallet: string,
  minCoveragePct = MINIMUM_COVERAGE_PCT
): Promise<void> {
  const coverage = await checkMappingCoverage(wallet, {
    minCoveragePct,
    includeUnmappedSamples: true,
  });

  if (!coverage.reliable) {
    const samples = coverage.unmappedTokenSamples?.slice(0, 3).join(', ') || 'none';
    throw new Error(
      `Insufficient token mapping coverage for ${wallet}: ` +
      `${coverage.coveragePct}% (${coverage.mappedTokens}/${coverage.totalTokens} mapped). ` +
      `Threshold: ${minCoveragePct}%. ` +
      `Sample unmapped tokens: ${samples}`
    );
  }
}
