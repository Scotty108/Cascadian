/**
 * ============================================================================
 * Capture Fresh Benchmark Set v2
 * ============================================================================
 *
 * Creates a frozen benchmark set for PnL engine testing with:
 * - 25 wallets from leaderboard (high activity, diverse PnL)
 * - 15 random active traders from V8 ledger
 * - 10 known CTF-heavy/mixed wallets
 *
 * Fetches FRESH UI PnL from Polymarket API and saves to:
 * 1. data/benchmarks/ui_pnl_fresh_<date>.json
 * 2. ClickHouse pm_ui_pnl_benchmarks_v1 table
 *
 * Usage:
 *   npx tsx scripts/pnl/capture-benchmark-set-v2.ts
 *   npx tsx scripts/pnl/capture-benchmark-set-v2.ts --set=my_custom_name
 *
 * Terminal: Claude 1
 * Date: 2025-12-06
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Known CTF-Heavy / Mixed Wallets (from previous investigations)
// ============================================================================

const CTF_HEAVY_WALLETS = [
  // Market makers with high Split/Merge activity
  '0xa9878e59934ab507f9039bcb917c1bae0451141d', // ilovecircle - high merge count
  '0xee00ba338c59557141789b127927a55f5cc5cea1', // S-Works - high merge
  '0x461f3e886dca22e561eee224d283e08b8fb47a07', // HyperLiquid0xb - market maker
  '0x2f09642639aedd6ced432519c1a86e7d52034632', // piastri - market maker
  '0x14964aefa2cd7caff7878b3820a690a03c5aa429', // gmpm - CTF activity
  '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', // wallet0x7f - high redemptions
  '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', // ImJustKen - heavy merge
  '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', // darkrider11 - complex activity
  '0xe74a4446efd66a4de690962938f550d8921a40ee', // walletX - data suspect
  '0x42592084120b0d5287059919d2a96b3b7acb936f', // antman-batman - mixed
];

// ============================================================================
// API Fetcher
// ============================================================================

interface LeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string;
  vol: number;
  pnl: number;
}

async function fetchLeaderboardWallets(limit: number): Promise<LeaderboardEntry[]> {
  const url = `https://data-api.polymarket.com/v1/leaderboard?timePeriod=all&orderBy=PNL&limit=${limit}&offset=0&category=overall`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Leaderboard fetch failed: ${response.status}`);
  }
  return await response.json();
}

async function fetchWalletPnL(wallet: string): Promise<{ pnl: number; vol: number } | null> {
  const url = `https://data-api.polymarket.com/v1/leaderboard?timePeriod=all&orderBy=PNL&limit=1&offset=0&category=overall&user=${wallet}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data: LeaderboardEntry[] = await response.json();
    if (!data || data.length === 0) return null;
    return { pnl: data[0].pnl, vol: data[0].vol };
  } catch {
    return null;
  }
}

// ============================================================================
// Random Active Traders from V8 Ledger
// ============================================================================

async function getRandomActiveTraders(limit: number, excludeWallets: Set<string>): Promise<string[]> {
  // Get wallets with significant CLOB activity that are NOT in the exclude list
  const excludeList = [...excludeWallets].map(w => `'${w.toLowerCase()}'`).join(',');

  const result = await clickhouse.query({
    query: `
      SELECT wallet_address
      FROM pm_unified_ledger_v8_tbl
      WHERE source_type = 'CLOB'
        ${excludeList.length > 0 ? `AND lower(wallet_address) NOT IN (${excludeList})` : ''}
      GROUP BY wallet_address
      HAVING count(*) >= 50  -- At least 50 CLOB events
        AND sum(abs(usdc_delta)) >= 10000  -- At least $10K volume
      ORDER BY rand()
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const rows: any[] = await result.json();
  return rows.map(r => r.wallet_address.toLowerCase());
}

// ============================================================================
// Main
// ============================================================================

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
  ui_volume: number;
  source: 'leaderboard' | 'random_trader' | 'ctf_heavy';
  leaderboard_rank?: number;
  username?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '_');
  let benchmarkSet = `fresh_${date}`;

  for (const arg of args) {
    if (arg.startsWith('--set=')) {
      benchmarkSet = arg.slice(6);
    }
  }

  console.log('='.repeat(80));
  console.log('CAPTURE FRESH BENCHMARK SET v2');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Benchmark set: ${benchmarkSet}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  const wallets: BenchmarkWallet[] = [];
  const seenWallets = new Set<string>();

  // 1. Fetch top 25 from leaderboard
  console.log('Step 1: Fetching top 25 from leaderboard...');
  const leaderboard = await fetchLeaderboardWallets(30); // Get extra in case of overlap
  let leaderboardCount = 0;

  for (const entry of leaderboard) {
    if (leaderboardCount >= 25) break;
    const wallet = entry.proxyWallet.toLowerCase();
    if (seenWallets.has(wallet)) continue;

    seenWallets.add(wallet);
    wallets.push({
      wallet,
      ui_pnl: entry.pnl,
      ui_volume: entry.vol,
      source: 'leaderboard',
      leaderboard_rank: parseInt(entry.rank),
      username: entry.userName,
    });
    leaderboardCount++;
    process.stdout.write(`  ${leaderboardCount}. ${wallet.slice(0, 12)}... $${entry.pnl.toLocaleString()} (${entry.userName})\n`);
  }
  console.log(`  Added ${leaderboardCount} leaderboard wallets`);
  console.log('');

  // 2. Add CTF-heavy wallets
  console.log('Step 2: Adding CTF-heavy/mixed wallets...');
  let ctfCount = 0;
  for (const wallet of CTF_HEAVY_WALLETS) {
    const w = wallet.toLowerCase();
    if (seenWallets.has(w)) {
      console.log(`  Skipping ${w.slice(0, 12)}... (already in leaderboard)`);
      continue;
    }

    const result = await fetchWalletPnL(w);
    if (!result) {
      console.log(`  Skipping ${w.slice(0, 12)}... (no API data)`);
      continue;
    }

    seenWallets.add(w);
    wallets.push({
      wallet: w,
      ui_pnl: result.pnl,
      ui_volume: result.vol,
      source: 'ctf_heavy',
    });
    ctfCount++;
    console.log(`  ${ctfCount}. ${w.slice(0, 12)}... $${result.pnl.toLocaleString()}`);
  }
  console.log(`  Added ${ctfCount} CTF-heavy wallets`);
  console.log('');

  // 3. Get random active traders to fill to 50
  const remaining = 50 - wallets.length;
  console.log(`Step 3: Fetching ${remaining} random active traders...`);
  const randomTraders = await getRandomActiveTraders(remaining + 10, seenWallets); // Get extra
  let randomCount = 0;

  for (const wallet of randomTraders) {
    if (wallets.length >= 50) break;
    if (seenWallets.has(wallet)) continue;

    const result = await fetchWalletPnL(wallet);
    if (!result) continue;

    seenWallets.add(wallet);
    wallets.push({
      wallet,
      ui_pnl: result.pnl,
      ui_volume: result.vol,
      source: 'random_trader',
    });
    randomCount++;
    process.stdout.write(`  ${randomCount}. ${wallet.slice(0, 12)}... $${result.pnl.toLocaleString()}\n`);
  }
  console.log(`  Added ${randomCount} random traders`);
  console.log('');

  // Summary
  console.log('='.repeat(80));
  console.log('BENCHMARK SET SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets: ${wallets.length}`);
  console.log(`  Leaderboard: ${wallets.filter(w => w.source === 'leaderboard').length}`);
  console.log(`  CTF-heavy:   ${wallets.filter(w => w.source === 'ctf_heavy').length}`);
  console.log(`  Random:      ${wallets.filter(w => w.source === 'random_trader').length}`);
  console.log('');

  const totalPnL = wallets.reduce((sum, w) => sum + w.ui_pnl, 0);
  const avgPnL = totalPnL / wallets.length;
  console.log(`Total UI PnL: $${totalPnL.toLocaleString()}`);
  console.log(`Average UI PnL: $${avgPnL.toLocaleString()}`);
  console.log('');

  // Save to JSON file
  const outputDir = path.join(process.cwd(), 'data', 'benchmarks');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, `ui_pnl_${benchmarkSet}.json`);
  const outputData = {
    metadata: {
      benchmark_set: benchmarkSet,
      source: 'polymarket_leaderboard_api',
      captured_at: new Date().toISOString(),
      notes: `Fresh benchmark with 25 leaderboard + ${ctfCount} CTF-heavy + ${randomCount} random traders`,
    },
    wallets: wallets.map(w => ({
      wallet: w.wallet,
      ui_pnl: w.ui_pnl,
      note: `source:${w.source}${w.username ? ` user:${w.username}` : ''}${w.leaderboard_rank ? ` rank:${w.leaderboard_rank}` : ''}`,
    })),
  };

  fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
  console.log(`Saved to: ${outputFile}`);
  console.log('');

  // Seed to ClickHouse
  console.log('Seeding to ClickHouse pm_ui_pnl_benchmarks_v1...');
  const capturedAtStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const values = wallets.map(w => ({
    wallet: w.wallet,
    source: 'polymarket_leaderboard_api',
    pnl_value: w.ui_pnl,
    pnl_currency: 'USDC',
    captured_at: capturedAtStr,
    note: `source:${w.source}${w.username ? ` user:${w.username}` : ''}${w.leaderboard_rank ? ` rank:${w.leaderboard_rank}` : ''}`,
    benchmark_set: benchmarkSet,
  }));

  await clickhouse.insert({
    table: 'pm_ui_pnl_benchmarks_v1',
    values,
    format: 'JSONEachRow',
  });

  console.log(`Inserted ${values.length} rows with benchmark_set="${benchmarkSet}"`);
  console.log('');

  // Verify
  const verifyQuery = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = '${benchmarkSet}'
    `,
    format: 'JSONEachRow',
  });
  const verifyRows: any[] = await verifyQuery.json();
  console.log(`Verification: ${verifyRows[0]?.cnt} rows in ClickHouse for benchmark_set="${benchmarkSet}"`);

  console.log('');
  console.log('='.repeat(80));
  console.log('DONE - Run regression test with:');
  console.log(`  npx tsx scripts/pnl/run-regression-matrix.ts --set=${benchmarkSet}`);
  console.log('='.repeat(80));
}

main().catch(console.error);
