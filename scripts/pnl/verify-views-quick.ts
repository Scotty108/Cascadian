#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';

async function main() {
  const ch = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
  });

  const views = [
    'vw_tierA_realized_pnl_summary',
    'vw_tierA_pnl_by_category',
    'vw_tierA_win_loss_stats',
    'vw_tierA_omega_ratio',
    'vw_tierA_omega_ratio_by_category',
    'vw_tierA_time_in_trade'
  ];

  console.log('Checking metrics layer views...\n');
  for (const v of views) {
    try {
      await ch.query({ query: `SHOW CREATE VIEW ${v}`, format: 'TabSeparated' });
      console.log(`✓ ${v} - exists`);
    } catch (e: any) {
      console.log(`✗ ${v} - NOT FOUND`);
    }
  }

  await ch.close();
}

main();
