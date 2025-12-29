#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';
import { calculateAllMetrics } from '../lib/clickhouse/metrics-calculator';

async function main() {
  const ch = getClickHouseClient();

  const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const DATE_START = '2022-06-01';
  const BASELINE_PNL = -27558.71;

  console.log('\nCalculating metrics for baseline wallet using Group 1 calculator...\n');

  const metrics = await calculateAllMetrics(ch, {
    wallet: BASELINE_WALLET,
    dateStart: DATE_START,
    dateEnd: '2025-11-11'
  });

  const totalPnl = metrics.realized_pnl + metrics.unrealized_payout;
  const diff = Math.abs(totalPnl - BASELINE_PNL);

  console.log('Baseline Wallet Metrics:');
  console.log(`  Realized P&L: $${metrics.realized_pnl.toFixed(2)}`);
  console.log(`  Unrealized Payout: $${metrics.unrealized_payout.toFixed(2)}`);
  console.log(`  Total P&L: $${totalPnl.toFixed(2)}`);
  console.log(`  Expected: $${BASELINE_PNL.toFixed(2)}`);
  console.log(`  Difference: $${diff.toFixed(2)}`);
  console.log(`  Match: ${diff < 1 ? 'YES ✅' : 'NO ⚠️'}\n`);

  await ch.close();
}

main().catch(console.error);
