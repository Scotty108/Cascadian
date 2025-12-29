/**
 * Strict Resolution Loader
 *
 * Loads token resolutions with proper handling of NULL/empty payout_numerators.
 * CRITICAL: Empty payout_numerators must be treated as UNRESOLVED, not loss (payout=0).
 *
 * Key insight: JSONExtractInt returns 0 for empty strings, which would incorrectly
 * mark unresolved markets as losses. This module filters them properly.
 */
import { getClickHouseClient } from '../clickhouse/client';

export interface Resolution {
  tokenId: string;
  payout: number; // 0 = losing outcome, 1 = winning outcome
}

export interface ResolutionLoadResult {
  resolutions: Map<string, number>;
  stats: {
    totalTokensInMap: number;
    fullyResolved: number;
    unresolvedEmpty: number;
    unresolvedNoEntry: number;
  };
}

/**
 * Load resolutions with strict filtering of invalid/empty payout_numerators.
 *
 * @returns Map of token_id_dec -> payout (0 or 1)
 */
export async function loadResolutionsStrict(): Promise<ResolutionLoadResult> {
  const client = getClickHouseClient();

  // Load resolutions with strict filtering:
  // 1. payout_numerators must NOT be NULL
  // 2. payout_numerators must NOT be empty string
  // 3. payout_numerators must have length > 2 (not '[]')
  const result = await client.query({
    query: `
      SELECT
        m.token_id_dec as token_id,
        -- Normalize payout: >= 1000 means winner (1), otherwise use raw value (0 or 1)
        if(JSONExtractInt(r.payout_numerators, m.outcome_index + 1) >= 1000, 1,
           JSONExtractInt(r.payout_numerators, m.outcome_index + 1)) as payout
      FROM pm_token_to_condition_map_v5 m
      INNER JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.payout_numerators IS NOT NULL
        AND r.payout_numerators != ''
        AND length(r.payout_numerators) > 2
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as { token_id: string; payout: number }[];
  const resolutions = new Map<string, number>();

  for (const r of rows) {
    // Double-check payout is valid (0 or 1)
    const payout = Number(r.payout);
    if (payout === 0 || payout === 1) {
      resolutions.set(r.token_id, payout);
    }
  }

  // Get stats for diagnostics
  const statsResult = await client.query({
    query: `
      SELECT
        count() as total_tokens,
        countIf(r.condition_id IS NOT NULL
          AND r.payout_numerators IS NOT NULL
          AND r.payout_numerators != ''
          AND length(r.payout_numerators) > 2) as fully_resolved,
        countIf(r.condition_id IS NOT NULL
          AND (r.payout_numerators IS NULL OR r.payout_numerators = '' OR length(r.payout_numerators) <= 2)) as unresolved_empty,
        countIf(r.condition_id IS NULL) as unresolved_no_entry
      FROM pm_token_to_condition_map_v5 m
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    `,
    format: 'JSONEachRow',
  });

  const stats = (await statsResult.json()) as any[];
  const s = stats[0];

  return {
    resolutions,
    stats: {
      totalTokensInMap: Number(s.total_tokens),
      fullyResolved: Number(s.fully_resolved),
      unresolvedEmpty: Number(s.unresolved_empty),
      unresolvedNoEntry: Number(s.unresolved_no_entry),
    },
  };
}

/**
 * Diagnostic: Print resolution coverage statistics
 */
export async function printResolutionDiagnostics(): Promise<void> {
  const { resolutions, stats } = await loadResolutionsStrict();

  console.log('=== Resolution Diagnostics ===');
  console.log('Token map total:', stats.totalTokensInMap.toLocaleString());
  console.log('Fully resolved:', stats.fullyResolved.toLocaleString());
  console.log('Unresolved (empty payout):', stats.unresolvedEmpty.toLocaleString());
  console.log('Unresolved (no entry):', stats.unresolvedNoEntry.toLocaleString());
  console.log('Loaded to map:', resolutions.size.toLocaleString());

  // Count wins vs losses
  let wins = 0;
  let losses = 0;
  for (const payout of resolutions.values()) {
    if (payout === 1) wins++;
    else losses++;
  }
  console.log('\nPayout distribution:');
  console.log('  Winners (payout=1):', wins.toLocaleString());
  console.log('  Losers (payout=0):', losses.toLocaleString());
}

/**
 * Check if a token is resolved
 * Returns: { resolved: true, payout: 0|1 } or { resolved: false }
 */
export function getTokenResolution(
  resolutions: Map<string, number>,
  tokenId: string
): { resolved: true; payout: number } | { resolved: false } {
  const payout = resolutions.get(tokenId);
  if (payout !== undefined) {
    return { resolved: true, payout };
  }
  return { resolved: false };
}
