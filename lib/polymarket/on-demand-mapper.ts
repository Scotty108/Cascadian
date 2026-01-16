/**
 * On-Demand Token Mapper
 *
 * Fetches market metadata from Polymarket API for unmapped tokens
 * and inserts into both metadata and token map tables immediately.
 *
 * Used when UI detects unmapped tokens to eliminate lag.
 */

import { clickhouse } from '../clickhouse/client';

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
 * Fetch market metadata from Polymarket Gamma API by token ID
 */
async function fetchMarketByToken(tokenId: string): Promise<PolymarketMarket | null> {
  try {
    // Polymarket Gamma API endpoint
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets?token_id=${tokenId}`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error(`[on-demand-mapper] Polymarket API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Debug: Log response structure
    console.log(`[on-demand-mapper] API response type: ${typeof data}, is array: ${Array.isArray(data)}`);

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
  } catch (error: any) {
    console.error(`[on-demand-mapper] Fetch error:`, error.message);
    return null;
  }
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
