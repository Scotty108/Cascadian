#!/usr/bin/env npx tsx
import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        benchmark_set,
        status,
        count() as cnt,
        countIf(ui_pnl_value IS NOT NULL) as with_pnl
      FROM pm_ui_pnl_benchmarks_v2
      WHERE benchmark_set = 'trader_strict_v2_2025_12_07'
      GROUP BY benchmark_set, status
      ORDER BY status
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json<Array<{ benchmark_set: string; status: string; cnt: string; with_pnl: string }>>();
  console.log('\n📊 ClickHouse Verification:');
  console.log('Benchmark Set: trader_strict_v2_2025_12_07\n');
  for (const row of rows) {
    console.log(`  ${row.status.padEnd(15)} Count: ${row.cnt}  (with PnL: ${row.with_pnl})`);
  }

  const sample = await client.query({
    query: `
      SELECT wallet_address, ui_pnl_value, status
      FROM pm_ui_pnl_benchmarks_v2
      WHERE benchmark_set = 'trader_strict_v2_2025_12_07'
        AND status = 'success'
      ORDER BY ui_pnl_value DESC
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const sampleRows = await sample.json<Array<{ wallet_address: string; ui_pnl_value: number; status: string }>>();
  console.log('\n📋 Sample (Top 3 by PnL):\n');
  for (const row of sampleRows) {
    console.log(`  ${row.wallet_address}: $${row.ui_pnl_value.toLocaleString()}`);
  }
  console.log();
}

main();
