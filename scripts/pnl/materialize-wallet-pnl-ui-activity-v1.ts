/**
 * Materialize pm_wallet_pnl_ui_activity_v1 using V3 Activity PnL Engine
 *
 * Computes cost-basis realized PnL for wallets and inserts into ClickHouse.
 *
 * Environment Variables:
 *   WALLETS     - Comma-separated list of wallets to process (optional)
 *   LIMIT_WALLETS - Maximum number of wallets to process from discovery (default: all)
 *   BATCH_SIZE  - Number of wallets per batch (default: 50)
 *   WORKERS     - Number of parallel workers (default: 4)
 *
 * Usage:
 *   # Process specific wallets
 *   WALLETS="0x123,0x456" npx tsx scripts/pnl/materialize-wallet-pnl-ui-activity-v1.ts
 *
 *   # Process first 100 discovered wallets
 *   LIMIT_WALLETS=100 npx tsx scripts/pnl/materialize-wallet-pnl-ui-activity-v1.ts
 *
 *   # Process all wallets with 8 workers
 *   WORKERS=8 npx tsx scripts/pnl/materialize-wallet-pnl-ui-activity-v1.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { computeWalletActivityPnlV3, type WalletActivityMetrics } from '../../lib/pnl';

// Configuration from environment
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const WORKERS = parseInt(process.env.WORKERS || '4', 10);
const LIMIT_WALLETS = process.env.LIMIT_WALLETS
  ? parseInt(process.env.LIMIT_WALLETS, 10)
  : undefined;
const WALLETS_FROM_ENV = process.env.WALLETS
  ? process.env.WALLETS.split(',').map((w) => w.trim().toLowerCase())
  : undefined;

// Progress tracking
let processedCount = 0;
let errorCount = 0;
let lastProgressTime = Date.now();
let startTime = Date.now();

/**
 * Discover all wallets that have trading activity.
 */
async function discoverWallets(): Promise<string[]> {
  console.log('Discovering wallets with trading activity...');

  const limitClause = LIMIT_WALLETS ? `LIMIT ${LIMIT_WALLETS}` : '';

  const query = `
    SELECT DISTINCT lower(trader_wallet) as wallet
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    ORDER BY wallet
    ${limitClause}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const wallets = rows.map((r) => r.wallet);

  console.log(`  Found ${wallets.length} wallets`);
  return wallets;
}

/**
 * Insert a batch of metrics into ClickHouse.
 */
async function insertBatch(metrics: WalletActivityMetrics[]): Promise<void> {
  if (metrics.length === 0) return;

  const values = metrics
    .map(
      (m) =>
        `('${m.wallet}', ${m.pnl_activity_total}, ${m.gain_activity}, ${m.loss_activity}, ${m.volume_traded}, ${m.fills_count}, ${m.redemptions_count}, now())`
    )
    .join(',');

  const query = `
    INSERT INTO pm_wallet_pnl_ui_activity_v1
    (wallet, pnl_activity_total, gain_activity, loss_activity, volume_traded, fills_count, redemptions_count, updated_at)
    VALUES ${values}
  `;

  await clickhouse.command({ query });
}

/**
 * Process a single wallet with error handling.
 */
async function processWallet(wallet: string): Promise<WalletActivityMetrics | null> {
  try {
    return await computeWalletActivityPnlV3(wallet);
  } catch (error) {
    errorCount++;
    console.error(`  Error processing ${wallet}:`, error);
    return null;
  }
}

/**
 * Process a batch of wallets in parallel.
 */
async function processBatch(wallets: string[]): Promise<void> {
  // Split into worker chunks
  const chunkSize = Math.ceil(wallets.length / WORKERS);
  const chunks: string[][] = [];

  for (let i = 0; i < wallets.length; i += chunkSize) {
    chunks.push(wallets.slice(i, i + chunkSize));
  }

  const allMetrics: WalletActivityMetrics[] = [];

  // Process chunks in parallel
  await Promise.all(
    chunks.map(async (chunk) => {
      for (const wallet of chunk) {
        const metrics = await processWallet(wallet);
        if (metrics) {
          allMetrics.push(metrics);
          processedCount++;
        }

        // Progress update every 5 seconds
        const now = Date.now();
        if (now - lastProgressTime > 5000) {
          const elapsed = (now - startTime) / 1000;
          const rate = processedCount / elapsed;
          console.log(
            `  Progress: ${processedCount} wallets processed, ${errorCount} errors, ${rate.toFixed(1)} wallets/sec`
          );
          lastProgressTime = now;
        }
      }
    })
  );

  // Insert all metrics from this batch
  if (allMetrics.length > 0) {
    await insertBatch(allMetrics);
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log('='.repeat(70));
  console.log('Materializing pm_wallet_pnl_ui_activity_v1');
  console.log('='.repeat(70));
  console.log('');
  console.log('Configuration:');
  console.log(`  BATCH_SIZE: ${BATCH_SIZE}`);
  console.log(`  WORKERS: ${WORKERS}`);
  console.log(`  LIMIT_WALLETS: ${LIMIT_WALLETS || 'all'}`);
  console.log(`  WALLETS: ${WALLETS_FROM_ENV ? WALLETS_FROM_ENV.length + ' specified' : 'discover'}`);
  console.log('');

  // Get wallets to process
  const wallets = WALLETS_FROM_ENV || (await discoverWallets());

  if (wallets.length === 0) {
    console.log('No wallets to process.');
    return;
  }

  console.log(`Processing ${wallets.length} wallets in batches of ${BATCH_SIZE}...`);
  console.log('');

  startTime = Date.now();

  // Process in batches
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches}: Processing ${batch.length} wallets...`);
    await processBatch(batch);
  }

  // Final summary
  const elapsed = (Date.now() - startTime) / 1000;
  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total wallets: ${wallets.length}`);
  console.log(`  Processed: ${processedCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Elapsed: ${elapsed.toFixed(1)}s`);
  console.log(`  Rate: ${(processedCount / elapsed).toFixed(1)} wallets/sec`);
  console.log('');

  // Verify data in table
  const countResult = await clickhouse.query({
    query: 'SELECT count() as cnt FROM vw_wallet_pnl_ui_activity_v1',
    format: 'JSONEachRow',
  });
  const countData = (await countResult.json())[0] as any;
  console.log(`  Rows in vw_wallet_pnl_ui_activity_v1: ${countData.cnt}`);

  console.log('');
  console.log('Done!');
}

main().catch(console.error);
