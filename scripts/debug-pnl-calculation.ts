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
  console.log(`\n═══ Debugging P&L Calculation for ${TARGET_WALLET} ═══\n`);
  
  // Step 1: Check wallet_token_flows
  const flows = await clickhouse.query({
    query: `
      SELECT *
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const flowData = await flows.json();
  console.log('Step 1: wallet_token_flows (5 samples):');
  console.log(JSON.stringify(flowData, null, 2));
  
  // Step 2: Check token_per_share_payout
  const payout = await clickhouse.query({
    query: `
      SELECT *
      FROM token_per_share_payout
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const payoutData = await payout.json();
  console.log('\nStep 2: token_per_share_payout (5 samples):');
  console.log(JSON.stringify(payoutData, null, 2));
  
  // Step 3: Check if wallet's conditions have resolutions
  const joined = await clickhouse.query({
    query: `
      SELECT
        f.condition_id_ctf,
        f.index_set_mask,
        f.net_shares,
        f.gross_cf,
        f.fees,
        t.pps
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout t USING (condition_id_ctf)
      WHERE lower(f.wallet) = lower('${TARGET_WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const joinedData = await joined.json();
  console.log('\nStep 3: wallet flows joined with payouts (5 samples):');
  console.log(JSON.stringify(joinedData, null, 2));
  
  // Step 4: Check wallet_condition_pnl_token
  const tokenPnl = await clickhouse.query({
    query: `
      SELECT *
      FROM wallet_condition_pnl_token
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const tokenPnlData = await tokenPnl.json();
  console.log('\nStep 4: wallet_condition_pnl_token (5 samples):');
  console.log(JSON.stringify(tokenPnlData, null, 2));
  
  // Step 5: Aggregate to condition level
  const conditionPnl = await clickhouse.query({
    query: `
      SELECT *
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const conditionPnlData = await conditionPnl.json();
  console.log('\nStep 5: wallet_condition_pnl (5 samples):');
  console.log(JSON.stringify(conditionPnlData, null, 2));
  
  // Step 6: Final wallet P&L
  const walletPnl = await clickhouse.query({
    query: `
      SELECT *
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const walletPnlData = await walletPnl.json();
  console.log('\nStep 6: wallet_realized_pnl (final):');
  console.log(JSON.stringify(walletPnlData, null, 2));
  
  // Count totals at each level
  const counts = await clickhouse.query({
    query: `
      SELECT
        'wallet_token_flows' as level,
        count() as cnt
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
      UNION ALL
      SELECT
        'wallet_condition_pnl_token' as level,
        count() as cnt
      FROM wallet_condition_pnl_token
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
      UNION ALL
      SELECT
        'wallet_condition_pnl' as level,
        count() as cnt
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const countsData = await counts.json();
  console.log('\n═══ Row Counts at Each Level ═══');
  console.log(JSON.stringify(countsData, null, 2));
  
  await clickhouse.close();
}

main();
