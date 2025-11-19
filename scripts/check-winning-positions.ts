#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';

config({ path: resolve(__dirname, '../.env.local') });

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

async function main() {
  // Check conditions with payouts > 0
  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        index_set_mask,
        net_shares,
        gross_cf,
        realized_payout,
        pnl_gross,
        pnl_net
      FROM wallet_condition_pnl_token
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
        AND realized_payout > 0
      ORDER BY realized_payout DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json();
  console.log('Winning positions (realized_payout > 0):');
  console.log(JSON.stringify(data, null, 2));

  // Summary stats
  const summary = await clickhouse.query({
    query: `
      SELECT
        count() as total_positions,
        countIf(realized_payout > 0) as winning_positions,
        countIf(realized_payout = 0) as non_winning_positions,
        sum(gross_cf) as total_cashflow,
        sum(realized_payout) as total_payout,
        sum(pnl_gross) as total_pnl_gross,
        sum(pnl_net) as total_pnl_net
      FROM wallet_condition_pnl_token
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow',
  });

  const summaryData = await summary.json();
  console.log('\nSummary statistics:');
  console.log(JSON.stringify(summaryData, null, 2));

  await clickhouse.close();
}

main();
