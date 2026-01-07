/**
 * Score Superforecaster Pool (Overnight Runner)
 *
 * Scores all wallets in the pool using CCR-v1 + superforecaster formula.
 * Streams high-scorers to ClickHouse in real-time.
 *
 * Formula: Score = μ_cap × √M
 * Reference: 0xa40d scores 2.84, threshold 1.1 is selective for golden wallets
 *
 * Features:
 * - Resume capability (saves progress to disk after each batch)
 * - Real-time streaming to pm_golden_superforecasters_v1
 * - Per-wallet timeout (30s) - skips slow whales
 * - Pre-filters obvious MMs (>50k trades)
 * - Graceful shutdown on SIGINT/SIGTERM
 * - Tracks errors separately
 * - Progress tracking with ETA
 *
 * Usage:
 *   npx tsx scripts/leaderboard/score-superforecasters.ts [--workers N] [--min-score N]
 *
 * Overnight:
 *   ./scripts/leaderboard/run-overnight.sh
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import { createClient } from '@clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';
import { calculateScore } from '../../lib/leaderboard/superforecasterScore';

// CLI args
const args = process.argv.slice(2);
const getArg = (name: string, def: number) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? parseFloat(args[idx + 1]) : def;
};

const WORKERS = getArg('workers', 4);
const MIN_SCORE = getArg('min-score', 1.1);
const WALLET_TIMEOUT_MS = 60000;  // 60s per wallet max
const MAX_TRADES_FILTER = 50000;  // Skip obvious MMs
const SAVE_INTERVAL = 5;  // Save progress every N batches

const POOL_FILE = './scripts/leaderboard/superforecaster-pool.json';
const PROGRESS_FILE = '/tmp/superforecaster-scoring-progress.json';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

// Graceful shutdown
let shuttingDown = false;
process.on('SIGINT', () => {
  console.log('\n\nReceived SIGINT, finishing current batch...');
  shuttingDown = true;
});
process.on('SIGTERM', () => {
  console.log('\n\nReceived SIGTERM, finishing current batch...');
  shuttingDown = true;
});

interface Progress {
  completed: string[];
  failed: string[];
  goldenCount: number;
  goldenWallets: string[];
  timeoutCount: number;
  errorCount: number;
  startedAt: string;
  lastUpdated: string;
}

function loadProgress(): Progress {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      // Migrate old format
      return {
        completed: data.completed || [],
        failed: data.failed || [],
        goldenCount: data.goldenCount || 0,
        goldenWallets: data.goldenWallets || [],
        timeoutCount: data.timeoutCount || 0,
        errorCount: data.errorCount || 0,
        startedAt: data.startedAt || new Date().toISOString(),
        lastUpdated: data.lastUpdated || new Date().toISOString(),
      };
    }
  } catch (e) {
    console.error('Warning: Could not load progress file, starting fresh');
  }
  return {
    completed: [],
    failed: [],
    goldenCount: 0,
    goldenWallets: [],
    timeoutCount: 0,
    errorCount: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveProgress(progress: Progress) {
  try {
    progress.lastUpdated = new Date().toISOString();
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch (e) {
    console.error('Warning: Could not save progress file');
  }
}

async function insertGolden(wallet: string, score: any): Promise<boolean> {
  try {
    await ch.insert({
      table: 'pm_golden_superforecasters_v1',
      values: [{
        wallet,
        score: score.score,
        mu_raw: score.muRaw,
        mu_cap: score.muCap,
        M: score.M,
        num_positions: score.numPositions,
        num_wins: score.numWins,
        win_rate: score.winRate,
        realized_pnl: score.realizedPnl || 0,
      }],
      format: 'JSONEachRow',
    });
    return true;
  } catch (e: any) {
    console.error(`\nWarning: Failed to insert golden wallet ${wallet}: ${e.message}`);
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    ),
  ]);
}

interface ScoreResult {
  score: any | null;
  error?: string;
  isTimeout?: boolean;
}

async function scoreWallet(wallet: string): Promise<ScoreResult> {
  try {
    const metrics = await withTimeout(computeCCRv1(wallet), WALLET_TIMEOUT_MS);
    const score = calculateScore(metrics);
    return { score: { ...score, realizedPnl: metrics.realized_pnl } };
  } catch (e: any) {
    const isTimeout = e.message === 'Timeout' || e.message?.includes('Timeout');
    return { score: null, error: e.message, isTimeout };
  }
}

async function main() {
  console.log('Loading pool...');

  // Load pool
  if (!fs.existsSync(POOL_FILE)) {
    console.error(`ERROR: Pool file not found: ${POOL_FILE}`);
    console.error('Run the pool generation script first.');
    process.exit(1);
  }

  const pool = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));

  // Pre-filter: skip obvious MMs (>50k trades)
  let poolWallets = pool.wallets.filter((w: any) => w.trades <= MAX_TRADES_FILTER);
  console.log(`Pre-filtered: ${pool.wallets.length} -> ${poolWallets.length} (removed ${pool.wallets.length - poolWallets.length} MMs)`);

  const wallets: string[] = poolWallets.map((w: any) => w.wallet);

  // Load progress
  const progress = loadProgress();
  const completedSet = new Set([...progress.completed, ...progress.failed]);
  const remaining = wallets.filter(w => !completedSet.has(w));

  console.log('');
  console.log('═'.repeat(70));
  console.log('SUPERFORECASTER SCORING - OVERNIGHT RUN');
  console.log('═'.repeat(70));
  console.log(`Pool size:       ${wallets.length}`);
  console.log(`Already done:    ${progress.completed.length} (${progress.failed.length} failed)`);
  console.log(`Remaining:       ${remaining.length}`);
  console.log(`Golden so far:   ${progress.goldenCount}`);
  console.log(`Min score:       ${MIN_SCORE} (decimal scale)`);
  console.log(`Workers:         ${WORKERS}`);
  console.log(`Wallet timeout:  ${WALLET_TIMEOUT_MS / 1000}s`);
  console.log(`Progress file:   ${PROGRESS_FILE}`);
  console.log('═'.repeat(70));
  console.log('');

  if (remaining.length === 0) {
    console.log('All wallets already scored!');
    printSummary(progress);
    return;
  }

  const startTime = Date.now();
  let processed = 0;
  let goldenThisRun = 0;
  let timeoutsThisRun = 0;
  let errorsThisRun = 0;
  let batchCount = 0;

  // Process in batches
  for (let i = 0; i < remaining.length && !shuttingDown; i += WORKERS) {
    const batch = remaining.slice(i, i + WORKERS);
    batchCount++;

    const results = await Promise.all(batch.map(async (wallet) => {
      const result = await scoreWallet(wallet);
      return { wallet, result };
    }));

    for (const { wallet, result } of results) {
      processed++;

      if (result.error) {
        progress.failed.push(wallet);
        if (result.isTimeout) {
          progress.timeoutCount++;
          timeoutsThisRun++;
        } else {
          progress.errorCount++;
          errorsThisRun++;
        }
      } else {
        progress.completed.push(wallet);

        // Golden = eligible + score >= threshold + POSITIVE realized PnL
        const isGolden = result.score?.eligible
          && result.score.score >= MIN_SCORE
          && result.score.realizedPnl > 0;

        if (isGolden) {
          const inserted = await insertGolden(wallet, result.score);
          if (inserted) {
            progress.goldenCount++;
            progress.goldenWallets.push(wallet);
            goldenThisRun++;
            console.log(`\n🌟 GOLDEN #${progress.goldenCount}: ${wallet.slice(0, 14)}... | Score: ${result.score.score.toFixed(4)} | PnL: $${result.score.realizedPnl?.toLocaleString() || 'N/A'}`);
          }
        }
      }
    }

    // Progress update
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const eta = (remaining.length - processed) / rate;
    const etaStr = eta > 3600
      ? `${(eta / 3600).toFixed(1)}h`
      : eta > 60
        ? `${(eta / 60).toFixed(1)}m`
        : `${eta.toFixed(0)}s`;

    process.stdout.write(`\r[${processed}/${remaining.length}] ${(processed / remaining.length * 100).toFixed(1)}% | ${rate.toFixed(2)}/s | ETA: ${etaStr} | Golden: ${progress.goldenCount} | Timeouts: ${timeoutsThisRun} | Errors: ${errorsThisRun}    `);

    // Save progress periodically
    if (batchCount % SAVE_INTERVAL === 0) {
      saveProgress(progress);
    }
  }

  // Final save
  saveProgress(progress);

  console.log('\n');

  if (shuttingDown) {
    console.log('═'.repeat(70));
    console.log('INTERRUPTED - Progress saved, can resume');
    console.log('═'.repeat(70));
  } else {
    console.log('═'.repeat(70));
    console.log('COMPLETE');
    console.log('═'.repeat(70));
  }

  printSummary(progress);

  console.log('');
  console.log('This run:');
  console.log(`  Processed:     ${processed}`);
  console.log(`  Golden found:  ${goldenThisRun}`);
  console.log(`  Timeouts:      ${timeoutsThisRun}`);
  console.log(`  Errors:        ${errorsThisRun}`);
  console.log('');
  console.log('Query golden wallets:');
  console.log('  SELECT * FROM pm_golden_superforecasters_v1 ORDER BY score DESC');
}

function printSummary(progress: Progress) {
  console.log('');
  console.log('TOTAL SUMMARY:');
  console.log(`  Completed:     ${progress.completed.length}`);
  console.log(`  Failed:        ${progress.failed.length} (${progress.timeoutCount} timeouts, ${progress.errorCount} errors)`);
  console.log(`  Golden found:  ${progress.goldenCount}`);
  console.log(`  Started:       ${progress.startedAt}`);
  console.log(`  Last updated:  ${progress.lastUpdated}`);
}

main().catch((e) => {
  console.error('\nFATAL ERROR:', e);
  process.exit(1);
});
