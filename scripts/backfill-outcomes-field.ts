/**
 * Backfill outcomes field in pm_market_metadata
 *
 * The outcomes field was not being populated because the Gamma API returns
 * it as a JSON string "[\"Yes\", \"No\"]" but we were treating it as an array.
 *
 * This script fetches outcomes from Gamma API and updates existing records.
 */

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

const GAMMA_API = 'https://gamma-api.polymarket.com/markets';
const BATCH_SIZE = 100;
const WORKERS = 4;

interface GammaMarket {
  conditionId: string;
  outcomes: string; // JSON string like "[\"Yes\", \"No\"]"
}

async function fetchMarketBatch(offset: number, limit: number): Promise<GammaMarket[]> {
  const url = `${GAMMA_API}?limit=${limit}&offset=${offset}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

function parseOutcomes(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// We'll batch the updates instead of individual ALTER statements
let pendingUpdates: { conditionId: string; outcomes: string[] }[] = [];

async function flushUpdates(): Promise<number> {
  if (pendingUpdates.length === 0) return 0;

  const updates = pendingUpdates;
  pendingUpdates = [];

  // Build INSERT statement with only outcomes and condition_id
  // This won't work with ReplacingMergeTree since we need all columns
  // Instead, let's use a direct SELECT + INSERT approach

  const conditionIds = updates.map(u => `'${u.conditionId.toLowerCase().replace(/^0x/, '')}'`).join(',');

  // Create a temporary table with the updates
  const values = updates.map(u => {
    const outcomes = `[${u.outcomes.map(o => `'${o.replace(/'/g, "\\'")}'`).join(',')}]`;
    const cid = u.conditionId.toLowerCase().replace(/^0x/, '');
    return `('${cid}', ${outcomes})`;
  }).join(',');

  // Use INSERT SELECT to copy existing data with new outcomes
  await client.command({
    query: `
      INSERT INTO pm_market_metadata
      SELECT
        m.condition_id,
        m.market_id,
        m.slug,
        m.question,
        m.outcome_label,
        m.description,
        m.image_url,
        m.tags,
        m.category,
        m.volume_usdc,
        m.is_active,
        m.is_closed,
        m.end_date,
        toUInt64(now64(3) * 1000) as ingested_at,  -- New timestamp for merge
        m.liquidity_usdc,
        u.outcomes,  -- Updated field!
        m.outcome_prices,
        m.token_ids,
        m.winning_outcome,
        m.resolution_source,
        m.enable_order_book,
        m.order_price_min_tick_size,
        m.notifications_enabled,
        m.event_id,
        m.group_slug,
        m.rewards_min_size,
        m.rewards_max_spread,
        m.spread,
        m.best_bid,
        m.best_ask,
        m.start_date,
        m.created_at,
        m.updated_at,
        m.market_type,
        m.format_type,
        m.lower_bound,
        m.upper_bound,
        m.volume_24hr,
        m.volume_1wk,
        m.volume_1mo,
        m.price_change_1d,
        m.price_change_1w,
        m.series_slug,
        m.series_data,
        m.comment_count,
        m.is_restricted,
        m.is_archived,
        m.wide_format
      FROM pm_market_metadata m
      JOIN (
        SELECT condition_id, outcomes
        FROM VALUES('condition_id String, outcomes Array(String)', ${values})
      ) u ON m.condition_id = u.condition_id
      WHERE m.condition_id IN (${conditionIds})
    `
  });

  return updates.length;
}

async function processWorker(workerId: number, offsets: number[]): Promise<number> {
  let updated = 0;

  for (const offset of offsets) {
    try {
      const markets = await fetchMarketBatch(offset, BATCH_SIZE);

      for (const market of markets) {
        if (!market.conditionId) continue;

        const outcomes = parseOutcomes(market.outcomes);
        if (outcomes.length === 0) continue;

        pendingUpdates.push({ conditionId: market.conditionId, outcomes });

        // Flush in batches of 50
        if (pendingUpdates.length >= 50) {
          updated += await flushUpdates();
        }
      }

      console.log(`[Worker ${workerId}] Processed offset ${offset}, ${markets.length} markets`);
    } catch (error) {
      console.error(`[Worker ${workerId}] Error at offset ${offset}:`, error);
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  // Flush remaining
  updated += await flushUpdates();

  return updated;
}

async function main() {
  console.log('\n🔄 BACKFILLING OUTCOMES FIELD');
  console.log('='.repeat(60));

  // First, check current state
  const checkResult = await client.query({
    query: `
      SELECT
        count(*) as total,
        countIf(length(outcomes) > 0) as has_outcomes
      FROM pm_market_metadata
    `,
    format: 'JSONEachRow'
  });
  const stats = await checkResult.json() as any[];
  console.log(`Current state: ${stats[0].has_outcomes}/${stats[0].total} markets have outcomes`);

  // Get total market count from API
  const firstBatch = await fetchMarketBatch(0, 1);
  console.log(`\nFetching markets from Gamma API...`);

  // Generate offsets for all markets (assume ~200k markets)
  const totalMarkets = 200000; // Approximate
  const allOffsets: number[] = [];
  for (let i = 0; i < totalMarkets; i += BATCH_SIZE) {
    allOffsets.push(i);
  }

  // Distribute offsets across workers
  const workerOffsets: number[][] = Array(WORKERS).fill(null).map(() => []);
  allOffsets.forEach((offset, i) => {
    workerOffsets[i % WORKERS].push(offset);
  });

  console.log(`Starting ${WORKERS} workers to process ${allOffsets.length} batches...`);

  // Run workers in parallel
  const startTime = Date.now();
  const results = await Promise.all(
    workerOffsets.map((offsets, i) => processWorker(i, offsets))
  );

  const totalUpdated = results.reduce((a, b) => a + b, 0);
  const duration = (Date.now() - startTime) / 1000;

  console.log('\n' + '='.repeat(60));
  console.log('✅ BACKFILL COMPLETE');
  console.log(`   Updated: ${totalUpdated} markets`);
  console.log(`   Duration: ${duration.toFixed(1)}s`);
  console.log('='.repeat(60));

  // Verify
  const verifyResult = await client.query({
    query: `
      SELECT
        count(*) as total,
        countIf(length(outcomes) > 0) as has_outcomes
      FROM pm_market_metadata
    `,
    format: 'JSONEachRow'
  });
  const verifyStats = await verifyResult.json() as any[];
  console.log(`\nVerification: ${verifyStats[0].has_outcomes}/${verifyStats[0].total} markets now have outcomes`);

  await client.close();
}

main().catch(console.error);
