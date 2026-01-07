/**
 * Full Database Wallet Scoring with Parallelization
 *
 * Scores ALL eligible wallets from the database using CCR-v1 + Score = μ × M
 * Uses worker pool for parallelization (8 concurrent workers)
 *
 * Features:
 * - Parallel processing (8 workers)
 * - Resume capability (caches results to disk)
 * - Progress tracking with ETA
 * - Filters for recency, resolved count
 *
 * Usage:
 *   npx tsx scripts/leaderboard/score-all-wallets.ts [--limit N] [--workers N] [--min-resolved N] [--active-days N]
 *
 * Examples:
 *   npx tsx scripts/leaderboard/score-all-wallets.ts --limit 1000            # Score top 1000 wallets
 *   npx tsx scripts/leaderboard/score-all-wallets.ts --workers 4 --limit 500  # Use 4 workers
 *   npx tsx scripts/leaderboard/score-all-wallets.ts --min-resolved 50        # Only 50+ resolved markets
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import { createClient } from '@clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';
import { ccrToWalletScore, passesFilters, WalletScore } from '../../lib/leaderboard/scoring';

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name: string, def: number) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : def;
};

const LIMIT = getArg('limit', 1000);
const WORKERS = getArg('workers', 8);
const MIN_RESOLVED = getArg('min-resolved', 15);
const ACTIVE_DAYS = getArg('active-days', 90);

const CACHE_FILE = '/tmp/leaderboard-score-cache.json';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface CachedResult {
  wallet: string;
  score: WalletScore | null;
  error?: string;
  timestamp: string;
}

interface Cache {
  results: Record<string, CachedResult>;
  startedAt: string;
  lastUpdated: string;
}

function loadCache(): Cache {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.log('Cache load failed, starting fresh');
  }
  return {
    results: {},
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveCache(cache: Cache) {
  cache.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function findEligibleWallets(): Promise<string[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ACTIVE_DAYS);

  const query = `
    SELECT
      wallet,
      resolved_markets,
      realized_pnl,
      last_ts
    FROM pm_wallet_leaderboard_universe_v2
    WHERE resolved_markets >= ${MIN_RESOLVED}
      AND last_ts >= '${cutoffDate.toISOString().split('T')[0]}'
    ORDER BY realized_pnl DESC
    LIMIT ${LIMIT}
  `;

  console.log(`Finding wallets with >= ${MIN_RESOLVED} resolved markets, active in last ${ACTIVE_DAYS} days...`);

  const result = await client.query({
    query,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 60 },
  });

  const rows = await result.json() as { wallet: string }[];
  console.log(`Found ${rows.length} eligible wallets`);
  return rows.map(r => r.wallet);
}

async function scoreWallet(wallet: string): Promise<{ score: WalletScore | null; error?: string }> {
  try {
    const metrics = await computeCCRv1(wallet);
    const score = ccrToWalletScore(metrics);
    return { score };
  } catch (e: any) {
    return { score: null, error: e.message?.slice(0, 100) };
  }
}

async function runWorkerPool(wallets: string[], cache: Cache): Promise<void> {
  const queue = wallets.filter(w => !cache.results[w]);
  const total = wallets.length;
  const skipped = total - queue.length;
  let completed = skipped;
  let errors = 0;

  console.log(`\nTotal wallets: ${total}`);
  console.log(`Cached (skipped): ${skipped}`);
  console.log(`To process: ${queue.length}`);
  console.log(`Workers: ${WORKERS}\n`);

  if (queue.length === 0) {
    console.log('All wallets already cached!');
    return;
  }

  const startTime = Date.now();
  let idx = 0;

  async function processNext(): Promise<void> {
    while (idx < queue.length) {
      const myIdx = idx++;
      const wallet = queue[myIdx];

      const result = await scoreWallet(wallet);

      cache.results[wallet] = {
        wallet,
        score: result.score,
        error: result.error,
        timestamp: new Date().toISOString(),
      };

      completed++;
      if (result.error) errors++;

      // Save cache every 10 wallets
      if (completed % 10 === 0) {
        saveCache(cache);
      }

      // Progress update every 5 wallets
      if (completed % 5 === 0 || completed === total) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (completed - skipped) / elapsed;
        const remaining = queue.length - (completed - skipped);
        const eta = remaining / rate;

        const etaStr = eta > 60
          ? `${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`
          : `${Math.floor(eta)}s`;

        const pct = ((completed / total) * 100).toFixed(1);
        console.log(
          `Progress: ${completed}/${total} (${pct}%) | ` +
          `Rate: ${rate.toFixed(1)}/sec | ` +
          `Errors: ${errors} | ` +
          `ETA: ${etaStr}`
        );
      }
    }
  }

  // Launch worker pool
  const workers = Array(WORKERS).fill(null).map(() => processNext());
  await Promise.all(workers);

  // Final save
  saveCache(cache);
}

async function printResults(cache: Cache): Promise<void> {
  const results = Object.values(cache.results);
  const successful = results.filter(r => r.score !== null);
  const eligible = successful
    .filter(r => passesFilters(r.score!))
    .map(r => r.score!)
    .sort((a, b) => b.score - a.score);

  console.log('\n' + '═'.repeat(120));
  console.log('FINAL RANKING - Top 20 by Score = μ × M');
  console.log('═'.repeat(120));

  console.log('\nRank │ Wallet                                      │ Score    │ μ (avg)  │ M (move) │ Trades │ Win%  │ PnL');
  console.log('─'.repeat(120));

  eligible.slice(0, 20).forEach((r, i) => {
    console.log(
      `${(i + 1).toString().padStart(3)}  │ ${r.wallet.padEnd(42)} │ ${r.score.toFixed(4).padStart(8)} │ ${(r.mu * 100).toFixed(1).padStart(6)}% │ ${(r.M * 100).toFixed(1).padStart(6)}% │ ${r.num_trades.toString().padStart(6)} │ ${(r.win_rate * 100).toFixed(0).padStart(4)}% │ $${r.realized_pnl.toLocaleString()}`
    );
  });

  // Summary
  console.log('\n' + '─'.repeat(120));
  console.log(`Total wallets scored: ${successful.length}`);
  console.log(`Eligible (passes filters): ${eligible.length}`);
  console.log(`Errors: ${results.length - successful.length}`);
  console.log(`Cache file: ${CACHE_FILE}`);

  // Export to JSON for further analysis
  const outputFile = '/tmp/leaderboard-top-100.json';
  fs.writeFileSync(outputFile, JSON.stringify(eligible.slice(0, 100), null, 2));
  console.log(`\nTop 100 exported to: ${outputFile}`);
}

async function main() {
  console.log('\n🏆 FULL DATABASE WALLET SCORING');
  console.log('Score = μ × M with CCR-v1 Engine\n');
  console.log(`Config: limit=${LIMIT}, workers=${WORKERS}, min_resolved=${MIN_RESOLVED}, active_days=${ACTIVE_DAYS}`);

  try {
    // Load cache for resume
    const cache = loadCache();

    // Find eligible wallets
    const wallets = await findEligibleWallets();

    if (wallets.length === 0) {
      console.log('No eligible wallets found!');
      return;
    }

    // Score wallets with parallel workers
    await runWorkerPool(wallets, cache);

    // Print results
    await printResults(cache);

  } catch (e: any) {
    console.error(`Fatal error: ${e.message}`);
    console.error(e.stack);
  } finally {
    await client.close();
  }
}

main();
