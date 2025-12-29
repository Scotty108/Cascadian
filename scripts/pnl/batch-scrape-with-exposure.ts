#!/usr/bin/env npx tsx
/**
 * Batch Scrape Polymarket Wallets with Open Position Exposure
 *
 * This script:
 * 1. Gets candidate wallets from CLOB data
 * 2. Outputs wallet URLs for Playwright MCP scraping
 * 3. Expects scraped data to include: net_total, open_positions_count, open_exposure
 * 4. Runs V19s engine on each wallet
 * 5. Compares accounting for open position variance
 *
 * Usage:
 *   npx tsx scripts/pnl/batch-scrape-with-exposure.ts --batch 1 --size 30
 *   npx tsx scripts/pnl/batch-scrape-with-exposure.ts --save "wallet,net_total,open_count,open_exposure"
 *   npx tsx scripts/pnl/batch-scrape-with-exposure.ts --report
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import { createV19sEngine } from '../../lib/pnl/uiActivityEngineV19s';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const CHECKPOINT_FILE = '/tmp/batch_scrape_checkpoint.json';
const RESULTS_FILE = '/tmp/batch_scrape_results.json';
const BENCHMARK_SET = `batch_scrape_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}`;

interface ScrapedWallet {
  wallet: string;
  ui_net_total: number | null;
  ui_open_positions: number | null;
  ui_open_exposure: number | null;
  scraped_at: string;
  error?: string;
}

interface ValidationResult extends ScrapedWallet {
  v19s_total_pnl: number | null;
  v19s_open_positions: number | null;
  delta_pct: number | null;
  adjusted_delta_pct: number | null; // Delta accounting for open exposure
  pass: boolean;
  pass_adjusted: boolean;
}

// Load checkpoint
function loadCheckpoint(): { completed: string[]; batch: number } {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    }
  } catch {}
  return { completed: [], batch: 0 };
}

// Save checkpoint
function saveCheckpoint(data: { completed: string[]; batch: number }) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
}

// Load results
function loadResults(): ValidationResult[] {
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

// Save results
function saveResults(results: ValidationResult[]) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// Get active trader wallets for validation
async function getCandidateWallets(offset: number, limit: number): Promise<string[]> {
  // Very simple query - sample active wallets
  const q = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(trader_wallet) as wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 30 DAY
      ORDER BY rand()
      LIMIT ${limit} OFFSET ${offset}
    `,
    format: 'JSONEachRow',
  });
  const rows = (await q.json()) as { wallet: string }[];
  return rows.map((r) => r.wallet);
}

// Run V19s engine for a wallet
async function runV19sEngine(wallet: string): Promise<{ total_pnl: number; open_positions: number } | null> {
  try {
    const engine = createV19sEngine();
    const result = await engine.compute(wallet);
    return {
      total_pnl: result.total_pnl,
      open_positions: result.open_positions,
    };
  } catch (e) {
    console.error(`V19s error for ${wallet}:`, e);
    return null;
  }
}

// Generate batch for scraping
async function generateBatch(batchNum: number, batchSize: number) {
  console.log('BATCH SCRAPE WITH EXPOSURE - GENERATE BATCH');
  console.log('='.repeat(80));

  const checkpoint = loadCheckpoint();
  const offset = (batchNum - 1) * batchSize;

  console.log(`Batch ${batchNum}: Getting wallets ${offset + 1} to ${offset + batchSize}...`);

  const wallets = await getCandidateWallets(offset, batchSize);
  const remaining = wallets.filter((w) => !checkpoint.completed.includes(w));

  console.log(`Found ${wallets.length} candidate wallets`);
  console.log(`Already scraped: ${wallets.length - remaining.length}`);
  console.log(`Remaining to scrape: ${remaining.length}\n`);

  if (remaining.length === 0) {
    console.log('All wallets in this batch are scraped!');
    console.log('Run with --report to see results, or increase batch number.');
    await clickhouse.close();
    return;
  }

  console.log('WALLETS TO SCRAPE:');
  console.log('-'.repeat(80));
  console.log('For each wallet, extract from Polymarket UI:');
  console.log('  1. Net total (hover on Profit info icon)');
  console.log('  2. Open positions count (from Positions tab)');
  console.log('  3. Open exposure estimate (sum of unrealized P/L if visible)\n');

  for (let i = 0; i < remaining.length; i++) {
    const w = remaining[i];
    console.log(`${i + 1}. ${w}`);
    console.log(`   URL: https://polymarket.com/profile/${w}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('PLAYWRIGHT MCP SCRAPING INSTRUCTIONS:');
  console.log('='.repeat(80));
  console.log(`
1. Navigate to wallet URL:
   mcp__playwright__browser_navigate({ url: "https://polymarket.com/profile/WALLET" })

2. Wait for load, then take snapshot:
   mcp__playwright__browser_snapshot({})

3. Look for "Profit" section - hover on (i) icon to see Net total
   The snapshot shows elements like: "Profit +$X,XXX (i)"

4. Check Positions tab for open position count

5. Save result:
   npx tsx scripts/pnl/batch-scrape-with-exposure.ts --save "WALLET,NET_TOTAL,OPEN_COUNT,OPEN_EXPOSURE"

   Example: --save "0x123abc,-312.78,5,150.00"
   (Use 0 for open_exposure if not visible)

After scraping all wallets, run:
   npx tsx scripts/pnl/batch-scrape-with-exposure.ts --report
`);

  // Update checkpoint with current batch
  checkpoint.batch = batchNum;
  saveCheckpoint(checkpoint);

  await clickhouse.close();
}

// Save a scraped result
async function saveScrapedResult(data: string) {
  const parts = data.split(',');
  if (parts.length < 2) {
    console.error('Invalid format. Use: --save "wallet,net_total[,open_count,open_exposure]"');
    return;
  }

  const wallet = parts[0].toLowerCase().trim();
  const net_total = parseFloat(parts[1]);
  const open_count = parts[2] ? parseInt(parts[2]) : null;
  const open_exposure = parts[3] ? parseFloat(parts[3]) : null;

  const checkpoint = loadCheckpoint();
  const results = loadResults();

  // Run V19s engine
  console.log(`Running V19s engine for ${wallet}...`);
  const v19s = await runV19sEngine(wallet);

  const ui_net = isNaN(net_total) ? null : net_total;
  const v19s_pnl = v19s?.total_pnl ?? null;

  // Calculate deltas
  let delta_pct: number | null = null;
  let adjusted_delta_pct: number | null = null;

  if (ui_net !== null && v19s_pnl !== null && ui_net !== 0) {
    delta_pct = ((v19s_pnl - ui_net) / Math.abs(ui_net)) * 100;

    // Adjusted delta accounts for open exposure variance
    // If we have open exposure info, the "true" range is ui_net ± open_exposure
    if (open_exposure !== null && open_exposure > 0) {
      const minUI = ui_net - open_exposure;
      const maxUI = ui_net + open_exposure;
      if (v19s_pnl >= minUI && v19s_pnl <= maxUI) {
        adjusted_delta_pct = 0; // Within expected range
      } else if (v19s_pnl < minUI) {
        adjusted_delta_pct = ((v19s_pnl - minUI) / Math.abs(ui_net)) * 100;
      } else {
        adjusted_delta_pct = ((v19s_pnl - maxUI) / Math.abs(ui_net)) * 100;
      }
    } else {
      adjusted_delta_pct = delta_pct;
    }
  }

  const result: ValidationResult = {
    wallet,
    ui_net_total: ui_net,
    ui_open_positions: open_count,
    ui_open_exposure: open_exposure,
    scraped_at: new Date().toISOString(),
    v19s_total_pnl: v19s_pnl,
    v19s_open_positions: v19s?.open_positions ?? null,
    delta_pct,
    adjusted_delta_pct,
    pass: delta_pct !== null ? Math.abs(delta_pct) <= 15 : false,
    pass_adjusted: adjusted_delta_pct !== null ? Math.abs(adjusted_delta_pct) <= 15 : false,
  };

  // Update results (replace if exists)
  const existingIdx = results.findIndex((r) => r.wallet === wallet);
  if (existingIdx >= 0) {
    results[existingIdx] = result;
  } else {
    results.push(result);
  }

  // Update checkpoint
  if (!checkpoint.completed.includes(wallet)) {
    checkpoint.completed.push(wallet);
  }

  saveResults(results);
  saveCheckpoint(checkpoint);

  console.log(`\nSaved: ${wallet}`);
  console.log(`  UI Net Total: $${ui_net?.toLocaleString() ?? 'N/A'}`);
  console.log(`  V19s PnL:     $${v19s_pnl?.toLocaleString() ?? 'N/A'}`);
  console.log(`  Delta:        ${delta_pct?.toFixed(1) ?? 'N/A'}%`);
  console.log(`  Adjusted:     ${adjusted_delta_pct?.toFixed(1) ?? 'N/A'}%`);
  console.log(`  Pass:         ${result.pass ? 'YES' : 'NO'} (Adjusted: ${result.pass_adjusted ? 'YES' : 'NO'})`);
  console.log(`\nTotal scraped: ${checkpoint.completed.length}`);

  await clickhouse.close();
}

// Generate report
async function generateReport() {
  console.log('BATCH SCRAPE VALIDATION REPORT');
  console.log('='.repeat(80));

  const results = loadResults();
  const checkpoint = loadCheckpoint();

  console.log(`Total scraped: ${results.length}`);
  console.log(`Benchmark set: ${BENCHMARK_SET}\n`);

  if (results.length === 0) {
    console.log('No results yet. Run with --batch N --size 30 to generate wallets to scrape.');
    await clickhouse.close();
    return;
  }

  // Filter valid results
  const valid = results.filter((r) => r.ui_net_total !== null && r.v19s_total_pnl !== null);
  const withExposure = valid.filter((r) => r.ui_open_exposure !== null && r.ui_open_exposure > 0);

  console.log(`Valid comparisons: ${valid.length}`);
  console.log(`With exposure data: ${withExposure.length}\n`);

  // Calculate pass rates
  const rawPass = valid.filter((r) => r.pass).length;
  const adjustedPass = valid.filter((r) => r.pass_adjusted).length;

  console.log('PASS RATES (within ±15%):');
  console.log('-'.repeat(40));
  console.log(`  Raw:      ${rawPass}/${valid.length} (${((rawPass / valid.length) * 100).toFixed(1)}%)`);
  console.log(`  Adjusted: ${adjustedPass}/${valid.length} (${((adjustedPass / valid.length) * 100).toFixed(1)}%)`);

  // Breakdown by open positions
  const realizedOnly = valid.filter((r) => r.v19s_open_positions === 0);
  const hasOpen = valid.filter((r) => (r.v19s_open_positions ?? 0) > 0);

  console.log('\nBY POSITION STATUS:');
  console.log('-'.repeat(40));
  if (realizedOnly.length > 0) {
    const realizedPass = realizedOnly.filter((r) => r.pass).length;
    console.log(`  Realized-only: ${realizedPass}/${realizedOnly.length} (${((realizedPass / realizedOnly.length) * 100).toFixed(1)}%)`);
  }
  if (hasOpen.length > 0) {
    const openPass = hasOpen.filter((r) => r.pass).length;
    const openAdjPass = hasOpen.filter((r) => r.pass_adjusted).length;
    console.log(`  With open:     ${openPass}/${hasOpen.length} raw (${((openPass / hasOpen.length) * 100).toFixed(1)}%)`);
    console.log(`                 ${openAdjPass}/${hasOpen.length} adjusted (${((openAdjPass / hasOpen.length) * 100).toFixed(1)}%)`);
  }

  // Show details
  console.log('\n' + '='.repeat(100));
  console.log('DETAILED RESULTS:');
  console.log('='.repeat(100));
  console.log('Wallet'.padEnd(44) + 'UI PnL'.padStart(14) + 'V19s PnL'.padStart(14) + 'Delta%'.padStart(10) + 'Adj%'.padStart(10) + 'Open'.padStart(6) + ' Pass');
  console.log('-'.repeat(100));

  const sorted = [...valid].sort((a, b) => Math.abs(a.delta_pct ?? 999) - Math.abs(b.delta_pct ?? 999));

  for (const r of sorted) {
    const ui = r.ui_net_total !== null ? `$${r.ui_net_total.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'N/A';
    const v19s = r.v19s_total_pnl !== null ? `$${r.v19s_total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'N/A';
    const delta = r.delta_pct !== null ? `${r.delta_pct >= 0 ? '+' : ''}${r.delta_pct.toFixed(1)}%` : 'N/A';
    const adj = r.adjusted_delta_pct !== null ? `${r.adjusted_delta_pct >= 0 ? '+' : ''}${r.adjusted_delta_pct.toFixed(1)}%` : 'N/A';
    const open = r.v19s_open_positions?.toString() ?? '?';
    const pass = r.pass ? 'YES' : (r.pass_adjusted ? 'ADJ' : 'NO');

    console.log(r.wallet.padEnd(44) + ui.padStart(14) + v19s.padStart(14) + delta.padStart(10) + adj.padStart(10) + open.padStart(6) + ` ${pass}`);
  }

  // Insert to benchmark table
  console.log('\n' + '='.repeat(80));
  console.log('Inserting results to pm_ui_pnl_benchmarks_v1...');

  let inserted = 0;
  for (const r of results) {
    if (r.ui_net_total !== null) {
      try {
        await clickhouse.insert({
          table: 'pm_ui_pnl_benchmarks_v1',
          values: [
            {
              wallet: r.wallet,
              pnl_value: r.ui_net_total,
              benchmark_set: BENCHMARK_SET,
              captured_at: r.scraped_at,
            },
          ],
          format: 'JSONEachRow',
        });
        inserted++;
      } catch (e) {
        // Might already exist
      }
    }
  }
  console.log(`Inserted ${inserted} benchmarks`);

  await clickhouse.close();
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--save')) {
    const idx = args.indexOf('--save');
    const data = args[idx + 1];
    if (data) {
      await saveScrapedResult(data);
    } else {
      console.error('Missing data for --save');
    }
    return;
  }

  if (args.includes('--report')) {
    await generateReport();
    return;
  }

  // Default: generate batch
  let batchNum = 1;
  let batchSize = 30;

  const batchIdx = args.indexOf('--batch');
  if (batchIdx >= 0 && args[batchIdx + 1]) {
    batchNum = parseInt(args[batchIdx + 1]);
  }

  const sizeIdx = args.indexOf('--size');
  if (sizeIdx >= 0 && args[sizeIdx + 1]) {
    batchSize = parseInt(args[sizeIdx + 1]);
  }

  await generateBatch(batchNum, batchSize);
}

main().catch(console.error);
