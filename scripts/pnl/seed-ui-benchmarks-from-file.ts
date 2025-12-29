/**
 * Seed UI Benchmarks from JSON File
 *
 * Loads wallet UI PnL benchmarks from a JSON file into pm_ui_pnl_benchmarks_v1.
 * Used to import both legacy and fresh benchmark sets.
 *
 * Usage:
 *   npx tsx scripts/pnl/seed-ui-benchmarks-from-file.ts <json_file_path>
 *
 * Example:
 *   npx tsx scripts/pnl/seed-ui-benchmarks-from-file.ts data/pnl/ui_benchmarks_50_wallets_legacy.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { clickhouse } from '../../lib/clickhouse/client';

interface BenchmarkEntry {
  wallet: string;
  ui_pnl: number;
  note?: string;
}

interface BenchmarkFile {
  metadata: {
    benchmark_set: string;
    source: string;
    captured_at: string;
    notes?: string;
  };
  wallets: BenchmarkEntry[];
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/pnl/seed-ui-benchmarks-from-file.ts <json_file_path>');
    console.log('');
    console.log('Example:');
    console.log('  npx tsx scripts/pnl/seed-ui-benchmarks-from-file.ts data/pnl/ui_benchmarks_50_wallets_legacy.json');
    process.exit(1);
  }

  const filePath = args[0];
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  console.log('='.repeat(100));
  console.log('SEED UI BENCHMARKS FROM FILE');
  console.log('='.repeat(100));
  console.log(`File: ${absolutePath}`);
  console.log('');

  // Read and parse JSON
  const fileContent = fs.readFileSync(absolutePath, 'utf-8');
  const data: BenchmarkFile = JSON.parse(fileContent);

  console.log('Metadata:');
  console.log(`  Benchmark set: ${data.metadata.benchmark_set}`);
  console.log(`  Source:        ${data.metadata.source}`);
  console.log(`  Captured at:   ${data.metadata.captured_at}`);
  console.log(`  Notes:         ${data.metadata.notes || 'N/A'}`);
  console.log(`  Wallets:       ${data.wallets.length}`);
  console.log('');

  // Check if benchmark_set already exists
  const existsQuery = `
    SELECT count() as cnt
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${data.metadata.benchmark_set}'
  `;
  const existsResult = await clickhouse.query({ query: existsQuery, format: 'JSONEachRow' });
  const existsRows = (await existsResult.json()) as any[];
  const existingCount = Number(existsRows[0]?.cnt || 0);

  if (existingCount > 0) {
    console.log(`WARNING: Benchmark set '${data.metadata.benchmark_set}' already has ${existingCount} entries.`);
    console.log('New entries will be inserted (ReplacingMergeTree will handle deduplication).');
    console.log('');
  }

  // Prepare insert values
  const capturedAt = new Date(data.metadata.captured_at);
  const capturedAtStr = capturedAt.toISOString().replace('T', ' ').substring(0, 19);

  const values = data.wallets.map((w) => ({
    wallet: w.wallet.toLowerCase(),
    source: data.metadata.source,
    pnl_value: w.ui_pnl,
    pnl_currency: 'USDC',
    captured_at: capturedAtStr,
    note: w.note || '',
    benchmark_set: data.metadata.benchmark_set,
  }));

  // Insert into ClickHouse
  console.log('Inserting into pm_ui_pnl_benchmarks_v1...');

  await clickhouse.insert({
    table: 'pm_ui_pnl_benchmarks_v1',
    values,
    format: 'JSONEachRow',
  });

  console.log(`Inserted ${values.length} rows.`);
  console.log('');

  // Verify
  const verifyQuery = `
    SELECT count() as cnt, min(captured_at) as min_date, max(captured_at) as max_date
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${data.metadata.benchmark_set}'
  `;
  const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
  const verifyRows = (await verifyResult.json()) as any[];

  console.log('Verification:');
  console.log(`  Total rows in set: ${verifyRows[0]?.cnt}`);
  console.log(`  Date range:        ${verifyRows[0]?.min_date} to ${verifyRows[0]?.max_date}`);
  console.log('');
  console.log('='.repeat(100));
  console.log('SEED COMPLETE');
  console.log('='.repeat(100));
}

main().catch(console.error);
