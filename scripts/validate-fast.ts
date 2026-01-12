/**
 * Fast Parallel Wallet Validation
 *
 * Uses GPT's recommended optimizations:
 * - Concurrency pool (8 workers default)
 * - Retry with backoff for API calls
 * - Parallel API + ClickHouse calls
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

// === CONCURRENCY POOL ===
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

// === RETRY WITH BACKOFF ===
async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let err: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e: any) {
      err = e;
      const ms = Math.min(2000, 200 * Math.pow(2, i));
      await new Promise(r => setTimeout(r, ms));
    }
  }
  throw err;
}

// === API CALL ===
async function getApiPnL(wallet: string): Promise<number> {
  return withRetry(async () => {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json() as Array<{ t: number; p: number }>;
    if (data && data.length > 0) {
      const sorted = [...data].sort((a, b) => b.t - a.t);
      return sorted[0].p || 0;
    }
    return 0;
  });
}

// === WALLET SELECTION ===
async function selectWallets(count: number): Promise<string[]> {
  console.log(`Selecting ${count} diverse wallets...\n`);

  // Get wallets from different cohorts
  const queries = [
    // Maker-heavy
    `SELECT lower(trader_wallet) as wallet FROM pm_trader_events_v3
     GROUP BY wallet HAVING count() BETWEEN 50 AND 500 AND countIf(role='maker')/count() > 0.7
     ORDER BY rand() LIMIT ${Math.floor(count * 0.15)}`,
    // Taker-heavy
    `SELECT lower(trader_wallet) as wallet FROM pm_trader_events_v3
     GROUP BY wallet HAVING count() BETWEEN 50 AND 500 AND countIf(role='maker')/count() < 0.3
     ORDER BY rand() LIMIT ${Math.floor(count * 0.15)}`,
    // Mixed
    `SELECT lower(trader_wallet) as wallet FROM pm_trader_events_v3
     GROUP BY wallet HAVING count() BETWEEN 50 AND 500
     ORDER BY rand() LIMIT ${Math.floor(count * 0.20)}`,
    // High volume
    `SELECT lower(trader_wallet) as wallet FROM pm_trader_events_v3
     GROUP BY wallet HAVING sum(usdc_amount) / 1e6 > 10000
     ORDER BY rand() LIMIT ${Math.floor(count * 0.15)}`,
    // Random
    `SELECT lower(trader_wallet) as wallet FROM pm_trader_events_v3
     GROUP BY wallet HAVING count() BETWEEN 20 AND 1000
     ORDER BY rand() LIMIT ${Math.floor(count * 0.35)}`,
  ];

  const wallets = new Set<string>();
  for (const query of queries) {
    try {
      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = (await result.json()) as any[];
      for (const row of rows) {
        wallets.add(row.wallet);
      }
    } catch (e) {
      console.log(`Query error: ${e}`);
    }
  }

  return Array.from(wallets).slice(0, count);
}

// === VALIDATION ===
interface ValidationResult {
  wallet: string;
  calcPnl: number;
  apiPnl: number;
  error: number;
  absError: number;
  status: 'PASS' | 'CLOSE' | 'FAIL';
  openPositions: number;
  time: number;
}

async function validateWallet(wallet: string): Promise<ValidationResult> {
  const start = Date.now();

  const [result, apiPnl] = await Promise.all([
    getWalletPnLV1(wallet),
    getApiPnL(wallet),
  ]);

  const calcPnl = result.totalPnl;
  const error = calcPnl - apiPnl;
  const absError = Math.abs(error);

  // Thresholds: lenient for open positions
  let passThreshold = 10;
  let closeThreshold = 100;
  if (result.openPositionCount > 0) {
    passThreshold = 50;
    closeThreshold = 200;
  }

  const status = absError <= passThreshold ? 'PASS' : absError <= closeThreshold ? 'CLOSE' : 'FAIL';

  return {
    wallet,
    calcPnl,
    apiPnl,
    error,
    absError,
    status,
    openPositions: result.openPositionCount,
    time: Date.now() - start,
  };
}

// === MAIN ===
async function main() {
  const WALLET_COUNT = parseInt(process.argv[2] || '50');
  const CONCURRENCY = parseInt(process.argv[3] || '8');

  console.log('=' .repeat(80));
  console.log(`FAST PARALLEL VALIDATION: ${WALLET_COUNT} wallets @ ${CONCURRENCY} workers`);
  console.log('=' .repeat(80));
  console.log('');

  const wallets = await selectWallets(WALLET_COUNT);
  console.log(`Selected ${wallets.length} wallets\n`);

  let completed = 0;
  const results = await mapPool(wallets, CONCURRENCY, async (wallet, idx) => {
    try {
      const result = await validateWallet(wallet);
      completed++;
      const pct = ((completed / wallets.length) * 100).toFixed(0);
      const symbol = result.status === 'PASS' ? '✓' : result.status === 'CLOSE' ? '~' : '✗';
      console.log(`[${completed}/${wallets.length}] ${pct}% | ${symbol} ${result.status} | Err: $${result.error.toFixed(2).padStart(10)} | ${result.time}ms | ${wallet.slice(0, 14)}...`);
      return result;
    } catch (e) {
      completed++;
      console.log(`[${completed}/${wallets.length}] ERROR | ${wallet.slice(0, 14)}... | ${e}`);
      return null;
    }
  });

  // Filter successful results
  const successful = results.filter((r): r is ValidationResult => r !== null);

  // Summary
  console.log('\n' + '=' .repeat(80));
  console.log('SUMMARY');
  console.log('=' .repeat(80));

  const pass = successful.filter(r => r.status === 'PASS').length;
  const close = successful.filter(r => r.status === 'CLOSE').length;
  const fail = successful.filter(r => r.status === 'FAIL').length;

  console.log(`\nTotal: ${successful.length} | PASS: ${pass} | CLOSE: ${close} | FAIL: ${fail}`);
  console.log(`Pass Rate: ${(pass / successful.length * 100).toFixed(1)}%`);

  // Error distribution
  const errors = successful.map(r => r.absError).sort((a, b) => a - b);
  console.log(`\nError Distribution:`);
  console.log(`  P25: $${errors[Math.floor(errors.length * 0.25)]?.toFixed(2) || 0}`);
  console.log(`  Median: $${errors[Math.floor(errors.length * 0.5)]?.toFixed(2) || 0}`);
  console.log(`  P75: $${errors[Math.floor(errors.length * 0.75)]?.toFixed(2) || 0}`);
  console.log(`  Max: $${errors[errors.length - 1]?.toFixed(2) || 0}`);

  // Failures
  if (fail > 0) {
    console.log(`\nFailing Wallets:`);
    for (const r of successful.filter(r => r.status === 'FAIL')) {
      console.log(`  ${r.wallet} | Err: $${r.error.toFixed(2)} | Open: ${r.openPositions}`);
    }
  }

  // Timing
  const totalTime = successful.reduce((s, r) => s + r.time, 0);
  console.log(`\nTotal validation time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`Average per wallet: ${(totalTime / successful.length / 1000).toFixed(1)}s`);
}

main().catch(console.error);
