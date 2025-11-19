#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  // Status breakdown
  const statusResult = await clickhouse.query({
    query: `
      SELECT
        status,
        COUNT(*) as wallet_count,
        SUM(trade_count) as total_trades,
        SUM(notional) as total_notional
      FROM wallet_backfill_plan
      GROUP BY status
      ORDER BY status
    `,
    format: 'JSONEachRow'
  });

  const statusBreakdown = await statusResult.json();
  console.log('Status Breakdown:');
  console.table(statusBreakdown);
  console.log('');

  // Top 10 pending wallets
  const top10Result = await clickhouse.query({
    query: `
      SELECT
        priority_rank,
        wallet_address,
        trade_count,
        notional,
        status
      FROM wallet_backfill_plan
      WHERE status = 'pending'
      ORDER BY priority_rank ASC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const top10 = await top10Result.json();

  console.log('Top 10 Pending Wallets:');
  console.log('');
  console.table(top10.map((w: any) => ({
    rank: w.priority_rank,
    wallet: w.wallet_address.substring(0, 16) + '...',
    trades: parseInt(w.trade_count).toLocaleString(),
    notional: '$' + parseFloat(w.notional).toFixed(2),
    status: w.status
  })));
  console.log('');

  // Check xcnstrategy
  const xcnResult = await clickhouse.query({
    query: `
      SELECT *
      FROM wallet_backfill_plan
      WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
    `,
    format: 'JSONEachRow'
  });

  const xcn = await xcnResult.json();
  console.log('xcnstrategy Entry:');
  console.log(JSON.stringify(xcn[0], null, 2));
}

main().catch(console.error);
