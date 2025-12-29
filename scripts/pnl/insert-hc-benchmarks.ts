#!/usr/bin/env npx tsx
/**
 * Insert HC benchmarks from scraped results into ClickHouse
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
});

async function main() {
  const results = JSON.parse(fs.readFileSync('/tmp/hc_benchmark_results.json', 'utf-8'));
  console.log('Inserting', results.length, 'HC benchmarks...');

  const values = results
    .filter((r: any) => r.net_total !== null)
    .map((r: any) => ({
      wallet: r.wallet,
      pnl_value: r.net_total,
      benchmark_set: 'hc_playwright_2025_12_13',
      captured_at: r.scraped_at,
    }));

  await clickhouse.insert({
    table: 'pm_ui_pnl_benchmarks_v1',
    values,
    format: 'JSONEachRow',
  });

  console.log('Inserted', values.length, 'benchmarks');
  await clickhouse.close();
}

main().catch(console.error);
