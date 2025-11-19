#!/usr/bin/env npx tsx
/**
 * BUILD LEGACY TOKEN→CONDITION ID MAPPING (PARALLEL VERSION)
 *
 * Optimizations:
 * - 8 parallel workers (8x throughput)
 * - 50ms delay (2x faster per worker)
 * - Skips IDs already in mapping table
 * - Worker-specific progress tracking
 *
 * Estimated time: 10-15 minutes (vs 86 minutes single-threaded)
 *
 * Usage:
 *   npx tsx build-legacy-token-mapping-parallel.ts --worker=1 --of=8
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';
const BATCH_SIZE = 100;
const REQUEST_DELAY_MS = 100; // 10 requests/second per worker (safer)
const MAX_RETRIES = 3;

// Parse worker arguments
const args = process.argv.slice(2);
const workerArg = args.find(a => a.startsWith('--worker='));
const ofArg = args.find(a => a.startsWith('--of='));

const WORKER_ID = workerArg ? parseInt(workerArg.split('=')[1]) : 1;
const TOTAL_WORKERS = ofArg ? parseInt(ofArg.split('=')[1]) : 1;

interface TokenMapping {
  token_id: string;
  condition_id: string;
  market_slug?: string;
  question?: string;
  source: string;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMarketByConditionId(conditionId: string, retryCount = 0): Promise<TokenMapping | null> {
  try {
    const url = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) return null;

      // Retry on 429 (rate limit) with exponential backoff
      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const backoffMs = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        await sleep(backoffMs);
        return fetchMarketByConditionId(conditionId, retryCount + 1);
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      const market = data[0];
      return {
        token_id: conditionId,
        condition_id: market.condition_id || conditionId,
        market_slug: market.market_slug,
        question: market.question,
        source: 'gamma_api',
      };
    }

    return null;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const backoffMs = Math.pow(2, retryCount) * 1000;
      await sleep(backoffMs);
      return fetchMarketByConditionId(conditionId, retryCount + 1);
    }
    // Silent fail after retries - will be counted as "not found"
    return null;
  }
}

async function main() {
  console.log(`\n[Worker ${WORKER_ID}/${TOTAL_WORKERS}] Starting parallel mapping builder...`);

  // Step 1: Extract all unique condition IDs
  const allIdsResult = await ch.query({
    query: `
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as condition_id
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${WALLET}')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ORDER BY condition_id
    `,
    format: 'JSONEachRow',
  });
  const allIds = await allIdsResult.json<{ condition_id: string }[]>();

  // Step 2: Filter out already-mapped IDs
  const existingMappings = await ch.query({
    query: `
      SELECT DISTINCT lower(token_id) as token_id
      FROM default.legacy_token_condition_map
    `,
    format: 'JSONEachRow',
  });
  const existing = await existingMappings.json<{ token_id: string }[]>();
  const existingSet = new Set(existing.map(e => e.token_id));

  const unmappedIds = allIds.filter(id => !existingSet.has(id.condition_id));

  console.log(`[Worker ${WORKER_ID}] Total IDs: ${allIds.length.toLocaleString()}`);
  console.log(`[Worker ${WORKER_ID}] Already mapped: ${existing.length.toLocaleString()}`);
  console.log(`[Worker ${WORKER_ID}] Remaining: ${unmappedIds.length.toLocaleString()}`);

  // Step 3: Shard IDs for this worker
  const myIds = unmappedIds.filter((_, idx) => idx % TOTAL_WORKERS === (WORKER_ID - 1));

  console.log(`[Worker ${WORKER_ID}] My share: ${myIds.length.toLocaleString()} IDs\n`);

  if (myIds.length === 0) {
    console.log(`[Worker ${WORKER_ID}] Nothing to do, exiting.\n`);
    await ch.close();
    return;
  }

  // Step 4: Fetch mappings from API
  const mappings: TokenMapping[] = [];
  let successCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  for (let i = 0; i < myIds.length; i++) {
    const id = myIds[i].condition_id;

    // Progress indicator every 50 IDs
    if (i > 0 && i % 50 === 0) {
      console.log(
        `[Worker ${WORKER_ID}] Progress: ${i}/${myIds.length} (${((i/myIds.length)*100).toFixed(1)}%) | ` +
        `Success: ${successCount} | Not Found: ${notFoundCount} | Errors: ${errorCount}`
      );
    }

    const mapping = await fetchMarketByConditionId(id);

    if (mapping) {
      mappings.push(mapping);
      successCount++;
    } else {
      notFoundCount++;
    }

    // Rate limit delay every 10 requests
    if (i % 10 === 0) {
      await sleep(REQUEST_DELAY_MS);
    }

    // Batch insert every BATCH_SIZE records
    if (mappings.length >= BATCH_SIZE) {
      try {
        await ch.insert({
          table: 'default.legacy_token_condition_map',
          values: mappings,
          format: 'JSONEachRow',
        });
        mappings.length = 0; // Clear array
      } catch (err) {
        console.error(`[Worker ${WORKER_ID}] Insert error:`, err);
        errorCount++;
      }
    }
  }

  // Insert remaining mappings
  if (mappings.length > 0) {
    try {
      await ch.insert({
        table: 'default.legacy_token_condition_map',
        values: mappings,
        format: 'JSONEachRow',
      });
    } catch (err) {
      console.error(`[Worker ${WORKER_ID}] Final insert error:`, err);
      errorCount++;
    }
  }

  console.log(`\n[Worker ${WORKER_ID}] COMPLETE`);
  console.log(`  Success: ${successCount.toLocaleString()}`);
  console.log(`  Not Found: ${notFoundCount.toLocaleString()}`);
  console.log(`  Errors: ${errorCount.toLocaleString()}`);
  console.log(`  Total processed: ${myIds.length.toLocaleString()}\n`);

  await ch.close();
}

main().catch(err => {
  console.error(`\n[Worker ${WORKER_ID}] ERROR:`, err);
  process.exit(1);
});
