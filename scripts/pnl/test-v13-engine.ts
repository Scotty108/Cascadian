#!/usr/bin/env npx tsx
/**
 * Test V13 Engine - Compare against UI benchmark
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { V13Engine } from '../../lib/pnl/uiActivityEngineV13';
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  const wallet = process.argv[2] || '0x114d7a8e7a1dd2dde555744a432ddcb871454c92';

  // Get UI benchmark
  const benchQ = await clickhouse.query({
    query: `SELECT pnl_value FROM pm_ui_pnl_benchmarks_v1 WHERE lower(wallet) = lower('${wallet}') LIMIT 1`,
    format: 'JSONEachRow'
  });
  const bench = await benchQ.json() as Array<{ pnl_value: number }>;
  const uiPnl = bench.length > 0 ? bench[0].pnl_value : 0;

  console.log('='.repeat(80));
  console.log('V13 Engine Test');
  console.log('Wallet: ' + wallet);
  console.log('UI Benchmark: $' + uiPnl.toFixed(2));
  console.log('='.repeat(80));

  const engine = new V13Engine();
  const result = await engine.compute(wallet);

  console.log('\nV13 Results:');
  console.log('  Realized PnL:   $' + result.realized_pnl.toFixed(2));
  console.log('  Unrealized PnL: $' + result.unrealized_pnl.toFixed(2));
  console.log('  Total PnL:      $' + result.total_pnl.toFixed(2));
  console.log('  Total Gain:     $' + result.total_gain.toFixed(2));
  console.log('  Total Loss:     $' + result.total_loss.toFixed(2));
  console.log('\nSource Counts:');
  console.log('  CLOB trades:    ' + result.clob_trades);
  console.log('  CTF splits:     ' + result.ctf_splits);
  console.log('  CTF merges:     ' + result.ctf_merges);
  console.log('  Resolutions:    ' + result.resolutions);

  const delta = result.total_pnl - uiPnl;
  console.log('\n' + '='.repeat(80));
  console.log('Comparison to UI:');
  console.log('  V13 Total:  $' + result.total_pnl.toFixed(2));
  console.log('  UI Target:  $' + uiPnl.toFixed(2));
  console.log('  Delta:      $' + delta.toFixed(2) + ' (' + ((delta / Math.abs(uiPnl)) * 100).toFixed(1) + '%)');
  console.log('='.repeat(80));

  await clickhouse.close();
  process.exit(0);
}

main().catch(console.error);
