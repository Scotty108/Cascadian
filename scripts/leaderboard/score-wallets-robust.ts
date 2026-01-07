/**
 * Robust Wallet Scoring with Retry Logic
 *
 * Scores wallets from database with:
 * - 2 parallel workers (safe for ClickHouse)
 * - Exponential backoff retry (3 attempts)
 * - Resume from cache
 * - Progress checkpointing
 *
 * Time estimates (2 workers, ~2 sec/wallet):
 *   1,000 wallets: ~17 min
 *   5,000 wallets: ~1.4 hours
 *   20,000 wallets: ~5.5 hours
 *   50,000 wallets: ~14 hours
 *
 * Usage:
 *   npx tsx scripts/leaderboard/score-wallets-robust.ts --limit 5000
 *   npx tsx scripts/leaderboard/score-wallets-robust.ts --resume   # continue from cache
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';
import { ccrToWalletScore, passesFilters, WalletScore } from '../../lib/leaderboard/scoring';

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name: string, def: number) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : def;
};
const hasFlag = (name: string) => args.includes(`--${name}`);

const LIMIT = getArg('limit', 1000);
const WORKERS = 2; // Fixed at 2 to not overwhelm ClickHouse
const MIN_RESOLVED = getArg('min-resolved', 15);
const RESUME = hasFlag('resume');

const CACHE_FILE = '/tmp/leaderboard-robust-cache.json';

interface CachedResult {
  wallet: string;
  score: WalletScore | null;
  error?: string;
  timestamp: string;
  attempts: number;
}

interface Cache {
  results: Record<string, CachedResult>;
  startedAt: string;
  lastUpdated: string;
  totalWallets: number;
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
    totalWallets: 0,
  };
}

function saveCache(cache: Cache) {
  cache.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findEligibleWallets(client: ClickHouseClient): Promise<string[]> {
  // Exclude known system contracts
  const systemContracts = [
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // Polymarket CTF
    '0xc5d563a36ae78145c45a50134d48a1215220f80a', // Another system
  ];

  const query = `
    SELECT
      wallet,
      resolved_markets,
      realized_pnl
    FROM pm_wallet_leaderboard_universe_v2
    WHERE resolved_markets >= ${MIN_RESOLVED}
      AND wallet NOT IN (${systemContracts.map(w => `'${w}'`).join(',')})
    ORDER BY realized_pnl DESC
    LIMIT ${LIMIT}
  `;

  console.log(`Finding wallets with >= ${MIN_RESOLVED} resolved markets...`);

  const result = await client.query({
    query,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 60 },
  });

  const rows = await result.json() as { wallet: string }[];
  console.log(`Found ${rows.length} eligible wallets`);
  return rows.map(r => r.wallet);
}

async function scoreWalletWithRetry(
  wallet: string,
  maxAttempts: number = 3
): Promise<{ score: WalletScore | null; error?: string; attempts: number }> {
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const metrics = await computeCCRv1(wallet);
      const score = ccrToWalletScore(metrics);
      return { score, attempts: attempt };
    } catch (e: any) {
      lastError = e.message?.slice(0, 100) || 'Unknown error';

      // Don't retry for non-transient errors
      if (lastError.includes('system contract') ||
          lastError.includes('No trades found')) {
        return { score: null, error: lastError, attempts: attempt };
      }

      // Exponential backoff for transient errors
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        await sleep(delay);
      }
    }
  }

  return { score: null, error: lastError, attempts: maxAttempts };
}

async function runWorkerPool(wallets: string[], cache: Cache): Promise<void> {
  // Filter out already-completed wallets (successful or permanent failures)
  const needsProcessing = wallets.filter(w => {
    const cached = cache.results[w];
    if (!cached) return true;
    if (cached.score) return false; // Already successful
    if (cached.attempts >= 3) return false; // Max retries reached
    if (cached.error?.includes('system contract')) return false;
    if (cached.error?.includes('No trades found')) return false;
    return true; // Retry transient failures
  });

  const total = wallets.length;
  const skipped = total - needsProcessing.length;
  let completed = skipped;
  let successes = Object.values(cache.results).filter(r => r.score).length;
  let errors = Object.values(cache.results).filter(r => r.error).length;

  console.log(`\nTotal wallets: ${total}`);
  console.log(`Already processed: ${skipped} (${successes} success, ${errors} errors)`);
  console.log(`To process: ${needsProcessing.length}`);
  console.log(`Workers: ${WORKERS}\n`);

  if (needsProcessing.length === 0) {
    console.log('All wallets already processed!');
    return;
  }

  const startTime = Date.now();
  let idx = 0;

  async function processNext(): Promise<void> {
    while (idx < needsProcessing.length) {
      const myIdx = idx++;
      const wallet = needsProcessing[myIdx];

      const result = await scoreWalletWithRetry(wallet);

      cache.results[wallet] = {
        wallet,
        score: result.score,
        error: result.error,
        timestamp: new Date().toISOString(),
        attempts: result.attempts,
      };

      completed++;
      if (result.score) successes++;
      else errors++;

      // Save cache every 10 wallets
      if (completed % 10 === 0) {
        saveCache(cache);
      }

      // Progress update every 5 wallets
      if (completed % 5 === 0 || completed === total) {
        const elapsed = (Date.now() - startTime) / 1000;
        const processed = completed - skipped;
        const rate = processed / elapsed;
        const remaining = needsProcessing.length - processed;
        const eta = remaining / rate;

        const etaStr = eta > 3600
          ? `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m`
          : eta > 60
            ? `${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`
            : `${Math.floor(eta)}s`;

        const pct = ((completed / total) * 100).toFixed(1);
        console.log(
          `Progress: ${completed}/${total} (${pct}%) | ` +
          `Rate: ${rate.toFixed(2)}/sec | ` +
          `Success: ${successes} | Errors: ${errors} | ` +
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

  // Summary stats
  const avgScore = eligible.reduce((s, w) => s + w.score, 0) / eligible.length;
  const avgMu = eligible.reduce((s, w) => s + w.mu, 0) / eligible.length;

  console.log('\n' + '─'.repeat(120));
  console.log(`Total wallets scored: ${successful.length}`);
  console.log(`Eligible (passes filters): ${eligible.length}`);
  console.log(`Avg Score (eligible): ${avgScore.toFixed(4)}`);
  console.log(`Avg μ (eligible): ${(avgMu * 100).toFixed(1)}%`);
  console.log(`Cache file: ${CACHE_FILE}`);

  // Export to JSON
  const outputFile = '/tmp/leaderboard-top-100-robust.json';
  fs.writeFileSync(outputFile, JSON.stringify(eligible.slice(0, 100), null, 2));
  console.log(`\nTop 100 exported to: ${outputFile}`);
}

async function main() {
  console.log('\n🏆 ROBUST WALLET SCORING');
  console.log('Score = μ × M with CCR-v1 Engine\n');
  console.log(`Config: limit=${LIMIT}, workers=${WORKERS}, min_resolved=${MIN_RESOLVED}, resume=${RESUME}`);

  const client = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
  });

  try {
    // Load or create cache
    const cache = RESUME ? loadCache() : {
      results: {},
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      totalWallets: 0,
    };

    // Find eligible wallets
    const wallets = await findEligibleWallets(client);
    cache.totalWallets = wallets.length;

    if (wallets.length === 0) {
      console.log('No eligible wallets found!');
      return;
    }

    // Score wallets
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
