/**
 * On-Demand Token Mapper
 *
 * Fetches market metadata from Polymarket API for unmapped tokens
 * and inserts into both metadata and token map tables immediately.
 *
 * Used when UI detects unmapped tokens to eliminate lag.
 *
 * Features:
 * - Cloudflare error detection and handling
 * - ClickHouse fallback when API is blocked
 * - Rate limiting to prevent blocks
 */

import { clickhouse } from '../clickhouse/client';
import { fetchPolymarketAPI } from './api-utils';

interface PolymarketMarket {
  conditionId: string;
  question: string;
  clobTokenIds: string; // JSON string array like "[\"123\", \"456\"]"
  category?: string;
  image?: string;
  endDateIso?: string;
  outcomes?: string; // JSON string like "[\"Yes\", \"No\"]"
}

/**
 * Try to find market in ClickHouse first (faster, no rate limits)
 */
async function lookupMarketInClickHouse(tokenId: string): Promise<PolymarketMarket | null> {
  try {
    const query = `
      SELECT
        condition_id as conditionId,
        question,
        arrayStringConcat(token_ids, '","') as tokenIdsRaw,
        category,
        image_url as image,
        end_date as endDateIso
      FROM pm_market_metadata
      WHERE has(token_ids, '${tokenId}')
      LIMIT 1
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];

    if (rows.length > 0) {
      const row = rows[0];
      // Format clobTokenIds as JSON string array
      const clobTokenIds = row.tokenIdsRaw
        ? `["${row.tokenIdsRaw}"]`
        : '[]';

      console.log(`[on-demand-mapper] ✅ Found in ClickHouse: ${row.question?.slice(0, 50)}...`);

      return {
        conditionId: row.conditionId,
        question: row.question || '',
        clobTokenIds,
        category: row.category,
        image: row.image,
        endDateIso: row.endDateIso,
      };
    }
  } catch (error: any) {
    console.log(`[on-demand-mapper] ClickHouse lookup failed:`, error.message);
  }

  return null;
}

/**
 * Fetch market metadata from Polymarket Gamma API by token ID
 * Now with Cloudflare error detection and rate limiting
 */
async function fetchMarketByToken(tokenId: string): Promise<PolymarketMarket | null> {
  // First try ClickHouse (faster, no rate limits)
  const cachedMarket = await lookupMarketInClickHouse(tokenId);
  if (cachedMarket) {
    return cachedMarket;
  }

  // Fall back to API
  const url = `https://gamma-api.polymarket.com/markets?token_id=${tokenId}`;
  const { data, error, isCloudflareBlocked } = await fetchPolymarketAPI<any[]>(url);

  if (isCloudflareBlocked) {
    console.error(`[on-demand-mapper] Cloudflare blocked - cannot fetch token ${tokenId.slice(0, 20)}...`);
    return null;
  }

  if (error) {
    console.error(`[on-demand-mapper] API error: ${error}`);
    return null;
  }

  if (!data) {
    console.error(`[on-demand-mapper] No data returned`);
    return null;
  }

  // Handle both array and single object responses
  const market = Array.isArray(data) ? data[0] : data;

  if (!market) {
    console.error(`[on-demand-mapper] No market found for token ${tokenId.slice(0, 20)}...`);
    return null;
  }

  // Validate required fields
  if (!market.clobTokenIds) {
    console.error(`[on-demand-mapper] Invalid market structure - missing clobTokenIds`);
    console.log(`[on-demand-mapper] Market keys: ${Object.keys(market).join(', ')}`);
    return null;
  }

  // Validate JSON can be parsed
  try {
    const tokenIds = JSON.parse(market.clobTokenIds);
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      console.error(`[on-demand-mapper] clobTokenIds is not a valid array`);
      return null;
    }
  } catch (e) {
    console.error(`[on-demand-mapper] Failed to parse clobTokenIds JSON`);
    return null;
  }

  return market;
}

/**
 * Insert market metadata into pm_market_metadata
 */
async function insertMetadata(market: PolymarketMarket): Promise<void> {
  const tokenIds = JSON.parse(market.clobTokenIds || '[]');

  await clickhouse.insert({
    table: 'pm_market_metadata',
    values: [{
      condition_id: market.conditionId,
      question: market.question || '',
      category: market.category || '',
      image_url: market.image || '',
      token_ids: tokenIds,
      end_date: market.endDateIso || '2030-01-01 00:00:00',
      updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    }],
    format: 'JSONEachRow',
  });
}

/**
 * Insert token mappings into pm_token_to_condition_map_v5
 */
async function insertTokenMappings(market: PolymarketMarket): Promise<void> {
  const tokenIds = JSON.parse(market.clobTokenIds || '[]');

  const mappings = tokenIds.map((tokenId: string, idx: number) => ({
    token_id_dec: tokenId,
    condition_id: market.conditionId,
    outcome_index: idx,
    question: market.question || '',
    category: market.category || '',
  }));

  await clickhouse.insert({
    table: 'pm_token_to_condition_map_v5',
    values: mappings,
    format: 'JSONEachRow',
  });
}

/**
 * Map a single unmapped token on-demand
 *
 * @param tokenId - The unmapped token ID (decimal string)
 * @returns Object with question and condition_id, or null if failed
 */
export async function mapTokenOnDemand(
  tokenId: string
): Promise<{ question: string; condition_id: string; outcome_index: number } | null> {
  try {
    console.log(`[on-demand-mapper] Mapping token ${tokenId.slice(0, 20)}...`);

    // Fetch from Polymarket
    const market = await fetchMarketByToken(tokenId);
    if (!market) {
      return null;
    }

    // Insert metadata
    await insertMetadata(market);

    // Insert token mappings
    await insertTokenMappings(market);

    // Find which outcome this token is
    const tokenIds = JSON.parse(market.clobTokenIds || '[]');
    const tokenIndex = tokenIds.findIndex((id: string) => id === tokenId);

    console.log(`[on-demand-mapper] ✅ Mapped: ${market.question.slice(0, 50)}...`);

    return {
      question: market.question,
      condition_id: market.conditionId,
      outcome_index: tokenIndex,
    };
  } catch (error: any) {
    console.error(`[on-demand-mapper] Error mapping token:`, error.message);
    return null;
  }
}

/**
 * Map multiple unmapped tokens in parallel
 *
 * @param tokenIds - Array of unmapped token IDs
 * @returns Map of token_id → mapping info
 */
export async function mapTokensBatch(
  tokenIds: string[]
): Promise<Map<string, { question: string; condition_id: string; outcome_index: number }>> {
  const results = new Map();

  // Process in parallel (but limit to 5 at a time to avoid rate limits)
  const batchSize = 5;
  for (let i = 0; i < tokenIds.length; i += batchSize) {
    const batch = tokenIds.slice(i, i + batchSize);
    const promises = batch.map(tokenId => mapTokenOnDemand(tokenId));
    const batchResults = await Promise.all(promises);

    batchResults.forEach((result, idx) => {
      if (result) {
        results.set(batch[idx], result);
      }
    });
  }

  return results;
}
