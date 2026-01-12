#!/usr/bin/env npx tsx
/**
 * Run PnL Engine V1 on validation cohort
 *
 * This script:
 * 1. Reads all wallets from pm_validation_wallets_v1
 * 2. Runs pnlEngineV1 on each wallet with parallelism of 10
 * 3. Has a 2 second timeout per wallet
 * 4. Inserts results to pm_pnl_engine_results_v1
 * 5. Reports progress every 50 wallets
 * 6. Has a hard 200 second runtime budget
 *
 * Usage: npx tsx scripts/validation/run-engine-cohort.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';
import { getWalletPnLV1 } from '../../lib/pnl/pnlEngineV1';

const PARALLELISM = 10;
const TIMEOUT_MS = 10000; // 10 seconds - V1 needs time for ClickHouse queries
const PROGRESS_INTERVAL = 20;
const HARD_RUNTIME_BUDGET_MS = 600_000; // 10 minutes budget
const ENGINE_NAME = 'V1';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

interface EngineResult {
  wallet: string;
  engine: string;
  pnl_total: number;
  pnl_realized: number;
  pnl_unrealized: number;
  runtime_ms: number;
  status: 'ok' | 'timeout' | 'error';
}

async function ensureTablesExist(): Promise<void> {
  // Create validation wallets table if not exists
  // Schema: wallet, cohort_tag, trade_count, added_at
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_validation_wallets_v1 (
        wallet String,
        cohort_tag String,
        trade_count UInt32,
        added_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree()
      ORDER BY wallet
    `,
  });

  // Create results table if not exists
  // Schema: engine, wallet, pnl_total, pnl_realized, pnl_unrealized, runtime_ms, status, computed_at
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_pnl_engine_results_v1 (
        engine String,
        wallet String,
        pnl_total Float64,
        pnl_realized Float64,
        pnl_unrealized Float64,
        runtime_ms UInt32,
        status String DEFAULT 'ok',
        computed_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree()
      ORDER BY (engine, wallet, computed_at)
    `,
  });
}

async function getValidationWallets(): Promise<string[]> {
  const result = await client.query({
    query: `SELECT DISTINCT wallet FROM pm_validation_wallets_v1`,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as { wallet: string }[];
  return rows.map((r) => r.wallet.toLowerCase());
}

async function runWithTimeout(
  wallet: string,
  timeoutMs: number
): Promise<EngineResult> {
  const start = Date.now();

  return Promise.race<EngineResult>([
    getWalletPnLV1(wallet)
      .then((result) => ({
        wallet,
        engine: ENGINE_NAME,
        pnl_total: result.total,
        pnl_realized: result.realized.pnl,
        pnl_unrealized: result.unrealized.pnl + result.syntheticRealized.pnl,
        runtime_ms: Date.now() - start,
        status: 'ok' as const,
      }))
      .catch(() => ({
        wallet,
        engine: ENGINE_NAME,
        pnl_total: 0,
        pnl_realized: 0,
        pnl_unrealized: 0,
        runtime_ms: Date.now() - start,
        status: 'error' as const,
      })),
    new Promise<EngineResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            wallet,
            engine: ENGINE_NAME,
            pnl_total: 0,
            pnl_realized: 0,
            pnl_unrealized: 0,
            runtime_ms: timeoutMs,
            status: 'timeout',
          }),
        timeoutMs
      )
    ),
  ]);
}

async function insertResults(results: EngineResult[]): Promise<void> {
  if (results.length === 0) return;

  // Table columns: engine, wallet, pnl_total, pnl_realized, pnl_unrealized, runtime_ms, status, computed_at
  const values = results
    .map(
      (r) =>
        `('${r.engine}', '${r.wallet}', ${r.pnl_total}, ${r.pnl_realized}, ${r.pnl_unrealized}, ${r.runtime_ms}, '${r.status}', now())`
    )
    .join(',');

  await client.command({
    query: `
      INSERT INTO pm_pnl_engine_results_v1
      (engine, wallet, pnl_total, pnl_realized, pnl_unrealized, runtime_ms, status, computed_at)
      VALUES ${values}
    `,
  });
}

async function runBatch(
  wallets: string[],
  startIdx: number,
  globalStart: number
): Promise<EngineResult[]> {
  const results = await Promise.all(
    wallets.map((wallet) => runWithTimeout(wallet, TIMEOUT_MS))
  );
  return results;
}

async function main(): Promise<void> {
  const globalStart = Date.now();

  console.log('='.repeat(70));
  console.log('PnL Engine V1 Cohort Validation');
  console.log('='.repeat(70));
  console.log(`Engine: ${ENGINE_NAME}`);
  console.log(`Parallelism: ${PARALLELISM}`);
  console.log(`Timeout per wallet: ${TIMEOUT_MS}ms`);
  console.log(`Hard runtime budget: ${HARD_RUNTIME_BUDGET_MS}ms`);
  console.log();

  // Ensure tables exist
  console.log('Ensuring tables exist...');
  await ensureTablesExist();

  // Get validation wallets
  console.log('Fetching validation wallets...');
  const wallets = await getValidationWallets();
  console.log(`Found ${wallets.length} validation wallets\n`);

  if (wallets.length === 0) {
    console.log('No wallets found in pm_validation_wallets_v1');
    console.log('Add wallets with: INSERT INTO pm_validation_wallets_v1 (wallet) VALUES (\'0x...\')');
    await client.close();
    return;
  }

  // Process wallets in batches
  let processed = 0;
  let okCount = 0;
  let timeoutCount = 0;
  let errorCount = 0;
  const allResults: EngineResult[] = [];

  for (let i = 0; i < wallets.length; i += PARALLELISM) {
    // Check runtime budget
    const elapsed = Date.now() - globalStart;
    if (elapsed >= HARD_RUNTIME_BUDGET_MS) {
      console.log(`\n[ABORT] Hard runtime budget of ${HARD_RUNTIME_BUDGET_MS}ms exceeded (${elapsed}ms)`);
      break;
    }

    const batch = wallets.slice(i, i + PARALLELISM);
    const results = await runBatch(batch, i, globalStart);

    // Insert results
    await insertResults(results);
    allResults.push(...results);

    // Update counts
    processed += batch.length;
    okCount += results.filter((r) => r.status === 'ok').length;
    timeoutCount += results.filter((r) => r.status === 'timeout').length;
    errorCount += results.filter((r) => r.status === 'error').length;

    // Progress report
    if (processed % PROGRESS_INTERVAL === 0 || processed === wallets.length) {
      const elapsedSec = ((Date.now() - globalStart) / 1000).toFixed(1);
      const rate = (processed / (Date.now() - globalStart) * 1000).toFixed(1);
      console.log(
        `[Progress] ${processed}/${wallets.length} wallets | ` +
        `OK: ${okCount} | Timeout: ${timeoutCount} | Error: ${errorCount} | ` +
        `Elapsed: ${elapsedSec}s | Rate: ${rate}/s`
      );
    }
  }

  // Final summary
  const totalElapsed = Date.now() - globalStart;
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total wallets processed: ${processed}/${wallets.length}`);
  console.log(`Status breakdown:`);
  console.log(`  - OK: ${okCount} (${((okCount / processed) * 100).toFixed(1)}%)`);
  console.log(`  - Timeout: ${timeoutCount} (${((timeoutCount / processed) * 100).toFixed(1)}%)`);
  console.log(`  - Error: ${errorCount} (${((errorCount / processed) * 100).toFixed(1)}%)`);
  console.log(`Total runtime: ${(totalElapsed / 1000).toFixed(1)}s`);
  console.log(`Average per wallet: ${(totalElapsed / processed).toFixed(0)}ms`);

  // Show some sample results
  if (allResults.length > 0) {
    console.log('\nSample results (first 5):');
    allResults.slice(0, 5).forEach((r) => {
      console.log(
        `  ${r.wallet.slice(0, 10)}... | $${r.pnl_total.toFixed(2)} | ${r.status} | ${r.runtime_ms}ms`
      );
    });
  }

  await client.close();
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
