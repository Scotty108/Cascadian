/**
 * Capture UI PnL benchmarks WITH price snapshots
 *
 * This script:
 * 1. Accepts a list of wallet addresses
 * 2. Scrapes UI PnL using Playwright (or accepts pre-scraped values)
 * 3. Fetches current Gamma prices for ALL active markets
 * 4. Saves both to ClickHouse with matching benchmark_set_id
 *
 * Usage:
 *   npx tsx scripts/pnl/capture-benchmark-with-prices.ts --wallets wallet1,wallet2
 *   npx tsx scripts/pnl/capture-benchmark-with-prices.ts --file wallets.txt
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

interface PriceSnapshot {
  condition_id: string;
  outcome_index: number;
  gamma_price: number;
}

async function fetchAllGammaPrices(): Promise<PriceSnapshot[]> {
  const baseUrl = process.env.POLYMARKET_API_URL || 'https://gamma-api.polymarket.com';
  const prices: PriceSnapshot[] = [];

  let offset = 0;
  const limit = 500;
  const maxPages = 30;
  let pageCount = 0;

  console.log('Fetching Gamma prices...');

  while (pageCount < maxPages) {
    try {
      const response = await fetch(
        `${baseUrl}/markets?limit=${limit}&offset=${offset}&closed=false`,
        {
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        console.warn(`Failed to fetch prices: ${response.status}`);
        break;
      }

      const markets = (await response.json()) as Array<{
        conditionId: string;
        outcomePrices: string;
      }>;

      if (markets.length === 0) break;

      for (const market of markets) {
        if (!market.conditionId) continue;

        const normalizedConditionId = market.conditionId.toLowerCase().replace(/^0x/, '');

        try {
          const rawPrices = JSON.parse(market.outcomePrices || '[]');
          const parsedPrices = rawPrices.map((p: string) => parseFloat(p) || 0);

          for (let i = 0; i < parsedPrices.length; i++) {
            prices.push({
              condition_id: normalizedConditionId,
              outcome_index: i,
              gamma_price: parsedPrices[i],
            });
          }
        } catch {
          continue;
        }
      }

      if (markets.length < limit) break;
      offset += limit;
      pageCount++;

      await new Promise((r) => setTimeout(r, 100));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`Price fetch error: ${msg}`);
      break;
    }
  }

  console.log(`Fetched ${prices.length} price snapshots from ${pageCount + 1} pages`);
  return prices;
}

async function savePriceSnapshots(
  client: ReturnType<typeof getClickHouseClient>,
  benchmarkSetId: string,
  prices: PriceSnapshot[],
  fetchedAt: Date
): Promise<void> {
  if (prices.length === 0) return;

  const fetchedAtStr = fetchedAt.toISOString().replace('T', ' ').slice(0, 19);

  // Insert in batches
  const batchSize = 10000;
  for (let i = 0; i < prices.length; i += batchSize) {
    const batch = prices.slice(i, i + batchSize);
    const values = batch
      .map(
        (p) =>
          `('${benchmarkSetId}', '${p.condition_id}', ${p.outcome_index}, ${p.gamma_price}, '${fetchedAtStr}')`
      )
      .join(',\n');

    const insertQuery = `
      INSERT INTO pm_benchmark_price_snapshots
      (benchmark_set_id, condition_id, outcome_index, gamma_price, fetched_at)
      VALUES ${values}
    `;

    await client.command({ query: insertQuery });
  }

  console.log(`Saved ${prices.length} price snapshots for benchmark_set: ${benchmarkSetId}`);
}

interface BenchmarkEntry {
  wallet: string;
  ui_pnl: number;
  source: string;
  note?: string;
}

async function saveBenchmarks(
  client: ReturnType<typeof getClickHouseClient>,
  benchmarkSetId: string,
  benchmarks: BenchmarkEntry[],
  capturedAt: Date
): Promise<void> {
  if (benchmarks.length === 0) return;

  const capturedAtStr = capturedAt.toISOString().replace('T', ' ').slice(0, 19);

  const values = benchmarks
    .map(
      (b) =>
        `('${b.wallet.toLowerCase()}', '${b.source}', ${b.ui_pnl}, 'USDC', '${capturedAtStr}', '${b.note || ''}', '${benchmarkSetId}')`
    )
    .join(',\n');

  const insertQuery = `
    INSERT INTO pm_ui_pnl_benchmarks_v1
    (wallet, source, pnl_value, pnl_currency, captured_at, note, benchmark_set)
    VALUES ${values}
  `;

  await client.command({ query: insertQuery });
  console.log(`Saved ${benchmarks.length} benchmarks for benchmark_set: ${benchmarkSetId}`);
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let wallets: string[] = [];
  let benchmarks: BenchmarkEntry[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wallets' && args[i + 1]) {
      wallets = args[i + 1].split(',').map((w) => w.trim().toLowerCase());
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      const fs = await import('fs');
      const content = fs.readFileSync(args[i + 1], 'utf-8');
      wallets = content
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l.startsWith('0x'));
      i++;
    } else if (args[i] === '--benchmark-json' && args[i + 1]) {
      // Accept pre-scraped benchmarks as JSON
      benchmarks = JSON.parse(args[i + 1]);
      i++;
    }
  }

  if (wallets.length === 0 && benchmarks.length === 0) {
    console.log('Usage:');
    console.log('  --wallets wallet1,wallet2   Comma-separated wallet list');
    console.log('  --file wallets.txt          File with wallet addresses');
    console.log('  --benchmark-json "[...]"    Pre-scraped benchmarks as JSON');
    console.log('\nExample:');
    console.log('  npx tsx scripts/pnl/capture-benchmark-with-prices.ts --wallets 0xabc,0xdef');
    process.exit(1);
  }

  const client = getClickHouseClient();
  const now = new Date();
  const benchmarkSetId = `v19s_validation_${now.toISOString().slice(0, 10).replace(/-/g, '')}_${now.getTime()}`;

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   CAPTURE BENCHMARK WITH PRICE SNAPSHOTS                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Benchmark set ID: ${benchmarkSetId}`);
  console.log(`Capture time: ${now.toISOString()}\n`);

  // Step 1: Fetch all Gamma prices
  const prices = await fetchAllGammaPrices();

  // Step 2: Save price snapshots
  await savePriceSnapshots(client, benchmarkSetId, prices, now);

  // Step 3: If we have pre-scraped benchmarks, save them
  if (benchmarks.length > 0) {
    await saveBenchmarks(client, benchmarkSetId, benchmarks, now);
  } else if (wallets.length > 0) {
    console.log('\n⚠ Wallets provided but no UI PnL values.');
    console.log('To complete the benchmark, scrape UI values with Playwright and provide via --benchmark-json');
    console.log('\nWallets to scrape:');
    for (const w of wallets.slice(0, 10)) {
      console.log(`  ${w}`);
    }
    if (wallets.length > 10) {
      console.log(`  ... and ${wallets.length - 10} more`);
    }
  }

  console.log('\n✓ Price snapshot capture complete');
  console.log(`  Use benchmark_set: ${benchmarkSetId} for validation`);
}

main().catch(console.error);
