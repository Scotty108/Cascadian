/**
 * Overnight Copy Trading Metrics Computation
 *
 * Processes the full wallet universe (~9,400 wallets) to compute
 * comprehensive metrics for the copy trading leaderboard.
 *
 * Results are stored in pm_copy_trading_metrics_v1 for instant queries.
 *
 * Usage:
 *   npx tsx scripts/leaderboard/compute-full-metrics-overnight.ts [--workers=4]
 *
 * Runtime estimate: 3-4 hours for 9,387 wallets with 4 workers
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { clickhouse } from '../../lib/clickhouse/client';
import { computeCCRv1, CCRMetrics } from '../../lib/pnl/ccrEngineV1';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const WORKERS = 1; // Sequential processing (parallel causes ClickHouse issues)
const BATCH_SIZE = 25; // Wallets per batch insert
const CONCURRENT = 1; // Sequential within batch (parallel causes hangs)
const LOG_FILE = '/tmp/overnight-metrics.log';
const MIN_TRADES = 10; // Minimum trades for copyability assessment
const MIN_RESOLVED = 10; // Minimum resolved positions for statistical significance

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface CandidatePool {
  generated: string;
  count: number;
  filters: Record<string, unknown>;
  wallets: Array<{
    wallet: string;
    markets: number;
    trades: number;
    volume: number;
    active_days: number;
    trades_per_day: number;
    avg_trade_size: number;
  }>;
}

interface ProcessResult {
  wallet: string;
  success: boolean;
  metrics?: CCRMetrics;
  error?: string;
}

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------

function log(message: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function logProgress(processed: number, total: number, startTime: number) {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = processed / elapsed;
  const remaining = total - processed;
  const eta = remaining / rate;

  log(`Progress: ${processed}/${total} (${((processed/total)*100).toFixed(1)}%) | Rate: ${rate.toFixed(2)}/sec | ETA: ${formatDuration(eta)}`);
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// -----------------------------------------------------------------------------
// Phantom Wallet Detection
// -----------------------------------------------------------------------------

// SKIPPED: Pre-detection query was too slow (scanning all trades)
// Instead, we use external_sell_ratio from CCR-v1 which is already computed per-wallet
// This is more efficient and equally accurate

// -----------------------------------------------------------------------------
// Batch Processing
// -----------------------------------------------------------------------------

async function processWallet(wallet: string): Promise<ProcessResult> {
  try {
    const metrics = await computeCCRv1(wallet);

    // Determine phantom status from CCR-v1's external_sell metrics
    // Phantom = sold tokens they never bought (external sources like ERC1155 transfers)
    const phantomTokens = metrics.external_sell_tokens;
    const isPhantom = phantomTokens > 10 || metrics.external_sell_ratio > 0.05;

    // Determine copyability
    // Copyable if: edge_ratio > 1.0, not phantom, sufficient resolved positions
    const isCopyable =
      metrics.edge_ratio > 1.0 &&
      !isPhantom &&
      metrics.resolved_count >= MIN_RESOLVED &&
      metrics.win_rate >= 0.4; // At least 40% win rate

    // Add phantom and copyability flags to metrics
    (metrics as any).is_phantom = isPhantom ? 1 : 0;
    (metrics as any).phantom_tokens = phantomTokens;
    (metrics as any).is_copyable = isCopyable ? 1 : 0;

    return { wallet, success: true, metrics };
  } catch (error) {
    return { wallet, success: false, error: String(error) };
  }
}

async function processWorker(
  wallets: string[],
  workerId: number
): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];

  for (const wallet of wallets) {
    const result = await processWallet(wallet);
    results.push(result);

    if (!result.success) {
      log(`[Worker ${workerId}] Error processing ${wallet}: ${result.error}`);
    }
  }

  return results;
}

// -----------------------------------------------------------------------------
// ClickHouse Insert
// -----------------------------------------------------------------------------

async function insertBatch(results: ProcessResult[]): Promise<number> {
  const successful = results.filter(r => r.success && r.metrics);
  if (successful.length === 0) return 0;

  try {
    // Build INSERT statement
    const rows = successful.map(r => {
    const m = r.metrics!;
    const isPhantom = (m as any).is_phantom || 0;
    const phantomTokens = (m as any).phantom_tokens || 0;
    const isCopyable = (m as any).is_copyable || 0;

    return {
      wallet_address: m.wallet.toLowerCase(),
      realized_pnl: m.realized_pnl,
      total_pnl: m.total_pnl,
      volume_usd: m.volume_traded,
      total_trades: m.total_trades,
      positions_count: m.positions_count,
      resolved_positions: m.resolved_count,
      unresolved_positions: m.unresolved_count,
      win_count: m.win_count,
      loss_count: m.loss_count,
      win_rate: m.win_rate,
      avg_win_pct: m.avg_win_pct,
      avg_loss_pct: m.avg_loss_pct,
      breakeven_wr: m.breakeven_wr,
      edge_ratio: m.edge_ratio,
      is_phantom: isPhantom,
      phantom_tokens: phantomTokens,
      is_copyable: isCopyable,
      pnl_confidence: m.pnl_confidence,
      external_sell_ratio: m.external_sell_ratio,
      first_trade: '1970-01-01 00:00:00', // Placeholder - would need separate query
      last_trade: '1970-01-01 00:00:00',  // Placeholder - would need separate query
      days_active: 0, // Placeholder
    };
  });

    await clickhouse.insert({
      table: 'pm_copy_trading_metrics_v1',
      values: rows,
      format: 'JSONEachRow',
    });

    return successful.length;
  } catch (error) {
    log(`INSERT ERROR: ${error}`);
    return 0;
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  log('='.repeat(80));
  log('OVERNIGHT COPY TRADING METRICS COMPUTATION');
  log(`Workers: ${WORKERS}, Batch size: ${BATCH_SIZE}`);
  log('='.repeat(80));

  // Step 1: Load candidate pool
  const poolPath = path.join(__dirname, 'final-candidates.json');
  if (!fs.existsSync(poolPath)) {
    throw new Error(`Candidate pool not found: ${poolPath}`);
  }

  const pool: CandidatePool = JSON.parse(fs.readFileSync(poolPath, 'utf-8'));
  const wallets = pool.wallets.map(w => w.wallet.toLowerCase());
  log(`Loaded ${wallets.length} candidate wallets from pool (generated: ${pool.generated})`);

  // Note: Phantom detection is done per-wallet by CCR-v1 (external_sell_ratio)
  // This avoids the expensive pre-scan of all trades

  // Step 2: Split wallets across workers
  const walletsPerWorker = Math.ceil(wallets.length / WORKERS);
  const workerChunks: string[][] = [];
  for (let i = 0; i < WORKERS; i++) {
    const start = i * walletsPerWorker;
    const end = Math.min(start + walletsPerWorker, wallets.length);
    workerChunks.push(wallets.slice(start, end));
  }

  log(`Split ${wallets.length} wallets across ${WORKERS} workers`);

  // Step 4: Process in batches
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalErrors = 0;

  // Process sequentially to avoid overwhelming the database
  // Each "worker" processes its chunk, then we insert in batches
  for (let workerId = 0; workerId < WORKERS; workerId++) {
    const chunk = workerChunks[workerId];
    log(`Worker ${workerId + 1}/${WORKERS}: Processing ${chunk.length} wallets`);

    // Process chunk in sub-batches
    for (let i = 0; i < chunk.length; i += BATCH_SIZE) {
      const batch = chunk.slice(i, i + BATCH_SIZE);

      // Process batch with limited concurrency to avoid overwhelming ClickHouse
      const results: ProcessResult[] = [];
      for (let j = 0; j < batch.length; j += CONCURRENT) {
        const subBatch = batch.slice(j, j + CONCURRENT);
        const subResults = await Promise.all(
          subBatch.map(wallet => processWallet(wallet))
        );
        results.push(...subResults);
      }

      // Insert successful results
      const inserted = await insertBatch(results);
      totalInserted += inserted;

      // Count errors
      const errors = results.filter(r => !r.success).length;
      totalErrors += errors;

      totalProcessed += batch.length;

      // Log progress every 100 wallets
      if (totalProcessed % 100 === 0 || totalProcessed === wallets.length) {
        logProgress(totalProcessed, wallets.length, startTime);
      }
    }
  }

  // Step 5: Summary
  const elapsed = (Date.now() - startTime) / 1000;
  log('='.repeat(80));
  log('COMPLETE');
  log(`Total processed: ${totalProcessed}`);
  log(`Total inserted: ${totalInserted}`);
  log(`Total errors: ${totalErrors}`);
  log(`Elapsed time: ${formatDuration(elapsed)}`);
  log(`Average rate: ${(totalProcessed / elapsed).toFixed(2)} wallets/sec`);
  log('='.repeat(80));

  // Step 6: Quick stats query
  log('Running quick stats on results...');
  const statsQuery = `
    SELECT
      count() as total_wallets,
      countIf(is_phantom = 1) as phantom_wallets,
      countIf(is_phantom = 0) as clean_wallets,
      countIf(is_copyable = 1) as copyable_wallets,
      avg(edge_ratio) as avg_edge_ratio,
      max(edge_ratio) as max_edge_ratio,
      avg(win_rate) as avg_win_rate
    FROM pm_copy_trading_metrics_v1 FINAL
    WHERE resolved_positions >= ${MIN_RESOLVED}
  `;

  const statsResult = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
  const stats = (await statsResult.json()) as any[];
  if (stats.length > 0) {
    const s = stats[0];
    log(`Stats: ${s.total_wallets} wallets | ${s.phantom_wallets} phantom | ${s.copyable_wallets} copyable`);
    log(`Avg edge ratio: ${Number(s.avg_edge_ratio).toFixed(3)} | Max: ${Number(s.max_edge_ratio).toFixed(3)}`);
    log(`Avg win rate: ${(Number(s.avg_win_rate) * 100).toFixed(1)}%`);
  }

  // Step 7: Top 10 copyable wallets
  log('\nTop 10 Copyable Wallets by Edge Ratio:');
  const topQuery = `
    SELECT
      wallet_address,
      realized_pnl,
      win_rate,
      avg_win_pct,
      avg_loss_pct,
      edge_ratio,
      resolved_positions
    FROM pm_copy_trading_metrics_v1 FINAL
    WHERE is_copyable = 1 AND resolved_positions >= ${MIN_RESOLVED}
    ORDER BY edge_ratio DESC
    LIMIT 10
  `;

  const topResult = await clickhouse.query({ query: topQuery, format: 'JSONEachRow' });
  const top = (await topResult.json()) as any[];
  for (const w of top) {
    log(`  ${w.wallet_address.slice(0, 10)}... | PnL: $${Number(w.realized_pnl).toLocaleString()} | WR: ${(Number(w.win_rate)*100).toFixed(1)}% | Edge: ${Number(w.edge_ratio).toFixed(3)}`);
  }
}

main()
  .then(() => {
    log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    log(`FATAL ERROR: ${error}`);
    console.error(error);
    process.exit(1);
  });
