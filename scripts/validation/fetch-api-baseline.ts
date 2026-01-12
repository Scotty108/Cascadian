/**
 * Fetch API Baseline - Populates pm_pnl_baseline_api_v1 with PnL data from Polymarket API
 *
 * This script:
 * 1. Reads all wallets from pm_validation_wallets_v1
 * 2. Fetches PnL from Polymarket API for each wallet
 * 3. Uses parallelism of 10 concurrent requests with 5s timeout
 * 4. Upserts results to pm_pnl_baseline_api_v1
 * 5. Reports progress every 50 wallets
 *
 * Usage: npx tsx scripts/validation/fetch-api-baseline.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const CONCURRENCY = 10;
const TIMEOUT_MS = 5000;
const PROGRESS_INTERVAL = 50;

interface FetchResult {
  wallet: string;
  pnl: number | null;
  success: boolean;
  error?: string;
}

/**
 * Fetch PnL from Polymarket API with timeout
 */
async function fetchPnL(wallet: string): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`,
      { signal: controller.signal }
    );

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[data.length - 1].p : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Process a batch of wallets with limited concurrency
 */
async function processBatch(wallets: string[]): Promise<FetchResult[]> {
  const results: FetchResult[] = [];

  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const batch = wallets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (wallet) => {
        const pnl = await fetchPnL(wallet);
        return {
          wallet,
          pnl,
          success: pnl !== null,
        };
      })
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Ensure target table exists
 */
async function ensureTableExists(): Promise<void> {
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_pnl_baseline_api_v1 (
        wallet String,
        pnl Float64,
        fetched_at DateTime DEFAULT now(),
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY wallet
    `,
  });
}

/**
 * Upsert results to ClickHouse
 */
async function upsertResults(results: FetchResult[]): Promise<void> {
  const successfulResults = results.filter((r) => r.success && r.pnl !== null);

  if (successfulResults.length === 0) {
    return;
  }

  await clickhouse.insert({
    table: 'pm_pnl_baseline_api_v1',
    values: successfulResults.map((r) => ({
      wallet: r.wallet.toLowerCase(),
      pnl: r.pnl,
      fetched_at: new Date(),
      updated_at: new Date(),
    })),
    format: 'JSONEachRow',
  });
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Fetch API Baseline - Polymarket PnL');
  console.log('='.repeat(60));
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms`);
  console.log(`Progress interval: every ${PROGRESS_INTERVAL} wallets`);
  console.log('');

  // Ensure target table exists
  console.log('Ensuring target table exists...');
  await ensureTableExists();

  // Fetch wallets from validation table
  console.log('Fetching wallets from pm_validation_wallets_v1...');
  const result = await clickhouse.query({
    query: 'SELECT wallet FROM pm_validation_wallets_v1',
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ wallet: string }>();
  const wallets = (rows as { wallet: string }[]).map((r) => r.wallet);

  if (wallets.length === 0) {
    console.log('No wallets found in pm_validation_wallets_v1');
    return;
  }

  console.log(`Found ${wallets.length} wallets to process`);
  console.log('');

  // Process wallets in batches
  const startTime = Date.now();
  let processed = 0;
  let successful = 0;
  let failed = 0;

  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const batch = wallets.slice(i, i + CONCURRENCY);
    const results = await processBatch(batch);

    // Upsert successful results
    await upsertResults(results);

    // Update stats
    for (const r of results) {
      processed++;
      if (r.success) {
        successful++;
      } else {
        failed++;
      }
    }

    // Report progress every PROGRESS_INTERVAL wallets
    if (processed % PROGRESS_INTERVAL === 0 || processed === wallets.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (processed / parseFloat(elapsed)).toFixed(1);
      console.log(
        `Progress: ${processed}/${wallets.length} wallets | ` +
          `Success: ${successful} | Failed: ${failed} | ` +
          `Rate: ${rate}/s | Elapsed: ${elapsed}s`
      );
    }
  }

  // Final summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total wallets: ${wallets.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success rate: ${((successful / wallets.length) * 100).toFixed(1)}%`);
  console.log(`Total time: ${totalTime}s`);
  console.log(`Average rate: ${(wallets.length / parseFloat(totalTime)).toFixed(1)} wallets/s`);
  console.log('='.repeat(60));
}

main()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
