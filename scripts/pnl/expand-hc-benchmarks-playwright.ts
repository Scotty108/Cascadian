#!/usr/bin/env npx tsx
/**
 * HC Benchmark Expansion via Playwright
 *
 * Scrapes UI PnL (Net total) from Polymarket profiles for HC wallets.
 * Batches in groups of 10-20 with retries and checkpointing.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const CHECKPOINT_FILE = '/tmp/hc_benchmark_checkpoint.json';
const RESULTS_FILE = '/tmp/hc_benchmark_results.json';

interface WalletToScrape {
  wallet: string;
  trades: number;
  bucket: string;
}

interface ScrapedResult {
  wallet: string;
  net_total: number | null;
  gain: number | null;
  loss: number | null;
  volume: number | null;
  scraped_at: string;
  error?: string;
}

// Load checkpoint
function loadCheckpoint(): Set<string> {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
      return new Set(data.completed || []);
    }
  } catch (e) {
    console.log('No checkpoint found, starting fresh');
  }
  return new Set();
}

// Save checkpoint
function saveCheckpoint(completed: Set<string>) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ completed: Array.from(completed) }));
}

// Load or initialize results
function loadResults(): ScrapedResult[] {
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

// Save results
function saveResults(results: ScrapedResult[]) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// Parse dollar amount from string like "+$132.11" or "-$444.89"
function parseDollarAmount(str: string): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[,$]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Get HC wallets to scrape (stratified)
async function getHCWallets(limit: number = 200): Promise<WalletToScrape[]> {
  const buckets = [
    { name: '10-20', min: 10, max: 20, limit: Math.ceil(limit / 4) },
    { name: '21-50', min: 21, max: 50, limit: Math.ceil(limit / 4) },
    { name: '51-200', min: 51, max: 200, limit: Math.ceil(limit / 4) },
    { name: '200+', min: 201, max: 999999, limit: Math.ceil(limit / 4) },
  ];

  const results: WalletToScrape[] = [];

  for (const b of buckets) {
    const q = await clickhouse.query({
      query: `
        WITH clob AS (
          SELECT lower(trader_wallet) as wallet, count() as trades
          FROM pm_trader_events_dedup_v2_tbl
          GROUP BY lower(trader_wallet)
          HAVING count() >= ${b.min} AND count() <= ${b.max}
        ),
        xfr AS (
          SELECT DISTINCT lower(to_address) as wallet
          FROM pm_erc1155_transfers
          WHERE lower(from_address) != '0x0000000000000000000000000000000000000000'
        ),
        split AS (
          SELECT DISTINCT lower(user_address) as wallet
          FROM pm_ctf_events
          WHERE event_type IN ('PositionSplit', 'PositionsMerge')
        ),
        bench AS (
          SELECT DISTINCT lower(wallet) as wallet
          FROM pm_ui_pnl_benchmarks_v1
        )
        SELECT c.wallet, c.trades
        FROM clob c
        WHERE c.wallet NOT IN (SELECT wallet FROM xfr)
          AND c.wallet NOT IN (SELECT wallet FROM split)
          AND c.wallet NOT IN (SELECT wallet FROM bench)
        ORDER BY rand()
        LIMIT ${b.limit}
      `,
      format: 'JSONEachRow'
    });
    const rows = await q.json() as any[];
    for (const r of rows) {
      results.push({ wallet: r.wallet, trades: Number(r.trades), bucket: b.name });
    }
  }

  return results;
}

// Insert benchmark to ClickHouse
async function insertBenchmark(result: ScrapedResult): Promise<void> {
  if (result.net_total === null) return;

  await clickhouse.insert({
    table: 'pm_ui_pnl_benchmarks_v1',
    values: [{
      wallet: result.wallet,
      pnl_value: result.net_total,
      benchmark_set: 'hc_playwright_2025_12_13',
      captured_at: result.scraped_at,
    }],
    format: 'JSONEachRow',
  });
}

// Main function - outputs instructions for manual Playwright execution
async function main() {
  console.log('HC BENCHMARK EXPANSION - PLAYWRIGHT SCRAPER');
  console.log('='.repeat(80));

  // Load state
  const completed = loadCheckpoint();
  const results = loadResults();
  console.log(`Checkpoint: ${completed.size} wallets already completed`);
  console.log(`Results: ${results.length} results saved\n`);

  // Get wallets to scrape
  const wallets = await getHCWallets(200);
  const toScrape = wallets.filter(w => !completed.has(w.wallet));
  console.log(`Total wallets: ${wallets.length}`);
  console.log(`Remaining to scrape: ${toScrape.length}\n`);

  if (toScrape.length === 0) {
    console.log('All wallets scraped! Inserting to ClickHouse...');
    let inserted = 0;
    for (const r of results) {
      if (r.net_total !== null) {
        await insertBenchmark(r);
        inserted++;
      }
    }
    console.log(`Inserted ${inserted} benchmarks to ClickHouse`);
    await clickhouse.close();
    return;
  }

  // Output wallets for Playwright MCP scraping
  console.log('WALLETS TO SCRAPE (use Playwright MCP):');
  console.log('-'.repeat(80));

  // Output first 20 wallets for batch scraping
  const batch = toScrape.slice(0, 20);
  for (let i = 0; i < batch.length; i++) {
    const w = batch[i];
    console.log(`${i + 1}. ${w.wallet} (${w.trades} trades, bucket: ${w.bucket})`);
    console.log(`   URL: https://polymarket.com/profile/${w.wallet}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('INSTRUCTIONS:');
  console.log('1. Navigate to each wallet URL using mcp__playwright__browser_navigate');
  console.log('2. Wait for page load, then hover on info icon (ref varies, look for cursor=pointer near Profit/Loss)');
  console.log('3. Extract Net total from tooltip');
  console.log('4. Call this script with --save "wallet,net_total" to save result');
  console.log('');
  console.log('Example save command:');
  console.log('  npx tsx scripts/pnl/expand-hc-benchmarks-playwright.ts --save "0x123...,-312.78"');

  await clickhouse.close();
}

// Handle --save argument
if (process.argv.includes('--save')) {
  const idx = process.argv.indexOf('--save');
  const data = process.argv[idx + 1];
  if (data) {
    const [wallet, net_total_str] = data.split(',');
    const net_total = parseFloat(net_total_str);

    const results = loadResults();
    const completed = loadCheckpoint();

    results.push({
      wallet: wallet.toLowerCase(),
      net_total: isNaN(net_total) ? null : net_total,
      gain: null,
      loss: null,
      volume: null,
      scraped_at: new Date().toISOString(),
    });

    completed.add(wallet.toLowerCase());

    saveResults(results);
    saveCheckpoint(completed);

    console.log(`Saved: ${wallet} = $${net_total}`);
    console.log(`Total completed: ${completed.size}`);
  }
} else {
  main().catch(console.error);
}
